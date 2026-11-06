import "dotenv/config";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Client, GatewayIntentBits } from "discord.js";
import { CommandHandler, slashCommands } from "./commands.js";
import { BotDatabase } from "./database.js";

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("DISCORD_BOT_TOKEN is not configured.");
  process.exit(1);
}

const dataDirectory = path.resolve(process.env.DATA_DIR ?? "./data");
mkdirSync(dataDirectory, { recursive: true });

const database = new BotDatabase(path.join(dataDirectory, "moko.sqlite"));
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});
const commandHandler = new CommandHandler(database);

async function registerCommands(guild) {
  try {
    await guild.commands.set(slashCommands.map((command) => command.toJSON()));
    console.info(`Slash commands registered in ${guild.name} (${guild.id}).`);
  } catch (error) {
    console.error(
      `Could not register slash commands for ${guild.id}. The bot invite must include the applications.commands scope.`,
      error,
    );
  }
}

client.once("ready", async () => {
  console.info(`Bot connected as ${client.user.tag}.`);
  for (const guild of client.guilds.cache.values()) {
    database.ensureGuild(guild.id);
    await registerCommands(guild);
  }
});

client.on("guildCreate", async (guild) => {
  database.ensureGuild(guild.id);
  await registerCommands(guild);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await commandHandler.handle(interaction);
  } catch (error) {
    console.error(`Command /${interaction.commandName} failed.`, error);
    const payload = {
      content: "La commande n’a pas pu être exécutée. Vérifie les permissions du bot.",
      ephemeral: true,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload.content).catch(() => undefined);
    } else {
      await interaction.reply(payload).catch(() => undefined);
    }
  }
});

client.login(token);
