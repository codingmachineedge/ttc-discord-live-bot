import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().optional().default(""),
  ALERT_CHANNEL_ID: z.string().optional().default(""),
  GENERAL_CHANNEL_ID: z.string().optional().default(""),
  AUTO_SETUP_CHANNELS: z.coerce.boolean().default(true),
  POLL_INTERVAL_SECONDS: z.coerce.number().int().min(15).default(30),
  COMMAND_REGISTER_MODE: z.enum(["guild", "global"]).default("guild"),
  TTC_VEHICLE_POSITIONS_URL: z.string().url().default("https://bustime.ttc.ca/gtfsrt/vehicles"),
  TTC_TRIP_UPDATES_URL: z.string().url().default("https://bustime.ttc.ca/gtfsrt/trips"),
  TTC_ALERTS_URL: z.string().url().default("https://bustime.ttc.ca/gtfsrt/alerts"),
  TTC_WEBSITE_STATUS_URL: z.string().url().default("https://www.ttc.ca/"),
  TTC_STATIC_GTFS_URL: z.string().url().default("https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/7795b45e-e65a-4465-81fc-c36b9dfff169/resource/cfb6b2b8-6191-41e3-bda1-b175c51148cb/download/TTC%20Routes%20and%20Schedules%20Data.zip"),
  SUBWAY_LRT_ROUTE_SHORT_NAMES: z.string().default("1,2,3,4,5,6")
});

export const config = envSchema.parse(process.env);

export const trackedRouteShortNames = new Set(
  config.SUBWAY_LRT_ROUTE_SHORT_NAMES.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
