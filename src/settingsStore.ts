import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type GuildSettings = {
  categoryId?: string;
  alertsChannelId?: string;
  vehiclesChannelId?: string;
  statusChannelId?: string;
  alertSubscriberIds: string[];
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
  return settings.guilds[guildId];
}

export async function updateGuildSettings(guildId: string, patch: Partial<GuildSettings>): Promise<GuildSettings> {
  const settings = await readSettings();
  const current = settings.guilds[guildId] ?? { alertSubscriberIds: [] };
  settings.guilds[guildId] = {
    ...current,
    ...patch,
    alertSubscriberIds: patch.alertSubscriberIds ?? current.alertSubscriberIds ?? []
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
