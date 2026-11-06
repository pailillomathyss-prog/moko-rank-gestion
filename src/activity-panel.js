import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder,
  PermissionFlagsBits as P, RoleSelectMenuBuilder, SlashCommandBuilder,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} from "discord.js";
import { dayKey, dayFromOrdinal } from "./activity-store.js";
import { safeRole } from "./activity-engine.js";

export const activityCommand = new SlashCommandBuilder().setName("activite")
  .setDescription("Rôles et quotas d’activité.").setDMPermission(false)
  .addSubcommand((s) => s.setName("panel").setDescription("Configurer les rôles et les quotas (administrateurs)."))
  .addSubcommand((s) => s.setName("progression").setDescription("Voir mes quotas et mes rôles."))
  .addSubcommand((s) => s.setName("guide").setDescription("Comprendre l’obtention et le maintien des rôles."));

const row = (component) => new ActionRowBuilder().addComponents(component);
const formatHours = (ms) => (ms / 3600000).toFixed(2);
export function requireAdmin(member) {
  if (member.id !== member.guild.ownerId && !member.permissions.has(P.Administrator)) {
    throw new Error("Le panneau est réservé au propriétaire et aux administrateurs Discord.");
  }
}
export function parseQuotas(fields) {
  const number = (id) => Number(fields.getTextInputValue(id).trim().replace(",", "."));
  const values = { messages: number("messages"), hours: number("hours"),
    dailyMessages: number("dailyMessages"), dailyHours: number("dailyHours") };
  if (!Number.isInteger(values.messages) || values.messages < 1 || values.messages > 1000000 ||
      !Number.isInteger(values.dailyMessages) || values.dailyMessages < 1 || values.dailyMessages > 100000 ||
      !Number.isFinite(values.hours) || values.hours < 0.1 || values.hours > 336 ||
      !Number.isFinite(values.dailyHours) || values.dailyHours < 0.1 || values.dailyHours > 24) {
    throw new Error("Messages : entiers positifs (max. 1 000 000, quotidien 100 000). Vocal : 0,1 à 336 h, quotidien 0,1 à 24 h.");
  }
  return values;
}
export class ActivityPanel {
  constructor(store, engine) {
    this.store = store;
    this.engine = engine;
  }
  panel(guild, slot = 1) {
    const config = this.store.config(guild);
    const tier = config.tiers.find((t) => t.slot === slot);
    if (!tier) throw new Error("Palier invalide.");
    const next = dayFromOrdinal(config.anchor + (this.store.period(config) + 1) * 14);
    const lines = config.tiers.map((t) =>
      `**${t.slot}.** ${t.role ? `<@&${t.role}>` : "Désactivé"} · ${t.messages} msg / ${t.hours} h → quotidien ${t.dailyMessages} msg / ${t.dailyHours} h`);
    const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("Rôles d’activité — configuration")
      .setDescription(`Choisis un palier, associe un rôle et règle ses quotas.\n**Obtention : messages OU vocal. Maintien : messages OU vocal.**\nProchain reset : **${next}, 00 h, Europe/Paris**.\nLes rôles se cumulent. Un palier sans rôle est désactivé.`)
      .addFields(
        { name: "Paliers 1 à 5", value: lines.slice(0, 5).join("\n") },
        { name: "Paliers 6 à 10", value: lines.slice(5, 10).join("\n") },
        { name: "Paliers 11 à 15", value: lines.slice(10).join("\n") },
        { name: `Palier ${slot} sélectionné`, value: `Rôle : ${tier.role ? `<@&${tier.role}>` : "aucun"}\nObtention : **${tier.messages} messages OU ${tier.hours} h** sur la période.\nMaintien : **${tier.dailyMessages} messages OU ${tier.dailyHours} h** par jour dès le lendemain.` },
        { name: "Effet des modifications", value: "Les nouveaux quotas s’appliquent aux prochaines vérifications. Remplacer ou désactiver un rôle arrête son suivi sans le retirer aux membres. Le bot refuse les rôles ayant des permissions." },
      );
    return {
      embeds: [embed],
      components: [
        row(new StringSelectMenuBuilder().setCustomId("activity:tier").setPlaceholder("Choisir un palier")
          .addOptions(config.tiers.map((t) => ({ label: `Palier ${t.slot}`, value: String(t.slot), default: t.slot === slot,
            description: `${t.messages} messages ou ${t.hours} h — ${t.role ? "configuré" : "désactivé"}` })))),
        row(new RoleSelectMenuBuilder().setCustomId(`activity:role:${slot}`).setPlaceholder("Choisir le rôle de ce palier").setMinValues(1).setMaxValues(1)),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`activity:edit:${slot}`).setLabel("Modifier les quotas").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`activity:disable:${slot}`).setLabel("Désactiver sans retirer").setStyle(ButtonStyle.Secondary).setDisabled(!tier.role),
        ),
      ], allowedMentions: { parse: [] },
    };
  }
  guide() {
    return new EmbedBuilder().setColor(0x5865f2).setTitle("Comment obtenir et garder ses rôles")
      .setDescription("Chaque palier configuré possède deux objectifs alternatifs : atteindre les messages **OU** le temps vocal suffit.")
      .addFields(
        { name: "Premier palier par défaut", value: "500 messages **OU** 10 h de vocal sur la période de 14 jours. Les paliers suivants demandent davantage ; les seuils sont personnalisables." },
        { name: "Garder le rôle", value: "Dès le lendemain de son obtention : 150 messages **OU** 2 h de vocal par jour pour le premier palier. Le jour d’attribution est exempté. Exemple : rôle obtenu lundi, activité de mardi vérifiée mercredi à minuit." },
        { name: "Perte du rôle", value: "Si aucun objectif quotidien n’est atteint, le bot retire le rôle qu’il a attribué. Pour éviter une réattribution immédiate avec les anciens compteurs, ce palier ne pourra être regagné qu’à la prochaine période de 14 jours." },
        { name: "Reset et horaires", value: "Journées de minuit à minuit, heure de Paris (changements d’heure inclus). La progression se remet à zéro tous les 14 jours à partir de l’initialisation du serveur. Le reset seul ne retire pas les rôles ; le maintien quotidien continue." },
        { name: "Activité comptabilisée", value: "Messages de membres : maximum un toutes les 10 secondes, sans lire ni stocker leur contenu. Vocal : salons hors AFK, y compris seul ou muet. Bots exclus. Hors connexion du bot : aucun crédit ; les jours touchés par une interruption détectée de plus de 2 minutes sont exemptés de retrait." },
        { name: "Gestion et suivi", value: "`/activite progression` affiche tes compteurs. `/activite panel` permet aux administrateurs de choisir 15 rôles et leurs quotas. Les rôles se cumulent. Les rôles déjà présents avant attribution par le bot ne sont pas retirés par ce système." },
      );
  }
  progression(guild, user) {
    const now = Date.now();
    const config = this.store.config(guild, now);
    const total = this.store.total(config, user, now);
    const daily = this.store.stats(guild, user, dayKey(now), dayKey(now));
    const grants = this.store.grants(guild, user);
    const lines = config.tiers.filter((t) => t.role).map((t) => {
      const grant = grants.find((g) => g.role === t.role);
      const state = grant && grant.blocked_period !== null && grant.blocked_period >= this.store.period(config, now) ? "bloqué jusqu’au prochain reset"
        : grant && grant.blocked_period === null ? "attribué, maintien quotidien" : "à obtenir";
      return `**${t.slot}.** <@&${t.role}> : ${state}\nObtention ${t.messages} msg ou ${t.hours} h · Maintien ${t.dailyMessages} msg ou ${t.dailyHours} h`;
    });
    const embed = new EmbedBuilder().setColor(0x57f287).setTitle("Ma progression")
      .setDescription(`**Période :** ${total.messages} messages · ${formatHours(total.ms)} h vocal\n**Aujourd’hui :** ${daily.messages} messages · ${formatHours(daily.ms)} h vocal\nProchain reset : ${dayFromOrdinal(config.anchor + (this.store.period(config, now) + 1) * 14)}, minuit à Paris.`);
    if (!lines.length) embed.addFields({ name: "Paliers", value: "Aucun rôle configuré. Un administrateur doit ouvrir /activite panel." });
    for (let n = 0; n < lines.length; n += 4) embed.addFields({ name: `Paliers ${n + 1}–${Math.min(n + 4, lines.length)}`, value: lines.slice(n, n + 4).join("\n") });
    return { embeds: [embed], allowedMentions: { parse: [] } };
  }
  async handle(i) {
    if (!i.inGuild()) return i.reply({ content: "Utilise cette commande dans un serveur.", ephemeral: true });
    const isCommand = i.isChatInputCommand();
    if (isCommand && i.commandName !== "activite") return i.reply({ content: "Ancienne commande supprimée. Utilise /activite guide.", ephemeral: true });
    if (!isCommand && !i.customId?.startsWith("activity:")) return;
    try {
      if (isCommand && i.options.getSubcommand() === "guide") return await i.reply({ embeds: [this.guide()], ephemeral: true });
      if (isCommand && i.options.getSubcommand() === "progression") {
        await i.deferReply({ ephemeral: true });
        return await this.engine.enqueue(i.guildId, async () => {
          this.engine.settleVoice(i.guild, Date.now());
          await i.editReply(this.progression(i.guildId, i.user.id));
        });
      }
      const member = await i.guild.members.fetch({ user: i.user.id, force: true });
      requireAdmin(member);
      if (isCommand) return await i.reply({ ...this.panel(i.guildId), ephemeral: true });
      const [, action, rawSlot] = i.customId.split(":");
      const slot = action === "tier" ? Number(i.values[0]) : Number(rawSlot);
      if (!Number.isInteger(slot) || slot < 1 || slot > 15) throw new Error("Palier invalide.");
      if (action === "tier") return await i.update(this.panel(i.guildId, slot));
      if (action === "edit") {
        const tier = this.store.config(i.guildId).tiers[slot - 1];
        const modal = new ModalBuilder().setCustomId(`activity:save:${slot}`).setTitle(`Quotas du palier ${slot}`);
        for (const [key, label] of [["messages", "Messages sur 14 jours"], ["hours", "Heures vocales sur 14 jours"], ["dailyMessages", "Messages par jour pour garder le rôle"], ["dailyHours", "Heures vocales par jour pour le garder"]]) {
          modal.addComponents(row(new TextInputBuilder().setCustomId(key).setLabel(label).setStyle(TextInputStyle.Short).setRequired(true).setValue(String(tier[key])).setMaxLength(12)));
        }
        return await i.showModal(modal);
      }
      await i.deferUpdate();
      await this.engine.enqueue(i.guildId, async () => {
        const config = this.store.config(i.guildId);
        const tier = config.tiers[slot - 1];
        if (action === "save") Object.assign(tier, parseQuotas(i.fields));
        else if (action === "role") {
          const role = await i.guild.roles.fetch(i.values[0]);
          const bot = await i.guild.members.fetchMe();
          safeRole(i.guild, role, bot);
          if (config.tiers.some((t) => t.slot !== slot && t.role === role.id)) throw new Error("Ce rôle est déjà associé à un autre palier.");
          if (tier.role && tier.role !== role.id) this.store.forgetRole(i.guildId, tier.role);
          tier.role = role.id;
        } else if (action === "disable") {
          if (tier.role) this.store.forgetRole(i.guildId, tier.role);
          tier.role = null;
        } else throw new Error("Action inconnue.");
        this.store.save(config);
        await i.editReply(this.panel(i.guildId, slot));
      });
    } catch (error) {
      console.error("Panneau activité:", error);
      const payload = { content: `Action impossible : ${error.message}`.slice(0, 1900), ephemeral: true, allowedMentions: { parse: [] } };
      if (i.deferred || i.replied) await i.followUp(payload); else await i.reply(payload);
    }
  }
}
