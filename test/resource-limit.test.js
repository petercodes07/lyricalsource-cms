const test = require('node:test');
const assert = require('node:assert/strict');
const { createLimit } = require('../src/resource-limit');
const deferred = () => { let resolve; const promise=new Promise(r=>{resolve=r;}); return {promise,resolve}; };

test('bursts stay within concurrency and queue limits; failures release capacity', async () => {
  const limit=createLimit(2,3,1000), gate=deferred();
  let running=0,peak=0,started=0;
  const requests=Array.from({length:20},(_,id)=>limit(async()=>{
    running++;started++;peak=Math.max(peak,running);
    try { await gate.promise; if(id===1)throw new Error('upstream failed'); return id; }
    finally {running--;}
  }));
  const resultsPromise=Promise.allSettled(requests);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(started,2);
  gate.resolve();
  const results=await resultsPromise;
  assert.equal(peak,2);
  assert.equal(started,5);
  assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===503).length,15);
  assert.equal(await limit(async()=>42),42);
});

test('expired queue entries never run later', async () => {
  const limit=createLimit(1,2,20),gate=deferred();
  const active=limit(()=>gate.promise);
  let ran=false;
  await assert.rejects(limit(async()=>{ran=true;}),{status:503});
  gate.resolve();await active;
  assert.equal(ran,false);
  assert.equal(await limit(async()=>7),7);
});
