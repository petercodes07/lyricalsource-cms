// A finite FIFO queue. A timed-out waiter never starts work later.
function createLimit(concurrency, maxQueue, waitMs = 5000) {
  let active = 0;
  const waiting = [];
  function acquire() {
    if (active < concurrency) { active++; return Promise.resolve(); }
    if (waiting.length >= maxQueue) return Promise.reject(Object.assign(new Error('Workspace is busy. Please try again shortly.'), { status: 503 }));
    return new Promise((resolve, reject) => {
      const entry = { resolve, timer: setTimeout(() => {
        const index = waiting.indexOf(entry);
        if (index !== -1) waiting.splice(index, 1);
        reject(Object.assign(new Error('Workspace is busy. Please try again shortly.'), { status: 503 }));
      }, waitMs) };
      waiting.push(entry);
    });
  }
  function release() {
    const next = waiting.shift();
    if (next) { clearTimeout(next.timer); next.resolve(); } else active--;
  }
  return async fn => { await acquire(); try { return await fn(); } finally { release(); } };
}
module.exports = { createLimit };
