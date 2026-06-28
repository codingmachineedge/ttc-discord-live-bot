# TTC Discord Live Bot

A Dockerized Discord bot that tracks live TTC GTFS-Realtime service alerts, delays, disruptions, and subway/LRT vehicle positions.

## What it Shows

- Current TTC service alerts, delays, and disruptions.
- Live subway/LRT vehicles for tracked lines when TTC publishes them in the configured GTFS-Realtime vehicle feed.
- Vehicle number/label when the TTC feed provides it.
- Current GPS position with a Google Maps link.
- Current stop, next stop, ETA, scheduled time, and delay when present in TTC GTFS-Realtime/static GTFS.
- Optional alert polling to a Discord text channel whenever alert state changes.
- Automatic Discord setup for a `TTC Live` category with `ttc-alerts`, `ttc-vehicles`, and `ttc-status` channels.
- Categorized alert channels for subway/LRT, bus/streetcar, accessibility, and general alerts.
- High-quality PNG service alert cards, with resolved alerts deleted when they disappear from the live TTC alert feed.
- Per-user service alert ping settings.
- Real-time trip follower that asks for your vehicle number, lets you choose a get-off stop, announces stop progress, and posts an SVG route progress graphic.
- Live Line 5 departure board threads with a large graphic that keeps editing in place.
- Line 5 Eglinton trip follower messages include a Line 5-style English/French announcer script for next-stop, doors-closing/departure, and get-off reminders.
- Rail/LRT trip follower messages include next-station details for door side, elevators, escalators, washrooms, and station depth when the bot has a configured or inferred value.
- General-channel feedback reader that pings users back after reading TTC bot feedback in `#general` or `GENERAL_CHANNEL_ID`.

The bot uses TTC's public GTFS-Realtime feeds and Toronto Open Data's static GTFS schedule. Some fields are feed-dependent: if TTC does not publish a vehicle label, next stop, ETA, or delay for a vehicle at that moment, the bot reports `n/a` instead of inventing data. TTC's public BusTime feed is officially described for buses and streetcars; the default route filter includes subway/LRT line short names so the bot will surface those vehicles if/when the configured feed contains them.

## Discord Commands

- `/ttc-alerts` - current service alerts, delays, and disruptions.
- `/ttc-vehicles` - all tracked subway/LRT vehicles.
- `/ttc-vehicles line:1` - vehicles for one line.
- `/ttc-status` - feed/config status and tracked routes.
- `/ttc-setup` - create or repair the TTC Live category and channels. Requires Manage Server.
- `/ttc-settings alerts enabled:true` - opt into service alert pings.
- `/ttc-settings alerts enabled:false` - opt out of service alert pings.
- `/ttc-settings view` - show your notification setting.
- `/ttc-follow start` - enter your current vehicle number, choose your destination stop, and start stop-by-stop reminders.
- `/ttc-follow status` - show your current trip follower state with a route graphic.
- `/ttc-follow stop` - stop following your current trip.
- `/ttc-line5-board start` - pick a Line 5 station and direction, then create a thread with a live-updating departure board.

## Setup

1. Create a Discord application and bot at <https://discord.com/developers/applications>.
2. Enable the bot in your server with the `applications.commands` scope.
3. Copy `.env.example` to `.env`.
4. Fill in:

```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_application_client_id
DISCORD_GUILD_ID=your_server_id
ALERT_CHANNEL_ID=optional_channel_id_for_alert_updates
GENERAL_CHANNEL_ID=optional_general_feedback_channel_id
AUTO_SETUP_CHANNELS=true
```

`COMMAND_REGISTER_MODE=guild` is recommended while testing because guild slash commands update quickly. Use `global` only when you want commands registered globally.

## Run with Docker

```bash
docker compose up -d --build
docker compose logs -f
```

If `TEST_DISCORD_TOKEN` is present in `.env`, Docker Compose also starts a scheduled live-test bot that posts test steps, including an image attachment, to the general channel every 15 minutes.

## Run Locally

```bash
npm install
npm run build
npm start
```

For development:

```bash
npm run dev
```

Run the separate test bot once:

```bash
TEST_DISCORD_TOKEN=temporary_test_bot_token npm run live-test
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` | required | Discord bot token. |
| `DISCORD_CLIENT_ID` | required | Discord application client ID. |
| `DISCORD_GUILD_ID` | blank | Server ID for fast guild command registration. |
| `ALERT_CHANNEL_ID` | blank | Text channel for automatic alert updates. |
| `GENERAL_CHANNEL_ID` | blank | Optional exact channel ID for general feedback reading. If blank, channels named `general` are used. |
| `TEST_DISCORD_TOKEN` | blank | Optional separate bot token for the scheduled live-test bot. Keep it out of Git. |
| `TEST_GUILD_ID` | blank | Optional guild override for the live-test bot. |
| `TEST_GENERAL_CHANNEL_ID` | blank | Optional general-channel override for the live-test bot. |
| `AUTO_SETUP_CHANNELS` | `true` | Automatically create/update the `TTC Live` category and channels on startup. |
| `POLL_INTERVAL_SECONDS` | `30` | Alert poll interval. |
| `COMMAND_REGISTER_MODE` | `guild` | `guild` or `global`. |
| `SUBWAY_LRT_ROUTE_SHORT_NAMES` | `1,2,3,4,5,6` | TTC line short names to include. |
| `TTC_VEHICLE_POSITIONS_URL` | TTC public feed | GTFS-Realtime vehicle positions endpoint. |
| `TTC_TRIP_UPDATES_URL` | TTC public feed | GTFS-Realtime trip updates endpoint. |
| `TTC_ALERTS_URL` | TTC public feed | GTFS-Realtime alerts endpoint. |
| `TTC_STATIC_GTFS_URL` | Toronto Open Data zip | Static GTFS schedule zip. |

## Notes

- The bot does not need a database. It caches TTC feed responses in memory and downloads static GTFS on startup.
- User ping settings and auto-created channel IDs are stored in `.data/settings.json`. The Docker Compose file persists this with the `ttc-cache` named volume.
- Trip follower sessions are also stored in `.data/settings.json`, so a container restart does not forget active followers.
- Line 5 departure-board sessions are stored in `.data/settings.json` and keep editing the same message in their thread.
- Dynamic bot messages are split before Discord's 2000-character limit.
- Service alerts are posted as individual PNG cards so they can be removed when no longer active.
- Static GTFS is used for route names, stop names, scheduled stop times, and next-stop fallback.
- Live ETA/delay comes from TTC trip updates when available.
- Trip follower announcements depend on TTC publishing the entered vehicle in the realtime vehicle feed with an active `trip_id` and stop sequence.
- Line 5 bilingual wording is generated by the bot as an approximation of passenger-facing announcement style. It is not an official TTC announcement script.
- Door side, station depth, and amenity availability are not available in the GTFS-Realtime feed. The bot reports `unknown` unless a value is configured or an active TTC alert mentions the station and amenity.
- The default tracked short names include Lines 1-4 and planned/active LRT short names 5 and 6 if they appear in the current TTC static GTFS.

## License

MIT
