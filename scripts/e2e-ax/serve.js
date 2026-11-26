// Minimal static server for the AX e2e test page. Usage: node serve.js [port]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.argv[2]) || 3999;
const dir = __dirname;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' };

http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(dir, urlPath === '/' ? 'editor.html' : urlPath);
  // prevent path traversal
  if (!file.startsWith(dir)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => {
  console.log('AX e2e static server on http://127.0.0.1:' + port + '/');
});