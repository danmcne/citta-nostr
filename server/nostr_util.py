"""Shared Nostr helpers: event id, geohash, NIP-52 parsing.

No third-party dependencies (signing lives in tools/seed_events.py, which
needs coincurve; everything here is stdlib only).
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

CALENDAR_KINDS = (31922, 31923)

A11Y_VOCAB = {
    "wheelchair", "step-free", "accessible-toilet", "hearing-loop",
    "sign-language", "audio-description", "quiet-space", "family-friendly",
}

# ---------------------------------------------------------------- event id

def event_id(pubkey: str, created_at: int, kind: int, tags: list, content: str) -> str:
    """sha256 of the canonical NIP-01 serialization."""
    payload = json.dumps(
        [0, pubkey, created_at, kind, tags, content],
        separators=(",", ":"), ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode()).hexdigest()

# ---------------------------------------------------------------- geohash

_B32 = "0123456789bcdefghjkmnpqrstuvwxyz"

def geohash_encode(lat: float, lng: float, precision: int = 8) -> str:
    lat_lo, lat_hi, lng_lo, lng_hi = -90.0, 90.0, -180.0, 180.0
    bits, ch, even, out = 0, 0, True, []
    while len(out) < precision:
        if even:
            mid = (lng_lo + lng_hi) / 2
            if lng >= mid:
                ch = ch * 2 + 1
                lng_lo = mid
            else:
                ch *= 2
                lng_hi = mid
        else:
            mid = (lat_lo + lat_hi) / 2
            if lat >= mid:
                ch = ch * 2 + 1
                lat_lo = mid
            else:
                ch *= 2
                lat_hi = mid
        even = not even
        bits += 1
        if bits == 5:
            out.append(_B32[ch])
            bits, ch = 0, 0
    return "".join(out)

def geohash_decode(gh: str) -> tuple[float, float]:
    lat_lo, lat_hi, lng_lo, lng_hi = -90.0, 90.0, -180.0, 180.0
    even = True
    for c in gh:
        cd = _B32.index(c)
        for shift in range(4, -1, -1):
            bit = (cd >> shift) & 1
            if even:
                mid = (lng_lo + lng_hi) / 2
                if bit:
                    lng_lo = mid
                else:
                    lng_hi = mid
            else:
                mid = (lat_lo + lat_hi) / 2
                if bit:
                    lat_lo = mid
                else:
                    lat_hi = mid
            even = not even
    return ((lat_lo + lat_hi) / 2, (lng_lo + lng_hi) / 2)

# ---------------------------------------------------------------- parsing

def tag_values(tags: list, name: str) -> list[str]:
    return [t[1] for t in tags if len(t) >= 2 and t[0] == name]

def first_tag(tags: list, name: str) -> str | None:
    vals = tag_values(tags, name)
    return vals[0] if vals else None

def parse_calendar_event(ev: dict[str, Any]) -> dict[str, Any] | None:
    """Parse a raw Nostr event into our normalized EventNode, or None if invalid."""
    if ev.get("kind") not in CALENDAR_KINDS:
        return None
    tags = ev.get("tags", [])
    d = first_tag(tags, "d")
    title = first_tag(tags, "title")
    start_raw = first_tag(tags, "start")
    if not (d and title and start_raw):
        return None

    if ev["kind"] == 31923:  # unix seconds
        try:
            start = int(start_raw)
            end_raw = first_tag(tags, "end")
            end = int(end_raw) if end_raw else None
        except ValueError:
            return None
    else:  # 31922: ISO dates -> midnight UTC seconds
        from datetime import datetime, timezone
        try:
            start = int(datetime.fromisoformat(start_raw)
                        .replace(tzinfo=timezone.utc).timestamp())
            end_raw = first_tag(tags, "end")
            end = (int(datetime.fromisoformat(end_raw)
                       .replace(tzinfo=timezone.utc).timestamp())
                   if end_raw else None)
        except ValueError:
            return None

    lat = lng = None
    ghs = tag_values(tags, "g")
    if ghs:
        gh = max(ghs, key=len)  # most precise
        try:
            lat, lng = geohash_decode(gh)
        except ValueError:
            pass

    a11y = sorted({v for v in tag_values(tags, "a11y") if v in A11Y_VOCAB})
    cats = sorted({v for v in tag_values(tags, "t")})

    price = None
    for tg in tags:
        if len(tg) >= 2 and tg[0] == "price":
            try:
                amt = int(tg[1])
                if amt > 0:
                    price = {"amount": amt,
                             "unit": tg[2] if len(tg) > 2 else "sat"}
            except ValueError:
                pass
            break

    return {
        "id": ev["id"],
        "pubkey": ev["pubkey"],
        "kind": ev["kind"],
        "d": d,
        "created_at": ev["created_at"],
        "title": title,
        "description": ev.get("content", ""),
        "start": start,
        "end": end,
        "location": first_tag(tags, "location"),
        "lat": lat,
        "lng": lng,
        "a11y": a11y,
        "tags": cats,
        "image": first_tag(tags, "image"),
        "price": price,
    }
