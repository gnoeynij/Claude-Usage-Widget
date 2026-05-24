#!/usr/bin/env node
// Bumps the project version in all 6 source-of-truth files at once. The 5
// lock/manifest files (package.json, package-lock.json, tauri.conf.json,
// Cargo.toml, Cargo.lock, src/state/store.ts) drifting out of sync used to
// require hand-editing each one and caused the installer filename / footer /
// updater manifest to disagree (CLAUDE.md 회귀 사례 §3).
//
// Usage:
//   node scripts/bump-version.mjs 2.1.0
//   node scripts/bump-version.mjs --check       # report current versions only
//
// Refuses to write if the 6 files disagree before the bump — sync them by
// hand first, then re-run.

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const arg = process.argv[2];

if (!arg || (arg !== '--check' && !/^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(arg))) {
  console.error('Usage: node scripts/bump-version.mjs <semver>');
  console.error('   or: node scripts/bump-version.mjs --check');
  process.exit(1);
}

// Each entry: { file, read(text) => current, write(text, next) => newText }.
const targets = [
  {
    file: 'package.json',
    read: (s) => JSON.parse(s).version,
    write: (s, next) => s.replace(/("version":\s*")[\d.\-\w]+(")/, `$1${next}$2`),
  },
  {
    file: 'package-lock.json',
    read: (s) => {
      // Top-level + the embedded "" workspace package.
      const top = JSON.parse(s).version;
      return top;
    },
    write: (s, next) => {
      // Replace both occurrences in the first 12 lines (top-level + ""
      // workspace) without touching dependency versions deeper in the file.
      const lines = s.split('\n');
      for (let i = 0; i < Math.min(12, lines.length); i++) {
        lines[i] = lines[i].replace(/("version":\s*")[\d.\-\w]+(")/, `$1${next}$2`);
      }
      return lines.join('\n');
    },
  },
  {
    file: 'src-tauri/tauri.conf.json',
    read: (s) => JSON.parse(s).version,
    write: (s, next) => s.replace(/("version":\s*")[\d.\-\w]+(")/, `$1${next}$2`),
  },
  {
    file: 'src-tauri/Cargo.toml',
    // Only the [package] section's version at the top — never touch
    // dependency lines further down.
    read: (s) => {
      const m = s.match(/^version = "([\d.\-\w]+)"/m);
      return m ? m[1] : null;
    },
    write: (s, next) => s.replace(/^version = "[\d.\-\w]+"/m, `version = "${next}"`),
  },
  {
    file: 'src-tauri/Cargo.lock',
    // The claude-widget package entry only — many other packages in the lock
    // share the version string and must not be touched. `\r?\n` so this works
    // on both CRLF (Windows) and LF (macOS/Linux) checkouts.
    read: (s) => {
      const m = s.match(/\[\[package\]\]\r?\nname = "claude-widget"\r?\nversion = "([\d.\-\w]+)"/);
      return m ? m[1] : null;
    },
    write: (s, next) =>
      s.replace(
        /(\[\[package\]\]\r?\nname = "claude-widget"\r?\nversion = ")[\d.\-\w]+(")/,
        `$1${next}$2`,
      ),
  },
  {
    file: 'src/state/store.ts',
    read: (s) => {
      const m = s.match(/version:\s*"([\d.\-\w]+)"/);
      return m ? m[1] : null;
    },
    write: (s, next) => s.replace(/(version:\s*")[\d.\-\w]+(")/, `$1${next}$2`),
  },
];

// Read all current versions.
const current = targets.map((t) => {
  const text = fs.readFileSync(path.join(root, t.file), 'utf8');
  return { ...t, text, version: t.read(text) };
});

if (arg === '--check') {
  for (const c of current) {
    console.log(`${c.version ?? '???'}  ${c.file}`);
  }
  const unique = [...new Set(current.map((c) => c.version))];
  if (unique.length === 1 && unique[0]) {
    console.log(`\n✓ all in sync at v${unique[0]}`);
    process.exit(0);
  }
  console.error(`\n✗ versions disagree: ${unique.join(', ')}`);
  process.exit(2);
}

// Bump path — refuse if not in sync.
const unique = [...new Set(current.map((c) => c.version))];
if (unique.length !== 1 || !unique[0]) {
  console.error('Refusing to bump: versions disagree before bump.');
  for (const c of current) {
    console.error(`  ${c.version ?? '???'}  ${c.file}`);
  }
  console.error('Sync them by hand first, then re-run.');
  process.exit(2);
}

const from = unique[0];
const to = arg;

if (from === to) {
  console.log(`Already at v${to}, nothing to do.`);
  process.exit(0);
}

for (const c of current) {
  const next = c.write(c.text, to);
  fs.writeFileSync(path.join(root, c.file), next);
  console.log(`  ${from} → ${to}  ${c.file}`);
}
console.log(`\n✓ bumped 6 files from v${from} to v${to}`);
