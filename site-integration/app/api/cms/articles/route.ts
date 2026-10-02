import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { cleanArticle, requireCms } from "@/lib/cms-api";
import { revalidatePath, revalidateTag } from "next/cache";
import { clearMemCache } from "@/lib/mem-cache";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = requireCms(req);
  if (denied) return denied;
  const params = req.nextUrl.searchParams;
  const page = Math.min(100000, Math.max(1, Math.floor(Number(params.get('page')) || 1)));
  const q = (params.get('q') || '').trim().slice(0,200);
  const type = params.get('type');
  const ownerId = params.has('ownerId') ? Number(params.get('ownerId')) : null;
  if (ownerId !== null && (!Number.isSafeInteger(ownerId) || ownerId < 1)) return NextResponse.json({error:'Invalid owner'},{status:400});
  const where: string[] = [], values: unknown[] = [];
  if (ownerId !== null) { where.push("a.cms_owner_id=? AND a.status='draft'"); values.push(ownerId); }
  if (['news','blog','album','playlist'].includes(type || '')) { where.push('a.post_type=?'); values.push(type); }
  const scope = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const pool = await getPool();
  const [stats] = await pool.query<any[]>(`SELECT COUNT(*) AS total, COALESCE(SUM(a.status='published'),0) AS published, COALESCE(SUM(a.status='draft'),0) AS draft FROM articles a${scope}`,values);
  const counts = {all:Number(stats[0].total),published:Number(stats[0].published),draft:Number(stats[0].draft)};
  const status = params.get('status');
  if (status === 'published' || status === 'draft') { where.push('a.status=?'); values.push(status); }
  if (q) {
    where.push('(a.title LIKE ? OR a.slug LIKE ? OR a.author LIKE ? OR EXISTS (SELECT 1 FROM article_tags t WHERE t.article_id=a.id AND t.tag LIKE ?))');
    values.push(...Array(4).fill(`%${q.replace(/[\\%_]/g, '\\$&')}%`));
  }
  const filter = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const [count] = await pool.query<any[]>(`SELECT COUNT(*) AS total FROM articles a${filter}`,values);
  const order = params.get('sort') === 'title' ? 'a.title ASC,a.id DESC' : params.get('sort') === 'oldest' ? 'a.updated_at ASC,a.id ASC' : 'a.updated_at DESC,a.id DESC';
  const [rows] = await pool.query<any[]>(`SELECT a.id,a.slug,a.title,a.excerpt,a.author,a.image_url AS image,a.published_at AS publishedAt,a.updated_at AS updatedAt,a.post_type AS postType,a.status,(SELECT GROUP_CONCAT(tag) FROM article_tags WHERE article_id=a.id) AS tags FROM articles a${filter} ORDER BY ${order} LIMIT 50 OFFSET ?`, [...values,(page-1)*50]);
  return NextResponse.json({articles:rows.map(row=>({...row,tags:row.tags?row.tags.split(','):[]})),counts,total:Number(count[0].total),page});
}

export async function POST(req: NextRequest) {
  const denied = requireCms(req);
  if (denied) return denied;
  let article;
  try { article = cleanArticle(await req.json()); }
  catch (error) { return NextResponse.json({ error: String((error as Error).message) }, { status: 400 }); }
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute<any>(
      "INSERT INTO articles (slug, title, body, excerpt, author, image_url, published_at, post_type, status, updated_by, cms_owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [article.slug, article.title, article.body, article.excerpt, article.author, article.image || null,
        article.status === "published" ? new Date() : null, article.postType, article.status, article.actor, article.ownerId]
    );
    for (const tag of article.tags) await conn.execute("INSERT INTO article_tags (article_id, tag) VALUES (?, ?)", [result.insertId, tag]);
    await conn.execute("INSERT INTO cms_audit (article_id, action, actor_email) VALUES (?, ?, ?)", [result.insertId, article.status === "published" ? "publish" : "create", article.actor]);
    await conn.commit();
    clearMemCache(['articles']); revalidateTag("articles"); revalidatePath("/news"); revalidatePath("/blog"); revalidatePath("/");
    return NextResponse.json({ id: result.insertId, slug: article.slug }, { status: 201 });
  } catch (error: any) {
    await conn.rollback();
    return NextResponse.json({ error: error.code === "ER_DUP_ENTRY" ? "Slug already exists" : "Unable to create article" }, { status: error.code === "ER_DUP_ENTRY" ? 409 : 500 });
  } finally { conn.release(); }
}
