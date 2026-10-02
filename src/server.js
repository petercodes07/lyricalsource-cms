const app = require('./app');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3100);
const server = app.listen(port, host, () => console.log(`CMS listening on http://${host}:${port}`));
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.keepAliveTimeout = 5000;
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(() => { require('./store').db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 19000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
