# react-native-update-skill

Skill package for integrating **react-native-update** with Pushy or Cresc in React Native, Expo prebuild, tvOS, HarmonyOS, and brownfield projects.

## Install

Import `react-native-update.skill` from the [latest release](https://github.com/reactnativecn/react-native-update-skill/releases/latest) into your OpenClaw skills environment. Release assets include `SHA256SUMS`. The repository-root package is generated from `skill/react-native-update/` by CI before a release is tagged.

For Skills CLI environments:

```bash
npx skills add reactnativecn/react-native-update-skill --skill react-native-update -a '*'
```

## Scope

- Pushy/Cresc service routing, `update.json`/`appKey`, one client and one provider.
- React Native, Expo, iOS/tvOS, Android, HarmonyOS, monorepo and brownfield integration.
- Backward-compatible native feature floors, recovery, rollback, and runtime-validated rollout examples.
- Crash metadata, exact source-map identity, noninteractive publishing and Hermes-base diagnostics.

The current guide was reviewed against SDK **10.58.1** and CLI **2.28.0** on 2026-09-27. These are reference versions, not blanket minimum requirements. See [the playbook](skill/react-native-update/references/integration-playbook.md) and [modern integration notes](skill/react-native-update/references/modern-integration.md).

## Auto Update Manager

Skills should not update themselves while running. Use the host/installer layer. Node.js 22+ is used for this repository's tooling and tests; this does not change the SDK or CLI's own runtime requirements.

```bash
cp skills-lock.example.json skills-lock.json
# Edit installation paths, inspect the upstream content, and review scripts first.
node tools/skill-update-manager.mjs lock --lock skills-lock.json --write
node tools/skill-update-manager.mjs check --lock skills-lock.json --fail-on-update
node tools/skill-update-manager.mjs update --lock skills-lock.json --dry-run
node tools/skill-update-manager.mjs update --lock skills-lock.json
```

`check --fail-on-update` returns 2 when installation/update work is needed. Treat that as a signal to inspect the result, not a command to blindly approve script changes.

`locked` records the reviewed upstream snapshot. It does **not** prove that anything is installed. Each installation gains separate `installed` metadata only after its contents have been verified or successfully installed. Existing schema-1 lockfiles remain usable; the manager always compares actual files, even when the commit matches, so absent, deleted, or stale installations are repaired.

The default `docs-only` policy blocks uninitialized/unreviewed script changes. Review the diff before running `lock --write` or `update --allow-scripts`. A review lock is an explicit trust decision; do not refresh it automatically just to bypass the script gate. Entries with `pinned: true` are skipped. `--dry-run` does not change installation directories or the lock.

For each skill, every target is staged and hash-verified before live directories are switched. A failure rolls back already-switched targets; backups have unique paths under `.skill-update-backups` beside each installation. Successful backups are retained for manual recovery. If rollback itself fails, the error identifies the retained backup path. Overlapping targets, symbolic links, and special files are rejected rather than silently ignored. Serialize installer runs; do not run concurrent managers against the same directories.

## Diagnostics

```bash
bash skill/react-native-update/scripts/integration_doctor.sh /path/to/app
bash skill/react-native-update/scripts/integration_doctor.sh /path/to/app --strict --json
```

`--strict` returns 2 on missing requirements. Diagnostic/usage failures return 1. Default mode reports findings without treating them as a build gate. JSON always distinguishes static findings from device verification with `nativeBinaryVerified: false`; a JS package version or Podfile.lock does not establish the native capabilities in an installed app.

## Development and releases

```bash
node tools/test-skill-update-manager.mjs
node --experimental-strip-types --test tools/tests/*.test.mjs
python3 -m unittest discover -s tools/tests -p 'test_*.py'
python3 tools/package_skill.py
python3 tools/package_skill.py --check
```

The package builder uses only Python's standard library. It creates a deterministic ZIP with normalized timestamps/permissions and verifies every archived path, byte, and executable bit against the source; no generated archives are added to the skill itself.

CI runs the existing manager suite, regression tests, and packaging checks on Linux and macOS. On `main`, the release job regenerates and commits only the distribution package, then publishes the version from `VERSION` with notes from `releases/v<version>.md`. It does not overwrite a published release. Tests must pass before publishing; `.skill` and checksums are uploaded directly as Release assets, not Actions artifacts.

To publish another version, update `VERSION`, add its release notes, and push the reviewed change to `main`. Branch protection, when configured, must permit the package-sync commit; the workflow never force-pushes or bypasses protection. A weekly read-only upstream check compares stable SDK/CLI releases with `upstream-versions.json` and fails visibly when the guide needs review.
