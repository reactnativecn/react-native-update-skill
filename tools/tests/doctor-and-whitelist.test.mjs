import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isUserAllowed } from '../../skill/react-native-update/references/rollout-whitelist.ts';
const DOCTOR = fileURLToPath(new URL('../../skill/react-native-update/scripts/integration_doctor.sh', import.meta.url));

function fixture(t, extra = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'doctor app '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { 'react-native-update': '^10.58.1', ...extra } }));
  const dir = path.join(root, 'node_modules/react-native-update'); mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'react-native-update', version: '10.58.1' }));
  writeFileSync(path.join(root, 'update.json'), JSON.stringify({ ios: { appKey: 'fixture-key-do-not-print' } }));
  writeFileSync(path.join(root, 'App.tsx'), 'new Pushy({ appKey }); <UpdateProvider />');
  const run = (...args) => {
    const r = spawnSync('bash', [DOCTOR, root, '--json', ...args], { encoding: 'utf8', env: { ...process.env, RNU_AUTO_UPDATE: '0' } });
    assert.equal(r.stderr, ''); return { ...r, report: JSON.parse(r.stdout) };
  };
  return { root, run };
}

test('doctor JSON is machine-readable and never claims to verify a device binary', (t) => {
  const f = fixture(t); const r = f.run('--strict');
  assert.equal(r.status, 0); assert.equal(r.report.schema, 1); assert.equal(r.report.nativeBinaryVerified, false);
  assert.match(r.stdout, /does not prove the installed native binary/);
  assert.doesNotMatch(r.stdout, /fixture-key-do-not-print|native cold-start recovery capability is available/);
});

for (const config of [null, [], {}, { ios: {} }, { ios: { appKey: 12 } }, { ios: { appKey: ' ' } }, '{invalid']) {
  test(`doctor strict mode reports invalid config: ${JSON.stringify(config)}`, (t) => {
    const f = fixture(t); writeFileSync(path.join(f.root, 'update.json'), typeof config === 'string' ? config : JSON.stringify(config));
    assert.equal(f.run().status, 0);
    const r = f.run('--strict'); assert.equal(r.status, 2); assert.ok(r.report.summary.missing > 0);
  });
}

test('doctor missing dependency and missing package.json are findings in strict mode', (t) => {
  const f = fixture(t); writeFileSync(path.join(f.root, 'package.json'), '{}');
  assert.equal(f.run('--strict').status, 2);
  rmSync(path.join(f.root, 'package.json'));
  assert.equal(f.run('--strict').status, 2);
});

test('doctor handles malformed package.json without corrupting JSON output', (t) => {
  const f = fixture(t); writeFileSync(path.join(f.root, 'package.json'), '{');
  assert.equal(f.run('--strict').status, 2);
});

test('doctor detects tvOS aliases and requires an ios appKey', (t) => {
  const f = fixture(t, { 'react-native': 'npm:react-native-tvos@0.87.1-1' });
  let r = f.run(); assert.match(r.stdout, /Apple TV uses Platform.OS=ios/);
  writeFileSync(path.join(f.root, 'update.json'), JSON.stringify({ tvos: { appKey: 'wrong' } }));
  r = f.run('--strict'); assert.equal(r.status, 2); assert.match(r.stdout, /Apple TV needs an ios entry/);
});

test('doctor retains native checks and ignores dependency/build source false positives', (t) => {
  const f = fixture(t, { 'react-native-screens': '4.0.0' });
  mkdirSync(path.join(f.root, 'android/build'), { recursive: true });
  writeFileSync(path.join(f.root, 'android/build/Fake.kt'), 'UpdateContext.getBundleUrl(this); crunchPngs false; RNScreensFragmentFactory');
  let r = f.run('--strict');
  assert.equal(r.status, 2); assert.match(r.stdout, /Android bundle URL integration not detected/);
  writeFileSync(path.join(f.root, 'android/Main.kt'), 'UpdateContext.getBundleUrl(this); crunchPngs = false; RNScreensFragmentFactory');
  writeFileSync(path.join(f.root, 'update.json'), JSON.stringify({ android: { appKey: 'valid' } }));
  r = f.run('--strict'); assert.equal(r.status, 0); assert.match(r.stdout, /restart guard detected/);
});

test('doctor recognizes Harmony integration signals', (t) => {
  const f = fixture(t); mkdirSync(path.join(f.root, 'harmony'), { recursive: true });
  writeFileSync(path.join(f.root, 'harmony/Index.ets'), "PushyFileJSBundleProvider reactNativeUpdatePlugin PushyPackage pushy.har PushyTurboModule bundle.harmony.js");
  writeFileSync(path.join(f.root, 'update.json'), JSON.stringify({ harmony: { appKey: 'valid' } }));
  const r = f.run('--strict'); assert.equal(r.status, 0); assert.match(r.stdout, /Harmony PushyFileJSBundleProvider detected/);
});

for (const value of [undefined, null, '', 'null', 'true', '12', '"user"', '[]', '{}', '{', '{"allowUsers":123}', '{"allowUsers":"12345"}', '{"allowUsers":null}', '{"allowUsers":["123",4]}']) {
  test(`whitelist fails closed for ${String(value)}`, () => assert.equal(isUserAllowed(value, '123'), false));
}

test('whitelist requires an exact string identity without coercion or substring matching', () => {
  assert.equal(isUserAllowed('{"allowUsers":["12345"]}', '123'), false);
  assert.equal(isUserAllowed('{"allowUsers":["123"]}', 123), false);
  assert.equal(isUserAllowed('{"allowUsers":[""]}', ''), false);
  assert.equal(isUserAllowed('{"allowUsers":["123"]}', '123'), true);
});
