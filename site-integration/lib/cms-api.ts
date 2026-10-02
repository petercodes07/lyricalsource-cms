import "server-only";
import crypto from "crypto";
import sanitizeHtml from "sanitize-html";
import { NextRequest, NextResponse } from "next/server";

export function requireCms(req: NextRequest): NextResponse | null {
  const secret = process.env.CMS_API_TOKEN;
  const header = req.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!secret || !supplied) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const a = Buffer.from(secret);
  const b = Buffer.from(supplied);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function cleanArticle(input: any) {
  const title = String(input.title ?? "").trim().slice(0, 300);
  const slug = String(input.slug ?? "").trim().toLowerCase();
  const body = sanitizeHtml(String(input.body ?? "").trim(), {
    allowedTags: ["p", "br", "h2", "h3", "h4", "strong", "em", "b", "i", "u", "ul", "ol", "li", "blockquote", "a", "img", "figure", "figcaption", "hr"],
    allowedAttributes: { a: ["href", "title", "target", "rel"], img: ["src", "alt", "title"] },
    allowedSchemes: ["https", "http", "mailto"],
    transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }) },
  });
  const excerpt = String(input.excerpt ?? "").trim().slice(0, 1000);
  const author = String(input.author ?? "Editorial").trim().slice(0, 255);
  const image = String(input.image ?? "").trim().slice(0, 2000);
  const actor = String(input.actor ?? "unknown").trim().slice(0, 255);
  const tags = Array.isArray(input.tags) ? input.tags.map((v: unknown) => String(v).trim().slice(0, 200)).filter(Boolean).slice(0, 20) : [];
  const postType = ["news", "blog", "album", "playlist"].includes(input.postType) ? input.postType : "news";
  const status = input.status === "published" ? "published" : "draft";
  if (!title || !body || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !author || !actor || actor === "unknown") {
    throw new Error("Title, body, valid slug, author and actor are required");
  }
  if (status === "published" && !excerpt) throw new Error("A summary is required to publish");
  if (image && !image.startsWith("/uploads/news/") && !/^https:\/\//.test(image)) throw new Error("Invalid image URL");
  return { title, slug, body, excerpt, author, image, actor, tags, postType, status, version: input.version, ownerId: Number.isSafeInteger(input.ownerId) && input.ownerId > 0 ? input.ownerId : null };
}
