import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const vite = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const args = process.argv.slice(2);
const preview = args[0] === '--preview';
if (preview) args.shift();
const children = [
  spawn(process.execPath, ['backend/src/server.js'], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, [vite, ...(preview ? ['preview'] : []), ...args], { cwd: join(root, 'frontend'), stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) if (child.exitCode === null) child.kill();
}
for (const child of children) {
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => stop(code || 0));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
