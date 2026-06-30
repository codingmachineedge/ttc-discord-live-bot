import { AttachmentBuilder } from "discord.js";
import sharp from "sharp";
import type { AlertSummary, VehicleSummary } from "./types.js";

const discordLimit = 1900;
const subwayLrtRouteShortNames = new Set(["1", "2", "3", "4", "5", "6"]);
const disruptionPattern = /\b(delay|delays|delayed|detour|divert|diversion|no service|not stopping|bypassing|closed|closure|replacement bus|shuttle|suspended|reduced service|out of service|elevator|escalator|accessible|accessibility|washroom)\b/i;
const nonServiceNoticePattern = /\b(proof of payment|look both ways|fare inspection|customer information|reminder)\b/i;

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
  const serviceAlerts = alerts.filter(isServiceDisruptionAlert);
  if (!serviceAlerts.length) {
    return ["No active TTC service alerts found after checking TTC.ca status and the current realtime alert feed."];
  }

  return serviceAlerts.map((alert) => {
    const routes = alertCategory(alert) === "accessibility"
      ? accessibilityScope(alert)
      : alert.affectedRoutes.length ? alert.affectedRoutes.join(", ") : "system-wide/unspecified";
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

export function wrapSvgText(value: string, maxChars: number, maxLines: number): string[] {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let index = 0;
  for (; index < words.length; index++) {
    const word = words[index];
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) {
        current = "";
        break;
      }
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
    index = words.length;
  }
  // Don't silently drop overflow text: if words remain unplaced, mark the last
  // line with an ellipsis so the truncation is visible rather than invisible.
  if (index < words.length && lines.length) {
    const last = lines[lines.length - 1];
    const trimmed = last.length > maxChars - 1 ? `${last.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…` : `${last}…`;
    lines[lines.length - 1] = trimmed;
  }
  return lines;
}

type AlertCardTheme = {
  name: string;
  background: string;
  panel: string;
  accent: string;
  accentText: string;
  border: string;
  eyebrow: string;
  badge?: string;
  badgeFill?: string;
  badgeText?: string;
};

const lineThemes: Record<string, AlertCardTheme> = {
  "1": { name: "Line 1 Yonge-University", background: "#7c5b00", panel: "#101827", accent: "#facc15", accentText: "#111827", border: "#facc15", eyebrow: "SUBWAY SERVICE ALERT", badge: "1", badgeFill: "#facc15", badgeText: "#111827" },
  "2": { name: "Line 2 Bloor-Danforth", background: "#14532d", panel: "#101827", accent: "#16a34a", accentText: "#ffffff", border: "#22c55e", eyebrow: "SUBWAY SERVICE ALERT", badge: "2", badgeFill: "#16a34a", badgeText: "#ffffff" },
  "3": { name: "Line 3 Scarborough", background: "#1e3a8a", panel: "#101827", accent: "#2563eb", accentText: "#ffffff", border: "#60a5fa", eyebrow: "SUBWAY SERVICE ALERT", badge: "3", badgeFill: "#2563eb", badgeText: "#ffffff" },
  "4": { name: "Line 4 Sheppard", background: "#581c87", panel: "#101827", accent: "#7e22ce", accentText: "#ffffff", border: "#c084fc", eyebrow: "SUBWAY SERVICE ALERT", badge: "4", badgeFill: "#7e22ce", badgeText: "#ffffff" },
  "5": { name: "Line 5 Eglinton", background: "#9a3412", panel: "#101827", accent: "#f97316", accentText: "#111827", border: "#fb923c", eyebrow: "LRT SERVICE ALERT", badge: "5", badgeFill: "#f97316", badgeText: "#111827" },
  "6": { name: "Line 6 Finch West", background: "#831843", panel: "#101827", accent: "#db2777", accentText: "#ffffff", border: "#f472b6", eyebrow: "LRT SERVICE ALERT", badge: "6", badgeFill: "#db2777", badgeText: "#ffffff" }
};

const accessibilityTheme: AlertCardTheme = {
  name: "Accessibility",
  background: "#164e63",
  panel: "#0f172a",
  accent: "#06b6d4",
  accentText: "#082f49",
  border: "#67e8f9",
  eyebrow: "ACCESSIBILITY ALERT",
  badge: "A",
  badgeFill: "#06b6d4",
  badgeText: "#082f49"
};

const generalTheme: AlertCardTheme = {
  name: "Service",
  background: "#7f1d1d",
  panel: "#111827",
  accent: "#dc2626",
  accentText: "#ffffff",
  border: "#ef4444",
  eyebrow: "SERVICE ALERT"
};

function extractLineNumber(alert: AlertSummary): string | undefined {
  const text = `${alert.header} ${alert.description} ${alert.affectedRoutes.join(" ")}`;
  const explicit = text.match(/\bLine\s*([1-6])\b/i)?.[1];
  if (explicit) {
    return explicit;
  }
  return alert.affectedRoutes
    .map((route) => route.match(/^([1-6])(?:\s|$)/)?.[1])
    .find(Boolean);
}

function stationFromHeader(alert: AlertSummary): string | undefined {
  const station = alert.header.match(/^([^:]{2,48}):/)?.[1]?.trim();
  return station || undefined;
}

function accessibilityScope(alert: AlertSummary): string {
  const line = alert.description.match(/\bLine\s+[1-6][^.,;]*/i)?.[0]
    ?.replace(/\s+while\b.*$/i, "")
    .trim();
  const station = stationFromHeader(alert);
  if (station && line) {
    return `${station} station - ${line}`;
  }
  if (station) {
    return `${station} station`;
  }
  return "Elevator / escalator status";
}

function subwayScope(alert: AlertSummary): string {
  const lineNumber = extractLineNumber(alert);
  if (lineNumber && lineThemes[lineNumber]) {
    return lineThemes[lineNumber].name;
  }
  return "Subway / LRT service";
}

function busStreetcarScope(alert: AlertSummary): string {
  return alert.affectedRoutes.length ? alert.affectedRoutes.join(", ") : "Surface route service";
}

function alertCardTheme(alert: AlertSummary): AlertCardTheme {
  const category = alertCategory(alert);
  if (category === "accessibility") {
    return accessibilityTheme;
  }
  const lineNumber = extractLineNumber(alert);
  if (lineNumber && lineThemes[lineNumber]) {
    return lineThemes[lineNumber];
  }
  return generalTheme;
}

function alertScope(alert: AlertSummary): string {
  const category = alertCategory(alert);
  if (category === "accessibility") {
    return accessibilityScope(alert);
  }
  if (category === "subwayLrt") {
    return subwayScope(alert);
  }
  if (category === "busStreetcar") {
    return busStreetcarScope(alert);
  }
  return "System-wide / unspecified";
}

function alertDisplayTitle(alert: AlertSummary): string {
  const station = stationFromHeader(alert);
  if (alertCategory(alert) === "accessibility" && station) {
    const equipment = alert.description.match(/\b(Elevator|Escalator)[^.,;]*/i)?.[0]
      ?.replace(/^.*?:\s*/, "")
      .replace(/\s+between\b.*$/i, "")
      .trim();
    if (equipment) {
      return `${station}: ${equipment}`;
    }
  }

  const serviceTitle = alert.description.match(/\b(Line\s+[1-6][^:]*:\s*(?:No service|Delays?|Service suspended|Reduced service))/i)?.[0];
  if (serviceTitle) {
    return serviceTitle;
  }

  return alert.header;
}

export async function makeAlertAttachment(alert: AlertSummary): Promise<AttachmentBuilder> {
  const theme = alertCardTheme(alert);
  const scope = alertScope(alert);
  const meta = [alert.effect, alert.cause, alert.severity]
    .filter((value) => value && !String(value).startsWith("UNKNOWN_"))
    .join(" / ");
  const titleLines = wrapSvgText(alertDisplayTitle(alert), theme.badge ? 28 : 34, 3);
  const scopeLines = wrapSvgText(scope, 44, 2);
  const descriptionLines = wrapSvgText(alert.description || "No additional details in the TTC alert feed.", 76, 5);
  const active = alert.activePeriods.length ? alert.activePeriods.join("; ") : "Active period not specified";
  const badge = theme.badge ? `
    <circle cx="104" cy="136" r="44" fill="${theme.badgeFill}"/>
    <text x="104" y="153" font-size="48" font-weight="900" fill="${theme.badgeText}" text-anchor="middle">${theme.badge}</text>` : "";
  const titleX = theme.badge ? 174 : 64;

  const textLines = [
    badge,
    ...titleLines.map((line, index) => `<text x="${titleX}" y="${128 + index * 54}" font-size="44" font-weight="900" fill="#ffffff">${escapeXml(line)}</text>`),
    `<text x="64" y="318" font-size="24" font-weight="900" fill="${theme.accent}">${escapeXml(theme.eyebrow)}</text>`,
    ...scopeLines.map((line, index) => `<text x="64" y="${368 + index * 38}" font-size="34" font-weight="900" fill="#ffffff">${escapeXml(line)}</text>`),
    meta ? `<text x="64" y="465" font-size="24" font-weight="800" fill="#fde68a">${escapeXml(meta)}</text>` : undefined,
    ...descriptionLines.map((line, index) => `<text x="64" y="${520 + index * 31}" font-size="26" fill="#f1f5f9">${escapeXml(line)}</text>`),
    `<text x="64" y="708" font-size="22" fill="#e2e8f0">${escapeXml(active)}</text>`,
    `<line x1="48" y1="744" x2="1152" y2="744" stroke="#ffffff" stroke-opacity="0.65" stroke-width="4"/>`
  ].filter(Boolean).join("\n");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="780" viewBox="0 0 1200 780">
  <rect width="1200" height="780" rx="32" fill="${theme.background}"/>
  <rect x="28" y="28" width="1144" height="724" rx="24" fill="${theme.panel}" stroke="${theme.border}" stroke-width="10"/>
  <rect x="48" y="48" width="1104" height="34" rx="12" fill="${theme.accent}"/>
  <g font-family="DejaVu Sans, Arial, sans-serif">
  <text x="1132" y="73" font-size="20" font-weight="900" fill="${theme.accentText}" text-anchor="end">LIVE</text>
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
  const affectedShortNames = alert.affectedRoutes
    .map((route) => route.match(/^(\d{1,3}[A-Z]?)(?:\s|$)/i)?.[1]?.toUpperCase())
    .filter(Boolean);

  if (/\b(elevator|escalator|accessible|accessibility|washroom|wheel-trans)\b/.test(text)) {
    return "accessibility";
  }
  if (
    affectedShortNames.some((shortName) => shortName && subwayLrtRouteShortNames.has(shortName))
    || /\b(line [1-6]|subway|lrt)\b/.test(text)
  ) {
    return "subwayLrt";
  }
  if (/\b(bus|streetcar|express|replacement bus)\b/.test(text) || /\b\d{1,3}[A-Z]?\b/.test(alert.affectedRoutes.join(" "))) {
    return "busStreetcar";
  }
  return "general";
}

export function isServiceDisruptionAlert(alert: AlertSummary): boolean {
  const text = `${alert.header} ${alert.description}`.toLowerCase();
  if (nonServiceNoticePattern.test(text) && !disruptionPattern.test(text)) {
    return false;
  }
  return disruptionPattern.test(text);
}

export function alertFingerprint(alerts: AlertSummary[]): string {
  return JSON.stringify(alerts.filter(isServiceDisruptionAlert).map((alert) => ({
    id: alert.id,
    header: alert.header,
    description: alert.description,
    routes: alert.affectedRoutes,
    effect: alert.effect,
    severity: alert.severity
  })).sort((a, b) => a.id.localeCompare(b.id)));
}
