#!/usr/bin/env node
/**
 * Local verification collector for the DSH "spider" sidebar plugin.
 *
 * The plugin bundle (running inside the real DSH Web GUI page) POSTs JSON
 * diagnostics here. Canvas snapshots arrive as PNG data URLs and are written
 * to disk so the build can be verified visually without authenticating to the
 * GUI ourselves.
 *
 * Usage: node collector.mjs [port]
 *   GET  /health          -> { ok: true, reports: n }
 *   POST /report          -> JSON body; saved to <out>/reports.jsonl
 *                            { kind, ... } ; if `png` is a data:image/png URL
 *                            it is decoded to <out>/shots/<ts>-<kind>.png
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'diag');
const SHOTS = path.join(OUT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const port = Number(process.argv[2] || 4780);
let reports = 0;

function savePng(kind, dataUrl) {
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safe = String(kind || 'shot').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
  const file = path.join(SHOTS, `${stamp}-${safe}.png`);
  fs.writeFileSync(file, buf);
  return file;
}

const server = http.createServer((req, res) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, reports }));
  }
  if (req.method === 'POST' && req.url === '/report') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 8 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const pngFile = typeof parsed.png === 'string' ? savePng(parsed.kind, parsed.png) : null;
        if (pngFile) {
          parsed.png = `<saved:${path.basename(pngFile)}>`;
          parsed.pngFile = pngFile;
        }
        reports += 1;
        fs.appendFileSync(
          path.join(OUT, 'reports.jsonl'),
          JSON.stringify({ at: new Date().toISOString(), ...parsed }) + '\n',
        );
        console.log(
          `[collector] #${reports} kind=${parsed.kind} events=${parsed.events ?? '-'} ` +
            `bytes=${body.length}${pngFile ? ' png=' + pngFile : ''}`,
        );
        res.writeHead(200, { ...cors, 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, png: pngFile ? path.basename(pngFile) : null }));
      } catch (err) {
        console.error('[collector] bad report:', err.message);
        res.writeHead(400, { ...cors, 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
      }
    });
    return;
  }
  res.writeHead(404, cors);
  res.end('not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[collector] listening on http://127.0.0.1:${port}  (out=${OUT})`);
});
