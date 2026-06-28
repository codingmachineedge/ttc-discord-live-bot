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
