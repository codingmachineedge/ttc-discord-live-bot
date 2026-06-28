import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

process.env.DISCORD_TOKEN ??= "verify-token";
process.env.DISCORD_CLIENT_ID ??= "verify-client";

const { buildTripAnnouncement, makeTripFollowerAttachments } = await import("../src/tripFollower.ts");

const outputDir = join(process.cwd(), ".data", "verification");
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const stops = [
  { stopId: "mount-dennis", stopName: "Mount Dennis", stopSequence: 1 },
  { stopId: "keelesdale", stopName: "Keelesdale", stopSequence: 2 },
  { stopId: "caldonia", stopName: "Caledonia", stopSequence: 3 },
  { stopId: "avenue", stopName: "Avenue", stopSequence: 4 },
  { stopId: "cedarvale", stopName: "Cedarvale", stopSequence: 5 },
  { stopId: "eglinton", stopName: "Eglinton", stopSequence: 6 }
];

const alerts = [
  {
    id: "verify-cedarvale-elevator",
    header: "Cedarvale: Elevator 4S2L out of service",
    description: "Cedarvale: Elevator out of service between bus terminal entrance and Line 1 Finch via southbound platform while we perform maintenance.",
    affectedRoutes: [],
    activePeriods: []
  }
];

const baseSession = {
  userId: "123",
  channelId: "456",
  vehicleNumber: "5501",
  vehicleId: "5501",
  vehicleLabel: "5501",
  tripId: "verify-trip",
  routeName: "5 Line 5 Eglinton",
  routeShortName: "5",
  destinationStopId: "cedarvale",
  destinationStopName: "Cedarvale",
  destinationStopSequence: 5,
  createdAt: new Date().toISOString()
};

const scenarios = [
  {
    name: "approaching",
    vehicle: {
      vehicleId: "5501",
      vehicleLabel: "5501",
      routeId: "5",
      routeName: "5 Line 5 Eglinton",
      routeShortName: "5",
      currentStatus: "IN_TRANSIT_TO",
      currentStopSequence: 3,
      nextStop: "Avenue",
      nextStopId: "avenue"
    },
    mustInclude: ["Please stand clear of the doors", "The next station is Avenue", "Get off at Cedarvale"]
  },
  {
    name: "next-stop",
    vehicle: {
      vehicleId: "5501",
      vehicleLabel: "5501",
      routeId: "5",
      routeName: "5 Line 5 Eglinton",
      routeShortName: "5",
      currentStatus: "STOPPED_AT",
      currentStopSequence: 4,
      currentStop: "Avenue",
      nextStop: "Cedarvale",
      nextStopId: "cedarvale"
    },
    mustInclude: ["Arriving at Cedarvale", "C'est votre arrêt", "Elevators: outage/notice"]
  },
  {
    name: "get-off",
    vehicle: {
      vehicleId: "5501",
      vehicleLabel: "5501",
      routeId: "5",
      routeName: "5 Line 5 Eglinton",
      routeShortName: "5",
      currentStatus: "STOPPED_AT",
      currentStopSequence: 5,
      currentStop: "Cedarvale",
      nextStop: "Cedarvale",
      nextStopId: "cedarvale"
    },
    mustInclude: ["get off at **Cedarvale** now", "Doors opening side: left"]
  }
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function verifyAttachment(name, attachment, expected) {
  const buffer = attachment.attachment;
  assert(Buffer.isBuffer(buffer), `${name}: attachment is not a Buffer`);
  assert(buffer.length > 1024, `${name}: attachment too small`);
  assert(buffer.length < 8 * 1024 * 1024, `${name}: attachment over Discord-friendly verification limit`);
  const metadata = await sharp(buffer, { animated: expected.format === "gif" }).metadata();
  assert(metadata.format === expected.format, `${name}: expected ${expected.format}, got ${metadata.format}`);
  assert(metadata.width === expected.width, `${name}: expected width ${expected.width}, got ${metadata.width}`);
  const frameHeight = metadata.pageHeight ?? metadata.height;
  assert(frameHeight === expected.height, `${name}: expected frame height ${expected.height}, got ${frameHeight}`);
  if (expected.pages) {
    assert((metadata.pages ?? 1) >= expected.pages, `${name}: expected at least ${expected.pages} frames, got ${metadata.pages ?? 1}`);
  }
  await writeFile(join(outputDir, `${name}.${expected.format}`), buffer);
  return {
    bytes: buffer.length,
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    pages: metadata.pages ?? 1
  };
}

const results = [];
for (const scenario of scenarios) {
  const announcement = buildTripAnnouncement(baseSession, scenario.vehicle, alerts);
  for (const text of scenario.mustInclude) {
    assert(announcement.includes(text), `${scenario.name}: announcement missing "${text}"`);
  }

  const [mapAttachment, infoAttachment] = await makeTripFollowerAttachments(baseSession, scenario.vehicle, stops, alerts);
  const map = await verifyAttachment(`${scenario.name}-map`, mapAttachment, { format: "gif", width: 1200, height: 400, pages: 10 });
  const info = await verifyAttachment(`${scenario.name}-info`, infoAttachment, { format: "png", width: 1200, height: 560 });
  results.push({ scenario: scenario.name, map, info });
}

console.log(JSON.stringify({ outputDir, results }, null, 2));
