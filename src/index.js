import "dotenv/config";
import { Client, Events, GatewayIntentBits, REST, Routes } from "discord.js";
import { ActivityStore, dayKey } from "./activity-store.js";
import { ActivityEngine } from "./activity-engine.js";
import { ActivityPanel, activityCommand } from "./activity-panel.js";

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) throw new Error("DISCORD_BOT_TOKEN n’est pas défini.");
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates],
});
const store = new ActivityStore(process.env.DATA_DIR || "./data");
const engine = new ActivityEngine(store, client);
const panel = new ActivityPanel(store, engine);
const rest = new REST({ version: "10" }).setToken(token);
let timer;
let ticking = false;

async function register(guild) {
  store.config(guild.id);
  try {
    // Bulk replacement removes all previous management/Jail commands.
    await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: [activityCommand.toJSON()] });
  } catch (error) { console.error(`Enregistrement des commandes ${guild.id}:`, error); }
}
async function tick() {
  if (ticking || !client.isReady()) return;
  ticking = true;
  try { await engine.tick(); } catch (error) { console.error("Vérification activité:", error); }
  finally { ticking = false; }
}
client.once(Events.ClientReady, async () => {
  console.log(`Connecté comme ${client.user.tag}. Système de quotas d’activité actif.`);
  store.heartbeat();
  for (const guild of client.guilds.cache.values()) {
    await register(guild);
    engine.settleVoice(guild, Date.now());
  }
  await tick();
  timer = setInterval(tick, 60000);
});
client.on(Events.GuildCreate, (guild) => { void register(guild); });
client.on(Events.MessageCreate, (message) => {
  if (!message.guild || message.author.bot || message.webhookId || message.system) return;
  const now = Date.now();
  void engine.enqueue(message.guild.id, () => {
    store.config(message.guild.id, now);
    store.message(message.guild.id, message.author.id, now);
  }).catch(() => {});
});
client.on(Events.VoiceStateUpdate, (_old, state) => {
  void engine.enqueue(state.guild.id, () => engine.settleVoice(state.guild, Date.now())).catch(() => {});
});
// Do not credit disconnected gateway intervals or penalize incomplete days.
client.on(Events.ShardDisconnect, () => {
  store.db.prepare("INSERT OR IGNORE INTO disrupted VALUES (?)").run(dayKey());
  engine.voice.clear();
});
client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isChatInputCommand() && !interaction.isMessageComponent() && !interaction.isModalSubmit()) return;
  void panel.handle(interaction).catch((error) => console.error("Interaction activité:", error));
});
client.on(Events.Error, (error) => console.error("Erreur Discord:", error));
async function shutdown() {
  clearInterval(timer);
  client.destroy();
  await Promise.allSettled([...engine.queues.values()]);
  store.close();
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
await client.login(token);
