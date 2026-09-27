# react-native-update-skill

A **host-neutral Agent Skill** for integrating **react-native-update** with Pushy or Cresc in React Native, Expo prebuild, tvOS, HarmonyOS, and brownfield projects. It is intended for **any agent that supports Agent Skills**, not only OpenClaw or any other specific host, model, or plugin system.

## Install in your agent

The portable source is the complete [`skill/react-native-update/`](skill/react-native-update/) directory. Its entry point is `SKILL.md`; references and optional diagnostic scripts travel with it. The [Agent Skills specification](https://agentskills.io/specification) defines this directory format, not a universal installation path or archive-import mechanism.

### Use your host's skill installer or directory

Point your agent's documented skill installer at this repository and select `skill/react-native-update`, or copy that entire directory into a skill location supported by your host. Keep the directory name `react-native-update` and preserve its contents:

```text
<your-host-supported-skills-directory>/
└── react-native-update/
    ├── SKILL.md
    ├── references/
    ├── scripts/
    └── agents/          # Optional host-specific metadata
```

Use the host's documented project-level or user-level discovery path; do not assume another agent's directory is supported. Reload or enable the skill as that host requires. Copying only `SKILL.md` drops its supporting resources. Hosts without local filesystem access need their own upload/import mechanism or a way to expose the same relative resources.

### Use the optional Skills CLI

For agents supported by the third-party [Skills CLI](https://github.com/vercel-labs/skills), run:

```bash
npx skills add reactnativecn/react-native-update-skill --skill react-native-update
```

Choose the intended agent and installation scope in the installer. Use its documented `--agent` and `--global` options for explicit targeting; installing to all agents is optional, not a requirement. The Skills CLI's supported-agent list does not define this skill's audience: other compatible hosts can use the directory directly. This `npx skills` command installs the **skill**, not the separate Pushy/Cresc OTA CLI, which keeps its existing global-install workflow.

### Use a release archive

Download `react-native-update.skill` and `SHA256SUMS` from the [latest release](https://github.com/reactnativecn/react-native-update-skill/releases/latest) and verify the checksum. The `.skill` file is a **ZIP archive**, not an OpenClaw-specific runtime or a format every host necessarily imports directly.

If the host explicitly supports this archive layout, use its importer. Otherwise extract the archive (rename a copy to `.zip` when required by your archive tool), then install the enclosed `react-native-update/` directory as above. Follow any host-specific repackaging requirements. CI builds the repository-root archive from the same source directory before tagging a release.

## Host compatibility and optional adapters

All integration instructions live in `SKILL.md` and `references/`; no OpenClaw service, host plugin, fixed workspace directory, or named agent tool is required to read them. Installation and tool permissions remain the host's responsibility. An agent without execution tools can still use the guidance and provide commands for the user, but must report diagnostic/build checks as **not run**.

[`agents/openai.yaml`](skill/react-native-update/agents/openai.yaml) is optional UI/invocation metadata for hosts that recognize that extension, as described in the [OpenAI skill documentation](https://developers.openai.com/codex/skills). It is not a dependency or an agent allowlist. Other hosts can ignore or omit it; the core workflow must remain usable without the entire `agents/` directory. Do not move essential instructions or required tools into a host-specific adapter.

Optional diagnostic execution needs Node.js 22+ and access to the app files. The `.mjs` entry point does not require Bash; the `.sh` wrapper additionally requires Bash. Reading the skill needs neither runtime. Native builds and publishing still require the app's own platform toolchain, credentials, network access, and user authorization.

## Scope

- Pushy/Cresc service routing, `update.json`/`appKey`, one client and one provider.
- React Native, Expo, iOS/tvOS, Android, HarmonyOS, monorepo and brownfield integration.
- Backward-compatible native feature floors, recovery, rollback, and runtime-validated rollout examples.
- Crash metadata, exact source-map identity, noninteractive publishing and Hermes-base diagnostics.

The current guide was reviewed against SDK **10.58.1** and CLI **2.28.0** on 2026-09-27. These are reference versions, not blanket minimum requirements. See [the playbook](skill/react-native-update/references/integration-playbook.md) and [modern integration notes](skill/react-native-update/references/modern-integration.md).

## Optional host-neutral update manager

Skills should not update themselves while running. Use the installer that owns the installation, or this repository's optional standalone manager for explicitly configured directory copies. It requires Node.js 22+ and Git and does not discover, install, or require an agent application.

The example starts with **no installation targets and no trusted hashes**. Before initializing the review baseline, add your own targets to the skill's `installations` array, for example:

```json
{
  "agent": "your-host-label",
  "path": "/absolute/path/to/your/host/skills/react-native-update"
}
```

Replace the path with a real host-supported location. `agent` is an optional descriptive label, not a registry or allowlist; `path` determines the destination. Multiple non-overlapping targets may belong to different hosts. An empty target list reports `no-installations` and writes no skill into a default host directory.

```bash
cp skills-lock.example.json skill-updates.local.json
# Edit installation paths, inspect the upstream content, and review scripts first.
node tools/skill-update-manager.mjs lock --lock skill-updates.local.json --write
node tools/skill-update-manager.mjs check --lock skill-updates.local.json --fail-on-update
node tools/skill-update-manager.mjs update --lock skill-updates.local.json --dry-run
node tools/skill-update-manager.mjs update --lock skill-updates.local.json
```

`skill-updates.local.json` uses this manager's own schema. It is **not** the Skills CLI's `skills-lock.json`; do not interchange them. Keep using the owning installer to update symlinked installations: this manager deliberately rejects symbolic links. Do not run two installers against the same target.

`check --fail-on-update` returns 2 when installation/update work is needed. Treat that as a signal to inspect the result, not a command to blindly approve script changes.

`locked` records the reviewed upstream snapshot. It does **not** prove that anything is installed. Each installation gains separate `installed` metadata only after its contents have been verified or successfully installed. Existing schema-1 lockfiles remain usable; the manager always compares actual files, even when the commit matches, so absent, deleted, or stale installations are repaired.

The default `docs-only` policy blocks uninitialized/unreviewed script changes. Review the diff before running `lock --write` or `update --allow-scripts`. A review lock is an explicit trust decision; do not refresh it automatically just to bypass the script gate. Entries with `pinned: true` are skipped. `--dry-run` does not change installation directories or the lock.

For each skill, every target is staged and hash-verified before live directories are switched. A failure rolls back already-switched targets; backups have unique paths under `.skill-update-backups` beside each installation. Successful backups are retained for manual recovery. If rollback itself fails, the error identifies the retained backup path. Overlapping targets, symbolic links, and special files are rejected rather than silently ignored. Serialize installer runs; do not run concurrent managers against the same directories.

## Diagnostics

From a checkout of this repository, invoke Node.js directly:

```bash
node skill/react-native-update/scripts/integration_doctor.mjs /path/to/app
node skill/react-native-update/scripts/integration_doctor.mjs /path/to/app --strict --json
```

After installing the skill, resolve `scripts/integration_doctor.mjs` relative to its installed `SKILL.md`, not relative to the app root or an assumed host workspace. Pass the app root as the separate argument. On hosts with Bash, the adjacent `integration_doctor.sh` wrapper remains supported. Without execution access or Node.js, use the playbook's manual verification checklist and state which checks were not run.

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

CI runs the existing manager suite, regression tests, and packaging checks on Linux and macOS. Portability regressions cover neutral configuration, resource relocation, and direct Node diagnostics without host metadata or Bash. These are format/tooling checks, not a claim of end-to-end testing in every agent product.

On `main`, the release job regenerates and commits only the distribution package, then publishes the version from `VERSION` with notes from `releases/v<version>.md`. It does not overwrite a published release. Tests must pass before publishing; `.skill` and checksums are uploaded directly as Release assets, not Actions artifacts.

To publish another version, update `VERSION`, add its release notes, and push the reviewed change to `main`. Branch protection, when configured, must permit the package-sync commit; the workflow never force-pushes or bypasses protection. A weekly read-only upstream check compares stable SDK/CLI releases with `upstream-versions.json` and fails visibly when the guide needs review.
