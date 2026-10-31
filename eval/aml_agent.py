"""Python side of the Rust AML eval's FFI (eval/aml, built with `--features py`). Each function takes one JSON string.

complete      one juror call through providers.py (same cache, retries and models as the BBQ eval)
model         the exact model string a provider resolves to
relay_panel   the four-juror panel on Agent Relay, via PR #1's apps/jurors/jurors.py (set SV_JURORS_DIR if it lives elsewhere)
"""
import json
import os
import sys
from pathlib import Path

import providers as P


def complete(req):
    r = json.loads(req)
    return P.get(r["provider"], r.get("model")).complete(r["system"], r["user"], r["temperature"], r["sample"])


def model(req):
    return P.get(json.loads(req)["provider"]).model


def relay_panel(req):
    r = json.loads(req)
    jurors_dir = os.environ.get("SV_JURORS_DIR", str(Path(__file__).resolve().parents[1] / "apps" / "jurors"))
    if jurors_dir not in sys.path:
        sys.path.insert(0, jurors_dir)
    from jurors import run_case  # PR #1

    out = run_case(r["item"], r["condition"])
    if out is None:
        raise RuntimeError("Agent Relay panel failed for " + r["item"]["id"])
    return json.dumps(out)
