import { AttachmentBuilder } from "discord.js";
import type { DepartureBoardSession } from "./settingsStore.js";
import type { VehicleSummary } from "./types.js";
import { formatDelay } from "./format.js";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function formatDepartureBoardText(session: DepartureBoardSession, vehicles: VehicleSummary[]): string {
  const lines = [
    `# Line 5 Eglinton Departures`,
    `# ${session.stationName} - ${session.direction.toUpperCase()}`,
    `Updated: ${new Date().toLocaleTimeString("en-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", second: "2-digit" })}`,
    ""
  ];

  if (!vehicles.length) {
    lines.push("No live Line 5 departures found in the TTC realtime vehicle feed for this station/direction.");
  } else {
    for (const vehicle of vehicles) {
      const eta = vehicle.eta
        ? vehicle.eta.toLocaleTimeString("en-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit" })
        : "ETA n/a";
      lines.push(`**${vehicle.headsign ?? session.direction}** - vehicle ${vehicle.vehicleLabel ?? vehicle.vehicleId} - ${eta} - ${formatDelay(vehicle.delaySeconds)}`);
    }
  }

  lines.push("\n---");
  return lines.join("\n");
}

export function makeDepartureBoardAttachment(session: DepartureBoardSession, vehicles: VehicleSummary[]): AttachmentBuilder {
  const width = 1100;
  const height = 620;
  const rows = vehicles.slice(0, 5);
  const rowSvg = rows.length ? rows.map((vehicle, index) => {
    const y = 220 + index * 72;
    const eta = vehicle.eta
      ? vehicle.eta.toLocaleTimeString("en-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit" })
      : "ETA N/A";
    return `
      <rect x="54" y="${y - 42}" width="992" height="58" rx="12" fill="${index % 2 === 0 ? "#111827" : "#1f2937"}"/>
      <text x="86" y="${y}" font-size="34" font-weight="800" fill="#facc15">${escapeXml(vehicle.headsign ?? session.direction.toUpperCase())}</text>
      <text x="650" y="${y}" font-size="32" font-weight="800" fill="#ffffff" text-anchor="middle">${escapeXml(eta)}</text>
      <text x="1010" y="${y}" font-size="24" fill="#cbd5e1" text-anchor="end">CAR ${escapeXml(vehicle.vehicleLabel ?? vehicle.vehicleId)}</text>`;
  }).join("\n") : `
      <text x="550" y="335" font-size="34" font-weight="800" fill="#ffffff" text-anchor="middle">NO LIVE DEPARTURES IN FEED</text>
      <text x="550" y="385" font-size="24" fill="#cbd5e1" text-anchor="middle">Waiting for TTC realtime Line 5 data</text>`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#020617"/>
  <rect x="36" y="34" width="1028" height="552" rx="28" fill="#0f172a" stroke="#facc15" stroke-width="8"/>
  <text x="550" y="105" font-family="Arial, sans-serif" font-size="62" font-weight="900" fill="#facc15" text-anchor="middle">LINE 5 EGLINTON</text>
  <text x="550" y="158" font-family="Arial, sans-serif" font-size="38" font-weight="800" fill="#ffffff" text-anchor="middle">${escapeXml(session.stationName)} - ${session.direction.toUpperCase()}</text>
  <text x="550" y="198" font-family="Arial, sans-serif" font-size="22" fill="#94a3b8" text-anchor="middle">REAL TIME DEPARTURES</text>
  ${rowSvg}
  <text x="550" y="555" font-family="Arial, sans-serif" font-size="22" fill="#94a3b8" text-anchor="middle">Updated ${escapeXml(new Date().toLocaleTimeString("en-CA", { timeZone: "America/Toronto" }))}</text>
</svg>`;

  return new AttachmentBuilder(Buffer.from(svg, "utf8"), { name: "line-5-departures.svg" });
}
