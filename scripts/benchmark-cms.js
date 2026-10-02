// Local CMS smoke benchmark. It does not claim production/MySQL capacity.
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'cms-benchmark-'));
  const site = http.createServer((req,res)=>{
    if(!req.url.startsWith('/api/cms/articles?') || !new URL(req.url,'http://localhost').searchParams.has('page')) {res.writeHead(400);return res.end('{}');}
    const articles = Array.from({length:50},(_,id)=>({id:id+1,slug:'story-'+id,title:'Benchmark story '+id,author:'Staff',status:'published',postType:'news',tags:[],updatedAt:'2026-10-01'}));
    setTimeout(()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({articles,counts:{all:10000,published:10000,draft:0},total:10000}));},5);
  });
  await new Promise(r=>site.listen(0,'127.0.0.1',r));
  Object.assign(process.env,{CMS_ENV_FILE:path.join(temp,'unused.env'),CMS_DB_PATH:path.join(temp,'cms.sqlite'),SITE_API_URL:`http://127.0.0.1:${site.address().port}`,SITE_PUBLIC_URL:'https://example.invalid',CMS_API_TOKEN:'benchmark-only',CMS_SUPERUSER_EMAIL:'',CMS_SUPERUSER_PASSWORD:'',CMS_AUTH_PROVIDER:'local'});
  const app=require('../src/app'),{db,hashPassword}=require('../src/store');
  const password=crypto.randomBytes(20).toString('hex'), hash=hashPassword(password);
  for(let id=0;id<20;id++)db.prepare('INSERT INTO users (email,name,username,password_hash,role) VALUES (?,?,?,?,?)').run(`staff${id}@example.invalid`,`Staff ${id}`,`staff${id}`,hash,'editor');
  const cms=app.listen(0,'127.0.0.1');await new Promise(r=>cms.once('listening',r));
  const base=`http://127.0.0.1:${cms.address().port}`;process.env.CMS_BASE_URL=base;
  const loop=monitorEventLoopDelay({resolution:10});loop.enable();
  try {
    const start=performance.now();
    const cookies=await Promise.all(Array.from({length:20},async(_,id)=>{
      const response=await fetch(base+'/login',{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({email:`staff${id}`,password})});
      if(response.status!==302)throw new Error(`Login failed: ${response.status}`);
      return response.headers.get('set-cookie').split(';')[0];
    }));
    const loginMs=Math.round(performance.now()-start),latencies=[];
    for(let round=0;round<5;round++)await Promise.all(cookies.map(async cookie=>{
      const started=performance.now();const response=await fetch(base+'/?page=2',{headers:{cookie}});const html=await response.text();
      if(response.status!==200 || !html.includes('Showing 50 of 10000 articles') || !html.includes('Next'))throw new Error(`List failed: ${response.status}`);
      latencies.push(performance.now()-started);
    }));
    latencies.sort((a,b)=>a-b);
    console.log(JSON.stringify({environment:'local CMS with mock site API',staff:20,catalogRows:10000,requests:100,concurrency:20,loginBatchMs:loginMs,p95ListMs:Math.round(latencies[Math.floor(latencies.length*.95)]),maxEventLoopDelayMs:Math.round(loop.max/1e6),rssMB:Math.round(process.memoryUsage().rss/1024/1024)},null,2));
  } finally {
    loop.disable();await new Promise(r=>cms.close(r));await new Promise(r=>site.close(r));db.close();fs.rmSync(temp,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
