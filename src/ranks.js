export const RESET_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;

export const RANKS = Object.freeze([
  { level: 1, messages: 500, voiceHours: 10 },
  { level: 2, messages: 1_500, voiceHours: 20 },
  { level: 3, messages: 3_000, voiceHours: 45 },
  { level: 4, messages: 6_000, voiceHours: 65 },
  { level: 5, messages: 8_500, voiceHours: 100 },
]);

export function highestEligibleRank(stats) {
  return [...RANKS].reverse().find((rank) =>
    stats.messages >= rank.messages &&
    stats.voiceMs >= rank.voiceHours * 60 * 60 * 1000
  ) ?? null;
}

export function highestConfiguredRank(stats, roleIds) {
  return [...RANKS].reverse().find((rank) =>
    Boolean(roleIds[rank.level - 1]) &&
    stats.messages >= rank.messages &&
    stats.voiceMs >= rank.voiceHours * 60 * 60 * 1000
  ) ?? null;
}

export function formatCount(value) {
  return new Intl.NumberFormat("fr-FR").format(value);
}

export function formatHours(milliseconds) {
  return (milliseconds / 3_600_000).toFixed(1).replace(".", ",");
}
