import { spawn } from 'node:child_process';
import { openSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PID_FILE = join(ROOT, '.devserver.pid');
const LOG_FILE = join(ROOT, '.devserver.log');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 8080;

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

if (existsSync(PID_FILE)) {
  const rec = JSON.parse(readFileSync(PID_FILE, 'utf8'));
  if (rec.pid && alive(rec.pid)) {
    console.log(`Already running (pid ${rec.pid}) at ${rec.url}`);
    process.exit(0);
  }
}

const log = openSync(LOG_FILE, 'a');
const child = spawn(process.execPath, [join(HERE, 'server.js')], {
  detached: true,
  stdio: ['ignore', log, log],
  env: { ...process.env, HOST, PORT: String(PORT) },
});
child.unref();

const url = `http://${HOST}:${PORT}/`;
writeFileSync(PID_FILE, JSON.stringify({ pid: child.pid, host: HOST, port: PORT, url }));
console.log(`Started (pid ${child.pid}) at ${url}`);
console.log(`Logs: ${LOG_FILE} — stop with: npm stop`);
