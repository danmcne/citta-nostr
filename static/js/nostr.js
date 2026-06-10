// Città Nostr — Nostr relay pool + NIP-52 parsing.
// Plain WebSocket, no libraries, read-only.
// Every incoming event is verified (canonical id + BIP-340 signature,
// see verify.js) before it reaches the app; invalid events are dropped.
"use strict";

const CALENDAR_KINDS = [31922, 31923];
const MERCHANT_KIND = 33888;

class RelayPool {
  /**
   * @param {string[]} relays
   * @param {(node: object) => void} onEvent  called with parsed EventNode
   * @param {(connected: number) => void} onStatus
   */
  constructor(relays, onEvent, onStatus) {
    this.relays = relays;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.sockets = new Map();   // url -> WebSocket
    this.seenIds = new Set();
    this.rejected = 0;          // events that failed verification
    this.subId = "cittanostr-" + Math.random().toString(36).slice(2, 10);
    this.filters = null;
    this.profileFilter = null;  // lazily built kind-0 request
  }

  /** @param {object[]} filters  one REQ carrying multiple NIP-01 filters */
  subscribe(filters) {
    this.filters = filters;
    this.relays.forEach(url => this._connect(url));
  }

  /** Fetch kind-0 profiles for a set of authors (replaces previous request). */
  requestProfiles(pubkeys) {
    if (!pubkeys.length) return;
    this.profileFilter = { kinds: [0], authors: [...pubkeys] };
    for (const ws of this.sockets.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(["REQ", this.subId + "-p", this.profileFilter]));
      }
    }
  }

  _connect(url, attempt = 0) {
    let ws;
    try { ws = new WebSocket(url); } catch { return; }
    this.sockets.set(url, ws);

    ws.onopen = () => {
      this._status();
      ws.send(JSON.stringify(["REQ", this.subId, ...this.filters]));
      if (this.profileFilter) {
        ws.send(JSON.stringify(["REQ", this.subId + "-p", this.profileFilter]));
      }
    };

    ws.onmessage = (msg) => {
      let data;
      try { data = JSON.parse(msg.data); } catch { return; }
      if (data[0] === "EVENT" && String(data[1]).startsWith(this.subId)) {
        const ev = data[2];
        if (this.seenIds.has(ev.id)) return;
        this.seenIds.add(ev.id);
        this._verifyAndEmit(ev, url);
      }
    };

    ws.onclose = () => {
      this.sockets.delete(url);
      this._status();
      const delay = Math.min(2000 * 2 ** attempt, 60000);
      setTimeout(() => this._connect(url, attempt + 1), delay);
    };
    ws.onerror = () => ws.close();
  }

  async _verifyAndEmit(ev, url) {
    if (!(await verifyNostrEvent(ev))) {
      this.rejected++;
      console.warn(`[cittanostr] dropped event with invalid id/signature ` +
                   `${String(ev.id).slice(0, 8)}… from ${url} ` +
                   `(${this.rejected} rejected total)`);
      return;
    }
    if (CALENDAR_KINDS.includes(ev.kind)) {
      const node = parseCalendarEvent(ev);
      if (node) this.onEvent({ type: "event", node });
    } else if (ev.kind === MERCHANT_KIND) {
      const node = parseMerchant(ev);
      if (node) this.onEvent({ type: "merchant", node });
    } else if (ev.kind === 0) {
      const node = parseProfile(ev);
      if (node) this.onEvent({ type: "profile", node });
    }
  }

  _status() {
    const n = [...this.sockets.values()]
      .filter(s => s.readyState === WebSocket.OPEN).length;
    this.onStatus(n);
  }
}

// ------------------------------------------------------------- parsing

function tagValues(tags, name) {
  return tags.filter(t => t.length >= 2 && t[0] === name).map(t => t[1]);
}
function firstTag(tags, name) {
  const v = tagValues(tags, name);
  return v.length ? v[0] : null;
}

const A11Y_VOCAB = new Set([
  "wheelchair", "step-free", "accessible-toilet", "hearing-loop",
  "sign-language", "audio-description", "quiet-space", "family-friendly",
]);

/** Raw Nostr event -> normalized EventNode, or null. */
function parseCalendarEvent(ev) {
  if (!CALENDAR_KINDS.includes(ev.kind)) return null;
  const tags = ev.tags || [];
  const d = firstTag(tags, "d");
  const title = firstTag(tags, "title");
  const startRaw = firstTag(tags, "start");
  if (!d || !title || !startRaw) return null;

  let start, end = null;
  if (ev.kind === 31923) {
    start = parseInt(startRaw, 10);
    const endRaw = firstTag(tags, "end");
    if (endRaw) end = parseInt(endRaw, 10);
  } else {
    start = Date.parse(startRaw + "T00:00:00Z") / 1000;
    const endRaw = firstTag(tags, "end");
    if (endRaw) end = Date.parse(endRaw + "T00:00:00Z") / 1000;
  }
  if (!Number.isFinite(start)) return null;

  let lat = null, lng = null;
  const ghs = tagValues(tags, "g");
  if (ghs.length) {
    const gh = ghs.reduce((a, b) => (b.length > a.length ? b : a));
    const pt = geohashDecode(gh);
    if (pt) [lat, lng] = pt;
  }

  return {
    id: ev.id,
    pubkey: ev.pubkey,
    kind: ev.kind,
    d,
    createdAt: ev.created_at,
    title,
    description: ev.content || "",
    start,
    end,
    location: firstTag(tags, "location"),
    lat,
    lng,
    a11y: [...new Set(tagValues(tags, "a11y").filter(v => A11Y_VOCAB.has(v)))],
    cats: [...new Set(tagValues(tags, "t"))],
    image: firstTag(tags, "image"),
  };
}

/** Raw kind-33888 event -> normalized MerchantNode, or null. */
function parseMerchant(ev) {
  if (ev.kind !== MERCHANT_KIND) return null;
  const tags = ev.tags || [];
  const d = firstTag(tags, "d");
  const name = firstTag(tags, "title");
  if (!d || !name) return null;

  let lat = null, lng = null;
  const ghs = tagValues(tags, "g");
  if (ghs.length) {
    const pt = geohashDecode(ghs.reduce((a, b) => (b.length > a.length ? b : a)));
    if (pt) [lat, lng] = pt;
  }
  const mints = tagValues(tags, "ecash");
  return {
    id: ev.id, pubkey: ev.pubkey, kind: ev.kind, d,
    createdAt: ev.created_at,
    name,
    description: ev.content || "",
    address: firstTag(tags, "location"),
    lat, lng,
    cats: [...new Set(tagValues(tags, "t"))],
    mints,
    acceptsEcash: mints.length > 0,
  };
}

/** Raw kind-0 event -> { pubkey, name, about, meta }, or null. */
function parseProfile(ev) {
  if (ev.kind !== 0) return null;
  try {
    const c = JSON.parse(ev.content || "{}");
    return {
      pubkey: ev.pubkey,
      createdAt: ev.created_at,
      name: c.name || c.display_name || null,
      about: c.about || "",
      meta: c.cittanostr || null,   // città nostr extension: city/role/venue/g
    };
  } catch { return null; }
}

// ------------------------------------------------------------- geohash

const GH32 = "0123456789bcdefghjkmnpqrstuvwxyz";

function geohashDecode(gh) {
  let latLo = -90, latHi = 90, lngLo = -180, lngHi = 180, even = true;
  for (const c of gh.toLowerCase()) {
    const cd = GH32.indexOf(c);
    if (cd === -1) return null;
    for (let shift = 4; shift >= 0; shift--) {
      const bit = (cd >> shift) & 1;
      if (even) {
        const mid = (lngLo + lngHi) / 2;
        if (bit) lngLo = mid; else lngHi = mid;
      } else {
        const mid = (latLo + latHi) / 2;
        if (bit) latLo = mid; else latHi = mid;
      }
      even = !even;
    }
  }
  return [(latLo + latHi) / 2, (lngLo + lngHi) / 2];
}
