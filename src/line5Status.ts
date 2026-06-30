import { AttachmentBuilder } from "discord.js";
import sharp from "sharp";
import { config } from "./config.js";
import { isServiceDisruptionAlert, wrapSvgText } from "./format.js";
import { getGoDeparturesNear, isMetrolinxConfigured } from "./metrolinx.js";
import {
  getAlerts,
  getLine5Departures,
  getLine5EglintonStopId,
  getLine5ServiceHours
} from "./ttcClient.js";
import type { AlertSummary, VehicleSummary } from "./types.js";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function torontoClock(date = new Date()): string {
  return date.toLocaleTimeString("en-CA", {
    timeZone: "America/Toronto",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function etaMinutes(eta: Date | undefined): string {
  if (!eta) {
    return "n/a";
  }
  const minutes = Math.max(0, Math.round((eta.getTime() - Date.now()) / 60000));
  return minutes <= 0 ? "now" : `${minutes} min`;
}

// Route-5 / Line 5 service alerts only. Reuses the shared disruption filter so we
// surface the same alerts the alert cards do, scoped to Line 5 mentions.
function line5Alerts(alerts: AlertSummary[]): AlertSummary[] {
  return alerts.filter((alert) => {
    if (!isServiceDisruptionAlert(alert)) {
      return false;
    }
    const text = `${alert.header} ${alert.description} ${alert.affectedRoutes.join(" ")}`.toLowerCase();
    const routeMatch = alert.affectedRoutes.some((route) => /^5(\s|$)/.test(route.trim()) || /line 5|eglinton/i.test(route));
    return routeMatch || /\bline 5\b|eglinton crosstown|eglinton lrt/.test(text);
  });
}

// TTC's GTFS alert headerText is hard-truncated to 32 chars (verified against the
// live feed), so it often cuts mid-word ("Elevator 3 out of se"). When the header
// looks truncated, fall back to the first complete clause of the (longer) description.
function cleanAlertTitle(alert: AlertSummary): string {
  const header = alert.header.trim();
  const looksTruncated = header.length >= 30 && !/[.!?)\]]$/.test(header);
  if (!looksTruncated || !alert.description) {
    return header;
  }
  const clause = alert.description.split(/(?<=[.!?])\s|\s+between\s/i)[0]?.trim() ?? alert.description.trim();
  const title = clause.length > 90 ? `${clause.slice(0, 89).trimEnd()}…` : clause;
  return title || header;
}

export type Line5StatusData = {
  serviceHours: Awaited<ReturnType<typeof getLine5ServiceHours>>;
  eglinton?: { stopId: string; stopName: string };
  eastbound: VehicleSummary[];
  westbound: VehicleSummary[];
  alerts: AlertSummary[];
  goConnections: { station: string; departures: Awaited<ReturnType<typeof getGoDeparturesNear>> }[];
};

export async function getLine5StatusData(): Promise<Line5StatusData> {
  const [serviceHours, eglinton, rawAlerts] = await Promise.all([
    getLine5ServiceHours(),
    getLine5EglintonStopId(),
    getAlerts().catch(() => [] as AlertSummary[])
  ]);

  const [eastbound, westbound] = eglinton
    ? await Promise.all([
        getLine5Departures(eglinton.stopId, "eastbound").catch(() => [] as VehicleSummary[]),
        getLine5Departures(eglinton.stopId, "westbound").catch(() => [] as VehicleSummary[])
      ])
    : [[], []];

  const goConnections: Line5StatusData["goConnections"] = [];
  if (isMetrolinxConfigured()) {
    const interchanges = config.METROLINX_LINE5_INTERCHANGES.split(",").map((value) => value.trim()).filter(Boolean);
    const results = await Promise.all(
      interchanges.map(async (station) => ({
        station,
        departures: await getGoDeparturesNear(station).catch(() => [])
      }))
    );
    for (const result of results) {
      if (result.departures.length) {
        goConnections.push(result);
      }
    }
  }

  return {
    serviceHours,
    eglinton,
    eastbound,
    westbound,
    alerts: line5Alerts(rawAlerts),
    goConnections
  };
}

function departureLine(vehicle: VehicleSummary): string {
  const label = vehicle.source === "schedule"
    ? "scheduled"
    : vehicle.source === "transsee"
      ? "estimated"
      : `vehicle ${vehicle.vehicleLabel ?? vehicle.vehicleId}`;
  const time = vehicle.eta ? torontoClock(vehicle.eta) : (vehicle.scheduledTime ?? "n/a");
  return `${etaMinutes(vehicle.eta)} (${time}) - ${label}`;
}

export function formatLine5StatusText(data: Line5StatusData): string {
  const lines: string[] = ["# Line 5 Eglinton - Service Status"];
  const sh = data.serviceHours;
  lines.push(sh.inService ? "**Status:** In service now" : "**Status:** Not running right now (overnight/closed)");
  if (sh.firstTrain && sh.lastTrain) {
    lines.push(`**Service hours:** first train ${sh.firstTrain}, last train ${sh.lastTrain}`);
  }
  lines.push(`**Stops on the line:** ${sh.stopCount}`);

  const ref = data.eglinton ? data.eglinton.stopName : "Eglinton";
  lines.push("");
  lines.push(`**Next eastbound (to Kennedy)** from ${ref}:`);
  lines.push(data.eastbound.length ? data.eastbound.slice(0, 3).map((v) => `- ${departureLine(v)}`).join("\n") : "- No upcoming eastbound trains.");
  lines.push(`**Next westbound (to Mount Dennis)** from ${ref}:`);
  lines.push(data.westbound.length ? data.westbound.slice(0, 3).map((v) => `- ${departureLine(v)}`).join("\n") : "- No upcoming westbound trains.");

  lines.push("");
  if (data.alerts.length) {
    lines.push("**Active Line 5 alerts:**");
    for (const alert of data.alerts.slice(0, 4)) {
      lines.push(`- ${cleanAlertTitle(alert)}`);
    }
  } else {
    lines.push("**Alerts:** No active Line 5 service alerts.");
  }

  if (data.goConnections.length) {
    lines.push("");
    lines.push("**GO Transit connections:**");
    for (const connection of data.goConnections) {
      const next = connection.departures.slice(0, 2)
        .map((dep) => `${dep.line} to ${dep.destination}${dep.computedDepartureTime || dep.scheduledTime ? ` ${dep.computedDepartureTime ?? dep.scheduledTime}` : ""}`)
        .join("; ");
      lines.push(`- ${connection.station}: ${next}`);
    }
  } else if (!isMetrolinxConfigured()) {
    lines.push("");
    lines.push("_GO Transit connections unavailable (Metrolinx key not configured)._");
  }

  lines.push("\n---");
  return lines.join("\n");
}

export async function makeLine5StatusAttachment(data: Line5StatusData): Promise<AttachmentBuilder> {
  const width = 1200;
  const height = 820;
  const sh = data.serviceHours;
  const statusText = sh.inService ? "IN SERVICE" : "NOT RUNNING";
  const statusFill = sh.inService ? "#16a34a" : "#b91c1c";

  const renderDepartures = (vehicles: VehicleSummary[], x: number) =>
    (vehicles.length ? vehicles.slice(0, 3) : []).map((vehicle, index) => {
      const y = 412 + index * 64;
      const mins = etaMinutes(vehicle.eta).toUpperCase();
      const time = vehicle.eta ? torontoClock(vehicle.eta) : (vehicle.scheduledTime ?? "--:--");
      return `
      <rect x="${x}" y="${y - 40}" width="520" height="54" rx="10" fill="${index % 2 === 0 ? "#1e293b" : "#0f172a"}"/>
      <text x="${x + 24}" y="${y}" font-size="32" font-weight="900" fill="#ffffff">${escapeXml(mins)}</text>
      <text x="${x + 200}" y="${y}" font-size="30" font-weight="700" fill="#fde047">${escapeXml(time)}</text>
      <text x="${x + 500}" y="${y}" font-size="22" font-weight="700" fill="#cbd5e1" text-anchor="end">${escapeXml(vehicle.source === "schedule" ? "SCHED" : vehicle.source === "transsee" ? "EST" : "LIVE")}</text>`;
    }).join("\n")
    || `<text x="${x + 24}" y="432" font-size="28" font-weight="700" fill="#94a3b8">No upcoming trains</text>`;

  const alertText = data.alerts.length
    ? wrapSvgText(`Alerts: ${data.alerts.map((a) => cleanAlertTitle(a)).join(" • ")}`, 92, 2)
    : ["No active Line 5 service alerts."];
  const alertSvg = alertText
    .map((line, index) => `<text x="64" y="${648 + index * 34}" font-size="26" font-weight="700" fill="#fca5a5">${escapeXml(line)}</text>`)
    .join("\n");

  const goSvg = data.goConnections.length
    ? wrapSvgText(`GO: ${data.goConnections.map((c) => `${c.station} ${c.departures.slice(0, 1).map((d) => `${d.line} ${d.computedDepartureTime ?? d.scheduledTime ?? ""}`).join("")}`).join(" • ")}`, 96, 2)
        .map((line, index) => `<text x="64" y="${736 + index * 32}" font-size="24" font-weight="700" fill="#7dd3fc">${escapeXml(line)}</text>`)
        .join("\n")
    : "";

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#020617"/>
  <g font-family="DejaVu Sans, Arial, sans-serif">
  <rect x="32" y="30" width="1136" height="760" rx="28" fill="#0b1220" stroke="#f97316" stroke-width="8"/>
  <rect x="56" y="58" width="120" height="120" rx="60" fill="#f97316"/>
  <text x="116" y="142" font-size="74" font-weight="900" fill="#0b1220" text-anchor="middle">5</text>
  <text x="208" y="118" font-size="58" font-weight="900" fill="#ffffff">LINE 5 EGLINTON</text>
  <text x="210" y="166" font-size="30" font-weight="700" fill="#cbd5e1">Service status</text>
  <rect x="836" y="74" width="300" height="86" rx="16" fill="${statusFill}"/>
  <text x="986" y="132" font-size="40" font-weight="900" fill="#ffffff" text-anchor="middle">${escapeXml(statusText)}</text>

  <text x="64" y="252" font-size="30" font-weight="700" fill="#e2e8f0">First train ${escapeXml(sh.firstTrain ?? "--:--")}   •   Last train ${escapeXml(sh.lastTrain ?? "--:--")}   •   ${sh.stopCount} stops</text>

  <text x="64" y="338" font-size="32" font-weight="900" fill="#f97316">EASTBOUND → KENNEDY</text>
  <text x="616" y="338" font-size="32" font-weight="900" fill="#f97316">WESTBOUND → MT DENNIS</text>
  ${renderDepartures(data.eastbound, 56)}
  ${renderDepartures(data.westbound, 608)}

  <line x1="56" y1="620" x2="1144" y2="620" stroke="#334155" stroke-width="3"/>
  ${alertSvg}
  ${goSvg}
  <text x="1136" y="772" font-size="22" font-weight="700" fill="#94a3b8" text-anchor="end">Updated ${escapeXml(torontoClock())}</text>
  </g>
</svg>`;

  const png = await sharp(Buffer.from(svg, "utf8")).png({ quality: 95, compressionLevel: 6 }).toBuffer();
  return new AttachmentBuilder(png, { name: "line-5-status.png" });
}
