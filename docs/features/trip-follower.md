# Trip Follower

The trip follower helps a rider follow the vehicle they are currently on.

## Flow

1. The user runs `/ttc-follow start`.
2. The bot opens a modal asking for the vehicle number printed on the TTC vehicle.
3. The bot searches live vehicle data by vehicle ID or vehicle label.
4. If the vehicle has an active trip ID, the bot loads the trip's stop list from static GTFS.
5. The user chooses a destination stop from a Discord select menu.
6. The bot stores the follower session and posts progress updates in the original channel.

## Announcements

Follower messages can include:

- User mention.
- Current vehicle status.
- Next stop.
- Destination stop.
- Stops remaining estimate based on stop sequence.
- Station details where available.
- Generated GIF route-progress map.
- Separate next-stop info PNG.

For Line 5 trips, the message includes English/French announcer-style text. This is generated helper text, not an official TTC announcement script.

The bot removes the follower session after the vehicle reaches or approaches the selected destination. Users can also remove it manually with `/ttc-follow stop`.

Trip follower sessions are persisted in `.data/settings.json`, so a restart does not immediately forget them.
