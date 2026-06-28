# Trip Recommendations

Trip recommendations are exposed through `/ttc-recommend eglinton-eastbound` and general-channel messages like `leaving eastbound from Eglinton`.

## Current Eglinton Eastbound Options

The bot compares:

- Line 5 to Birchmount, then `17A Birchmount northbound`.
- Line 5 to Golden Mile, then `68B Warden northbound`.
- Line 5 to Kennedy, Stouffville GO to Unionville, then Viva Purple A westbound.

The `17A` and `68B` options are branch-specific. The bot does not treat generic route `17`, `17B`, `17C`, `68`, or `68A` as valid substitutes.

## Live Data

The recommendation uses:

- Live Line 5 vehicle and arrival data.
- TTC GTFS-Realtime transfer checks for `17A` and `68B`.
- Current TTC alerts and accessibility disruptions.

GO/YRT realtime is not configured. The GO/Viva option is shown as unavailable for live transfer timing until a usable GO and YRT realtime feed is added.

## Output

The bot tells the user:

- The recommended trip.
- The exact Line 5 vehicle to board when live data is available.
- The bus vehicle number to look for when branch-matched live transfer data is available.
- Transfer wait source and whether it is live or unavailable.
- Other options checked.
- Relevant service disruptions.

The bot also attaches `ttc-trip-recommendation.gif`, a high-quality animated summary of the recommendation.
