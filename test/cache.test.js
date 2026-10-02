const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {stripTypeScriptTypes}=require('node:module');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};

test('cache coalesces misses, invalidates dependencies and cannot resurrect stale data',async()=>{
  const source=stripTypeScriptTypes(fs.readFileSync(require.resolve('../site-integration/lib/mem-cache.ts'),'utf8'));
  const {memCache,clearMemCache}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  let calls=0;const gate=deferred();
  const loader=async()=>{calls++;await gate.promise;return 'old';};
  const burst=Array.from({length:20},()=>memCache('article',10000,loader,['articles']));
  await new Promise(r=>setImmediate(r));assert.equal(calls,1);
  await memCache('song',10000,async()=>'catalog',['songs']);
  clearMemCache(['articles']);
  assert.equal(await memCache('article',10000,async()=>'new',['articles']),'new');
  gate.resolve();await Promise.all(burst);
  assert.equal(await memCache('article',10000,async()=>'wrong',['articles']),'new');
  assert.equal(await memCache('song',10000,async()=>'wrong',['songs']),'catalog');
  for(let id=0;id<501;id++)await memCache('key'+id,10000,async()=>id);
  let evicted=false;await memCache('song',10000,async()=>{evicted=true;return 'reload';},['songs']);
  assert.ok(evicted,'least recently used records are evicted at the finite cache size');
  let largeLoads=0;
  for(let i=0;i<2;i++) await memCache('large',10000,async()=>{largeLoads++;return 'x'.repeat(1024*1024);});
  assert.equal(largeLoads,2,'oversized results bypass the memory cache');
  await assert.rejects(memCache('failure',10000,async()=>{throw new Error('database busy');}));
  assert.equal(await memCache('failure',10000,async()=>'recovered'),'recovered');
});
