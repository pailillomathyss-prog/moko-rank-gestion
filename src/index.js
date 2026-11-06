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
import { createMembershipMonitor } from "./membership-monitor.js";
import { ManagementStore } from "./management-store.js";
import { ManagementHandler } from "./management.js";
import { managementCommands } from "./management-commands.js";

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  throw new Error("DISCORD_BOT_TOKEN n’est pas défini.");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates],
});
const database = new JailDatabase(process.env.DATA_DIR || "./data");
const handler = new JailCommandHandler(database);
const management = new ManagementHandler(new ManagementStore(database.db), database);
const commandBody = [jailCommand, ...managementCommands].map((command) => command.toJSON());
const membershipMonitor = createMembershipMonitor(
  database,
  client,
  (guild, member, monitoredGuild) => handler.autoJail(guild, member, monitoredGuild),
);
const rest = new REST({ version: "10" }).setToken(token);

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Connecté comme ${readyClient.user.tag}`);
  for (const guild of readyClient.guilds.cache.values()) {
    try {
      await rest.put(Routes.applicationGuildCommands(readyClient.user.id, guild.id), {
        body: commandBody,
      });
    } catch (error) {
      console.error(`Enregistrement des commandes impossible pour ${guild.id}.`, error);
    }
  }
});

client.on(Events.GuildCreate, async (guild) => {
  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), {
      body: commandBody,
    });
  } catch (error) {
    console.error(`Enregistrement des commandes impossible pour ${guild.id}.`, error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    if (interaction.commandName === "jail") await handler.handle(interaction);
    else if (["gestion", "acces", "aide"].includes(interaction.commandName)) await management.handle(interaction);
  } catch (error) {
    console.error("Impossible de traiter l’interaction Discord.", error);
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

client.on(Events.GuildMemberAdd, async (member) => {
  await membershipMonitor(member);
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
