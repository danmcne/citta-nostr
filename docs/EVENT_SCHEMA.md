# Città Nostr — Event Schema (v0.1)

Events are standard **Nostr NIP-52 calendar events**, so any Nostr client can read
them. Città Nostr adds two conventions on top: a community tag and an
accessibility vocabulary.

## Kinds

| kind  | meaning                          |
|-------|----------------------------------|
| 31923 | time-based event (has start/end unix timestamps) |
| 31922 | date-based event (all-day / multi-day, ISO dates) |

Both are *parameterized replaceable*: the latest event with the same
`(kind, pubkey, d)` wins. Publishing an update = publishing again with the
same `d` tag.

## Tags

```
["d",        "<stable-uuid>"]                  required — replaceability key
["title",    "Notte della Taranta a Bari"]     required
["start",    "1760713200"]                     required (31923: unix seconds)
["end",      "1760727600"]                     optional
["location", "Teatro Petruzzelli, Bari"]       human-readable place
["g",        "sr1n0..."]                       geohash (precision ≥ 7 recommended)
["t",        "bari"]                           required — community tag from city profile
["t",        "musica"]                         zero or more category tags
["a11y",     "wheelchair"]                     zero or more accessibility tags
["l",        "it", "ISO-639-1"]                content language (optional)
["image",    "https://..."]                    optional poster
```

`content` = plain-text description.

## Accessibility vocabulary (`a11y` tag values)

Controlled vocabulary, one tag per feature. **Absence means "unknown", not "no".**

| value               | meaning                                  |
|---------------------|------------------------------------------|
| `wheelchair`        | wheelchair accessible venue              |
| `step-free`         | step-free route from street to seat      |
| `accessible-toilet` | accessible toilet available              |
| `hearing-loop`      | induction loop / assistive listening     |
| `sign-language`     | LIS / sign language interpretation       |
| `audio-description` | audio description available              |
| `quiet-space`       | quiet room or sensory-friendly session   |
| `family-friendly`   | suitable for children / strollers        |

The vocabulary can grow, but values are append-only — never reuse a value with
a different meaning, since old events stay on relays forever.

## Why a `t` community tag and not relay scoping alone?

Dedicated city relays are the goal (local control), but during bootstrap events
also travel over public relays (global redundancy). The `["t", "bari"]` tag lets
clients subscribe meaningfully on *any* relay; the city relay list in the city
profile is the trust/priority layer on top.

## Organization & merchant profiles (kind 0)

Every publisher (organization or merchant) SHOULD publish a standard kind-0
profile. The client resolves author pubkeys to display names through these
("pubblicato da Fondazione Teatro Petruzzelli ✓"). città nostr adds an
optional extension object inside the kind-0 JSON content:

```json
{
  "name": "Teatri di Bari — Kismet",
  "about": "...",
  "cittanostr": {
    "city": "bari",
    "role": "organization",        // or "merchant"
    "venue": "Teatro Kismet OperA",
    "address": "Strada San Giorgio Martire 22/F, Bari",
    "g": "sr1mu..."                // home-venue geohash
  }
}
```

Events still carry their own `g`/`location` (an org can host an event
anywhere); the profile geohash is the organization's *home* venue. Keeping
venue coordinates in profiles means a wrong location is fixed in one place
by the org itself — not by every client.

## Merchants (kind 33888, provisional)

Parameterized-replaceable "merchant node", same replaceability rules as
events. The kind number is a città nostr convention until a suitable NIP
standardizes merchant directories.

```
["d",        "<stable-id>"]            required
["title",    "Caffè del Borgo"]        required — display name
["location", "Piazza Mercantile, Bari"]
["g",        "sr1n0..."]               geohash
["t",        "bari"]                   required — community tag
["t",        "caffè"]                  zero or more category tags
["ecash",    "https://mint.example"]   one per accepted mint;
                                       presence = "accepts ecash"
```

`content` = short description. The client renders merchants as amber squares
(events are circles) and shows the mint URLs in the popup. The
`trustedMerchants` allow-list in the city profile gates display exactly like
`trustedPublishers` gates events.
