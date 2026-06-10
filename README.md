# City Layer — v0.1 (Phase 1: Core Event Map)

A city-configurable client platform for **cultural events with first-class
accessibility data**, built on Nostr. Bari is the reference city; any city is
just a JSON profile. Phase 2 adds the Cashu ecash wallet and merchant layer.

## Stack

- **Backend**: Python / FastAPI, SQLite. No build step.
- **Frontend**: vanilla JS (ES2022), MapLibre GL + OpenStreetMap raster tiles.
  The only external assets are the MapLibre CDN files (vendor them under
  `static/vendor/` for fully self-hosted deployments).
- **Protocol**: Nostr NIP-52 calendar events + the City Layer accessibility
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

There will be no events until someone publishes some. Seed demo data:

```bash
python -m tools.seed_events --city bari --dry-run   # inspect first
python -m tools.seed_events --city bari             # publish to city relays
```

The seeder writes a throwaway key to `data/.seed_key` and publishes six sample
Bari events (kind 31923, tagged `["t","bari"]`) to the relays in
`config/cities/bari.json`. Reload the app and they appear on the map.

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

## Known limitations (v0.1)

- **No client-side signature verification** — acceptable while reading from
  trusted city relays, must be fixed before public relays matter (either
  verify Schnorr in the browser or read through the verifying indexer).
- No marker clustering (fine up to a few hundred events).
- No organization allow-listing / moderation — any key can tag `bari`.
  The city-relay model is the intended answer; an org allow-list in the city
  profile is the interim one.
- Wallet, merchants, tickets: Phase 2.
