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
  // Interrupt phases: entered when a death triggers a pending ability,
  // then control returns to `resumePhase`.
  SHERIFF_ACTION = 'SHERIFF_ACTION',
  HUNTER_SHOOT = 'HUNTER_SHOOT',
  GAME_OVER = 'GAME_OVER'
}

export type DeathReason = '狼人猎杀' | '女巫毒杀' | '投票放逐' | '猎人带走';

/** Only these two let the hunter fire. Poison and a rival hunter's shot do not. */
export const HUNTER_CAN_SHOOT: DeathReason[] = ['狼人猎杀', '投票放逐'];

export interface Player {
  id: number;
  name: string;
  role: Role;
  isAlive: boolean;
  isHuman: boolean;
  deathReason?: DeathReason;
  deathDay?: number;
}

export interface GameLog {
  id: string;
  day: number;
  phase: Phase;
  message: string;
  type: 'info' | 'wolf' | 'seer' | 'witch' | 'hunter' | 'guard' | 'idiot' | 'system' | 'discussion' | 'vote';
  playerName?: string;
  /**
   * Private knowledge the human earned through their own role (their seer
   * checks, their wolf team's kill plan...). Shown in the human's log panel
   * but never fed to an AI, otherwise every AI would read the human's cards.
   */
  secret?: boolean;
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
  /** Bumped on every phase transition; the phase driver keys off it so a
   *  StrictMode double-render can never run a phase's AI work twice. */
  seq: number;
  logs: GameLog[];
  witchStatus: WitchStatus;
  seerRecords: SeerRecord[];
  winner?: Side;

  // ── Night bookkeeping (cleared at dawn) ──
  nightKilledId?: number;
  witchSavedId?: number;
  witchPoisonedId?: number;
  guardTargetId?: number;
  lastGuardTargetId?: number;
  nightSettled: boolean;
  lastNightDeaths: number[];

  // ── Pending death-triggered abilities ──
  hunterPendingId?: number;
  sheriffPendingHandoff: boolean;
  resumePhase?: Phase;
  resumeDay?: number;

  // ── Day ──
  idiotRevealedId?: number;
  currentDiscussionIndex: number;
  discussionDirection: 1 | -1;
  votes: Record<number, number>;      // voterId -> targetId
  voteReasons: Record<number, string>; // voterId -> reason

  // ── Sheriff ──
  sheriffId?: number;
  sheriffCandidates: number[];
  /** The human has answered the "do you run?" prompt for this election. */
  sheriffElectAnswered: boolean;
  isSheriffElectionCompleted: boolean;
}
