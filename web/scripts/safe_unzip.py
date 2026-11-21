#!/usr/bin/env python3
"""Safe zip tools for the /run upload pipeline. Stdlib only.

  safe_unzip.py extract <zipfile> <destdir>
      Extract with strict safety rules; exits non-zero with a JSON error
      on stdout if the archive is hostile or oversized.

  safe_unzip.py zip <srcdir> <zipfile>
      Deterministically zip a folder (used to package a dev institution
      for the "sample dataset" path, so it exercises the same pipeline).

Safety rules on extract:
  - no absolute paths, no drive letters, no ".." components
  - no symlink or other non-regular/non-dir entries
  - caps: MAX_FILES entries, MAX_BYTES total extracted size
"""

import json
import os
import stat
import sys
import zipfile

MAX_FILES = 20000
MAX_BYTES = 300 * 1024 * 1024  # 300 MB extracted


def fail(msg, **kw):
    print(json.dumps({"ok": False, "error": msg, **kw}))
    sys.exit(3)


def safe_member_name(name):
    """Return a cleaned relative path or None if the entry is unsafe."""
    name = name.replace("\\", "/")
    if name.startswith("/") or (len(name) > 1 and name[1] == ":"):
        return None
    parts = [p for p in name.split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        return None
    return "/".join(parts)


def extract(zip_path, dest):
    try:
        zf = zipfile.ZipFile(zip_path)
    except zipfile.BadZipFile as e:
        fail(f"not a zip file ({e})")
    infos = zf.infolist()
    if len(infos) > MAX_FILES:
        fail(f"too many entries ({len(infos)} > {MAX_FILES})")
    total = 0
    written = 0
    for info in infos:
        clean = safe_member_name(info.filename)
        if clean is None:
            fail(f"unsafe path in archive: {info.filename!r}")
        mode = info.external_attr >> 16
        if stat.S_ISLNK(mode):
            fail(f"archive contains a symlink: {info.filename!r}")
        if info.is_dir():
            os.makedirs(os.path.join(dest, clean), exist_ok=True)
            continue
        if mode and not stat.S_ISREG(mode):
            continue  # skip devices/fifos rather than recreate them
        total += info.file_size
        if total > MAX_BYTES:
            fail(f"archive too large when extracted (> {MAX_BYTES // (1 << 20)} MB)")
        out_path = os.path.join(dest, clean)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with zf.open(info) as src, open(out_path, "wb") as dst:
            while True:
                chunk = src.read(1 << 20)
                if not chunk:
                    break
                dst.write(chunk)
        written += 1
    print(json.dumps({"ok": True, "files": written, "bytes": total}))


def make_zip(src_dir, zip_path):
    src_dir = os.path.abspath(src_dir)
    base = os.path.basename(src_dir)
    names = []
    for root, dirs, files in os.walk(src_dir):
        dirs.sort()
        for f in sorted(files):
            full = os.path.join(root, f)
            if os.path.islink(full):
                continue
            rel = os.path.relpath(full, src_dir)
            names.append((full, os.path.join(base, rel)))
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for full, arc in names:
            zf.write(full, arc)
    print(json.dumps({"ok": True, "files": len(names)}))


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "extract":
        extract(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 4 and sys.argv[1] == "zip":
        make_zip(sys.argv[2], sys.argv[3])
    else:
        sys.stderr.write(__doc__)
        sys.exit(2)
