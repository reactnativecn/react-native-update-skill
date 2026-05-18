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
