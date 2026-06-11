# città nostr — v0.6 (Phase 1 complete + Phase 2 foundations)

A city-configurable client platform for **cultural events with first-class
accessibility data**, built on Nostr. Bari is the reference city; any city is
just a JSON profile. Phase 2 adds the Cashu ecash wallet and merchant layer.

## Stack

- **Backend**: Python / FastAPI, SQLite. No build step.
- **Frontend**: vanilla JS (ES2022), MapLibre GL + OpenStreetMap raster tiles.
  The only external assets are the MapLibre CDN files (vendor them under
  `static/vendor/` for fully self-hosted deployments).
- **Protocol**: Nostr NIP-52 calendar events + the Città Nostr accessibility
  tag convention — see `docs/EVENT_SCHEMA.md`.

The browser talks to relays **directly** over WebSocket; the server only has
to serve static files and city profiles. The indexer is optional and powers
server-side search/geo queries later.

## Run it

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

uvicorn server.app:app --reload --port 8400
# open http://localhost:8400
```

There will be no events until someone publishes some. Seed the demo dataset
(4 demo organizations with profiles + 6 events, 4 demo ecash merchants):

```bash
python -m tools.seed_events --city bari --dry-run            # inspect first
python -m tools.seed_events --city bari --update-allowlist   # publish + trust
```

`--update-allowlist` writes the generated org/place pubkeys into
`trustedPublishers` / `trustedPlaces` in the city profile, so the client
shows them with a ✓. The demo now includes 16 typed places (shops, food,
venue box office, transport, worship, POI, info point) — 8 accepting ecash,
8 not — each a toggleable map layer. Keys persist in `data/demo_keys.json`; d-tags are
deterministic, so re-running the seeder *replaces* the published data instead
of duplicating it. All demo content lives in `config/cities/bari.demo.json` —
including every venue coordinate, so location fixes happen in that one file.

Optional — run the indexer (foundation for server-side search):

```bash
python -m server.indexer --city bari --once   # sync to SQLite and exit
curl 'localhost:8400/api/events?city=bari&a11y=wheelchair'
```

## Layout

```
config/cities/bari.json   city profile: relays, mints, bounds, languages, branding
server/app.py             FastAPI: static files, /api/cities, /api/events
server/indexer.py         relay -> SQLite indexer (optional service)
server/nostr_util.py      event id, geohash, NIP-52 parsing (stdlib only)
static/                   the web client (index.html, css/, js/)
tools/seed_events.py      sign + publish demo events
docs/EVENT_SCHEMA.md      the publishing convention organizations follow
```

## Adding a city

Copy `config/cities/bari.json`, change id/relays/bounds/languages, open
`/?city=<id>`. That's the whole multi-tenant mechanism for now.

## Trust model

Every event is verified twice over before display:

1. **Integrity** — the event id must equal the SHA-256 of the canonical
   NIP-01 serialization, and the BIP-340 Schnorr signature must verify
   against the author pubkey. The browser does this itself
   (`static/js/verify.js`, pure JS over BigInt + WebCrypto, no dependencies,
   ~10 ms/event); the indexer does the same via coincurve. Invalid events
   are dropped and counted (`pool.rejected`, console warning).
2. **Authorization** — if `trustedPublishers` / `trustedMerchants` in the
   city profile are non-empty, only events/merchants signed by those pubkeys
   are accepted (client and indexer both enforce events; the client enforces
   merchants). Empty lists = open bootstrap mode. The seeder's
   `--update-allowlist` flag maintains the lists for the demo identities.

3. **Identity** — publishers' kind-0 profiles are fetched (for allow-listed
   keys immediately, otherwise on discovery) and shown as
   "pubblicato da \<name\> ✓" where ✓ marks an allow-listed key. Profiles
   carry a `cittanostr` extension with the org's home venue and geohash —
   see `docs/EVENT_SCHEMA.md`.

`verify.js` needs a secure context for WebCrypto — localhost or https,
which any real deployment has anyway.

## Troubleshooting: stale relay data

Relays never forget. If you published with an older seeder version you will
see the *old* events (different keys, different d-tags) alongside or instead
of the new data — symptoms: outdated titles, "Luoghi 0", no publisher names.
Fix: re-run `python -m tools.seed_events --city bari --update-allowlist`.
Populating the allow-lists automatically hides everything signed by the old
throwaway keys, and the new deterministic d-tags keep future re-runs
idempotent. Also hard-reload the browser (the HTML now carries `?v=`
cache-busters on all assets, so this is only needed once).

## Wallet & tickets (Phase 2/3)

The wallet now speaks real Cashu (BDHKE over the EC primitives from
`verify.js`, NUT-00/01/02/03): **receive** swaps a pasted `cashuA` token at
its mint, so the proofs become yours and the sender's copy dies; **send**
selects proofs, swaps for exact denominations plus change, and emits a fresh
token; balances are per-mint and only count *claimed* proofs. Tokens pasted
with v0.4 appear under "pending" with a one-click redeem.

**Tickets.** Events may carry `["price", "<amount>", "sat"]`. The client
shows the price in the list and a "Buy ticket" button in the event popup:
buying calls `wallet.send(price)` and stores the resulting token as a ticket
("My tickets" in the wallet). At the door, the organization redeems the
presented token:

```bash
python -m tools.cashu_cli redeem --token cashuA...
```

A successful redeem means the payment is now the organizer's and the token
cannot be presented twice (the mint atomically marks it spent).

**Local development mint.** Everything runs offline against your own mint:

```bash
uvicorn tools.dev_mint:app --port 3338           # terminal 1
python -m tools.cashu_cli mint --amount 1000     # prints a cashuA token
# paste it into the app wallet -> redeemed -> buy tickets
```

The dev mint implements NUT-01/02/03/04/06 with auto-paid quotes and
in-memory double-spend tracking — fake money, restart forgets state. Bari's
profile lists `http://localhost:3338` first, then testnut.cashu.space.

**Security caveats (documented TODOs).** Tickets are *bearer* tokens: anyone
who copies one can redeem it — NUT-11 P2PK locking fixes this and is the next
hardening step. The wallet does not yet verify DLEQ proofs (NUT-12), so it
trusts the mint not to fingerprint outputs. No melt/Lightning (NUT-05), no
cashuB/V4 decoding. localStorage holding real value would need encryption +
backup before any non-test deployment.

## Known limitations (v0.3)

- Tickets are bearer instruments until NUT-11 P2PK locking lands.
- No DLEQ verification (NUT-12), no melt/Lightning, no cashuB/V4 decoding.
- No marker clustering (fine up to a few hundred nodes).
- Place kind 33888 is a provisional convention (documented).
- The indexer stores events only; places/profiles indexing comes with
  server-side search.
