import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import NodeCache from "node-cache";
import { config, trackedRouteShortNames } from "./config.js";
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
  return getVehicleSummaries({ routeShortName, trackedOnly: true });
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
    })
    .slice(0, 25);
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
    const headsign = vehicle.headsign?.toLowerCase() ?? "";
    const directionMatches = direction === "eastbound"
      ? /east|kennedy/.test(headsign)
      : /west|mount dennis/.test(headsign);
    if (!directionMatches && headsign) {
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
  return matches.sort((a, b) => (a.eta?.getTime() ?? Infinity) - (b.eta?.getTime() ?? Infinity)).slice(0, 6);
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
