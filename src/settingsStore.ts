import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type GuildSettings = {
  categoryId?: string;
  alertsChannelId?: string;
  vehiclesChannelId?: string;
  statusChannelId?: string;
  alertSubscriberIds: string[];
  tripFollowers?: TripFollowSession[];
};

export type TripFollowSession = {
  userId: string;
  channelId: string;
  vehicleNumber: string;
  vehicleId?: string;
  vehicleLabel?: string;
  tripId: string;
  routeName: string;
  routeShortName?: string;
  destinationStopId: string;
  destinationStopName: string;
  destinationStopSequence: number;
  lastAnnouncedStopSequence?: number;
  lastVehicleStatus?: string;
  createdAt: string;
};

type SettingsFile = {
  guilds: Record<string, GuildSettings>;
};

const settingsPath = resolve(process.cwd(), ".data", "settings.json");

const defaultSettings = (): SettingsFile => ({ guilds: {} });

async function readSettings(): Promise<SettingsFile> {
  try {
    const raw = await readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as SettingsFile;
    parsed.guilds ??= {};
    return parsed;
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return defaultSettings();
    }
    throw error;
  }
}

async function writeSettings(settings: SettingsFile): Promise<void> {
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export async function getGuildSettings(guildId: string): Promise<GuildSettings> {
  const settings = await readSettings();
  settings.guilds[guildId] ??= { alertSubscriberIds: [] };
  settings.guilds[guildId].alertSubscriberIds ??= [];
  settings.guilds[guildId].tripFollowers ??= [];
  return settings.guilds[guildId];
}

export async function updateGuildSettings(guildId: string, patch: Partial<GuildSettings>): Promise<GuildSettings> {
  const settings = await readSettings();
  const current = settings.guilds[guildId] ?? { alertSubscriberIds: [] };
  settings.guilds[guildId] = {
    ...current,
    ...patch,
    alertSubscriberIds: patch.alertSubscriberIds ?? current.alertSubscriberIds ?? [],
    tripFollowers: patch.tripFollowers ?? current.tripFollowers ?? []
  };
  await writeSettings(settings);
  return settings.guilds[guildId];
}

export async function setAlertSubscription(guildId: string, userId: string, enabled: boolean): Promise<GuildSettings> {
  const current = await getGuildSettings(guildId);
  const subscribers = new Set(current.alertSubscriberIds);
  if (enabled) {
    subscribers.add(userId);
  } else {
    subscribers.delete(userId);
  }
  return updateGuildSettings(guildId, { alertSubscriberIds: [...subscribers] });
}

export function formatMentions(userIds: string[]): string {
  return userIds.map((id) => `<@${id}>`).join(" ");
}

export async function upsertTripFollower(guildId: string, session: TripFollowSession): Promise<GuildSettings> {
  const current = await getGuildSettings(guildId);
  const sessions = (current.tripFollowers ?? []).filter((item) => item.userId !== session.userId);
  sessions.push(session);
  return updateGuildSettings(guildId, { tripFollowers: sessions });
}

export async function removeTripFollower(guildId: string, userId: string): Promise<GuildSettings> {
  const current = await getGuildSettings(guildId);
  return updateGuildSettings(guildId, {
    tripFollowers: (current.tripFollowers ?? []).filter((item) => item.userId !== userId)
  });
}

export async function updateTripFollower(guildId: string, session: TripFollowSession): Promise<GuildSettings> {
  const current = await getGuildSettings(guildId);
  return updateGuildSettings(guildId, {
    tripFollowers: (current.tripFollowers ?? []).map((item) => item.userId === session.userId ? session : item)
  });
}
