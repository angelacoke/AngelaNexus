#!/usr/bin/env python3
import io
import os
import sys
import zipfile

def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: deduplicate-libxray-aar.py <libXray.aar>")
    aar_path = sys.argv[1]
    with zipfile.ZipFile(aar_path, "r") as aar:
        entries = {name: aar.read(name) for name in aar.namelist()}
    classes = entries.get("classes.jar")
    if classes is None:
        raise SystemExit("libXray.aar is missing classes.jar")
    with zipfile.ZipFile(io.BytesIO(classes), "r") as jar:
        filtered = {
            name: jar.read(name)
            for name in jar.namelist()
            if not name.startswith("go/")
        }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as jar:
        for name, data in filtered.items():
            jar.writestr(name, data)
    entries["classes.jar"] = output.getvalue()
    temporary = aar_path + ".tmp"
    with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as aar:
        for name, data in entries.items():
            aar.writestr(name, data)
    os.replace(temporary, aar_path)

if __name__ == "__main__":
    main()
