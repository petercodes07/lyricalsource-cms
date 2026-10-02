import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { requireCms } from '@/lib/cms-api';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const denied = requireCms(req); if (denied) return denied;
  const q = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, 200);
  const pool = await getPool();
  if (req.nextUrl.searchParams.has('ids')) {
    const ids = (req.nextUrl.searchParams.get('ids') || '').split(',').map(Number);
    if (ids.length > 500 || ids.some(id=>!Number.isSafeInteger(id)||id<1)) return NextResponse.json({error:'Invalid songs'},{status:400});
    const [songs] = await pool.query<any[]>('SELECT id,slug,title,song_name AS songName,artist_name AS artistName FROM songs WHERE id IN (?)',[ids]);
    return NextResponse.json({songs});
  }
  const page = Math.min(100000,Math.max(1,Math.floor(Number(req.nextUrl.searchParams.get('page'))||1)));
  const [counts] = await pool.query<any[]>('SELECT COUNT(*) AS total FROM songs WHERE title LIKE ? OR song_name LIKE ? OR artist_name LIKE ?',[`%${q}%`,`%${q}%`,`%${q}%`]);
  const [songs] = await pool.query<any[]>(
    'SELECT id,slug,title,song_name AS songName,artist_name AS artistName FROM songs WHERE title LIKE ? OR song_name LIKE ? OR artist_name LIKE ? ORDER BY published_at DESC,id DESC LIMIT 50 OFFSET ?', [`%${q}%`,`%${q}%`,`%${q}%`,(page-1)*50]
  );
  return NextResponse.json({songs,total:Number(counts[0].total),page});
}
