const fs = require('fs');
const path = require('path');

function removeDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const srcPath = path.join(src, f);
    const destPath = path.join(dest, f);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Copy legacy client (kept for any remaining static assets)
removeDir('dist/client');
copyDir('src/client', 'dist/client');
console.log('Legacy client files copied to dist/client');

// Vite build already outputs directly to dist/client-v2/ (from vite.config.ts outDir)
// No copy needed — just ensure the directory exists.
// This file is kept for legacy client only.
