#!/usr/bin/env node
/* Tiny static server that mimics Vercel for a built dist/: applies the "headers" and the SPA rewrite from vercel.json.
   Used to prove the CSP does not break the app.   Usage: node scripts/serve-with-headers.mjs [dist-dir] [port]  */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? process.env.PORT ?? 4173);
const cfg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vercel.json'), 'utf8'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.txt': 'text/plain', '.woff2': 'font/woff2' };
const rules = (cfg.headers ?? []).map((h) => ({ re: new RegExp('^' + h.source + '$'), headers: h.headers }));
const rewrites = (cfg.rewrites ?? []).map((r) => ({ re: new RegExp('^' + r.source + '$'), to: r.destination }));

http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(root, pathname);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  let urlPath = pathname;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const rw = rewrites.find((r) => r.re.test(pathname));
    if (rw && !pathname.startsWith('/assets/')) { file = path.join(root, rw.to); urlPath = rw.to; } else { res.writeHead(404).end('not found'); return; }
  }
  const h = { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' };
  for (const r of rules) if (r.re.test(pathname)) for (const { key, value } of r.headers) h[key] = value;
  res.writeHead(200, h);
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port} (urlPath rewrite via vercel.json)`));
