import { Role, Player, Side } from '../types';
import { PLAYER_COUNT, ROLE_CONFIG } from '../constants';

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
    for (let i = 0; i < count; i++) {
      roles.push(role as Role);
    }
  });

  // Randomly add Guard or Idiot as the 12th role (actually 11th + 12th roles are VILLAGER and something else in 10-player logic)
  // In 12-player standard: 4 Wolf, 1 Seer, 1 Witch, 1 Hunter, 1 Guard/Idiot, 4 Villager
  // My ROLE_CONFIG has 4 Wolf, 1 Seer, 1 Witch, 1 Hunter, 4 Villager (Total 11)
  // Let's add the 12th one randomly.
  const extraRole = Math.random() > 0.5 ? Role.GUARD : Role.IDIOT;
  roles.push(extraRole);

  const shuffledRoles = shuffle(roles);
  return Array.from({ length: PLAYER_COUNT }, (_, i) => ({
    id: i + 1,
    name: i === 0 ? '你' : `AI玩家${i + 1}`,
    role: shuffledRoles[i],
    isAlive: true,
    isHuman: i === 0,
  }));
}

export function getSide(role: Role): Side {
  return role === Role.WEREWOLF ? Side.WEREWOLVES : Side.GOOD;
}

export function checkWinner(players: Player[]): Side | null {
  const alivePlayers = players.filter(p => p.isAlive);
  const wolves = alivePlayers.filter(p => p.role === Role.WEREWOLF);
  const good = alivePlayers.filter(p => p.role !== Role.WEREWOLF);

  if (wolves.length === 0) return Side.GOOD;
  if (wolves.length >= good.length) return Side.WEREWOLVES;
  return null;
}
