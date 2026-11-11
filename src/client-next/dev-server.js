/**
 * Dev server for the Next.js client.
 *
 * Runs the Next dev server (HMR) on port 3000 and proxies:
 *   - /api/*  (HTTP)  -> Express backend
 *   - /ws     (WS + HTTP) -> Express backend
 *
 * This mirrors the old Vite dev setup (vite proxy: /ws, /api -> 3210),
 * so the browser always talks to a single origin.
 *
 * Usage: npm run dev:client   (runs `node src/client-next/dev-server.js`)
 * Make sure the Express backend is running on BACKEND_PORT (default 3210).
 */
const { createServer } = require('http');
const http = require('http');
const path = require('path');
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
const PORT = Number(process.env.PORT || 3000);
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 3210);
const UPSTREAM = `127.0.0.1:${BACKEND_PORT}`;

const app = next({ dev, dir: __dirname });
const handle = app.getRequestHandler();

/** Proxy an HTTP request to the Express backend. */
function proxyHttp(req, res) {
  const options = {
    host: UPSTREAM.split(':')[0],
    port: Number(UPSTREAM.split(':')[1]),
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: UPSTREAM },
  };
  const upstream = http.request(options, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on('error', (err) => {
    console.error(`[dev-proxy] upstream error for ${req.url}:`, err.message);
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`502 Bad Gateway: ${err.message}`);
  });
  req.pipe(upstream);
}

/** Proxy a WebSocket upgrade to the Express backend. */
function proxyUpgrade(req, socket, head) {
  const options = {
    host: UPSTREAM.split(':')[0],
    port: Number(UPSTREAM.split(':')[1]),
    method: 'GET',
    path: req.url,
    headers: { ...req.headers, host: UPSTREAM },
  };
  const upstream = http.request(options);
  upstream.on('upgrade', (res, upstreamSocket, upstreamHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Accept: ${(res.headers['sec-websocket-accept'] || '').replace(/\r?\n/g, '')}\r\n\r\n`,
    );
    if (upstreamHead && upstreamHead.length) upstreamSocket.unshift(upstreamHead);
    if (head && head.length) upstreamSocket.write(head);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
    socket.on('error', () => upstreamSocket.destroy());
    upstreamSocket.on('error', () => socket.destroy());
  });
  upstream.on('error', (err) => {
    console.error(`[dev-proxy] WS upgrade error:`, err.message);
    socket.destroy();
  });
  upstream.end();
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const url = req.url || '/';
    if (url.startsWith('/api/') || url === '/ws') {
      proxyHttp(req, res);
      return;
    }
    handle(req, res);
  });

  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '/';
    if (url === '/ws' || url.startsWith('/ws?')) {
      proxyUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  server.listen(PORT, (err) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`> Next.js dev server ready on http://localhost:${PORT}`);
    console.log(`> Proxying /api and /ws to http://localhost:${BACKEND_PORT}`);
  });
});
