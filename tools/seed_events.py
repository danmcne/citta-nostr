"""Publish sample Bari cultural events to relays (for development/demo).

Generates a throwaway key (or reuses .seed_key), signs NIP-52 events with the
Città Nostr accessibility convention, and publishes them to the city's relays.

    python -m tools.seed_events --city bari --dry-run   # print, don't publish
    python -m tools.seed_events --city bari             # publish to relays

Requires: coincurve, websockets
"""
from __future__ import annotations

import argparse
import asyncio
import json
import secrets
import time
import uuid
from pathlib import Path

import websockets
from coincurve import PrivateKey

from server.nostr_util import event_id, geohash_encode

ROOT = Path(__file__).resolve().parent.parent
KEY_FILE = ROOT / "data" / ".seed_key"

DAY = 86400
NOW = int(time.time())

# title, description(it), venue, lat, lng, start offset, duration, cats, a11y
SAMPLES = [
    ("Concerto al Petruzzelli", "Stagione sinfonica al Teatro Petruzzelli.",
     "Teatro Petruzzelli, Bari", 41.1226, 16.8723, 2 * DAY + 20 * 3600, 2 * 3600,
     ["musica", "teatro"], ["wheelchair", "accessible-toilet", "hearing-loop"]),
    ("Visita guidata a Bari Vecchia", "Passeggiata tra San Nicola e la Cattedrale.",
     "Basilica di San Nicola, Bari", 41.1304, 16.8703, 1 * DAY + 10 * 3600, 2 * 3600,
     ["cultura", "storia"], ["family-friendly"]),
    ("Cinema all'aperto", "Rassegna estiva sul lungomare.",
     "Lungomare Nazario Sauro, Bari", 41.1213, 16.8790, 3 * DAY + 21 * 3600, 2 * 3600,
     ["cinema"], ["wheelchair", "step-free", "family-friendly"]),
    ("Laboratorio LIS per bambini", "Laboratorio teatrale con interprete LIS.",
     "Teatro Kismet, Bari", 41.0890, 16.8410, 5 * DAY + 17 * 3600, 90 * 60,
     ["teatro", "bambini"], ["sign-language", "family-friendly", "quiet-space"]),
    ("Mostra di arte contemporanea", "Esposizione con percorso tattile e audiodescrizione.",
     "Teatro Margherita, Bari", 41.1273, 16.8716, 12 * 3600, 8 * 3600,
     ["arte", "mostra"], ["wheelchair", "audio-description", "accessible-toilet"]),
    ("Festa di quartiere al Libertà", "Musica dal vivo e cucina popolare.",
     "Piazza Risorgimento, Bari", 41.1190, 16.8580, 6 * DAY + 18 * 3600, 5 * 3600,
     ["festa", "musica"], []),
]


def load_or_create_key() -> PrivateKey:
    KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    if KEY_FILE.exists():
        return PrivateKey(bytes.fromhex(KEY_FILE.read_text().strip()))
    sk = PrivateKey(secrets.token_bytes(32))
    KEY_FILE.write_text(sk.to_hex())
    print(f"new seed key written to {KEY_FILE}")
    return sk


def xonly_pubkey(sk: PrivateKey) -> str:
    return sk.public_key.format(compressed=True)[1:33].hex()


def sign_event(sk: PrivateKey, kind: int, tags: list, content: str,
               created_at: int | None = None) -> dict:
    pubkey = xonly_pubkey(sk)
    created_at = created_at or int(time.time())
    eid = event_id(pubkey, created_at, kind, tags, content)
    sig = sk.sign_schnorr(bytes.fromhex(eid)).hex()
    return {"id": eid, "pubkey": pubkey, "created_at": created_at,
            "kind": kind, "tags": tags, "content": content, "sig": sig}


def build_events(city: dict, sk: PrivateKey) -> list[dict]:
    out = []
    for (title, desc, venue, lat, lng, offset, dur, cats, a11y) in SAMPLES:
        start = NOW + offset
        tags = [
            ["d", str(uuid.uuid4())],
            ["title", title],
            ["start", str(start)],
            ["end", str(start + dur)],
            ["location", venue],
            ["g", geohash_encode(lat, lng, 9)],
            ["t", city["communityTag"]],
            *[["t", c] for c in cats],
            *[["a11y", a] for a in a11y],
            ["l", "it", "ISO-639-1"],
        ]
        out.append(sign_event(sk, 31923, tags, desc))
    return out


async def publish(relay: str, events: list[dict]) -> None:
    try:
        async with websockets.connect(relay, open_timeout=10) as ws:
            for ev in events:
                await ws.send(json.dumps(["EVENT", ev]))
                try:
                    reply = json.loads(await asyncio.wait_for(ws.recv(), 10))
                    ok = reply[0] == "OK" and reply[2]
                    print(f"[{relay}] {ev['id'][:8]} -> "
                          f"{'accepted' if ok else reply}")
                except asyncio.TimeoutError:
                    print(f"[{relay}] {ev['id'][:8]} -> no reply")
    except Exception as exc:  # noqa: BLE001
        print(f"[{relay}] failed: {exc}")


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", default="bari")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    city = json.loads((ROOT / "config" / "cities" / f"{args.city}.json").read_text())
    sk = load_or_create_key()
    events = build_events(city, sk)

    pub = xonly_pubkey(sk)
    print(f"publishing as pubkey: {pub}")
    trusted = city.get("trustedPublishers") or []
    if trusted and pub not in trusted:
        print("NOTE: this pubkey is not in trustedPublishers for "
              f"'{city['id']}' — the client will hide these events until "
              "you add it to the city profile.")

    if args.dry_run:
        print(json.dumps(events, indent=2, ensure_ascii=False))
        return
    await asyncio.gather(*(publish(r, events) for r in city["relays"]))


if __name__ == "__main__":
    asyncio.run(main())
