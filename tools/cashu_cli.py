"""Wallet-side Cashu CLI: mint development funds and redeem received tokens.

    python -m tools.cashu_cli mint   --mint http://localhost:3338 --amount 1000
    python -m tools.cashu_cli redeem --token cashuA...   [--mint <url>]

`mint` requests a quote (auto-paid on the dev mint), mints proofs and prints
a cashuA token you can paste into the app wallet.

`redeem` is the ORGANIZER side of ticket sales: paste the token a buyer
presents, the tool swaps it at the mint (which atomically marks it spent) and
prints a fresh token belonging to you. If the swap succeeds, the payment is
yours and the buyer's copy is worthless; if the mint reports "already spent",
the ticket was double-presented.

Requires: coincurve, requests
"""
from __future__ import annotations

import argparse
import base64
import json
import secrets as pysecrets

import requests
from coincurve import PublicKey

from server.cashu_util import N, blind, split_amount, unblind


def b64url_decode(s: str) -> bytes:
    s = s.replace("-", "+").replace("_", "/")
    return base64.b64decode(s + "=" * (-len(s) % 4))


def encode_token(mint: str, proofs: list[dict], unit: str = "sat",
                 memo: str = "") -> str:
    obj = {"token": [{"mint": mint, "proofs": proofs}], "unit": unit}
    if memo:
        obj["memo"] = memo
    raw = json.dumps(obj, separators=(",", ":")).encode()
    return "cashuA" + base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_token(encoded: str) -> dict:
    if not encoded.startswith("cashuA"):
        raise SystemExit("only cashuA (V3) tokens supported")
    return json.loads(b64url_decode(encoded[6:]))


def active_keyset(mint: str) -> tuple[str, dict[int, PublicKey]]:
    ks = requests.get(f"{mint}/v1/keysets", timeout=10).json()["keysets"]
    active = next(k for k in ks if k["active"] and k["unit"] == "sat")
    keys = requests.get(f"{mint}/v1/keys/{active['id']}",
                        timeout=10).json()["keysets"][0]["keys"]
    return active["id"], {int(a): PublicKey(bytes.fromhex(pk))
                          for a, pk in keys.items()}


def make_outputs(amount: int, ks_id: str):
    """Blinded messages + the (secret, r, amount) needed to unblind later."""
    outputs, pending = [], []
    for amt in split_amount(amount):
        secret = pysecrets.token_hex(32)
        r = int.from_bytes(pysecrets.token_bytes(32), "big") % N or 1
        B_ = blind(secret.encode(), r)
        outputs.append({"amount": amt, "id": ks_id, "B_": B_.format().hex()})
        pending.append((secret, r, amt))
    return outputs, pending


def unblind_signatures(sigs: list[dict], pending: list,
                       keys: dict[int, PublicKey], ks_id: str) -> list[dict]:
    proofs = []
    for sig, (secret, r, amt) in zip(sigs, pending):
        assert sig["amount"] == amt
        C = unblind(PublicKey(bytes.fromhex(sig["C_"])), r, keys[amt])
        proofs.append({"amount": amt, "id": ks_id, "secret": secret,
                       "C": C.format().hex()})
    return proofs


def cmd_mint(args) -> None:
    mint = args.mint.rstrip("/")
    ks_id, keys = active_keyset(mint)
    q = requests.post(f"{mint}/v1/mint/quote/bolt11",
                      json={"amount": args.amount, "unit": "sat"},
                      timeout=10).json()
    if q.get("state") != "PAID":
        raise SystemExit(f"quote not paid (state={q.get('state')}) — "
                         "pay the invoice first:\n" + q.get("request", ""))
    outputs, pending = make_outputs(args.amount, ks_id)
    res = requests.post(f"{mint}/v1/mint/bolt11",
                        json={"quote": q["quote"], "outputs": outputs},
                        timeout=10)
    if res.status_code != 200:
        raise SystemExit(f"mint refused: {res.text}")
    proofs = unblind_signatures(res.json()["signatures"], pending, keys, ks_id)
    print(encode_token(mint, proofs, memo=args.memo))


def cmd_redeem(args) -> None:
    tok = decode_token(args.token)
    entry = tok["token"][0]
    mint = (args.mint or entry["mint"]).rstrip("/")
    amount = sum(p["amount"] for p in entry["proofs"])
    ks_id, keys = active_keyset(mint)
    outputs, pending = make_outputs(amount, ks_id)
    res = requests.post(f"{mint}/v1/swap",
                        json={"inputs": entry["proofs"], "outputs": outputs},
                        timeout=10)
    if res.status_code != 200:
        raise SystemExit(f"REDEEM FAILED — {res.text}")
    proofs = unblind_signatures(res.json()["signatures"], pending, keys, ks_id)
    print(f"redeemed {amount} sat at {mint} — payment is now yours.")
    print("fresh token (store it safely):")
    print(encode_token(mint, proofs))


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("mint", help="mint dev funds and print a token")
    m.add_argument("--mint", default="http://localhost:3338")
    m.add_argument("--amount", type=int, default=1000)
    m.add_argument("--memo", default="città nostr dev funds")
    m.set_defaults(func=cmd_mint)
    r = sub.add_parser("redeem", help="redeem a received token (e.g. a ticket)")
    r.add_argument("--token", required=True)
    r.add_argument("--mint", default=None,
                   help="override the mint URL inside the token")
    r.set_defaults(func=cmd_redeem)
    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
