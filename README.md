# città nostr — v0.3 (Phase 1 complete + Phase 2 foundations)

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

`--update-allowlist` writes the generated org/merchant pubkeys into
`trustedPublishers` / `trustedMerchants` in the city profile, so the client
shows them with a ✓. Keys persist in `data/demo_keys.json`; d-tags are
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

## Wallet (Phase 2, step 1)

The Wallet button opens the Cashu wallet panel: it shows the city's mints
with live status (NUT-06 `/v1/info`), decodes pasted Cashu V3 tokens
(`cashuA…`), and keeps received tokens in localStorage. **Honest status:**
received tokens are *not yet redeemed* — claiming a token requires a
swap at the mint (BDHKE blinding), which is the next implementation step;
until then the balance is labeled as unredeemed and must not be trusted for
real value. `static/js/wallet.js` defines the protocol-agnostic
`WalletProvider` interface the UI talks to. Bari's profile ships with
`https://testnut.cashu.space` (a public TEST mint — fake money) for
development.

## Known limitations (v0.3)

- Wallet cannot yet swap (claim), mint, send, or melt (pay) — next step.
- Cashu V4 (`cashuB`, CBOR) tokens not decoded yet.
- No marker clustering (fine up to a few hundred nodes).
- Merchant kind 33888 is a provisional convention (documented).
- The indexer stores events only; merchants/profiles indexing comes with
  server-side search.
