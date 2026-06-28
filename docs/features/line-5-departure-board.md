# Line 5 Departure Board

`/ttc-line5-board start` creates a live Line 5 departure board in a Discord thread.

## Flow

1. The user selects a Line 5 station.
2. The user selects eastbound or westbound.
3. The bot creates a public thread in the current text channel.
4. The bot posts a text board and generated board image.
5. The board session is persisted.
6. Each polling interval edits the original board message with updated departures.

## Output

The board shows up to six matching live Line 5 departures in text and up to five rows in the image. Rows include:

- Direction/headsign.
- Vehicle number.
- ETA in minutes.
- ETA time in 24-hour clock.
- Delay when available.

When TTC GTFS-Realtime route 5 is empty, the board uses the Line 5 fallback prediction source.
