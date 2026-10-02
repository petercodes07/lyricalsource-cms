import { versionConflict } from '@/lib/cms-version';
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { requireCms } from '@/lib/cms-api';
import { revalidatePath, revalidateTag } from 'next/cache';
import { clearMemCache } from '@/lib/mem-cache';
export const dynamic = 'force-dynamic';
const columns = 'a.id,a.edit_version AS version,a.slug,a.title,a.artist_name AS artistName,a.artist_slug AS artistSlug,a.image_url AS image,DATE_FORMAT(a.release_date,"%Y-%m-%d") AS releaseDate,a.description';
export async function GET(req:NextRequest) {
  const denied=requireCms(req);if(denied)return denied;
  const pool=await getPool(), id=Number(req.nextUrl.searchParams.get('id'));
  if(req.nextUrl.searchParams.has('id')) {
    if(!Number.isSafeInteger(id)||id<1)return NextResponse.json({error:'Invalid album'},{status:400});
    const [rows]=await pool.execute<any[]>(`SELECT ${columns} FROM albums a WHERE a.id=?`,[id]);
    if(!rows.length)return NextResponse.json({error:'Album not found'},{status:404});
    const [tracks]=await pool.execute<any[]>('SELECT s.id,s.slug,s.song_name AS songName,s.title,s.artist_name AS artistName,als.track_number AS trackNumber FROM album_songs als JOIN songs s ON s.id=als.song_id WHERE als.album_id=? ORDER BY als.track_number,s.id',[id]);
    const [qa]=await pool.execute<any[]>('SELECT question,answer FROM album_qa WHERE album_id=? ORDER BY position',[id]);
    return NextResponse.json({album:{...rows[0],tracks,qa}});
  }
  const q=(req.nextUrl.searchParams.get('q')||'').trim().slice(0,200);
  const page=Math.max(1,Number(req.nextUrl.searchParams.get('page'))||1);
  const [count]=await pool.execute<any[]>('SELECT COUNT(*) AS total FROM albums WHERE title LIKE ? OR artist_name LIKE ?',[`%${q}%`,`%${q}%`]);
  const [albums]=await pool.query<any[]>(`SELECT ${columns},(SELECT COUNT(*) FROM album_songs als WHERE als.album_id=a.id) AS trackCount FROM albums a WHERE a.title LIKE ? OR a.artist_name LIKE ? ORDER BY a.release_date DESC,a.id DESC LIMIT 50 OFFSET ?`,[`%${q}%`,`%${q}%`,(Math.floor(page)-1)*50]);
  return NextResponse.json({albums,total:Number(count[0].total),page:Math.floor(page)});
}
export async function PUT(req:NextRequest) {
  const denied=requireCms(req);if(denied)return denied;
  const input=await req.json().catch(()=>null), id=Number(input?.id);
  const title=String(input?.title||'').trim(),artistName=String(input?.artistName||'').trim(),artistSlug=String(input?.artistSlug||'').trim(),image=String(input?.image||'').trim(),description=String(input?.description||'').trim(),releaseDate=String(input?.releaseDate||'');
  if(!Number.isSafeInteger(id)||id<1||!title||title.length>300||!artistName||artistName.length>255||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(artistSlug)||description.length>20000||image.length>2000||(image&&!/^https:\/\//.test(image)&&!image.startsWith('/'))||(releaseDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)||isNaN(Date.parse(releaseDate)))))return NextResponse.json({error:'Enter a title, artist name, artist slug, valid date and cover URL'},{status:400});
  const conn=await (await getPool()).getConnection();
  try {
    await conn.beginTransaction();
    const [prior]=await conn.execute<any[]>('SELECT slug,artist_slug,edit_version FROM albums WHERE id=? FOR UPDATE',[id]);
    if(!prior.length){await conn.rollback();return NextResponse.json({error:'Album not found'},{status:404});}
    const conflict=versionConflict(input?.version,Number(prior[0].edit_version));
    if(conflict){await conn.rollback();return conflict;}
    await conn.execute('UPDATE albums SET title=?,artist_name=?,artist_slug=?,image_url=?,release_date=?,description=?,edit_version=edit_version+1 WHERE id=?',[title,artistName,artistSlug,image||null,releaseDate||null,description,id]);
    await conn.commit();clearMemCache(['albums']);revalidateTag('albums');revalidatePath('/albums');revalidatePath(`/albums/${prior[0].slug}`);revalidatePath(`/artists/${prior[0].artist_slug}`);revalidatePath(`/artists/${artistSlug}`);
    return NextResponse.json({id,slug:prior[0].slug});
  }catch{await conn.rollback();return NextResponse.json({error:'Unable to save album'},{status:500});}finally{conn.release();}
}
