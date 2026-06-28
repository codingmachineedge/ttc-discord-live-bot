import NodeCache from "node-cache";
import { config } from "./config.js";
import type { TripStopSummary, VehicleSummary } from "./types.js";

const cache = new NodeCache({ stdTTL: 20, checkperiod: 30 });

type ParsedLine5Vehicle = {
  vehicleId: string;
  headsign?: string;
  nextStop?: string;
  latitude?: number;
  longitude?: number;
};

type ParsedLine5Prediction = ParsedLine5Vehicle & {
  eta?: Date;
  waitMinutes?: number;
};

async function fetchText(url: string): Promise<string> {
  const cached = cache.get<string>(url);
  if (cached) {
    return cached;
  }
  const response = await fetch(url, {
    headers: {
      "User-Agent": "ttc-discord-live-bot/0.1 (+Line 5 realtime fallback)"
    }
  });
  if (!response.ok) {
    throw new Error(`Line 5 realtime fallback request failed: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  cache.set(url, text);
  return text;
}

function stripTags(value: string): string {
  return value
    .replaceAll("&rarr;", "eastbound")
    .replaceAll("&larr;", "westbound")
    .replaceAll("&nbsp;", " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStationName(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value
    .replace(/^aprchg\s+/i, "")
    .replace(/\s+Platform$/i, "")
    .trim();
}

function directionMatches(headsign: string | undefined, direction?: "eastbound" | "westbound"): boolean {
  if (!direction || !headsign) {
    return true;
  }
  return direction === "eastbound"
    ? /kennedy/i.test(headsign)
    : /mount dennis/i.test(headsign);
}

function stationSequence(stations: TripStopSummary[], stationName: string | undefined): number | undefined {
  if (!stationName) {
    return undefined;
  }
  const compact = stationName.replace(/\s+Station$/i, "").toLowerCase();
  return stations.find((station) =>
    station.stopName.toLowerCase().includes(compact)
  )?.stopSequence;
}

function parseMarkers(html: string): Map<string, { latitude: number; longitude: number }> {
  const markers = new Map<string, { latitude: number; longitude: number }>();
  const pattern = /AddMarker\(\[(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\],[\s\S]*?Vehicle\s*<a href=['"]#(\d+)['"]/g;
  for (const match of html.matchAll(pattern)) {
    markers.set(match[3], {
      latitude: Number(match[1]),
      longitude: Number(match[2])
    });
  }
  return markers;
}

function parseRouteVehicles(html: string): ParsedLine5Vehicle[] {
  const markers = parseMarkers(html);
  const vehicles: ParsedLine5Vehicle[] = [];
  const pattern = /<p id="(\d+)">Vehicle\s*<a[\s\S]*?<\/a>\s*going\s*([\s\S]*?)<a rel=nofollow[\s\S]*?<br>(aprchg\s+[^<]+)[\s\S]*?<\/p>/g;
  for (const match of html.matchAll(pattern)) {
    const vehicleId = match[1];
    const headsign = stripTags(match[2]);
    const marker = markers.get(vehicleId);
    vehicles.push({
      vehicleId,
      headsign,
      nextStop: normalizeStationName(stripTags(match[3])),
      latitude: marker?.latitude,
      longitude: marker?.longitude
    });
  }
  return vehicles;
}

function parsePredictions(html: string): ParsedLine5Prediction[] {
  const markers = parseMarkers(html);
  const predictions: ParsedLine5Prediction[] = [];
  const header = stripTags(html.match(/<p id="5_\d+">([\s\S]*?)<\/p>/)?.[1] ?? "");
  const headsign = header.match(/going\s+(.*)$/i)?.[1]?.trim();
  const pattern = /<div class=divp id="5_\d+_\d+">([\s\S]*?)<\/div>/g;
  for (const match of html.matchAll(pattern)) {
    const block = match[1];
    const timeRaw = block.match(/<time class=timedisp datetime="([^"]+)"/)?.[1];
    const vehicleId = block.match(/Vehicle\s*<a[^>]*>(\d+)<\/a>/)?.[1];
    const waitRaw = block.match(/data-minute>(\d+)<\/span>/)?.[1];
    const approach = normalizeStationName(stripTags(block.match(/<br>(aprchg\s+[^<]+)/)?.[1] ?? ""));
    if (!vehicleId) {
      continue;
    }
    const marker = markers.get(vehicleId);
    predictions.push({
      vehicleId,
      headsign,
      nextStop: approach,
      latitude: marker?.latitude,
      longitude: marker?.longitude,
      eta: timeRaw ? new Date(timeRaw) : undefined,
      waitMinutes: waitRaw ? Number(waitRaw) : undefined
    });
  }
  return predictions;
}

function toVehicleSummary(vehicle: ParsedLine5Vehicle | ParsedLine5Prediction, stations: TripStopSummary[], updatedAt: Date): VehicleSummary {
  const nextStopSequence = stationSequence(stations, vehicle.nextStop);
  return {
    vehicleId: vehicle.vehicleId,
    vehicleLabel: vehicle.vehicleId,
    routeId: "5",
    routeName: "5 Line 5 Eglinton",
    routeShortName: "5",
    headsign: vehicle.headsign,
    latitude: vehicle.latitude,
    longitude: vehicle.longitude,
    currentStatus: "IN_TRANSIT_TO",
    nextStop: vehicle.nextStop,
    currentStopSequence: nextStopSequence ? Math.max(0, nextStopSequence - 1) : undefined,
    nextStopId: nextStopSequence ? stations.find((station) => station.stopSequence === nextStopSequence)?.stopId : undefined,
    eta: "eta" in vehicle ? vehicle.eta : undefined,
    delaySeconds: undefined,
    updatedAt
  };
}

export async function getLine5FallbackVehicles(stations: TripStopSummary[]): Promise<VehicleSummary[]> {
  const html = await fetchText(config.TRANSSEE_LINE5_ROUTE_VEHICLES_URL);
  const updatedAt = new Date();
  return parseRouteVehicles(html).map((vehicle) => toVehicleSummary(vehicle, stations, updatedAt));
}

export async function getLine5FallbackDepartures(stopId: string, direction: "eastbound" | "westbound", stations: TripStopSummary[]): Promise<VehicleSummary[]> {
  const url = config.TRANSSEE_LINE5_PREDICT_URL_TEMPLATE.replace("{stopId}", encodeURIComponent(stopId));
  const html = await fetchText(url);
  const updatedAt = new Date();
  return parsePredictions(html)
    .filter((prediction) => directionMatches(prediction.headsign, direction))
    .map((prediction) => {
      const summary = toVehicleSummary(prediction, stations, updatedAt);
      summary.nextStopId = stopId;
      summary.nextStop = stations.find((station) => station.stopId === stopId)?.stopName ?? summary.nextStop;
      return summary;
    })
    .sort((a, b) => (a.eta?.getTime() ?? Infinity) - (b.eta?.getTime() ?? Infinity))
    .slice(0, 6);
}
