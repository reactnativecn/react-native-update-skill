#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANAGER = path.join(ROOT, 'tools/skill-update-manager.mjs');
const TMP = mkdtempSync(path.join(tmpdir(), 'skill-update-manager-test-'));
const SOURCE = path.join(TMP, 'source');
const LOCK = path.join(TMP, 'skills-lock.json');
const INSTALL_PATH = path.join(TMP, 'installed', 'test-skill');

function exec(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function manager(args) {
  return JSON.parse(exec('node', [MANAGER, ...args, '--json']));
}

function git(args) {
  return exec('git', args, { cwd: SOURCE });
}

function writeFixture(relativePath, body, mode) {
  const fullPath = path.join(SOURCE, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, body);
  if (mode) chmodSync(fullPath, mode);
}

function commit(message) {
  git(['add', '.']);
  git(['-c', 'user.name=Skill Test', '-c', 'user.email=skill-test@example.com', 'commit', '--quiet', '-m', message]);
  return git(['rev-parse', 'HEAD']);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeLock(commitHash, hashes = {}) {
  writeFileSync(LOCK, `${JSON.stringify({
    schema: 1,
    skills: [
      {
        name: 'test-skill',
        source: {
          url: SOURCE,
          ref: 'main',
          path: 'skill/test-skill',
        },
        locked: {
          commit: commitHash,
          manifestHash: hashes.manifestHash ?? '',
          scriptsHash: hashes.scriptsHash ?? '',
        },
        policy: {
          pinned: false,
          autoUpdate: 'docs-only',
        },
        installations: [
          {
            agent: 'test',
            path: INSTALL_PATH,
          },
        ],
      },
    ],
  }, null, 2)}\n`);
}

try {
  mkdirSync(SOURCE, { recursive: true });
  exec('git', ['init', '--quiet'], { cwd: SOURCE });
  git(['checkout', '-B', 'main']);

  writeFixture('skill/test-skill/SKILL.md', '---\nname: test-skill\ndescription: test\n---\n\n# Test\n');
  writeFixture('skill/test-skill/references/info.md', 'v1\n');
  writeFixture('skill/test-skill/scripts/tool.sh', '#!/usr/bin/env bash\necho v1\n', 0o755);
  const v1 = commit('v1');
  writeLock(v1);

  let result = manager(['lock', '--lock', LOCK, '--write']).results[0];
  assert(result.status === 'lock-updated', `expected lock-updated, got ${result.status}`);
  let lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  assert(lock.skills[0].locked.manifestHash, 'manifest hash was not recorded');
  assert(lock.skills[0].locked.scriptsHash, 'script hash was not recorded');

  writeFixture('skill/test-skill/references/info.md', 'v2\n');
  const v2 = commit('v2 docs');
  result = manager(['check', '--lock', LOCK]).results[0];
  assert(result.status === 'update-available', `expected docs update available, got ${result.status}`);
  assert(result.changeType === 'content', `expected content change, got ${result.changeType}`);

  result = manager(['update', '--lock', LOCK, '--dry-run']).results[0];
  assert(result.status === 'would-update', `expected would-update, got ${result.status}`);
  result = manager(['update', '--lock', LOCK]).results[0];
  assert(result.status === 'updated', `expected updated, got ${result.status}`);
  lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  assert(lock.skills[0].locked.commit === v2, 'lock did not advance to docs commit');
  assert(existsSync(path.join(INSTALL_PATH, 'SKILL.md')), 'installed skill was not copied');

  writeFixture('README.md', 'root-only change\n');
  const rootOnly = commit('root only');
  result = manager(['check', '--lock', LOCK]).results[0];
  assert(result.status === 'content-up-to-date', `expected content-up-to-date, got ${result.status}`);
  assert(result.changeType === 'none', `expected no skill content change, got ${result.changeType}`);
  result = manager(['update', '--lock', LOCK]).results[0];
  assert(result.status === 'lock-refreshed', `expected lock-refreshed, got ${result.status}`);
  lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  assert(lock.skills[0].locked.commit === rootOnly, 'lock did not refresh to root-only commit');

  writeFixture('skill/test-skill/scripts/tool.sh', '#!/usr/bin/env bash\necho v3\n', 0o755);
  commit('v3 script');
  result = manager(['check', '--lock', LOCK]).results[0];
  assert(result.status === 'update-available', `expected script update available, got ${result.status}`);
  assert(result.changeType === 'scripts', `expected scripts change, got ${result.changeType}`);
  result = manager(['update', '--lock', LOCK, '--dry-run']).results[0];
  assert(result.status === 'blocked-script-change', `expected blocked-script-change, got ${result.status}`);
  result = manager(['update', '--lock', LOCK, '--dry-run', '--allow-scripts']).results[0];
  assert(result.status === 'would-update', `expected allowed script dry run, got ${result.status}`);

  writeLock(v1);
  result = manager(['update', '--lock', LOCK, '--dry-run']).results[0];
  assert(result.status === 'blocked-untrusted-change', `expected blocked-untrusted-change, got ${result.status}`);

  console.log('skill-update-manager tests passed');
} finally {
  if (!process.env.KEEP_SKILL_UPDATE_TEST_TMP) {
    rmSync(TMP, { recursive: true, force: true });
  }
}
