# Architecture

This bot is a Node.js/TypeScript Discord bot that reads TTC GTFS-Realtime feeds, enriches them with TTC static GTFS data, and exposes the result through Discord slash commands, alert polling, trip following, and live Line 5 departure board threads.

## Runtime Flow

Startup runs in this order:

1. Environment variables are parsed in `src/config.ts`.
2. Slash commands are registered through Discord REST in `src/commands.ts`.
3. Static GTFS is downloaded and parsed once through `src/staticGtfs.ts`.
4. A Discord client starts with the `Guilds` gateway intent.
5. On `ClientReady`, the bot optionally creates or repairs TTC channels.
6. Three polling loops begin: alerts, trip followers, and Line 5 departure boards.

The bot does not use a database. Runtime feed responses are cached in memory, and durable guild state is written to `.data/settings.json`.

## Main Modules

| Module | Responsibility |
| --- | --- |
| `src/index.ts` | Discord client lifecycle, interaction handlers, polling loops, and command execution. |
| `src/config.ts` | Environment validation and route short-name configuration. |
| `src/commands.ts` | Slash command definitions and Discord command registration. |
| `src/discordSetup.ts` | Auto-creates the `TTC Live` category and TTC text channels. |
| `src/ttcClient.ts` | Fetches GTFS-Realtime feeds, loads static GTFS, joins route/trip/stop data, and exposes vehicle, alert, trip-stop, and Line 5 helpers. |
| `src/staticGtfs.ts` | Downloads the static GTFS zip and parses `routes.txt`, `stops.txt`, `trips.txt`, and `stop_times.txt`. |
| `src/settingsStore.ts` | Reads and writes guild settings, alert subscriptions, trip follower sessions, and departure board sessions. |
| `src/format.ts` | Formats alert and vehicle text, alert categories, fingerprints, delays, and Discord message chunks. |
| `src/tripFollower.ts` | Builds destination selectors, stop-progress SVGs, and trip follower announcement text. |
| `src/departureBoard.ts` | Formats Line 5 board text and board SVG attachments. |
| `src/stationDetails.ts` | Adds best-effort station detail text for trip follower messages. |

## Data Sources

The realtime feeds are decoded with `gtfs-realtime-bindings`:

- Vehicle positions: `TTC_VEHICLE_POSITIONS_URL`
- Trip updates: `TTC_TRIP_UPDATES_URL`
- Alerts: `TTC_ALERTS_URL`

Static GTFS comes from `TTC_STATIC_GTFS_URL` and is used for route names, stop names, trip stop order, scheduled stop times, and fallback next-stop data.

`src/ttcClient.ts` keeps a 20-second in-memory cache for each realtime feed URL. Static GTFS is loaded through a single promise and reused for the process lifetime.

## Vehicle Enrichment

Vehicle summaries are built by joining:

- GTFS-Realtime vehicle position entities.
- Matching GTFS-Realtime trip updates by `trip_id`.
- Static GTFS routes, trips, stops, and stop times.

The bot filters normal vehicle listings to route short names in `SUBWAY_LRT_ROUTE_SHORT_NAMES`, defaulting to `1,2,3,4,5,6`. Trip following can search all realtime vehicles by vehicle ID or label because riders enter a vehicle number directly.

When realtime fields are missing, the bot uses static GTFS where possible. For example, the next stop may come from the active trip's static stop sequence if the trip update does not provide it. Fields that cannot be inferred are shown as unavailable instead of fabricated.

## Alert Routing

Alert polling computes a fingerprint from each alert's ID, header, description, routes, effect, and severity. Messages are sent only when the fingerprint changes.

Alerts are routed by text heuristics:

| Category | Destination setting | Matching examples |
| --- | --- | --- |
| Subway/LRT | `subwayLrtAlertsChannelId` | Line names, subway, LRT, Eglinton, Finch West, Yonge, Bloor, Danforth, Sheppard, Scarborough. |
| Bus/streetcar | `busStreetcarAlertsChannelId` | Bus, streetcar, replacement bus, route-like numbers. |
| Accessibility | `accessibilityAlertsChannelId` | Elevator, escalator, accessible, accessibility, washroom, Wheel-Trans. |
| General | `generalAlertsChannelId` | Alerts that do not match the above categories. |

If a category channel is missing, the bot falls back to `alertsChannelId`, then `ALERT_CHANNEL_ID`. Users who opt into alert pings are mentioned at the top of routed alert messages.

## Persistence Model

Persistent state lives in `.data/settings.json` under a top-level `guilds` object keyed by Discord guild ID.

Stored guild data includes:

- Auto-created channel IDs.
- Alert subscriber user IDs.
- Posted alert message records for active alert deletion.
- Active trip follower sessions.
- Active Line 5 departure board sessions.

The settings file is read and rewritten on each update through an in-process write queue. There is no distributed lock across processes, so run one bot instance per settings volume.

## Polling Loops

The polling interval is controlled by `POLL_INTERVAL_SECONDS`, with a minimum of 15 seconds.

| Poller | Work performed |
| --- | --- |
| Alert polling | Fetch alerts, compare fingerprint, route changed alert cards to Discord channels. |
| Trip follower polling | Check persisted follower sessions, find the active vehicle, announce sequence/status/destination changes, send progress SVGs, and remove a session after the destination is reached. |
| Line 5 board polling | Refresh persisted board messages by editing the original message in each board thread. |

All three loops run in-process with `setInterval`. Failures are logged and the next interval continues.

## Discord Interaction Model

Commands are slash commands. Trip following and Line 5 board setup use Discord interaction components:

- `/ttc-follow start` opens a modal for the vehicle number.
- The bot stores a temporary follower session after finding a live vehicle.
- The user selects a destination stop from a string select menu.
- `/ttc-line5-board start` shows a station select menu, then a direction select menu.
- The bot creates a thread and stores the message ID so future polls edit the same board.

All command responses that expose personal settings or setup state are ephemeral where appropriate.
