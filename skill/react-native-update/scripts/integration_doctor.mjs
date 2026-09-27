#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const strict = argv.includes('--strict');
const checks = [];
const add = (status, message) => checks.push({ status, message });
let root = process.cwd();
let fatal = false;

function readJson(file) { return JSON.parse(readFileSync(file, 'utf8')); }
function versionAtLeast(value, floor) {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(value);
  if (!match) return false;
  const current = match.slice(1, 4).map(Number), required = floor.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if (current[i] !== required[i]) return current[i] > required[i];
  return !match[4].startsWith('-');
}
function collect(dir, native = false) {
  const skip = new Set(['.git', 'node_modules', 'Pods', 'build', 'dist', 'DerivedData', '.gradle', '.cxx', 'oh_modules', '.ohpm', '.expo']);
  if (!native) for (const name of ['ios', 'android', 'harmony']) skip.add(name);
  const texts = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (skip.has(entry.name) || entry.isSymbolicLink()) continue;
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && (native ? /\.(m|mm|h|swift|java|kt|kts|gradle|xml|cpp|hpp|cmake|json5|ets|ts)$|^(CMakeLists\.txt|Podfile|Podfile\.lock)$/ : /\.[jt]sx?$/).test(entry.name)) {
        if (statSync(file).size > 2 * 1024 * 1024) add('warn', `Skipped large source file: ${path.relative(root, file)}`);
        else texts.push(readFileSync(file, 'utf8'));
      }
    }
  }
  if (existsSync(dir)) walk(dir);
  return texts.join('\n');
}
function signal(text, pattern, found, absent) { add(pattern.test(text) ? 'ok' : 'warn', pattern.test(text) ? found : absent); }

try {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Usage: integration_doctor.sh [app-root] [--strict] [--json]\nDefault: report diagnostic findings. --strict: exit 2 on missing requirements.\nThis static scan cannot verify the native binary installed on a device.');
    process.exit(0);
  }
  const positional = argv.filter((arg) => !['--json', '--strict'].includes(arg));
  if (positional.length > 1 || positional.some((arg) => arg.startsWith('--'))) throw new Error('Expected one app-root and optional --strict/--json');
  root = path.resolve(positional[0] ?? root);
  let pkg;
  try { pkg = readJson(path.join(root, 'package.json')); }
  catch { add('missing', 'package.json is missing, unreadable, or invalid JSON'); }
  if (pkg === null || Array.isArray(pkg) || (pkg !== undefined && typeof pkg !== 'object')) { add('missing', 'package.json must contain an object'); pkg = undefined; }
  if (pkg) {
    add('ok', 'package.json found');
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const has = (name) => Boolean(deps[name]);
    const locks = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock'].filter((name) => existsSync(path.join(root, name)));
    if (locks.length > 1) add('warn', 'Multiple package-manager lock files found; keep one lockfile family');
    let sdkVersion = '';
    if (!has('react-native-update')) add('missing', 'react-native-update dependency missing');
    else {
      add('ok', `react-native-update dependency declared (${deps['react-native-update']})`);
      try {
        const require = createRequire(path.join(root, 'package.json'));
        sdkVersion = String(readJson(require.resolve('react-native-update/package.json')).version ?? '');
      } catch { /* Missing dependencies and package export restrictions are diagnostic findings. */ }
      if (!sdkVersion) add('warn', 'Installed react-native-update version could not be resolved; install dependencies before version-specific diagnostics');
      else {
        add('ok', `Installed react-native-update JS package: ${sdkVersion}`);
        add('info', versionAtLeast(sdkVersion, '10.49.0') ? 'Installed JS supports bundleHash; verify the native binary and uploaded baseline separately' : 'JS package is below 10.49.0; retain buildTime-era baseline diagnostics');
        add('info', versionAtLeast(sdkVersion, '10.52.1') ? 'Installed JS supports native cold-start recovery; this does not prove the installed native binary contains it' : 'JS package is below 10.52.1; native cold-start recovery requires an SDK upgrade and a new native release');
      }
    }
    let cli = '';
    for (const command of ['pushy', 'cresc']) {
      const result = spawnSync(command, ['version'], { cwd: root, encoding: 'utf8', timeout: 5000, env: { ...process.env, RNU_AUTO_UPDATE: '0', RNU_DISABLE_AUTO_UPDATE: '1' } });
      if (result.status === 0) { cli = command; break; }
    }
    add(cli ? 'ok' : 'warn', cli ? `Global ${cli} CLI available` : 'Global pushy/cresc CLI not found or version command failed; install react-native-update-cli globally');
    if (has('expo')) {
      add('ok', `Expo project detected (${deps.expo})`);
      const major = Number(String(deps.expo).match(/\d+/)?.[0] ?? 0);
      if (major && major < 50) add('warn', 'Expo version appears below 50; modern prebuild flow is recommended');
      else if (major && major < 51) add('warn', 'Expo New Architecture support before Expo 51 is incomplete');
      if (!existsSync(path.join(root, 'ios')) || !existsSync(path.join(root, 'android'))) add('warn', 'Expo native directories missing; prebuild the intended target platforms before native configuration');
    } else add('info', 'Expo dependency not detected');
    if (has('expo-updates')) add('warn', 'expo-updates detected; remove it when using Pushy/Cresc instead of Expo Updates');
    const tv = has('react-native-tvos') || String(deps['react-native'] ?? '').includes('react-native-tvos');
    if (tv) {
      add('info', 'react-native-tvos detected: Apple TV uses Platform.OS=ios and an ios appKey, not a tvos key');
      add(sdkVersion && versionAtLeast(sdkVersion, '10.58.0') ? 'info' : 'warn', 'tvOS requires SDK 10.58.0+ in a rebuilt native app; verify cache-purge recovery in a Release build');
    }
    let config;
    try {
      config = readJson(path.join(root, 'update.json'));
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('shape');
      add('ok', 'update.json found');
      const platforms = ['ios', 'android', 'harmony'].filter((platform) => Object.hasOwn(config, platform));
      if (!platforms.length) add('missing', 'update.json has no ios/android/harmony entries');
      for (const platform of platforms) {
        const valid = typeof config[platform]?.appKey === 'string' && Boolean(config[platform].appKey.trim());
        add(valid ? 'ok' : 'missing', `${platform} appKey ${valid ? 'present' : 'missing or invalid'}`);
      }
      if (Object.hasOwn(config, 'tvos')) add('warn', 'Do not use a tvos update.json key; use ios for Apple TV');
      if (tv && !platforms.includes('ios')) add('missing', 'Apple TV needs an ios entry in update.json');
      for (const platform of ['ios', 'android', 'harmony']) {
        if (existsSync(path.join(root, platform)) && !platforms.includes(platform)) add('missing', `${platform} native project exists but update.json has no ${platform} entry`);
      }
    } catch { add('missing', 'update.json is missing, unreadable, or invalid JSON'); config = undefined; }
    if (existsSync(path.join(root, '.update'))) {
      const ignore = existsSync(path.join(root, '.gitignore')) ? readFileSync(path.join(root, '.gitignore'), 'utf8') : '';
      add(/^\/?\.update\/?\s*$/m.test(ignore) ? 'ok' : 'warn', /^\/?\.update\/?\s*$/m.test(ignore) ? '.update is ignored by .gitignore' : '.update exists but no standalone ignore entry was found');
    }
    const js = collect(root);
    signal(js, /UpdateProvider|PushyProvider/, 'UpdateProvider/PushyProvider usage detected', 'UpdateProvider not detected in JS/TS sources');
    signal(js, /new\s+(Pushy|Cresc)\(/, 'Pushy/Cresc client initialization detected', 'Pushy/Cresc client initialization not detected');
    if (/disableNativeCheck\s*:\s*true/.test(js)) add('warn', 'disableNativeCheck: true opts out of native cold-start recovery');
    if (existsSync(path.join(root, 'ios'))) {
      const native = collect(path.join(root, 'ios'), true);
      add('ok', 'iOS native project found');
      add(existsSync(path.join(root, 'ios/Podfile')) ? 'ok' : 'warn', existsSync(path.join(root, 'ios/Podfile')) ? 'ios/Podfile found' : 'ios/Podfile missing');
      const podLock = path.join(root, 'ios/Podfile.lock');
      add(existsSync(podLock) && /react-native-update/.test(readFileSync(podLock, 'utf8')) ? 'ok' : 'warn', existsSync(podLock) && /react-native-update/.test(readFileSync(podLock, 'utf8')) ? 'Podfile.lock includes react-native-update; this is a build input, not proof about the device binary' : 'iOS pods may need install/update');
      signal(native, /RCTPushy|react_native_update|ExpoPushy/, 'iOS bundle integration signal detected', 'iOS bundle URL integration not detected; Release should use RCTPushy.bundleURL() unless Expo auto integration applies');
    }
    if (existsSync(path.join(root, 'android'))) {
      const native = collect(path.join(root, 'android'), true);
      add('ok', 'Android native project found');
      signal(native, /UpdateContext\.getBundleUrl/, 'Android UpdateContext.getBundleUrl usage detected', 'Android bundle URL integration not detected');
      if (has('react-native-screens')) signal(native, /RNScreensFragmentFactory|super\.onCreate\(null\)/, 'react-native-screens restart guard detected', 'Add RNScreensFragmentFactory in MainActivity.onCreate for safe OTA restarts');
      signal(native, /crunchPngs\s*(?:=\s*)?false/, 'Android release crunchPngs false detected', 'Android crunchPngs false not detected; PNG reprocessing can hurt OTA diff size');
      if (/enableSplit\s*=\s*true/.test(native)) add('warn', 'AAB density split appears enabled; SDKs below 10.36.0 need density split disabled');
    }
    if (existsSync(path.join(root, 'harmony'))) {
      const native = collect(path.join(root, 'harmony'), true);
      add('ok', 'Harmony native project found');
      for (const [pattern, name] of [[/PushyFileJSBundleProvider/, 'PushyFileJSBundleProvider'], [/reactNativeUpdatePlugin/, 'reactNativeUpdatePlugin'], [/PushyPackage/, 'PushyPackage'], [/pushy\.har/, 'pushy.har'], [/PushyTurboModule/, 'PushyTurboModule'], [/bundle\.harmony\.js/, 'bundle.harmony.js']]) {
        signal(native, pattern, `Harmony ${name} detected`, `Harmony ${name} not detected; consult the native checklist`);
      }
      add(existsSync(path.join(root, 'harmony/AppScope/app.json5')) ? 'ok' : 'warn', existsSync(path.join(root, 'harmony/AppScope/app.json5')) ? 'Harmony AppScope/app.json5 found; versionName is packageVersion' : 'Harmony AppScope/app.json5 not found');
    } else if (config?.harmony) add('info', 'Harmony configuration present without a native directory; native checks skipped');
    if (has('@callstack/react-native-brownfield')) add('warn', 'Brownfield detected; wire bundle loading at runtime creation, not by changing host inheritance');
  }
} catch (error) { fatal = true; add('error', error.message); }

const summary = Object.fromEntries(['ok', 'info', 'warn', 'missing', 'error'].map((status) => [status, checks.filter((check) => check.status === status).length]));
const report = { schema: 1, appRoot: root, nativeBinaryVerified: false, checks, summary };
if (json) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`[doctor] app root: ${root}`);
  for (const check of checks) console.log(`[${check.status}] ${check.message}`);
  console.log('[doctor] Native binary verification requires a real Release-build test.');
  console.log('[doctor] done');
}
process.exitCode = fatal ? 1 : strict && summary.missing ? 2 : 0;
