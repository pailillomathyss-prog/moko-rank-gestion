import { PermissionFlagsBits } from "discord.js";
import { nextTestLevel } from "./test-mode.js";

export class TestSessionManager {
  constructor({
    client,
    database,
    voiceTracker,
    memberRoleLocks,
    ranks,
    ensureCurrentCycle,
    idleTimeoutMs = 10 * 60 * 1000,
  }) {
    this.client = client;
    this.database = database;
    this.voiceTracker = voiceTracker;
    this.memberRoleLocks = memberRoleLocks;
    this.ranks = ranks;
    this.ensureCurrentCycle = ensureCurrentCycle;
    this.idleTimeoutMs = idleTimeoutMs;
    this.sessions = new Map();
  }

  key(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  has(guildId, userId) {
    return this.sessions.has(this.key(guildId, userId));
  }

  async finishForGuild(guildId) {
    const activeSessions = [...this.sessions.values()].filter(
      (session) => session.guildId === guildId
    );
    for (const session of activeSessions) {
      await this.finish(session, "cycle-reset");
    }
  }

  enqueue(session, operation) {
    const previous = session.queue ?? Promise.resolve();
    const current = previous.then(operation, operation);
    session.queue = current.catch(() => undefined);
    return current;
  }

  armTimeout(session, timeoutMs = this.idleTimeoutMs) {
    if (session.timer) clearTimeout(session.timer);
    session.timer = setTimeout(() => {
      void this.finish(session, "expired").catch((error) => {
        console.error(
          `Could not restore test roles for member ${session.userId} in guild ${session.guildId}.`,
          error
        );
        if (!session.completed) this.armTimeout(session, 60_000);
      });
    }, timeoutMs);
    session.timer.unref?.();
  }

  async restoreRoles(member, session) {
    const originalRoleIds = [
      ...new Set(
        session.originalRoleIds.filter((roleId) =>
          member.guild.roles.cache.has(roleId)
        )
      ),
    ];
    const rolesToRestore = originalRoleIds
      .map((roleId) => member.guild.roles.cache.get(roleId))
      .filter((role) => role && !member.roles.cache.has(role.id));

    if (rolesToRestore.length) {
      const botMember =
        member.guild.members.me ?? (await member.guild.members.fetchMe());
      const roleAboveBot = rolesToRestore.find(
        (role) => role.position >= botMember.roles.highest.position
      );
      if (roleAboveBot) {
        throw new Error(
          `Cannot restore role ${roleAboveBot.id}; move the bot role above it.`
        );
      }
      await member.roles.add(
        rolesToRestore,
        "Restauration des rôles après le test."
      );
    }

    const originalRoleIdSet = new Set(originalRoleIds);
    const rolesToRemove = session.roleIds.filter(
      (roleId) =>
        !originalRoleIdSet.has(roleId) && member.roles.cache.has(roleId)
    );
    if (rolesToRemove.length) {
      await member.roles.remove(
        rolesToRemove,
        "Fin du test temporaire Moko Rank."
      );
    }
  }

  async finish(session, reason = "manual") {
    return this.enqueue(session, async () => {
      if (session.completed) return;
      session.finishing = true;

      try {
        const guild = this.client.guilds.cache.get(session.guildId);
        const member = guild
          ? session.member ??
            guild.members.cache.get(session.userId) ??
            (await guild.members.fetch(session.userId).catch(() => null))
          : null;

        if (member) {
          session.member = member;
          await this.restoreRoles(member, session);
          this.voiceTracker.resumeUser(guild, member);
        }

        this.database.deleteTestSession(session.guildId, session.userId);
        if (session.timer) clearTimeout(session.timer);
        session.completed = true;
        this.sessions.delete(this.key(session.guildId, session.userId));

        if (reason === "expired") {
          const channel = this.client.channels.cache.get(session.channelId);
          if (channel?.isTextBased()) {
            await channel
              .send("Le test a expiré ; les rôles précédents ont été restaurés.")
              .catch(() => undefined);
          }
        }
      } catch (error) {
        session.finishing = false;
        throw error;
      }
    });
  }

  async assignRank(member, session, level) {
    const targetRoleId = session.roleIds[level - 1];
    const targetRole = member.guild.roles.cache.get(targetRoleId);
    const botMember =
      member.guild.members.me ?? (await member.guild.members.fetchMe());
    if (
      !targetRole ||
      targetRole.managed ||
      targetRole.position >= botMember.roles.highest.position
    ) {
      throw new Error(`The configured role for rank ${level} is not manageable.`);
    }

    if (!member.roles.cache.has(targetRoleId)) {
      await member.roles.add(targetRole, `Test temporaire du palier ${level}.`);
    }

    const otherTestRoles = session.roleIds.filter(
      (roleId) => roleId !== targetRoleId && member.roles.cache.has(roleId)
    );
    if (otherTestRoles.length) {
      await member.roles.remove(
        otherTestRoles,
        "Passage au palier suivant pendant le test."
      );
    }
  }

  async handleMessage(message) {
    const session = this.sessions.get(
      this.key(message.guild.id, message.author.id)
    );
    if (!session || session.channelId !== message.channelId) return;

    try {
      await this.enqueue(session, async () => {
        if (session.completed || session.finishing) return;
        const nextLevel = nextTestLevel(session.currentLevel);
        if (!nextLevel) return;

        const member = message.member ?? session.member;
        if (!member) return;

        await this.assignRank(member, session, nextLevel);
        session.member = member;
        session.currentLevel = nextLevel;
        this.database.updateTestSessionLevel(
          session.guildId,
          session.userId,
          nextLevel
        );
        this.armTimeout(session);

        const status =
          nextLevel === this.ranks.length
            ? "Les cinq paliers ont été testés. Utilise le bouton « Terminer et restaurer » pour remettre tes rôles précédents."
            : `Message de test ${nextLevel}/${this.ranks.length} : rôle du palier ${nextLevel} attribué. Envoie un autre message pour tester le suivant.`;
        await message.reply(status);
      });
    } catch (error) {
      console.error(
        `Could not assign the next test rank to member ${session.userId} in guild ${session.guildId}.`,
        error
      );
      await message
        .reply(
          "Je n’ai pas pu attribuer le rôle de test. Vérifie les permissions et la position du rôle du bot."
        )
        .catch(() => undefined);
    }
  }

  async restoreInterrupted(guild) {
    for (const storedSession of this.database.getTestSessions(guild.id)) {
      const session = {
        ...storedSession,
        member:
          guild.members.cache.get(storedSession.userId) ??
          (await guild.members.fetch(storedSession.userId).catch(() => null)),
        queue: Promise.resolve(),
        timer: null,
        finishing: false,
        completed: false,
      };
      this.sessions.set(this.key(session.guildId, session.userId), session);
      try {
        await this.finish(session, "restart");
      } catch (error) {
        console.error(
          `Could not restore an interrupted test for member ${session.userId} in guild ${guild.id}.`,
          error
        );
        this.armTimeout(session, 60_000);
      }
    }
  }

  async handleButton(interaction) {
    if (!interaction.guild) return;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.reply({
        content:
          "Il te faut la permission **Gérer les rôles** pour lancer un test.",
        ephemeral: true,
      });
      return;
    }

    const key = this.key(interaction.guild.id, interaction.user.id);
    if (interaction.customId === "moko:test:stop") {
      const session = this.sessions.get(key);
      if (!session) {
        await interaction.reply({
          content: "Tu n’as pas de test actif à terminer.",
          ephemeral: true,
        });
        return;
      }
      await this.finish(session, "manual");
      await interaction.reply({
        content: "Test terminé ; tes rôles précédents ont été restaurés.",
        ephemeral: true,
      });
      return;
    }

    if (interaction.customId !== "moko:test:start") return;
    if (this.sessions.has(key)) {
      await interaction.reply({
        content:
          "Tu as déjà un test actif. Termine-le avant d’en lancer un autre.",
        ephemeral: true,
      });
      return;
    }

    const settings = await this.ensureCurrentCycle(interaction.guild);
    const roleIds = settings.roleIds;
    if (
      roleIds.length !== this.ranks.length ||
      roleIds.some(
        (roleId) =>
          !roleId || !interaction.guild.roles.cache.has(roleId)
      )
    ) {
      await interaction.reply({
        content: "Configure d’abord les cinq rôles avec `+panel`.",
        ephemeral: true,
      });
      return;
    }

    if (new Set(roleIds).size !== this.ranks.length) {
      await interaction.reply({
        content: "Chaque palier doit avoir un rôle différent avant le test.",
        ephemeral: true,
      });
      return;
    }

    const botMember =
      interaction.guild.members.me ??
      (await interaction.guild.members.fetchMe());
    const unmanageableRole = roleIds
      .map((roleId) => interaction.guild.roles.cache.get(roleId))
      .find(
        (role) =>
          !role ||
          role.id === interaction.guild.id ||
          role.managed ||
          role.position >= botMember.roles.highest.position
      );
    if (unmanageableRole) {
      await interaction.reply({
        content:
          "Le rôle du bot doit être placé au-dessus des cinq rôles de rang.",
        ephemeral: true,
      });
      return;
    }

    const member =
      interaction.guild.members.cache.get(interaction.user.id) ??
      (await interaction.guild.members
        .fetch(interaction.user.id)
        .catch(() => null));
    if (!member) {
      await interaction.reply({
        content: "Je n’ai pas trouvé ton membre dans ce serveur.",
        ephemeral: true,
      });
      return;
    }

    const pendingRoleUpdate = this.memberRoleLocks.get(key);
    if (pendingRoleUpdate) await pendingRoleUpdate.catch(() => undefined);
    if (this.sessions.has(key)) {
      await interaction.reply({
        content:
          "Tu as déjà un test actif. Termine-le avant d’en lancer un autre.",
        ephemeral: true,
      });
      return;
    }

    const session = {
      guildId: interaction.guild.id,
      userId: member.id,
      channelId: interaction.channelId,
      roleIds: [...roleIds],
      originalRoleIds: roleIds.filter((roleId) =>
        member.roles.cache.has(roleId)
      ),
      currentLevel: 0,
      member,
      queue: Promise.resolve(),
      timer: null,
      finishing: false,
      completed: false,
    };

    this.database.saveTestSession(session);
    this.sessions.set(key, session);
    this.voiceTracker.pauseUser(session.guildId, session.userId);
    this.armTimeout(session);
    try {
      await interaction.reply({
        content:
          "Test lancé dans ce salon. Envoie un message normal pour tester le palier 1, puis un message de plus par palier. Tes vrais compteurs ne seront pas modifiés.",
        ephemeral: true,
      });
    } catch (error) {
      await this.finish(session, "start-failed").catch((restoreError) =>
        console.error(
          `Could not clean up a failed test start for member ${session.userId}.`,
          restoreError
        )
      );
      throw error;
    }
  }
}
