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

// GitHub release asset upload 시 파일명의 공백을 *dot* 으로 자동 변환함.
// 단순 encodeURIComponent (`%20`) 로 만든 URL 은 404 → updater fail.
// (v2.0.1 release 에서 같은 회귀 발생 — Claude%20Widget_... vs 실제 Claude.Widget_...)
const githubAssetName = exeName.replace(/ /g, '.');

const manifest = {
  version: `v${version}`,
  notes: process.env.RELEASE_NOTES ?? 'See release page',
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url: `https://github.com/${REPO}/releases/download/v${version}/${githubAssetName}`,
    },
  },
};

const outDir = path.join('src-tauri', 'target', 'release', 'bundle', 'updater');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'latest.json');
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
console.log(`wrote ${outPath} (${signature.length}-char signature, v${version})`);
