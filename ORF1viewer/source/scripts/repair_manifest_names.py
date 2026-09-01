#!/usr/bin/env python3
"""
Repair the artifact file names inside manifest.json after files were renamed on the server.

Why this exists
---------------
`manifest.json` is the *file map*: for every model it stores the exact relative path of each
artifact (`pdb-full/<id>.pdb.gz`, `pae/<id>.webp`, …). Renaming a file on Hugging Face — e.g.
`BDB30815.1-moose-1703.pdb.gz` → `BDB30815.1-deer-1703.pdb.gz` — is the one data operation the
viewer cannot guess its way around, and it shows up in the app as `Structure: 404`. The
annotation CSV cannot fix that: the CSV carries domains and metadata, never paths.

The dataset ships the manifest **twice** — `manifest.json` and `manifest.json.gz` — and the app
loads the `.gz` first. So a rename applied to only one copy is invisible to every checker that
looks at the other one, and it still breaks the viewer. Always upload both.

What it does
------------
1. lists the files that are *actually* on the server (HF API, or a local payload directory);
2. for every manifest path that no longer exists, finds the file in the same directory with the
   same accession (`<accession>-<host>-<length>`; accessions are unique across the corpus);
3. rewrites `id`, `name`, `host` and every path field to the name found on the server;
4. reports anything still unresolved (renamed beyond recognition, or deleted).

Dry-run by default; nothing is written or uploaded unless you ask.

    # 1. see what is broken, what would be renamed, and whether the two copies disagree
    python3 scripts/repair_manifest_names.py

    # 2. repair (from any copy, stale or not) into /tmp/man
    python3 scripts/repair_manifest_names.py --manifest /tmp/manifest.json.gz --write --out /tmp/man

    # 3. publish (the other 1 GB of the dataset is untouched)
    hf upload ttubiana/HEV-ORF1-models /tmp/man/manifest.json    --repo-type dataset
    hf upload ttubiana/HEV-ORF1-models /tmp/man/manifest.json.gz --repo-type dataset

Manual overrides are applied first and win over the accession match — repeat `--rename OLD=NEW`
for models renamed to something that no longer starts with its accession:

    python3 scripts/repair_manifest_names.py \
        --rename YP_010799168.1-moose-1615=YP_010799168.1-deer-1615
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_DATA = "https://huggingface.co/datasets/ttubiana/HEV-ORF1-models/resolve/main"
UA = "orf1viewer-repair/1.0"

# manifest field -> artifact directory. `pdbSourcePath` is deliberately absent: it points at the
# original Zenodo/source tree, never at this server, so a rename here would be wrong.
PATH_FIELDS = {
    "pdbPath": "pdb-bb",
    "pdbFullPath": "pdb-full",
    "paePath": "pae",
    "accentuatedPaePath": "paeimg",
    "plddtPath": "plddt",
    "scoresPath": "scores",
}


def get_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def get_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def stem_of(filename: str) -> str:
    """BDB30815.1-deer-1703.pdb.gz -> BDB30815.1-deer-1703"""
    return re.sub(r"(\.pdb|\.webp|\.png|\.json|\.bin)?(\.gz)?$", "", filename)


def hf_listing(data_root: str, sub: str) -> set[str] | None:
    """File names inside `sub` on the Hub (paginated), or None if the root is not HF."""
    m = re.search(r"huggingface\.co/(datasets|models)/([^/]+/[^/]+)/(?:resolve|tree)/([^/?#]+)", data_root)
    if not m:
        return None
    kind, repo, rev = m.group(1), m.group(2), urllib.parse.quote(m.group(3), safe="")
    # pagination: the API returns a Link rel="next" that already carries the query string,
    # so the query is put on the first request only and later links are followed verbatim.
    url: str | None = (
        f"https://huggingface.co/api/{kind}/{repo}/tree/{rev}/{urllib.parse.quote(sub, safe='')}"
        "?expand=false&limit=1000"
    )
    names: set[str] = set()
    while url:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                page = json.loads(r.read())
                link = r.headers.get("Link") or ""
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return set()  # directory does not exist (e.g. scores in a preset without it)
            raise
        names.update(e["path"].split("/")[-1] for e in page if e.get("type") == "file")
        nxt = re.search(r'<([^>]+)>;\s*rel="next"', link)
        url = nxt.group(1) if nxt else None
    return names


def broken_paths(man: dict, listings: dict[str, set[str]]) -> list[str]:
    """`<field> <path>` for every artifact of this manifest copy that is not on the server."""
    out = []
    for m in man.get("models", []):
        for field, sub in PATH_FIELDS.items():
            p = m.get(field)
            if p and sub in listings and p.split("/")[-1] not in listings[sub]:
                out.append(f"{m['id']} · {field}: {p}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-url", default=DEFAULT_DATA, help="data root (default: the HF dataset)")
    ap.add_argument("--manifest", default=None, help="local manifest.json (default: download from --data-url)")
    ap.add_argument("--payload", default=None, help="a local payload directory to check against instead of the Hub")
    ap.add_argument("--out", default=".", help="where --write puts manifest.json + .gz (default: current dir)")
    ap.add_argument("--write", action="store_true", help="write the repaired manifest (default: report only)")
    ap.add_argument("--rename", action="append", default=[], metavar="OLD=NEW", help="manual stem override")
    args = ap.parse_args()

    if args.manifest:
        src = args.manifest
        raw = open(args.manifest, "rb").read()
        man = json.loads(gzip.decompress(raw) if src.endswith(".gz") else raw)
    else:
        src = args.data_url.rstrip("/") + "/manifest.json"
        print(f"downloading {src} …")
        man = get_json(src)
    models = man.get("models", [])
    print(f"manifest {src}: {len(models)} models (schema {man.get('schema')})")

    manual = {}
    for pair in args.rename:
        old, _, new = pair.partition("=")
        if old.strip() and new.strip():
            manual[old.strip()] = new.strip()

    # only list the directories the manifest actually references
    used = {sub for field, sub in PATH_FIELDS.items() if any(m.get(field) for m in models)}
    listings: dict[str, set[str]] = {}
    for sub in sorted(used):
        if args.payload:
            d = os.path.join(args.payload, sub)
            names = set(os.listdir(d)) if os.path.isdir(d) else set()
        else:
            names = hf_listing(args.data_url, sub)
            if names is None:
                print(f"  {sub:9s}: not an HF root — pass --payload DIR for a local payload")
                return 2
        listings[sub] = names
        print(f"  {sub:9s}: {len(names)} files on the server")

    # The dataset ships the manifest twice and the app loads `manifest.json.gz` **first**, so the
    # two copies must agree — a rename applied to one of them is the classic invisible 404.
    if not args.manifest and not args.payload:
        alt_url, alt_gz = args.data_url.rstrip("/"), False
        if src.endswith(".gz"):
            alt_url, alt_gz = src[:-3], False
        else:
            alt_url, alt_gz = src + ".gz", True
        try:
            raw = get_bytes(alt_url)
            alt = json.loads(gzip.decompress(raw) if alt_gz else raw)
            here, there = {m["id"]: m for m in models}, {m["id"]: m for m in alt.get("models", [])}
            diff = sorted(set(here) ^ set(there)) + sorted(
                i for i in set(here) & set(there) if here[i] != there[i]
            )
            if diff:
                br_here, br_there = len(broken_paths(man, listings)), len(broken_paths(alt, listings))
                print(
                    f"\nWARNING the two manifest copies disagree on {len(diff)} model(s) "
                    f"(the app reads manifest.json.gz first): {', '.join(diff[:8])}"
                    f"{' …' if len(diff) > 8 else ''}"
                )
                print(f"        broken paths — manifest.json: {br_here} · manifest.json.gz: {br_there}")
                print("        repair from whichever matches the files and upload BOTH copies.")
        except Exception as e:  # noqa: BLE001 — the comparison is a convenience, never fatal
            print(f"(could not compare with the other manifest copy: {e})")

    # accession -> {stem: filename} per directory (accessions are unique in this corpus)
    by_acc: dict[str, dict[str, dict[str, str]]] = {
        sub: {} for sub in listings
    }
    for sub, names in listings.items():
        idx = by_acc[sub]
        for fn in names:
            st = stem_of(fn)
            idx.setdefault(st.split("-")[0], {})[st] = fn

    # ---- find the broken paths and pair them with what is on the server
    renames: dict[str, str] = {}
    unresolved: list[str] = []
    broken = 0
    for m in models:
        acc = m["accession"]
        for field, sub in PATH_FIELDS.items():
            path = m.get(field)
            if not path or sub not in listings:
                continue
            fn = path.split("/")[-1]
            if fn in listings[sub]:
                continue                       # still there: nothing to do
            broken += 1
            old = stem_of(fn)
            new = manual.get(old)
            if new is None:
                cands = list(by_acc[sub].get(acc, {}))
                if len(cands) > 1:             # same accession several times: keep the length match
                    cands = [c for c in cands if c.rsplit("-", 1)[-1] == str(m.get("csvLength"))] or cands
                new = cands[0] if len(cands) == 1 else None
            if new is None:
                unresolved.append(f"{m['id']} · {field}: no single {sub} file for accession {acc}")
                continue
            if old == new:                      # extension-only difference, path is fine
                continue
            # the real name as listed on the server; for a manual override, swap the stem inside
            # the old file name (each artifact kind keeps its own suffix: .pdb.gz / .webp / .bin.gz)
            known = by_acc[sub].get(acc, {}).get(new) or fn.replace(old, new)
            if renames.setdefault(old, new) != new:
                unresolved.append(f"{m['id']} · {field}: {old} maps to both {renames[old]} and {new}")
                continue
            m[field] = f"{sub}/{known}"

    # ---- apply every stem rename to the whole entry
    changed = []
    for m in models:
        new_id = renames.get(m["id"])
        if not new_id:
            continue
        old_id = m["id"]
        m["id"] = m["name"] = new_id
        parts = new_id.split("-")
        if len(parts) >= 3:
            m["host"] = "-".join(parts[1:-1])   # <accession>-<host>-<length>
        for field in PATH_FIELDS:
            p = m.get(field)
            if p and f"/{old_id}." in p:
                m[field] = p.replace(f"/{old_id}.", f"/{new_id}.")
        changed.append((old_id, new_id, m.get("host")))
    if changed:
        man["hosts"] = sorted({x.get("host") for x in models if x.get("host")})

    print(f"\n{broken} path(s) no longer exist · {len(changed)} model(s) renamed · {len(unresolved)} unresolved")
    for old, new, host in changed:
        print(f"  {old}  ->  {new}   (host: {host})")
    for line in unresolved[:40]:
        print(f"  ? {line}")
    if not changed and not unresolved:
        print("manifest matches the server — nothing to do")
        return 0

    still = broken_paths(man, listings)
    print(f"paths still missing after the repair: {len(still)}")
    for line in still[:10]:
        print(f"  ! {line}")

    if not args.write:
        print("\n(dry run — pass --write --out DIR to emit the repaired manifest)")
        return 0
    os.makedirs(args.out, exist_ok=True)
    js = os.path.join(args.out, "manifest.json")
    with open(js, "w", encoding="utf-8") as f:
        json.dump(man, f, separators=(",", ":"), ensure_ascii=False)
    raw = open(js, "rb").read()
    # mtime=0 keeps the .gz byte-identical for identical content (git-friendly, cache-friendly)
    with open(js + ".gz", "wb") as f:
        f.write(gzip.compress(raw, mtime=0, compresslevel=9))
    print(f"wrote {js} ({len(raw)/1e6:.2f} MB) and {js}.gz ({os.path.getsize(js + '.gz')/1e6:.2f} MB)")
    print(f"publish with:\n  hf upload ttubiana/HEV-ORF1-models {js} --repo-type dataset"
          f"\n  hf upload ttubiana/HEV-ORF1-models {js}.gz --repo-type dataset")
    return 0


if __name__ == "__main__":
    sys.exit(main())
