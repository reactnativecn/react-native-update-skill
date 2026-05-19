# react-native-update-skill

Skill package for integrating **react-native-update** with Pushy or Cresc in React Native, Expo prebuild, HarmonyOS, and brownfield projects.

## Contents
- `skill/react-native-update/` - skill source (SKILL.md, references, scripts)
- `react-native-update.skill` - packaged distributable skill

## Install
Import `react-native-update.skill` into your OpenClaw skills environment.

For Skills CLI environments:

```bash
npx skills add reactnativecn/react-native-update-skill --skill react-native-update -a '*'
```

## Scope
- Pushy/Cresc service routing
- `update.json` / `appKey` wiring
- iOS, Android, Expo, HarmonyOS, and brownfield checkpoints
- `UpdateProvider`, `useUpdate`, strategies, hooks, and `metaInfo` flows
- Release baseline upload and hot update publishing checks
- Common conflict checks such as `expo-updates`, Android bundle URL misses, iOS bundle URL misses, and release asset diff pitfalls

## Auto Update Manager
Skills should not update themselves while running. Use the host or installer layer to check and apply updates.

This repo includes a small manager that implements the recommended policy:

```bash
cp skills-lock.example.json skills-lock.json
node tools/skill-update-manager.mjs lock --lock skills-lock.json --write
node tools/skill-update-manager.mjs check --lock skills-lock.json
node tools/skill-update-manager.mjs update --lock skills-lock.json
```

Default behavior:
- Records source repo, ref, commit, file hash, script hash, pin state, and install paths in the lockfile.
- Skips entries with `"pinned": true`.
- Allows automatic non-script updates after `lock --write` has recorded content hashes.
- Blocks changes under `scripts/` unless you rerun with `--allow-scripts` after review.
- Blocks updates from an uninitialized lockfile because script changes cannot be classified safely.
- Backs up the previous installed skill directory before replacing it.

Edit `installations` in `skills-lock.json` for each local skill host you want the manager to maintain.
For a timer or startup hook, run `check` first and only run `update` when the host policy allows it.
