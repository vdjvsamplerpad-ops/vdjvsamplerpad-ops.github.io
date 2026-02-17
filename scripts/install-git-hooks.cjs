const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

function main() {
  const hooksDir = path.join(repoRoot, '.githooks');
  if (!fs.existsSync(hooksDir)) {
    console.error('[hooks:install] .githooks directory is missing.');
    process.exit(1);
  }

  try {
    execSync('git config core.hooksPath .githooks', {
      cwd: repoRoot,
      stdio: 'inherit'
    });
    console.log('[hooks:install] core.hooksPath set to .githooks');
  } catch (error) {
    console.error('[hooks:install] Failed to configure Git hooks path.', error);
    process.exit(1);
  }
}

main();
