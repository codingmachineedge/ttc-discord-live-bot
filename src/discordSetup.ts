import { ChannelType, Guild, PermissionFlagsBits, TextChannel } from "discord.js";
import { updateGuildSettings } from "./settingsStore.js";

const categoryName = "TTC Live";

const channelDefinitions = [
  {
    key: "alertsChannelId",
    name: "ttc-alerts",
    topic: "All live TTC service alerts, delays, disruptions, and optional user pings."
  },
  {
    key: "subwayLrtAlertsChannelId",
    name: "ttc-alerts-subway-lrt",
    topic: "TTC subway and LRT alerts routed by the bot."
  },
  {
    key: "busStreetcarAlertsChannelId",
    name: "ttc-alerts-bus-streetcar",
    topic: "TTC bus and streetcar alerts routed by the bot."
  },
  {
    key: "accessibilityAlertsChannelId",
    name: "ttc-alerts-accessibility",
    topic: "TTC elevator, escalator, accessibility, and washroom alerts routed by the bot."
  },
  {
    key: "generalAlertsChannelId",
    name: "ttc-alerts-general",
    topic: "TTC alerts that do not fit a more specific alert channel."
  },
  {
    key: "vehiclesChannelId",
    name: "ttc-vehicles",
    topic: "TTC subway/LRT vehicle lookup command channel."
  },
  {
    key: "statusChannelId",
    name: "ttc-status",
    topic: "TTC bot status and setup information."
  }
] as const;

export async function ensureTtcChannels(guild: Guild): Promise<{
  categoryId: string;
  alertsChannelId: string;
  vehiclesChannelId: string;
  statusChannelId: string;
  subwayLrtAlertsChannelId: string;
  busStreetcarAlertsChannelId: string;
  accessibilityAlertsChannelId: string;
  generalAlertsChannelId: string;
}> {
  const me = guild.members.me ?? await guild.members.fetchMe();
  const permissions = me.permissions;
  if (!permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error("Bot needs the Manage Channels permission to auto setup TTC channels.");
  }

  const channels = await guild.channels.fetch();
  let category = channels.find((channel) =>
    channel?.type === ChannelType.GuildCategory && channel.name === categoryName
  );

  category ??= await guild.channels.create({
    name: categoryName,
    type: ChannelType.GuildCategory
  });

  const created: Record<string, string> = {
    categoryId: category.id
  };

  for (const definition of channelDefinitions) {
    let channel = channels.find((candidate) =>
      candidate?.type === ChannelType.GuildText
      && candidate.name === definition.name
      && candidate.parentId === category.id
    ) as TextChannel | undefined;

    channel ??= await guild.channels.create({
      name: definition.name,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: definition.topic
    });

    if (channel.topic !== definition.topic) {
      await channel.setTopic(definition.topic);
    }

    created[definition.key] = channel.id;
  }

  await updateGuildSettings(guild.id, created);
  return created as {
    categoryId: string;
    alertsChannelId: string;
    vehiclesChannelId: string;
  statusChannelId: string;
  subwayLrtAlertsChannelId: string;
  busStreetcarAlertsChannelId: string;
  accessibilityAlertsChannelId: string;
  generalAlertsChannelId: string;
  };
}
