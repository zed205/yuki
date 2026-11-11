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

// Copy legacy client (kept for fallback static assets)
removeDir('dist/client');
copyDir('src/client', 'dist/client');
console.log('Legacy client files copied to dist/client');

// Stage the Next.js production build so the Express server can serve it
// via the next() handler (dist/client-next = .next build + config).
const nextSrc = path.join('src', 'client-next');
const nextBuild = path.join(nextSrc, '.next');
const nextDest = path.join('dist', 'client-next');
if (fs.existsSync(path.join(nextBuild, 'BUILD_ID'))) {
  removeDir(nextDest);
  fs.mkdirSync(nextDest, { recursive: true });
  copyDir(nextBuild, path.join(nextDest, '.next'));
  // Minimal runtime config (the .next build already contains what it needs;
  // this keeps the next() handler happy in the pruned deploy layout).
  fs.writeFileSync(
    path.join(nextDest, 'next.config.js'),
    "module.exports = {};\n",
  );
  console.log('Next.js build staged to dist/client-next');
} else {
  console.warn('WARNING: src/client-next/.next/BUILD_ID not found — skip staging Next.js build');
}
