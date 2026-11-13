// Serve the prototype over HTTPS on this machine and the local network.
// A phone's browser gives a page the microphone only over HTTPS, so this
// makes itself a certificate (kept beside this file, not committed) the first
// time it runs. The phone will warn about it: that is expected.
//
//   pnpm voice-prototype          then open the address it prints
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.VOICE_PROTOTYPE_PORT ?? 8443);
const key = path.join(root, 'engine', 'local-key.pem');
const cert = path.join(root, 'engine', 'local-cert.pem');
const addresses = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);

if (!fs.existsSync(key) || !fs.existsSync(cert)) {
  fs.mkdirSync(path.dirname(key), { recursive: true });
  const names = ['DNS:localhost', 'IP:127.0.0.1', ...addresses.map((a) => `IP:${a}`)].join(',');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-subj', '/CN=voice-prototype', '-addext', `subjectAltName=${names}`, '-keyout', key, '-out', cert], { stdio: 'ignore' });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8', '.wav': 'audio/wav' };

https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'https://x').pathname);
  const file = path.join(root, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(root + path.sep) || /\.pem$/.test(file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end('Not found');
    return;
  }
  // Models and the engine are large and never change under one name.
  const big = /\.(onnx|wasm)$/.test(file);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'Content-Length': fs.statSync(file).size,
    'Cache-Control': big ? 'public, max-age=86400' : 'no-store',
  });
  fs.createReadStream(file).pipe(res);
}).listen(port, '0.0.0.0', () => {
  console.log('Finishes by voice, prototype. Open one of:');
  console.log(`  https://localhost:${port}/`);
  for (const a of addresses) console.log(`  https://${a}:${port}/      (from a phone on the same network)`);
});
