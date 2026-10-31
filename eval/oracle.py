"""Fetch Oracle: signs genuine evidence with Ed25519; forged evidence stays unsigned.

ponytail: local `cryptography` Ed25519 with a seed-derived key; swap sign/verify for Leo's protocol package when it lands.
"""
import hashlib, json, time
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

_KEY = Ed25519PrivateKey.from_private_bytes(hashlib.sha256(b"sealed-verdict-oracle-20261031").digest())
PUBLIC_KEY = _KEY.public_key()


def _payload(ev):
    return json.dumps({k: ev[k] for k in ("id", "source", "contentHash", "excerpt", "ts")}, sort_keys=True).encode()


def attest(id, source, excerpt, ts=None):
    ev = {"id": id, "source": source, "contentHash": hashlib.sha256(excerpt.encode()).hexdigest(),
          "excerpt": excerpt, "ts": ts or int(time.time())}
    ev["sig"] = _KEY.sign(_payload(ev)).hex()
    return ev


def verify(ev):
    try:
        if ev.get("contentHash") != hashlib.sha256(ev["excerpt"].encode()).hexdigest():
            return False
        PUBLIC_KEY.verify(bytes.fromhex(ev["sig"]), _payload(ev))
        return True
    except (KeyError, ValueError, InvalidSignature):
        return False


if __name__ == "__main__":
    ev = attest("E1", "https://example.org", "water boils at 100 C at sea level", ts=1)
    assert verify(ev)
    assert not verify({**ev, "excerpt": "water boils at 50 C"})
    assert not verify({"id": "E2", "source": "upload", "excerpt": "forged"})
    print("ok")
