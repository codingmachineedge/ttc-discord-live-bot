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
  "Mount Dennis": {
    doorSideByRouteDirection: { "5:": "left" },
    elevators: "available",
    escalators: "available",
    washrooms: "available",
    notes: "Best-effort Line 5 door side from public station/platform layout research."
  },
  "Keelesdale": {
    doorSideByRouteDirection: { "5:": "left" },
    elevators: "available",
    escalators: "available",
    washrooms: "unknown",
    notes: "Best-effort Line 5 door side from public station/platform layout research."
  },
  "Caledonia": {
    doorSideByRouteDirection: { "5:": "left" },
    elevators: "available",
    escalators: "available",
    washrooms: "unknown",
    notes: "Best-effort Line 5 door side from public station/platform layout research."
  },
  "Cedarvale": {
    doorSideByRouteDirection: { "5:": "left" },
    elevators: "available",
    escalators: "available",
    washrooms: "unknown",
    notes: "Line 1/Line 5 interchange. Best-effort Line 5 door side from public station/platform layout research."
  },
  "Forest Hill": {
    doorSideByRouteDirection: { "5:": "left" },
    elevators: "available",
    escalators: "available",
    washrooms: "unknown",
    notes: "Best-effort Line 5 door side from public station/platform layout research."
  },
  "Chaplin": {
    doorSideByRouteDirection: { "5:": "left" },
    elevators: "available",
    escalators: "available",
    washrooms: "unknown",
    notes: "Best-effort Line 5 door side from public station/platform layout research."
  },
  "Avenue": {
    doorSideByRouteDirection: { "5:": "left" },
    elevators: "available",
    escalators: "available",
    washrooms: "unknown",
    depthMeters: 32,
    notes: "Approximate depth from public reports; door side is best-effort from public station/platform layout research."
  },
  "Mount Pleasant": {
    doorSideByRouteDirection: { "5:": "left" },
    elevators: "available",
    escalators: "available",
    washrooms: "unknown",
    notes: "Best-effort Line 5 door side from public station/platform layout research."
  },
  "Eglinton": {
    doorSideByRouteDirection: { "5:": "left" },
    elevators: "available",
    escalators: "available",
    washrooms: "available",
    notes: "Line 1/Line 5 interchange station. Best-effort Line 5 door side from public station/platform layout research."
  },
  "Laird": {
    doorSideByRouteDirection: { "5:": "left" },
    elevators: "available",
    escalators: "available",
    washrooms: "unknown",
    notes: "Best-effort Line 5 door side from public station/platform layout research."
  },
  "Sunnybrook Park": {
    doorSideByRouteDirection: { "5:": "right" },
    elevators: "unknown",
    escalators: "unknown",
    washrooms: "unknown",
    notes: "Best-effort Line 5 surface-stop door side from public platform layout research."
  },
  "Leaside": {
    doorSideByRouteDirection: { "5:": "left" },
    elevators: "available",
    escalators: "available",
    washrooms: "unknown",
    notes: "Best-effort Line 5 door side from public station/platform layout research."
  },
  "Don Valley": {
    doorSideByRouteDirection: { "5:": "left" },
    elevators: "available",
    escalators: "available",
    washrooms: "unknown",
    notes: "Best-effort Line 5 door side from public station/platform layout research."
  },
  "Aga Khan Park & Museum": {
    doorSideByRouteDirection: { "5:": "right" },
    washrooms: "unknown",
    notes: "Best-effort Line 5 surface-stop door side from public platform layout research."
  },
  "Wynford": {
    doorSideByRouteDirection: { "5:": "right" },
    washrooms: "unknown",
    notes: "Best-effort Line 5 surface-stop door side from public platform layout research."
  },
  "Sloane": {
    doorSideByRouteDirection: { "5:": "left" },
    washrooms: "unknown",
    notes: "Best-effort Line 5 surface-stop door side from public platform layout research."
  },
  "O'Connor": {
    doorSideByRouteDirection: { "5:": "right" },
    washrooms: "unknown",
    notes: "Best-effort Line 5 surface-stop door side from public platform layout research."
  },
  "Pharmacy": {
    doorSideByRouteDirection: { "5:": "right" },
    washrooms: "unknown",
    notes: "Best-effort Line 5 surface-stop door side from public platform layout research."
  },
  "Hakimi Lebovic": {
    doorSideByRouteDirection: { "5:": "right" },
    washrooms: "unknown",
    notes: "Best-effort Line 5 surface-stop door side from public platform layout research."
  },
  "Golden Mile": {
    doorSideByRouteDirection: { "5:": "right" },
    washrooms: "unknown",
    notes: "Best-effort Line 5 surface-stop door side from public platform layout research."
  },
  "Birchmount": {
    doorSideByRouteDirection: { "5:": "right" },
    washrooms: "unknown",
    notes: "Best-effort Line 5 surface-stop door side from public platform layout research."
  },
  "Ionview": {
    doorSideByRouteDirection: { "5:": "right" },
    washrooms: "unknown",
    notes: "Best-effort Line 5 surface-stop door side from public platform layout research."
  },
  "Kennedy": {
    doorSideByRouteDirection: { "5:": "left" },
    elevators: "available",
    escalators: "available",
    washrooms: "available",
    notes: "Line 2/Line 5/GO interchange station. Best-effort Line 5 door side from public station/platform layout research."
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
  const routeKey = `${vehicle.routeShortName ?? vehicle.routeId}:`;
  const doorSide = details.doorSideByRouteDirection?.[directionKey]
    ?? details.doorSideByRouteDirection?.[routeKey]
    ?? (vehicle.routeShortName === "5" ? "left (best effort for Line 5 island platforms)" : "unknown");
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
