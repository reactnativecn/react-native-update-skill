import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

SPEC = importlib.util.spec_from_file_location("package_skill", Path(__file__).resolve().parents[1] / "package_skill.py")
packaging = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(packaging)


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / "source"
        self.source.mkdir()
        (self.source / "SKILL.md").write_text("# Test\n")
        (self.source / "scripts").mkdir()
        script = self.source / "scripts" / "test.sh"
        script.write_text("#!/bin/sh\ntrue\n")
        script.chmod(0o755)
        self.output = self.root / "test.skill"

    def test_reproducible_bytes_and_executable_mode(self):
        packaging.build(self.source, self.output)
        first = self.output.read_bytes()
        packaging.build(self.source, self.output)
        self.assertEqual(first, self.output.read_bytes())
        self.assertEqual(packaging.verify(self.source, self.output), 2)
        with zipfile.ZipFile(self.output) as archive:
            self.assertEqual(archive.getinfo("react-native-update/scripts/test.sh").external_attr >> 16, 0o100755)

    def test_stale_content_is_rejected(self):
        packaging.build(self.source, self.output)
        (self.source / "SKILL.md").write_text("changed")
        with self.assertRaisesRegex(ValueError, "content differs"):
            packaging.verify(self.source, self.output)

    def test_stale_mode_is_rejected(self):
        packaging.build(self.source, self.output)
        (self.source / "scripts/test.sh").chmod(0o644)
        with self.assertRaisesRegex(ValueError, "mode differs"):
            packaging.verify(self.source, self.output)

    def test_extra_entry_is_rejected(self):
        packaging.build(self.source, self.output)
        with zipfile.ZipFile(self.output, "a") as archive:
            archive.writestr("unwanted", "extra")
        with self.assertRaisesRegex(ValueError, "paths/order"):
            packaging.verify(self.source, self.output)

    def test_symlink_is_rejected_without_replacing_archive(self):
        packaging.build(self.source, self.output)
        before = self.output.read_bytes()
        (self.source / "link").symlink_to("SKILL.md")
        with self.assertRaisesRegex(ValueError, "Symlinks"):
            packaging.build(self.source, self.output)
        self.assertEqual(self.output.read_bytes(), before)

    def test_missing_entrypoint_is_rejected(self):
        (self.source / "SKILL.md").unlink()
        with self.assertRaisesRegex(ValueError, "missing SKILL.md"):
            packaging.build(self.source, self.output)

    def test_real_skill_includes_referenced_runtime_and_examples(self):
        names = {name for name, _, _ in packaging.source_entries(packaging.SOURCE)}
        for relative in ["SKILL.md", "agents/openai.yaml", "scripts/integration_doctor.sh", "scripts/integration_doctor.mjs", "references/integration-playbook.md", "references/modern-integration.md", "references/rollout-whitelist.ts"]:
            self.assertIn(f"react-native-update/{relative}", names)
        playbook = (packaging.SOURCE / "references/integration-playbook.md").read_text()
        self.assertIn("isUserAllowed(updateInfo.metaInfo, currentUserId)", playbook)
        self.assertNotIn("let meta: { allowUsers?", playbook)
        packaging.build(packaging.SOURCE, self.output)
        self.assertEqual(packaging.verify(packaging.SOURCE, self.output), len(names))


if __name__ == "__main__":
    unittest.main()
