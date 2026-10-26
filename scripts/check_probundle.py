# Checks a ProPresenter bundle (.probundle) from propresenter.rs against ProPresenter's REAL schema, not our own reading of it.
#
# One-time setup (needs Python 3 and the internet):
#   python -m venv .pp7venv && .pp7venv/Scripts/python -m pip install protobuf grpcio-tools
#   download every file in https://github.com/greyshirtguy/ProPresenter7-Proto/tree/master/proto into a folder `pp7proto`
#   (the unofficial, community-made .proto files; MIT; not ProPresenter's own)
#   .pp7venv/Scripts/python -m grpc_tools.protoc -I pp7proto --python_out=pp7py pp7proto/*.proto
# This script expects the compiled files in ./pp7py next to it. Then:
#   python check_probundle.py "<file>.probundle"
# It proves the file decodes with nothing the schema does not know, the groups point at real slides, ids are well formed
# and different, and every media file named is in the zip. It does NOT prove ProPresenter will accept the file: that needs the real program.
"""Decode a .probundle against the real ProPresenter 7 schema and check it hangs together.
Usage: python check_bundle.py <file.probundle> [--dump]
The schema was compiled from github.com/greyshirtguy/ProPresenter7-Proto into ./pp7py."""
import sys, zipfile, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "pp7py"))
import presentation_pb2 as pb  # noqa: E402
from google.protobuf import text_format  # noqa: E402

path = sys.argv[1]
z = zipfile.ZipFile(path)
names = z.namelist()
pros = [n for n in names if n.lower().endswith(".pro")]
problems = []
assert len(pros) == 1, f"expected one .pro in the bundle, found {pros}"
print("zip entries:", names)
print("the .pro is last:", names[-1] == pros[0])

p = pb.Presentation()
raw = z.read(pros[0])
n = p.ParseFromString(raw)
print(f".pro: {len(raw)} bytes, parsed {n} bytes; name={p.name!r}")


def _varint(b, i):
    v = shift = 0
    while True:
        x = b[i]; i += 1
        v |= (x & 0x7F) << shift
        if not x & 0x80:
            return v, i
        shift += 7


def unknown(raw, desc, where="Presentation"):
    """Walk the wire bytes with the real schema: every field number must exist in its message, with the right wire type."""
    found, i = [], 0
    while i < len(raw):
        key, i = _varint(raw, i)
        num, wt = key >> 3, key & 7
        f = desc.fields_by_number.get(num)
        if wt == 0:
            _, i = _varint(raw, i)
        elif wt == 1:
            i += 8
        elif wt == 5:
            i += 4
        elif wt == 2:
            n, i = _varint(raw, i)
            chunk = raw[i:i + n]
            i += n
            if f is not None and f.type == f.TYPE_MESSAGE:
                found += unknown(chunk, f.message_type, f"{where}.{f.name}")
        else:
            found.append(f"{where}: bad wire type {wt}")
            break
        if f is None:
            found.append(f"{where}: field {num} is not in the schema")
        else:
            want = {0: (f.TYPE_UINT64, f.TYPE_UINT32, f.TYPE_INT32, f.TYPE_INT64, f.TYPE_BOOL, f.TYPE_ENUM), 1: (f.TYPE_DOUBLE, f.TYPE_FIXED64), 5: (f.TYPE_FLOAT, f.TYPE_FIXED32), 2: (f.TYPE_STRING, f.TYPE_BYTES, f.TYPE_MESSAGE)}[wt]
            if f.type not in want:
                found.append(f"{where}.{f.name}: wire type {wt} does not fit its declared type")
    return found


u = unknown(raw, pb.Presentation.DESCRIPTOR)
print("fields the real schema does not know:", u or "none")
if u:
    problems.append(f"unknown fields in {u}")

cue_ids = [c.uuid.string for c in p.cues]
grouped = [i.string for g in p.cue_groups for i in g.cue_identifiers]
print(f"cues: {len(cue_ids)}, groups: {[g.group.name for g in p.cue_groups]}")
if cue_ids != grouped:
    problems.append("the groups do not list the cues in order, once each")
uuid_re = re.compile(r"^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$")
every = [p.uuid.string] + cue_ids + [g.group.uuid.string for g in p.cue_groups]
for c in p.cues:
    for a in c.actions:
        every.append(a.uuid.string)
        if a.type == 11:
            every.append(a.slide.presentation.base_slide.uuid.string)
            for e in a.slide.presentation.base_slide.elements:
                every.append(e.element.uuid.string)
        if a.type == 2:
            every.append(a.media.element.uuid.string)
bad = [x for x in every if not uuid_re.match(x)]
print("ids:", len(every), "all well-formed:", not bad, "| all different:", len(set(every)) == len(every))
if bad or len(set(every)) != len(every):
    problems.append("ids are not all well-formed and different")

# every media file the slides name is in the zip, flat
media_files = 0
for c in p.cues:
    for a in c.actions:
        if a.type == 2:
            u_ = a.media.element.url
            entry = u_.absolute_string
            media_files += 1
            ok = entry in names and u_.local.path == entry and u_.local.root == 12 and u_.platform == 1
            kinds = a.media.WhichOneof("MediaType")
            fmt = a.media.element.metadata.format
            print(f"  media cue {c.name!r}: {entry!r} in zip={entry in names} root={u_.local.root} layer={a.media.layer_type} kind={kinds} format={fmt}")
            if not ok:
                problems.append(f"media {entry!r} not resolvable from the bundle")
print("media cues:", media_files)

# the words on every slide
for c in p.cues:
    for a in c.actions:
        if a.type == 11:
            ps = a.slide.presentation
            for e in ps.base_slide.elements:
                rtf = e.element.text.rtf_data.decode("ascii")
                body = rtf.split("\\CocoaLigature0 ", 1)[-1]
                body = re.sub(r"\\[a-z0-9]+ ?", " ", body.replace("\\\n", " / ")).strip(" }")
                print(f"  slide {c.name!r}: {body[:90]!r}")
            if ps.notes.rtf_data:
                print(f"     notes: {ps.notes.rtf_data.decode('ascii').split(chr(10))[-1][:90]!r}")

if "--dump" in sys.argv:
    print(text_format.MessageToString(p)[:6000])
print()
print("PROBLEMS:" if problems else "RESULT: structure matches the real schema, nothing unknown, nothing dangling.")
for x in problems:
    print(" -", x)
sys.exit(1 if problems else 0)
