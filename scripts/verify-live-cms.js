// Brief authenticated smoke probe. Only its temporary session is written and removed.
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const Database=require('better-sqlite3');
require('dotenv').config({path:process.env.CMS_ENV_FILE||'.env.local',quiet:true});
(async()=>{
  const base=(process.argv[2]||'https://lyricalsourcecom.dbm.shared-servers.com/cms').replace(/\/$/,'');
  const db=new Database(process.env.CMS_DB_PATH||'data/cms.sqlite',{fileMustExist:true});
  const user=db.prepare("SELECT id FROM users WHERE active=1 AND role='superuser' LIMIT 1").get();
  if(!user)throw new Error('Active superuser required for the probe');
  const token=crypto.randomBytes(32).toString('hex'),hash=crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').run(hash,user.id,Date.now()+300000);
  const routes=['','/songs','/albums','/playlists','/team','/account'];
  const times=[];
  try {
    for(let round=0;round<6;round++) await Promise.all(Array.from({length:4},async(_,i)=>{
      const route=routes[(round*4+i)%routes.length],start=performance.now();
      const response=await fetch(base+route,{headers:{cookie:`cms_session=${token}`},redirect:'manual',signal:AbortSignal.timeout(15000)});
      const html=await response.text();
      if(response.status!==200 || /Site connection failed|Albums unavailable|Playlists unavailable|Song connection unavailable/.test(html))throw new Error(`CMS probe failed ${route}: ${response.status}`);
      if(!html.includes('Profile options for'))throw new Error('Authenticated profile missing');
      if(['/songs','/albums'].includes(route) && (html.match(/<tr>/g)||[]).length>51)throw new Error('List was not bounded');
      times.push(performance.now()-start);
    }));
    const heartbeat=await fetch(base+'/editing/articles/2147483647',{method:'POST',headers:{cookie:`cms_session=${token}`},signal:AbortSignal.timeout(5000)});
    if(heartbeat.status!==200)throw new Error('Browser heartbeat failed');
    await heartbeat.json();
    await fetch(base+'/editing/articles/2147483647',{method:'POST',headers:{cookie:`cms_session=${token}`},body:new URLSearchParams({leave:'1'}),signal:AbortSignal.timeout(5000)});
    times.sort((a,b)=>a-b);
    console.log(JSON.stringify({environment:base.startsWith('https:')?'deployed HTTPS CMS':'deployed loopback HTTP CMS',requests:times.length,concurrency:4,passed:times.length,heartbeat:'passed',p95Ms:Math.round(times[Math.floor(times.length*.95)]),maxMs:Math.round(times.at(-1))},null,2));
  } finally {db.prepare('DELETE FROM edit_presence WHERE user_id=? AND resource=?').run(user.id,'articles/2147483647');db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash);db.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
