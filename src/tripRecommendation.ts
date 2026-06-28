import type { AttachmentBuilder } from "discord.js";
import type { AlertSummary, TripStopSummary, VehicleSummary } from "./types.js";
import { getAlerts, getLine5Departures, getLine5Stations, getTripStops } from "./ttcClient.js";
import { makeTripFollowerAttachments } from "./tripFollower.js";
import type { TripFollowSession } from "./settingsStore.js";

type TripOption = {
  key: "birchmount-17a" | "golden-mile-68b" | "kennedy-go-viva";
  title: string;
  line5Destination: "Birchmount" | "Golden Mile" | "Kennedy";
  line5StopPattern: RegExp;
  transfer: string;
  transferWaitMinutes: number;
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

const options: TripOption[] = [
  {
    key: "birchmount-17a",
    title: "Line 5 to Birchmount, then 17A Birchmount northbound",
    line5Destination: "Birchmount",
    line5StopPattern: /Birchmount/i,
    transfer: "17A Birchmount northbound at Birchmount Station",
    transferWaitMinutes: 6,
    notes: ["Best TTC-only option when you want the shortest planned transfer wait."]
  },
  {
    key: "golden-mile-68b",
    title: "Line 5 to Golden Mile, then 68B Warden northbound",
    line5Destination: "Golden Mile",
    line5StopPattern: /Golden Mile/i,
    transfer: "68B Warden northbound at Golden Mile Station",
    transferWaitMinutes: 8,
    notes: ["Good TTC-only backup if Birchmount/17A timing looks worse."]
  },
  {
    key: "kennedy-go-viva",
    title: "Line 5 to Kennedy, Stouffville GO to Unionville, then Viva Purple A westbound",
    line5Destination: "Kennedy",
    line5StopPattern: /Kennedy/i,
    transfer: "Stouffville GO at Kennedy, then westbound Viva Purple A at Unionville GO",
    transferWaitMinutes: 14,
    notes: ["Preferred only when the Unionville GO to westbound Viva Purple A connection is under 15 minutes.", "GO/Viva timing is hardcoded here until GO/YRT realtime feeds are added."]
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

function rankOption(option: TripOption, boardWait: number | undefined, inVehicleMinutes: number | undefined): number {
  const unknownPenalty = boardWait === undefined || inVehicleMinutes === undefined ? 10 : 0;
  const goPreferenceBonus = option.key === "kennedy-go-viva" && option.transferWaitMinutes < 15 ? -3 : 0;
  return (boardWait ?? 12) + (inVehicleMinutes ?? 20) + option.transferWaitMinutes + unknownPenalty + goPreferenceBonus;
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
    return `- ${alert.header}${returnText ? ` (${returnText})` : " (return time not published)"}`;
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

  const evaluated = options.map((option) => {
    const destination = stopByPattern(tripStops, option.line5StopPattern) ?? stopByPattern(stations, option.line5StopPattern);
    const inVehicleMinutes = scheduleMinutesBetween(tripStops, fromStop, destination);
    return {
      option,
      destination,
      inVehicleMinutes,
      score: rankOption(option, boardWait, inVehicleMinutes) + disruptions.penalty
    };
  }).sort((a, b) => a.score - b.score);

  const best = evaluated[0];
  const vehicleName = boardingVehicle?.vehicleLabel ?? boardingVehicle?.vehicleId;
  const line5Eta = boardWait === undefined
    ? "No live Line 5 vehicle ETA is available from Eglinton right now."
    : `Board the next eastbound Line 5 vehicle in about **${boardWait} min**${vehicleName ? `: vehicle **${vehicleName}**` : ""}.`;

  const lines = [
    userId ? `<@${userId}> recommended eastbound trip from **Eglinton Station**:` : "Recommended eastbound trip from **Eglinton Station**:",
    `# ${best.option.title}`,
    line5Eta,
    `Ride Line 5 to **${best.option.line5Destination}**${best.inVehicleMinutes !== undefined ? `, about **${best.inVehicleMinutes} min** on board` : ""}.`,
    `Transfer to **${best.option.transfer}**.`,
    `Expected transfer wait: **${displayMinutes(best.option.transferWaitMinutes)}**.`,
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
      `- ${item.option.title}: Line 5 ride ${displayMinutes(item.inVehicleMinutes)}, transfer wait ${displayMinutes(item.option.transferWaitMinutes)}.`
    )
  ].filter(Boolean) as string[];

  const files: AttachmentBuilder[] = [];
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
    lines.push("", "**Line 5 vehicle GIF**", "- Not attached because no live GTFS realtime Line 5 vehicle/trip matched the recommended destination right now.");
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
