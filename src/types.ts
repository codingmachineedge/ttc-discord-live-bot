export type RouteInfo = {
  id: string;
  shortName: string;
  longName: string;
  type: number;
};

export type StopInfo = {
  id: string;
  name: string;
  lat?: number;
  lon?: number;
};

export type StopTimeInfo = {
  tripId: string;
  stopId: string;
  stopSequence: number;
  arrivalTime?: string;
  departureTime?: string;
};

export type TripInfo = {
  id: string;
  routeId: string;
  serviceId?: string;
  headsign?: string;
  directionId?: number;
  shapeId?: string;
};

export type StaticGtfs = {
  routes: Map<string, RouteInfo>;
  routesByShortName: Map<string, RouteInfo>;
  stops: Map<string, StopInfo>;
  trips: Map<string, TripInfo>;
  stopTimesByTrip: Map<string, StopTimeInfo[]>;
};

export type VehicleSummary = {
  vehicleId: string;
  vehicleLabel?: string;
  routeId: string;
  routeName: string;
  tripId?: string;
  headsign?: string;
  latitude?: number;
  longitude?: number;
  bearing?: number;
  speedKmh?: number;
  currentStatus?: string;
  currentStop?: string;
  nextStop?: string;
  scheduledTime?: string;
  eta?: Date;
  delaySeconds?: number;
  updatedAt?: Date;
  currentStopSequence?: number;
  nextStopId?: string;
  routeShortName?: string;
  // Where this summary came from, so the UI can label live vs. estimated vs. scheduled.
  source?: "gtfs-realtime" | "transsee" | "schedule";
  waitMinutes?: number;
};

export type TripStopSummary = {
  stopId: string;
  stopName: string;
  stopSequence: number;
  scheduledTime?: string;
};

export type AlertSummary = {
  id: string;
  header: string;
  description: string;
  affectedRoutes: string[];
  activePeriods: string[];
  effect?: string;
  cause?: string;
  severity?: string;
};
