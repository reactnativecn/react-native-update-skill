# Modern integration and release diagnostics

Reviewed on 2026-09-27 against [SDK v10.58.1](https://github.com/reactnativecn/react-native-update/releases/tag/v10.58.1) and [CLI v2.28.0](https://github.com/reactnativecn/react-native-update-cli/releases/tag/v2.28.0). Keep the older feature floors in the integration playbook; this is a verified reference snapshot, not a requirement to upgrade every app.

## tvOS and React Native 0.87

[SDK 10.58.0](https://github.com/reactnativecn/react-native-update/releases/tag/v10.58.0) adds `react-native-tvos` support, writable Caches storage, cache-purge restoration, and the iOS/tvOS startup ordering fix. It also fixes nested `expo-modules-core` installations. These are native changes: update pods, rebuild and distribute the native application, and upload the exact new baseline. An OTA alone cannot deliver them.

Apple TV uses `Platform.OS === 'ios'`; select the `ios` entry in `update.json` and use `--platform ios` in the CLI. Do not invent a `tvos` platform option or key. Device information can nevertheless report `tvos <version>` for server-side rollout separation. Verify the actual app records and target baselines rather than assuming a phone and TV share a binary.

The OS can purge tvOS Caches. Test a Release build with the update cache present and absent, online and offline, including a slow restore and a reset during restore. Restoration is not guaranteed offline: a usable embedded bundle must remain available. Do not claim a late restore can replace a launch whose fallback has already been chosen.

[SDK 10.58.1](https://github.com/reactnativecn/react-native-update/releases/tag/v10.58.1) fixes RN 0.87 TypeScript failures involving `AbortSignal`, timer callback types, and `global`. The package distributes TypeScript source, so `skipLibCheck` does not hide these source errors. Upgrading **10.58.0 -> 10.58.1** alone needs no native rebuild; upgrading from an older binary to obtain 10.58.0's native features still does. The release reports type checks on RN 0.87.1, react-native-tvos 0.87.1-1, and an Expo SDK 58 preview; do not present that preview as a stable Expo release.

## Error metadata and source-map identity

The following API and field shapes are verified in [10.58.1 metadata.ts](https://github.com/reactnativecn/react-native-update/blob/v10.58.1/src/metadata.ts), not asserted to have first appeared in that version. Check the installed package's exports before adding imports to an older app.

```ts
import { getUpdateMetadata, attachToSentry, attachToCrashlytics } from 'react-native-update';

const metadata = getUpdateMetadata();
// After initializing the application's existing reporter:
// attachToSentry(Sentry);
// attachToCrashlytics(crashlyticsInstance);
```

`getUpdateMetadata()` is a synchronous snapshot. `attachToSentry(reporter)` and `attachToCrashlytics(reporter)` attach that snapshot to the initialized reporter; they do not install or initialize those reporting SDKs. Refresh the snapshot when needed, such as after startup/mark-success state has changed.

| Field | Meaning |
| --- | --- |
| `currentVersion` | Running OTA version hash; empty means the embedded bundle. Use this OTA hash to select its archived source map. |
| `packageVersion` | Native binary version used for update selection. |
| `bundleHash` | SHA-256 of the embedded baseline; can be empty until computed or when unavailable. It is not the OTA version hash. |
| `bundleSha256` | SHA-256 of the running OTA bundle from its install record. Empty for the embedded bundle or a legacy install. |
| `isFirstTime`, `isRolledBack`, `rolledBackVersion` | First-launch and rollback diagnostics. |
| `rescueSource` | `forceBoot`, `crashRescue`, `purgeRestore`, or `null`. If several apply, priority is in that order. |

Never substitute `bundleHash` for `currentVersion` in `symbolicate --hash`. For an embedded bundle, use the native build's matching map rather than inventing an OTA hash. Native capability data may be absent on old binaries; keep their diagnostic fallback.

**Privacy:** the full reporter helpers also attach `metaInfo` and the per-install `uuid`. A whitelist can contain user identifiers. Do not send that data to a reporter or a public issue without the application's consent/data policy. Use an adapter that selects permitted fields, or attach only the required hashes/version fields manually.

## Noninteractive publishing and source maps

The global CLI remains the command-line interface; install with `npm i -g react-native-update-cli`, then invoke `pushy` or `cresc`. The separate Provider API can be a build-tool dependency when deliberately used as a library. Do not silently replace global CLI instructions with `npx`.

The [v2.28.0 option types](https://github.com/reactnativecn/react-native-update-cli/blob/v2.28.0/src/types.ts) include `packageId`, `packageVersion`, `minPackageVersion`, `maxPackageVersion`, `packageVersionRange`, `rollout`, and `dryRun` for publish/update selection. Read the installed CLI's help, choose one unambiguous targeting method, and inspect the matched native baselines before publishing. Do not use a broad version range as a substitute for native compatibility checks.

Example preview for an already built PPK and its final composed map:

```bash
NO_INTERACTIVE=true RNU_AUTO_UPDATE=0 pushy publish ./app.ppk \
  --platform ios --name "hotfix-001" --description "Reviewed JS-only fix" \
  --packageVersionRange ">=1.2.0 <1.3.0" --rollout 10 \
  --sourcemap ./app.map --dryRun
```

Replace the example paths, version range, and rollout with the app's actual release plan. After checking the preview and obtaining publication approval, rerun without `--dryRun`. A dry run can still authenticate/read server data; it is not an offline test. Keep CI credentials in the host's secret mechanism and never print or commit `.update`.

The [CLI README](https://github.com/reactnativecn/react-native-update-cli/blob/v2.28.0/README.md) documents automatic composed source-map creation for Hermes, enabled by default since CLI 2.23. `bundle` publishing archives the final map; for a PPK built elsewhere, provide `publish --sourcemap <final.map>`. Keep the map that actually belongs to the uploaded bundle, not an intermediate Metro-only map.

```bash
pushy symbolicate stack.txt --hash <running-OTA-currentVersion> --platform ios
# --versionId can select the archived version instead; '-' reads stdin.
```

For Sentry, use the app's `@sentry/react-native/metro` integration so the bundle and composed map share the Debug ID. Legacy self-hosted setups can use explicit `--sentry-release` and `--sentry-dist`; runtime values must match exactly. Do not infer release/dist from the native version and assume they identify every OTA.

## Hermes base verification and cache diagnostics

The [v2.28.0 CLI README](https://github.com/reactnativecn/react-native-update-cli/blob/v2.28.0/README.md) documents:

- `--hermesBase auto` (default), `--hermesBase none`, or a compatible local `.hbc`, `.ppk`, `.apk`, or `.ipa` base.
- `--verifyHermesBase` enabled by default. A rejected/unreadable/timed-out comparison falls back to the plain compile. A failure of the plain compiler or final source map is still a build failure.
- `pushy cache` / `pushy cache clean`, `PUSHY_CACHE_DIR`, and `--cacheMaxMb` for the downloaded base cache; `--resetCache false` separately reuses Metro's transform cache.
- `PUSHY_HERMES_BASE_DEBUG=1` to retain comparison dumps when reproducing a defect.

Keep equivalence verification enabled. To isolate a base-related failure, explicitly test `--hermesBase none`; do not make disabling verification the production workaround. Check compiler compatibility, the actual base identity, fallback outcome, and source-map generation before approving a release.

[CLI 2.28.0](https://github.com/reactnativecn/react-native-update-cli/releases/tag/v2.28.0) redacts uploaded Hermes-base verification details and adds a grouping fingerprint, but **local console output and retained diagnostics remain unredacted**. Review paths, strings, identifiers, and credentials before sharing logs. Server-side redaction does not make a raw CI log safe to publish.

## Interpreting the doctor

```bash
scripts/integration_doctor.sh /path/to/app
scripts/integration_doctor.sh /path/to/app --strict --json
```

The shell entry point requires Node.js. Default mode reports findings and exits zero unless the diagnostic itself fails. `--strict` returns 2 for missing requirements (dependency/config/appKey); runtime or usage errors return 1. Warnings such as heuristic native-integration misses remain warnings, since Expo and custom native layouts need manual interpretation.

JSON contains `schema`, `appRoot`, `checks`, `summary`, and `nativeBinaryVerified: false`. Installed JS version, Podfile.lock, and matching source text are distinct build inputs, not proof of the native code on a device. Finish with Release-build/native baseline tests. The doctor disables CLI auto-update during its version probe and does not execute app JS.
