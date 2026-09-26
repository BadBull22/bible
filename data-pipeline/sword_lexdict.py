"""Minimal reader for CrossWire SWORD dictionary modules (RawLD, RawLD4, zLD).

Only what this project needs to import the public-domain Easton's, Smith's, Nave's and
Torrey's modules: iterate (key, text) pairs. No SWORD library required.

Formats (from the SWORD engine sources, rawstr.cpp / rawstr4.cpp / zstr.cpp):
  RawLD   .idx = packed (u32 offset, u16 size) into .dat; each .dat record is
          "KEY\\n" (optionally "\\r\\n") followed by the entry text.
  RawLD4  same, but the .idx size field is a u32.
  zLD     .idx = packed (u32 offset, u32 size) into .dat; each .dat record is "KEY\\n"
          followed by (u32 block, u32 entry). .zdx = packed (u32 offset, u32 size) into
          .zdt, each a zlib-compressed block; a decompressed block starts with u32 count,
          then count x (u32 offset, u32 size) relative to the block start.
An entry whose text starts with "@LINK" is an alias for another key.
"""

import struct
import zlib
from pathlib import Path


def _split_key(buf: bytes) -> tuple[str, bytes]:
    nl = buf.find(b"\n")
    if nl < 0:
        return buf.decode("utf-8", "replace").strip(), b""
    key = buf[:nl].rstrip(b"\r").decode("utf-8", "replace").strip()
    return key, buf[nl + 1 :]


def _read_raw(base: Path, size_fmt: str):
    idx = (base.parent / (base.name + ".idx")).read_bytes()
    dat = (base.parent / (base.name + ".dat")).read_bytes()
    rec = struct.calcsize("<I" + size_fmt)
    for i in range(0, len(idx) - rec + 1, rec):
        off, size = struct.unpack_from("<I" + size_fmt, idx, i)
        key, body = _split_key(dat[off : off + size])
        yield key, body


def _read_z(base: Path):
    idx = (base.parent / (base.name + ".idx")).read_bytes()
    dat = (base.parent / (base.name + ".dat")).read_bytes()
    zdx = (base.parent / (base.name + ".zdx")).read_bytes()
    zdt = (base.parent / (base.name + ".zdt")).read_bytes()
    blocks: dict[int, bytes] = {}

    def block(n: int) -> bytes:
        if n not in blocks:
            off, size = struct.unpack_from("<II", zdx, n * 8)
            blocks[n] = zlib.decompress(zdt[off : off + size])
        return blocks[n]

    for i in range(0, len(idx) - 7, 8):
        off, size = struct.unpack_from("<II", idx, i)
        key, rest = _split_key(dat[off : off + size])
        if len(rest) < 8:
            continue
        bnum, enum = struct.unpack_from("<II", rest, 0)
        b = block(bnum)
        count = struct.unpack_from("<I", b, 0)[0]
        if enum >= count:
            continue
        eoff, esize = struct.unpack_from("<II", b, 4 + enum * 8)
        yield key, b[eoff : eoff + esize].rstrip(b"\x00")


def read_module(module_dir: Path):
    """Yield (key, text) for a SWORD lexdict module unpacked at module_dir (the folder
    containing mods.d/ and modules/). @LINK aliases are resolved to their target text."""
    conf = next((module_dir / "mods.d").glob("*.conf")).read_text("utf-8", "replace")
    fields = {}
    for line in conf.splitlines():
        if "=" in line and not line.startswith("["):
            k, v = line.split("=", 1)
            fields.setdefault(k.strip(), v.strip())
    base = (module_dir / fields["DataPath"].lstrip("./")).resolve()
    drv = fields["ModDrv"]
    if drv == "zLD":
        items = list(_read_z(base))
    elif drv == "RawLD4":
        items = list(_read_raw(base, "I"))
    elif drv == "RawLD":
        items = list(_read_raw(base, "H"))
    else:
        raise ValueError(f"unsupported ModDrv {drv}")
    # Modules without "Encoding=UTF-8" in their .conf are Latin-1 (SWORD's default).
    enc = "utf-8" if fields.get("Encoding", "").upper() == "UTF-8" else "cp1252"
    items = [(k, t.decode(enc, "replace")) for k, t in items]
    by_key = {k: t for k, t in items}
    for key, text in items:
        hops = 0
        while text.startswith("@LINK") and hops < 5:
            text = by_key.get(text[5:].strip(), "")
            hops += 1
        yield key, text, fields


if __name__ == "__main__":
    import sys

    for key, text, _ in list(read_module(Path(sys.argv[1])))[int(sys.argv[2]) : int(sys.argv[3])]:
        print("KEY:", key)
        print(text[:600].replace("\n", " "))
        print("-" * 60)
