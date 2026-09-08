import { Role, Player, Side } from '../types';
import { PLAYER_COUNT, ROLE_CONFIG, WIN_RULE, GOD_ROLES, AI_PERSONAS } from '../constants';

export function shuffle<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

export function initializePlayers(): Player[] {
  const roles: Role[] = [];
  Object.entries(ROLE_CONFIG).forEach(([role, count]) => {
    for (let i = 0; i < count; i++) roles.push(role as Role);
  });

  const shuffledRoles = shuffle(roles);
  return Array.from({ length: PLAYER_COUNT }, (_, i) => ({
    id: i + 1,
    name: i === 0 ? '你' : (AI_PERSONAS[i + 1]?.name ?? `${i + 1}号村民`),
    role: shuffledRoles[i],
    isAlive: true,
    isHuman: i === 0,
  }));
}

export function getSide(role: Role): Side {
  return role === Role.WEREWOLF ? Side.WEREWOLVES : Side.GOOD;
}

/**
 * SIDE_KILL (屠边, the 12-player standard): wolves win the moment every god
 * is dead or every villager is dead.
 * ALL_KILL (屠城): wolves win only once they are not outnumbered.
 * Switch with WIN_RULE in constants.ts.
 */
export function checkWinner(players: Player[]): Side | null {
  const alive = players.filter(p => p.isAlive);
  const wolves = alive.filter(p => p.role === Role.WEREWOLF);
  if (wolves.length === 0) return Side.GOOD;

  if (WIN_RULE === 'ALL_KILL') {
    const good = alive.filter(p => p.role !== Role.WEREWOLF);
    return wolves.length >= good.length ? Side.WEREWOLVES : null;
  }

  const gods = alive.filter(p => GOD_ROLES.includes(p.role));
  const villagers = alive.filter(p => p.role === Role.VILLAGER);
  return gods.length === 0 || villagers.length === 0 ? Side.WEREWOLVES : null;
}

/**
 * Seating is a circle, so speaking order wraps. `dir` 1 walks up the seat
 * numbers, -1 walks down; both start at `start` and cover everyone exactly once.
 */
export function buildSpeakingOrder(aliveIds: number[], start: number, dir: 1 | -1): number[] {
  const ring = dir === 1 ? [...aliveIds] : [...aliveIds].reverse();
  const i = ring.indexOf(start);
  if (i === -1) return ring;
  return [...ring.slice(i), ...ring.slice(0, i)];
}

/** Seat that speaks first: the one after last night's casualty, else the lowest seat. */
export function firstSpeaker(aliveIds: number[], lastDeaths: number[], dir: 1 | -1): number {
  if (aliveIds.length === 0) return 0;
  if (lastDeaths.length === 0) return dir === 1 ? aliveIds[0] : aliveIds[aliveIds.length - 1];
  const dead = lastDeaths[lastDeaths.length - 1];
  const after = dir === 1
    ? aliveIds.find(id => id > dead)
    : [...aliveIds].reverse().find(id => id < dead);
  return after ?? (dir === 1 ? aliveIds[0] : aliveIds[aliveIds.length - 1]);
}

/**
 * `winner` is the single highest-weighted target, or null on a tie / no votes —
 * a tied exile vote kills nobody. `leaders` holds everyone on the top count, for
 * the one caller (the wolf pack) that must still settle on a victim.
 */
export function tallyVotes(
  votes: Record<number, number>,
  weightOf: (voterId: number) => number = () => 1
): { winner: number | null; leaders: number[]; counts: Record<number, number>; top: number } {
  const counts: Record<number, number> = {};
  Object.entries(votes).forEach(([voterId, targetId]) => {
    counts[targetId] = (counts[targetId] || 0) + weightOf(+voterId);
  });
  let top = 0;
  let leaders: number[] = [];
  Object.entries(counts).forEach(([id, c]) => {
    if (c > top) { top = c; leaders = [+id]; }
    else if (c === top) leaders.push(+id);
  });
  return { winner: leaders.length === 1 ? leaders[0] : null, leaders, counts, top };
}
