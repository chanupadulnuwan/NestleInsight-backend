const { spawnSync } = require('child_process');
const { existsSync } = require('fs');
const { resolve } = require('path');

const projectRoot = resolve(__dirname, '..');
const compiledScriptPath = resolve(projectRoot, 'dist', 'scripts', 'db-init.js');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!existsSync(compiledScriptPath)) {
  console.log('[db:init] Build output not found. Running npm run build...');

  const buildResult = spawnSync(npmCommand, ['run', 'build'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  if (buildResult.status !== 0) {
    process.exit(buildResult.status ?? 1);
  }
}

const initResult = spawnSync(process.execPath, [compiledScriptPath], {
  cwd: projectRoot,
  stdio: 'inherit',
});

process.exit(initResult.status ?? 1);
