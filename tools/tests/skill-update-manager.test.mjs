import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { fingerprint, replaceInstallations } from '../skill-update-manager.mjs';
const MANAGER = fileURLToPath(new URL('../skill-update-manager.mjs', import.meta.url));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'skill-manager-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const skill = path.join(source, 'skill/test');
  const target = path.join(root, 'installed/test');
  const lockPath = path.join(root, 'skills-lock.json');
  fs.mkdirSync(skill, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet'); git('checkout', '-B', 'main');
  const write = (name, body) => { const file = path.join(skill, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };
  const commit = () => { git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture'); return git('rev-parse', 'HEAD'); };
  write('SKILL.md', '# Test\n'); write('references/info.md', 'v1\n'); write('scripts/tool.sh', '#!/bin/sh\necho v1\n');
  fs.chmodSync(path.join(skill, 'scripts/tool.sh'), 0o755);
  const v1 = commit();
  const save = (lock) => fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  const read = () => JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  save({ schema: 1, skills: [{ name: 'test', source: { url: source, ref: 'main', path: 'skill/test' }, locked: { commit: v1 }, policy: { autoUpdate: 'docs-only' }, installations: [{ path: target }] }] });
  const raw = (command, ...args) => spawnSync(process.execPath, [MANAGER, command, '--lock', lockPath, '--json', ...args], { encoding: 'utf8' });
  const run = (command, ...args) => { const r = raw(command, ...args); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout).results[0]; };
  const install = () => { run('lock', '--write'); return run('update'); };
  return { root, source, skill, target, lockPath, write, commit, save, read, raw, run, install };
}

test('lock-first bootstrap verifies disk and installs at the same commit', (t) => {
  const f = fixture(t);
  assert.equal(f.run('lock', '--write').status, 'lock-updated');
  assert.equal(f.read().skills[0].installations[0].installed, undefined);
  assert.equal(fs.existsSync(f.target), false);
  assert.equal(f.run('check').status, 'update-available');
  assert.equal(f.raw('check', '--fail-on-update').status, 2);
  assert.equal(f.run('update').status, 'updated');
  assert.equal(fingerprint(f.target).manifestHash, fingerprint(f.skill).manifestHash);
  assert.equal(f.read().skills[0].installations[0].installed.commit, f.read().skills[0].locked.commit);
  assert.equal(f.run('check').status, 'up-to-date');
});

test('refreshing the review lock does not falsely upgrade a stale installation', (t) => {
  const f = fixture(t); f.install();
  const previous = f.read().skills[0].installations[0].installed.commit;
  f.write('references/info.md', 'v2\n'); f.commit(); f.run('lock', '--write');
  assert.equal(f.read().skills[0].installations[0].installed.commit, previous);
  assert.equal(f.run('check').installations[0].state, 'mismatched');
  assert.equal(f.run('update').status, 'updated');
  assert.equal(fs.readFileSync(path.join(f.target, 'references/info.md'), 'utf8'), 'v2\n');
});

test('deleted and locally modified installations are repaired at an unchanged commit', (t) => {
  const f = fixture(t); f.install();
  fs.rmSync(f.target, { recursive: true });
  assert.equal(f.run('check').installations[0].state, 'missing');
  assert.equal(f.run('update').status, 'updated');
  fs.writeFileSync(path.join(f.target, 'SKILL.md'), 'local drift');
  assert.equal(f.run('update').status, 'updated');
  assert.equal(fs.readFileSync(path.join(f.target, 'SKILL.md'), 'utf8'), '# Test\n');
});

test('docs-only updates preserve script-review policy', (t) => {
  const f = fixture(t); f.install();
  f.write('references/info.md', 'v2'); f.commit();
  assert.equal(f.run('check').changeType, 'content');
  assert.equal(f.run('update').status, 'updated');
  f.write('scripts/tool.sh', '#!/bin/sh\necho v3\n'); f.commit();
  assert.equal(f.run('update').status, 'blocked-script-change');
  assert.equal(f.run('update', '--allow-scripts').status, 'updated');
});

test('uninitialized hashes remain blocked, including at an identical commit', (t) => {
  const f = fixture(t);
  assert.equal(f.run('update').status, 'blocked-untrusted-change');
  assert.equal(fs.existsSync(f.target), false);
  assert.equal(f.run('update', '--allow-scripts').status, 'updated');
});

test('dry-run never changes the lock, directories, or installed metadata', (t) => {
  const f = fixture(t); f.run('lock', '--write');
  const before = fs.readFileSync(f.lockPath, 'utf8');
  assert.equal(f.run('update', '--dry-run').status, 'would-update');
  assert.equal(fs.readFileSync(f.lockPath, 'utf8'), before);
  assert.equal(fs.existsSync(path.dirname(f.target)), false);
});

test('root-only upstream changes refresh the lock only when installations match', (t) => {
  const f = fixture(t); f.install();
  fs.writeFileSync(path.join(f.source, 'README.md'), 'root-only'); f.commit();
  assert.equal(f.run('check').status, 'content-up-to-date');
  assert.equal(f.run('update').status, 'lock-refreshed');
  fs.rmSync(f.target, { recursive: true });
  assert.equal(f.run('update').status, 'updated');
});

test('pinned skills do not fetch or install, and no installations is not up-to-date', (t) => {
  const f = fixture(t); const lock = f.read();
  lock.skills[0].policy.pinned = true; lock.skills[0].source.url = '/nonexistent'; f.save(lock);
  assert.equal(f.run('update').status, 'pinned');
  lock.skills[0].policy.pinned = false; lock.skills[0].source.url = f.source; lock.skills[0].installations = []; f.save(lock);
  assert.equal(f.run('check').status, 'no-installations');
  assert.equal(f.raw('check', '--fail-on-update').status, 2);
});

test('all configured installation paths are checked and populated', (t) => {
  const f = fixture(t); f.install(); const lock = f.read();
  const second = path.join(f.root, 'another host/test');
  lock.skills[0].installations.push({ path: second }); f.save(lock);
  const check = f.run('check');
  assert.deepEqual(check.installations.map((i) => i.state), ['matching', 'missing']);
  assert.equal(f.run('update').status, 'updated');
  assert.equal(fingerprint(second).manifestHash, fingerprint(f.target).manifestHash);
});

for (const failure of ['partial-copy', 'corrupt-stage', 'second-switch', 'first-switch']) {
  test(`${failure} leaves every previous installation intact`, (t) => {
    const f = fixture(t); f.install();
    const second = path.join(f.root, 'second'); fs.cpSync(f.target, second, { recursive: true });
    const before = fingerprint(f.target).manifestHash;
    f.write('SKILL.md', '# New\n');
    let copies = 0, switches = 0;
    const io = { ...fs,
      cpSync(...args) {
        copies += 1;
        if (failure === 'partial-copy' && copies === 2) { fs.writeFileSync(path.join(args[1], 'partial'), 'partial'); throw new Error('injected copy failure'); }
        fs.cpSync(...args);
        if (failure === 'corrupt-stage' && copies === 2) fs.writeFileSync(path.join(args[1], 'SKILL.md'), 'corrupt');
      },
      renameSync(from, to) {
        if (path.basename(from).startsWith('.skill-update-stage-')) {
          switches += 1;
          if ((failure === 'second-switch' && switches === 2) || (failure === 'first-switch' && switches === 1)) throw new Error('injected switch failure');
        }
        fs.renameSync(from, to);
      },
    };
    assert.throws(() => replaceInstallations(f.skill, [f.target, second], { io }), /injected|verification/);
    assert.equal(fingerprint(f.target).manifestHash, before);
    assert.equal(fingerprint(second).manifestHash, before);
    assert.equal(fs.readdirSync(path.dirname(f.target)).some((n) => n.startsWith('.skill-update-stage-')), false);
    assert.equal(fs.readdirSync(f.root).some((n) => n.startsWith('.skill-update-stage-')), false);
  });
}

test('failed later installation removes newly installed targets that had no previous copy', (t) => {
  const f = fixture(t); const second = path.join(f.root, 'second');
  const io = { ...fs, renameSync(from, to) { if (to === second) throw new Error('injected'); fs.renameSync(from, to); } };
  assert.throws(() => replaceInstallations(f.skill, [f.target, second], { io }), /injected/);
  assert.equal(fs.existsSync(f.target), false); assert.equal(fs.existsSync(second), false);
});

test('rollback failures preserve the backup and identify its recovery path', (t) => {
  const f = fixture(t); f.install();
  const before = fingerprint(f.target).manifestHash;
  const io = { ...fs, renameSync(from, to) {
    if (path.basename(from).startsWith('.skill-update-stage-') || path.basename(from) === 'previous') throw new Error('injected rename');
    fs.renameSync(from, to);
  } };
  assert.throws(() => replaceInstallations(f.skill, [f.target], { io }), /rollback incomplete:.*previous copy:/);
  const root = path.join(path.dirname(f.target), '.skill-update-backups');
  const previous = path.join(root, fs.readdirSync(root)[0], 'previous');
  assert.equal(fingerprint(previous).manifestHash, before);
});

test('overlapping targets and symbolic links are rejected without replacing files', (t) => {
  const f = fixture(t); f.install();
  assert.throws(() => replaceInstallations(f.skill, [f.target, path.join(f.target, 'nested')]), /overlap/);
  assert.throws(() => replaceInstallations(f.skill, [f.target, f.target]), /overlap/);
  fs.symlinkSync('SKILL.md', path.join(f.skill, 'link')); f.commit();
  assert.throws(() => fingerprint(f.skill), /Symbolic links/);
  assert.equal(f.raw('update', '--allow-scripts').status, 1);
});

test('ignored git metadata is neither fingerprinted nor installed', (t) => {
  const f = fixture(t); fs.mkdirSync(path.join(f.skill, '.git')); fs.writeFileSync(path.join(f.skill, '.git/config'), 'ignored');
  replaceInstallations(f.skill, [f.target]);
  assert.equal(fs.existsSync(path.join(f.target, '.git')), false);
  assert.equal(fingerprint(f.target).manifestHash, fingerprint(f.skill).manifestHash);
});

test('missing --lock argument is reported as an input error', () => {
  const result = spawnSync(process.execPath, [MANAGER, 'check', '--lock'], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /requires a path/);
});
