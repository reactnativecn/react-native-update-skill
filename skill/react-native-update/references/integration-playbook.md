# react-native-update integration playbook

## 1) Fast path
1. Install CLI and SDK in app root:
   - `npm i -g react-native-update-cli`
   - `npm i react-native-update`
2. iOS pod install:
   - `cd ios && pod install`
3. Generate/select app config (`update.json`) with pushy CLI.
4. Wire appKey from `update.json` by platform.
5. Initialize `Pushy` and wrap app with `UpdateProvider`.
6. Build release package and validate update flow.

## 2) App type specifics

### React Native CLI
- Standard install + iOS pods.
- For very old RN or non-standard project structure, manual link may still be needed.

### Expo
- Require modern Expo workflow; run prebuild when needed:
  - `npx expo prebuild`
- Do not co-install `expo-updates` (conflict risk for update behavior).

## 3) Minimum JS wiring
- Read appKey from `update.json` with `Platform.OS`.
- Create `new Pushy({ appKey, ...options })`.
- Wrap app root with `<UpdateProvider client={pushyClient}>`.

## 4) Strategy defaults to discuss
- `checkStrategy`: `both` / `onAppStart` / `onAppResume` / `null`
- `updateStrategy`: `alwaysAlert` / `alertUpdateAndIgnoreError` / `silentAndNow` / `silentAndLater` / `null`
- For custom UI: set `updateStrategy: null`, then use `useUpdate()`.

## 5) Native touchpoints (high level)

### iOS
- Ensure release bundle URL resolves via Pushy bundle method in app delegate flow.
- Keep DEBUG bundle behavior unchanged.

### Android
- Ensure integration point in `MainApplication` (or custom React instance manager path).

## 6) Verification checklist
- [ ] Release build succeeds on target platform.
- [ ] App can call check update and returns structured update state.
- [ ] Update package download succeeds.
- [ ] App can switch to new version (now/later behavior as expected).
- [ ] Rollback behavior understood/tested for crash scenarios.

## 7) Common pitfalls
- Missing/incorrect `update.json` appKey by platform.
- Expecting real apply-update behavior in DEBUG builds.
- Expo project still carrying `expo-updates`.
- iOS pods not installed after dependency update.
- Native file edits not followed by full rebuild.
