# Operations

This document covers deployment, Docker usage, Discord setup, permissions, configuration, and persistent state for running the TTC Discord Live Bot.

## Required Discord Setup

Create a Discord application and bot in the Discord Developer Portal, then invite the bot to the target server.

The invite should include:

- `bot`
- `applications.commands`

The bot needs these practical server permissions:

| Permission | Why it is needed |
| --- | --- |
| View Channels | Read channel/thread context and resolve configured destinations. |
| Send Messages | Post alerts, follower announcements, status responses, and board messages. |
| Attach Files | Send generated SVG trip progress and Line 5 board graphics. |
| Create Public Threads | Create live Line 5 departure board threads. |
| Send Messages in Threads | Post and edit board content inside board threads. |
| Manage Channels | Required only when `AUTO_SETUP_CHANNELS=true` or `/ttc-setup` is used. |
| Read Message History | Helps the live-test bot verify recent acknowledgement messages. |

The `/ttc-setup` slash command itself is restricted to members with Discord's `Manage Server` permission. The bot account still needs `Manage Channels` to perform the channel creation work.

The main bot uses `Guilds`, `GuildMessages`, and `MessageContent` gateway intents. Enable Message Content Intent in the Discord Developer Portal if you want the bot to read general-channel feedback messages.

## Environment

Copy `.env.example` to `.env` and fill in the Discord token and application ID.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DISCORD_TOKEN` | Yes | none | Bot token from Discord. |
| `DISCORD_CLIENT_ID` | Yes | none | Discord application client ID. |
| `DISCORD_GUILD_ID` | No | empty | Recommended for one-server deployments and fast guild command registration. |
| `ALERT_CHANNEL_ID` | No | empty | Fallback channel for alert polling if auto-created channels are unavailable. |
| `GENERAL_CHANNEL_ID` | No | empty | Exact channel to monitor for user feedback; if empty, channels named `general` are monitored. |
| `TEST_DISCORD_TOKEN` | No | empty | Separate test bot token for the scheduled live-test service. Keep this only in `.env`. |
| `TEST_GUILD_ID` | No | empty | Optional server override for the live-test bot. |
| `TEST_GENERAL_CHANNEL_ID` | No | empty | Optional channel override for the live-test bot. |
| `AUTO_SETUP_CHANNELS` | No | `true` | Creates or repairs TTC channels on startup. |
| `POLL_INTERVAL_SECONDS` | No | `30` | Minimum accepted value is 15. |
| `COMMAND_REGISTER_MODE` | No | `guild` | `guild` registers quickly in one server; `global` can take longer to propagate. |
| `SUBWAY_LRT_ROUTE_SHORT_NAMES` | No | `1,2,3,4,5,6` | Route short names included in normal vehicle listings. |
| `TTC_VEHICLE_POSITIONS_URL` | No | TTC BusTime vehicles feed | GTFS-Realtime vehicle positions endpoint. |
| `TTC_TRIP_UPDATES_URL` | No | TTC BusTime trips feed | GTFS-Realtime trip updates endpoint. |
| `TTC_ALERTS_URL` | No | TTC BusTime alerts feed | GTFS-Realtime alerts endpoint. |
| `TTC_STATIC_GTFS_URL` | No | Toronto Open Data TTC static GTFS zip | Static schedule download. |

Use `COMMAND_REGISTER_MODE=guild` with `DISCORD_GUILD_ID` during development. Use `global` only when the bot should be installed broadly and command propagation delay is acceptable.

## Docker Deployment

Build and run with Docker Compose:

```bash
docker compose up -d --build
docker compose logs -f
```

The Docker image uses a multi-stage build:

1. Install dependencies with `npm ci`.
2. Compile TypeScript with `npm run build`.
3. Install production dependencies only.
4. Run `node dist/index.js` as the non-root `node` user.

The Compose file mounts the named volume `ttc-cache` at `/app/.data`. This volume stores `settings.json`, including channel IDs, alert subscribers, trip followers, and Line 5 board sessions.

Docker Compose also defines `ttc-live-test-bot`. If `TEST_DISCORD_TOKEN` is set, that service runs `scripts/live-test-bot.mjs` every 15 minutes and sends each test step, including an image attachment, to the general channel. If the token is not set, the service stays idle.

## Local Deployment

Install, build, and run:

```bash
npm install
npm run build
npm start
```

For development:

```bash
npm run dev
```

For a type-check without emitting files:

```bash
npm run lint
```

For a one-shot live test with a separate bot:

```bash
TEST_DISCORD_TOKEN=temporary_test_bot_token npm run live-test
```

## Auto-Created Channels

When `AUTO_SETUP_CHANNELS=true`, or when an authorized user runs `/ttc-setup`, the bot creates or repairs a `TTC Live` category with these text channels:

| Channel | Purpose |
| --- | --- |
| `ttc-alerts` | General alert channel and fallback destination. |
| `ttc-alerts-subway-lrt` | Subway and LRT routed alerts. |
| `ttc-alerts-bus-streetcar` | Bus and streetcar routed alerts. |
| `ttc-alerts-accessibility` | Elevator, escalator, washroom, and accessibility routed alerts. |
| `ttc-alerts-general` | Alerts that do not match a specific category. |
| `ttc-vehicles` | Suggested place for vehicle lookup commands. |
| `ttc-status` | Suggested place for status/setup commands. |

The generated channel IDs are stored in `.data/settings.json`. If a channel is deleted, running `/ttc-setup` can recreate it and update stored IDs.

## Settings Persistence

Persistent settings are stored at:

```text
.data/settings.json
```

In Docker, this maps to:

```text
/app/.data/settings.json
```

The settings file contains per-guild records for:

- TTC category and channel IDs.
- Alert subscriber user IDs.
- Posted alert message IDs for active service alerts.
- Trip follower sessions.
- Line 5 departure board sessions.

Back up the Docker named volume or the `.data` directory if you need to preserve followers, board sessions, or channel mappings across host moves. Do not run multiple bot containers against the same settings file because writes are whole-file rewrites without a distributed lock.

## Alert Delivery

Alert polling sends messages only when the alert fingerprint changes. Each changed alert state is grouped by routed destination channel.

For alert notifications:

- Users opt in with `/ttc-settings alerts enabled:true`.
- Users opt out with `/ttc-settings alerts enabled:false`.
- The bot mentions all opted-in users at the top of routed alert messages.

If no routed channel ID exists, alert messages are skipped unless `ALERT_CHANNEL_ID` is configured.

## Operational Checks

Use `/ttc-status` to confirm:

- Polling interval.
- Active alert channel.
- Alert subscriber count.
- Auto-setup state.
- Routes found in static GTFS that match `SUBWAY_LRT_ROUTE_SHORT_NAMES`.

If commands are missing, check:

- `DISCORD_CLIENT_ID` is correct.
- `DISCORD_GUILD_ID` is set when using guild registration.
- The bot was invited with `applications.commands`.
- The process logged a command registration or startup error.

If alerts or vehicles are missing, check:

- The TTC feed URLs are reachable from the host/container.
- Static GTFS downloaded successfully on startup.
- The route short names are present in the current static GTFS.
- TTC is publishing the desired vehicle, trip, alert, ETA, or delay field in the realtime feed.

## Feed and Data Limitations

The bot is limited by the public feeds it consumes.

- TTC may omit vehicle labels, coordinates, next stop, ETA, delay, or trip IDs for some vehicles.
- Trip follower setup requires the entered vehicle to be present in the realtime vehicle feed and to have an active `trip_id`.
- Static GTFS is downloaded once at startup. Restart the bot to pick up a newly published static GTFS zip.
- Line 5 boards depend on Line 5 route, trip, stop, and vehicle data being present in current static and realtime feeds.
- Door side, station depth, and amenity data are not comprehensive GTFS-Realtime fields. The bot uses configured static hints and active alert text where available.

## Restart Behavior

On restart:

- Static GTFS is downloaded again.
- Realtime feed cache starts empty.
- Slash commands are registered again.
- Stored alert subscribers, channel IDs, trip followers, and Line 5 boards are loaded from `.data/settings.json`.
- Existing Line 5 board messages continue to be edited if the thread and message still exist.
- Trip followers continue if the vehicle can still be found in the realtime feed.
