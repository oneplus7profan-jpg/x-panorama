import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'release-version.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(version)) {
  throw new Error(`Invalid release version: ${version}`);
}

const appPath = path.join(root, 'app.js');
const appSource = fs.readFileSync(appPath, 'utf8');
const currentMatch = appSource.match(/const APP_VERSION = '([^']+)'/);
if (!currentMatch) throw new Error('APP_VERSION was not found in app.js.');
const currentVersion = currentMatch[1];
const files = ['app.js', 'index.html', 'sw.js', 'image-worker.js'];

for (const relative of files) {
  const target = path.join(root, relative);
  const before = fs.readFileSync(target, 'utf8');
  const after = before.split(currentVersion).join(version);
  fs.writeFileSync(target, after, 'utf8');
  console.log(`${relative}: ${currentVersion} -> ${version}`);
}
