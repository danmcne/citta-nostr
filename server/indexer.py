"""Città Nostr indexer.

Subscribes to the relays in a city profile, normalizes NIP-52 calendar events
and stores them in SQLite. Replaceable-event semantics: latest created_at wins
per (kind, pubkey, d).

The web client reads relays directly and does NOT depend on this service;
the indexer exists for server-side search/geo queries and as the foundation
for the Phase-2+ API.

Usage:
    python -m server.indexer --city bari            # stream forever
    python -m server.indexer --city bari --once     # sync until EOSE, then exit
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sqlite3
import sys
import time
import uuid
from pathlib import Path

import websockets

from .nostr_util import CALENDAR_KINDS, event_id, parse_calendar_event

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "cittanostr.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id          TEXT PRIMARY KEY,
    city        TEXT NOT NULL,
    kind        INTEGER NOT NULL,
    pubkey      TEXT NOT NULL,
    d           TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    start       INTEGER NOT NULL,
    end         INTEGER,
    location    TEXT,
    lat         REAL,
    lng         REAL,
    a11y        TEXT NOT NULL DEFAULT '[]',
    tags        TEXT NOT NULL DEFAULT '[]',
    image       TEXT,
    raw         TEXT NOT NULL,
    UNIQUE (kind, pubkey, d)
);
CREATE INDEX IF NOT EXISTS idx_events_city_start ON events (city, start);
"""


def open_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.executescript(SCHEMA)
    return db


def load_city(city_id: str) -> dict:
    path = ROOT / "config" / "cities" / f"{city_id}.json"
    return json.loads(path.read_text())


def verify_event(ev: dict) -> bool:
    """Canonical NIP-01 id + BIP-340 signature check."""
    try:
        if ev["id"] != event_id(ev["pubkey"], ev["created_at"], ev["kind"],
                                ev["tags"], ev["content"]):
            return False
        from coincurve import PublicKeyXOnly
        return PublicKeyXOnly(bytes.fromhex(ev["pubkey"])).verify(
            bytes.fromhex(ev["sig"]), bytes.fromhex(ev["id"]))
    except Exception:  # noqa: BLE001 — malformed event of any shape
        return False


def handle_event(db: sqlite3.Connection, city: dict, ev: dict,
                 verify: bool = True) -> bool:
    """Normalize and upsert one raw Nostr event. Returns True if stored."""
    if verify and not verify_event(ev):
        return False
    trusted = city.get("trustedPublishers") or []
    if trusted and ev.get("pubkey") not in trusted:
        return False
    node = parse_calendar_event(ev)
    if node is None:
        return False
    cur = db.execute(
        "SELECT created_at FROM events WHERE kind=? AND pubkey=? AND d=?",
        (node["kind"], node["pubkey"], node["d"]),
    )
    row = cur.fetchone()
    if row and row[0] >= node["created_at"]:
        return False  # we already have a newer (or same) version
    db.execute(
        """INSERT INTO events (id, city, kind, pubkey, d, created_at, title,
                description, start, end, location, lat, lng, a11y, tags, image, raw)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT (kind, pubkey, d) DO UPDATE SET
                id=excluded.id, created_at=excluded.created_at,
                title=excluded.title, description=excluded.description,
                start=excluded.start, end=excluded.end, location=excluded.location,
                lat=excluded.lat, lng=excluded.lng, a11y=excluded.a11y,
                tags=excluded.tags, image=excluded.image, raw=excluded.raw""",
        (
            node["id"], city["id"], node["kind"], node["pubkey"], node["d"],
            node["created_at"], node["title"], node["description"],
            node["start"], node["end"], node["location"], node["lat"],
            node["lng"], json.dumps(node["a11y"]), json.dumps(node["tags"]),
            node["image"], json.dumps(ev, ensure_ascii=False),
        ),
    )
    db.commit()
    return True


async def consume_relay(url: str, city: dict, db: sqlite3.Connection,
                        once: bool, verify: bool = True) -> None:
    sub_id = uuid.uuid4().hex[:12]
    flt = {"kinds": list(CALENDAR_KINDS), "#t": [city["communityTag"]], "limit": 1000}
    backoff = 2
    while True:
        try:
            async with websockets.connect(url, ping_interval=30) as ws:
                print(f"[{url}] connected")
                backoff = 2
                await ws.send(json.dumps(["REQ", sub_id, flt]))
                async for raw in ws:
                    msg = json.loads(raw)
                    if msg[0] == "EVENT" and msg[1] == sub_id:
                        if handle_event(db, city, msg[2], verify=verify):
                            print(f"[{url}] stored {msg[2]['id'][:8]} "
                                  f"{msg[2].get('tags') and ''}")
                    elif msg[0] == "EOSE":
                        print(f"[{url}] EOSE")
                        if once:
                            return
                    elif msg[0] == "NOTICE":
                        print(f"[{url}] NOTICE: {msg[1]}")
        except Exception as exc:  # noqa: BLE001 — keep the loop alive
            if once:
                print(f"[{url}] error: {exc}", file=sys.stderr)
                return
            print(f"[{url}] disconnected ({exc}); retrying in {backoff}s",
                  file=sys.stderr)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 120)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", default="bari")
    ap.add_argument("--once", action="store_true",
                    help="sync until EOSE on every relay, then exit")
    ap.add_argument("--no-verify", action="store_true",
                    help="skip id/signature verification (debugging only)")
    args = ap.parse_args()

    city = load_city(args.city)
    db = open_db()
    t0 = time.time()
    await asyncio.gather(*(consume_relay(r, city, db, args.once,
                                          verify=not args.no_verify)
                           for r in city["relays"]))
    if args.once:
        n = db.execute("SELECT COUNT(*) FROM events WHERE city=?",
                       (city["id"],)).fetchone()[0]
        print(f"done in {time.time() - t0:.1f}s — {n} events for {city['id']}")


if __name__ == "__main__":
    asyncio.run(main())
