import { AttachmentBuilder } from "discord.js";
import sharp from "sharp";
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

function formatEtaTime(eta: Date | undefined): string {
  return eta
    ? eta.toLocaleTimeString("en-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", hour12: false })
    : "--:--";
}

function formatEtaMinutes(eta: Date | undefined): string {
  if (!eta) {
    return "ETA n/a";
  }
  const minutes = Math.max(0, Math.round((eta.getTime() - Date.now()) / 60000));
  return minutes <= 1 ? `${minutes} min` : `${minutes} mins`;
}

function sourceLabel(vehicles: VehicleSummary[]): string {
  const source = vehicles[0]?.source;
  if (source === "gtfs-realtime") return "LIVE DEPARTURES";
  if (source === "transsee") return "LIVE DEPARTURES (estimated)";
  if (source === "schedule") return "SCHEDULED DEPARTURES";
  return "REAL TIME DEPARTURES";
}

export function formatDepartureBoardText(session: DepartureBoardSession, vehicles: VehicleSummary[]): string {
  const lines = [
    `# Line 5 Eglinton Departures`,
    `# ${session.stationName} - ${session.direction.toUpperCase()}`,
    `Updated: ${new Date().toLocaleTimeString("en-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}`,
    ""
  ];

  if (!vehicles.length) {
    lines.push("No Line 5 departures available for this station/direction right now.");
  } else {
    lines[2] = `Source: ${sourceLabel(vehicles)}   Updated: ${new Date().toLocaleTimeString("en-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}`;
    for (const vehicle of vehicles) {
      const car = vehicle.source === "schedule" ? "scheduled" : `vehicle ${vehicle.vehicleLabel ?? vehicle.vehicleId}`;
      lines.push(`**${vehicle.headsign ?? session.direction}** - ${car} - ${formatEtaMinutes(vehicle.eta)} - ${formatEtaTime(vehicle.eta)} - ${formatDelay(vehicle.delaySeconds)}`);
    }
  }

  lines.push("\n---");
  return lines.join("\n");
}

export async function makeDepartureBoardAttachment(session: DepartureBoardSession, vehicles: VehicleSummary[]): Promise<AttachmentBuilder> {
  const width = 1100;
  const height = 620;
  const rows = vehicles.slice(0, 5);
  // Fixed, non-overlapping column bands (inner row spans x=86..1010):
  //   headsign  start  86          (truncated so it can't run into the source band)
  //   source    start  500         (e.g. "SCHEDULED" / "CAR v2")
  //   MINS      end    830
  //   time      end    1006
  const rowSvg = rows.length ? rows.map((vehicle, index) => {
    const y = 220 + index * 72;
    const etaMinutes = formatEtaMinutes(vehicle.eta).toUpperCase();
    const etaTime = formatEtaTime(vehicle.eta);
    // Only show a car number when we actually have a real one. Line 5 predictions
    // carry no vehicle id (the source gives ETAs only), so the bot manufactures
    // synthetic "eta-N" ids — never render those as a "CAR" number.
    const realCar = vehicle.vehicleLabel ?? vehicle.vehicleId;
    const hasRealCar = !!realCar && !/^eta-/i.test(realCar);
    const carLabel = vehicle.source === "schedule"
      ? "SCHEDULED"
      : vehicle.source === "transsee"
        ? (hasRealCar ? `CAR ${realCar}` : "ESTIMATED")
        : (hasRealCar ? `CAR ${realCar}` : "LIVE");
    const headsignRaw = vehicle.headsign ?? session.direction.toUpperCase();
    const headsign = headsignRaw.length > 22 ? `${headsignRaw.slice(0, 21).trimEnd()}…` : headsignRaw;
    return `
      <rect x="54" y="${y - 42}" width="992" height="58" rx="12" fill="${index % 2 === 0 ? "#111827" : "#1f2937"}"/>
      <text x="86" y="${y}" font-size="34" font-weight="800" fill="#facc15">${escapeXml(headsign)}</text>
      <text x="500" y="${y}" font-size="22" font-weight="800" fill="#cbd5e1">${escapeXml(carLabel)}</text>
      <text x="830" y="${y}" font-size="34" font-weight="900" fill="#ffffff" text-anchor="end">${escapeXml(etaMinutes)}</text>
      <text x="1010" y="${y}" font-size="34" font-weight="900" fill="#ffffff" text-anchor="end">${escapeXml(etaTime)}</text>`;
  }).join("\n") : `
      <text x="550" y="335" font-size="34" font-weight="800" fill="#ffffff" text-anchor="middle">NO DEPARTURES AVAILABLE</text>
      <text x="550" y="385" font-size="24" fill="#cbd5e1" text-anchor="middle">Line 5 service data is unavailable right now</text>`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#020617"/>
  <g font-family="DejaVu Sans, Arial, sans-serif">
  <rect x="36" y="34" width="1028" height="552" rx="28" fill="#0f172a" stroke="#facc15" stroke-width="8"/>
  <text x="550" y="105" font-size="62" font-weight="900" fill="#facc15" text-anchor="middle">LINE 5 EGLINTON</text>
  <text x="550" y="158" font-size="38" font-weight="800" fill="#ffffff" text-anchor="middle">${escapeXml(session.stationName)} - ${session.direction.toUpperCase()}</text>
  <text x="550" y="198" font-size="22" fill="#94a3b8" text-anchor="middle">${escapeXml(sourceLabel(vehicles))}</text>
  ${rowSvg}
  <text x="550" y="555" font-size="22" fill="#94a3b8" text-anchor="middle">Updated ${escapeXml(new Date().toLocaleTimeString("en-CA", { timeZone: "America/Toronto", hour12: false }))}</text>
  </g>
</svg>`;

  const png = await sharp(Buffer.from(svg, "utf8"))
    .png({ quality: 95, compressionLevel: 6 })
    .toBuffer();
  return new AttachmentBuilder(png, { name: "line-5-departures.png" });
}
