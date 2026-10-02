import { NextRequest, NextResponse } from "next/server";
import { requireCms } from "@/lib/cms-api";
import sharp from "sharp";
import crypto from "crypto";
import path from "path";
import { mkdir, writeFile } from "fs/promises";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = requireCms(req); if (denied) return denied;
  const form = await req.formData();
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0 || file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "Choose an image under 5 MB" }, { status: 400 });
  }
  try {
    const output = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate().resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 }).toBuffer();
    const name = `${crypto.randomUUID()}.webp`;
    const dir = path.join(process.cwd(), "public", "uploads", "news", "cms");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), output, { flag: "wx" });
    return NextResponse.json({ url: `/uploads/news/cms/${name}` }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid image or upload failed" }, { status: 400 });
  }
}
