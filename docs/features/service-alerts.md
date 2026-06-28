# Service Alerts

`/ttc-alerts` returns active TTC service alerts after checking both structured realtime alerts and TTC.ca passenger-facing service status.

## Sources

- TTC GTFS-Realtime alerts from `TTC_ALERTS_URL`.
- TTC.ca route status dashboard from `TTC_WEBSITE_STATUS_URL`.

TTC.ca status is used as a guard for subway/LRT service disruptions. If TTC.ca reports normal service for a subway/LRT line, the bot suppresses stale or misclassified service disruption alerts for that line. Accessibility alerts are preserved.

## Alert Cards

Automatic alerts are posted as individual high-quality PNG cards. Each card includes:

- Alert title.
- Disruption scope.
- Effect, cause, and severity when available.
- Details.
- Active period when published.
- A divider at the bottom so the next alert is visually separated.

The card style changes by category. Subway/LRT alerts use line color and line badge where the line can be detected. Accessibility alerts use a separate style and do not foreground unrelated bus lists.

## Routing

When the bot auto-creates channels, alerts route to:

- `ttc-alerts-subway-lrt`
- `ttc-alerts-bus-streetcar`
- `ttc-alerts-accessibility`
- `ttc-alerts-general`

If a specific channel is unavailable, the bot falls back to `ttc-alerts`, then `ALERT_CHANNEL_ID`.

## Pings

Users can opt into alert pings with `/ttc-settings alerts enabled:true`. Their mentions are included in routed alert posts until they opt out.

## Cleanup

The bot stores posted alert message IDs. When an alert ID disappears from the current active alert set, the bot deletes the corresponding Discord message.
