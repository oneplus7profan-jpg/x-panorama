import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const pass = (message) => console.log(`PASS ${message}`);
const fail = (message) => failures.push(message);
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const { version } = JSON.parse(read('release-version.json'));
const versionPattern = /\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?\b/g;

const appVersionMatch = read('app.js').match(/const APP_VERSION = '([^']+)'/);
if (!appVersionMatch || appVersionMatch[1] !== version) fail(`app.js APP_VERSION must equal ${version}`);
else pass('app.js APP_VERSION definition');
const swVersionMatch = read('sw.js').match(/const APP_VERSION = '([^']+)'/);
if (!swVersionMatch || swVersionMatch[1] !== version) fail(`sw.js APP_VERSION must equal ${version}`);
else pass('sw.js APP_VERSION definition');
if (!/const CACHE_NAME = `\$\{CACHE_PREFIX\}\$\{APP_VERSION\}`;/.test(read('sw.js'))) {
  fail('sw.js CACHE_NAME must be derived from CACHE_PREFIX and APP_VERSION');
} else {
  pass('Service Worker cache name derives from APP_VERSION');
}

const versionedFiles = ['app.js', 'index.html', 'sw.js', 'image-worker.js'];
for (const relative of versionedFiles) {
  const found = [...new Set(read(relative).match(versionPattern) || [])];
  if (!found.length || found.some((item) => item !== version)) {
    fail(`${relative}: expected only ${version}, found ${found.join(', ') || 'none'}`);
  } else {
    pass(`${relative} version ${version}`);
  }
}

const swSource = read('sw.js');
const shellMatch = swSource.match(/const APP_SHELL = \[([\s\S]*?)\];/);
if (!shellMatch) {
  fail('sw.js: APP_SHELL was not found');
} else {
  const entries = [...shellMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const expected = [
    'app.js', 'core.js', 'diagnostics.js', 'icons/icon-192.png', 'icons/icon-512.png',
    'image-worker.js', 'index.html', 'manifest.webmanifest', 'styles.css', 'zip.js'
  ];
  const resolved = entries.map((entry) => entry.replace(/^\.\//, '').split('?')[0]);
  const duplicates = [...new Set(resolved.filter((entry, index) => resolved.indexOf(entry) !== index))];
  const missingFiles = resolved.filter((entry) => !fs.existsSync(path.join(root, entry)));
  const missingEntries = expected.filter((entry) => !resolved.includes(entry));
  const unexpectedEntries = resolved.filter((entry) => !expected.includes(entry));
  if (missingFiles.length) fail(`APP_SHELL missing files: ${missingFiles.join(', ')}`);
  if (duplicates.length) fail(`APP_SHELL duplicate entries: ${duplicates.join(', ')}`);
  if (missingEntries.length) fail(`APP_SHELL missing entries: ${missingEntries.join(', ')}`);
  if (unexpectedEntries.length) fail(`APP_SHELL unexpected entries: ${unexpectedEntries.join(', ')}`);
  for (const entry of entries.filter((item) => item.includes('?v='))) {
    if (!entry.endsWith(`?v=${version}`)) fail(`APP_SHELL stale version: ${entry}`);
  }
  const queryRequired = resolved.filter((entry) => /\.(?:js|css|webmanifest)$/.test(entry));
  const unversioned = queryRequired.filter((entry) => !entries.some((item) => item.replace(/^\.\//, '').startsWith(`${entry}?v=${version}`)));
  if (unversioned.length) fail(`APP_SHELL unversioned assets: ${unversioned.join(', ')}`);
  if (!missingFiles.length && !duplicates.length && !missingEntries.length && !unexpectedEntries.length && !unversioned.length) {
    pass('APP_SHELL files, uniqueness, versions and allowlist');
  }
}

function collectJavaScript(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScript(target);
    return /\.(?:js|mjs|cjs)$/.test(entry.name) ? [target] : [];
  });
}
for (const target of collectJavaScript(root)) {
  const result = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
  if (result.status !== 0) fail(`${path.relative(root, target)} syntax: ${(result.stderr || result.stdout).trim()}`);
}
if (!failures.some((item) => item.includes('syntax:'))) pass('JavaScript syntax');

const html = read('index.html');
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicates.length) fail(`duplicate IDs: ${duplicates.join(', ')}`);
else pass('unique HTML IDs');
const idSet = new Set(ids);
const references = [
  ...[...html.matchAll(/<label\b[^>]*\sfor="([^"]+)"/g)].map((match) => ['label for', match[1]]),
  ...[...html.matchAll(/\s(aria-controls|aria-describedby|aria-labelledby|aria-owns|aria-details)="([^"]+)"/g)]
    .flatMap((match) => match[2].trim().split(/\s+/).map((id) => [match[1], id]))
];
const missingReferences = references.filter(([, id]) => !idSet.has(id));
if (missingReferences.length) fail(`missing HTML references: ${missingReferences.map(([kind, id]) => `${kind}=${id}`).join(', ')}`);
else pass('label and ARIA references');

if (failures.length) {
  for (const message of failures) console.error(`FAIL ${message}`);
  process.exitCode = 1;
} else {
  console.log(`Release verification complete: ${version}`);
}
