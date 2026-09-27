---
name: react-native-update
description: Integrate and troubleshoot React Native Update OTA for Pushy and Cresc. Use when wiring react-native-update into React Native CLI, Expo prebuild, tvOS/react-native-tvos, HarmonyOS, brownfield, monorepo, or mixed native apps; configuring update.json/appKey, Pushy/Cresc clients, UpdateProvider/useUpdate, native bundle loading, release baseline upload, native cold-start recovery/forceBoot/purgeRestore, bundleHash and error metadata, source maps, checkStrategy/updateStrategy, canary/metaInfo flows, Hermes-base verification, expo-updates conflicts, or OTA failures.
---

# React Native Update / Pushy / Cresc

## Overview
Use this skill to get a project from "not integrated" to "hot update works in release builds".
Prioritize copy-paste-safe steps, smallest viable changes, and explicit verification checkpoints.

## Service routing
- Use **Pushy** for the China service: `pushy` CLI, `new Pushy(...)`, Pushy dashboard.
- Use **Cresc** for the global service: `cresc` CLI, `new Cresc(...)`, Cresc dashboard.
- Keep CLI, dashboard, app records, `update.json`, and JS client class on the same service. Do not mix `pushy createApp` with `new Cresc(...)`, or the reverse.
- If the service is unknown, infer from user wording, existing imports, registry/domain, or docs locale. If still unknown, implement the neutral structure and call out the one line the user must choose: `Pushy` vs `Cresc`.

## Workflow
1. Detect app root, package manager, installed React Native/Expo/react-native-update versions, global CLI version, service, and target platforms (`ios`, `android`, `harmony`; Apple TV uses `ios`).
2. Read `references/integration-playbook.md` before giving or applying steps. Also read `references/modern-integration.md` for tvOS, RN 0.87, metadata/source maps, noninteractive publishing, and Hermes-base diagnostics.
3. Install `react-native-update` in the app and install `react-native-update-cli` globally. Invoke `pushy` or `cresc` directly; do not switch the workflow to a project-local CLI or `npx`.
4. Configure native bundle loading for the detected platform and app shape:
   - iOS/tvOS `RCTPushy.bundleURL()` or Expo auto integration.
   - Android `UpdateContext.getBundleUrl(...)` through `ReactHost`, `ReactNativeHost`, or custom instance manager.
   - Harmony package/provider/bundle-provider wiring.
   - Brownfield runtime hook instead of changing host inheritance.
5. Add a single `Pushy` or `Cresc` client outside the root component and wrap the real app tree with `UpdateProvider`.
6. Run `scripts/integration_doctor.sh <app-root>` and fix actionable misses. Use `--strict --json` for automation; missing requirements return 2, diagnostic errors return 1. Static checks never verify the device's native binary.
7. Finish with release-build verification, baseline upload, and hot-update publish checks when the user wants an end-to-end integration.

## Guardrails
- Keep user code changes minimal and localized.
- Preserve backward compatibility. Check the installed SDK and the native binary's capability before using a versioned feature. Do not ship JS that blindly calls a native method absent from older installed binaries; feature-detect it or retain the older flow. A new native capability requires a new native release and baseline, not only an OTA package.
- Do not promise apply-update behavior in debug mode. `debug: true` can help check/download in development, but applying patches requires a release build.
- Warn about `expo-updates` conflict in Expo projects.
- Prefer `useUpdate()` methods and state over direct `client` calls. Only call the client directly for a clearly necessary low-level integration escape hatch, and explain why.
- Prefer `updateInfo`/`lastError` from `useUpdate()` for UI and long-lived flows. `checkUpdate()` also returns `CheckResult | undefined`, so using its return value is valid for a contained one-shot action; handle `undefined` as skipped/failed and avoid building a second state machine beside the provider.
- Keep exactly one `Pushy` or `Cresc` client and one mounted `UpdateProvider` per process. The SDK is process-singleton state.
- Preserve existing app architecture; adapt snippets to current project style.
- If native files differ heavily (monorepo/mixed native), provide targeted patch guidance instead of broad rewrites.
- Treat JS/assets as OTA-safe. Native code, native config, native assets, pods, Gradle settings, HAR/AAR/XCFramework contents, and manifests require a new native release and baseline upload.
- If the app uses native SDKs that work across threads (Sentry profiling, performance sampling), recommend `beforeReload` (v10.42.2+) to clean up before `switchVersion()` or `restartApp()`.
- For native cold-start recovery, require `react-native-update` >= 10.52.1 on every target native binary. Keep it enabled unless the integrator explicitly accepts losing brick recovery; `checkStrategy: null` does not disable the native request.
- tvOS support and purge-restore fixes require a rebuilt native app with SDK 10.58.0+. The 10.58.0 -> 10.58.1 RN 0.87 TypeScript fix alone is JS-only. Do not use `skipLibCheck` as a substitute for the source-level fix.
- Parse `metaInfo` as `unknown` and validate its runtime shape. Use `references/rollout-whitelist.ts`; malformed data must reject the rollout rather than crash or match a substring. A client whitelist is not authorization.
- Keep Hermes-base equivalence verification enabled. Retained logs may expose raw strings/paths even though CLI 2.28.0 redacts the uploaded report.
- Crash-reporter helpers can include `metaInfo` and `uuid`. Apply the app's privacy policy; never publish raw user identifiers or credentials with a diagnostic report.

## Outputs to provide
- Minimal integration diff with exact files and snippets.
- Verification checklist: release build, baseline upload, check update, download, switch now/later, rollback behavior.
- Compatibility statement: installed SDK/native floor, guarded fallbacks, and which changes require a new store/native release.
- Recovery statement for 10.52.1+: native cold-start check, activation policy, force-boot path, crash-rescue limits, and `disableNativeCheck` tradeoff.
- Troubleshooting hints for common failures, including exact OTA/source-map identity when debugging errors.
- Scenario examples when requested: class component root, custom UI, `metaInfo` rollout gates, QR/deep-link testing, brownfield integration, canary rollout, and tvOS cache purge.
- Harmony-specific guidance with complete file-by-file code examples (CMakeLists.txt, PackageProvider.cpp, oh-package.json5, hvigor-config.json5, hvigorfile.ts, RNPackagesFactory.ets, Index.ets).

## Resources
- Read `references/integration-playbook.md` before giving steps.
- Read `references/modern-integration.md` for the SDK 10.58.1 / CLI 2.28.0 reference snapshot and primary sources.
- Copy the tested `references/rollout-whitelist.ts` predicate when implementing a whitelist.
- Use `scripts/integration_doctor.sh` for quick project diagnosis; it requires Node.js and delegates to the adjacent `.mjs` implementation.
