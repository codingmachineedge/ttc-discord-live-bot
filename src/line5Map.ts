import { AttachmentBuilder } from "discord.js";
import sharp from "sharp";
import type { TripStopSummary } from "./types.js";

// Line 5 Eglinton brand orange. Used for the route spine + line badge so the map
// reads as Line 5 at a glance.
const LINE5_ORANGE = "#f97316";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Static GTFS stop names come through as "Mount Dennis Station LRT Platform" /
// "Keelesdale Station Eastbound Platform". Strip the " Station ... Platform"
// boiler-plate so the map shows the human station name only.
export function cleanStationName(name: string): string {
  const beforeStation = name.split(/\s+Station\b/i)[0]?.trim();
  return (beforeStation || name).replace(/\s+(LRT|Eastbound|Westbound)?\s*Platform\s*$/i, "").trim();
}

/**
 * Renders the full Line 5 route as a tall, single-column strip map: an orange
 * spine connecting one labelled dot per station, top (Mount Dennis) to bottom
 * (Kennedy). When `highlightStopId` is given the boarding station is enlarged,
 * ringed and labelled in yellow so riders can find it instantly. `direction`
 * (if supplied) is shown as the travel arrow in the header.
 *
 * Accessibility: white text on near-black (#020617, > 15:1 contrast), 26px
 * station labels, 8px-stroke orange spine, terminus names bold. Nothing relies
 * on colour alone — the boarding stop is also ringed and flagged "BOARD HERE".
 */
export async function makeLine5RouteMapAttachment(
  stations: TripStopSummary[],
  highlightStopId?: string,
  direction?: "eastbound" | "westbound"
): Promise<AttachmentBuilder> {
  const names = stations.map((stop) => cleanStationName(stop.stopName));
  const rowHeight = 44;
  const topPad = 150;
  const bottomPad = 70;
  const width = 820;
  const height = topPad + Math.max(1, names.length) * rowHeight + bottomPad;
  const spineX = 96;

  const lastIndex = names.length - 1;
  const terminusWest = names[0] ?? "Mount Dennis";
  const terminusEast = names[lastIndex] ?? "Kennedy";
  const travelLabel = direction === "eastbound"
    ? `EASTBOUND ↓ to ${terminusEast}`
    : direction === "westbound"
      ? `WESTBOUND ↑ to ${terminusWest}`
      : `${terminusWest} ⇄ ${terminusEast}`;

  const dotY = (index: number) => topPad + index * rowHeight + rowHeight / 2;

  const spine = names.length > 1
    ? `<line x1="${spineX}" y1="${dotY(0)}" x2="${spineX}" y2="${dotY(lastIndex)}" stroke="${LINE5_ORANGE}" stroke-width="10" stroke-linecap="round"/>`
    : "";

  const rows = names.map((name, index) => {
    const y = dotY(index);
    const isTerminus = index === 0 || index === lastIndex;
    const isHighlight = highlightStopId !== undefined && stations[index]?.stopId === highlightStopId;
    const labelY = y + 9;

    const dot = isHighlight
      ? `<circle cx="${spineX}" cy="${y}" r="20" fill="#facc15" stroke="#ffffff" stroke-width="5"/>`
      : isTerminus
        ? `<circle cx="${spineX}" cy="${y}" r="15" fill="#ffffff" stroke="${LINE5_ORANGE}" stroke-width="6"/>`
        : `<circle cx="${spineX}" cy="${y}" r="11" fill="#0b1220" stroke="#ffffff" stroke-width="5"/>`;

    const labelFill = isHighlight ? "#facc15" : "#ffffff";
    const labelWeight = isHighlight || isTerminus ? "900" : "700";
    const labelSize = isHighlight ? 30 : isTerminus ? 28 : 26;
    const numberFill = isHighlight ? "#facc15" : "#94a3b8";
    const boardBadge = isHighlight
      ? `<rect x="${width - 214}" y="${y - 21}" width="184" height="42" rx="10" fill="#facc15"/>
         <text x="${width - 122}" y="${labelY}" font-size="22" font-weight="900" fill="#0b1220" text-anchor="middle">BOARD HERE</text>`
      : "";

    return `
      <text x="50" y="${labelY}" font-size="20" font-weight="700" fill="${numberFill}" text-anchor="end">${index + 1}</text>
      ${dot}
      <text x="136" y="${labelY}" font-size="${labelSize}" font-weight="${labelWeight}" fill="${labelFill}">${escapeXml(name)}</text>
      ${boardBadge}`;
  }).join("\n");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#020617"/>
  <g font-family="DejaVu Sans, Arial, sans-serif">
  <rect x="20" y="18" width="${width - 40}" height="${height - 36}" rx="26" fill="#0b1220" stroke="${LINE5_ORANGE}" stroke-width="6"/>
  <rect x="48" y="46" width="84" height="84" rx="42" fill="${LINE5_ORANGE}"/>
  <text x="90" y="106" font-size="54" font-weight="900" fill="#0b1220" text-anchor="middle">5</text>
  <text x="156" y="86" font-size="44" font-weight="900" fill="#ffffff">LINE 5 EGLINTON</text>
  <text x="158" y="124" font-size="26" font-weight="800" fill="${LINE5_ORANGE}">${escapeXml(travelLabel)}</text>
  ${spine}
  ${rows}
  </g>
</svg>`;

  const png = await sharp(Buffer.from(svg, "utf8")).png({ quality: 95, compressionLevel: 6 }).toBuffer();
  return new AttachmentBuilder(png, { name: "line-5-route-map.png" });
}
