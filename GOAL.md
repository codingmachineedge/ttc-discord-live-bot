# Project Goal — TTC Discord Live Bot

**Mission:** A Discord bot that surfaces *real, live* TTC data — service alerts,
vehicle positions, trip updates, departure boards, trip following — with special,
first-class support for **Line 5 Eglinton**, and clear, accessible, all-ages-readable
image cards.

## Definition of done (loop until all true)

1. **GTFS-realtime works end to end.**
   - Alerts feed parses real alerts. ✅ (43 alerts live)
   - Vehicle positions + trip updates parse and surface real vehicles for routes
     actually present in the feed (surface routes confirmed working, e.g. route 320 → 18 vehicles). ✅
   - Subway/LRT (1,2,4,5,6) are **not** in the `bustime.ttc.ca` feed — the bot must
     degrade honestly and use the correct Line 5 realtime source (see research).
2. **Line 5 Eglinton realtime works** via the correct authoritative source.
3. **All slash commands function** without unhandled errors; `/ttc-line5-board`
   `interaction` reply bug fixed (missing `return`/await ordering).
4. **Image generation** is clearer, higher-contrast, larger legible fonts, clean
   layout — readable by all ages.
5. **Special Line 5 features** present: status, stops, realtime departures, map.
6. Bot **builds clean** (`tsc --noEmit` exit 0) and is **deployed** to the host
   `docker@192.168.50.242`.

## Operating mode
- Refresh / iterate every 5 minutes via `/loop 5m`. Never stop until DoD met.
- Commit AND push each working increment to `origin/main`.
- Only surface true blockers (missing token/auth that cannot be resolved).

## Host
- Bot host: `docker@192.168.50.242`.

## Key findings (2026-06-30)
- `bustime.ttc.ca/gtfsrt/{vehicles,trips,alerts}` = surface (bus/streetcar) only.
- Static GTFS loads fine: 235 routes incl. route 5 "Line 5 Eglinton" (type 0).
- TransSee `ttcsubwaynew` r=5 scrape returns 0 markers — dead/changed source.
