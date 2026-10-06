"""Packs the read-aloud voice (src-tauri/resources/voice, built by voice-sidecar/build.ps1)
into the archive the app downloads on request, and writes src-tauri/resources/voice.json
(URL, size and SHA-256 per platform) which ships inside the app.

The archive goes into installer/ (not committed) and is uploaded as an asset of the
release named in --tag. Publishing is a separate, manual step (scripts/release.ps1 prints
the command); this script never uploads anything.

    python scripts/package_voice.py --tag v2.4.0

Re-run only when the voice itself changes: voice.json keeps entries for other platforms,
and an unchanged archive can stay on its original release for every later version.
"""

import argparse
import hashlib
import json
import platform
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VOICE = ROOT / "src-tauri" / "resources" / "voice"
MANIFEST = ROOT / "src-tauri" / "resources" / "voice.json"
OUT = ROOT / "installer"
REPO = "BadBull22/bible"
VOICE_VERSION = 1


def platform_key() -> str:
    os_name = {"win32": "windows", "darwin": "darwin"}.get(sys.platform, "linux")
    arch = {"amd64": "x86_64", "x86_64": "x86_64", "arm64": "aarch64", "aarch64": "aarch64"}[platform.machine().lower()]
    return f"{os_name}-{arch}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True, help="the GitHub release the archive is attached to, e.g. v2.4.0")
    args = ap.parse_args()

    exe = "voice-sidecar.exe" if sys.platform == "win32" else "voice-sidecar"
    needed = [VOICE / "kokoro-v1.0.fp16.onnx", VOICE / "voices-en.bin", VOICE / "voice-sidecar" / exe]
    missing = [str(p) for p in needed if not p.is_file()]
    if missing:
        sys.exit("voice files missing (build them with voice-sidecar/build.ps1): " + ", ".join(missing))

    key = platform_key()
    name = f"voice-{key}-v{VOICE_VERSION}.zip"
    OUT.mkdir(exist_ok=True)
    out = OUT / name
    files = sorted(p for p in VOICE.rglob("*") if p.is_file())
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for p in files:
            z.write(p, p.relative_to(VOICE).as_posix())

    sha = hashlib.sha256()
    with open(out, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            sha.update(block)

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {"platforms": {}}
    manifest["version"] = VOICE_VERSION
    manifest["platforms"][key] = {
        "url": f"https://github.com/{REPO}/releases/download/{args.tag}/{name}",
        "sha256": sha.hexdigest(),
        "bytes": out.stat().st_size,
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"{out}  {out.stat().st_size / 1e6:.0f} MB  ({len(files)} files)")
    print(f"sha256 {sha.hexdigest()}")
    print(f"wrote {MANIFEST}")


if __name__ == "__main__":
    main()
