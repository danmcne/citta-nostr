// Città Nostr — Nostr event verification, zero dependencies.
//
// Verifies (1) the event id is the SHA-256 of the canonical NIP-01
// serialization, and (2) the BIP-340 Schnorr signature over that id.
// secp256k1 in Jacobian coordinates over native BigInt; SHA-256 via
// WebCrypto (requires a secure context: https or localhost).
"use strict";

const EC = {
  p:  2n ** 256n - 2n ** 32n - 977n,
  n:  0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n,
  gx: 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n,
  gy: 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n,
};

const mod = (a, m) => ((a % m) + m) % m;

function modpow(b, e, m) {
  let r = 1n;
  b = mod(b, m);
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}

const modinv = (a, m) => modpow(a, m - 2n, m); // m prime (Fermat)

// ----------------------------------------------- Jacobian point arithmetic
// Point = [X, Y, Z]; infinity = Z === 0n. Curve: y² = x³ + 7 (a = 0).

const INF = [1n, 1n, 0n];
const G = [EC.gx, EC.gy, 1n];

function pointDouble([X, Y, Z]) {
  const { p } = EC;
  if (Z === 0n || Y === 0n) return INF;
  const Y2 = (Y * Y) % p;
  const S = (4n * X * Y2) % p;
  const M = (3n * X * X) % p;
  const X3 = mod(M * M - 2n * S, p);
  const Y3 = mod(M * (S - X3) - 8n * Y2 * Y2, p);
  const Z3 = (2n * Y * Z) % p;
  return [X3, Y3, Z3];
}

function pointAdd(P, Q) {
  const { p } = EC;
  if (P[2] === 0n) return Q;
  if (Q[2] === 0n) return P;
  const Z1Z1 = (P[2] * P[2]) % p;
  const Z2Z2 = (Q[2] * Q[2]) % p;
  const U1 = (P[0] * Z2Z2) % p;
  const U2 = (Q[0] * Z1Z1) % p;
  const S1 = (P[1] * Z2Z2 % p) * Q[2] % p;
  const S2 = (Q[1] * Z1Z1 % p) * P[2] % p;
  if (U1 === U2) return S1 === S2 ? pointDouble(P) : INF;
  const H = mod(U2 - U1, p);
  const R = mod(S2 - S1, p);
  const H2 = (H * H) % p;
  const H3 = (H2 * H) % p;
  const U1H2 = (U1 * H2) % p;
  const X3 = mod(R * R - H3 - 2n * U1H2, p);
  const Y3 = mod(R * (U1H2 - X3) - S1 * H3, p);
  const Z3 = ((H * P[2]) % p) * Q[2] % p;
  return [X3, Y3, Z3];
}

function pointMul(P, k) {
  let R = INF, A = P;
  while (k > 0n) {
    if (k & 1n) R = pointAdd(R, A);
    A = pointDouble(A);
    k >>= 1n;
  }
  return R;
}

function toAffine([X, Y, Z]) {
  if (Z === 0n) return null;
  const { p } = EC;
  const zi = modinv(Z, p);
  const zi2 = (zi * zi) % p;
  return [(X * zi2) % p, (Y * zi2 % p) * zi % p];
}

/** x-only pubkey -> affine point with even y, or null. */
function liftX(x) {
  const { p } = EC;
  if (x <= 0n || x >= p) return null;
  const c = mod(x * x % p * x + 7n, p);
  const y = modpow(c, (p + 1n) / 4n, p);
  if ((y * y) % p !== c) return null; // not on curve
  return [x, (y & 1n) === 0n ? y : p - y, 1n];
}

// ------------------------------------------------------------------ hashing

const utf8 = (s) => new TextEncoder().encode(s);

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

const _tagHashCache = new Map();

async function taggedHash(tag, msg) {
  let th = _tagHashCache.get(tag);
  if (!th) {
    th = await sha256(utf8(tag));
    _tagHashCache.set(tag, th);
  }
  const buf = new Uint8Array(64 + msg.length);
  buf.set(th, 0);
  buf.set(th, 32);
  buf.set(msg, 64);
  return sha256(buf);
}

// ------------------------------------------------------------------ bytes

function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(b)) return null;
    out[i] = b;
  }
  return out;
}

const bytesToHex = (b) =>
  [...b].map(x => x.toString(16).padStart(2, "0")).join("");

const bytesToBigInt = (b) => BigInt("0x" + (bytesToHex(b) || "0"));

function bigIntTo32(x) {
  return hexToBytes(x.toString(16).padStart(64, "0"));
}

// ------------------------------------------------------------------ verify

/** BIP-340 Schnorr verification. All args hex strings (32/32/64 bytes). */
async function schnorrVerify(pubkeyHex, msgHex, sigHex) {
  const pub = hexToBytes(pubkeyHex), msg = hexToBytes(msgHex),
        sig = hexToBytes(sigHex);
  if (!pub || !msg || !sig || pub.length !== 32 || msg.length !== 32 ||
      sig.length !== 64) return false;

  const P = liftX(bytesToBigInt(pub));
  if (!P) return false;
  const r = bytesToBigInt(sig.subarray(0, 32));
  const s = bytesToBigInt(sig.subarray(32));
  if (r >= EC.p || s >= EC.n) return false;

  const challenge = new Uint8Array(96);
  challenge.set(sig.subarray(0, 32), 0);
  challenge.set(pub, 32);
  challenge.set(msg, 64);
  const e = mod(bytesToBigInt(await taggedHash("BIP0340/challenge", challenge)),
                EC.n);

  // R = s*G + (n - e)*P
  const R = toAffine(pointAdd(pointMul(G, s), pointMul(P, EC.n - e)));
  return R !== null && (R[1] & 1n) === 0n && R[0] === r;
}

/**
 * Full Nostr event check: canonical id + signature.
 * Returns true only if both hold.
 */
async function verifyNostrEvent(ev) {
  try {
    const serialized = JSON.stringify(
      [0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]);
    const id = bytesToHex(await sha256(utf8(serialized)));
    if (id !== ev.id) return false;
    return await schnorrVerify(ev.pubkey, ev.id, ev.sig);
  } catch {
    return false;
  }
}
