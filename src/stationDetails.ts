import type { AlertSummary, VehicleSummary } from "./types.js";

type StationDetails = {
  doorSideByRouteDirection?: Record<string, "left" | "right" | "both" | "unknown">;
  elevators?: "available" | "not_available" | "unknown";
  escalators?: "available" | "not_available" | "unknown";
  washrooms?: "available" | "not_available" | "unknown";
  depthMeters?: number;
  notes?: string;
};

const stationDetailsByName: Record<string, StationDetails> = {
  "Avenue": {
    elevators: "available",
    escalators: "available",
    washrooms: "unknown",
    depthMeters: 32,
    notes: "Approximate depth from public reports; verify with TTC station information."
  },
  "Eglinton": {
    elevators: "available",
    escalators: "available",
    washrooms: "available",
    notes: "Line 1/Line 5 interchange station."
  },
  "Kennedy": {
    elevators: "available",
    escalators: "available",
    washrooms: "available",
    notes: "Line 2/Line 5/GO interchange station."
  },
  "Mount Dennis": {
    elevators: "available",
    escalators: "available",
    washrooms: "available",
    notes: "Line 5/UP Express/GO interchange station."
  }
};

function normalizeStationName(value: string): string {
  return value
    .replace(/\s+Station$/i, "")
    .replace(/\s+Stop$/i, "")
    .trim();
}

function statusFromAlerts(stationName: string, alerts: AlertSummary[], keyword: string): string | undefined {
  const normalized = normalizeStationName(stationName).toLowerCase();
  const matched = alerts.find((alert) => {
    const escapedStation = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const header = alert.header.toLowerCase();
    const description = alert.description.toLowerCase();
    const stationPattern = new RegExp(`(^|[^a-z0-9])${escapedStation}\\s+(station|:)|^${escapedStation}:`);
    return (stationPattern.test(header) || stationPattern.test(description)) && `${header} ${description}`.includes(keyword);
  });
  if (!matched) {
    return undefined;
  }
  return `outage/notice: ${matched.header}`;
}

function staticAvailability(value: StationDetails[keyof StationDetails]): string {
  if (value === "available") {
    return "available; no matching live outage alert found";
  }
  if (value === "not_available") {
    return "not available";
  }
  return "unknown";
}

export function formatStationDetails(vehicle: VehicleSummary, alerts: AlertSummary[]): string[] {
  const stationName = vehicle.nextStop ?? vehicle.currentStop;
  if (!stationName) {
    return ["Station details: next/current station unavailable."];
  }

  const normalized = normalizeStationName(stationName);
  const details = stationDetailsByName[normalized] ?? {};
  const directionKey = `${vehicle.routeShortName ?? vehicle.routeId}:${vehicle.headsign ?? ""}`;
  const doorSide = details.doorSideByRouteDirection?.[directionKey] ?? "unknown";
  const elevatorStatus = statusFromAlerts(normalized, alerts, "elevator") ?? staticAvailability(details.elevators);
  const escalatorStatus = statusFromAlerts(normalized, alerts, "escalator") ?? staticAvailability(details.escalators);
  const washroomStatus = statusFromAlerts(normalized, alerts, "washroom") ?? staticAvailability(details.washrooms);

  return [
    `Doors opening side: ${doorSide}`,
    `Elevators: ${elevatorStatus}`,
    `Escalators: ${escalatorStatus}`,
    `Washrooms: ${washroomStatus}`,
    `Station depth: ${details.depthMeters ? `${details.depthMeters} m approximate` : "unknown"}`,
    details.notes ? `Station note: ${details.notes}` : undefined
  ].filter(Boolean) as string[];
}
