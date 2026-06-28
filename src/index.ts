import { ChannelType, Client, Events, GatewayIntentBits, TextChannel } from "discord.js";
import { config, trackedRouteShortNames } from "./config.js";
import { registerCommands } from "./commands.js";
import { alertFingerprint, chunkMessages, formatAlerts, formatVehicles } from "./format.js";
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
      const staticGtfs = await getStaticGtfs();
      const tracked = [...staticGtfs.routes.values()]
        .filter((route) => trackedRouteShortNames.has(route.shortName))
        .map((route) => `${route.shortName} ${route.longName}`)
        .join("\n");
      await replyChunks(interaction, [
        [
          "**TTC Bot Status**",
          `Polling every ${config.POLL_INTERVAL_SECONDS}s`,
          `Alert channel: ${config.ALERT_CHANNEL_ID || "not configured"}`,
          "**Tracked routes**",
          tracked || "No tracked routes found in static GTFS."
        ].join("\n")
      ], true);
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
  if (!config.ALERT_CHANNEL_ID) {
    return;
  }

  let lastFingerprint = "";
  const poll = async () => {
    try {
      const channel = await client.channels.fetch(config.ALERT_CHANNEL_ID);
      if (!channel || channel.type === ChannelType.DM || !("send" in channel)) {
        console.error(`Configured ALERT_CHANNEL_ID ${config.ALERT_CHANNEL_ID} is not a text channel.`);
        return;
      }
      const alerts = await getAlerts();
      const fingerprint = alertFingerprint(alerts);
      if (fingerprint !== lastFingerprint) {
        lastFingerprint = fingerprint;
      await sendChunks(channel as TextChannel, chunkMessages(formatAlerts(alerts), "**TTC Alert Update**"));
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
    await startAlertPolling(client);
  });

  client.on(Events.InteractionCreate, handleCommand);
  await client.login(config.DISCORD_TOKEN);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
