import { versionConflict } from '@/lib/cms-version';
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { cleanArticle, requireCms } from "@/lib/cms-api";
import { revalidatePath, revalidateTag } from "next/cache";
import { clearMemCache } from "@/lib/mem-cache";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireCms(req); if (denied) return denied;
  const id = Number(params.id); if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const [rows] = await (await getPool()).execute<any[]>(
    "SELECT a.id, a.edit_version AS version, a.slug, a.title, a.body, a.excerpt, a.author, a.image_url AS image, a.published_at AS publishedAt, a.post_type AS postType, a.status, GROUP_CONCAT(at.tag) AS tags FROM articles a LEFT JOIN article_tags at ON at.article_id = a.id WHERE a.id = ? GROUP BY a.id", [id]
  );
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ article: { ...rows[0], tags: rows[0].tags ? rows[0].tags.split(",") : [] } });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireCms(req); if (denied) return denied;
  const id = Number(params.id); if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  let article;
  try { article = cleanArticle(await req.json()); }
  catch (error) { return NextResponse.json({ error: String((error as Error).message) }, { status: 400 }); }
  const conn = await (await getPool()).getConnection();
  try {
    await conn.beginTransaction();
    const [prior] = await conn.execute<any[]>("SELECT slug, status, published_at, edit_version FROM articles WHERE id = ? FOR UPDATE", [id]);
    if (!prior.length) { await conn.rollback(); return NextResponse.json({ error: "Not found" }, { status: 404 }); }
    const conflict = versionConflict(article.version, Number(prior[0].edit_version));
    if (conflict) { await conn.rollback(); return conflict; }
    await conn.execute(
      "UPDATE articles SET slug=?, title=?, body=?, excerpt=?, author=?, image_url=?, published_at=?, post_type=?, status=?, updated_by=?, edit_version=edit_version+1 WHERE id=?",
      [article.slug, article.title, article.body, article.excerpt, article.author, article.image || null,
        article.status === "published" ? (prior[0].published_at ?? new Date()) : null, article.postType, article.status, article.actor, id]
    );
    await conn.execute("DELETE FROM article_tags WHERE article_id = ?", [id]);
    for (const tag of article.tags) await conn.execute("INSERT INTO article_tags (article_id, tag) VALUES (?, ?)", [id, tag]);
    const action = article.status !== prior[0].status ? article.status === "published" ? "publish" : "unpublish" : "update";
    await conn.execute("INSERT INTO cms_audit (article_id, action, actor_email) VALUES (?, ?, ?)", [id, action, article.actor]);
    await conn.commit();
    clearMemCache(['articles']); revalidateTag("articles"); revalidatePath("/news"); revalidatePath("/blog"); revalidatePath("/"); revalidatePath(`/articles/${prior[0].slug}`); revalidatePath(`/articles/${article.slug}`);
    return NextResponse.json({ id, slug: article.slug });
  } catch (error: any) {
    await conn.rollback();
    return NextResponse.json({ error: error.code === "ER_DUP_ENTRY" ? "Slug already exists" : "Unable to update article" }, { status: error.code === "ER_DUP_ENTRY" ? 409 : 500 });
  } finally { conn.release(); }
}
