// Lehrbegleiter-Abrufdienst auf einem eigenen Server (Node.js 18 oder neuer).
// Start:  node server.js     (Werte aus Umgebungsvariablen oder einer Datei .env daneben)
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { handle, CACHE_SECONDS } from './src/index.js';

const envFile = new URL('./.env', import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const env = process.env;
let cached = null;
const cache = {
  async get() { return cached && Date.now() - cached.at < CACHE_SECONDS * 1000 ? cached.data : null; },
  async put(data) { cached = { at: Date.now(), data }; }
};

const port = Number(env.PORT || 8787);
http.createServer(async (req, res) => {
  try {
    const request = new Request(`http://${req.headers.host || 'localhost'}${req.url}`, {
      method: req.method,
      headers: Object.entries(req.headers).filter(([, v]) => typeof v === 'string')
    });
    const response = await handle(request, env, cache);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'server_error' }));
  }
}).listen(port, () => console.log(`Lehrbegleiter-Abrufdienst läuft auf Port ${port}`));
