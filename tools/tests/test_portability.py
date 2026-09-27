"""Project portability contracts, not an end-to-end agent compatibility matrix."""
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "skill/react-native-update"
SPEC = importlib.util.spec_from_file_location("portable_packaging", ROOT / "tools/package_skill.py")
packaging = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(packaging)


class PortabilityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="skill portability ")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def test_entrypoint_uses_portable_frontmatter(self):
        text = (SOURCE / "SKILL.md").read_text()
        self.assertTrue(text.startswith("---\n"))
        frontmatter = text.split("---\n", 2)[1]
        fields = dict(re.findall(r"^([a-z-]+): (.+)$", frontmatter, re.MULTILINE))
        self.assertEqual(set(fields), {"name", "description", "compatibility"})
        self.assertEqual(fields["name"], SOURCE.name)
        self.assertLessEqual(len(fields["description"]), 1024)
        self.assertGreater(len(fields["description"]), 0)
        self.assertLessEqual(len(fields["compatibility"]), 500)
        self.assertIn("no host-specific tools", fields["compatibility"])
        # Host-specific permissions, triggers, and tool names stay out of the core.
        self.assertNotIn("allowed-tools:", frontmatter)
        self.assertNotIn("$react-native-update", text)

    def test_example_lock_has_no_default_agent_or_pretrusted_snapshot(self):
        example = json.loads((ROOT / "skills-lock.example.json").read_text())
        self.assertEqual(example["schema"], 1)
        self.assertEqual(len(example["skills"]), 1)
        skill = example["skills"][0]
        self.assertEqual(skill["source"]["path"], "skill/react-native-update")
        self.assertEqual(skill["installations"], [])
        self.assertEqual(skill["locked"], {})
        self.assertEqual(skill["policy"]["autoUpdate"], "docs-only")

    def test_common_resources_have_no_fixed_host_workspace(self):
        files = [ROOT / "README.md", ROOT / "skills-lock.example.json", SOURCE / "SKILL.md"]
        files += [file for directory in [SOURCE / "scripts", SOURCE / "references"]
                  for file in directory.rglob("*") if file.is_file()]
        host_path = re.compile(r"\.(?:openclaw|codex|claude|cursor|opencode)[/\\]", re.IGNORECASE)
        for file in files:
            with self.subTest(file=str(file.relative_to(ROOT))):
                self.assertIsNone(host_path.search(file.read_text()))

    def test_installer_lock_name_does_not_conflict_with_skills_cli(self):
        readme = (ROOT / "README.md").read_text()
        self.assertIn("cp skills-lock.example.json skill-updates.local.json", readme)
        self.assertNotIn("into your OpenClaw skills environment", readme)
        self.assertIn("skill-updates.local.json", (ROOT / ".gitignore").read_text().splitlines())
        commands = re.findall(r"^npx skills add .+$", readme, re.MULTILINE)
        self.assertEqual(commands, ["npx skills add reactnativecn/react-native-update-skill --skill react-native-update"])

    def test_archive_can_be_relocated_and_relative_resources_resolve(self):
        archive = self.root / "download.skill"
        packaging.build(SOURCE, archive)
        packaging.verify(SOURCE, archive)
        elsewhere = self.root / "unrelated host" / "skill store"
        with zipfile.ZipFile(archive) as package:
            package.extractall(elsewhere)
        installed = elsewhere / "react-native-update"
        for relative in ["SKILL.md", "references/integration-playbook.md", "references/modern-integration.md",
                         "references/rollout-whitelist.ts", "scripts/integration_doctor.mjs", "scripts/integration_doctor.sh"]:
            self.assertEqual((installed / relative).read_bytes(), (SOURCE / relative).read_bytes())
        refs = re.findall(r"`((?:references|scripts)/[^`<>\s]+)`", (installed / "SKILL.md").read_text())
        self.assertTrue(refs)
        for relative in refs:
            self.assertTrue((installed / relative).exists(), relative)

    def test_core_package_does_not_require_host_metadata(self):
        portable = self.root / "portable source"
        shutil.copytree(SOURCE, portable)
        shutil.rmtree(portable / "agents")
        archive = self.root / "portable.zip"
        packaging.build(portable, archive)
        packaging.verify(portable, archive)
        with zipfile.ZipFile(archive) as package:
            self.assertFalse(any("/agents/" in name for name in package.namelist()))
            for name in package.namelist():
                relative = Path(name).relative_to("react-native-update")
                self.assertEqual(package.read(name), (SOURCE / relative).read_bytes())

    def test_direct_node_diagnostic_without_host_metadata_or_bash(self):
        node = shutil.which("node")
        if node is None:
            self.skipTest("Node.js is needed for the optional diagnostic smoke test")
        installed = self.root / "custom host" / "react-native-update"
        shutil.copytree(SOURCE, installed)
        shutil.rmtree(installed / "agents")
        app = self.root / "app with spaces"
        app.mkdir()
        (app / "package.json").write_text(json.dumps({"dependencies": {"react-native-update": "10.58.1"}}))
        (app / "update.json").write_text(json.dumps({"ios": {"appKey": "fixture-do-not-print"}}))
        (app / "App.tsx").write_text("new Pushy({ appKey }); <UpdateProvider />")
        dependency = app / "node_modules/react-native-update"
        dependency.mkdir(parents=True)
        (dependency / "package.json").write_text(json.dumps({"name": "react-native-update", "version": "10.58.1"}))
        home, empty_bin, cwd = [self.root / name for name in ["empty home", "empty bin", "unrelated cwd"]]
        for directory in [home, empty_bin, cwd]:
            directory.mkdir()
        # Run an absolute Node executable with no host workspace or shell on PATH.
        result = subprocess.run([str(Path(node).resolve()), str(installed / "scripts/integration_doctor.mjs"),
                                 str(app), "--strict", "--json"], cwd=cwd,
                                env={"PATH": str(empty_bin), "HOME": str(home), "USERPROFILE": str(home)},
                                capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        report = json.loads(result.stdout)
        self.assertFalse(report["nativeBinaryVerified"])
        self.assertEqual(Path(report["appRoot"]), app)
        self.assertEqual(report["summary"]["missing"], 0)
        self.assertNotIn("fixture-do-not-print", result.stdout)
        self.assertEqual(list(home.iterdir()), [])
        self.assertEqual(list(cwd.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
