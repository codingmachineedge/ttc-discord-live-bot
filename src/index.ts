import {
  ActionRowBuilder,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  TextChannel,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { config, trackedRouteShortNames } from "./config.js";
import { registerCommands } from "./commands.js";
import { ensureTtcChannels } from "./discordSetup.js";
import { alertFingerprint, chunkMessages, formatAlerts, formatVehicles } from "./format.js";
import {
  formatMentions,
  getGuildSettings,
  removeTripFollower,
  setAlertSubscription,
  TripFollowSession,
  updateTripFollower,
  upsertTripFollower
} from "./settingsStore.js";
import { buildTripAnnouncement, makeProgressAttachment, upcomingStopOptions } from "./tripFollower.js";
import { findVehicleByNumber, getAlerts, getStaticGtfs, getTripStops, getVehicles } from "./ttcClient.js";

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
      if (!vehicle) {
        await interaction.reply({ content: `Still following vehicle ${session.vehicleNumber}, but it is not in the live feed right now.`, ephemeral: true });
        return;
      }
      await interaction.reply({
        content: buildTripAnnouncement(session, vehicle),
        files: [makeProgressAttachment(session, vehicle, stops)],
        ephemeral: true
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
  let lastFingerprint = "";
  const poll = async () => {
    try {
      const guild = config.DISCORD_GUILD_ID ? await client.guilds.fetch(config.DISCORD_GUILD_ID) : client.guilds.cache.first();
      if (!guild) {
        console.error("No guild found for alert polling.");
        return;
      }
      const guildSettings = await getGuildSettings(guild.id);
      const alertChannelId = guildSettings.alertsChannelId || config.ALERT_CHANNEL_ID;
      if (!alertChannelId) {
        return;
      }

      const channel = await client.channels.fetch(alertChannelId);
      if (!channel || channel.type === ChannelType.DM || !("send" in channel)) {
        console.error(`Configured alert channel ${alertChannelId} is not a text channel.`);
        return;
      }
      const alerts = await getAlerts();
      const fingerprint = alertFingerprint(alerts);
      if (fingerprint !== lastFingerprint) {
        lastFingerprint = fingerprint;
        const mentions = formatMentions(guildSettings.alertSubscriberIds);
        const heading = mentions ? `**TTC Alert Update**\n${mentions}` : "**TTC Alert Update**";
        await sendChunks(channel as TextChannel, chunkMessages(formatAlerts(alerts), heading));
      }
    } catch (error) {
      console.error("Alert polling failed", error);
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
          await sendChunks(channel as TextChannel, [buildTripAnnouncement(session, vehicle)]);
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
    intents: [GatewayIntentBits.Guilds]
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
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
    } else if (interaction.isModalSubmit()) {
      await handleFollowVehicleModal(interaction);
    } else if (interaction.isStringSelectMenu()) {
      await handleFollowDestinationSelect(interaction);
    }
  });
  await client.login(config.DISCORD_TOKEN);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
