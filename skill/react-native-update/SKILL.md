---
name: react-native-update
description: React Native Update / Pushy hot-update integration assistant（react-native-update 集成助手）for React Native CLI and Expo projects. Use for 安装配置, appKey/update.json 接线, iOS/Android 原生改动, 更新策略（checkStrategy/updateStrategy）, expo-updates 冲突排查, and 热更新接入 troubleshooting.
---

# React Native Update Integration

## Overview
Use this skill to get a project from “not integrated” to “hot update works in release builds”.
Prioritize copy-paste-safe steps, smallest viable changes, and explicit verification checkpoints.

## Workflow
1. Detect app type (React Native CLI vs Expo) and target platforms.
2. Apply dependency/install steps from `references/integration-playbook.md`.
3. Apply required native config (Bundle URL / MainApplication integration points).
4. Add `Pushy` client + `UpdateProvider` minimal bootstrapping.
5. Run `scripts/integration_doctor.sh <app-root>` to detect common misses.
6. Return a short action list: done / missing / next verification.

## Guardrails
- Keep user code changes minimal and localized.
- Do not promise hot update works in debug mode; emphasize release verification.
- Warn about `expo-updates` conflict in Expo projects.
- Preserve existing app architecture; adapt snippets to current project style.
- If native files differ heavily (monorepo/mixed native), provide targeted patch guidance instead of broad rewrites.

## Outputs to provide
- Minimal integration diff (exact files and snippets).
- Verification checklist (build, check update, download, switch version).
- Troubleshooting hints for common failures.

## Resources
- Read `references/integration-playbook.md` before giving steps.
- Use `scripts/integration_doctor.sh` for quick project diagnosis.
