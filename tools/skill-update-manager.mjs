#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  console.log(`Usage:
  node tools/skill-update-manager.mjs check  --lock <skills-lock.json> [--json] [--fail-on-update]
  node tools/skill-update-manager.mjs update --lock <skills-lock.json> [--dry-run] [--allow-scripts] [--json]
  node tools/skill-update-manager.mjs lock   --lock <skills-lock.json> [--write] [--json]

Policy:
  autoUpdate: "docs-only" updates non-script skill content after hashes are initialized.
  Changes under scripts/ require --allow-scripts unless autoUpdate is "all".
  pinned: true skips both check and update.
`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = {
    command,
    lock: 'skills-lock.json',
    json: false,
    dryRun: false,
    write: false,
    allowScripts: false,
    failOnUpdate: false,
  };

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--lock') args.lock = rest[++i];
    else if (token === '--json') args.json = true;
    else if (token === '--dry-run') args.dryRun = true;
    else if (token === '--write') args.write = true;
    else if (token === '--allow-scripts') args.allowScripts = true;
    else if (token === '--fail-on-update') args.failOnUpdate = true;
    else if (token === '-h' || token === '--help') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!['check', 'update', 'lock'].includes(command)) {
    usage();
    process.exit(command ? 1 : 0);
  }
  return args;
}

function expandPath(input) {
  if (!input) return input;
  if (input === '~') return homedir();
  if (input.startsWith('~/')) return path.join(homedir(), input.slice(2));
  return input;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function sourceUrl(source) {
  if (source.url) return source.url;
  if (source.type === 'github' && source.repo) {
    return `https://github.com/${source.repo}.git`;
  }
  throw new Error(`Unsupported source: ${JSON.stringify(source)}`);
}

function remoteHead(source) {
  const ref = source.ref ?? 'main';
  const output = git(['ls-remote', sourceUrl(source), ref]);
  const first = output.split(/\s+/)[0];
  if (!/^[a-f0-9]{40}$/i.test(first)) {
    throw new Error(`Could not resolve ${sourceUrl(source)} ${ref}`);
  }
  return first;
}

function materialize(source) {
  const ref = source.ref ?? 'main';
  const tmp = mkdtempSync(path.join(tmpdir(), 'skill-update-'));
  try {
    git(['clone', '--quiet', '--depth', '1', '--branch', ref, sourceUrl(source), tmp]);
    const commit = git(['rev-parse', 'HEAD'], { cwd: tmp });
    const skillPath = path.join(tmp, source.path ?? '.');
    if (!existsSync(path.join(skillPath, 'SKILL.md'))) {
      throw new Error(`Source path does not contain SKILL.md: ${source.path ?? '.'}`);
    }
    return { tmp, commit, skillPath };
  } catch (error) {
    rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
}

function walkFiles(dir, base = dir) {
  const entries = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === '.DS_Store') continue;
    const full = path.join(dir, name);
    const stat = lstatSync(full);
    if (stat.isDirectory()) {
      entries.push(...walkFiles(full, base));
    } else if (stat.isFile()) {
      entries.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return entries;
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fingerprint(dir) {
  const files = walkFiles(dir);
  const entries = files.map((rel) => {
    const full = path.join(dir, rel);
    const stat = statSync(full);
    return {
      path: rel,
      executable: Boolean(stat.mode & 0o111),
      sha256: sha256Bytes(readFileSync(full)),
    };
  });
  const scripts = entries.filter((entry) => entry.path.startsWith('scripts/'));
  return {
    manifestHash: sha256Bytes(JSON.stringify(entries)),
    scriptsHash: sha256Bytes(JSON.stringify(scripts)),
    fileCount: entries.length,
    scriptFileCount: scripts.length,
  };
}

function classifyChange(skill, nextFp) {
  const currentScriptsHash = skill.locked?.scriptsHash ?? '';
  if (!currentScriptsHash) {
    return 'unknown';
  }
  if (currentScriptsHash && currentScriptsHash !== nextFp.scriptsHash) {
    return 'scripts';
  }
  return 'content';
}

function copyExact(sourceDir, targetDir, dryRun) {
  const target = path.resolve(expandPath(targetDir));
  const parent = path.dirname(target);
  const backupRoot = path.join(parent, '.skill-update-backups');
  const backup = path.join(backupRoot, `${path.basename(target)}-${new Date().toISOString().replace(/[:.]/g, '-')}`);

  if (dryRun) return { target, backup: existsSync(target) ? backup : null };

  mkdirSync(parent, { recursive: true });
  if (existsSync(target)) {
    mkdirSync(backupRoot, { recursive: true });
    renameSync(target, backup);
  }

  try {
    cpSync(sourceDir, target, {
      recursive: true,
      dereference: false,
      force: true,
      preserveTimestamps: true,
    });
  } catch (error) {
    if (existsSync(backup) && !existsSync(target)) {
      renameSync(backup, target);
    }
    throw error;
  }
  return { target, backup: existsSync(backup) ? backup : null };
}

function summarize(result) {
  const base = `${result.name}: ${result.status}`;
  if (result.current && result.latest && result.current !== result.latest) {
    return `${base} ${result.current.slice(0, 8)} -> ${result.latest.slice(0, 8)} (${result.changeType})`;
  }
  return base;
}

function ensureLockShape(lock) {
  if (!Array.isArray(lock.skills)) {
    throw new Error('Lockfile must contain a skills array');
  }
}

function updateLocked(skill, commit, fp) {
  skill.locked = {
    ...(skill.locked ?? {}),
    commit,
    manifestHash: fp.manifestHash,
    scriptsHash: fp.scriptsHash,
    fileCount: fp.fileCount,
    scriptFileCount: fp.scriptFileCount,
    checkedAt: new Date().toISOString(),
  };
}

function processSkill(skill, command, args) {
  const policy = skill.policy ?? {};
  const current = skill.locked?.commit ?? null;
  const result = {
    name: skill.name,
    status: 'unknown',
    current,
    latest: null,
    changeType: null,
    actions: [],
  };

  if (policy.pinned) {
    result.status = 'pinned';
    return result;
  }

  const latest = remoteHead(skill.source);
  result.latest = latest;
  if (command === 'check' && current === latest) {
    result.status = 'up-to-date';
    return result;
  }

  if (command === 'check' && current !== latest && !skill.locked?.scriptsHash) {
    result.status = 'update-available';
    result.changeType = 'unknown';
    return result;
  }

  if (current === latest && command !== 'lock') {
    result.status = 'up-to-date';
    return result;
  }

  const materialized = materialize(skill.source);
  try {
    const fp = fingerprint(materialized.skillPath);
    const changeType = classifyChange(skill, fp);
    result.changeType = changeType;

    if (command === 'check') {
      result.status = 'update-available';
      return result;
    }

    if (command === 'lock') {
      updateLocked(skill, materialized.commit, fp);
      result.status = args.write ? 'lock-updated' : 'lock-update-available';
      return result;
    }

    const autoUpdate = policy.autoUpdate ?? 'docs-only';
    const scriptsAllowed = autoUpdate === 'all' || args.allowScripts;
    if (changeType === 'unknown' && !scriptsAllowed) {
      result.status = 'blocked-untrusted-change';
      result.actions.push('run lock --write once to record content hashes, or rerun with --allow-scripts after review');
      return result;
    }
    if (changeType === 'scripts' && !scriptsAllowed) {
      result.status = 'blocked-script-change';
      result.actions.push('rerun with --allow-scripts after reviewing the diff/changelog');
      return result;
    }

    const installations = skill.installations ?? [];
    if (!installations.length) {
      result.status = 'no-installations';
      result.actions.push('add installation paths to the lockfile');
      return result;
    }

    for (const installation of installations) {
      const copied = copyExact(materialized.skillPath, installation.path, args.dryRun);
      result.actions.push(`${args.dryRun ? 'would update' : 'updated'} ${installation.agent ?? 'skill'} at ${copied.target}`);
      if (copied.backup) {
        result.actions.push(`${args.dryRun ? 'would backup' : 'backed up'} previous copy at ${copied.backup}`);
      }
    }

    if (!args.dryRun) updateLocked(skill, materialized.commit, fp);
    result.status = args.dryRun ? 'would-update' : 'updated';
    return result;
  } finally {
    rmSync(materialized.tmp, { recursive: true, force: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const lockPath = path.resolve(expandPath(args.lock));
  const lock = readJson(lockPath);
  ensureLockShape(lock);

  const results = lock.skills.map((skill) => processSkill(skill, args.command, args));

  if ((args.command === 'lock' && args.write) || (args.command === 'update' && !args.dryRun)) {
    writeJson(lockPath, lock);
  }

  if (args.json) {
    console.log(JSON.stringify({ results }, null, 2));
  } else {
    for (const result of results) {
      console.log(summarize(result));
      for (const action of result.actions) console.log(`  - ${action}`);
    }
  }

  if (args.failOnUpdate && results.some((result) => result.status === 'update-available')) {
    process.exitCode = 2;
  }
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
