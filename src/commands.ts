import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";
import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { config } from "./config.js";

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("ttc-alerts")
    .setDescription("Show current TTC service alerts, delays, and disruptions."),
  new SlashCommandBuilder()
    .setName("ttc-vehicles")
    .setDescription("Show live subway/LRT vehicles with next stop and delay data.")
    .addStringOption((option) =>
      option
        .setName("line")
        .setDescription("TTC subway/LRT line short name, for example 1, 2, 3, 4, 5, or 6.")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("ttc-status")
    .setDescription("Show bot feed status and tracked routes."),
  new SlashCommandBuilder()
    .setName("ttc-setup")
    .setDescription("Create or repair the TTC Live category and channels.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("ttc-settings")
    .setDescription("Manage your TTC alert notification settings.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("alerts")
        .setDescription("Turn TTC service alert pings on or off for yourself.")
        .addBooleanOption((option) =>
          option
            .setName("enabled")
            .setDescription("Whether to ping you when TTC alerts change.")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("view")
        .setDescription("Show your current TTC notification settings.")
    ),
  new SlashCommandBuilder()
    .setName("ttc-follow")
    .setDescription("Follow your current TTC vehicle and get stop-by-stop get-off reminders.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("start")
        .setDescription("Enter your vehicle number and choose where to get off.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("stop")
        .setDescription("Stop following your current trip.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("Show your current trip follower status.")
    ),
  new SlashCommandBuilder()
    .setName("ttc-line5-board")
    .setDescription("Create a live Line 5 Eglinton departure board thread.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("start")
        .setDescription("Pick a station and direction for a live departure board.")
    ),
  new SlashCommandBuilder()
    .setName("ttc-line5-status")
    .setDescription("Line 5 Eglinton status: alerts, next trains both ways, service hours, GO connections."),
  new SlashCommandBuilder()
    .setName("ttc-recommend")
    .setDescription("Suggest a lower-wait trip for a known TTC travel pattern.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("eglinton-eastbound")
        .setDescription("Recommend from Eglinton eastbound using Line 5 and hardcoded transfer choices.")
    )
].map((command) => command.toJSON());

export async function registerCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);

  if (config.COMMAND_REGISTER_MODE === "global" || !config.DISCORD_GUILD_ID) {
    await rest.put(
      Routes.applicationCommands(config.DISCORD_CLIENT_ID),
      { body: commandDefinitions }
    );
    return;
  }

  await rest.put(
    Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID),
    { body: commandDefinitions }
  );
}
