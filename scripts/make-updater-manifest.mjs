#!/usr/bin/env node
// Generates src-tauri/target/release/bundle/updater/latest.json from the
// signed NSIS bundle + .sig produced by `npm run tauri build` with
// createUpdaterArtifacts: true. Tauri CLI does not emit this manifest itself.
//
// Usage:
//   node scripts/make-updater-manifest.mjs
//   RELEASE_NOTES="..." node scripts/make-updater-manifest.mjs

import fs from 'node:fs';
import path from 'node:path';

const REPO = 'gnoeynij/Claude-Usage-Widget';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = pkg.version;

const nsisDir = path.join('src-tauri', 'target', 'release', 'bundle', 'nsis');
const exeName = `Claude Widget_${version}_x64-setup.exe`;
const sigPath = path.join(nsisDir, `${exeName}.sig`);

if (!fs.existsSync(sigPath)) {
  console.error(`signature missing: ${sigPath}`);
  console.error('Run a signed build first (createUpdaterArtifacts + TAURI_SIGNING_PRIVATE_KEY).');
  process.exit(1);
}

const signature = fs.readFileSync(sigPath, 'utf8').trim();

const manifest = {
  version: `v${version}`,
  notes: process.env.RELEASE_NOTES ?? 'See release page',
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url: `https://github.com/${REPO}/releases/download/v${version}/${encodeURIComponent(exeName)}`,
    },
  },
};

const outDir = path.join('src-tauri', 'target', 'release', 'bundle', 'updater');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'latest.json');
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
console.log(`wrote ${outPath} (${signature.length}-char signature, v${version})`);
