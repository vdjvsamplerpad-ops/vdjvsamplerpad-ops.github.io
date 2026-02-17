const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const envPath = path.join(repoRoot, '.env');

function fallbackVersion() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `1.${mm}.${dd}.${yy}.${hh}${min}`;
}

function getCommitBasedVersion() {
  try {
    const stamp = execSync('git log -1 --format=%cd --date=format:%m.%d.%y.%H%M', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (stamp) return `1.${stamp}`;
  } catch {}
  return fallbackVersion();
}

function upsertEnvVariable(rawContent, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(rawContent)) {
    return rawContent.replace(pattern, line);
  }
  const trimmed = rawContent.trimEnd();
  return trimmed.length > 0 ? `${trimmed}\n${line}\n` : `${line}\n`;
}

function main() {
  const version = getCommitBasedVersion();
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const next = upsertEnvVariable(existing, 'VITE_APP_VERSION', version);
  fs.writeFileSync(envPath, next, 'utf8');
  console.log(`[post-commit] Updated .env VITE_APP_VERSION=${version}`);
}

main();
