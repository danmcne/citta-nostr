// Città Nostr — Cashu wallet (Phase 2, step 2: real BDHKE).
//
// The wallet now performs the actual Cashu protocol against a mint:
//   redeem(token)  NUT-03 swap — claims a received token (the mint marks the
//                  old proofs spent and issues fresh ones bound to us)
//   send(amount)   selects proofs, swaps for exact denominations + change,
//                  returns an encoded token to hand to the payee
//   balance()      sum of CLAIMED proofs, per mint
//
// Elliptic-curve primitives (pointAdd/pointMul/liftX/sha256/…) come from
// verify.js, which must be loaded first.
//
// Still TODO (documented): DLEQ verification (NUT-12) — we trust the mint's
// signatures without checking the discrete-log equality proof; P2PK-locked
// tokens (NUT-11) so intercepted tickets can't be redeemed by a thief;
// melt/Lightning (NUT-05); cashuB/V4 tokens.
"use strict";

const WALLET_STORE_KEY = "cittanostr.wallet.v2";
const WALLET_STORE_KEY_V1 = "cittanostr.wallet.v1";
const CASHU_DOMAIN = "Secp256k1_HashToCurve_Cashu_";

// ------------------------------------------------------------ EC extras

function pointNeg([X, Y, Z]) { return [X, mod(-Y, EC.p), Z]; }

function serPoint(P) {            // Jacobian -> compressed hex
  const a = toAffine(P);
  if (!a) throw new Error("point at infinity");
  return ((a[1] & 1n) ? "03" : "02") + a[0].toString(16).padStart(64, "0");
}

function parsePoint(hex) {        // compressed hex -> Jacobian
  if (!/^0[23][0-9a-fA-F]{64}$/.test(hex)) throw new Error("bad point");
  const P = liftX(BigInt("0x" + hex.slice(2)));   // even-y point
  if (!P) throw new Error("not on curve");
  return hex.startsWith("03") ? pointNeg(P) : P;
}

function randScalar() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  const r = bytesToBigInt(b) % EC.n;
  return r === 0n ? 1n : r;
}

/** NUT-00 hash_to_curve: secret bytes -> curve point (even y via 02-parse). */
async function hashToCurve(msgBytes) {
  const sep = utf8(CASHU_DOMAIN);
  const pre = new Uint8Array(sep.length + msgBytes.length);
  pre.set(sep); pre.set(msgBytes, sep.length);
  const msgHash = await sha256(pre);
  const buf = new Uint8Array(36);
  buf.set(msgHash);
  for (let counter = 0; counter < 65536; counter++) {
    buf[32] =  counter        & 0xff;   // 4-byte little-endian counter
    buf[33] = (counter >>  8) & 0xff;
    buf[34] = (counter >> 16) & 0xff;
    buf[35] = (counter >> 24) & 0xff;
    const h = await sha256(buf);
    const P = liftX(bytesToBigInt(h));  // == parsing "02" + h
    if (P) return P;
  }
  throw new Error("no curve point found");
}

function splitAmount(n) {
  const out = []; let bit = 1n;
  for (let v = BigInt(n); v > 0n; v >>= 1n, bit <<= 1n) {
    if (v & 1n) out.push(Number(bit));
  }
  return out;
}

// ------------------------------------------------------------ token codec

function encodeCashuToken(mint, proofs, unit = "sat", memo = "") {
  const obj = { token: [{ mint, proofs }], unit };
  if (memo) obj.memo = memo;
  const bytes = utf8(JSON.stringify(obj));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "cashuA" + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_")
                             .replace(/=+$/, "");
}

function decodeCashuToken(encoded) {
  const s = (encoded || "").trim();
  if (s.startsWith("cashuB")) {
    throw new Error("V4 (cashuB) tokens not supported yet — V3 only");
  }
  if (!s.startsWith("cashuA")) {
    throw new Error("not a Cashu token (must start with cashuA)");
  }
  let b64 = s.slice(6).replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  let obj;
  try {
    obj = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(b64), c => c.charCodeAt(0))));
  } catch { throw new Error("token is not valid base64/JSON"); }
  const entry = obj.token && obj.token[0];
  if (!entry || !Array.isArray(entry.proofs) || !entry.mint) {
    throw new Error("token has no proofs/mint");
  }
  const amount = entry.proofs.reduce((a, p) => a + (p.amount || 0), 0);
  return { mint: entry.mint.replace(/\/$/, ""), unit: obj.unit || "sat",
           memo: obj.memo || "", amount, proofs: entry.proofs };
}

// ------------------------------------------------------------ provider

/* eslint-disable no-unused-vars */
class WalletProvider {
  async balance() { throw new Error("not implemented"); }
  async receive(encoded) { throw new Error("not implemented"); }
  async send(amount) { throw new Error("not implemented"); }
  async pay(invoice) { throw new Error("not implemented"); }
}

class CashuWalletProvider extends WalletProvider {
  constructor(mints) {
    super();
    this.mints = (mints || []).map(u => u.replace(/\/$/, ""));
    this._keysets = new Map();    // mint -> {id, fee, keys: Map(amount->point)}
  }

  // -------------------------------------------------------- storage

  _load() {
    let st;
    try { st = JSON.parse(localStorage.getItem(WALLET_STORE_KEY)); } catch {}
    if (!st) {
      st = { proofs: {}, tickets: [], pending: [] };
      // migrate v1: unredeemed pasted tokens become "pending"
      try {
        const v1 = JSON.parse(localStorage.getItem(WALLET_STORE_KEY_V1));
        if (v1 && Array.isArray(v1.tokens)) {
          st.pending = v1.tokens.map(t => t.encoded);
          localStorage.removeItem(WALLET_STORE_KEY_V1);
        }
      } catch {}
      this._save(st);
    }
    return st;
  }

  _save(st) { localStorage.setItem(WALLET_STORE_KEY, JSON.stringify(st)); }

  // -------------------------------------------------------- mint info

  async mintInfo() {
    return Promise.all(this.mints.map(async (url) => {
      try {
        const res = await this._fetch(url + "/v1/info");
        const info = await res.json();
        return { url, ok: true, name: info.name || url,
                 version: info.version || "" };
      } catch (e) {
        return { url, ok: false, error: String(e.message || e) };
      }
    }));
  }

  async _fetch(url, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, body ? {
        method: "POST", signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      } : { signal: ctrl.signal });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { detail = (await res.json()).detail || detail; } catch {}
        throw new Error(detail);
      }
      return res;
    } finally { clearTimeout(timer); }
  }

  async _keyset(mint) {
    if (this._keysets.has(mint)) return this._keysets.get(mint);
    const ks = (await (await this._fetch(mint + "/v1/keysets")).json())
      .keysets.find(k => k.active && k.unit === "sat");
    if (!ks) throw new Error("mint has no active sat keyset");
    const keys = (await (await this._fetch(`${mint}/v1/keys/${ks.id}`))
      .json()).keysets[0].keys;
    const map = new Map();
    for (const [amt, pk] of Object.entries(keys)) {
      map.set(Number(amt), parsePoint(pk));
    }
    const out = { id: ks.id, fee: ks.input_fee_ppk || 0, keys: map };
    this._keysets.set(mint, out);
    return out;
  }

  // -------------------------------------------------------- BDHKE swap

  /** Build blinded messages for `amount`; returns {outputs, pending}. */
  async _makeOutputs(amount, ksId) {
    const outputs = [], pending = [];
    for (const amt of splitAmount(amount)) {
      const secretBytes = new Uint8Array(32);
      crypto.getRandomValues(secretBytes);
      const secret = bytesToHex(secretBytes);    // secret is the hex STRING
      const r = randScalar();
      const Y = await hashToCurve(utf8(secret));
      const B_ = pointAdd(Y, pointMul(G, r));
      outputs.push({ amount: amt, id: ksId, B_: serPoint(B_) });
      pending.push({ secret, r, amount: amt });
    }
    return { outputs, pending };
  }

  _unblind(signatures, pending, ks) {
    return signatures.map((sig, i) => {
      const { secret, r, amount } = pending[i];
      if (sig.amount !== amount) throw new Error("mint reordered outputs");
      const K = ks.keys.get(amount);
      if (!K) throw new Error(`mint has no key for ${amount}`);
      const C_ = parsePoint(sig.C_);
      const C = pointAdd(C_, pointNeg(pointMul(K, r)));
      return { amount, id: ks.id, secret, C: serPoint(C) };
    });
  }

  _fee(ks, numInputs) {
    return Math.floor((ks.fee * numInputs + 999) / 1000);
  }

  /** NUT-03: swap `inputs` at `mint` into fresh proofs for amounts
      [keepAmount, sendAmount?]. Returns {kept, sent}. */
  async _swap(mint, inputs, sendAmount = 0) {
    const ks = await this._keyset(mint);
    const inSum = inputs.reduce((a, p) => a + p.amount, 0);
    const fee = this._fee(ks, inputs.length);
    const keepAmount = inSum - fee - sendAmount;
    if (keepAmount < 0) throw new Error("insufficient amount after fees");

    const sendPart = sendAmount ? await this._makeOutputs(sendAmount, ks.id)
                                : { outputs: [], pending: [] };
    const keepPart = keepAmount ? await this._makeOutputs(keepAmount, ks.id)
                                : { outputs: [], pending: [] };
    const outputs = [...sendPart.outputs, ...keepPart.outputs];
    const pending = [...sendPart.pending, ...keepPart.pending];

    const res = await this._fetch(mint + "/v1/swap", { inputs, outputs });
    const sigs = (await res.json()).signatures;
    if (!Array.isArray(sigs) || sigs.length !== outputs.length) {
      throw new Error("mint returned malformed signatures");
    }
    const proofs = this._unblind(sigs, pending, ks);
    return { sent: proofs.slice(0, sendPart.outputs.length),
             kept: proofs.slice(sendPart.outputs.length) };
  }

  // -------------------------------------------------------- operations

  /** Claim a received token: swap it so the proofs become ours. */
  async receive(encoded) {
    const tok = decodeCashuToken(encoded);
    const { kept } = await this._swap(tok.mint, tok.proofs, 0);
    const st = this._load();
    st.proofs[tok.mint] = [...(st.proofs[tok.mint] || []), ...kept];
    this._save(st);
    const amount = kept.reduce((a, p) => a + p.amount, 0);
    return { ...tok, amount, redeemed: true };
  }

  /** Create a token worth `amount`, taking change automatically.
      Returns {encoded, mint, amount}. */
  async send(amount, memo = "") {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error("invalid amount");
    }
    const st = this._load();
    // pick the first mint with sufficient balance (proofs never mix mints)
    const mint = Object.keys(st.proofs).find(m =>
      (st.proofs[m] || []).reduce((a, p) => a + p.amount, 0) >= amount);
    if (!mint) throw new Error("insufficient balance on any single mint");

    // greedy largest-first selection
    const avail = [...st.proofs[mint]].sort((a, b) => b.amount - a.amount);
    const inputs = [];
    let sum = 0;
    for (const p of avail) {
      if (sum >= amount) break;
      inputs.push(p); sum += p.amount;
    }
    const { sent, kept } = await this._swap(mint, inputs, amount);
    // remove spent inputs, keep change — only after the mint accepted
    const spent = new Set(inputs.map(p => p.secret));
    st.proofs[mint] = [...st.proofs[mint].filter(p => !spent.has(p.secret)),
                       ...kept];
    this._save(st);
    return { encoded: encodeCashuToken(mint, sent, "sat", memo),
             mint, amount };
  }

  async balance() {
    const st = this._load();
    const perMint = Object.entries(st.proofs).map(([mint, proofs]) => ({
      mint, amount: proofs.reduce((a, p) => a + p.amount, 0),
    })).filter(x => x.amount > 0);
    return { amount: perMint.reduce((a, m) => a + m.amount, 0),
             unit: "sat", redeemed: true, perMint,
             pending: this._load().pending.length };
  }

  // -------------------------------------------------------- tickets

  async buyTicket(eventNode) {
    const price = eventNode.price;
    if (!price) throw new Error("event has no price");
    const { encoded, mint } = await this.send(price.amount,
      `ticket:${eventNode.d}`);
    const st = this._load();
    const ticket = {
      eventKey: `${eventNode.kind}:${eventNode.pubkey}:${eventNode.d}`,
      title: eventNode.title,
      start: eventNode.start,
      amount: price.amount,
      unit: price.unit,
      mint,
      token: encoded,
      purchasedAt: Date.now(),
    };
    st.tickets.push(ticket);
    this._save(st);
    return ticket;
  }

  listTickets() { return this._load().tickets; }
  listPending() { return this._load().pending; }

  removePending(encoded) {
    const st = this._load();
    st.pending = st.pending.filter(e => e !== encoded);
    this._save(st);
  }
}
