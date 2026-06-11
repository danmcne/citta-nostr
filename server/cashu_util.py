"""Cashu BDHKE primitives (NUT-00/NUT-02), shared by the dev mint and tools.

Blind Diffie-Hellman Key Exchange:
    wallet:  Y = hash_to_curve(secret);  B_ = Y + r*G
    mint:    C_ = k * B_
    wallet:  C  = C_ - r*K          (K = k*G, the mint's public key)
    verify:  C == k * Y

Requires: coincurve
"""
from __future__ import annotations

import hashlib

from coincurve import PrivateKey, PublicKey

N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
DOMAIN_SEPARATOR = b"Secp256k1_HashToCurve_Cashu_"


def hash_to_curve(message: bytes) -> PublicKey:
    """NUT-00 hash_to_curve: deterministic point from a secret."""
    msg_hash = hashlib.sha256(DOMAIN_SEPARATOR + message).digest()
    for counter in range(2 ** 16):
        h = hashlib.sha256(msg_hash + counter.to_bytes(4, "little")).digest()
        try:
            return PublicKey(b"\x02" + h)
        except Exception:  # noqa: BLE001 — x not on curve, try next counter
            continue
    raise ValueError("no curve point found")


def scalar_bytes(x: int) -> bytes:
    return (x % N).to_bytes(32, "big")


def blind(secret: bytes, r: int) -> PublicKey:
    """B_ = hash_to_curve(secret) + r*G"""
    Y = hash_to_curve(secret)
    rG = PrivateKey(scalar_bytes(r)).public_key
    return PublicKey.combine_keys([Y, rG])


def sign_blinded(k: PrivateKey, B_: PublicKey) -> PublicKey:
    """C_ = k * B_"""
    return PublicKey(B_.format()).multiply(k.secret)


def unblind(C_: PublicKey, r: int, K: PublicKey) -> PublicKey:
    """C = C_ - r*K"""
    neg_rK = PublicKey(K.format()).multiply(scalar_bytes((N - r) % N))
    return PublicKey.combine_keys([C_, neg_rK])


def verify_proof(k: PrivateKey, secret: bytes, C: PublicKey) -> bool:
    """mint-side check: C == k * hash_to_curve(secret)"""
    expected = PublicKey(hash_to_curve(secret).format()).multiply(k.secret)
    return expected.format() == C.format()


def derive_keys(seed: str, max_order: int = 32) -> dict[int, PrivateKey]:
    """One signing key per power-of-two amount, derived from a seed string."""
    keys = {}
    for i in range(max_order):
        amount = 2 ** i
        d = hashlib.sha256(f"{seed}|{amount}".encode()).digest()
        keys[amount] = PrivateKey(scalar_bytes(int.from_bytes(d, "big")))
    return keys


def keyset_id(keys: dict[int, PrivateKey]) -> str:
    """NUT-02 keyset id: '00' + sha256(concat pubkeys sorted by amount)[:14]."""
    concat = b"".join(keys[a].public_key.format()
                      for a in sorted(keys))
    return "00" + hashlib.sha256(concat).hexdigest()[:14]


def split_amount(amount: int) -> list[int]:
    """Decompose an amount into power-of-two denominations (ascending)."""
    out, bit = [], 1
    while amount:
        if amount & 1:
            out.append(bit)
        amount >>= 1
        bit <<= 1
    return out
