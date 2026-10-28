function isCountedVoiceState(state, guild) {
  return Boolean(
    state?.channelId &&
    state.member &&
    !state.member.user.bot &&
    state.channelId !== guild.afkChannelId
  );
}

export class VoiceTracker {
  constructor(database) {
    this.database = database;
    this.sessions = new Map();
  }

  key(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  startFromGuild(guild) {
    const now = Date.now();
    for (const state of guild.voiceStates.cache.values()) {
      if (!isCountedVoiceState(state, guild)) continue;
      this.sessions.set(this.key(guild.id, state.member.id), {
        guildId: guild.id,
        userId: state.member.id,
        member: state.member,
        startedAt: now,
      });
    }
  }

  activeDuration(guildId, userId, now = Date.now()) {
    const session = this.sessions.get(this.key(guildId, userId));
    return session ? Math.max(0, now - session.startedAt) : 0;
  }

  handleStateChange(oldState, newState, now = Date.now()) {
    const guild = newState.guild ?? oldState.guild;
    const member = newState.member ?? oldState.member;
    if (!guild || !member || member.user.bot) return null;

    const wasCounted = isCountedVoiceState(oldState, guild);
    const isCounted = isCountedVoiceState(newState, guild);
    const changedChannel = oldState.channelId !== newState.channelId;
    const key = this.key(guild.id, member.id);
    const session = this.sessions.get(key);

    if (wasCounted && (!isCounted || changedChannel)) {
      if (session) {
        this.database.addVoiceTime(
          guild.id,
          member.id,
          now - session.startedAt
        );
      }
      this.sessions.delete(key);
    }

    if (isCounted && (!wasCounted || changedChannel)) {
      this.sessions.set(key, {
        guildId: guild.id,
        userId: member.id,
        member,
        startedAt: now,
      });
    } else if (isCounted && !session) {
      this.sessions.set(key, {
        guildId: guild.id,
        userId: member.id,
        member,
        startedAt: now,
      });
    }

    return member;
  }

  flushGuildAt(guildId, timestamp) {
    const affectedMembers = [];
    for (const session of this.sessions.values()) {
      if (session.guildId !== guildId || timestamp < session.startedAt) continue;
      const elapsed = timestamp - session.startedAt;
      this.database.addVoiceTime(guildId, session.userId, elapsed);
      session.startedAt = timestamp;
      if (elapsed > 0) affectedMembers.push(session.member);
    }
    return affectedMembers;
  }
}
