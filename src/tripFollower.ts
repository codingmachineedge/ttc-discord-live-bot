import { AttachmentBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from "discord.js";
import gifenc from "gifenc";
import sharp from "sharp";
import type { TripFollowSession } from "./settingsStore.js";
import type { AlertSummary } from "./types.js";
import { formatStationDetails } from "./stationDetails.js";
import type { TripStopSummary, VehicleSummary } from "./types.js";

const { applyPalette, GIFEncoder, quantize } = gifenc;

export function upcomingStopOptions(stops: TripStopSummary[], currentSequence?: number): StringSelectMenuBuilder {
  let upcoming = stops
    .filter((stop) => !currentSequence || stop.stopSequence >= currentSequence)
    .slice(0, 25);
  if (!upcoming.length) {
    upcoming = stops.slice(-25);
  }

  return new StringSelectMenuBuilder()
    .setCustomId("ttc-follow-destination")
    .setPlaceholder("Choose where you want to get off")
    .addOptions(
      upcoming.map((stop) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(stop.stopName.slice(0, 100))
          .setDescription(`Stop #${stop.stopSequence}${stop.scheduledTime ? ` scheduled ${stop.scheduledTime}` : ""}`.slice(0, 100))
          .setValue(`${stop.stopSequence}|${stop.stopId}`)
      )
    );
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function routeWindow(stops: TripStopSummary[], currentSequence: number | undefined, destinationSequence: number): TripStopSummary[] {
  const currentIndex = Math.max(0, stops.findIndex((stop) => stop.stopSequence >= (currentSequence ?? 0)));
  const destinationIndex = Math.max(0, stops.findIndex((stop) => stop.stopSequence === destinationSequence));
  const start = Math.max(0, Math.min(currentIndex, destinationIndex) - 2);
  const end = Math.min(stops.length, Math.max(currentIndex, destinationIndex) + 3);
  return stops.slice(start, end);
}

function formatVehicleStatus(status: string | undefined): string {
  if (status === "STOPPED_AT") {
    return "Doors open";
  }
  if (status === "IN_TRANSIT_TO") {
    return "Departed";
  }
  if (status === "INCOMING_AT") {
    return "Arriving";
  }
  return "Status unavailable";
}

function wrapLabel(value: string, maxChars: number): string[] {
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
    if (lines.length === 2) {
      break;
    }
  }
  if (current && lines.length < 2) {
    lines.push(current);
  }
  return lines;
}

function compactDetail(value: string, maxChars = 78): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars - 3)}...` : normalized;
}

function line5TickerText(session: TripFollowSession, vehicle: VehicleSummary): string {
  const nextStop = vehicle.nextStop ?? "the next station";
  const destination = session.destinationStopName;
  const currentSequence = vehicle.currentStopSequence ?? 0;
  const stopsAway = Math.max(0, session.destinationStopSequence - currentSequence);
  if (currentSequence >= session.destinationStopSequence || vehicle.nextStopId === session.destinationStopId) {
    return `Arriving at ${destination}. This is your stop. Please exit here. / Arrivée à ${destination}. C'est votre arrêt.`;
  }
  if (vehicle.currentStatus === "STOPPED_AT") {
    return `Arriving at ${vehicle.currentStop ?? nextStop}. The next station is ${nextStop}. / Arrivée à ${vehicle.currentStop ?? nextStop}. La prochaine station est ${nextStop}.`;
  }
  return `Please stand clear of the doors. The next station is ${nextStop}. Get off at ${destination} in about ${stopsAway} stops.`;
}

function tripMapSvg(session: TripFollowSession, vehicle: VehicleSummary, stops: TripStopSummary[], frame = 0): string {
  const currentSequence = vehicle.currentStopSequence;
  const visibleStops = routeWindow(stops, currentSequence, session.destinationStopSequence);
  const width = 1200;
  const height = 400;
  const left = 92;
  const right = width - 70;
  const lineY = 178;
  const spacing = visibleStops.length > 1 ? (right - left) / (visibleStops.length - 1) : 0;
  const currentIndex = visibleStops.findIndex((stop) => stop.stopSequence >= (currentSequence ?? 0));
  const destinationIndex = visibleStops.findIndex((stop) => stop.stopSequence === session.destinationStopSequence);

  const stopNodes = visibleStops.map((stop, index) => {
    const x = left + spacing * index;
    const isCurrent = index === currentIndex;
    const isDestination = index === destinationIndex;
    const pulse = frame % 2 === 0;
    const fill = isDestination ? (pulse ? "#ef4444" : "#dc2626") : isCurrent ? (pulse ? "#10b981" : "#047857") : "#ffffff";
    const stroke = isDestination ? "#991b1b" : isCurrent ? "#065f46" : "#334155";
    const radius = isCurrent || isDestination ? (pulse ? 18 : 14) : 10;
    const labelLines = wrapLabel(stop.stopName, 16);
    return `
      <circle cx="${x}" cy="${lineY}" r="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="4"/>
      ${labelLines.map((line, lineIndex) => `<text x="${x}" y="${lineY + 56 + lineIndex * 24}" text-anchor="middle" font-size="20" font-weight="800" fill="#0f172a">${escapeXml(line)}</text>`).join("\n")}
      <text x="${x}" y="${lineY + 116}" text-anchor="middle" font-size="16" fill="#475569">Stop #${stop.stopSequence}</text>`;
  }).join("\n");

  const progressX = currentIndex >= 0 ? left + spacing * currentIndex : left;
  const destinationText = escapeXml(session.destinationStopName);
  const atDestination = (vehicle.currentStopSequence ?? 0) >= session.destinationStopSequence || vehicle.nextStopId === session.destinationStopId;
  const nextStopText = escapeXml(atDestination ? "Get off now" : vehicle.nextStop ?? "next stop unavailable");
  const routeText = escapeXml(session.routeName);
  const statusText = escapeXml(formatVehicleStatus(vehicle.currentStatus));
  const scrollText = escapeXml(line5TickerText(session, vehicle));
  const scrollX = 1180 - frame * 90;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" rx="22" fill="#f8fafc"/>
  <g font-family="DejaVu Sans, Arial, sans-serif">
  <rect x="32" y="28" width="${width - 64}" height="82" rx="14" fill="#111827"/>
  <text x="64" y="78" font-size="34" fill="#ffffff" font-weight="900">${routeText} vehicle ${escapeXml(session.vehicleLabel ?? session.vehicleNumber)}</text>
  <text x="${width - 64}" y="78" font-size="24" fill="#cbd5e1" text-anchor="end">${statusText}</text>
  <line x1="${left}" y1="${lineY}" x2="${right}" y2="${lineY}" stroke="#94a3b8" stroke-width="8" stroke-linecap="round"/>
  <line x1="${left}" y1="${lineY}" x2="${progressX}" y2="${lineY}" stroke="#0f766e" stroke-width="8" stroke-linecap="round"/>
  ${stopNodes}
  <text x="64" y="360" font-size="28" font-weight="900" fill="#0f172a">Next: ${nextStopText}</text>
  <text x="${width - 64}" y="360" font-size="28" font-weight="900" fill="#991b1b" text-anchor="end">Get off: ${destinationText}</text>
  <rect x="32" y="370" width="${width - 64}" height="30" rx="10" fill="#111827"/>
  <text x="${scrollX}" y="392" font-size="20" font-weight="900" fill="#facc15">${scrollText}</text>
  </g>
</svg>`;
}

export async function makeTripMapAttachment(session: TripFollowSession, vehicle: VehicleSummary, stops: TripStopSummary[]): Promise<AttachmentBuilder> {
  const width = 1200;
  const height = 400;
  const gif = GIFEncoder();

  for (let frame = 0; frame < 10; frame += 1) {
    const raw = await sharp(Buffer.from(tripMapSvg(session, vehicle, stops, frame), "utf8"))
      .raw()
      .ensureAlpha()
      .toBuffer();
    const palette = quantize(raw, 256, { format: "rgb565" });
    const index = applyPalette(raw, palette, "rgb565");
    gif.writeFrame(index, width, height, { palette, delay: 120, repeat: 0 });
  }

  gif.finish();
  return new AttachmentBuilder(Buffer.from(gif.bytes()), { name: "ttc-trip-live-map.gif" });
}

export async function makeNextStopInfoAttachment(session: TripFollowSession, vehicle: VehicleSummary, alerts: AlertSummary[] = []): Promise<AttachmentBuilder> {
  const width = 1200;
  const height = 560;
  const atDestination = (vehicle.currentStopSequence ?? 0) >= session.destinationStopSequence || vehicle.nextStopId === session.destinationStopId;
  const statusText = escapeXml(formatVehicleStatus(vehicle.currentStatus));
  const nextStop = escapeXml(atDestination ? "Get off now" : vehicle.nextStop ?? "next stop unavailable");
  const destination = escapeXml(session.destinationStopName);
  const details = formatStationDetails(vehicle, alerts).slice(0, 5);
  const detailRows = details.map((detail, index) => {
    const [label, ...valueParts] = detail.split(":");
    const value = compactDetail(valueParts.join(":").trim(), 72);
    const y = 242 + index * 56;
    return `
      <rect x="64" y="${y - 34}" width="${width - 128}" height="46" rx="12" fill="${index % 2 === 0 ? "#e2e8f0" : "#f8fafc"}"/>
      <text x="92" y="${y - 4}" font-size="20" font-weight="900" fill="#334155">${escapeXml(label.toUpperCase())}</text>
      <text x="448" y="${y - 4}" font-size="21" font-weight="800" fill="#0f172a">${escapeXml(value || "unknown")}</text>`;
  }).join("\n");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" rx="24" fill="#f8fafc"/>
  <g font-family="DejaVu Sans, Arial, sans-serif">
  <rect x="32" y="28" width="${width - 64}" height="132" rx="18" fill="#111827"/>
  <text x="64" y="82" font-size="42" font-weight="900" fill="#ffffff">Next station: ${nextStop}</text>
  <text x="64" y="126" font-size="28" font-weight="800" fill="#cbd5e1">Status: ${statusText}</text>
  <text x="${width - 64}" y="126" font-size="28" font-weight="900" fill="#fecaca" text-anchor="end">Get off: ${destination}</text>
  <text x="64" y="194" font-size="28" font-weight="900" fill="#334155">Station info</text>
  ${detailRows}
  </g>
</svg>`;

  const png = await sharp(Buffer.from(svg, "utf8"))
    .png({ quality: 95, compressionLevel: 6 })
    .toBuffer();
  return new AttachmentBuilder(png, { name: "ttc-next-stop-info.png" });
}

export async function makeTripFollowerAttachments(session: TripFollowSession, vehicle: VehicleSummary, stops: TripStopSummary[], alerts: AlertSummary[] = []): Promise<AttachmentBuilder[]> {
  return [
    await makeTripMapAttachment(session, vehicle, stops),
    await makeNextStopInfoAttachment(session, vehicle, alerts)
  ];
}

export function buildTripAnnouncement(session: TripFollowSession, vehicle: VehicleSummary, alerts: AlertSummary[] = []): string {
  const currentSequence = vehicle.currentStopSequence ?? 0;
  const stopsAway = Math.max(0, session.destinationStopSequence - currentSequence);
  const nextStop = vehicle.nextStop ?? "the next stop";
  const vehicleName = vehicle.vehicleLabel || vehicle.vehicleId || session.vehicleNumber;
  const line5Style = session.routeShortName === "5" || session.routeName.toLowerCase().includes("line 5");
  const stationDetails = formatStationDetails(vehicle, alerts).map((line) => `- ${line}`).join("\n");

  if (line5Style) {
    const script = buildLine5AnnouncerScript(session, vehicle, stopsAway);
    if (currentSequence >= session.destinationStopSequence || vehicle.nextStopId === session.destinationStopId) {
      return `${script}\n\n<@${session.userId}> get off at **${session.destinationStopName}** now.\n\n**Station details**\n${stationDetails}`;
    }
    return `${script}\n\n<@${session.userId}> following Line 5 Eglinton vehicle **${vehicleName}**. Get off at **${session.destinationStopName}**.\n\n**Station details**\n${stationDetails}`;
  }

  if (currentSequence >= session.destinationStopSequence || vehicle.nextStopId === session.destinationStopId) {
    return `<@${session.userId}> get off at **${session.destinationStopName}**. Vehicle ${vehicleName} is at or approaching your stop.\n\n**Station details**\n${stationDetails}`;
  }

  if (stopsAway === 1) {
    return `<@${session.userId}> next stop is **${nextStop}**. Your stop **${session.destinationStopName}** is after this. Get ready.\n\n**Station details**\n${stationDetails}`;
  }

  const status = vehicle.currentStatus === "STOPPED_AT"
    ? "Doors open"
    : vehicle.currentStatus === "IN_TRANSIT_TO"
      ? "Doors closing/departed"
      : "Approaching";

  return `<@${session.userId}> ${status}. Next stop: **${nextStop}**. Get off at **${session.destinationStopName}** in about ${stopsAway} stops.\n\n**Station details**\n${stationDetails}`;
}

function buildLine5AnnouncerScript(session: TripFollowSession, vehicle: VehicleSummary, stopsAway: number): string {
  const nextStop = vehicle.nextStop ?? "stop unavailable";
  const destination = session.destinationStopName;

  if ((vehicle.currentStopSequence ?? 0) >= session.destinationStopSequence || vehicle.nextStopId === session.destinationStopId) {
    return [
      "**Line 5-style announcer**",
      `Arriving at ${destination}. ${destination} station. This is your stop. Please exit here.`,
      `Arrivée à ${destination}. Station ${destination}. C'est votre arrêt. Veuillez descendre ici.`
    ].join("\n");
  }

  if (stopsAway === 1) {
    return [
      "**Line 5-style announcer**",
      `The next station is ${nextStop}. ${destination} is the following station. Please prepare to exit.`,
      `La prochaine station est ${nextStop}. ${destination} est la station suivante. Préparez-vous à descendre.`
    ].join("\n");
  }

  if (vehicle.currentStatus === "STOPPED_AT") {
    return [
      "**Line 5-style announcer**",
      `Arriving at ${vehicle.currentStop ?? nextStop}. The next station is ${nextStop}.`,
      `Arrivée à ${vehicle.currentStop ?? nextStop}. La prochaine station est ${nextStop}.`
    ].join("\n");
  }

  return [
    "**Line 5-style announcer**",
    `Please stand clear of the doors. The next station is ${nextStop}. Get off at ${destination} in about ${stopsAway} stops.`,
    `Veuillez vous tenir à l'écart des portes. La prochaine station est ${nextStop}. Descendez à ${destination} dans environ ${stopsAway} arrêts.`
  ].join("\n");
}
