import { AttachmentBuilder } from "discord.js";
import gifenc from "gifenc";
import sharp from "sharp";
import type { AlertSummary, TripStopSummary, VehicleSummary } from "./types.js";
import { getAlerts, getLine5Departures, getLine5Stations, getLiveDeparturesNearStop, getLiveVehiclesNearStop, getTripStops, type LiveDepartureSummary, type NearbyVehicleSummary } from "./ttcClient.js";
import { makeTripFollowerAttachments } from "./tripFollower.js";
import { cleanAlertTitle } from "./line5Status.js";
import { makeLine5RouteMapAttachment } from "./line5Map.js";
import type { TripFollowSession } from "./settingsStore.js";

const { applyPalette, GIFEncoder, quantize } = gifenc;

// Line 5 realtime predictions carry no vehicle id — the fallback source manufactures
// synthetic "eta-N" ids. Never surface those as a real car/vehicle number.
function realVehicleNumber(vehicle: VehicleSummary | undefined): string | undefined {
  const candidate = vehicle?.vehicleLabel ?? vehicle?.vehicleId;
  if (!candidate || /^eta-/i.test(candidate)) {
    return undefined;
  }
  return candidate;
}

type TripOption = {
  key: "birchmount-17a" | "golden-mile-68b" | "kennedy-go-viva";
  title: string;
  line5Destination: "Birchmount" | "Golden Mile" | "Kennedy";
  line5StopPattern: RegExp;
  transfer: string;
  transferRouteShortName?: "17" | "68";
  transferAnchorStopPattern?: RegExp;
  transferHeadsignPattern?: RegExp;
  transferBranchStopPattern?: RegExp;
  transferDirection?: "northbound" | "southbound" | "eastbound" | "westbound";
  scheduledTransferWaitMinutes?: number;
  notes: string[];
};

type RecommendedTrip = {
  content: string;
  files: AttachmentBuilder[];
};

type DisruptionSummary = {
  blocked: boolean;
  penalty: number;
  lines: string[];
};

type EvaluatedTripOption = {
  option: TripOption;
  destination: TripStopSummary | undefined;
  inVehicleMinutes: number | undefined;
  liveTransfers: LiveDepartureSummary[];
  liveTransferVehicles: NearbyVehicleSummary[];
  transferWaitMinutes: number | undefined;
  transferWaitSource: string;
  score: number;
};

const options: TripOption[] = [
  {
    key: "birchmount-17a",
    title: "Line 5 to Birchmount, then 17A Birchmount northbound",
    line5Destination: "Birchmount",
    line5StopPattern: /Birchmount/i,
    transfer: "17A Birchmount northbound at Birchmount Station",
    transferRouteShortName: "17",
    transferAnchorStopPattern: /Birchmount Station|Birchmount Rd at Eglinton/i,
    transferHeadsignPattern: /\b17A\b.*Highway 7/i,
    transferBranchStopPattern: /Highway 7|Rougeside|Uptown|Enterprise|Verdale/i,
    transferDirection: "northbound",
    scheduledTransferWaitMinutes: 9,
    notes: ["TTC-only option. Live route 17 vehicles are shown when one is near the transfer stop; otherwise the wait is a scheduled-headway estimate (TTC's realtime feed does not expose Line-5-style branch arrivals for surface buses)."]
  },
  {
    key: "golden-mile-68b",
    title: "Line 5 to Golden Mile, then 68B Warden northbound",
    line5Destination: "Golden Mile",
    line5StopPattern: /Golden Mile/i,
    transfer: "68B Warden northbound at Golden Mile Station",
    transferRouteShortName: "68",
    transferAnchorStopPattern: /Golden Mile Station|Warden Ave at Eglinton/i,
    transferHeadsignPattern: /\b68B\b.*Major Mackenzie/i,
    transferBranchStopPattern: /Major Mackenzie|Angus Glen|Cachet|16th Ave/i,
    transferDirection: "northbound",
    scheduledTransferWaitMinutes: 8,
    notes: ["TTC-only backup. Live route 68 vehicles are shown when one is near the transfer stop; otherwise the wait is a scheduled-headway estimate (TTC's realtime feed does not expose Line-5-style branch arrivals for surface buses)."]
  },
  {
    key: "kennedy-go-viva",
    title: "Line 5 to Kennedy, Stouffville GO to Unionville, then Viva Purple A westbound",
    line5Destination: "Kennedy",
    line5StopPattern: /Kennedy/i,
    transfer: "Stouffville GO at Kennedy, then westbound Viva Purple A at Unionville GO",
    notes: ["GO/Viva is not ranked as live until GO and YRT realtime feed URLs are configured."]
  }
];

function minutesUntil(date: Date | undefined): number | undefined {
  if (!date) {
    return undefined;
  }
  return Math.max(0, Math.round((date.getTime() - Date.now()) / 60000));
}

function displayMinutes(minutes: number | undefined): string {
  return minutes === undefined ? "live ETA unavailable" : `${minutes} min`;
}

function transferBranchLabel(option: TripOption): string {
  if (option.key === "birchmount-17a") {
    return "17A";
  }
  if (option.key === "golden-mile-68b") {
    return "68B";
  }
  return "GO/Viva";
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function wrapText(value: string, maxChars: number, maxLines: number): string[] {
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

function stopByPattern(stops: TripStopSummary[], pattern: RegExp): TripStopSummary | undefined {
  return stops.find((stop) => pattern.test(stop.stopName));
}

function scheduleMinutesBetween(stops: TripStopSummary[], from: TripStopSummary | undefined, to: TripStopSummary | undefined): number | undefined {
  if (!from?.scheduledTime || !to?.scheduledTime) {
    return undefined;
  }
  const parse = (value: string) => {
    const [hours, minutes, seconds] = value.split(":").map(Number);
    return hours * 60 + minutes + Math.round((seconds || 0) / 60);
  };
  return Math.max(0, parse(to.scheduledTime) - parse(from.scheduledTime));
}

async function firstBoardingVehicle(): Promise<VehicleSummary | undefined> {
  const stations = await getLine5Stations();
  const eglinton = stations.find((station) => /Eglinton/i.test(station.stopName));
  if (!eglinton) {
    return undefined;
  }
  const departures = await getLine5Departures(eglinton.stopId, "eastbound");
  return departures[0];
}

function rankOption(option: TripOption, boardWait: number | undefined, inVehicleMinutes: number | undefined, transferWait: number | undefined): number {
  const unknownPenalty = boardWait === undefined || inVehicleMinutes === undefined || transferWait === undefined ? 20 : 0;
  const goPreferenceBonus = option.key === "kennedy-go-viva" && (transferWait ?? 99) < 15 ? -3 : 0;
  const unconfiguredPenalty = option.key === "kennedy-go-viva" && transferWait === undefined ? 40 : 0;
  return (boardWait ?? 12) + (inVehicleMinutes ?? 20) + (transferWait ?? 30) + unknownPenalty + goPreferenceBonus + unconfiguredPenalty;
}

async function liveTransferDepartures(option: TripOption): Promise<LiveDepartureSummary[]> {
  if (!option.transferRouteShortName || !option.transferAnchorStopPattern) {
    return [];
  }
  return getLiveDeparturesNearStop({
    routeShortName: option.transferRouteShortName,
    anchorStopPattern: option.transferAnchorStopPattern,
    headsignPattern: option.transferHeadsignPattern,
    branchStopPattern: option.transferBranchStopPattern,
    limit: 3
  });
}

async function liveTransferVehicles(option: TripOption): Promise<NearbyVehicleSummary[]> {
  if (!option.transferRouteShortName || !option.transferAnchorStopPattern) {
    return [];
  }
  // First try the precise branch match. The TTC realtime feed reuses tripIds/stopIds
  // that don't exist in the static GTFS, so realtime trips have no static headsign and
  // branch matching almost always yields nothing. Fall back to a route-level proximity
  // match (any route-68/17 bus heading the right way near the transfer stop) so a real
  // nearby vehicle is still surfaced instead of a guaranteed "no data".
  const branchMatch = await getLiveVehiclesNearStop({
    routeShortName: option.transferRouteShortName,
    anchorStopPattern: option.transferAnchorStopPattern,
    headsignPattern: option.transferHeadsignPattern,
    branchStopPattern: option.transferBranchStopPattern,
    direction: option.transferDirection,
    limit: 3
  });
  if (branchMatch.length) {
    return branchMatch;
  }
  return getLiveVehiclesNearStop({
    routeShortName: option.transferRouteShortName,
    anchorStopPattern: option.transferAnchorStopPattern,
    direction: option.transferDirection,
    radiusMeters: 1200,
    limit: 3
  });
}

function recommendationGifSvg(best: EvaluatedTripOption, evaluated: EvaluatedTripOption[], boardWait: number | undefined, vehicleName: string | undefined, frame: number): string {
  const width = 1200;
  const height = 700;
  const pulse = frame % 2 === 0;
  // A Line 5 boarding exists whenever there's a live ETA (boardWait), independent of
  // whether the feed provides a car number (it usually doesn't for Line 5).
  const line5Vehicle = vehicleName
    ? `Line 5 vehicle ${vehicleName}`
    : boardWait !== undefined ? "Line 5 train (live ETA, no car number)" : "No live Line 5 vehicle in feed";
  const transferVehicle = best.liveTransferVehicles[0]
    ? `Route ${best.option.transferRouteShortName} bus ${best.liveTransferVehicles[0].vehicleLabel}`
    : best.option.transferRouteShortName ? `No live route ${best.option.transferRouteShortName} bus nearby` : "GO/Viva realtime not configured";
  const etaLine = boardWait === undefined ? "Boarding ETA unavailable" : `Board Line 5 in ${boardWait} min`;
  const transferLine = best.transferWaitMinutes === undefined
    ? `Transfer wait unavailable (${best.transferWaitSource})`
    : `Transfer wait ${best.transferWaitMinutes} min (${best.transferWaitSource})`;
  const tickerText = `Take route ${best.option.transferRouteShortName ?? "GO/Viva"} from ${best.option.line5Destination}. ${line5Vehicle}. ${transferVehicle}.`;
  const tickerX = 1140 - frame * 42;
  const optionRows = evaluated.slice(0, 3).map((item, index) => {
    const y = 436 + index * 70;
    const selected = item.option.key === best.option.key;
    const branch = item.option.transferRouteShortName ?? "GO/Viva";
    const vehicle = item.liveTransferVehicles[0]?.vehicleLabel ?? "n/a";
    const wait = item.transferWaitMinutes === undefined ? "n/a" : `${item.transferWaitMinutes} min`;
    return `
      <rect x="64" y="${y - 42}" width="1072" height="56" rx="14" fill="${selected ? "#14532d" : "#1f2937"}" stroke="${selected ? "#22c55e" : "#334155"}" stroke-width="4"/>
      <text x="92" y="${y - 6}" font-size="24" font-weight="900" fill="#ffffff">${escapeXml(branch)}</text>
      <text x="210" y="${y - 6}" font-size="22" font-weight="800" fill="#e5e7eb">${escapeXml(item.option.line5Destination)}</text>
      <text x="660" y="${y - 6}" font-size="22" font-weight="800" fill="#facc15" text-anchor="middle">wait ${escapeXml(wait)}</text>
      <text x="1040" y="${y - 6}" font-size="22" font-weight="800" fill="#cbd5e1" text-anchor="end">bus/train ${escapeXml(vehicle)}</text>`;
  }).join("\n");
  const titleLines = wrapText(best.option.title, 36, 2);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#020617"/>
  <g font-family="DejaVu Sans, Arial, sans-serif">
    <rect x="34" y="30" width="1132" height="640" rx="28" fill="#0f172a" stroke="${pulse ? "#facc15" : "#64748b"}" stroke-width="8"/>
    <text x="64" y="92" font-size="28" font-weight="900" fill="#facc15">RECOMMENDED EASTBOUND TRIP</text>
    ${titleLines.map((line, index) => `<text x="64" y="${150 + index * 48}" font-size="42" font-weight="900" fill="#ffffff">${escapeXml(line)}</text>`).join("\n")}
    <rect x="64" y="245" width="500" height="94" rx="18" fill="${boardWait !== undefined ? "#064e3b" : "#7f1d1d"}"/>
    <text x="92" y="286" font-size="24" font-weight="900" fill="#ffffff">LINE 5 BOARDING</text>
    <text x="92" y="320" font-size="26" font-weight="900" fill="#f8fafc">${escapeXml(etaLine)}</text>
    <text x="540" y="320" font-size="22" font-weight="900" fill="#cbd5e1" text-anchor="end">${escapeXml(vehicleName ? `car ${vehicleName}` : boardWait !== undefined ? "live ETA" : "n/a")}</text>
    <rect x="596" y="245" width="540" height="94" rx="18" fill="${best.liveTransferVehicles[0] ? "#064e3b" : "#78350f"}"/>
    <text x="624" y="286" font-size="24" font-weight="900" fill="#ffffff">TRANSFER VEHICLE</text>
    <text x="624" y="320" font-size="26" font-weight="900" fill="#f8fafc">${escapeXml(transferVehicle)}</text>
    <text x="64" y="372" font-size="24" font-weight="900" fill="#e5e7eb">${escapeXml(transferLine)}</text>
    ${optionRows}
    <rect x="64" y="626" width="1072" height="28" rx="10" fill="#111827"/>
    <text x="${tickerX}" y="647" font-size="19" font-weight="900" fill="#facc15">${escapeXml(tickerText)}</text>
  </g>
</svg>`;
}

async function makeRecommendationGifAttachment(best: EvaluatedTripOption, evaluated: EvaluatedTripOption[], boardWait: number | undefined, vehicleName: string | undefined): Promise<AttachmentBuilder> {
  const width = 1200;
  const height = 700;
  const gif = GIFEncoder();
  for (let frame = 0; frame < 12; frame += 1) {
    const raw = await sharp(Buffer.from(recommendationGifSvg(best, evaluated, boardWait, vehicleName, frame), "utf8"))
      .raw()
      .ensureAlpha()
      .toBuffer();
    const palette = quantize(raw, 256, { format: "rgb565" });
    const index = applyPalette(raw, palette, "rgb565");
    gif.writeFrame(index, width, height, { palette, delay: 260, repeat: 0 });
  }
  gif.finish();
  return new AttachmentBuilder(Buffer.from(gif.bytes()), { name: "ttc-trip-recommendation.gif" });
}

function expectedReturnText(alert: AlertSummary): string | undefined {
  const activeEnd = alert.activePeriods
    .map((period) => period.match(/\bto\s+(.+)$/i)?.[1])
    .find((value) => value && !/until further notice/i.test(value));
  if (activeEnd) {
    return `listed until ${activeEnd}`;
  }

  return alert.description.match(/\b(?:expected to be back in service|expected to resume|expected to reopen)\s+([^.;]+)/i)?.[0];
}

function summarizeDisruptions(alerts: AlertSummary[]): DisruptionSummary {
  const relevant = alerts.filter((alert) => {
    const alertText = `${alert.header} ${alert.description}`.toLowerCase();
    const routeText = `${alertText} ${alert.affectedRoutes.join(" ")}`.toLowerCase();
    const serviceDisruption = /\b(line 5|eglinton crosstown|lrt)\b/.test(routeText)
      && /\b(no service|delay|delays|suspended|reduced service|not stopping|closed|closure|replacement bus|shuttle)\b/.test(routeText);
    const stationAccessibility = /\b(eglinton|golden mile|birchmount|kennedy|unionville)\b/.test(alertText)
      && /\b(elevator|escalator|washroom|accessibility)\b/.test(alertText);
    const goVivaDisruption = /\b(stouffville|unionville|viva purple)\b/.test(routeText)
      && /\b(no service|delay|delays|suspended|reduced service|closed|closure)\b/.test(routeText);
    return serviceDisruption || stationAccessibility || goVivaDisruption;
  });

  let blocked = false;
  let penalty = 0;
  const lines = relevant.slice(0, 4).map((alert) => {
    const text = `${alert.header} ${alert.description}`.toLowerCase();
    if (/\b(no service|suspended|closed|closure)\b/.test(text)) {
      blocked = true;
      penalty += 90;
    } else if (/\b(delay|delays|reduced service|replacement bus|shuttle|not stopping)\b/.test(text)) {
      penalty += 15;
    }
    const returnText = expectedReturnText(alert);
    // Use the truncation-aware title (TTC hard-caps headerText at 32 chars, so the raw
    // header often cuts mid-word e.g. "Line 5 Eglinton: Delays between"). Only append a
    // return time when one is actually published — the old "(return time not published)"
    // filler read as broken text after a truncated header.
    return `- ${cleanAlertTitle(alert)}${returnText ? ` (${returnText})` : ""}`;
  });

  return { blocked, penalty, lines };
}

export async function buildEglintonEastboundRecommendation(userId?: string): Promise<RecommendedTrip> {
  const [alerts, stations, boardingVehicle] = await Promise.all([
    getAlerts(),
    getLine5Stations(),
    firstBoardingVehicle()
  ]);

  const eglinton = stations.find((station) => /Eglinton/i.test(station.stopName));
  const tripStops = boardingVehicle?.tripId ? await getTripStops(boardingVehicle.tripId) : stations;
  const fromStop = stopByPattern(tripStops, /Eglinton/i) ?? eglinton;
  const boardWait = minutesUntil(boardingVehicle?.eta);
  const disruptions = summarizeDisruptions(alerts);

  const [transferDepartures, transferVehicles] = await Promise.all([
    Promise.all(options.map(liveTransferDepartures)),
    Promise.all(options.map(liveTransferVehicles))
  ]);

  const evaluated = options.map((option, index) => {
    const destination = stopByPattern(tripStops, option.line5StopPattern) ?? stopByPattern(stations, option.line5StopPattern);
    const inVehicleMinutes = scheduleMinutesBetween(tripStops, fromStop, destination);
    const liveTransfer = transferDepartures[index][0];
    const transferWaitMinutes = liveTransfer?.waitMinutes ?? option.scheduledTransferWaitMinutes;
    return {
      option,
      destination,
      inVehicleMinutes,
      liveTransfers: transferDepartures[index],
      liveTransferVehicles: transferVehicles[index],
      transferWaitMinutes,
      transferWaitSource: liveTransfer
        ? `live TTC GTFS-Realtime route ${option.transferRouteShortName}`
        : option.key === "kennedy-go-viva"
          ? "GO/YRT realtime not configured"
          : "scheduled-headway estimate",
      score: rankOption(option, boardWait, inVehicleMinutes, transferWaitMinutes) + disruptions.penalty
    };
  }).sort((a, b) => a.score - b.score);

  const best = evaluated[0];
  const vehicleName = realVehicleNumber(boardingVehicle);
  const line5Eta = boardWait === undefined
    ? "No live Line 5 vehicle ETA is available from Eglinton right now."
    : `Board the next eastbound Line 5 vehicle in about **${boardWait} min**${vehicleName ? `: vehicle **${vehicleName}**` : " — Line 5 trains don't broadcast a car/vehicle number, so there's nothing to read off the train"}.`;

  const lines = [
    userId ? `<@${userId}> recommended eastbound trip from **Eglinton Station**:` : "Recommended eastbound trip from **Eglinton Station**:",
    `# ${best.option.title}`,
    line5Eta,
    `Ride Line 5 to **${best.option.line5Destination}**${best.inVehicleMinutes !== undefined ? `, about **${best.inVehicleMinutes} min** on board` : ""}.`,
    `Transfer to **${best.option.transfer}**.`,
    `Expected transfer wait: **${displayMinutes(best.transferWaitMinutes)}** (${best.transferWaitSource}).`,
    // One honest live-bus line. Prefer a live departure time, then a nearby live vehicle,
    // then a single clear "no live bus" note (the old triple-negative was confusing).
    best.liveTransfers.length
      ? `Live route ${best.option.transferRouteShortName} departure: **${best.liveTransfers[0].eta?.toLocaleTimeString("en-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit" })}** at **${best.liveTransfers[0].stopName}**${best.liveTransfers[0].vehicleLabel ? `, vehicle **${best.liveTransfers[0].vehicleLabel}**` : ""}.`
      : best.liveTransferVehicles.length
        ? `Live route ${best.option.transferRouteShortName} bus nearby: vehicle **${best.liveTransferVehicles[0].vehicleLabel}**, about **${best.liveTransferVehicles[0].distanceMeters} m** from the transfer stop${best.liveTransferVehicles[0].bearing !== undefined ? `, heading **${Math.round(best.liveTransferVehicles[0].bearing)}°**` : ""}.`
        : best.option.transferRouteShortName
          ? `No live route ${best.option.transferRouteShortName} bus near the transfer stop right now — the wait above is the scheduled estimate. (TTC's realtime feed doesn't publish per-branch surface-bus arrivals the way it would for a Line-5-style station.)`
          : undefined,
    disruptions.lines.length
      ? `\n**Service disruptions detected**\n${disruptions.lines.join("\n")}`
      : "\n**Service disruptions detected**\n- No matching Line 5 / transfer disruption found in the current TTC alert feed.",
    disruptions.blocked ? "\nThis route may be blocked by a current no-service/closure alert. Check before boarding." : undefined,
    "",
    "**Why this one**",
    ...best.option.notes.map((note) => `- ${note}`),
    "",
    "**Other options checked**",
    ...evaluated.slice(1).map((item) =>
      `- ${item.option.title}: Line 5 ride ${displayMinutes(item.inVehicleMinutes)}, transfer wait ${displayMinutes(item.transferWaitMinutes)} (${item.transferWaitSource}).`
    )
  ].filter(Boolean) as string[];

  const files: AttachmentBuilder[] = [];
  files.push(await makeRecommendationGifAttachment(best, evaluated, boardWait, vehicleName));
  const liveTripDestination = boardingVehicle?.tripId ? stopByPattern(tripStops, best.option.line5StopPattern) : undefined;
  if (boardingVehicle?.tripId && liveTripDestination) {
    const session: TripFollowSession = {
      userId: userId ?? "recommendation",
      channelId: "recommendation",
      vehicleNumber: vehicleName ?? boardingVehicle.vehicleId,
      vehicleId: boardingVehicle.vehicleId,
      vehicleLabel: boardingVehicle.vehicleLabel,
      tripId: boardingVehicle.tripId,
      routeName: boardingVehicle.routeName,
      routeShortName: boardingVehicle.routeShortName,
      destinationStopId: liveTripDestination.stopId,
      destinationStopName: liveTripDestination.stopName.replace(/\s+Station.*$/i, ""),
      destinationStopSequence: liveTripDestination.stopSequence,
      createdAt: new Date().toISOString()
    };
    files.push(...await makeTripFollowerAttachments(session, boardingVehicle, tripStops, alerts as AlertSummary[]));
  } else {
    // Line 5's fallback source exposes no TTC GTFS trip id AND no car number, so a
    // vehicle-tracking follower can't lock onto this specific train. Auto-attach a Line 5
    // trip map marking BOARD HERE -> ALIGHT HERE instead — that's how you follow a Line 5
    // trip when there's no vehicle number to enter.
    const destStation = stopByPattern(stations, best.option.line5StopPattern);
    files.push(await makeLine5RouteMapAttachment(stations, eglinton?.stopId, "eastbound", destStation?.stopId));
    lines.push(
      "",
      "**Follow your Line 5 trip**",
      `- Line 5 trains don't broadcast a car/vehicle number, so there's nothing to enter for the train itself. Follow your trip on the map below — it marks **BOARD HERE** at Eglinton and **ALIGHT HERE** at ${best.option.line5Destination}${best.inVehicleMinutes !== undefined ? ` (~${best.inVehicleMinutes} min on board)` : ""}.`,
      "- For the connecting bus (buses *do* show a car number), tap **Follow this trip live** and enter that bus's number to get live stop-by-stop tracking."
    );
  }

  return {
    content: lines.join("\n"),
    files
  };
}

export function isEglintonEastboundRecommendationRequest(text: string): boolean {
  return /\b(leaving|from|departing)\b/i.test(text)
    && /\beglinton\b/i.test(text)
    && /\beastbound\b/i.test(text);
}
