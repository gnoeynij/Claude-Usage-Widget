#!/usr/bin/env node
// Generates src-tauri/target/release/bundle/updater/latest.json from the
// signed bundles produced by `npm run tauri build` with
// createUpdaterArtifacts: true. Tauri CLI does not emit this manifest itself.
//
// Detects Windows (NSIS) + macOS (universal .app.tar.gz) artifacts based on
// which signature files exist on disk — run it from whichever OS just built,
// or after both OS bundles have been collected into the target tree.
//
// Usage:
//   node scripts/make-updater-manifest.mjs
//   RELEASE_NOTES="..." node scripts/make-updater-manifest.mjs

import fs from 'node:fs';
import path from 'node:path';

const REPO = 'gnoeynij/Claude-Usage-Widget';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = pkg.version;

// GitHub release asset upload 시 파일명의 공백을 *dot* 으로 자동 변환함
// (예: "Claude Widget_..." → "Claude.Widget_..."). encodeURIComponent 의
// %20 URL 은 그 실제 경로와 mismatch → 404. v2.0.1 release 에서 발생한
// 회귀 (commit 8ff720b). 본 함수에서 모든 OS asset URL 에 일괄 적용.
const releaseBase = (assetName) =>
  `https://github.com/${REPO}/releases/download/v${version}/${encodeURIComponent(assetName.replace(/ /g, '.'))}`;

const platforms = {};

// Windows NSIS
{
  const exeName = `Claude Widget_${version}_x64-setup.exe`;
  const sigPath = path.join('src-tauri', 'target', 'release', 'bundle', 'nsis', `${exeName}.sig`);
  if (fs.existsSync(sigPath)) {
    platforms['windows-x86_64'] = {
      signature: fs.readFileSync(sigPath, 'utf8').trim(),
      url: releaseBase(exeName),
    };
  }
}

// macOS — Tauri emits `<productName>.app.tar.gz` for the updater. The base
// path differs depending on whether the build was native (current arch only)
// or universal (`--target universal-apple-darwin`). Try both.
{
  const appTarName = `Claude Widget.app.tar.gz`;
  const candidates = [
    path.join('src-tauri', 'target', 'universal-apple-darwin', 'release', 'bundle', 'macos', appTarName),
    path.join('src-tauri', 'target', 'aarch64-apple-darwin', 'release', 'bundle', 'macos', appTarName),
    path.join('src-tauri', 'target', 'x86_64-apple-darwin', 'release', 'bundle', 'macos', appTarName),
    path.join('src-tauri', 'target', 'release', 'bundle', 'macos', appTarName),
  ];
  for (const tarPath of candidates) {
    const sigPath = `${tarPath}.sig`;
    if (fs.existsSync(sigPath)) {
      // Use a release-friendly asset name that survives gh release upload.
      const assetName = `Claude Widget_${version}_universal.app.tar.gz`;
      const signature = fs.readFileSync(sigPath, 'utf8').trim();
      const entry = { signature, url: releaseBase(assetName) };
      // Both arch keys point to the same universal tarball — tauri-plugin-updater
      // matches on the user's arch but the file content covers both.
      platforms['darwin-aarch64'] = entry;
      platforms['darwin-x86_64'] = entry;
      break;
    }
  }
}

if (Object.keys(platforms).length === 0) {
  console.error('no platform artifacts found. Run a signed build first.');
  console.error('  Windows: createUpdaterArtifacts + TAURI_SIGNING_PRIVATE_KEY → NSIS .sig');
  console.error('  macOS:   createUpdaterArtifacts + TAURI_SIGNING_PRIVATE_KEY → .app.tar.gz.sig');
  process.exit(1);
}

const manifest = {
  version: `v${version}`,
  notes: process.env.RELEASE_NOTES ?? 'See release page',
  pub_date: new Date().toISOString(),
  platforms,
};

const outDir = path.join('src-tauri', 'target', 'release', 'bundle', 'updater');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'latest.json');
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
console.log(`wrote ${outPath} — platforms: ${Object.keys(platforms).join(', ')} (v${version})`);
