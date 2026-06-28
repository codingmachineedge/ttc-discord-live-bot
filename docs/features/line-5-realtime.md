# Line 5 Realtime

Line 5 vehicle data is handled specially because TTC's standard GTFS-Realtime route 5 vehicle feed can be empty even when Line 5 vehicles are visible online.

## Source Order

1. TTC GTFS-Realtime vehicle positions and trip updates.
2. TransSee Line 5 route vehicles page from `TRANSSEE_LINE5_ROUTE_VEHICLES_URL`.
3. TransSee Line 5 station prediction pages from `TRANSSEE_LINE5_PREDICT_URL_TEMPLATE`.

The fallback is only used when the TTC GTFS-Realtime route 5 result is empty.

## Data Available From Fallback

The Line 5 fallback can provide:

- Vehicle number.
- Direction/headsign, such as Kennedy Station or Mount Dennis Station.
- Approaching station.
- Vehicle latitude and longitude.
- Station-specific arrival predictions with ETA.

The fallback does not provide a TTC GTFS `trip_id`, so the bot can show Line 5 vehicles and station predictions but cannot always attach the stop-by-stop GTFS trip-map GIF for those fallback vehicles.

## Affected Features

The fallback powers:

- `/ttc-vehicles line:5`
- `/ttc-line5-board start`
- `/ttc-recommend eglinton-eastbound`
- General-channel recommendation requests such as `leaving eastbound from Eglinton`
