import { ChannelType, Client, Events, GatewayIntentBits, TextChannel } from "discord.js";
import { config, trackedRouteShortNames } from "./config.js";
import { registerCommands } from "./commands.js";
import { ensureTtcChannels } from "./discordSetup.js";
import { alertFingerprint, chunkMessages, formatAlerts, formatVehicles } from "./format.js";
import { formatMentions, getGuildSettings, setAlertSubscription } from "./settingsStore.js";
import { getAlerts, getStaticGtfs, getVehicles } from "./ttcClient.js";

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
  });

  client.on(Events.InteractionCreate, handleCommand);
  await client.login(config.DISCORD_TOKEN);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
