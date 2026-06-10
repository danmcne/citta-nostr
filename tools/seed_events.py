"""Publish demo data for a city: org profiles, events, and ecash merchants.

Reads config/cities/<city>.demo.json, generates one key per organization and
merchant (persisted in data/demo_keys.json), then signs and publishes:

  - kind 0      profiles (name/about + cittanostr metadata) for every entity
  - kind 31923  NIP-52 events, signed by the owning organization's key
  - kind 33888  città nostr merchant nodes (see docs/EVENT_SCHEMA.md)

Usage:
    python -m tools.seed_events --city bari --dry-run            # print only
    python -m tools.seed_events --city bari --update-allowlist   # add pubkeys
                                                                 # to the city
                                                                 # profile, then
                                                                 # publish
    python -m tools.seed_events --city bari                      # just publish

Requires: coincurve, websockets
"""
from __future__ import annotations

import argparse
import asyncio
import json
import secrets
import time
from pathlib import Path

import websockets
from coincurve import PrivateKey

from server.nostr_util import event_id, geohash_encode

ROOT = Path(__file__).resolve().parent.parent
KEYS_FILE = ROOT / "data" / "demo_keys.json"

MERCHANT_KIND = 33888
NOW = int(time.time())


# ------------------------------------------------------------------ keys

def load_keys() -> dict[str, str]:
    if KEYS_FILE.exists():
        return json.loads(KEYS_FILE.read_text())
    return {}


def key_for(keys: dict[str, str], entity_id: str) -> PrivateKey:
    if entity_id not in keys:
        keys[entity_id] = secrets.token_bytes(32).hex()
        KEYS_FILE.parent.mkdir(parents=True, exist_ok=True)
        KEYS_FILE.write_text(json.dumps(keys, indent=2))
    return PrivateKey(bytes.fromhex(keys[entity_id]))


def xonly_pubkey(sk: PrivateKey) -> str:
    return sk.public_key.format(compressed=True)[1:33].hex()


# ------------------------------------------------------------------ signing

def sign_event(sk: PrivateKey, kind: int, tags: list, content: str,
               created_at: int | None = None) -> dict:
    pubkey = xonly_pubkey(sk)
    created_at = created_at or int(time.time())
    eid = event_id(pubkey, created_at, kind, tags, content)
    return {"id": eid, "pubkey": pubkey, "created_at": created_at,
            "kind": kind, "tags": tags, "content": content,
            "sig": sk.sign_schnorr(bytes.fromhex(eid)).hex()}


# ------------------------------------------------------------------ builders

def stable_d(city_id: str, entity_id: str, suffix: str = "") -> str:
    """Deterministic d-tag so re-running the seeder REPLACES instead of
    duplicating (parameterized-replaceable semantics)."""
    return f"cittanostr-{city_id}-{entity_id}" + (f"-{suffix}" if suffix else "")


def build_profile(sk: PrivateKey, city: dict, ent: dict, role: str) -> dict:
    content = {
        "name": ent["name"],
        "about": ent.get("about", ""),
        "cittanostr": {
            "city": city["id"],
            "role": role,
            "venue": ent.get("venue"),
            "address": ent.get("address"),
            "g": geohash_encode(ent["lat"], ent["lng"], 9),
        },
    }
    return sign_event(sk, 0, [], json.dumps(content, ensure_ascii=False))


def build_org_events(sk: PrivateKey, city: dict, org: dict) -> list[dict]:
    out = []
    for i, ev in enumerate(org.get("events", [])):
        lat = ev.get("lat", org["lat"])
        lng = ev.get("lng", org["lng"])
        start = NOW + int(ev["offsetH"] * 3600)
        end = start + int(ev["durationH"] * 3600)
        tags = [
            ["d", stable_d(city["id"], org["id"], str(i))],
            ["title", ev["title"]],
            ["start", str(start)],
            ["end", str(end)],
            ["location", f'{ev.get("venue", org["venue"])}, {city["name"]}'],
            ["g", geohash_encode(lat, lng, 9)],
            ["t", city["communityTag"]],
            *[["t", c] for c in ev.get("cats", [])],
            *[["a11y", a] for a in ev.get("a11y", [])],
            ["l", "it", "ISO-639-1"],
        ]
        out.append(sign_event(sk, 31923, tags, ev["desc"]))
    return out


def build_merchant(sk: PrivateKey, city: dict, m: dict) -> dict:
    mints = m.get("mints") or city.get("mints") or []
    tags = [
        ["d", stable_d(city["id"], m["id"])],
        ["title", m["name"]],
        ["location", m["address"]],
        ["g", geohash_encode(m["lat"], m["lng"], 9)],
        ["t", city["communityTag"]],
        *[["t", c] for c in m.get("cats", [])],
        *[["ecash", url] for url in mints],
    ]
    return sign_event(sk, MERCHANT_KIND, tags, m.get("about", ""))


# ------------------------------------------------------------------ publish

async def publish(relay: str, events: list[dict]) -> None:
    try:
        async with websockets.connect(relay, open_timeout=10) as ws:
            for ev in events:
                await ws.send(json.dumps(["EVENT", ev]))
                try:
                    reply = json.loads(await asyncio.wait_for(ws.recv(), 10))
                    ok = reply[0] == "OK" and reply[2]
                    print(f"[{relay}] kind {ev['kind']:>5} {ev['id'][:8]} -> "
                          f"{'accepted' if ok else reply}")
                except asyncio.TimeoutError:
                    print(f"[{relay}] {ev['id'][:8]} -> no reply")
    except Exception as exc:  # noqa: BLE001
        print(f"[{relay}] failed: {exc}")


def update_allowlist(city_path: Path, city: dict,
                     org_pubkeys: list[str], merchant_pubkeys: list[str]) -> None:
    city["trustedPublishers"] = sorted(set(city.get("trustedPublishers") or [])
                                       | set(org_pubkeys))
    city["trustedMerchants"] = sorted(set(city.get("trustedMerchants") or [])
                                      | set(merchant_pubkeys))
    city_path.write_text(json.dumps(city, indent=2, ensure_ascii=False) + "\n")
    print(f"allow-lists updated in {city_path.name}: "
          f"{len(city['trustedPublishers'])} publishers, "
          f"{len(city['trustedMerchants'])} merchants")


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", default="bari")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--update-allowlist", action="store_true",
                    help="add demo pubkeys to the city profile allow-lists")
    args = ap.parse_args()

    city_path = ROOT / "config" / "cities" / f"{args.city}.json"
    city = json.loads(city_path.read_text())
    demo = json.loads((ROOT / "config" / "cities" /
                       f"{args.city}.demo.json").read_text())
    keys = load_keys()

    batch: list[dict] = []
    org_pubkeys, merchant_pubkeys = [], []

    for org in demo["organizations"]:
        sk = key_for(keys, org["id"])
        org_pubkeys.append(xonly_pubkey(sk))
        batch.append(build_profile(sk, city, org, "organization"))
        batch.extend(build_org_events(sk, city, org))

    for m in demo["merchants"]:
        sk = key_for(keys, m["id"])
        merchant_pubkeys.append(xonly_pubkey(sk))
        batch.append(build_profile(sk, city, m, "merchant"))
        batch.append(build_merchant(sk, city, m))

    print("entities:")
    for kind_name, ents, pks in (("org", demo["organizations"], org_pubkeys),
                                 ("merchant", demo["merchants"], merchant_pubkeys)):
        for ent, pk in zip(ents, pks):
            print(f"  [{kind_name:<8}] {ent['id']:<24} {pk}")

    if args.update_allowlist:
        update_allowlist(city_path, city, org_pubkeys, merchant_pubkeys)
    else:
        trusted = set(city.get("trustedPublishers") or [])
        if trusted and not set(org_pubkeys) <= trusted:
            print("NOTE: some demo pubkeys are NOT in trustedPublishers — "
                  "the client will hide their events. "
                  "Re-run with --update-allowlist to add them.")

    if args.dry_run:
        print(json.dumps(batch, indent=2, ensure_ascii=False))
        return
    await asyncio.gather(*(publish(r, batch) for r in city["relays"]))


if __name__ == "__main__":
    asyncio.run(main())
