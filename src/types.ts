export enum Role {
  WEREWOLF = 'WEREWOLF',
  SEER = 'SEER',
  WITCH = 'WITCH',
  HUNTER = 'HUNTER',
  GUARD = 'GUARD',
  IDIOT = 'IDIOT',
  VILLAGER = 'VILLAGER'
}

export enum Side {
  WEREWOLVES = 'WEREWOLVES',
  GOOD = 'GOOD'
}

export enum Phase {
  INIT = 'INIT',
  NIGHT_GUARD = 'NIGHT_GUARD',
  NIGHT_WOLVES = 'NIGHT_WOLVES',
  NIGHT_SEER = 'NIGHT_SEER',
  NIGHT_WITCH = 'NIGHT_WITCH',
  NIGHT_RESULT = 'NIGHT_RESULT',
  SHERIFF_ELECT = 'SHERIFF_ELECT',
  SHERIFF_SPEECH = 'SHERIFF_SPEECH',
  SHERIFF_VOTE = 'SHERIFF_VOTE',
  SHERIFF_RESULT = 'SHERIFF_RESULT',
  DAY_DISCUSSION = 'DAY_DISCUSSION',
  DAY_VOTING = 'DAY_VOTING',
  DAY_RESULT = 'DAY_RESULT',
  SHERIFF_ACTION = 'SHERIFF_ACTION',
  GAME_OVER = 'GAME_OVER'
}

export interface Player {
  id: number;
  name: string;
  role: Role;
  isAlive: boolean;
  isHuman: boolean;
  deathReason?: string;
  deathDay?: number;
}

export interface GameLog {
  id: string;
  day: number;
  phase: Phase;
  message: string;
  type: 'info' | 'wolf' | 'seer' | 'witch' | 'hunter' | 'guard' | 'idiot' | 'system' | 'discussion' | 'vote';
  playerName?: string;
}

export interface WitchStatus {
  hasSavePotion: boolean;
  hasPoisonPotion: boolean;
}

export interface SeerRecord {
  targetId: number;
  role: Role;
  side: Side;
}

export interface GameState {
  players: Player[];
  day: number;
  phase: Phase;
  logs: GameLog[];
  witchStatus: WitchStatus;
  seerRecords: SeerRecord[];
  winner?: Side;
  nightKilledId?: number;
  witchSavedId?: number;
  witchPoisonedId?: number;
  guardTargetId?: number;
  lastGuardTargetId?: number;
  idiotRevealedId?: number;
  hunterTargetId?: number;
  hunterMustShoot?: boolean;
  sheriffMustAct?: boolean;
  lastNightDeaths: number[]; // ids of players who died last night
  currentDiscussionIndex: number;
  votes: Record<number, number>; // voterId -> targetId
  voteReasons: Record<number, string>; // voterId -> reason
  sheriffId?: number;
  discussionDirection: 1 | -1;
  sheriffCandidates: number[];
  isSheriffElectionCompleted: boolean;
}
