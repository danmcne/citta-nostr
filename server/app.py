"""Città Nostr web server.

Serves the static frontend, the city-profile registry, and (if the indexer
has populated the database) a queryable events API.

Run:
    uvicorn server.app:app --reload --port 8400
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .indexer import DB_PATH

ROOT = Path(__file__).resolve().parent.parent
CITIES_DIR = ROOT / "config" / "cities"
STATIC_DIR = ROOT / "static"

app = FastAPI(title="Città Nostr", version="0.2.0")


# ------------------------------------------------------------------ config

@app.get("/api/cities")
def list_cities() -> list[dict]:
    out = []
    for path in sorted(CITIES_DIR.glob("*.json")):
        c = json.loads(path.read_text())
        out.append({"id": c["id"], "name": c["name"],
                    "displayName": c["branding"]["displayName"]})
    return out


@app.get("/api/cities/{city_id}")
def get_city(city_id: str) -> dict:
    path = CITIES_DIR / f"{city_id}.json"
    if not path.is_file() or path.resolve().parent != CITIES_DIR.resolve():
        raise HTTPException(404, "unknown city")
    return json.loads(path.read_text())


# ------------------------------------------------------------------ events
# Served from the indexer's SQLite. The web client currently talks to relays
# directly; this endpoint is the foundation for server-side search later.

@app.get("/api/events")
def list_events(
    city: str = "bari",
    start_after: int | None = Query(None, description="unix seconds"),
    start_before: int | None = Query(None, description="unix seconds"),
    a11y: str | None = Query(None, description="comma-separated, ALL must match"),
) -> list[dict]:
    if not DB_PATH.exists():
        return []
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    sql = "SELECT * FROM events WHERE city = ?"
    args: list = [city]
    if start_after is not None:
        sql += " AND start >= ?"
        args.append(start_after)
    if start_before is not None:
        sql += " AND start <= ?"
        args.append(start_before)
    sql += " ORDER BY start ASC LIMIT 500"
    rows = [dict(r) for r in db.execute(sql, args)]
    for r in rows:
        r["a11y"] = json.loads(r["a11y"])
        r["tags"] = json.loads(r["tags"])
        r.pop("raw", None)
    if a11y:
        need = {v.strip() for v in a11y.split(",") if v.strip()}
        rows = [r for r in rows if need <= set(r["a11y"])]
    return rows


# ------------------------------------------------------------------ static

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
