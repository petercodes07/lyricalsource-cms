import "server-only";
import crypto from "node:crypto";
import { getPool } from "./db";
import type { Article } from "./types";

export async function getPreviewArticle(slug: string, query: { preview?: string; signature?: string }): Promise<Article | null> {
  const secret = process.env.CMS_API_TOKEN;
  const expiry = Number(query.preview);
  const now = Math.floor(Date.now() / 1000);
  if (!secret || typeof query.preview !== "string" || !/^\d+$/.test(query.preview) ||
      !Number.isSafeInteger(expiry) || expiry <= now || expiry > now + 900 ||
      typeof query.signature !== "string" || !/^[a-f0-9]{64}$/.test(query.signature)) return null;
  const expected = crypto.createHmac("sha256", secret).update(`article-preview:${slug}:${query.preview}`).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(query.signature, "hex"))) return null;
  const [rows] = await (await getPool()).execute<any[]>(
    "SELECT a.*, GROUP_CONCAT(DISTINCT at.tag) AS tags FROM articles a LEFT JOIN article_tags at ON at.article_id=a.id WHERE a.slug=? AND a.status='draft' GROUP BY a.id LIMIT 1", [slug]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return { slug: row.slug, title: row.title, body: row.body, excerpt: row.excerpt, author: row.author,
    image: row.image_url || "", publishedAt: "Draft", postType: row.post_type,
    tags: row.tags ? row.tags.split(",") : [] };
}
