import { parse } from "csv-parse/sync";
import unzipper from "unzipper";
import { config } from "./config.js";
import type { RouteInfo, StaticGtfs, StopInfo, StopTimeInfo, TripInfo } from "./types.js";

type CsvRow = Record<string, string>;

function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

async function readZipCsv(buffer: Buffer, name: string): Promise<CsvRow[]> {
  const directory = await unzipper.Open.buffer(buffer);
  const entry = directory.files.find((file: unzipper.File) => file.path.toLowerCase() === name.toLowerCase());
  if (!entry) {
    return [];
  }

  const content = await entry.buffer();
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true
  }) as CsvRow[];
}

export async function loadStaticGtfs(): Promise<StaticGtfs> {
  const response = await fetch(config.TTC_STATIC_GTFS_URL);
  if (!response.ok) {
    throw new Error(`Failed to download TTC static GTFS: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const [routeRows, stopRows, tripRows, stopTimeRows] = await Promise.all([
    readZipCsv(buffer, "routes.txt"),
    readZipCsv(buffer, "stops.txt"),
    readZipCsv(buffer, "trips.txt"),
    readZipCsv(buffer, "stop_times.txt")
  ]);

  const routes = new Map<string, RouteInfo>();
  const routesByShortName = new Map<string, RouteInfo>();
  for (const row of routeRows) {
    const route: RouteInfo = {
      id: clean(row.route_id),
      shortName: clean(row.route_short_name),
      longName: clean(row.route_long_name),
      type: Number(clean(row.route_type) || 0)
    };
    if (!route.id) {
      continue;
    }
    routes.set(route.id, route);
    if (route.shortName) {
      routesByShortName.set(route.shortName, route);
    }
  }

  const stops = new Map<string, StopInfo>();
  for (const row of stopRows) {
    const stop: StopInfo = {
      id: clean(row.stop_id),
      name: clean(row.stop_name),
      lat: row.stop_lat ? Number(row.stop_lat) : undefined,
      lon: row.stop_lon ? Number(row.stop_lon) : undefined
    };
    if (stop.id) {
      stops.set(stop.id, stop);
    }
  }

  const trips = new Map<string, TripInfo>();
  for (const row of tripRows) {
    const routeId = clean(row.route_id);
    const trip: TripInfo = {
      id: clean(row.trip_id),
      routeId,
      serviceId: clean(row.service_id),
      headsign: clean(row.trip_headsign),
      directionId: row.direction_id ? Number(row.direction_id) : undefined,
      shapeId: clean(row.shape_id)
    };
    if (trip.id) {
      trips.set(trip.id, trip);
    }
  }

  const stopTimesByTrip = new Map<string, StopTimeInfo[]>();
  for (const row of stopTimeRows) {
    const tripId = clean(row.trip_id);
    if (!trips.has(tripId)) {
      continue;
    }
    const item: StopTimeInfo = {
      tripId,
      stopId: clean(row.stop_id),
      stopSequence: Number(clean(row.stop_sequence) || 0),
      arrivalTime: clean(row.arrival_time),
      departureTime: clean(row.departure_time)
    };
    const list = stopTimesByTrip.get(tripId) ?? [];
    list.push(item);
    stopTimesByTrip.set(tripId, list);
  }

  for (const list of stopTimesByTrip.values()) {
    list.sort((a, b) => a.stopSequence - b.stopSequence);
  }

  return { routes, routesByShortName, stops, trips, stopTimesByTrip };
}
