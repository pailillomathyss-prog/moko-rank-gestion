import { PermissionFlagsBits as P } from "discord.js";
import { dayKey, dayFromOrdinal, ordinal, reached } from "./activity-store.js";

export function safeRole(guild, role, bot) {
  if (!role || role.id === guild.id || role.managed || role.permissions.bitfield !== 0n ||
      role.comparePositionTo(bot.roles.highest) >= 0 || !bot.permissions.has(P.ManageRoles)) {
    throw new Error("Rôle incompatible : choisis un rôle sans permissions, non géré par une intégration, sous le rôle du bot. Le bot doit avoir Gérer les rôles.");
  }
}
export class ActivityEngine {
  constructor(store, client) {
    this.store = store;
    this.client = client;
    this.queues = new Map();
    this.voice = new Map();
  }
  enqueue(guild, work) {
    const next = (this.queues.get(guild) ?? Promise.resolve()).then(work);
    this.queues.set(guild, next.catch((error) => console.error(`Activité ${guild}:`, error)));
    return next;
  }
  settleVoice(guild, now) {
    for (const [key, session] of this.voice) {
      if (session.guild !== guild.id) continue;
      if (now - session.since <= 120000 && now > session.since) this.store.voice(guild.id, session.user, session.since, now);
      this.voice.delete(key);
    }
    for (const state of guild.voiceStates.cache.values()) {
      if (!state.channelId || state.channelId === guild.afkChannelId || !state.member || state.member.user.bot) continue;
      this.voice.set(`${guild.id}:${state.id}`, { guild: guild.id, user: state.id, since: now });
    }
  }
  async evaluate(guild, user, now = Date.now()) {
    const config = this.store.config(guild.id, now);
    const tiers = config.tiers.filter((t) => t.role);
    if (!tiers.length) return;
    const member = await guild.members.fetch(user).catch((error) => {
      if (error.code === 10007) return null;
      throw error;
    });
    if (!member || member.user.bot) return;
    const bot = guild.members.me ?? await guild.members.fetchMe();
    const today = dayKey(now);
    const yesterday = ordinal(today) - 1;
    const period = this.store.period(config, now);
    const stats = this.store.total(config, user, now);
    for (const tier of tiers) {
      try {
        const role = await guild.roles.fetch(tier.role);
        safeRole(guild, role, bot);
        let grant = this.store.grants(guild.id, user).find((g) => g.role === role.id);
        if (grant && grant.blocked_period === null) {
          if (!member.roles.cache.has(role.id)) {
            this.store.block(guild.id, user, role.id, period);
            continue;
          }
          let failed = false;
          for (let d = ordinal(grant.checked_day) + 1; d <= yesterday; d++) {
            const day = dayFromOrdinal(d);
            if (!this.store.disrupted(day)) {
              const daily = this.store.stats(guild.id, user, day, day);
              if (!reached(daily, tier.dailyMessages, tier.dailyHours)) {
                await member.roles.remove(role, `Quota quotidien non atteint le ${day} (heure de Paris).`);
                this.store.block(guild.id, user, role.id, period);
                console.log(`Rôle activité retiré : serveur=${guild.id} membre=${user} palier=${tier.slot} jour=${day}`);
                failed = true;
                break;
              }
            }
            this.store.check(guild.id, user, role.id, day);
          }
          if (failed) continue;
          continue;
        }
        if (grant?.blocked_period >= period || member.roles.cache.has(role.id)) continue;
        if (reached(stats, tier.messages, tier.hours)) {
          await member.roles.add(role, `Quota du palier ${tier.slot} atteint.`);
          this.store.grant(guild.id, user, role.id, today);
          console.log(`Rôle activité attribué : serveur=${guild.id} membre=${user} palier=${tier.slot}`);
        }
      } catch (error) {
        console.error(`Palier ${tier.slot}, serveur ${guild.id}, membre ${user}:`, error);
      }
    }
  }
  async tick(now = Date.now()) {
    this.store.heartbeat(now);
    await Promise.all([...this.client.guilds.cache.values()].map((guild) => this.enqueue(guild.id, async () => {
      this.settleVoice(guild, now);
      const config = this.store.config(guild.id, now);
      if (!config.tiers.some((t) => t.role)) return;
      for (const user of this.store.users(guild.id)) await this.evaluate(guild, user, now);
    })));
  }
}
