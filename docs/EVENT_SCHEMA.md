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

## Merchants (Phase 2 preview)

Merchants will be kind `30402`-style addressable nodes with `["t", "bari"]`,
a `g` geohash, and `["ecash", "<mint-url>"]` tags. Not implemented in v0.1.
