import type { AlertSummary, VehicleSummary } from "./types.js";

const discordLimit = 1900;

export function chunkMessages(lines: string[], heading?: string): string[] {
  const chunks: string[] = [];
  let current = heading ? `${heading}\n` : "";

  for (const line of lines) {
    const candidate = `${current}${line}\n`;
    if (candidate.length > discordLimit && current.trim()) {
      chunks.push(current.trimEnd());
      current = "";
    }
    current += `${line}\n`;
  }

  if (current.trim()) {
    chunks.push(current.trimEnd());
  }

  return chunks;
}

export function formatDelay(delaySeconds: number | undefined): string {
  if (delaySeconds === undefined || delaySeconds === null) {
    return "delay n/a";
  }
  if (Math.abs(delaySeconds) < 60) {
    return `${delaySeconds}s`;
  }
  const minutes = Math.round(delaySeconds / 60);
  return minutes > 0 ? `${minutes} min late` : `${Math.abs(minutes)} min early`;
}

export function formatVehicles(vehicles: VehicleSummary[]): string[] {
  if (!vehicles.length) {
    return ["No subway/LRT vehicles found in the current TTC vehicle feed."];
  }

  return vehicles.map((vehicle) => {
    const number = vehicle.vehicleLabel || vehicle.vehicleId;
    const location = vehicle.latitude && vehicle.longitude
      ? `${vehicle.latitude.toFixed(5)}, ${vehicle.longitude.toFixed(5)} <https://maps.google.com/?q=${vehicle.latitude},${vehicle.longitude}>`
      : "location n/a";
    const eta = vehicle.eta
      ? vehicle.eta.toLocaleTimeString("en-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit" })
      : "ETA n/a";
    const speed = vehicle.speedKmh ? `, ${Math.round(vehicle.speedKmh)} km/h` : "";
    const updated = vehicle.updatedAt
      ? vehicle.updatedAt.toLocaleTimeString("en-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : "unknown";

    return [
      `**${vehicle.routeName}** vehicle **${number}**`,
      vehicle.headsign ? `toward ${vehicle.headsign}` : undefined,
      `next: ${vehicle.nextStop ?? "n/a"} at ${eta} (${formatDelay(vehicle.delaySeconds)})`,
      vehicle.scheduledTime ? `scheduled ${vehicle.scheduledTime}` : undefined,
      vehicle.currentStop ? `current stop: ${vehicle.currentStop}` : undefined,
      `where: ${location}${speed}`,
      `updated: ${updated}`
    ].filter(Boolean).join(" | ");
  });
}

export function formatAlerts(alerts: AlertSummary[]): string[] {
  if (!alerts.length) {
    return ["No active TTC service alerts found in the current GTFS-Realtime alert feed."];
  }

  return alerts.map((alert) => {
    const routes = alert.affectedRoutes.length ? alert.affectedRoutes.join(", ") : "system-wide/unspecified";
    const meta = [alert.effect, alert.cause, alert.severity].filter(Boolean).join(", ");
    const active = alert.activePeriods.length ? ` Active: ${alert.activePeriods.join("; ")}.` : "";
    const description = alert.description ? ` ${alert.description}` : "";
    return `**${alert.header}** (${routes})${meta ? ` [${meta}]` : ""}.${description}${active}`;
  });
}

export function alertFingerprint(alerts: AlertSummary[]): string {
  return JSON.stringify(alerts.map((alert) => ({
    id: alert.id,
    header: alert.header,
    description: alert.description,
    routes: alert.affectedRoutes,
    effect: alert.effect,
    severity: alert.severity
  })).sort((a, b) => a.id.localeCompare(b.id)));
}
