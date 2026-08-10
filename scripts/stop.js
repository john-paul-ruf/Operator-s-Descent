import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PID_FILE = join(ROOT, '.devserver.pid');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

if (!existsSync(PID_FILE)) {
  console.log('Not running (no pid file).');
  process.exit(0);
}

const { pid, url } = JSON.parse(readFileSync(PID_FILE, 'utf8'));
if (!pid || !alive(pid)) {
  rmSync(PID_FILE, { force: true });
  console.log('Not running (stale pid file removed).');
  process.exit(0);
}

try { process.kill(pid, 'SIGTERM'); } catch {}
for (let i = 0; i < 50 && alive(pid); i++) await sleep(100);
if (alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
rmSync(PID_FILE, { force: true });
console.log(`Stopped (pid ${pid})${url ? ` at ${url}` : ''}.`);
