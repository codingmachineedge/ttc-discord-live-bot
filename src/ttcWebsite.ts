import NodeCache from "node-cache";
import { config } from "./config.js";
import type { AlertSummary } from "./types.js";

const cache = new NodeCache({ stdTTL: 60, checkperiod: 60 });
const subwayLrtRoutes = new Set(["1", "2", "3", "4", "5", "6"]);

export type TtcWebsiteRouteStatus = {
  route: string;
  title: string;
  description?: string;
  sourceUrl: string;
  checkedAt: Date;
};

function decodeHtml(value: string): string {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, " "));
}

export async function getTtcWebsiteRouteStatuses(): Promise<TtcWebsiteRouteStatus[]> {
  const cached = cache.get<TtcWebsiteRouteStatus[]>(config.TTC_WEBSITE_STATUS_URL);
  if (cached) {
    return cached;
  }

  const response = await fetch(config.TTC_WEBSITE_STATUS_URL, {
    headers: {
      "User-Agent": "ttc-discord-live-bot/0.1 (+https://www.ttc.ca/)"
    }
  });
  if (!response.ok) {
    throw new Error(`TTC website status request failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const checkedAt = new Date();
  const statuses: TtcWebsiteRouteStatus[] = [];
  const pattern = /<a href="\/routes-and-schedules\/(\d+)\/0"[\s\S]*?<div class="alert-title">([\s\S]*?)<\/div>(?:[\s\S]*?<div class="alert-description">([\s\S]*?)<\/div>)?/g;
  for (const match of html.matchAll(pattern)) {
    statuses.push({
      route: match[1],
      title: stripTags(match[2]),
      description: match[3] ? stripTags(match[3]) : undefined,
      sourceUrl: config.TTC_WEBSITE_STATUS_URL,
      checkedAt
    });
  }

  cache.set(config.TTC_WEBSITE_STATUS_URL, statuses);
  return statuses;
}

export function formatTtcWebsiteStatuses(statuses: TtcWebsiteRouteStatus[]): string[] {
  if (!statuses.length) {
    return ["TTC.ca status dashboard did not return route status rows."];
  }
  return statuses
    .filter((status) => subwayLrtRoutes.has(status.route))
    .map((status) => `Line ${status.route}: ${status.title}${status.description ? ` - ${status.description}` : ""}`);
}

function alertRouteNumbers(alert: AlertSummary): Set<string> {
  const text = `${alert.header} ${alert.description} ${alert.affectedRoutes.join(" ")}`;
  const numbers = new Set<string>();
  for (const match of text.matchAll(/\b(?:Line\s*)?([1-6])\b/gi)) {
    numbers.add(match[1]);
  }
  for (const route of alert.affectedRoutes) {
    const shortName = route.match(/^([1-6])(?:\s|$)/)?.[1];
    if (shortName) {
      numbers.add(shortName);
    }
  }
  return numbers;
}

export function filterAlertsAgainstTtcWebsite(alerts: AlertSummary[], statuses: TtcWebsiteRouteStatus[]): AlertSummary[] {
  const normalRoutes = new Set(
    statuses
      .filter((status) => subwayLrtRoutes.has(status.route) && /^normal service$/i.test(status.title))
      .map((status) => status.route)
  );
  if (!normalRoutes.size) {
    return alerts;
  }

  return alerts.filter((alert) => {
    const text = `${alert.header} ${alert.description}`.toLowerCase();
    if (/\b(elevator|escalator|accessible|accessibility|washroom|wheel-trans)\b/.test(text)) {
      return true;
    }
    const routeNumbers = alertRouteNumbers(alert);
    if (!routeNumbers.size) {
      return true;
    }
    const isSubwayLrtOnly = [...routeNumbers].every((route) => subwayLrtRoutes.has(route));
    if (!isSubwayLrtOnly) {
      return true;
    }
    return ![...routeNumbers].every((route) => normalRoutes.has(route));
  });
}
