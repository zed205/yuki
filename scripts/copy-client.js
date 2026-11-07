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

// Copy legacy client-v2 (from src/client-v2/dist/) for backward compatibility
// The Vite build now outputs directly to dist/client-v2/ in production mode,
// so we only need this for development builds or when output path differs.
const clientV2Src = path.join(__dirname, '..', 'src', 'client-v2', 'dist');
if (fs.existsSync(clientV2Src) && fs.readdirSync(clientV2Src).length > 0) {
  removeDir('dist/client-v2');
  copyDir(clientV2Src, 'dist/client-v2');
  console.log('Client-v2 build output copied to dist/client-v2');
}
