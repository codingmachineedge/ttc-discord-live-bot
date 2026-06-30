import NodeCache from "node-cache";
import { config } from "./config.js";

// Metrolinx Open Data API client (GO Transit / UP Express).
//
// IMPORTANT: There is NO official realtime feed for Line 5 Eglinton (or any
// TTC subway/LRT line) - verified against TTC, umoiq/NextBus and Metrolinx.
// This client does NOT provide Line 5 vehicle data. What it DOES provide is
// connecting GO Transit service at Line 5 interchange stations (Mount Dennis ->
// Kitchener line, Kennedy -> Stouffville / Lakeshore East), which is genuinely
// useful context for Line 5 riders. The real API key lives in the docker host
// .env only (config.METROLINX_API_KEY); when unset, every call no-ops cleanly.

const cache = new NodeCache({ stdTTL: 30, checkperiod: 45 });
const stopListCache = new NodeCache({ stdTTL: 6 * 60 * 60, checkperiod: 60 * 60 });

export function isMetrolinxConfigured(): boolean {
  return Boolean(config.METROLINX_API_KEY);
}

function withKey(path: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${config.METROLINX_API_BASE}${path}${sep}key=${encodeURIComponent(config.METROLINX_API_KEY)}`;
}

async function getJson<T>(path: string, ttlKey: string): Promise<T | undefined> {
  if (!isMetrolinxConfigured()) {
    return undefined;
  }
  const cached = cache.get<T>(ttlKey);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const response = await fetch(withKey(path), {
      headers: { "User-Agent": "ttc-discord-live-bot/0.2 (Metrolinx GO connections)" }
    });
    if (!response.ok) {
      console.error(`Metrolinx request failed: ${path} ${response.status} ${response.statusText}`);
      return undefined;
    }
    const data = (await response.json()) as T;
    cache.set(ttlKey, data);
    return data;
  } catch (error) {
    console.error(`Metrolinx request error: ${path}`, error);
    return undefined;
  }
}

export type GoServiceSummary = {
  status: "running" | "no-service" | "unavailable";
  activeTrips: number;
  asOf?: string;
};

// Network-wide GO train service glance. ErrorCode 204 means no active trips
// (e.g. overnight), which is "no-service", not a failure.
export async function getGoServiceSummary(): Promise<GoServiceSummary> {
  if (!isMetrolinxConfigured()) {
    return { status: "unavailable", activeTrips: 0 };
  }
  const data = await getJson<{ Metadata?: { TimeStamp?: string; ErrorCode?: string }; Trips?: unknown[] | null }>(
    "/ServiceataGlance/Trains/All",
    "go-glance"
  );
  if (!data) {
    return { status: "unavailable", activeTrips: 0 };
  }
  const trips = Array.isArray(data.Trips) ? data.Trips : [];
  const code = data.Metadata?.ErrorCode;
  return {
    status: trips.length ? "running" : (code === "204" || code === "200" ? "no-service" : "unavailable"),
    activeTrips: trips.length,
    asOf: data.Metadata?.TimeStamp
  };
}

type GoStop = { LocationCode: string; LocationName: string; LocationType?: string };

async function resolveGoStopCode(name: string): Promise<GoStop | undefined> {
  if (!isMetrolinxConfigured()) {
    return undefined;
  }
  const cached = stopListCache.get<GoStop[]>("stops");
  let stops = cached;
  if (!stops) {
    const data = await getJson<{ Stations?: { Station?: GoStop[] } }>("/Stop/All", "go-stops");
    stops = data?.Stations?.Station ?? [];
    stopListCache.set("stops", stops);
  }
  const needle = name.toLowerCase();
  const matches = stops.filter((stop) => stop.LocationName?.toLowerCase().includes(needle));
  // Prefer the GO rail station (name ends with "GO") over nearby bus stops.
  return matches.find((stop) => /\bgo\b\s*$/i.test(stop.LocationName))
    ?? matches.find((stop) => stop.LocationType?.toLowerCase().includes("train"))
    ?? matches[0];
}

export type GoDeparture = {
  line: string;
  destination: string;
  scheduledTime?: string;
  computedDepartureTime?: string;
  platform?: string;
  status?: string;
};

// Upcoming GO departures at a named station (resolved to a GO LocationCode).
export async function getGoDeparturesNear(stationName: string): Promise<GoDeparture[]> {
  const stop = await resolveGoStopCode(stationName);
  if (!stop) {
    return [];
  }
  const data = await getJson<any>(`/Stop/NextService/${encodeURIComponent(stop.LocationCode)}`, `go-next-${stop.LocationCode}`);
  const lines = data?.NextService?.Lines ?? data?.Lines ?? [];
  if (!Array.isArray(lines)) {
    return [];
  }
  return lines.slice(0, 6).map((line: any) => ({
    line: String(line.LineCode ?? line.Code ?? "GO"),
    destination: String(line.LineName ?? line.DirectionName ?? line.Direction ?? "GO Transit"),
    scheduledTime: line.ScheduledDepartureTime ?? line.ScheduledTime,
    computedDepartureTime: line.ComputedDepartureTime ?? line.ActualDepartureTime,
    platform: line.ScheduledPlatform ?? line.ActualPlatform,
    status: line.Status
  }));
}
