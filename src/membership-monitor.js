export function createMembershipMonitor(database, client, autoJailMember) {
  const inFlight = new Set();

  async function trigger(homeGuild, member, monitoredGuild) {
    const key = `${homeGuild.id}:${member.id}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    try {
      await autoJailMember(homeGuild, member, monitoredGuild);
    } catch (error) {
      console.error(
        `Jail automatique impossible pour ${member.id} dans ${homeGuild.id}.`,
        error,
      );
    } finally {
      inFlight.delete(key);
    }
  }

  return async function onGuildMemberAdd(member) {
    const sourceGuild = member.guild;
    const sourceGuildId = sourceGuild.id;

    if (database.isMembershipMonitoringAllowed(sourceGuildId)) {
      for (const homeGuildId of database.getHomeGuildsMonitoring(sourceGuildId)) {
        if (homeGuildId === sourceGuildId) continue;
        const homeGuild = client.guilds.cache.get(homeGuildId);
        if (!homeGuild) continue;
        const homeMember = await homeGuild.members
          .fetch(member.id)
          .catch(() => null);
        if (homeMember) await trigger(homeGuild, homeMember, sourceGuild);
      }
    }

    for (const monitoredGuildId of database.getMonitoredGuilds(sourceGuildId)) {
      if (monitoredGuildId === sourceGuildId) continue;
      if (!database.isMembershipMonitoringAllowed(monitoredGuildId)) continue;
      const monitoredGuild = client.guilds.cache.get(monitoredGuildId);
      if (!monitoredGuild) continue;
      const matchingMember = await monitoredGuild.members
        .fetch(member.id)
        .catch(() => null);
      if (matchingMember) {
        await trigger(sourceGuild, member, monitoredGuild);
      }
    }
  };
}

export async function scanGuildOverlap(
  homeGuild,
  monitoredGuild,
  autoJailMember,
  isStillAuthorized = () => true,
) {
  if (!isStillAuthorized()) {
    return {
      homeMembers: 0,
      monitoredMembers: 0,
      matches: 0,
      jailed: 0,
      skipped: 0,
      failed: 0,
      cancelled: true,
    };
  }
  const homeMembers = await homeGuild.members.fetch();
  const monitoredMembers = await monitoredGuild.members.fetch();
  const result = {
    homeMembers: homeMembers.size,
    monitoredMembers: monitoredMembers.size,
    matches: 0,
    jailed: 0,
    skipped: 0,
    failed: 0,
    cancelled: false,
  };

  for (const [userId, monitoredMember] of monitoredMembers) {
    if (!isStillAuthorized()) {
      result.cancelled = true;
      break;
    }
    if (monitoredMember.user.bot || !homeMembers.has(userId)) continue;
    result.matches += 1;
    const homeMember = homeMembers.get(userId);
    try {
      if (await autoJailMember(homeGuild, homeMember, monitoredGuild)) {
        result.jailed += 1;
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      result.failed += 1;
      console.error(
        `Jail automatique impossible pour ${userId} dans ${homeGuild.id}.`,
        error,
      );
    }
  }
  return result;
}
