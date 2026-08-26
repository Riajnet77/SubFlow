const fs = require('fs');
if (fs.existsSync('ffmpeg-linux')) {
  fs.copyFileSync('ffmpeg-linux', 'dist/ffmpeg-linux');
  fs.chmodSync('dist/ffmpeg-linux', 0o755);
  console.log('ffmpeg copied OK');
} else {
  console.log('ffmpeg-linux not found in repo root, skipping copy (will fall back to npm ffmpeg at runtime)');
}
