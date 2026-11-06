import "dotenv/config";
import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
} from "discord.js";
import { JailDatabase } from "./database.js";
import { JailCommandHandler, jailCommand, applyJailRestriction } from "./commands.js";

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  throw new Error("DISCORD_BOT_TOKEN n’est pas défini.");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});
const database = new JailDatabase(process.env.DATA_DIR || "./data");
const handler = new JailCommandHandler(database);
const rest = new REST({ version: "10" }).setToken(token);

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Connecté comme ${readyClient.user.tag}`);
  for (const guild of readyClient.guilds.cache.values()) {
    try {
      await rest.put(Routes.applicationGuildCommands(readyClient.user.id, guild.id), {
        body: [jailCommand.toJSON()],
      });
    } catch (error) {
      console.error(`Enregistrement des commandes impossible pour ${guild.id}.`, error);
    }
  }
});

client.on(Events.GuildCreate, async (guild) => {
  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), {
      body: [jailCommand.toJSON()],
    });
  } catch (error) {
    console.error(`Enregistrement des commandes impossible pour ${guild.id}.`, error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === "jail") {
    await handler.handle(interaction);
  }
});

client.on(Events.ChannelCreate, async (channel) => {
  if (!channel.guild) return;
  const settings = database.getSettings(channel.guild.id);
  if (!settings.jail_role_id || channel.id === settings.jail_channel_id) return;
  try {
    await applyJailRestriction(channel, settings.jail_role_id);
  } catch (error) {
    console.error(`Restriction du nouveau salon impossible (${channel.id}).`, error);
  }
});

client.on(Events.Error, (error) => console.error("Erreur Discord:", error));
process.on("SIGINT", () => {
  database.close();
  client.destroy();
  process.exit(0);
});
process.on("SIGTERM", () => {
  database.close();
  client.destroy();
  process.exit(0);
});

await client.login(token);
