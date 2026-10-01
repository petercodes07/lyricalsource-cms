const app = require('./app');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3100);
app.listen(port, host, () => console.log(`CMS listening on http://${host}:${port}`));
