# Features

This document describes the user-facing behavior of the TTC Discord Live Bot.

## Commands

| Command | Behavior |
| --- | --- |
| `/ttc-alerts` | Shows current TTC service alerts, delays, and disruptions from the GTFS-Realtime alerts feed. |
| `/ttc-vehicles` | Shows all tracked subway/LRT vehicles from the vehicle feed. |
| `/ttc-vehicles line:<line>` | Filters tracked vehicles to one route short name, such as `1`, `2`, `5`, or `6`. |
| `/ttc-status` | Shows polling interval, alert channel, subscriber count, auto-setup state, and tracked static-GTFS routes. |
| `/ttc-setup` | Creates or repairs the `TTC Live` category and TTC channels. Requires Manage Server for the user and Manage Channels for the bot. |
| `/ttc-settings alerts enabled:true` | Opts the user into alert pings. |
| `/ttc-settings alerts enabled:false` | Opts the user out of alert pings. |
| `/ttc-settings view` | Shows the user's alert ping setting and current alert channel. |
| `/ttc-follow start` | Starts the trip follower flow by asking for a live vehicle number. |
| `/ttc-follow status` | Shows the user's active follower state and progress graphic. |
| `/ttc-follow stop` | Removes the user's active follower session. |
| `/ttc-line5-board start` | Creates a live Line 5 departure board thread after station and direction selection. |

Discord message output is split to stay below Discord message length limits.

## General Channel Feedback

The bot listens for messages in `GENERAL_CHANNEL_ID` when configured, or in channels named `general` otherwise. When it sees a message from a real user or the separate live-test bot, it replies to the author with: `picked up and read. Feature change, fix, or feedback acknowledged.` It ignores its own acknowledgement messages to avoid loops.

Acknowledgements are rate-limited per user per server so a busy general chat is not flooded.

## Scheduled Live Test Bot

The optional `ttc-live-test-bot` Compose service uses a separate `TEST_DISCORD_TOKEN`. Every 15 minutes it posts each live-test step to the general channel and then checks whether the TTC bot acknowledged recent feedback.

## Vehicle Lookup

Vehicle output can include:

- Route name.
- Vehicle ID or vehicle label.
- Headsign.
- Next stop.
- ETA.
- Delay or early/late status.
- Scheduled stop time from static GTFS.
- Current stop.
- GPS coordinates with a Google Maps link.
- Speed, if provided by the feed.
- Last vehicle update time.

The normal vehicle list is filtered to configured route short names. By default, this is `1,2,3,4,5,6`.

## Alerts

`/ttc-alerts` returns active alerts directly from the GTFS-Realtime alerts feed. Each alert can include:

- Header.
- Description.
- Affected routes.
- Effect.
- Cause.
- Severity.
- Active periods.

Automatic alert polling posts only when alert state changes. The bot calculates alert changes from stable alert fields rather than posting every polling interval.

Automatic alerts are posted as individual PNG alert cards. Each posted alert message ID is stored, and when an alert ID disappears from the live feed the bot deletes the corresponding Discord message.

## Alert Routing

When TTC alert channels have been auto-created, alerts are routed to more specific channels:

- Subway/LRT alerts go to `ttc-alerts-subway-lrt`.
- Bus/streetcar alerts go to `ttc-alerts-bus-streetcar`.
- Accessibility alerts go to `ttc-alerts-accessibility`.
- Other alerts go to `ttc-alerts-general`.

Routing is heuristic and based on alert text plus affected route text. If the specific channel ID is not stored, the bot falls back to `ttc-alerts`, then `ALERT_CHANNEL_ID`.

Users can opt into alert pings with `/ttc-settings alerts enabled:true`. Their Discord mentions are included in routed alert posts until they opt out.

## Trip Follower

The trip follower helps a rider follow the vehicle they are currently on.

Flow:

1. The user runs `/ttc-follow start`.
2. The bot opens a modal asking for the vehicle number printed on the TTC vehicle.
3. The bot searches live vehicle data by vehicle ID or vehicle label.
4. If the vehicle has an active trip ID, the bot loads the trip's stop list from static GTFS.
5. The user chooses a destination stop from a Discord select menu.
6. The bot stores the follower session and starts posting progress updates in the original channel.

Follower messages can include:

- User mention.
- Current vehicle status.
- Next stop.
- Destination stop.
- Stops remaining estimate based on stop sequence.
- Station details where available.
- A generated SVG route-progress graphic.

The bot removes the follower session after the vehicle reaches or approaches the selected destination. Users can also remove it manually with `/ttc-follow stop`.

Trip follower sessions are persisted in `.data/settings.json`, so a restart does not immediately forget them. A restored follower still depends on the vehicle appearing again in the realtime feed.

## Line 5 Announcer Text

For Line 5 trips, follower messages include an English/French announcer-style script. The script changes based on whether the vehicle is stopped, in transit, one stop away, or at the destination.

This is generated helper text, not an official TTC announcement script.

## Station Details

Trip follower messages include station detail lines for:

- Door opening side.
- Elevators.
- Escalators.
- Washrooms.
- Station depth.
- Notes.

This data is best effort. Some values are configured manually in code, some may be inferred from active alert text, and unknown values are reported as unknown.

## Line 5 Departure Board

`/ttc-line5-board start` creates a live board in a Discord thread.

Flow:

1. The user selects a Line 5 station.
2. The user selects eastbound or westbound.
3. The bot creates a public thread in the current text channel.
4. The bot posts a text board and a generated SVG board image.
5. The board session is persisted.
6. Each polling interval edits the original board message with updated departures.

The board shows up to six matching live Line 5 vehicles in text and up to five rows in the SVG image. Vehicles are sorted by ETA when ETA is available.

Line 5 board matching depends on:

- Route short name `5` existing in static GTFS.
- Static GTFS containing Line 5 trips and stops.
- Realtime vehicle data containing Line 5 vehicles.
- Headsign text matching the selected direction when a headsign is present.

If no matching departures are found, the board explicitly says that no live Line 5 departures were found in the feed.

## Data Limitations

The bot does not invent transit data. It displays unavailable values as `n/a`, `unknown`, or equivalent text.

Known limitations:

- TTC may not publish every subway or LRT vehicle in the configured realtime vehicle feed.
- Vehicle labels are feed-dependent.
- ETA and delay require matching trip update data.
- Current and next stop quality depends on realtime stop sequence and static GTFS trip matching.
- Trip follower destination choices are limited by Discord select menus to 25 options.
- Line 5 station choices are limited to the first 25 unique stops found from a current Line 5 static GTFS trip.
- Static GTFS is loaded once per process start.
- Alert categories are heuristic and can misroute ambiguous alerts.
- Door side, station depth, elevator, escalator, and washroom status are not complete realtime feed fields.
