import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import NodeCache from "node-cache";
import { config, trackedRouteShortNames } from "./config.js";
import { getLine5FallbackDepartures, getLine5FallbackVehicles, line5DirectionMatches } from "./line5Realtime.js";
import { loadStaticGtfs } from "./staticGtfs.js";
import type { AlertSummary, StaticGtfs, StopTimeInfo, TripStopSummary, VehicleSummary } from "./types.js";

const cache = new NodeCache({ stdTTL: 20, checkperiod: 30 });

const textFromTranslatedString = (value: any): string => {
  const translation = value?.translation?.find((item: any) => item.language === "en")
    ?? value?.translation?.[0];
  return translation?.text ?? "";
};

const enumName = (enumObject: Record<string, unknown>, value: unknown): string | undefined => {
  const found = Object.entries(enumObject).find(([, enumValue]) => enumValue === value);
  return found?.[0];
};

async function fetchRealtimeFeed(url: string): Promise<any> {
  const cached = cache.get<any>(url);
  if (cached) {
    return cached;
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": "ttc-discord-live-bot/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`TTC feed request failed: ${url} ${response.status} ${response.statusText}`);
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);
  cache.set(url, feed);
  return feed;
}

let staticPromise: Promise<StaticGtfs> | undefined;

export function getStaticGtfs(): Promise<StaticGtfs> {
  staticPromise ??= loadStaticGtfs();
  return staticPromise;
}

function nextStaticStop(staticGtfs: StaticGtfs, tripId: string | undefined, currentSequence: number | undefined): StopTimeInfo | undefined {
  if (!tripId) {
    return undefined;
  }
  const stopTimes = staticGtfs.stopTimesByTrip.get(tripId);
  if (!stopTimes?.length) {
    return undefined;
  }
  if (!currentSequence) {
    return stopTimes[0];
  }
  return stopTimes.find((stopTime) => stopTime.stopSequence > currentSequence) ?? stopTimes.at(-1);
}

function realtimeStopUpdate(tripUpdate: any, sequence: number | undefined, fallbackStopId: string | undefined): any {
  const updates = tripUpdate?.stopTimeUpdate ?? [];
  if (sequence) {
    const bySequence = updates.find((update: any) => update.stopSequence === sequence || update.stopSequence > sequence);
    if (bySequence) {
      return bySequence;
    }
  }
  if (fallbackStopId) {
    return updates.find((update: any) => update.stopId === fallbackStopId);
  }
  return updates[0];
}

function stopUpdateTime(stopUpdate: any): number | undefined {
  const raw = stopUpdate?.arrival?.time?.low
    ?? stopUpdate?.arrival?.time
    ?? stopUpdate?.departure?.time?.low
    ?? stopUpdate?.departure?.time;
  return raw === undefined ? undefined : Number(raw);
}

function stopUpdateDelay(stopUpdate: any): number | undefined {
  return stopUpdate?.arrival?.delay ?? stopUpdate?.departure?.delay;
}

async function getVehicleSummaries(options: { routeShortName?: string; trackedOnly: boolean } = { trackedOnly: true }): Promise<VehicleSummary[]> {
  const [staticGtfs, vehicleFeed, tripFeed] = await Promise.all([
    getStaticGtfs(),
    fetchRealtimeFeed(config.TTC_VEHICLE_POSITIONS_URL),
    fetchRealtimeFeed(config.TTC_TRIP_UPDATES_URL)
  ]);

  const tripUpdates = new Map<string, any>();
  for (const entity of tripFeed.entity ?? []) {
    const tripUpdate = entity.tripUpdate;
    const tripId = tripUpdate?.trip?.tripId;
    if (tripId) {
      tripUpdates.set(tripId, tripUpdate);
    }
  }

  const trackedRouteIds = new Set(
    [...staticGtfs.routes.values()]
      .filter((route) => trackedRouteShortNames.has(route.shortName))
      .map((route) => route.id)
  );

  const routeFilter = options.routeShortName ? staticGtfs.routesByShortName.get(options.routeShortName) : undefined;
  const vehicles: VehicleSummary[] = [];

  for (const entity of vehicleFeed.entity ?? []) {
    const vehicle = entity.vehicle;
    const trip = vehicle?.trip;
    const position = vehicle?.position;
    const routeId = trip?.routeId;
    if (!routeId || (options.trackedOnly && !trackedRouteIds.has(routeId))) {
      continue;
    }
    if (routeFilter && routeFilter.id !== routeId) {
      continue;
    }

    const route = staticGtfs.routes.get(routeId);
    const tripInfo = trip?.tripId ? staticGtfs.trips.get(trip.tripId) : undefined;
    const currentStop = vehicle.currentStopSequence
      ? staticGtfs.stopTimesByTrip.get(trip?.tripId ?? "")?.find((stopTime) => stopTime.stopSequence === vehicle.currentStopSequence)
      : undefined;
    const fallbackNextStop = nextStaticStop(staticGtfs, trip?.tripId, vehicle.currentStopSequence);
    const tripUpdate = trip?.tripId ? tripUpdates.get(trip.tripId) : undefined;
    const stopUpdate = realtimeStopUpdate(tripUpdate, vehicle.currentStopSequence, fallbackNextStop?.stopId);
    const nextStopId = stopUpdate?.stopId || fallbackNextStop?.stopId;
    const etaSeconds = stopUpdateTime(stopUpdate);

    vehicles.push({
      vehicleId: vehicle.vehicle?.id ?? entity.id,
      vehicleLabel: vehicle.vehicle?.label,
      routeId,
      routeName: route ? `${route.shortName} ${route.longName}`.trim() : routeId,
      routeShortName: route?.shortName,
      tripId: trip?.tripId,
      headsign: tripInfo?.headsign || trip?.scheduleRelationship,
      latitude: position?.latitude,
      longitude: position?.longitude,
      bearing: position?.bearing,
      speedKmh: typeof position?.speed === "number" ? position.speed * 3.6 : undefined,
      currentStatus: enumName(GtfsRealtimeBindings.transit_realtime.VehiclePosition.VehicleStopStatus, vehicle.currentStatus),
      currentStopSequence: vehicle.currentStopSequence,
      currentStop: currentStop ? staticGtfs.stops.get(currentStop.stopId)?.name : undefined,
      nextStopId,
      nextStop: nextStopId ? staticGtfs.stops.get(nextStopId)?.name : undefined,
      scheduledTime: fallbackNextStop?.arrivalTime || fallbackNextStop?.departureTime,
      eta: etaSeconds ? new Date(Number(etaSeconds) * 1000) : undefined,
      delaySeconds: stopUpdateDelay(stopUpdate),
      updatedAt: vehicle.timestamp ? new Date(Number(vehicle.timestamp.low ?? vehicle.timestamp) * 1000) : undefined
    });
  }

  return vehicles.sort((a, b) => a.routeName.localeCompare(b.routeName) || a.vehicleId.localeCompare(b.vehicleId));
}

export async function getVehicles(routeShortName?: string): Promise<VehicleSummary[]> {
  const vehicles = await getVehicleSummaries({ routeShortName, trackedOnly: !routeShortName });
  if (routeShortName === "5" && !vehicles.length) {
    const stations = await getLine5Stations();
    const transsee = await getLine5FallbackVehicles(stations).catch(() => []);
    if (transsee.length) {
      return transsee;
    }
    // Honest degradation: no live Line 5 vehicles -> show next scheduled trains in
    // both directions from the central Eglinton interchange so the command is useful.
    const hub = stations.find((station) => /eglinton/i.test(station.stopName))
      ?? stations[Math.floor(stations.length / 2)];
    if (hub) {
      const [eastbound, westbound] = await Promise.all([
        getLine5ScheduleDepartures(hub.stopId, "eastbound", 3),
        getLine5ScheduleDepartures(hub.stopId, "westbound", 3)
      ]);
      return [...eastbound, ...westbound]
        .sort((a, b) => (a.eta?.getTime() ?? Infinity) - (b.eta?.getTime() ?? Infinity));
    }
  }
  return vehicles;
}

function distanceMeters(a: { lat?: number; lon?: number }, b: { lat?: number; lon?: number }): number {
  if (a.lat === undefined || a.lon === undefined || b.lat === undefined || b.lon === undefined) {
    return Infinity;
  }
  const radius = 6371000;
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

export type LiveDepartureSummary = {
  routeShortName: string;
  routeName: string;
  stopId: string;
  stopName: string;
  tripId?: string;
  headsign?: string;
  vehicleLabel?: string;
  eta?: Date;
  waitMinutes?: number;
  delaySeconds?: number;
  source: "gtfs-realtime";
};

export type NearbyVehicleSummary = {
  routeShortName: string;
  vehicleLabel: string;
  distanceMeters: number;
  latitude?: number;
  longitude?: number;
  bearing?: number;
  currentStatus?: string;
  updatedAt?: Date;
};

function bearingMatches(bearing: number | undefined, direction: "northbound" | "southbound" | "eastbound" | "westbound" | undefined): boolean {
  if (bearing === undefined || !direction) {
    return true;
  }
  if (direction === "northbound") {
    return bearing >= 315 || bearing <= 45;
  }
  if (direction === "southbound") {
    return bearing >= 135 && bearing <= 225;
  }
  if (direction === "eastbound") {
    return bearing >= 45 && bearing <= 135;
  }
  return bearing >= 225 && bearing <= 315;
}

export async function getLiveVehiclesNearStop(options: {
  routeShortName: string;
  anchorStopPattern: RegExp;
  headsignPattern?: RegExp;
  branchStopPattern?: RegExp;
  direction?: "northbound" | "southbound" | "eastbound" | "westbound";
  radiusMeters?: number;
  limit?: number;
}): Promise<NearbyVehicleSummary[]> {
  const [staticGtfs, tripFeed, vehicles] = await Promise.all([
    getStaticGtfs(),
    fetchRealtimeFeed(config.TTC_TRIP_UPDATES_URL),
    getVehicleSummaries({ routeShortName: options.routeShortName, trackedOnly: false })
  ]);
  const anchor = [...staticGtfs.stops.values()].find((stop) => options.anchorStopPattern.test(stop.name));
  if (!anchor) {
    return [];
  }
  const branchTripIds = new Set<string>();
  if (options.branchStopPattern) {
    for (const entity of tripFeed.entity ?? []) {
      const tripUpdate = entity.tripUpdate;
      const trip = tripUpdate?.trip;
      if (String(trip?.routeId ?? "") !== options.routeShortName || !trip.tripId) {
        continue;
      }
      const hasBranchStop = (tripUpdate.stopTimeUpdate ?? []).some((item: any) => {
        const stop = staticGtfs.stops.get(String(item.stopId));
        return stop ? options.branchStopPattern?.test(stop.name) : false;
      });
      if (hasBranchStop) {
        branchTripIds.add(trip.tripId);
      }
    }
  }

  return vehicles
    .filter((vehicle) => {
      if (vehicle.latitude === undefined || vehicle.longitude === undefined) {
        return false;
      }
      if (!options.headsignPattern) {
        return !options.branchStopPattern || (vehicle.tripId ? branchTripIds.has(vehicle.tripId) : false);
      }
      const tripInfo = vehicle.tripId ? staticGtfs.trips.get(vehicle.tripId) : undefined;
      return options.headsignPattern.test(tripInfo?.headsign ?? vehicle.headsign ?? "")
        || (!!options.branchStopPattern && !!vehicle.tripId && branchTripIds.has(vehicle.tripId));
    })
    .map((vehicle) => ({
      vehicle,
      distance: distanceMeters(anchor, { lat: vehicle.latitude, lon: vehicle.longitude })
    }))
    .filter((item) => item.distance <= (options.radiusMeters ?? 900) && bearingMatches(item.vehicle.bearing, options.direction))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, options.limit ?? 3)
    .map((item) => ({
      routeShortName: options.routeShortName,
      vehicleLabel: item.vehicle.vehicleLabel ?? item.vehicle.vehicleId,
      distanceMeters: Math.round(item.distance),
      latitude: item.vehicle.latitude,
      longitude: item.vehicle.longitude,
      bearing: item.vehicle.bearing,
      currentStatus: item.vehicle.currentStatus,
      updatedAt: item.vehicle.updatedAt
    }));
}

export async function getLiveDeparturesNearStop(options: {
  routeShortName: string;
  anchorStopPattern: RegExp;
  headsignPattern?: RegExp;
  branchStopPattern?: RegExp;
  radiusMeters?: number;
  limit?: number;
}): Promise<LiveDepartureSummary[]> {
  const [staticGtfs, tripFeed, vehicles] = await Promise.all([
    getStaticGtfs(),
    fetchRealtimeFeed(config.TTC_TRIP_UPDATES_URL),
    getVehicleSummaries({ routeShortName: options.routeShortName, trackedOnly: false })
  ]);
  const route = staticGtfs.routesByShortName.get(options.routeShortName);
  if (!route) {
    return [];
  }
  const anchor = [...staticGtfs.stops.values()].find((stop) => options.anchorStopPattern.test(stop.name));
  if (!anchor) {
    return [];
  }

  const routeStopIds = new Set<string>();
  for (const trip of staticGtfs.trips.values()) {
    if (trip.routeId !== route.id) {
      continue;
    }
    if (options.headsignPattern && !options.headsignPattern.test(trip.headsign ?? "")) {
      continue;
    }
    for (const stopTime of staticGtfs.stopTimesByTrip.get(trip.id) ?? []) {
      const stop = staticGtfs.stops.get(stopTime.stopId);
      if (stop && distanceMeters(anchor, stop) <= (options.radiusMeters ?? 550)) {
        routeStopIds.add(stop.id);
      }
    }
  }
  if (!routeStopIds.size) {
    return [];
  }

  const vehicleByTrip = new Map(vehicles.filter((vehicle) => vehicle.tripId).map((vehicle) => [vehicle.tripId, vehicle]));
  const nowSeconds = Date.now() / 1000;
  const departures: LiveDepartureSummary[] = [];
  for (const entity of tripFeed.entity ?? []) {
    const tripUpdate = entity.tripUpdate;
    const trip = tripUpdate?.trip;
    if (trip?.routeId !== route.id || !trip.tripId) {
      continue;
    }
    const tripInfo = staticGtfs.trips.get(trip.tripId);
    if (options.headsignPattern && !options.headsignPattern.test(tripInfo?.headsign ?? "")) {
      const hasBranchStop = options.branchStopPattern
        ? (tripUpdate.stopTimeUpdate ?? []).some((item: any) => {
          const stop = staticGtfs.stops.get(String(item.stopId));
          return stop ? options.branchStopPattern?.test(stop.name) : false;
        })
        : false;
      if (!hasBranchStop) {
        continue;
      }
    }
    if (!options.headsignPattern && options.branchStopPattern) {
      const hasBranchStop = (tripUpdate.stopTimeUpdate ?? []).some((item: any) => {
        const stop = staticGtfs.stops.get(String(item.stopId));
        return stop ? options.branchStopPattern?.test(stop.name) : false;
      });
      if (!hasBranchStop) {
        continue;
      }
    }
    if (!tripInfo && options.headsignPattern && !options.branchStopPattern) {
      continue;
    }
    const update = (tripUpdate.stopTimeUpdate ?? [])
      .filter((item: any) => routeStopIds.has(item.stopId))
      .map((item: any) => ({
        item,
        time: stopUpdateTime(item)
      }))
      .filter((item: any) => item.time && item.time >= nowSeconds - 60)
      .sort((a: any, b: any) => a.time - b.time)[0];
    if (!update) {
      continue;
    }
    const stop = staticGtfs.stops.get(update.item.stopId);
    const eta = new Date(update.time * 1000);
    const vehicle = vehicleByTrip.get(trip.tripId);
    departures.push({
      routeShortName: route.shortName,
      routeName: `${route.shortName} ${route.longName}`.trim(),
      stopId: update.item.stopId,
      stopName: stop?.name ?? update.item.stopId,
      tripId: trip.tripId,
      headsign: tripInfo?.headsign,
      vehicleLabel: vehicle?.vehicleLabel ?? vehicle?.vehicleId,
      eta,
      waitMinutes: Math.max(0, Math.round((eta.getTime() - Date.now()) / 60000)),
      delaySeconds: stopUpdateDelay(update.item),
      source: "gtfs-realtime"
    });
  }

  return departures
    .sort((a, b) => (a.eta?.getTime() ?? Infinity) - (b.eta?.getTime() ?? Infinity))
    .slice(0, options.limit ?? 3);
}

export async function findVehicleByNumber(vehicleNumber: string): Promise<VehicleSummary | undefined> {
  const normalized = vehicleNumber.trim().toLowerCase();
  const vehicles = await getVehicleSummaries({ trackedOnly: false });
  return vehicles.find((vehicle) =>
    vehicle.vehicleId.toLowerCase() === normalized
    || vehicle.vehicleLabel?.toLowerCase() === normalized
  );
}

export async function getTripStops(tripId: string): Promise<TripStopSummary[]> {
  const staticGtfs = await getStaticGtfs();
  const stopTimes = staticGtfs.stopTimesByTrip.get(tripId) ?? [];
  return stopTimes.map((stopTime) => ({
    stopId: stopTime.stopId,
    stopName: staticGtfs.stops.get(stopTime.stopId)?.name ?? stopTime.stopId,
    stopSequence: stopTime.stopSequence,
    scheduledTime: stopTime.arrivalTime || stopTime.departureTime
  }));
}

export async function getLine5Stations(): Promise<TripStopSummary[]> {
  const staticGtfs = await getStaticGtfs();
  const line5 = staticGtfs.routesByShortName.get("5");
  if (!line5) {
    return [];
  }
  const trip = [...staticGtfs.trips.values()].find((item) => item.routeId === line5.id);
  if (!trip) {
    return [];
  }
  const seen = new Set<string>();
  return (staticGtfs.stopTimesByTrip.get(trip.id) ?? [])
    .map((stopTime) => ({
      stopId: stopTime.stopId,
      stopName: staticGtfs.stops.get(stopTime.stopId)?.name ?? stopTime.stopId,
      stopSequence: stopTime.stopSequence,
      scheduledTime: stopTime.arrivalTime || stopTime.departureTime
    }))
    .filter((stop) => {
      if (seen.has(stop.stopId)) {
        return false;
      }
      seen.add(stop.stopId);
      return true;
    });
  // NOTE: full station list is returned intentionally. The 25-option cap for
  // Discord StringSelectMenu is applied at the call site (index.ts), not here,
  // so the non-menu consumers (fallback name resolution, trip recommendations,
  // schedule departures, route map) get the complete route.
}

// --- Schedule-grounded Line 5 departures (static GTFS) --------------------
// There is no official realtime feed for Line 5 (verified). This computes the
// next scheduled trains from the static GTFS, so the bot ALWAYS has honest
// departure data - including "first train at HH:MM" when service is not running
// (e.g. overnight). Treated as a daily-repeating schedule, which matches how
// Line 5 actually runs.

function torontoSecondsOfDay(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const hour = get("hour") % 24;
  return hour * 3600 + get("minute") * 60 + get("second");
}

function parseGtfsTimeToSeconds(value: string | undefined): number | undefined {
  const match = value?.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!match) {
    return undefined;
  }
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function formatGtfsClock(totalSeconds: number): string {
  const normalized = ((totalSeconds % 86400) + 86400) % 86400;
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export async function getLine5ScheduleDepartures(
  stopId: string,
  direction: "eastbound" | "westbound",
  limit = 6
): Promise<VehicleSummary[]> {
  const staticGtfs = await getStaticGtfs();
  const route = staticGtfs.routesByShortName.get("5");
  if (!route) {
    return [];
  }
  const stationName = staticGtfs.stops.get(stopId)?.name ?? stopId;
  const nowSeconds = torontoSecondsOfDay();

  // TTC Line 5 stops are per-platform (e.g. "Eglinton Station Eastbound Platform"),
  // so a westbound train never stops at the eastbound platform's stopId. Resolve
  // all sibling platform stopIds for this station so the requested direction works
  // regardless of which platform the caller passed.
  const baseName = (staticGtfs.stops.get(stopId)?.name ?? stopId)
    .replace(/\s+(Eastbound|Westbound|East|West)\s+Platform$/i, "")
    .replace(/\s+LRT\s+Platform$/i, "")
    .replace(/\s+Platform$/i, "")
    .replace(/\s+Station$/i, "")
    .trim()
    .toLowerCase();
  const siblingStopIds = new Set<string>([stopId]);
  for (const stop of staticGtfs.stops.values()) {
    const normalized = stop.name
      .replace(/\s+(Eastbound|Westbound|East|West)\s+Platform$/i, "")
      .replace(/\s+LRT\s+Platform$/i, "")
      .replace(/\s+Platform$/i, "")
      .replace(/\s+Station$/i, "")
      .trim()
      .toLowerCase();
    if (normalized && normalized === baseName) {
      siblingStopIds.add(stop.id);
    }
  }

  const seenTimes = new Set<number>();
  const candidates: { timeSeconds: number; headsign?: string; tripId: string }[] = [];
  for (const trip of staticGtfs.trips.values()) {
    if (trip.routeId !== route.id) {
      continue;
    }
    if (!line5DirectionMatches(trip.headsign, direction)) {
      continue;
    }
    const stopTime = (staticGtfs.stopTimesByTrip.get(trip.id) ?? []).find((item) => siblingStopIds.has(item.stopId));
    const seconds = parseGtfsTimeToSeconds(stopTime?.departureTime || stopTime?.arrivalTime);
    if (seconds === undefined || seenTimes.has(seconds)) {
      continue;
    }
    seenTimes.add(seconds);
    candidates.push({ timeSeconds: seconds, headsign: trip.headsign, tripId: trip.id });
  }
  if (!candidates.length) {
    return [];
  }

  const now = Date.now();
  return candidates
    .map((candidate) => {
      const timeOfDay = ((candidate.timeSeconds % 86400) + 86400) % 86400;
      let waitSeconds = timeOfDay - nowSeconds;
      if (waitSeconds < -60) {
        waitSeconds += 86400; // next service day
      }
      return { ...candidate, timeOfDay, waitSeconds };
    })
    .sort((a, b) => a.waitSeconds - b.waitSeconds)
    .slice(0, limit)
    .map((candidate) => ({
      vehicleId: "scheduled",
      vehicleLabel: undefined,
      routeId: "5",
      routeName: "5 Line 5 Eglinton",
      routeShortName: "5",
      headsign: candidate.headsign ?? (direction === "eastbound" ? "Kennedy" : "Mount Dennis"),
      nextStopId: stopId,
      nextStop: stationName,
      scheduledTime: formatGtfsClock(candidate.timeOfDay),
      eta: new Date(now + candidate.waitSeconds * 1000),
      waitMinutes: Math.max(0, Math.round(candidate.waitSeconds / 60)),
      currentStatus: "SCHEDULED",
      source: "schedule" as const
    }));
}

export type Line5ServiceHours = {
  firstTrain?: string;
  lastTrain?: string;
  stopCount: number;
  inService: boolean;
};

// First/last train and service span for Line 5, computed from the static GTFS
// stop_times for route 5. Treated as a daily-repeating schedule (matches how the
// line actually runs). "inService" reflects whether the current Toronto time falls
// within the first->last window.
export async function getLine5ServiceHours(): Promise<Line5ServiceHours> {
  const staticGtfs = await getStaticGtfs();
  const route = staticGtfs.routesByShortName.get("5");
  if (!route) {
    return { stopCount: 0, inService: false };
  }
  let earliest = Infinity;
  let latest = -Infinity;
  for (const trip of staticGtfs.trips.values()) {
    if (trip.routeId !== route.id) {
      continue;
    }
    for (const stopTime of staticGtfs.stopTimesByTrip.get(trip.id) ?? []) {
      const seconds = parseGtfsTimeToSeconds(stopTime.departureTime || stopTime.arrivalTime);
      if (seconds === undefined) {
        continue;
      }
      earliest = Math.min(earliest, seconds);
      latest = Math.max(latest, seconds);
    }
  }
  const stations = await getLine5Stations();
  if (!Number.isFinite(earliest) || !Number.isFinite(latest)) {
    return { stopCount: stations.length, inService: false };
  }
  const nowSeconds = torontoSecondsOfDay();
  // GTFS times can roll past 24:00 (e.g. 25:30 = 01:30 next day). Compare against a
  // normalized window: a train is "in service" if now is between the first train and
  // last train, accounting for post-midnight wrap.
  const inService = latest >= 86400
    ? nowSeconds >= earliest || nowSeconds <= (latest - 86400)
    : nowSeconds >= earliest && nowSeconds <= latest;
  return {
    firstTrain: formatGtfsClock(earliest),
    lastTrain: formatGtfsClock(latest),
    stopCount: stations.length,
    inService
  };
}

// Resolve the central Eglinton (Yonge) interchange Line 5 stopId, preferring the
// plain "Eglinton" station over "Eglinton West"/"Cedarvale". Used by /ttc-line5-status
// as the reference point for next-train data. The schedule fallback resolves sibling
// platform stopIds per direction, so either platform's stopId works for both directions.
export async function getLine5EglintonStopId(): Promise<{ stopId: string; stopName: string } | undefined> {
  const stations = await getLine5Stations();
  const eglinton = stations.filter((station) => /eglinton/i.test(station.stopName) && !/west/i.test(station.stopName));
  const pick = eglinton.find((station) => /^eglinton(\s+station)?\b/i.test(station.stopName.trim()))
    ?? eglinton[0]
    ?? stations.find((station) => /eglinton/i.test(station.stopName))
    ?? stations[Math.floor(stations.length / 2)];
  return pick ? { stopId: pick.stopId, stopName: pick.stopName } : undefined;
}

export async function getLine5Departures(stopId: string, direction: "eastbound" | "westbound"): Promise<VehicleSummary[]> {
  const [vehicles, tripFeed] = await Promise.all([
    getVehicleSummaries({ routeShortName: "5", trackedOnly: true }),
    fetchRealtimeFeed(config.TTC_TRIP_UPDATES_URL)
  ]);
  const tripUpdates = new Map<string, any>();
  for (const entity of tripFeed.entity ?? []) {
    const tripUpdate = entity.tripUpdate;
    const tripId = tripUpdate?.trip?.tripId;
    if (tripId) {
      tripUpdates.set(tripId, tripUpdate);
    }
  }

  const matches: VehicleSummary[] = [];
  for (const vehicle of vehicles) {
    if (!vehicle.tripId) {
      continue;
    }
    const stops = await getTripStops(vehicle.tripId);
    const target = stops.find((stop) => stop.stopId === stopId);
    if (!target) {
      continue;
    }
    if (!line5DirectionMatches(vehicle.headsign, direction)) {
      continue;
    }
    const current = vehicle.currentStopSequence ?? 0;
    if (current <= target.stopSequence) {
      const tripUpdate = tripUpdates.get(vehicle.tripId);
      const targetUpdate = realtimeStopUpdate(tripUpdate, target.stopSequence, stopId);
      const targetEta = stopUpdateTime(targetUpdate);
      matches.push({
        ...vehicle,
        eta: targetEta ? new Date(targetEta * 1000) : vehicle.eta,
        delaySeconds: stopUpdateDelay(targetUpdate) ?? vehicle.delaySeconds,
        nextStopId: stopId,
        nextStop: target.stopName,
        scheduledTime: target.scheduledTime
      });
    }
  }
  const realtimeMatches = matches
    .map((vehicle) => ({ ...vehicle, source: vehicle.source ?? ("gtfs-realtime" as const) }))
    .sort((a, b) => (a.eta?.getTime() ?? Infinity) - (b.eta?.getTime() ?? Infinity))
    .slice(0, 6);
  if (realtimeMatches.length) {
    return realtimeMatches;
  }

  // No official realtime for Line 5. Try the TransSee proxy of the hidden TTC
  // arrival API; if that is empty too (e.g. outside service hours), fall back to
  // the static schedule so riders always get an honest next-train answer.
  try {
    const transsee = await getLine5FallbackDepartures(stopId, direction, await getLine5Stations());
    if (transsee.length) {
      return transsee;
    }
  } catch (error) {
    console.error("[line5] TransSee fallback failed, using schedule", error);
  }
  return getLine5ScheduleDepartures(stopId, direction);
}

export async function getAlerts(): Promise<AlertSummary[]> {
  const [staticGtfs, alertFeed] = await Promise.all([
    getStaticGtfs(),
    fetchRealtimeFeed(config.TTC_ALERTS_URL)
  ]);

  const alerts: AlertSummary[] = [];
  for (const entity of alertFeed.entity ?? []) {
    const alert = entity.alert;
    if (!alert) {
      continue;
    }
    const affectedRoutes = new Set<string>();
    for (const informed of alert.informedEntity ?? []) {
      if (informed.routeId) {
        const route = staticGtfs.routes.get(informed.routeId);
        affectedRoutes.add(route ? `${route.shortName} ${route.longName}`.trim() : informed.routeId);
      }
    }

    alerts.push({
      id: entity.id,
      header: textFromTranslatedString(alert.headerText) || "TTC alert",
      description: textFromTranslatedString(alert.descriptionText),
      affectedRoutes: [...affectedRoutes],
      activePeriods: (alert.activePeriod ?? []).map((period: any) => {
        const start = period.start ? new Date(Number(period.start.low ?? period.start) * 1000).toLocaleString("en-CA", { timeZone: "America/Toronto" }) : "now";
        const end = period.end ? new Date(Number(period.end.low ?? period.end) * 1000).toLocaleString("en-CA", { timeZone: "America/Toronto" }) : "until further notice";
        return `${start} to ${end}`;
      }),
      effect: enumName(GtfsRealtimeBindings.transit_realtime.Alert.Effect, alert.effect),
      cause: enumName(GtfsRealtimeBindings.transit_realtime.Alert.Cause, alert.cause),
      severity: enumName(GtfsRealtimeBindings.transit_realtime.Alert.SeverityLevel, alert.severityLevel)
    });
  }

  return alerts;
}
