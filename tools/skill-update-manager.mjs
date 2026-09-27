#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expandPath = (value) => value === '~' ? homedir() : value.startsWith('~/') ? path.join(homedir(), value.slice(2)) : value;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const exists = (file) => { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };

function usage() {
  console.log(`Usage:
  node tools/skill-update-manager.mjs check --lock <skills-lock.json> [--json] [--fail-on-update]
  node tools/skill-update-manager.mjs update --lock <skills-lock.json> [--dry-run] [--allow-scripts] [--json]
  node tools/skill-update-manager.mjs lock --lock <skills-lock.json> [--write] [--json]

lock --write records a REVIEWED upstream snapshot, not a successful installation.
check/update always verify the actual installation contents, even at the same commit.
The default docs-only policy blocks unreviewed script changes. Use --allow-scripts
only after review. pinned entries are skipped. Node.js 22 or newer is recommended.`);
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h') || !argv.length) { usage(); return null; }
  const [command, ...rest] = argv;
  if (!['check', 'update', 'lock'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const args = { command, lock: 'skills-lock.json', json: false, dryRun: false, write: false, allowScripts: false, failOnUpdate: false };
  const flags = { '--json': 'json', '--dry-run': 'dryRun', '--write': 'write', '--allow-scripts': 'allowScripts', '--fail-on-update': 'failOnUpdate' };
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--lock') {
      if (!rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error('--lock requires a path');
      args.lock = rest[++i];
    } else if (flags[rest[i]]) args[flags[rest[i]]] = true;
    else throw new Error(`Unknown argument: ${rest[i]}`);
  }
  if (args.write && command !== 'lock') throw new Error('--write is only valid with lock');
  if (args.dryRun && command !== 'update') throw new Error('--dry-run is only valid with update');
  return args;
}

function git(args, cwd = ROOT) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function materialize(source) {
  const url = source.url || (source.type === 'github' && source.repo ? `https://github.com/${source.repo}.git` : null);
  if (!url) throw new Error('Source must specify url or a GitHub repo');
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'skill-update-')));
  try {
    git(['clone', '--quiet', '--depth', '1', '--branch', source.ref ?? 'main', '--', url, tmp]);
    const skillPath = path.resolve(tmp, source.path ?? '.');
    if (skillPath !== tmp && !skillPath.startsWith(tmp + path.sep)) throw new Error('Source path must stay inside the repository');
    // Resolve directory links as well as file links; never install bytes from outside the checkout.
    if (fs.realpathSync(skillPath) !== skillPath) throw new Error('Symbolic links in source paths are not supported');
    if (!fs.existsSync(path.join(skillPath, 'SKILL.md'))) throw new Error('Source path does not contain SKILL.md');
    return { tmp, skillPath, commit: git(['rev-parse', 'HEAD'], tmp) };
  } catch (error) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
}

export function fingerprint(dir) {
  const entries = [];
  function walk(full, relative = '') {
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${full}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) {
        if (name === '.git' || name === '.DS_Store') continue;
        walk(path.join(full, name), relative ? `${relative}/${name}` : name);
      }
    } else if (stat.isFile() && relative) {
      entries.push({ path: relative, executable: Boolean(stat.mode & 0o111), sha256: digest(fs.readFileSync(full)) });
    } else throw new Error(`Expected a regular file or directory: ${full}`);
  }
  walk(dir);
  const scripts = entries.filter((entry) => entry.path.startsWith('scripts/'));
  return { manifestHash: digest(JSON.stringify(entries)), scriptsHash: digest(JSON.stringify(scripts)), fileCount: entries.length, scriptFileCount: scripts.length };
}

function targetsFor(installations) {
  const targets = installations.map(({ path: value }) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Installation path must be a nonempty string');
    const target = path.resolve(expandPath(value));
    if (target === path.parse(target).root || target === homedir()) throw new Error(`Refusing unsafe installation target: ${target}`);
    return target;
  });
  for (let i = 0; i < targets.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const a = targets[i], b = targets[j];
      if (a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep)) throw new Error('Installation paths must not overlap');
    }
  }
  return targets;
}

/** Stage and verify every installation before changing any live target.
 * The io parameter is a test seam for deterministic disk/rename failures.
 * Successful backups are retained. Rollback errors report their recovery paths.
 */
export function replaceInstallations(sourceDir, targets, { dryRun = false, io = fs } = {}) {
  const expected = fingerprint(sourceDir);
  targets = targetsFor(targets.map((target) => ({ path: target })));
  for (const target of targets) if (exists(target)) fingerprint(target);
  const plans = targets.map((target) => ({ target, stage: null, backup: null, backupRoot: null, movedOld: false, switched: false }));
  if (dryRun) return plans;
  try {
    for (const plan of plans) {
      const parent = path.dirname(plan.target);
      io.mkdirSync(parent, { recursive: true });
      plan.stage = io.mkdtempSync(path.join(parent, '.skill-update-stage-'));
      io.cpSync(sourceDir, plan.stage, {
        recursive: true, dereference: false, force: true, preserveTimestamps: true,
        filter: (src) => src === sourceDir || !['.git', '.DS_Store'].includes(path.basename(src)),
      });
      if (fingerprint(plan.stage).manifestHash !== expected.manifestHash) throw new Error(`Staged content failed verification: ${plan.target}`);
    }
    for (const plan of plans) {
      if (exists(plan.target)) {
        const root = path.join(path.dirname(plan.target), '.skill-update-backups');
        io.mkdirSync(root, { recursive: true });
        plan.backupRoot = io.mkdtempSync(path.join(root, `${path.basename(plan.target)}-`));
        plan.backup = path.join(plan.backupRoot, 'previous');
        io.renameSync(plan.target, plan.backup);
        plan.movedOld = true;
      }
      io.renameSync(plan.stage, plan.target);
      plan.switched = true;
    }
    return plans;
  } catch (error) {
    const rollbackErrors = [];
    for (const plan of [...plans].reverse()) {
      try {
        if (plan.switched) io.rmSync(plan.target, { recursive: true, force: true });
        if (plan.movedOld) io.renameSync(plan.backup, plan.target);
      } catch (rollbackError) {
        rollbackErrors.push(`${plan.target}: ${rollbackError.message}; previous copy: ${plan.backup ?? '(none)'}`);
      }
    }
    if (rollbackErrors.length) throw new Error(`${error.message}; rollback incomplete: ${rollbackErrors.join('; ')}`, { cause: error });
    throw error;
  } finally {
    for (const plan of plans) {
      if (plan.stage) fs.rmSync(plan.stage, { recursive: true, force: true });
      if (plan.backupRoot && !exists(plan.backup)) fs.rmSync(plan.backupRoot, { recursive: true, force: true });
    }
  }
}

function updateLocked(skill, commit, fp) {
  skill.locked = { ...(skill.locked ?? {}), commit, ...fp, checkedAt: new Date().toISOString() };
}

function recordInstallations(skill, commit, fp) {
  for (const installation of skill.installations) {
    installation.installed = { commit, ...fp, verifiedAt: new Date().toISOString() };
  }
}

function processSkill(skill, args) {
  const policy = skill.policy ?? {};
  const current = skill.locked?.commit ?? null;
  const result = { name: skill.name, status: 'unknown', current, latest: null, changeType: null, actions: [], installations: [] };
  if (policy.pinned) return { ...result, status: 'pinned' };
  if (!['docs-only', 'all'].includes(policy.autoUpdate ?? 'docs-only')) throw new Error(`Unsupported autoUpdate policy: ${policy.autoUpdate}`);
  const materialized = materialize(skill.source);
  try {
    const fp = fingerprint(materialized.skillPath);
    result.latest = materialized.commit; // The exact cloned commit, not an earlier ls-remote snapshot.
    if (args.command === 'lock') {
      updateLocked(skill, materialized.commit, fp);
      result.actions.push('recorded upstream review baseline; installation state was not changed');
      return { ...result, status: args.write ? 'lock-updated' : 'lock-update-available' };
    }
    const installations = skill.installations ?? [];
    const targets = targetsFor(installations);
    result.installations = targets.map((target) => ({ path: target, state: !exists(target) ? 'missing' : fingerprint(target).manifestHash === fp.manifestHash ? 'matching' : 'mismatched' }));
    if (!installations.length) return { ...result, status: 'no-installations', actions: ['add installation paths to the lockfile'] };
    const sameContent = skill.locked?.manifestHash === fp.manifestHash;
    result.changeType = sameContent ? 'none' : !skill.locked?.scriptsHash ? 'unknown' : skill.locked.scriptsHash === fp.scriptsHash ? 'content' : 'scripts';
    const allInstalled = result.installations.every((item) => item.state === 'matching');
    if (sameContent && allInstalled) {
      if (current === materialized.commit) {
        if (args.command === 'update' && !args.dryRun) recordInstallations(skill, materialized.commit, fp);
        return { ...result, status: 'up-to-date' };
      }
      if (args.command === 'check') return { ...result, status: 'content-up-to-date' };
      if (!args.dryRun) { updateLocked(skill, materialized.commit, fp); recordInstallations(skill, materialized.commit, fp); }
      return { ...result, status: args.dryRun ? 'would-refresh-lock' : 'lock-refreshed' };
    }
    if (args.command === 'check') return { ...result, status: 'update-available' };
    const scriptsAllowed = policy.autoUpdate === 'all' || args.allowScripts;
    if (result.changeType === 'unknown' && !scriptsAllowed) return { ...result, status: 'blocked-untrusted-change', actions: ['review upstream, then lock --write or update --allow-scripts'] };
    if (result.changeType === 'scripts' && !scriptsAllowed) return { ...result, status: 'blocked-script-change', actions: ['review the script diff before rerunning with --allow-scripts'] };
    const copied = replaceInstallations(materialized.skillPath, targets, { dryRun: args.dryRun });
    for (const item of copied) {
      result.actions.push(`${args.dryRun ? 'would update' : 'updated'} ${item.target}`);
      if (item.backup) result.actions.push(`previous copy retained at ${item.backup}`);
    }
    if (!args.dryRun) { updateLocked(skill, materialized.commit, fp); recordInstallations(skill, materialized.commit, fp); }
    return { ...result, status: args.dryRun ? 'would-update' : 'updated' };
  } finally { fs.rmSync(materialized.tmp, { recursive: true, force: true }); }
}

function writeJsonAtomic(file, data) {
  const staging = fs.mkdtempSync(path.join(path.dirname(file), '.skills-lock-'));
  try {
    const temporary = path.join(staging, 'lock.json');
    fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: fs.statSync(file).mode & 0o777 });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args) return;
  const lockPath = path.resolve(expandPath(args.lock));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  if (!Array.isArray(lock.skills)) throw new Error('Lockfile must contain a skills array');
  const results = lock.skills.map((skill) => processSkill(skill, args));
  if ((args.command === 'lock' && args.write) || (args.command === 'update' && !args.dryRun)) writeJsonAtomic(lockPath, lock);
  if (args.json) console.log(JSON.stringify({ results }, null, 2));
  else for (const result of results) {
    console.log(`${result.name}: ${result.status}`);
    for (const action of result.actions) console.log(`  - ${action}`);
  }
  if (args.failOnUpdate && results.some((r) => ['update-available', 'no-installations'].includes(r.status))) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`Error: ${error.message}`); process.exitCode = 1; }
}
