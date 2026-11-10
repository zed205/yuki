// Writes dist/version.json with the git tag/commit this build came from,
// so the running server can log "what is this instance actually running?".
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function git(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

const version = git('git describe --tags --always --dirty') || 'unknown';
const commit = git('git rev-parse HEAD') || 'unknown';
const builtAt = new Date().toISOString();

const distDir = path.join(__dirname, '..', 'dist');
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(
  path.join(distDir, 'version.json'),
  JSON.stringify({ version, commit, builtAt }, null, 2),
);
console.log(`version.json written: ${version} (${commit.slice(0, 7)})`);
