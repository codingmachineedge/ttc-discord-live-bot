import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type GuildSettings = {
  categoryId?: string;
  alertsChannelId?: string;
  subwayLrtAlertsChannelId?: string;
  busStreetcarAlertsChannelId?: string;
  accessibilityAlertsChannelId?: string;
  generalAlertsChannelId?: string;
  vehiclesChannelId?: string;
  statusChannelId?: string;
  alertSubscriberIds: string[];
  tripFollowers?: TripFollowSession[];
  departureBoards?: DepartureBoardSession[];
  alertPosts?: AlertPostRecord[];
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

export type DepartureBoardSession = {
  channelId: string;
  threadId: string;
  messageId: string;
  stationStopId: string;
  stationName: string;
  direction: "eastbound" | "westbound";
  createdByUserId: string;
  createdAt: string;
};

export type AlertPostRecord = {
  alertId: string;
  fingerprint: string;
  channelId: string;
  messageId: string;
  postedAt: string;
};

type SettingsFile = {
  guilds: Record<string, GuildSettings>;
};

const settingsPath = resolve(process.cwd(), ".data", "settings.json");
let settingsWriteQueue = Promise.resolve();

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

async function mutateGuildSettings(guildId: string, mutate: (settings: GuildSettings) => void): Promise<GuildSettings> {
  const run = async () => {
    const settings = await readSettings();
    const current = settings.guilds[guildId] ?? { alertSubscriberIds: [] };
    current.alertSubscriberIds ??= [];
    current.tripFollowers ??= [];
    current.departureBoards ??= [];
    current.alertPosts ??= [];
    mutate(current);
    settings.guilds[guildId] = current;
    await writeSettings(settings);
    return current;
  };

  const result = settingsWriteQueue.then(run, run);
  settingsWriteQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function getGuildSettings(guildId: string): Promise<GuildSettings> {
  const settings = await readSettings();
  settings.guilds[guildId] ??= { alertSubscriberIds: [] };
  settings.guilds[guildId].alertSubscriberIds ??= [];
  settings.guilds[guildId].tripFollowers ??= [];
  settings.guilds[guildId].departureBoards ??= [];
  settings.guilds[guildId].alertPosts ??= [];
  return settings.guilds[guildId];
}

export async function updateGuildSettings(guildId: string, patch: Partial<GuildSettings>): Promise<GuildSettings> {
  return mutateGuildSettings(guildId, (current) => {
    Object.assign(current, patch);
    current.alertSubscriberIds = patch.alertSubscriberIds ?? current.alertSubscriberIds ?? [];
    current.tripFollowers = patch.tripFollowers ?? current.tripFollowers ?? [];
    current.departureBoards = patch.departureBoards ?? current.departureBoards ?? [];
    current.alertPosts = patch.alertPosts ?? current.alertPosts ?? [];
  });
}

export async function setAlertSubscription(guildId: string, userId: string, enabled: boolean): Promise<GuildSettings> {
  return mutateGuildSettings(guildId, (current) => {
    const subscribers = new Set(current.alertSubscriberIds);
    if (enabled) {
      subscribers.add(userId);
    } else {
      subscribers.delete(userId);
    }
    current.alertSubscriberIds = [...subscribers];
  });
}

export function formatMentions(userIds: string[]): string {
  return userIds.map((id) => `<@${id}>`).join(" ");
}

export async function upsertTripFollower(guildId: string, session: TripFollowSession): Promise<GuildSettings> {
  return mutateGuildSettings(guildId, (current) => {
    const sessions = (current.tripFollowers ?? []).filter((item) => item.userId !== session.userId);
    sessions.push(session);
    current.tripFollowers = sessions;
  });
}

export async function removeTripFollower(guildId: string, userId: string): Promise<GuildSettings> {
  return mutateGuildSettings(guildId, (current) => {
    current.tripFollowers = (current.tripFollowers ?? []).filter((item) => item.userId !== userId);
  });
}

export async function updateTripFollower(guildId: string, session: TripFollowSession): Promise<GuildSettings> {
  return mutateGuildSettings(guildId, (current) => {
    current.tripFollowers = (current.tripFollowers ?? []).map((item) => item.userId === session.userId ? session : item);
  });
}

export async function upsertDepartureBoard(guildId: string, session: DepartureBoardSession): Promise<GuildSettings> {
  return mutateGuildSettings(guildId, (current) => {
    const sessions = (current.departureBoards ?? []).filter((item) => item.threadId !== session.threadId);
    sessions.push(session);
    current.departureBoards = sessions;
  });
}

export async function removeDepartureBoard(guildId: string, threadId: string): Promise<GuildSettings> {
  return mutateGuildSettings(guildId, (current) => {
    current.departureBoards = (current.departureBoards ?? []).filter((item) => item.threadId !== threadId);
  });
}

export async function upsertAlertPost(guildId: string, post: AlertPostRecord): Promise<GuildSettings> {
  return mutateGuildSettings(guildId, (current) => {
    const posts = (current.alertPosts ?? []).filter((item) => item.alertId !== post.alertId);
    posts.push(post);
    current.alertPosts = posts;
  });
}

export async function removeAlertPosts(guildId: string, alertIds: string[]): Promise<GuildSettings> {
  const removeIds = new Set(alertIds);
  return mutateGuildSettings(guildId, (current) => {
    current.alertPosts = (current.alertPosts ?? []).filter((item) => !removeIds.has(item.alertId));
  });
}
