#!/usr/bin/env python3
"""Host-only c-shared smoke: no Android TUN, VpnService or full-core exit claim."""
import ctypes
import json
import sys
import tempfile
from pathlib import Path


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: smoke-mihomo-library.py LIBRARY [foreign host flags...]")
    # Extra arguments deliberately belong to the host, not Mihomo's CLI. Loading
    # the shared library must not parse them or terminate the embedding process.
    library = ctypes.CDLL(str(Path(sys.argv[1]).resolve()))
    library.freeCString.argtypes = [ctypes.c_void_p]
    library.freeCString.restype = None
    for name, args in (
        ("angelaInit", [ctypes.c_char_p]),
        ("angelaApplyConfig", [ctypes.c_char_p]),
        ("angelaStopTun", []),
    ):
        function = getattr(library, name)
        function.argtypes = args
        function.restype = ctypes.c_void_p
    library.startTUN.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p]
    library.startTUN.restype = ctypes.c_ubyte
    resume = getattr(library, "suspend")
    resume.argtypes = [ctypes.c_ubyte]
    resume.restype = None

    def call(name, *args, expect_error=False):
        pointer = getattr(library, name)(*args)
        if not pointer:
            raise AssertionError(f"{name} returned a null result")
        try:
            error = ctypes.string_at(pointer).decode("utf-8")
        finally:
            library.freeCString(pointer)
        if bool(error) != expect_error:
            raise AssertionError(f"{name}: unexpected result {error!r}")

    with tempfile.TemporaryDirectory(prefix="mihomo-library-") as home:
        call("angelaInit", home.encode())
        call("angelaApplyConfig", b"{invalid", expect_error=True)
        config = json.dumps({
            "mode": "rule", "log-level": "silent", "geo-auto-update": False,
            "rules": ["MATCH,DIRECT"], "dns": {"enable": False},
            "tun": {"enable": False}, "ntp": {"enable": False},
        }).encode()
        call("angelaApplyConfig", config)
        if library.startTUN(-1, b"system", b"", b"") != 0:
            raise AssertionError("invalid TUN descriptor was accepted")
        resume(0)
        call("angelaStopTun")
        call("angelaStopTun")
        # Reconfiguration/retry after stop must remain callable through the ABI.
        call("angelaApplyConfig", config)
        call("angelaStopTun")
    print("Host c-shared load/exports/config/invalid-start/repeated-stop smoke passed", flush=True)


if __name__ == "__main__":
    main()
