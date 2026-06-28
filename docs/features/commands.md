# Commands

The bot registers Discord slash commands for TTC lookup and setup workflows.

| Command | Behavior |
| --- | --- |
| `/ttc-alerts` | Shows current TTC service alerts, delays, and disruptions. |
| `/ttc-vehicles` | Shows all tracked subway/LRT vehicles. |
| `/ttc-vehicles line:<line>` | Shows vehicles for one route short name, such as `1`, `2`, `5`, `17`, or `68`. |
| `/ttc-status` | Shows polling interval, alert channel, subscriber count, auto-setup state, TTC.ca status, and tracked static-GTFS routes. |
| `/ttc-setup` | Creates or repairs the `TTC Live` category and TTC channels. Requires Manage Server for the user and Manage Channels for the bot. |
| `/ttc-settings alerts enabled:true` | Opts the user into alert pings. |
| `/ttc-settings alerts enabled:false` | Opts the user out of alert pings. |
| `/ttc-settings view` | Shows the user's alert ping setting and current alert channel. |
| `/ttc-follow start` | Starts the trip follower flow by asking for a live vehicle number. |
| `/ttc-follow status` | Shows the user's active follower state and progress graphic. |
| `/ttc-follow stop` | Removes the user's active follower session. |
| `/ttc-line5-board start` | Creates a live Line 5 departure board thread after station and direction selection. |
| `/ttc-recommend eglinton-eastbound` | Recommends the lower-wait eastbound trip from Eglinton using live Line 5 data and transfer checks. |

The bot also listens for general-channel text such as `leaving eastbound from Eglinton` and returns the same recommendation as `/ttc-recommend eglinton-eastbound`.

Discord message output is split to stay below Discord message length limits.
