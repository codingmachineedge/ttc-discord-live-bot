import { AttachmentBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from "discord.js";
import type { TripFollowSession } from "./settingsStore.js";
import type { TripStopSummary, VehicleSummary } from "./types.js";

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

export function makeProgressAttachment(session: TripFollowSession, vehicle: VehicleSummary, stops: TripStopSummary[]): AttachmentBuilder {
  const currentSequence = vehicle.currentStopSequence;
  const visibleStops = routeWindow(stops, currentSequence, session.destinationStopSequence);
  const width = 900;
  const height = 260;
  const left = 70;
  const right = width - 70;
  const lineY = 112;
  const spacing = visibleStops.length > 1 ? (right - left) / (visibleStops.length - 1) : 0;
  const currentIndex = visibleStops.findIndex((stop) => stop.stopSequence >= (currentSequence ?? 0));
  const destinationIndex = visibleStops.findIndex((stop) => stop.stopSequence === session.destinationStopSequence);

  const stopNodes = visibleStops.map((stop, index) => {
    const x = left + spacing * index;
    const isCurrent = index === currentIndex;
    const isDestination = index === destinationIndex;
    const fill = isDestination ? "#dc2626" : isCurrent ? "#047857" : "#ffffff";
    const stroke = isDestination ? "#991b1b" : isCurrent ? "#065f46" : "#334155";
    const label = escapeXml(stop.stopName.length > 23 ? `${stop.stopName.slice(0, 20)}...` : stop.stopName);
    return `
      <circle cx="${x}" cy="${lineY}" r="${isCurrent || isDestination ? 14 : 10}" fill="${fill}" stroke="${stroke}" stroke-width="4"/>
      <text x="${x}" y="${lineY + 42}" text-anchor="middle" font-size="18" fill="#0f172a">${label}</text>
      <text x="${x}" y="${lineY + 68}" text-anchor="middle" font-size="14" fill="#475569">#${stop.stopSequence}</text>`;
  }).join("\n");

  const progressX = currentIndex >= 0 ? left + spacing * currentIndex : left;
  const destinationText = escapeXml(session.destinationStopName);
  const nextStopText = escapeXml(vehicle.nextStop ?? "next stop unavailable");
  const routeText = escapeXml(session.routeName);
  const statusText = escapeXml(vehicle.currentStatus ?? "status unavailable");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" rx="22" fill="#f8fafc"/>
  <rect x="24" y="22" width="${width - 48}" height="58" rx="12" fill="#111827"/>
  <text x="48" y="58" font-family="Arial, sans-serif" font-size="24" fill="#ffffff" font-weight="700">${routeText} vehicle ${escapeXml(session.vehicleLabel ?? session.vehicleNumber)}</text>
  <text x="${width - 48}" y="58" font-family="Arial, sans-serif" font-size="18" fill="#cbd5e1" text-anchor="end">${statusText}</text>
  <line x1="${left}" y1="${lineY}" x2="${right}" y2="${lineY}" stroke="#94a3b8" stroke-width="8" stroke-linecap="round"/>
  <line x1="${left}" y1="${lineY}" x2="${progressX}" y2="${lineY}" stroke="#0f766e" stroke-width="8" stroke-linecap="round"/>
  ${stopNodes}
  <text x="48" y="220" font-family="Arial, sans-serif" font-size="20" fill="#0f172a">Next: ${nextStopText}</text>
  <text x="${width - 48}" y="220" font-family="Arial, sans-serif" font-size="20" fill="#991b1b" text-anchor="end">Get off: ${destinationText}</text>
</svg>`;

  return new AttachmentBuilder(Buffer.from(svg, "utf8"), { name: "ttc-trip-progress.svg" });
}

export function buildTripAnnouncement(session: TripFollowSession, vehicle: VehicleSummary): string {
  const currentSequence = vehicle.currentStopSequence ?? 0;
  const stopsAway = Math.max(0, session.destinationStopSequence - currentSequence);
  const nextStop = vehicle.nextStop ?? "the next stop";
  const vehicleName = vehicle.vehicleLabel || vehicle.vehicleId || session.vehicleNumber;
  const line5Style = session.routeShortName === "5" || session.routeName.toLowerCase().includes("line 5");

  if (line5Style) {
    const script = buildLine5AnnouncerScript(session, vehicle, stopsAway);
    if (currentSequence >= session.destinationStopSequence || vehicle.nextStopId === session.destinationStopId) {
      return `<@${session.userId}> get off at **${session.destinationStopName}**.\n\n${script}`;
    }
    return `<@${session.userId}> Line 5 Eglinton trip follower for vehicle **${vehicleName}**.\n\n${script}`;
  }

  if (currentSequence >= session.destinationStopSequence || vehicle.nextStopId === session.destinationStopId) {
    return `<@${session.userId}> get off at **${session.destinationStopName}**. Vehicle ${vehicleName} is at or approaching your stop.`;
  }

  if (stopsAway === 1) {
    return `<@${session.userId}> next stop is **${nextStop}**. Your stop **${session.destinationStopName}** is after this. Get ready.`;
  }

  const status = vehicle.currentStatus === "STOPPED_AT"
    ? "Doors open"
    : vehicle.currentStatus === "IN_TRANSIT_TO"
      ? "Doors closing/departed"
      : "Approaching";

  return `<@${session.userId}> ${status}. Next stop: **${nextStop}**. Get off at **${session.destinationStopName}** in about ${stopsAway} stops.`;
}

function buildLine5AnnouncerScript(session: TripFollowSession, vehicle: VehicleSummary, stopsAway: number): string {
  const nextStop = vehicle.nextStop ?? "stop unavailable";
  const destination = session.destinationStopName;

  if ((vehicle.currentStopSequence ?? 0) >= session.destinationStopSequence || vehicle.nextStopId === session.destinationStopId) {
    return [
      "**Line 5-style announcer**",
      `English: Arriving at ${destination}. This is your stop. Please exit here.`,
      `Français : Arrivée à ${destination}. C'est votre arrêt. Veuillez descendre ici.`
    ].join("\n");
  }

  if (stopsAway === 1) {
    return [
      "**Line 5-style announcer**",
      `English: The next station is ${nextStop}. ${destination} is the following stop. Please prepare to exit.`,
      `Français : La prochaine station est ${nextStop}. ${destination} est l'arrêt suivant. Préparez-vous à descendre.`
    ].join("\n");
  }

  if (vehicle.currentStatus === "STOPPED_AT") {
    return [
      "**Line 5-style announcer**",
      `English: Arriving at ${vehicle.currentStop ?? nextStop}. The next station is ${nextStop}.`,
      `Français : Arrivée à ${vehicle.currentStop ?? nextStop}. La prochaine station est ${nextStop}.`
    ].join("\n");
  }

  return [
    "**Line 5-style announcer**",
    `English: Please stand clear of the doors. The next station is ${nextStop}. Get off at ${destination} in about ${stopsAway} stops.`,
    `Français : Veuillez vous tenir à l'écart des portes. La prochaine station est ${nextStop}. Descendez à ${destination} dans environ ${stopsAway} arrêts.`
  ].join("\n");
}
