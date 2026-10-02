import { versionConflict } from '@/lib/cms-version';
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { requireCms } from '@/lib/cms-api';
import { revalidatePath, revalidateTag } from 'next/cache';
import { clearMemCache } from '@/lib/mem-cache';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const denied = requireCms(req); if (denied) return denied;
  const slug = req.nextUrl.searchParams.get('slug');
  const pool = await getPool();
  if (!slug) {
    const page = Math.min(100000,Math.max(1,Math.floor(Number(req.nextUrl.searchParams.get('page'))||1)));
    const q = (req.nextUrl.searchParams.get('q')||'').trim().slice(0,200);
    const [counts] = await pool.query<any[]>('SELECT COUNT(*) AS total FROM playlists WHERE name LIKE ?',[`%${q}%`]);
    const [playlists] = await pool.query<any[]>('SELECT p.slug,p.name,p.description,p.image_url AS image,(SELECT s.image_url FROM playlist_songs ps JOIN songs s ON s.id=ps.song_id WHERE ps.playlist_slug=p.slug AND s.image_url IS NOT NULL ORDER BY s.views DESC LIMIT 1) AS trackImage,p.song_count AS songCount FROM playlists p WHERE p.name LIKE ? ORDER BY p.name,p.slug LIMIT 50 OFFSET ?',[`%${q}%`,(page-1)*50]);
    return NextResponse.json({ playlists,total:Number(counts[0].total),page });
  }
  const [rows] = await pool.execute<any[]>('SELECT slug,edit_version AS version,name,description,image_url AS image FROM playlists WHERE slug=?', [slug]);
  if (!rows.length) return NextResponse.json({error:'Playlist not found'}, {status:404});
  const [songs] = await pool.execute<any[]>('SELECT s.id,s.title,s.song_name AS songName,s.artist_name AS artistName FROM playlist_songs ps JOIN songs s ON s.id=ps.song_id WHERE ps.playlist_slug=? ORDER BY ps.position,s.id',[slug]);
  return NextResponse.json({playlist:{...rows[0],songs}});
}
async function save(req: NextRequest, create: boolean) {
  const denied = requireCms(req); if (denied) return denied;
  const input = await req.json().catch(()=>null);
  const name = String(input?.name || '').trim();
  const slug = String(input?.slug || '').trim();
  const description = String(input?.description || '').trim();
  const image = String(input?.image || '').trim();
  const songs: number[] = Array.isArray(input?.songs) ? input.songs : [];
  if (!name || name.length>200 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length>200 || description.length>5000 || image.length>2000 || (image && !/^https:\/\//.test(image) && !image.startsWith('/uploads/news/')) || !songs.length || songs.length>500 || songs.some(id=>!Number.isSafeInteger(id)||id<1) || new Set(songs).size!==songs.length) return NextResponse.json({error:'Enter a name, valid slug and at least one song. Use an HTTPS cover image.'},{status:400});
  const conn = await (await getPool()).getConnection();
  try {
    await conn.beginTransaction();
    const [validSongs] = await conn.query<any[]>('SELECT id FROM songs WHERE id IN (?)',[songs]);
    if(validSongs.length!==songs.length) { await conn.rollback(); return NextResponse.json({error:'One or more songs are unavailable'},{status:400}); }
    if(create) await conn.execute('INSERT INTO playlists (slug,name,description,image_url,song_count) VALUES (?,?,?,?,?)',[slug,name,description,image||null,songs.length]);
    else {
      const [prior] = await conn.execute<any[]>('SELECT slug,edit_version FROM playlists WHERE slug=? FOR UPDATE',[slug]);
      if(!prior.length) {await conn.rollback(); return NextResponse.json({error:'Playlist not found'},{status:404});}
      const conflict=versionConflict(input?.version,Number(prior[0].edit_version));
      if(conflict){await conn.rollback();return conflict;}
      await conn.execute('UPDATE playlists SET name=?,description=?,image_url=?,song_count=?,edit_version=edit_version+1 WHERE slug=?',[name,description,image||null,songs.length,slug]);
      await conn.execute('DELETE FROM playlist_songs WHERE playlist_slug=?',[slug]);
    }
    await conn.query('INSERT INTO playlist_songs (playlist_slug,song_id,position) VALUES ?', [songs.map((id,position)=>[slug,id,position])]);
    await conn.commit();
    clearMemCache(['playlists']); revalidateTag('playlists'); revalidatePath('/playlists'); revalidatePath(`/playlists/${slug}`); revalidatePath('/');
    return NextResponse.json({slug});
  } catch(error:any) {
    await conn.rollback(); return NextResponse.json({error:error.code==='ER_DUP_ENTRY'?'Slug already exists':'Unable to save playlist'},{status:error.code==='ER_DUP_ENTRY'?409:500});
  } finally {conn.release();}
}
export const POST = (req:NextRequest)=>save(req,true);
export const PUT = (req:NextRequest)=>save(req,false);
