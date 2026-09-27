# react-native-update integration playbook

Reviewed against SDK 10.58.1 and CLI 2.28.0 on 2026-09-27. For tvOS, RN 0.87 TypeScript, error metadata, source maps, and modern publishing options, also read [modern-integration.md](modern-integration.md). These reviewed versions are not blanket minimum requirements for older apps.

## Contents
- Fast path
- Compatibility and version floors
- Service choice
- App shape specifics
- JS wiring
- Strategy and hook options
- Native cold-start recovery
- Native touchpoints
- Release baseline and publishing
- Verification
- Troubleshooting
- Examples

## 1) Fast path
1. In the app root, install the SDK and ensure the CLI is available:
   - `npm i react-native-update`
   - `npm i -g react-native-update-cli`
   - Install the CLI globally and invoke `pushy` or `cresc` directly. Do not replace these commands with a project-local CLI or `npx`.
   - Use `yarn`, `pnpm`, or `bun` equivalents for the app dependency only when the project already uses that package manager.
2. For iOS, run `cd ios && pod install` after dependency changes.
3. Create or select app records per platform with the matching service CLI:
   - Pushy: `pushy createApp --platform ios|android|harmony` or `pushy selectApp --platform ...`
   - Cresc: `cresc createApp --platform ios|android|harmony` or `cresc selectApp --platform ...`
4. Commit the generated `update.json`. It is not a secret. Do not commit `.update`.
5. Configure native bundle loading for iOS/Android/Harmony.
6. Initialize one `Pushy` or `Cresc` client and wrap the app with `UpdateProvider`.
7. Build a release package, pass the actual distribution artifact to the global CLI for native-baseline upload, then publish a `.ppk` hot update.

## 2) Compatibility and version floors
- Read the installed version from `node_modules/react-native-update/package.json` or the active lockfile, not only the dependency range in `package.json`.
- Read the global CLI version with `pushy version` or `cresc version`.
- Preserve existing commands and older app binaries. A feature introduced in a newer SDK must be optional or guarded until every supported native binary contains its native implementation.
- Ship a new native release and upload its baseline when upgrading a capability implemented in iOS, Android, or Harmony native code. An OTA package alone cannot add that native method.
- When newer JS can run on an older binary, use the SDK's documented compatibility fallback. If calling a native module escape hatch directly, guard it with `typeof method === 'function'` and keep the previous behavior as the fallback.

Useful feature floors:

| Capability | Minimum `react-native-update` | Compatibility note |
| --- | --- | --- |
| `afterCheckUpdate` | 10.38.3 | Notification hook; do not make basic update flow depend on it. |
| `beforeReload` | 10.42.2 | Only affects `switchVersion()` and `restartApp()`. |
| `useUpdateProgress()` | 10.45.0 | Keep `useUpdate().progress` for code that must compile against older SDKs. |
| Stable error codes and `client.onError()` | 10.46.0 | `lastError` remains the provider-level compatibility path. |
| `resetToPackagedBundle()` | 10.48.0 | The client feature-detects older native modules and returns `false`; do not ignore the boolean. |
| `bundleHash` / `bundleStatus` | 10.49.0 | Use global CLI >= 2.20.3 when uploading baselines. |
| Native cold-start check, force-boot recovery, and resumable rescue | 10.52.1 | Requires a new native release on every target platform. |
| tvOS support, purge-restore ordering, nested Expo module layout fix | 10.58.0 | Native application rebuild required. Apple TV uses the `ios` configuration key. |
| RN 0.87 TypeScript compatibility fixes | 10.58.1 | The 10.58.0 -> 10.58.1 patch alone does not require a native rebuild. |

Do not reject an otherwise valid integration merely because it is below a feature floor. Report the unavailable capability, keep the older supported flow, and recommend a native upgrade when the capability matters.

## 3) Service choice
- Pushy China service: use `Pushy` from `react-native-update`, `pushy` CLI, Pushy admin, RMB billing.
- Cresc global service: use `Cresc` from `react-native-update`, `cresc` CLI, Cresc admin, USD billing.
- `update.json` stores app IDs and app keys for whichever service created them. Keep the JS client class and CLI service aligned.
- The same SDK supports both services; most integration code differs only in the client class name and command prefix.

## 4) App shape specifics

### React Native CLI
- Standard install plus iOS pods.
- RN >= 0.60 normally autolinks. Very old RN, monorepos, brownfield, or custom native layouts may need manual linking.

### Expo
- Use Expo prebuild workflow: `npx expo prebuild`.
- Expo 50+ is the supported baseline. Expo New Architecture support before Expo 51 is incomplete; prefer the latest Expo available.
- Do not co-install `expo-updates`; it conflicts with update behavior.
- Expo 48+ with `react-native-update` >= 10.28.2 configures iOS bundle URL automatically. Still run pods after prebuild.

### tvOS / react-native-tvos
- Read [modern-integration.md](modern-integration.md) for the 10.58.0 native floor, cache-purge recovery, and testing requirements.
- Apple TV still uses `Platform.OS === 'ios'` and an `ios` appKey. Do not introduce a `tvos` CLI platform or `update.json` key.

### HarmonyOS
- `update.json` can include a `harmony` entry. Do not rely on `Platform.OS` unless the app already normalizes it to `harmony`.
- Harmony needs native package/provider/bundle-provider wiring in addition to JS `UpdateProvider`.
- Keep the bundle file name `bundle.harmony.js` whether or not Hermes bytecode is used.

### Brownfield or monorepo
- Do not change host app inheritance just to integrate OTA.
- Wire the bundle URL at the runtime creation point:
  - iOS XCFramework: call `RCTPushy.bundleURL()` through the brownfield bundle URL override or bridge delegate.
  - Android AAR/new architecture: pass `UpdateContext.getBundleUrl(application, "assets://index.android.bundle")` into `ReactHost` / `getDefaultReactHost`.
- Ensure the final distributed package contains the exact embedded baseline bundle that is uploaded as the native baseline.

## 5) Minimum JS wiring
Read the platform app key from `update.json`.

For iOS/Android:

```tsx
import { Platform } from 'react-native';
import updateConfig from './update.json';

const { appKey } = updateConfig[Platform.OS as 'ios' | 'android'];
```

For Harmony:

```tsx
import updateConfig from './update.json';

const { appKey } = updateConfig.harmony;
```

Pushy:

```tsx
import { Pushy, UpdateProvider } from 'react-native-update';
import App from './App';

const updateClient = new Pushy({
  appKey,
});

export default function Root() {
  return (
    <UpdateProvider client={updateClient}>
      <App />
    </UpdateProvider>
  );
}
```

Cresc:

```tsx
import { Cresc, UpdateProvider } from 'react-native-update';
import App from './App';

const updateClient = new Cresc({
  appKey,
});

export default function Root() {
  return (
    <UpdateProvider client={updateClient}>
      <App />
    </UpdateProvider>
  );
}
```

Rules:
- Create the client outside the component so it is stable across renders.
- Mount exactly one client and one `UpdateProvider` per process. Multiple clients/providers are an integration error because native and JS update state is process-wide.
- Do not call `useUpdate()` in the same component that renders `UpdateProvider`; call it in descendants.
- Prefer the functions returned from `useUpdate()` (`checkUpdate`, `downloadUpdate`, `switchVersion`, `switchVersionLater`, etc.) over direct `client` calls. Direct `client` access is an escape hatch for unusual low-level integrations, not the normal app API.
- Prefer `updateInfo` and `lastError` for rendered UI, automatic checks, deep links, and QR flows so they share one provider-owned state path.
- `checkUpdate()` returns `CheckResult | undefined`. A contained manual action may inspect that result; treat `undefined` as skipped/failed and do not maintain a second long-lived copy of provider state.
- For TypeScript JSON imports, enable `resolveJsonModule` or use the project's existing JSON-import pattern.

## 6) Strategy and hook options
- `checkStrategy`: `both` / `onAppStart` / `onAppResume` / `null`
- `updateStrategy`: `alwaysAlert` / `alertUpdateAndIgnoreError` / `silentAndNow` / `silentAndLater` / `null`
- For custom UI: set `updateStrategy: null`, then use `useUpdate()`.
- `debug: true` can check/download in development but cannot apply patches. Applying updates requires release builds.
- `throwError: true` lets callers use `try/catch`; otherwise use `lastError`.
- `beforeCheckUpdate`, `beforeDownloadUpdate`, `afterDownloadUpdate`, and `onPackageExpired` are control hooks for custom gates.
- `afterCheckUpdate` (v10.38.3+) is useful for analytics or observability after each check. Receives `UpdateCheckState` with `status` ("completed"/"skipped"/"error"), optional `result`, and optional `error`.
- `beforeReload` (v10.42.2+) executes before `switchVersion()` or `restartApp()` actually restarts the app. Return `false` to cancel the restart. Useful for cleaning up native SDKs (e.g., Sentry profiling) before the RN instance is destroyed. `switchVersionLater()` does NOT trigger this hook.
- `maxRetries` controls failed-download retry attempts (default: 3).
- `disableTelemetry: true` disables lifecycle/health telemetry. Explain that this removes dashboard health signals before recommending it.
- `logger` can forward update events to analytics.
- Avoid passing the `client` object down through app code. Keep the client at provider setup and drive UI through `useUpdate()` state.

### `beforeReload` example: clean up native SDK before restart

If the app integrates Sentry profiling, performance sampling, or similar native SDKs that work across threads, use `beforeReload` to stop sampling and flush queues before Pushy restarts:

```ts
import { NativeModules } from "react-native";
import * as Sentry from "@sentry/react-native";
import { Pushy } from "react-native-update";

const pushyClient = new Pushy({
  appKey,
  beforeReload: async (context) => {
    // context.type is "switchVersion" or "restartApp"
    // context.hash is the update hash when type is "switchVersion"
    try {
      NativeModules.RNSentry?.stopProfiling?.();
    } catch {}

    const flushed = await Promise.race([
      Sentry.flush(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500)),
    ]);

    // Return false to cancel this restart; the next check or manual trigger will retry.
    return flushed;
  },
});
```

### `useUpdate()` return values

The `useUpdate()` hook returns these key functions and state:
- `checkUpdate`: Trigger update check. Returns `CheckResult | undefined` on v10.26.0+, but prefer reading `updateInfo` from the hook for rendered UI.
- `downloadUpdate`: Download the update. Returns `boolean` on v10.16.0+.
- `switchVersion`: Immediately restart and apply the downloaded update. Waits for `beforeReload` if configured.
- `switchVersionLater`: Apply update on next manual restart. Does NOT trigger `beforeReload`.
- `restartApp` (v10.28.2+): Restart the app immediately. Waits for `beforeReload` if configured.
- `resetToPackagedBundle` (v10.48.0+): Delete downloaded update state and optionally restart into the embedded bundle. Check the returned boolean; `false` means reset did not happen, including when the native binary is too old.
- `updateInfo`: Current update state (`{update: true}`, `{upToDate: true}`, or `{expired: true}`).
- `lastError`: Most recent error from check/download/apply.
- `progress`: Download progress `{hash, received, total, progress?}`. For progress-only UI on v10.45.0+, prefer `useUpdateProgress()` so progress ticks do not re-render unrelated `useUpdate()` consumers.
- `currentHash`: Current hot-update version hash.
- `packageVersion`: Current native version number.
- `currentVersionInfo` (v10.31.2+): Sync field with `{name, description, metaInfo}` of current hot-update version.

For detailed error handling on v10.46.0+, use stable `UpdateError.code` values and `client.onError()`. Keep `lastError` as the normal provider/UI path and as the fallback for older integrations. For `getUpdateMetadata()`, crash reporters, and source-map matching, see [modern-integration.md](modern-integration.md).

### Native cold-start recovery (v10.52.1+)
- Keep the native check enabled by default. It runs once per cold start after a short delay, off the startup path, and reuses its response in the JS check.
- Treat this as a native capability: upgrade the SDK, rebuild every platform, upload the new native baseline, and verify one healthy launch before relying on recovery. Do not claim an OTA package can retrofit it into an older binary.
- `checkStrategy` controls automatic activation authority, not whether the native request runs. With `checkStrategy: null`, the native side may download but does not activate normally.
- `silentAndNow` / `silentAndLater` with automatic checks enabled allow a native-downloaded version to activate on the next launch. Alert/custom strategies leave normal activation to JS.
- A dashboard version marked `forceBoot` may activate on the next launch regardless of those strategies. Device-local rollback protection still rejects a version already rolled back on that device.
- Android and iOS can briefly hold a process dying from an uncaught JS startup error to finish rescue. Do not promise recovery for native crashes, ANRs, OOM kills, or iOS apps that replace React Native's fatal handler.
- Downloads resume across process death. Harmony does not use the crash-time hold; its native check and resumable download continue independently of a failed JS startup.
- Set `disableNativeCheck: true` only when the background request itself violates traffic, battery, privacy, or consent requirements. State explicitly that this gives up automatic recovery for a JS-bricked app.

## 7) Native touchpoints

### iOS
- Import the native module outside debug/flipper conditionals:
  - Objective-C / Objective-C++: `#import "RCTPushy.h"`
  - Swift: `import react_native_update`
- In release mode, use `RCTPushy.bundleURL()` for the bundle URL.
- For RN >= 0.74, update `bundleURL`.
- For RN < 0.74, update `sourceURLForBridge`.
- Keep DEBUG bundle behavior unchanged.
- In mixed native/RN apps, initialize the bridge with a delegate and then create the root view with `initWithBridge`; do not pass a fixed release `bundleURL` directly to the root view.
- After any iOS native change, rebuild the app.

### Android
- Import `cn.reactnative.modules.update.UpdateContext`.
- RN 0.82+ / New Architecture `ReactHost`: pass `jsBundleFilePath = UpdateContext.getBundleUrl(this)` into `getDefaultReactHost(...)`.
- RN 0.81 or lower `DefaultReactNativeHost`: override `getJSBundleFile()` and return `UpdateContext.getBundleUrl(this@MainApplication)`.
- Java `DefaultReactNativeHost`: override `protected String getJSBundleFile()` and return `UpdateContext.getBundleUrl(MainApplication.this)`.
- Brownfield/custom `ReactInstanceManager`: call `.setJSBundleFile(UpdateContext.getBundleUrl(context, "assets://index.android.bundle"))` and do not also set `setBundleAssetName`.
- If `react-native-screens` is installed, register `RNScreensFragmentFactory` in `MainActivity.onCreate`; do not put it in `MainActivityDelegate`.
- Disable release PNG crunching with `crunchPngs false` to keep diffs predictable.
- For AAB resource splits, `react-native-update` >= 10.36.0 handles the known image issue. On older versions, disable density splitting.

### Harmony
Minimum native checklist with code examples:

**1. `harmony/entry/src/main/cpp/CMakeLists.txt`**

Add after `add_library(rnoh_app ...)`:

```cmake
set(PUSHY_CPP_DIR "${NODE_MODULES}/react-native-update/harmony/pushy/src/main/cpp")
target_include_directories(rnoh_app PRIVATE "${PUSHY_CPP_DIR}")
target_sources(rnoh_app PRIVATE "${PUSHY_CPP_DIR}/PushyTurboModule.cpp")
```

**2. `harmony/entry/src/main/cpp/PackageProvider.cpp`**

```cpp
#include "RNOH/PackageProvider.h"
#include "PushyPackage.h"
using namespace rnoh;

std::vector<std::shared_ptr<Package>> PackageProvider::getPackages(Package::Context ctx) {
    return {
         std::make_shared<PushyPackage>(ctx)
    };
}
```

**3. `harmony/entry/oh-package.json5`**

Add to dependencies:

```json5
"dependencies": {
  "pushy": "file:../../node_modules/react-native-update/harmony/pushy.har",
}
```

**4. `harmony/hvigor/hvigor-config.json5`**

```json5
{
  dependencies: {
    pushy: "file:../../node_modules/react-native-update/harmony",
  },
}
```

**5. `harmony/entry/hvigorfile.ts`**

```ts
import {hapTasks} from '@ohos/hvigor-ohos-plugin';
import {reactNativeUpdatePlugin} from 'pushy/hvigor-plugin';

export default {
  system: hapTasks /* Built-in plugin of Hvigor. It cannot be modified. */,
  plugins: [
    reactNativeUpdatePlugin(),
  ] /* Custom plugin to extend the functionality of Hvigor. */,
};
```

**6. `harmony/entry/src/main/ets/RNPackagesFactory.ets`**

```ts
import type {
  RNPackageContext,
  RNPackage,
} from '@rnoh/react-native-openharmony';
import PushyPackage from 'pushy';

export function createRNPackages(ctx: RNPackageContext): RNPackage[] {
  return [new PushyPackage(ctx)];
}
```

**7. `harmony/entry/src/main/ets/pages/Index.ets`**

Add `PushyFileJSBundleProvider` into `AnyJSBundleProvider`:

```ts
import { PushyFileJSBundleProvider } from 'pushy';

// Inside RNApp jsBundleProvider:
jsBundleProvider: new TraceJSBundleProviderDecorator(
  new AnyJSBundleProvider([
    new PushyFileJSBundleProvider(this.rnohCoreContext.uiAbilityContext),
    // Note: keep bundle filename as bundle.harmony.js regardless of hermes bytecode
    new ResourceJSBundleProvider(this.rnohCoreContext.uiAbilityContext.resourceManager, 'bundle.harmony.js')
  ]),
  this.rnohCoreContext.logger),
```

**Important**: Keep the bundle file name as `bundle.harmony.js` whether or not Hermes bytecode is used.

**Harmony version info**: The `versionName` field in `harmony/AppScope/app.json5` is recorded as `packageVersion`.

**Build and upload**: Use DevEco-Studio: Build => Build Hap(s)/App(s) => Build App(s). The output is at `harmony/build/outputs/default/harmony-default-unsigned.app`. Upload with `pushy uploadApp <file.app>` or `cresc uploadApp <file.app>`.

## 8) Release baseline and publishing
- Build the native release first and pass the actual build artifact intended for distribution to the global CLI for baseline upload:
  - iOS: `pushy uploadIpa <file.ipa>` or `cresc uploadIpa <file.ipa>`
  - Android APK: `pushy uploadApk <file.apk>` or `cresc uploadApk <file.apk>`
  - Android AAB: `pushy uploadAab <file.aab>` or `cresc uploadAab <file.aab>`
  - Harmony APP: `pushy uploadApp <file.app>` or `cresc uploadApp <file.app>`
- Do not manually slim, re-sign, or rebuild the artifact between distribution and CLI input. Current CLI versions derive and upload a slim server artifact internally; the local input remains the real IPA/APK/AAB/APP intended for users.
- With `react-native-update` >= 10.49.0 and global CLI >= 2.20.3, the client and uploaded baseline identify the embedded JS by `bundleHash`. `bundleStatus` can be `matched`, `rebuiltSameJs`, or `unknownBundle`; an unknown bundle falls back from unsafe incremental artifacts to a full update rather than proving that the whole archive differs byte-for-byte.
- If native code/config changes, or a rebuild changes embedded JS, bump the native version and upload a new baseline. A same-version rebuild with identical JS may be recognized as `rebuiltSameJs`, but do not make repeated same-version rebuilds the release workflow.
- If producing APK and AAB for the same version, build both in the same Gradle invocation, for example:

```json
{
  "scripts": {
    "package:android:release": "cd android && ./gradlew clean assembleRelease bundleRelease"
  }
}
```

- Publish JS/assets-only changes with:
  - `pushy bundle --platform ios|android|harmony`
  - `cresc bundle --platform ios|android|harmony`
- If a framework such as modern Expo has no `index.js`, create one that imports the real entry, for example `import "expo-router/entry";`.
- After publishing the `.ppk`, bind it to one or more uploaded native baselines. Canary rollout can bind one partial rollout and one full rollout per native baseline; client support requires `react-native-update` >= 10.32.0.
- For noninteractive publishing, dry runs, source maps, symbolication, and Hermes-base verification, read [modern-integration.md](modern-integration.md).

## 9) Verification checklist
- [ ] Release build succeeds on target platform.
- [ ] The actual distribution artifact was passed to the global CLI, which registered the corresponding native baseline.
- [ ] `update.json` has the platform `appKey` used by the JS client.
- [ ] App can call check update and returns structured update state.
- [ ] Update package download succeeds.
- [ ] App can switch to new version (now/later behavior as expected).
- [ ] QR/deep-link test path works if used.
- [ ] Rollback behavior understood/tested for crash scenarios.
- [ ] Installed SDK and global CLI versions were read from the actual installation, and versioned features have fallbacks for older supported binaries.
- [ ] On v10.49.0+: release logs/dashboard do not report an unexpected `unknownBundle`; if they do, upload the missing native baseline and expect full-download fallback until fixed.
- [ ] On v10.52.1+: native cold-start check is enabled or explicitly waived, activation policy is understood, and a controlled force-boot recovery has been tested before an emergency.
- [ ] On tvOS: rebuilt SDK 10.58.0+ is in the native binary; test normal and offline launch after cache purge, restore timeout, and reset while restoring.
- [ ] `integration_doctor.sh <app-root> --strict --json` has no missing requirements. Static diagnostics do not replace device Release-build verification.
- [ ] Harmony: all 7 native files configured (CMakeLists.txt, PackageProvider.cpp, oh-package.json5, hvigor-config.json5, hvigorfile.ts, RNPackagesFactory.ets, Index.ets).
- [ ] Harmony: bundle filename is `bundle.harmony.js`.
- [ ] Harmony: `PushyFileJSBundleProvider` comes before `ResourceJSBundleProvider` in `AnyJSBundleProvider`.
- [ ] If using Sentry/profiling SDK: `beforeReload` configured to flush before restart.

## 10) Common pitfalls
- Missing/incorrect `update.json` appKey by platform.
- Mixing Pushy CLI/app keys with `new Cresc(...)`, or Cresc app keys with `new Pushy(...)`.
- Calling `client.checkUpdate()` / `client.downloadUpdate()` directly in normal UI code instead of using `useUpdate()`.
- Maintaining separate long-lived state from both `await checkUpdate()` and `updateInfo`. Use provider state for UI; reserve the return value for contained one-shot actions and handle `undefined`.
- Expecting real apply-update behavior in DEBUG builds.
- Expo project still carrying `expo-updates`.
- Expo project not prebuilt before native changes.
- iOS release still returning the embedded Metro bundle URL instead of `RCTPushy.bundleURL()`.
- Android native host still using `setBundleAssetName("index.android.bundle")` instead of `UpdateContext.getBundleUrl(...)`.
- `react-native-screens` blank screen after OTA restart because `RNScreensFragmentFactory` is missing.
- The artifact passed to the global CLI is not the build intended for distribution, or it was rebuilt/re-signed in a way that changed the embedded bundle before distribution.
- Rebuilding the same native version and distributing it without uploading the new baseline.
- Treating `unknownBundle` as a network error. It means the installed embedded bundle is not registered; full update remains the safe fallback until its baseline is uploaded.
- Android release PNG crunching or old AAB density split behavior changing asset bytes.
- iOS pods not installed after dependency update.
- Native file edits not followed by full rebuild.
- Treating `metaInfo` as an object or trusting a TypeScript assertion after JSON.parse. Validate its runtime shape and fail closed.
- Harmony: using wrong bundle filename. Must be `bundle.harmony.js` regardless of Hermes bytecode usage.
- Harmony: missing `PushyFileJSBundleProvider` in `AnyJSBundleProvider` — it must come before the `ResourceJSBundleProvider` fallback.
- Harmony: missing `reactNativeUpdatePlugin()` in `hvigorfile.ts`.
- Harmony: missing `PushyTurboModule.cpp` in `CMakeLists.txt`.
- App uses native SDKs with cross-thread work (Sentry profiling, etc.) and calls `switchVersion()` or `restartApp()` without configuring `beforeReload` — can cause crashes or data loss during restart.
- Assuming `checkStrategy: null` disables the v10.52.1 native request. It only removes normal automatic activation authority; use `disableNativeCheck` only after accepting the loss of brick recovery.
- Shipping OTA JS that requires a newer native method into an older binary without a capability guard or fallback.

## 11) Example: class component integration
Use this when the app root is still class-based.

```tsx
import React from 'react';
import { Platform } from 'react-native';
import { Pushy, UpdateProvider } from 'react-native-update';
import App from './App';
import updateConfig from './update.json';

const { appKey } = updateConfig[Platform.OS as 'ios' | 'android'];

const pushyClient = new Pushy({
  appKey,
  checkStrategy: 'onAppStart',
  updateStrategy: 'alertUpdateAndIgnoreError',
});

export default class Root extends React.Component {
  render() {
    return (
      <UpdateProvider client={pushyClient}>
        <App />
      </UpdateProvider>
    );
  }
}
```

For Cresc, replace `Pushy` with `Cresc`.

## 12) Example: custom whitelist (gray release)
Use `metaInfo` and your own user/device attributes to decide whether to apply update. Copy [rollout-whitelist.ts](rollout-whitelist.ts) into the app beside this hook. Its tested `isUserAllowed` predicate rejects invalid JSON, null, non-object metadata, non-array or mixed-type allowlists, and substring matches.

Configure the singleton client with `updateStrategy: null` when this hook owns download/apply decisions; do not leave an automatic strategy that bypasses the gate.

```tsx
import { useEffect, useRef } from 'react';
import { useUpdate } from 'react-native-update';
import { isUserAllowed } from './rollout-whitelist';

function useWhitelistGate(currentUserId: string) {
  const { checkUpdate, updateInfo, downloadUpdate, switchVersionLater } = useUpdate();
  const handledHashRef = useRef<string | null>(null);
  const inFlightHashRef = useRef<string | null>(null);

  useEffect(() => {
    void checkUpdate().catch(() => { /* Render lastError from useUpdate() in the UI. */ });
  }, [checkUpdate]);

  useEffect(() => {
    if (!currentUserId) return;
    if (!updateInfo?.update || !updateInfo.hash) return;
    if (handledHashRef.current === updateInfo.hash) return;
    if (inFlightHashRef.current === updateInfo.hash) return;
    if (!isUserAllowed(updateInfo.metaInfo, currentUserId)) return;

    let cancelled = false;
    const hash = updateInfo.hash;
    (async () => {
      inFlightHashRef.current = hash;
      try {
        const ok = await downloadUpdate();
        if (!cancelled && ok) {
          switchVersionLater();
          handledHashRef.current = hash;
        }
      } catch {
        // Use lastError in the UI; never allow an unhandled async rejection.
      } finally {
        if (inFlightHashRef.current === hash) inFlightHashRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUserId, updateInfo, downloadUpdate, switchVersionLater]);
}
```

Notes:
- Keep server-side rollout rules as source of truth; client whitelist is an extra guard, not access control or a substitute for server/native recovery policy.
- Store small, explicit whitelist keys in `metaInfo` such as `allowUsers`. Keep personal data out of public logs and crash-report metadata.
- Prefer phased rollout: internal users -> small percent -> full rollout.
- Treat JSON.parse output as `unknown` and validate it before accessing properties. Missing or malformed metadata must reject this update.
