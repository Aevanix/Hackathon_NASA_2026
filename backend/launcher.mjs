import { fork, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);
const configuredHost = process.env.HOST || '127.0.0.1';
const browserHost = ['0.0.0.0', '::', '[::]'].includes(configuredHost) ? '127.0.0.1' : configuredHost;
const appUrl = `http://${browserHost}:${port}`;
const startupTimeoutMs = Number(process.env.ASTRA_STARTUP_TIMEOUT_MS || 30_000);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error('ASTRA could not start: PORT must be an integer from 1 to 65535.');
  process.exit(1);
}

const server = fork(resolve(projectRoot, 'backend/server.mjs'), [], {
  cwd: projectRoot,
  env: process.env,
  execArgv: [],
  stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
});

let serverExit;
const exitResult = new Promise((resolveExit) => {
  server.once('error', (error) => {
    serverExit = { error };
    resolveExit(serverExit);
  });
  server.once('exit', (code, signal) => {
    serverExit = { code, signal };
    resolveExit(serverExit);
  });
});

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
const deadline = Date.now() + startupTimeoutMs;
let ready = false;

server.on('message', (message) => {
  if (message?.type === 'astra.ready' && Number(message.port) === port) ready = true;
});

while (!ready && Date.now() < deadline && !serverExit) {
  await wait(100);
}

if (!ready && serverExit) {
  console.error(serverExit.error
    ? `ASTRA could not start: ${serverExit.error.message}`
    : `ASTRA server stopped during startup${serverExit.code ? ` (exit ${serverExit.code})` : ''}.`);
  process.exitCode = serverExit.code || 1;
}

if (!ready && !serverExit) {
  console.error(`ASTRA did not become ready within ${Math.round(startupTimeoutMs / 1_000)} seconds.`);
  server.kill();
  process.exitCode = 1;
} else if (ready) {
  console.log(`ASTRA is ready at ${appUrl}`);
  if (process.env.ASTRA_OPEN_BROWSER !== 'false' && process.env.CI !== 'true') {
    try {
      if (process.platform === 'win32') {
        await execFileAsync('rundll32.exe', ['url.dll,FileProtocolHandler', appUrl]);
      } else if (process.platform === 'darwin') {
        await execFileAsync('open', [appUrl]);
      } else {
        await execFileAsync('xdg-open', [appUrl]);
      }
      console.log('Opened ASTRA in your default browser. Keep this terminal open while you use it.');
    } catch (error) {
      console.warn(`ASTRA is running, but the browser could not be opened automatically: ${error.message}`);
      console.warn(`Open ${appUrl} in your browser.`);
    }
  }
}

const stopped = await exitResult;
if (stopped.error) {
  console.error(`ASTRA server error: ${stopped.error.message}`);
  process.exitCode = 1;
} else if (stopped.code !== 0) {
  process.exitCode = stopped.code || 1;
}