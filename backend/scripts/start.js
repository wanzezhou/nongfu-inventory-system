// One-click start (logic in Node for reliability).
// Called by start.bat. Reads DB_PASSWORD / NPM_REGISTRY from env.
const path = require('path');
const fs = require('fs');
const { execSync, spawn, exec } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const BACKEND = path.join(ROOT, 'backend');
const FRONTEND = path.join(ROOT, 'frontend');

const DB_PASSWORD = process.env.DB_PASSWORD || '';
const NPM_REGISTRY = process.env.NPM_REGISTRY || '';

function log(msg) {
  const line = '[start] ' + msg;
  console.log(line);
  try { fs.appendFileSync(path.join(ROOT, 'start.log'), line + '\n'); } catch (e) {}
}

async function main() {
  log('Nongfu Inventory System - one-click start');
  log('Project: ' + ROOT);

  // 1. MySQL check (fast TCP connect via mysql2)
  try {
    const mysql = require(path.join(BACKEND, 'node_modules', 'mysql2', 'promise'));
    const conn = await mysql.createConnection({
      host: 'localhost', port: 3306, user: 'root', password: DB_PASSWORD,
      connectTimeout: 3000
    });
    await conn.end();
    log('MySQL OK (port 3306)');
  } catch (e) {
    log('ERROR: cannot connect MySQL(3306): ' + e.message);
    log('Make sure MySQL is started and root password is correct (set DB_PASSWORD at top of start.bat).');
    process.exit(1);
  }

  // 2. Database init (idempotent)
  try {
    execSync(`node scripts/init_db.js --db-password="${DB_PASSWORD}"`, { cwd: BACKEND, stdio: 'inherit' });
  } catch (e) {
    log('ERROR: database init failed.');
    process.exit(1);
  }

  // 3. Dependencies
  for (const [name, dir] of [['backend', BACKEND], ['frontend', FRONTEND]]) {
    if (!fs.existsSync(path.join(dir, 'node_modules'))) {
      log(name + ' deps missing, installing (first run, a few minutes)...');
      try {
        execSync('npm install' + (NPM_REGISTRY ? ' --registry=' + NPM_REGISTRY : ''), { cwd: dir, stdio: 'inherit' });
      } catch (e) {
        log('ERROR: ' + name + ' deps install failed.');
        process.exit(1);
      }
    } else {
      log(name + ' deps ready');
    }
  }

  // 4. Ensure backend/.env
  if (!fs.existsSync(path.join(BACKEND, '.env'))) {
    fs.copyFileSync(path.join(BACKEND, '.env.example'), path.join(BACKEND, '.env'));
    log('backend/.env created from example. If MySQL password is not empty, edit DB_PASSWORD there.');
  }

  // 5. Start servers as detached background processes (logs to files, PIDs saved)
  log('Starting backend (port 3000, log: backend.log)...');
  const backendOut = fs.openSync(path.join(ROOT, 'backend.log'), 'a');
  const bp = spawn(process.execPath, ['src/app.js'], {
    cwd: BACKEND, detached: true, stdio: ['ignore', backendOut, backendOut]
  });
  bp.unref();
  fs.writeFileSync(path.join(ROOT, 'backend.pid'), String(bp.pid));

  log('Starting frontend (port 5173, log: frontend.log)...');
  const frontendOut = fs.openSync(path.join(ROOT, 'frontend.log'), 'a');
  const fp = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], {
    cwd: FRONTEND, detached: true, stdio: ['ignore', frontendOut, frontendOut]
  });
  fp.unref();
  fs.writeFileSync(path.join(ROOT, 'frontend.pid'), String(fp.pid));

  log('Waiting for services, opening browser...');
  await new Promise((r) => setTimeout(r, 6000));
  exec('start http://localhost:5173/');
  log('DONE. Frontend: http://localhost:5173  Backend: http://localhost:3000');
  log('To stop services: run stop.bat, or close them in Task Manager.');
}

main().catch((e) => {
  log('FATAL: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
