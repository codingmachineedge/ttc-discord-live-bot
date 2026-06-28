import {
  ActionRowBuilder,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Message,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextChannel,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { config, trackedRouteShortNames } from "./config.js";
import { registerCommands } from "./commands.js";
import { ensureTtcChannels } from "./discordSetup.js";
import { alertCategory, chunkMessages, formatAlerts, formatVehicles, makeAlertAttachment, singleAlertFingerprint } from "./format.js";
import { formatDepartureBoardText, makeDepartureBoardAttachment } from "./departureBoard.js";
import {
  formatMentions,
  getGuildSettings,
  removeAlertPosts,
  removeTripFollower,
  setAlertSubscription,
  TripFollowSession,
  removeDepartureBoard,
  updateTripFollower,
  upsertAlertPost,
  upsertDepartureBoard,
  upsertTripFollower
} from "./settingsStore.js";
import { buildTripAnnouncement, makeProgressAttachment, upcomingStopOptions } from "./tripFollower.js";
import { findVehicleByNumber, getAlerts, getLine5Departures, getLine5Stations, getStaticGtfs, getTripStops, getVehicles } from "./ttcClient.js";

async function replyChunks(interaction: any, chunks: string[], ephemeral = false): Promise<void> {
  const [first, ...rest] = chunks;
  await interaction.reply({ content: first, ephemeral });
  for (const chunk of rest) {
    await interaction.followUp({ content: chunk, ephemeral });
  }
}

async function sendChunks(channel: TextChannel, chunks: string[]): Promise<void> {
  for (const chunk of chunks) {
    await channel.send(chunk);
  }
}

function chunksFromText(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 1900) {
    const splitAt = remaining.lastIndexOf("\n", 1900) > 0 ? remaining.lastIndexOf("\n", 1900) : 1900;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining.trim()) {
    chunks.push(remaining.trimEnd());
  }
  return chunks;
}

const feedbackAcknowledgements = new Map<string, number>();

async function handleGeneralFeedbackMessage(message: Message): Promise<void> {
  if (!message.guild || message.author.id === message.client.user.id) {
    return;
  }
  const isConfiguredGeneral = config.GENERAL_CHANNEL_ID && message.channelId === config.GENERAL_CHANNEL_ID;
  const isNamedGeneral = "name" in message.channel && message.channel.name?.toLowerCase() === "general";
  if (!isConfiguredGeneral && !isNamedGeneral) {
    return;
  }

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const last = feedbackAcknowledgements.get(key) ?? 0;
  if (now - last < 5 * 60 * 1000) {
    return;
  }
  feedbackAcknowledgements.set(key, now);
  await message.reply(`<@${message.author.id}> picked up and read. Feature change, fix, or feedback acknowledged.`);
}

async function handleCommand(interaction: any): Promise<void> {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    if (interaction.commandName === "ttc-alerts") {
      await interaction.deferReply();
      const alerts = await getAlerts();
      const chunks = chunkMessages(formatAlerts(alerts), "**Current TTC Alerts**");
      await interaction.editReply(chunks[0]);
      for (const chunk of chunks.slice(1)) {
        await interaction.followUp(chunk);
      }
      return;
    }

    if (interaction.commandName === "ttc-vehicles") {
      await interaction.deferReply();
      const line = interaction.options.getString("line")?.trim();
      const vehicles = await getVehicles(line);
      const chunks = chunkMessages(formatVehicles(vehicles), line ? `**TTC Line ${line} Vehicles**` : "**TTC Subway/LRT Vehicles**");
      await interaction.editReply(chunks[0]);
      for (const chunk of chunks.slice(1)) {
        await interaction.followUp(chunk);
      }
      return;
    }

    if (interaction.commandName === "ttc-status") {
      const guildSettings = interaction.guildId ? await getGuildSettings(interaction.guildId) : undefined;
      const staticGtfs = await getStaticGtfs();
      const tracked = [...staticGtfs.routes.values()]
        .filter((route) => trackedRouteShortNames.has(route.shortName))
        .map((route) => `${route.shortName} ${route.longName}`)
        .join("\n");
      await replyChunks(interaction, [
        [
          "**TTC Bot Status**",
          `Polling every ${config.POLL_INTERVAL_SECONDS}s`,
          `Alert channel: ${guildSettings?.alertsChannelId ? `<#${guildSettings.alertsChannelId}>` : config.ALERT_CHANNEL_ID || "not configured"}`,
          `Alert subscribers: ${guildSettings?.alertSubscriberIds.length ?? 0}`,
          `Auto setup channels: ${config.AUTO_SETUP_CHANNELS ? "on" : "off"}`,
          "**Tracked routes**",
          tracked || "No tracked routes found in static GTFS."
        ].join("\n")
      ], true);
      return;
    }

    if (interaction.commandName === "ttc-setup") {
      if (!interaction.guild) {
        await interaction.reply({ content: "Run this command inside a server.", ephemeral: true });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const setup = await ensureTtcChannels(interaction.guild);
      await interaction.editReply([
        "**TTC Live channels are ready.**",
        `Alerts: <#${setup.alertsChannelId}>`,
        `Vehicles: <#${setup.vehiclesChannelId}>`,
        `Status: <#${setup.statusChannelId}>`
      ].join("\n"));
      return;
    }

    if (interaction.commandName === "ttc-settings") {
      if (!interaction.guildId) {
        await interaction.reply({ content: "Run this command inside a server.", ephemeral: true });
        return;
      }
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "alerts") {
        const enabled = interaction.options.getBoolean("enabled", true);
        const settings = await setAlertSubscription(interaction.guildId, interaction.user.id, enabled);
        await interaction.reply({
          content: `TTC service alert pings are now ${enabled ? "on" : "off"} for you. Current subscribers: ${settings.alertSubscriberIds.length}.`,
          ephemeral: true
        });
        return;
      }

      const settings = await getGuildSettings(interaction.guildId);
      const enabled = settings.alertSubscriberIds.includes(interaction.user.id);
      await interaction.reply({
        content: [
          `Alert pings: ${enabled ? "on" : "off"}`,
          `Alerts channel: ${settings.alertsChannelId ? `<#${settings.alertsChannelId}>` : config.ALERT_CHANNEL_ID || "not configured"}`
        ].join("\n"),
        ephemeral: true
      });
      return;
    }

    if (interaction.commandName === "ttc-follow") {
      if (!interaction.guildId) {
        await interaction.reply({ content: "Run this command inside a server.", ephemeral: true });
        return;
      }

      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "start") {
        const modal = new ModalBuilder()
          .setCustomId("ttc-follow-vehicle-modal")
          .setTitle("Follow a TTC Trip");
        const vehicleInput = new TextInputBuilder()
          .setCustomId("vehicle-number")
          .setLabel("Vehicle number")
          .setPlaceholder("Enter the number printed on your TTC vehicle")
          .setRequired(true)
          .setStyle(TextInputStyle.Short);
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(vehicleInput));
        await interaction.showModal(modal);
        return;
      }

      if (subcommand === "stop") {
        await removeTripFollower(interaction.guildId, interaction.user.id);
        await interaction.reply({ content: "Stopped following your TTC trip.", ephemeral: true });
        return;
      }

      const settings = await getGuildSettings(interaction.guildId);
      const session = (settings.tripFollowers ?? []).find((item) => item.userId === interaction.user.id);
      if (!session) {
        await interaction.reply({ content: "You are not following a TTC trip right now.", ephemeral: true });
        return;
      }

      const vehicle = await findVehicleByNumber(session.vehicleLabel ?? session.vehicleNumber);
      const stops = await getTripStops(session.tripId);
      const alerts = await getAlerts();
      if (!vehicle) {
        await interaction.reply({ content: `Still following vehicle ${session.vehicleNumber}, but it is not in the live feed right now.`, ephemeral: true });
        return;
      }
      const announcementChunks = chunksFromText(buildTripAnnouncement(session, vehicle, alerts));
      await interaction.reply({
        content: announcementChunks[0],
        files: [makeProgressAttachment(session, vehicle, stops)],
        ephemeral: true
      });
      for (const chunk of announcementChunks.slice(1)) {
        await interaction.followUp({ content: chunk, ephemeral: true });
      }
      return;
    }

    if (interaction.commandName === "ttc-line5-board") {
      if (!interaction.guildId) {
        await interaction.reply({ content: "Run this command inside a server.", ephemeral: true });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const stations = await getLine5Stations();
      if (!stations.length) {
        await interaction.editReply("Line 5 stations were not found in the current TTC static GTFS.");
        return;
      }
      const stationMenu = new StringSelectMenuBuilder()
        .setCustomId("line5-board-station")
        .setPlaceholder("Select a Line 5 station")
        .addOptions(stations.slice(0, 25).map((station) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(station.stopName.slice(0, 100))
            .setValue(station.stopId.slice(0, 100))
        ));
      await interaction.editReply({
        content: "Choose the Line 5 station for the departure board.",
        components: [new ActionRowBuilder<any>().addComponents(stationMenu)]
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(`TTC feed error: ${message}`);
    } else {
      await interaction.reply({ content: `TTC feed error: ${message}`, ephemeral: true });
    }
  }
}

async function handleLine5BoardStationSelect(interaction: any): Promise<void> {
  if (!interaction.isStringSelectMenu() || interaction.customId !== "line5-board-station") {
    return;
  }
  const stopId = interaction.values[0];
  const stations = await getLine5Stations();
  const stationName = stations.find((station) => station.stopId === stopId)?.stopName ?? stopId;
  const directionMenu = new StringSelectMenuBuilder()
    .setCustomId(`line5-board-direction:${stopId}`)
    .setPlaceholder("Select direction")
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel("Eastbound to Kennedy").setValue("eastbound"),
      new StringSelectMenuOptionBuilder().setLabel("Westbound to Mount Dennis").setValue("westbound")
    );
  await interaction.update({
    content: `Station selected: **${stationName}**. Choose direction.`,
    components: [new ActionRowBuilder<any>().addComponents(directionMenu)]
  });
}

async function handleLine5BoardDirectionSelect(interaction: any): Promise<void> {
  if (!interaction.isStringSelectMenu() || !interaction.customId.startsWith("line5-board-direction:")) {
    return;
  }
  if (!interaction.guildId || !interaction.channel || !("threads" in interaction.channel)) {
    await interaction.reply({ content: "Run this in a server text channel where the bot can create threads.", ephemeral: true });
    return;
  }
  await interaction.deferUpdate();
  const [, stopId] = interaction.customId.split(":");
  const stations = await getLine5Stations();
  const stationName = stations.find((station) => station.stopId === stopId)?.stopName ?? stopId;
  const direction = interaction.values[0] as "eastbound" | "westbound";
  const thread = await interaction.channel.threads.create({
    name: `Line 5 ${stationName} ${direction}`,
    autoArchiveDuration: 1440,
    reason: "Live Line 5 departure board"
  });
  const session = {
    channelId: interaction.channelId,
    threadId: thread.id,
    messageId: "",
    stationStopId: stopId,
    stationName,
    direction,
    createdByUserId: interaction.user.id,
    createdAt: new Date().toISOString()
  };
  const vehicles = await getLine5Departures(stopId, direction);
  const message = await thread.send({
    content: formatDepartureBoardText(session, vehicles),
    files: [makeDepartureBoardAttachment(session, vehicles)]
  });
  await upsertDepartureBoard(interaction.guildId, { ...session, messageId: message.id });
  await interaction.editReply({
    content: `Created live Line 5 departure board thread: <#${thread.id}>`,
    components: []
  });
}

async function handleFollowVehicleModal(interaction: any): Promise<void> {
  if (!interaction.isModalSubmit() || interaction.customId !== "ttc-follow-vehicle-modal") {
    return;
  }

  if (!interaction.guildId) {
    await interaction.reply({ content: "Run this in a server channel.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const vehicleNumber = interaction.fields.getTextInputValue("vehicle-number").trim();
  const vehicle = await findVehicleByNumber(vehicleNumber);
  if (!vehicle?.tripId) {
    await interaction.editReply(`I could not find live trip data for vehicle **${vehicleNumber}**. Check the number and try again while the vehicle is active in TTC's realtime feed.`);
    return;
  }

  const stops = await getTripStops(vehicle.tripId);
  if (!stops.length) {
    await interaction.editReply(`I found vehicle **${vehicle.vehicleLabel ?? vehicle.vehicleId}**, but the active trip has no stop list in static GTFS.`);
    return;
  }

  const menu = upcomingStopOptions(stops, vehicle.currentStopSequence);
  const row = new ActionRowBuilder<any>().addComponents(menu);
  const tempSession: TripFollowSession = {
    userId: interaction.user.id,
    channelId: interaction.channelId,
    vehicleNumber,
    vehicleId: vehicle.vehicleId,
    vehicleLabel: vehicle.vehicleLabel,
    tripId: vehicle.tripId,
    routeName: vehicle.routeName,
    routeShortName: vehicle.routeShortName,
    destinationStopId: "",
    destinationStopName: "",
    destinationStopSequence: 0,
    createdAt: new Date().toISOString()
  };
  await upsertTripFollower(interaction.guildId, tempSession);
  await interaction.editReply({
    content: `Found **${vehicle.routeName}** vehicle **${vehicle.vehicleLabel ?? vehicle.vehicleId}**. Choose where you want to get off.`,
    components: [row]
  });
}

async function handleFollowDestinationSelect(interaction: any): Promise<void> {
  if (!interaction.isStringSelectMenu() || interaction.customId !== "ttc-follow-destination") {
    return;
  }
  if (!interaction.guildId) {
    await interaction.reply({ content: "Run this in a server channel.", ephemeral: true });
    return;
  }

  await interaction.deferUpdate();
  const settings = await getGuildSettings(interaction.guildId);
  const session = (settings.tripFollowers ?? []).find((item) => item.userId === interaction.user.id);
  if (!session) {
    await interaction.editReply({ content: "Your temporary follow session expired. Run `/ttc-follow start` again.", components: [] });
    return;
  }

  const [sequenceRaw, stopId] = interaction.values[0].split("|");
  const stops = await getTripStops(session.tripId);
  const stop = stops.find((item) => item.stopSequence === Number(sequenceRaw) && item.stopId === stopId);
  if (!stop) {
    await interaction.editReply({ content: "That stop is no longer available for this trip. Run `/ttc-follow start` again.", components: [] });
    return;
  }

  const updated: TripFollowSession = {
    ...session,
    destinationStopId: stop.stopId,
    destinationStopName: stop.stopName,
    destinationStopSequence: stop.stopSequence
  };
  await upsertTripFollower(interaction.guildId, updated);
  const vehicle = await findVehicleByNumber(session.vehicleLabel ?? session.vehicleNumber);
  await interaction.editReply({
    content: `Trip follower is on. I will announce next stops for <@${session.userId}> and tell you to get off at **${stop.stopName}**.`,
    components: [],
    files: vehicle ? [makeProgressAttachment(updated, vehicle, stops)] : []
  });
}

async function startAlertPolling(client: Client): Promise<void> {
  const poll = async () => {
    const guilds = config.DISCORD_GUILD_ID
      ? [await client.guilds.fetch(config.DISCORD_GUILD_ID)]
      : [...client.guilds.cache.values()];
    for (const guild of guilds) {
      try {
        const guildSettings = await getGuildSettings(guild.id);
        const alerts = await getAlerts();
        const activeIds = new Set(alerts.map((alert) => alert.id));
        const existingPosts = guildSettings.alertPosts ?? [];
        const resolvedPosts = existingPosts.filter((post) => !activeIds.has(post.alertId));
        for (const post of resolvedPosts) {
          try {
            const channel = await client.channels.fetch(post.channelId);
            if (channel && "messages" in channel) {
              const message = await channel.messages.fetch(post.messageId);
              await message.delete();
            }
          } catch (error) {
            console.error(`Failed to delete resolved alert ${post.alertId}`, error);
          }
        }
        if (resolvedPosts.length) {
          await removeAlertPosts(guild.id, resolvedPosts.map((post) => post.alertId));
        }

        const mentions = formatMentions(guildSettings.alertSubscriberIds);
        const categoryChannels = {
          subwayLrt: guildSettings.subwayLrtAlertsChannelId,
          busStreetcar: guildSettings.busStreetcarAlertsChannelId,
          accessibility: guildSettings.accessibilityAlertsChannelId,
          general: guildSettings.generalAlertsChannelId
        };

        for (const alert of alerts) {
          const fingerprint = singleAlertFingerprint(alert);
          const existing = (guildSettings.alertPosts ?? []).find((post) => post.alertId === alert.id);
          if (existing?.fingerprint === fingerprint) {
            continue;
          }

          if (existing) {
            try {
              const oldChannel = await client.channels.fetch(existing.channelId);
              if (oldChannel && "messages" in oldChannel) {
                const oldMessage = await oldChannel.messages.fetch(existing.messageId);
                await oldMessage.delete();
              }
            } catch (error) {
              console.error(`Failed to replace changed alert ${alert.id}`, error);
            }
          }

          const key = alertCategory(alert);
          const channelId = categoryChannels[key] || guildSettings.alertsChannelId || config.ALERT_CHANNEL_ID;
          if (!channelId) {
            continue;
          }
          const channel = await client.channels.fetch(channelId);
          if (!channel || channel.type === ChannelType.DM || !("send" in channel)) {
            continue;
          }
          const message = await (channel as TextChannel).send({
            content: mentions || undefined,
            files: [await makeAlertAttachment(alert)]
          });
          await upsertAlertPost(guild.id, {
            alertId: alert.id,
            fingerprint,
            channelId,
            messageId: message.id,
            postedAt: new Date().toISOString()
          });
        }
      } catch (error) {
        console.error(`Alert polling failed in ${guild.name}`, error);
      }
    }
  };

  await poll();
  setInterval(poll, config.POLL_INTERVAL_SECONDS * 1000);
}

async function startDepartureBoardPolling(client: Client): Promise<void> {
  const poll = async () => {
    const guilds = config.DISCORD_GUILD_ID
      ? [await client.guilds.fetch(config.DISCORD_GUILD_ID)]
      : [...client.guilds.cache.values()];
    for (const guild of guilds) {
      const settings = await getGuildSettings(guild.id);
      for (const board of settings.departureBoards ?? []) {
        try {
          const thread = await client.channels.fetch(board.threadId);
          if (!thread || !("messages" in thread)) {
            await removeDepartureBoard(guild.id, board.threadId);
            continue;
          }
          if ("archived" in thread && thread.archived && "setArchived" in thread) {
            await thread.setArchived(false, "Updating live Line 5 departure board");
          }
          const message = await thread.messages.fetch(board.messageId);
          const vehicles = await getLine5Departures(board.stationStopId, board.direction);
          await message.edit({
            content: formatDepartureBoardText(board, vehicles),
            attachments: [],
            files: [makeDepartureBoardAttachment(board, vehicles)]
          });
        } catch (error) {
          console.error(`Departure board update failed for ${board.threadId}`, error);
          const code = (error as any)?.code;
          if ([10003, 10008, 50001, 50013].includes(code)) {
            await removeDepartureBoard(guild.id, board.threadId);
          }
        }
      }
    }
  };
  await poll();
  setInterval(poll, config.POLL_INTERVAL_SECONDS * 1000);
}

async function startTripFollowerPolling(client: Client): Promise<void> {
  const poll = async () => {
    const guilds = config.DISCORD_GUILD_ID
      ? [await client.guilds.fetch(config.DISCORD_GUILD_ID)]
      : [...client.guilds.cache.values()];

    for (const guild of guilds) {
      try {
        const settings = await getGuildSettings(guild.id);
        const sessions = (settings.tripFollowers ?? []).filter((session) => session.destinationStopId);
        for (const session of sessions) {
          const vehicle = await findVehicleByNumber(session.vehicleLabel ?? session.vehicleNumber);
          if (!vehicle) {
            continue;
          }
          const sequenceChanged = vehicle.currentStopSequence !== session.lastAnnouncedStopSequence;
          const statusChanged = vehicle.currentStatus !== session.lastVehicleStatus;
          const atDestination = (vehicle.currentStopSequence ?? 0) >= session.destinationStopSequence || vehicle.nextStopId === session.destinationStopId;
          if (!sequenceChanged && !statusChanged && !atDestination) {
            continue;
          }

          const channel = await client.channels.fetch(session.channelId);
          if (!channel || channel.type === ChannelType.DM || !("send" in channel)) {
            continue;
          }
          const stops = await getTripStops(session.tripId);
          const alerts = await getAlerts();
          await sendChunks(channel as TextChannel, [buildTripAnnouncement(session, vehicle, alerts)]);
          await (channel as TextChannel).send({ files: [makeProgressAttachment(session, vehicle, stops)] });

          if (atDestination) {
            await removeTripFollower(guild.id, session.userId);
          } else {
            await updateTripFollower(guild.id, {
              ...session,
              lastAnnouncedStopSequence: vehicle.currentStopSequence,
              lastVehicleStatus: vehicle.currentStatus
            });
          }
        }
      } catch (error) {
        console.error(`Trip follower polling failed in ${guild.name}`, error);
      }
    }
  };

  await poll();
  setInterval(poll, config.POLL_INTERVAL_SECONDS * 1000);
}

async function main(): Promise<void> {
  await registerCommands();
  await getStaticGtfs();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
  });

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
    if (config.AUTO_SETUP_CHANNELS) {
      const guilds = config.DISCORD_GUILD_ID
        ? [await client.guilds.fetch(config.DISCORD_GUILD_ID)]
        : [...client.guilds.cache.values()];
      for (const guild of guilds) {
        try {
          const setup = await ensureTtcChannels(guild);
          console.log(`TTC channels ready in ${guild.name}: alerts=${setup.alertsChannelId}`);
        } catch (error) {
          console.error(`TTC channel setup failed in ${guild.name}`, error);
        }
      }
    }
    await startAlertPolling(client);
    await startTripFollowerPolling(client);
    await startDepartureBoardPolling(client);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
    } else if (interaction.isModalSubmit()) {
      await handleFollowVehicleModal(interaction);
    } else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "ttc-follow-destination") {
        await handleFollowDestinationSelect(interaction);
      } else if (interaction.customId === "line5-board-station") {
        await handleLine5BoardStationSelect(interaction);
      } else if (interaction.customId.startsWith("line5-board-direction:")) {
        await handleLine5BoardDirectionSelect(interaction);
      }
    }
  });
  client.on(Events.MessageCreate, handleGeneralFeedbackMessage);
  await client.login(config.DISCORD_TOKEN);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
