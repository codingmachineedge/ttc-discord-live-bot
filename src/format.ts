import { AttachmentBuilder } from "discord.js";
import sharp from "sharp";
import type { AlertSummary, VehicleSummary } from "./types.js";

const discordLimit = 1900;

export function chunkMessages(lines: string[], heading?: string): string[] {
  const chunks: string[] = [];
  let current = heading ? `${heading}\n` : "";

  for (const line of lines) {
    if (line.length > discordLimit) {
      if (current.trim()) {
        chunks.push(current.trimEnd());
        current = "";
      }
      let remaining = line;
      while (remaining.length > discordLimit) {
        const splitAt = remaining.lastIndexOf(" ", discordLimit) > 0
          ? remaining.lastIndexOf(" ", discordLimit)
          : discordLimit;
        chunks.push(remaining.slice(0, splitAt).trimEnd());
        remaining = remaining.slice(splitAt).trimStart();
      }
      current = remaining ? `${remaining}\n` : "";
      continue;
    }

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

export function formatAlertCard(alert: AlertSummary): string {
  const routes = alert.affectedRoutes.length ? alert.affectedRoutes.join(", ") : "system-wide/unspecified";
  const meta = [alert.effect, alert.cause, alert.severity].filter(Boolean).join(", ");
  const active = alert.activePeriods.length ? `\n**Active:** ${alert.activePeriods.join("; ")}` : "";
  const description = alert.description ? `\n${alert.description}` : "";
  return [
    `# ${alert.header}`,
    `# Disruption: ${routes}`,
    meta ? `**Type:** ${meta}` : undefined,
    description.trim() ? `**Details:**${description}` : undefined,
    active.trim() ? active : undefined,
    "\n---"
  ].filter(Boolean).join("\n");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function wrapSvgText(value: string, maxChars: number, maxLines: number): string[] {
  const words = value.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length >= maxLines) {
      break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines;
}

export async function makeAlertAttachment(alert: AlertSummary): Promise<AttachmentBuilder> {
  const routes = alert.affectedRoutes.length ? alert.affectedRoutes.join(", ") : "System-wide / unspecified";
  const meta = [alert.effect, alert.cause, alert.severity]
    .filter((value) => value && !String(value).startsWith("UNKNOWN_"))
    .join(" / ");
  const titleLines = wrapSvgText(alert.header, 34, 3);
  const routeLines = wrapSvgText(routes, 48, 3);
  const descriptionLines = wrapSvgText(alert.description || "No additional details in the TTC alert feed.", 72, 5);
  const active = alert.activePeriods.length ? alert.activePeriods.join("; ") : "Active period not specified";

  const textLines = [
    ...titleLines.map((line, index) => `<text x="64" y="${132 + index * 56}" font-size="46" font-weight="900" fill="#ffffff">${escapeXml(line)}</text>`),
    `<text x="64" y="312" font-size="26" font-weight="800" fill="#fecaca">DISRUPTION</text>`,
    ...routeLines.map((line, index) => `<text x="64" y="${360 + index * 34}" font-size="30" font-weight="800" fill="#ffffff">${escapeXml(line)}</text>`),
    meta ? `<text x="64" y="465" font-size="24" font-weight="800" fill="#fde68a">${escapeXml(meta)}</text>` : undefined,
    ...descriptionLines.map((line, index) => `<text x="64" y="${520 + index * 29}" font-size="24" fill="#e5e7eb">${escapeXml(line)}</text>`),
    `<text x="64" y="706" font-size="20" fill="#cbd5e1">${escapeXml(active)}</text>`,
    `<line x1="48" y1="744" x2="1152" y2="744" stroke="#ffffff" stroke-opacity="0.65" stroke-width="4"/>`
  ].filter(Boolean).join("\n");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="780" viewBox="0 0 1200 780">
  <rect width="1200" height="780" rx="32" fill="#7f1d1d"/>
  <rect x="28" y="28" width="1144" height="724" rx="24" fill="#111827" stroke="#ef4444" stroke-width="10"/>
  <rect x="48" y="48" width="1104" height="34" rx="12" fill="#dc2626"/>
  <g font-family="DejaVu Sans, Arial, sans-serif">
  <text x="1132" y="73" font-size="20" fill="#fee2e2" text-anchor="end">LIVE</text>
  ${textLines}
  </g>
</svg>`;

  const png = await sharp(Buffer.from(svg, "utf8"))
    .png({ quality: 95, compressionLevel: 6 })
    .toBuffer();
  return new AttachmentBuilder(png, { name: `ttc-alert-${alert.id.replace(/[^a-z0-9_-]/gi, "_")}.png` });
}

export function singleAlertFingerprint(alert: AlertSummary): string {
  return JSON.stringify({
    id: alert.id,
    header: alert.header,
    description: alert.description,
    routes: alert.affectedRoutes,
    effect: alert.effect,
    severity: alert.severity
  });
}

export function alertCategory(alert: AlertSummary): "subwayLrt" | "busStreetcar" | "accessibility" | "general" {
  const text = `${alert.header} ${alert.description} ${alert.affectedRoutes.join(" ")}`.toLowerCase();
  if (/\b(elevator|escalator|accessible|accessibility|washroom|wheel-trans)\b/.test(text)) {
    return "accessibility";
  }
  if (/\b(line 1|line 2|line 3|line 4|line 5|line 6|subway|lrt|eglinton|finch west|yonge|bloor|danforth|sheppard|scarborough)\b/.test(text)) {
    return "subwayLrt";
  }
  if (/\b(bus|streetcar|express|replacement bus)\b/.test(text) || /\b\d{1,3}[A-Z]?\b/.test(alert.affectedRoutes.join(" "))) {
    return "busStreetcar";
  }
  return "general";
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
