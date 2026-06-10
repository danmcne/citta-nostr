// Città Nostr — wallet layer (Phase 2, step 1).
//
// WalletProvider is the protocol-agnostic interface the UI talks to.
// CashuWalletProvider is the Cashu implementation. In this step it can:
//   - query the city's mints (NUT-06 /v1/info) and report their status
//   - decode Cashu V3 tokens ("cashuA…") pasted by the user
//   - hold received tokens locally and report an *unredeemed* balance
//
// NOT yet implemented (next step, requires BDHKE blinding — the EC math in
// verify.js already covers the point arithmetic): swap-on-receive (which is
// what actually claims a token and protects against double-spend), minting
// via Lightning, and melt (paying). The UI labels the balance accordingly:
// trusting an unswapped token is NOT safe beyond development.
"use strict";

const WALLET_STORE_KEY = "cittanostr.wallet.v1";

/* eslint-disable no-unused-vars */
class WalletProvider {
  /** @returns {Promise<{amount:number, unit:string, redeemed:boolean}>} */
  async balance() { throw new Error("not implemented"); }
  /** @param {string} encoded  e.g. a cashuA… token */
  async receive(encoded) { throw new Error("not implemented"); }
  /** @param {number} amount @returns {Promise<string>} encoded token */
  async send(amount) { throw new Error("not implemented"); }
  /** @param {string} invoice  bolt11 */
  async pay(invoice) { throw new Error("not implemented"); }
}

class CashuWalletProvider extends WalletProvider {
  /** @param {string[]} mints  trusted mint URLs from the city profile */
  constructor(mints) {
    super();
    this.mints = mints || [];
  }

  // ---------------------------------------------------------- storage

  _load() {
    try {
      return JSON.parse(localStorage.getItem(WALLET_STORE_KEY)) ||
             { tokens: [] };
    } catch { return { tokens: [] }; }
  }

  _save(state) {
    localStorage.setItem(WALLET_STORE_KEY, JSON.stringify(state));
  }

  // ---------------------------------------------------------- mints

  /** NUT-06 mint info for every configured mint. */
  async mintInfo() {
    return Promise.all(this.mints.map(async (url) => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(url.replace(/\/$/, "") + "/v1/info",
                                { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const info = await res.json();
        return { url, ok: true, name: info.name || url,
                 version: info.version || "", description: info.description || "" };
      } catch (e) {
        return { url, ok: false, error: String(e.message || e) };
      }
    }));
  }

  // ---------------------------------------------------------- tokens

  /**
   * Decode a Cashu V3 token. Returns { mint, unit, memo, amount, proofs }
   * or throws with a human-readable reason. (V4 "cashuB" is CBOR — TODO.)
   */
  static decodeToken(encoded) {
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
    if (!entry || !Array.isArray(entry.proofs)) {
      throw new Error("token has no proofs");
    }
    const amount = entry.proofs.reduce((a, p) => a + (p.amount || 0), 0);
    return { mint: entry.mint, unit: obj.unit || "sat",
             memo: obj.memo || "", amount, proofs: entry.proofs };
  }

  /** Store a decoded token locally (NOT redeemed — see file header). */
  async receive(encoded) {
    const tok = CashuWalletProvider.decodeToken(encoded);
    const state = this._load();
    if (state.tokens.some(t => t.encoded === encoded.trim())) {
      throw new Error("token already in wallet");
    }
    state.tokens.push({ encoded: encoded.trim(), mint: tok.mint,
                        unit: tok.unit, amount: tok.amount,
                        memo: tok.memo, receivedAt: Date.now() });
    this._save(state);
    return tok;
  }

  async balance() {
    const state = this._load();
    const amount = state.tokens.reduce((a, t) => a + t.amount, 0);
    return { amount, unit: "sat", redeemed: false,
             count: state.tokens.length };
  }

  listTokens() { return this._load().tokens; }

  clear() { this._save({ tokens: [] }); }
}
