"""città nostr development mint — a minimal Cashu mint for offline development.

Implements enough of the protocol for the wallet and ticket flow:
  NUT-06  GET  /v1/info
  NUT-02  GET  /v1/keysets
  NUT-01  GET  /v1/keys , /v1/keys/{id}
  NUT-04  POST /v1/mint/quote/bolt11   (quotes are auto-PAID — dev only!)
          GET  /v1/mint/quote/bolt11/{q}
          POST /v1/mint/bolt11
  NUT-03  POST /v1/swap

State (spent secrets, issued quotes) is IN MEMORY: restarting the mint
forgets double-spends. Never use this with real value.

Run:
    uvicorn tools.dev_mint:app --port 3338
"""
from __future__ import annotations

import secrets as pysecrets
import time

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from server.cashu_util import (derive_keys, hash_to_curve, keyset_id,
                               sign_blinded, verify_proof)
from coincurve import PublicKey

SEED = "cittanostr-dev-mint-do-not-use-with-real-value"
KEYS = derive_keys(SEED)
KEYSET_ID = keyset_id(KEYS)
UNIT = "sat"

app = FastAPI(title="città nostr dev mint")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

SPENT: set[str] = set()          # secrets already swapped
QUOTES: dict[str, dict] = {}     # quote id -> {amount, state, issued}


class BlindedMessage(BaseModel):
    amount: int
    id: str
    B_: str


class Proof(BaseModel):
    amount: int
    id: str
    secret: str
    C: str


class SwapRequest(BaseModel):
    inputs: list[Proof]
    outputs: list[BlindedMessage]


class MintQuoteRequest(BaseModel):
    amount: int
    unit: str = "sat"


class MintRequest(BaseModel):
    quote: str
    outputs: list[BlindedMessage]


def _sign_outputs(outputs: list[BlindedMessage]) -> list[dict]:
    sigs = []
    for o in outputs:
        if o.amount not in KEYS:
            raise HTTPException(400, f"unsupported amount {o.amount}")
        if o.id != KEYSET_ID:
            raise HTTPException(400, "unknown keyset id")
        C_ = sign_blinded(KEYS[o.amount], PublicKey(bytes.fromhex(o.B_)))
        sigs.append({"amount": o.amount, "id": KEYSET_ID,
                     "C_": C_.format().hex()})
    return sigs


@app.get("/v1/info")
def info() -> dict:
    return {"name": "città nostr dev mint", "version": "cittanostr-dev/0.6",
            "description": "DEVELOPMENT mint — fake money, in-memory state",
            "nuts": {"4": {"methods": [{"method": "bolt11", "unit": UNIT}],
                           "disabled": False}}}


@app.get("/v1/keysets")
def keysets() -> dict:
    return {"keysets": [{"id": KEYSET_ID, "unit": UNIT,
                         "active": True, "input_fee_ppk": 0}]}


@app.get("/v1/keys")
@app.get("/v1/keys/{ks_id}")
def keys(ks_id: str | None = None) -> dict:
    if ks_id not in (None, KEYSET_ID):
        raise HTTPException(404, "unknown keyset")
    return {"keysets": [{"id": KEYSET_ID, "unit": UNIT,
                         "keys": {str(a): KEYS[a].public_key.format().hex()
                                  for a in sorted(KEYS)}}]}


@app.post("/v1/mint/quote/bolt11")
def mint_quote(req: MintQuoteRequest) -> dict:
    if req.unit != UNIT:
        raise HTTPException(400, "unit not supported")
    q = pysecrets.token_hex(16)
    QUOTES[q] = {"amount": req.amount, "state": "PAID", "issued": False,
                 "created": int(time.time())}
    return {"quote": q, "request": f"lnbcrt_dev_{q}", "unit": UNIT,
            "state": "PAID", "expiry": int(time.time()) + 3600}


@app.get("/v1/mint/quote/bolt11/{q}")
def mint_quote_state(q: str) -> dict:
    quote = QUOTES.get(q)
    if not quote:
        raise HTTPException(404, "unknown quote")
    return {"quote": q, "request": f"lnbcrt_dev_{q}", "unit": UNIT,
            "state": quote["state"]}


@app.post("/v1/mint/bolt11")
def mint_tokens(req: MintRequest) -> dict:
    quote = QUOTES.get(req.quote)
    if not quote:
        raise HTTPException(404, "unknown quote")
    if quote["issued"]:
        raise HTTPException(400, "quote already issued")
    total = sum(o.amount for o in req.outputs)
    if total != quote["amount"]:
        raise HTTPException(400, "outputs do not match quote amount")
    quote["issued"] = True
    return {"signatures": _sign_outputs(req.outputs)}


@app.post("/v1/swap")
def swap(req: SwapRequest) -> dict:
    in_sum = sum(p.amount for p in req.inputs)
    out_sum = sum(o.amount for o in req.outputs)
    if in_sum != out_sum:          # input_fee_ppk is 0 on this mint
        raise HTTPException(400, "inputs and outputs do not balance")
    seen = set()
    for p in req.inputs:
        if p.id != KEYSET_ID or p.amount not in KEYS:
            raise HTTPException(400, "unknown keyset/amount")
        if p.secret in SPENT or p.secret in seen:
            raise HTTPException(400, f"token already spent: {p.secret[:8]}…")
        seen.add(p.secret)
        if not verify_proof(KEYS[p.amount], p.secret.encode(),
                            PublicKey(bytes.fromhex(p.C))):
            raise HTTPException(400, "invalid proof")
    sigs = _sign_outputs(req.outputs)
    SPENT.update(seen)             # only after everything validated
    return {"signatures": sigs}
