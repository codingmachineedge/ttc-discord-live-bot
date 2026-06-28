# Vehicle Lookup

Vehicle lookup is exposed through `/ttc-vehicles` and `/ttc-vehicles line:<line>`.

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

The default vehicle list is filtered to configured route short names from `SUBWAY_LRT_ROUTE_SHORT_NAMES`. When a user explicitly requests a route with `line:<line>`, the bot queries that route even if it is outside the default subway/LRT list.

Line 5 has a dedicated fallback source described in [line-5-realtime.md](line-5-realtime.md).
