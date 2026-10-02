import { versionConflict } from '@/lib/cms-version';
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { requireCms } from '@/lib/cms-api';
import { cleanSongNames } from '@/lib/cms-song';
import { revalidatePath, revalidateTag } from 'next/cache';
import { clearMemCache } from '@/lib/mem-cache';
export const dynamic = 'force-dynamic';
function songId(value: string) { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : null; }
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireCms(req); if (denied) return denied;
  const id = songId(params.id); if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const [rows] = await (await getPool()).execute<any[]>('SELECT id, edit_version AS version, slug, title, song_name AS songName, artist_name AS artistName FROM songs WHERE id=?', [id]);
  return rows.length ? NextResponse.json({ song: rows[0] }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
}
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireCms(req); if (denied) return denied;
  const id = songId(params.id); if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  let names, version: unknown;
  try { const input = await req.json(); names = cleanSongNames(input); version = input.version; } catch { return NextResponse.json({ error: 'Title and song name must contain 1–300 characters' }, { status: 400 }); }
  const conn = await (await getPool()).getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<any[]>('SELECT slug, edit_version FROM songs WHERE id=? FOR UPDATE', [id]);
    if (!rows.length) { await conn.rollback(); return NextResponse.json({ error: 'Not found' }, { status: 404 }); }
    const conflict = versionConflict(version, Number(rows[0].edit_version));
    if (conflict) { await conn.rollback(); return conflict; }
    await conn.execute('UPDATE songs SET title=?, song_name=?, edit_version=edit_version+1 WHERE id=?', [names.title, names.songName, id]);
    await conn.commit();
    clearMemCache(['songs']); revalidateTag('songs'); revalidatePath(`/lyrics/${rows[0].slug}`); revalidatePath('/');
    return NextResponse.json({ id, slug: rows[0].slug });
  } catch { await conn.rollback(); return NextResponse.json({ error: 'Unable to update song' }, { status: 500 }); }
  finally { conn.release(); }
}
