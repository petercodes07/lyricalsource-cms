// Small deployment checks, not a production capacity test. Cleans its private draft.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
process.loadEnvFile('.env.local');
const base=process.env.CMS_VERIFY_SITE_URL||'http://127.0.0.1:3003';
const db=await mysql.createConnection({host:process.env.DB_HOST||'localhost',socketPath:process.env.DB_SOCKET||undefined,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
let fixtureId;
const report={};
async function api(method,route,body) {
  const response=await fetch(`${base}/api/cms/${route}`,{method,headers:{authorization:`Bearer ${process.env.CMS_API_TOKEN}`,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
  return {status:response.status,data:await response.json()};
}
try {
  const input={title:'Private concurrency verification',slug:'cms-check-'+crypto.randomBytes(8).toString('hex'),body:'<p>Temporary private verification fixture.</p>',excerpt:'Temporary test',author:'Verification',postType:'blog',status:'draft',actor:'verification@example.invalid',tags:[]};
  const created=await api('POST','articles',input);assert.equal(created.status,201);fixtureId=created.data.id;
  const opened=await api('GET',`articles/${fixtureId}`);assert.equal(opened.status,200);
  const version=opened.data.article.version;
  const stale=await api('PUT',`articles/${fixtureId}`,input);assert.equal(stale.status,409);
  const concurrent=await Promise.all(['A','B'].map(title=>api('PUT',`articles/${fixtureId}`,{...input,title:`Concurrent ${title}`,version})));
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  const final=await api('GET',`articles/${fixtureId}`);assert.equal(final.data.article.version,version+1);assert.equal(final.data.article.status,'draft');
  report.articleConcurrentSaveStatuses=concurrent.map(r=>r.status);
  report.missingRevisionStatus=stale.status;
  const lists=await Promise.all(['articles','songs','albums','playlists'].map(route=>api('GET',route+'?page=1')));
  for(let i=0;i<lists.length;i++) {assert.equal(lists[i].status,200);const key=['articles','songs','albums','playlists'][i];assert.ok(lists[i].data[key].length<=50);}
  report.listSizes=Object.fromEntries(lists.map((r,i)=>{const key=['articles','songs','albums','playlists'][i];return[key,r.data[key].length];}));
  const song=(await api('GET',`songs/${lists[1].data.songs[0].id}`)).data.song;
  assert.equal((await api('PUT',`songs/${song.id}`,{title:song.title,songName:song.songName,actor:'verification@example.invalid',version:0})).status,409);
  assert.deepEqual((await api('GET',`songs/${song.id}`)).data.song,song);
  const album=(await api('GET',`albums?id=${lists[2].data.albums[0].id}`)).data.album;
  assert.equal((await api('PUT','albums',{...album,version:0})).status,409);
  assert.deepEqual((await api('GET',`albums?id=${album.id}`)).data.album,album);
  const playlist=(await api('GET',`playlists?slug=${encodeURIComponent(lists[3].data.playlists[0].slug)}`)).data.playlist;
  assert.equal((await api('PUT','playlists',{...playlist,songs:playlist.songs.map(song=>song.id),version:0})).status,409);
  assert.deepEqual((await api('GET',`playlists?slug=${encodeURIComponent(playlist.slug)}`)).data.playlist,playlist);
  report.staleRevisionProtection={songs:409,albums:409,playlists:409};
  const filtered=await api('GET',`articles?q=${input.slug}&status=draft`);assert.equal(filtered.data.total,1);assert.equal(filtered.data.articles[0].id,fixtureId);
  const page2=await api('GET','songs?page=2');assert.equal(page2.status,200);assert.ok(!lists[1].data.songs.some(s=>page2.data.songs.some(p=>p.id===s.id)));
  const wildcard=await api('GET','articles?q='+encodeURIComponent('%_'));assert.equal(wildcard.status,200);assert.equal(wildcard.data.total,0);
  report.filteringAndPagination='passed';
  console.log(JSON.stringify(report,null,2));
} finally {
  if(fixtureId) {
    await db.execute('DELETE FROM article_tags WHERE article_id=?',[fixtureId]);
    await db.execute('DELETE FROM cms_audit WHERE article_id=?',[fixtureId]);
    await db.execute('DELETE FROM articles WHERE id=? AND slug LIKE "cms-check-%" AND status="draft"',[fixtureId]);
  }
  await db.end();
}
