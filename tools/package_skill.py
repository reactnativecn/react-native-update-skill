#!/usr/bin/env python3
"""Build or verify the distributable skill without third-party dependencies."""
import argparse
import hashlib
import os
from pathlib import Path
import stat
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "skill" / "react-native-update"
ARCHIVE = ROOT / "react-native-update.skill"
EPOCH = (1980, 1, 1, 0, 0, 0)


def source_entries(source: Path):
    if source.is_symlink() or not source.is_dir():
        raise ValueError("Skill source must be a real directory")
    entries = []
    for directory, dirs, files in os.walk(source, followlinks=False):
        dirs.sort()
        for name in dirs + sorted(files):
            file = Path(directory) / name
            if file.is_symlink():
                raise ValueError(f"Symlinks are not supported: {file}")
        for name in sorted(files):
            file = Path(directory) / name
            if not file.is_file():
                raise ValueError(f"Not a regular file: {file}")
            relative = file.relative_to(source).as_posix()
            if any(part in {".git", "__pycache__", ".DS_Store"} for part in Path(relative).parts):
                raise ValueError(f"Unexpected generated or private file in skill: {relative}")
            mode = 0o755 if file.stat().st_mode & 0o111 else 0o644
            entries.append((f"react-native-update/{relative}", file.read_bytes(), mode))
    if not any(name == "react-native-update/SKILL.md" for name, _, _ in entries):
        raise ValueError("Skill source is missing SKILL.md")
    return sorted(entries)


def verify(source: Path, archive: Path):
    expected = source_entries(source)
    with zipfile.ZipFile(archive) as package:
        if package.namelist() != [name for name, _, _ in expected]:
            raise ValueError("Archive paths/order differ from source (missing, extra, or duplicate entries)")
        for name, data, mode in expected:
            info = package.getinfo(name)
            if package.read(name) != data:
                raise ValueError(f"Archive content differs: {name}")
            if (info.external_attr >> 16) != (stat.S_IFREG | mode):
                raise ValueError(f"Archive mode differs: {name}")
            if info.date_time != EPOCH or info.compress_type != zipfile.ZIP_STORED:
                raise ValueError(f"Non-deterministic archive metadata: {name}")
            if info.extra or info.comment or info.create_system != 3:
                raise ValueError(f"Unexpected archive metadata: {name}")
        if package.comment:
            raise ValueError("Unexpected archive comment")
    return len(expected)


def build(source: Path, archive: Path):
    entries = source_entries(source)
    archive.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".skill-package-", dir=archive.parent)
    os.close(fd)
    temporary = Path(name)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED) as package:
            for entry, data, mode in entries:
                info = zipfile.ZipInfo(entry, EPOCH)
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | mode) << 16
                info.compress_type = zipfile.ZIP_STORED
                package.writestr(info, data)
        verify(source, temporary)
        temporary.chmod(0o644)
        temporary.replace(archive)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify an existing package without modifying it")
    parser.add_argument("--output", type=Path, default=ARCHIVE)
    args = parser.parse_args()
    if not args.check:
        build(SOURCE, args.output)
    count = verify(SOURCE, args.output)
    print(f"Verified {count} files: {args.output}")
    print(f"sha256: {hashlib.sha256(args.output.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()
