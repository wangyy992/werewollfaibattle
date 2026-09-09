import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Moon, Sun, Skull, ChevronRight, Send, RotateCcw, Crown, AlertTriangle } from 'lucide-react';
import { Player, Role, Phase, GameState, GameLog, Side, DeathReason, HUNTER_CAN_SHOOT } from './types';
import { ROLE_LABELS, ROLE_ICONS } from './constants';
import {
  initializePlayers, checkWinner, getSide,
  buildSpeakingOrder, firstSpeaker, tallyVotes,
} from './lib/gameUtils';
import * as AI from './services/aiService';
import villageSquare from './assets/village-stage.png';
import { ROLE_ART, ROLE_VIDEO } from './artAssets';
import { VillageStage } from './VillageStage';
import { RoleAnimation } from './RoleAnimation';
import './stage.css';

// ── Palette ───────────────────────────────────────────────────────────────────
const RC: Record<Role, string> = {
  [Role.WEREWOLF]: '#e05252', [Role.SEER]: '#a78bfa', [Role.WITCH]: '#34d399',
  [Role.HUNTER]: '#fb923c', [Role.GUARD]: '#60a5fa', [Role.IDIOT]: '#fbbf24', [Role.VILLAGER]: '#94a3b8',
};
const PHASE_BG: Record<string, string> = {
  NIGHT: 'linear-gradient(135deg,#0f0c1a 0%,#1a0f2e 100%)',
  DAY:   'linear-gradient(135deg,#1a1200 0%,#2d1f00 100%)',
  VOTE:  'linear-gradient(135deg,#1a0000 0%,#2d0a0a 100%)',
  SHERIFF: 'linear-gradient(135deg,#001020 0%,#0a1a2e 100%)',
};

/** Linear day flow. Interrupt phases are routed through `resumePhase` instead. */
const NEXT_PHASE: Partial<Record<Phase, Phase>> = {
  [Phase.NIGHT_GUARD]:     Phase.NIGHT_WOLVES,
  [Phase.NIGHT_WOLVES]:    Phase.NIGHT_SEER,
  [Phase.NIGHT_SEER]:      Phase.NIGHT_WITCH,
  [Phase.NIGHT_WITCH]:     Phase.NIGHT_RESULT,
  [Phase.SHERIFF_ELECT]:   Phase.SHERIFF_SPEECH,
  [Phase.SHERIFF_SPEECH]:  Phase.SHERIFF_VOTE,
  [Phase.SHERIFF_VOTE]:    Phase.SHERIFF_RESULT,
  [Phase.SHERIFF_RESULT]:  Phase.DAY_DISCUSSION,
  [Phase.DAY_DISCUSSION]:  Phase.DAY_VOTING,
  [Phase.DAY_VOTING]:      Phase.DAY_RESULT,
};

const PHASE_LABEL: Record<string, string> = {
  INIT:'身份揭晓', NIGHT_GUARD:'守卫守护', NIGHT_WOLVES:'狼人出击', NIGHT_SEER:'预言家查验',
  NIGHT_WITCH:'女巫行动', NIGHT_RESULT:'黎明来临', SHERIFF_ELECT:'警长竞选',
  SHERIFF_SPEECH:'竞选发言', SHERIFF_VOTE:'警长投票', SHERIFF_RESULT:'选举结果',
  DAY_DISCUSSION:'白天辩论', DAY_VOTING:'投票放逐', DAY_RESULT:'放逐结果',
  SHERIFF_ACTION:'警徽移交', HUNTER_SHOOT:'猎人开枪', GAME_OVER:'游戏结束',
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const pick = <T,>(a: T[]): T | undefined => a.length ? a[Math.floor(Math.random() * a.length)] : undefined;
const humanIdOf = (state: GameState): number => state.players.find(p => p.isHuman)?.id ?? 1;

/**
 * How a death is announced to the table. A night death never reveals whether
 * it was a wolf kill or poison, and no death reveals the victim's role —
 * that is the whole point of the deduction game.
 */
function publicDeath(reason?: DeathReason): string {
  if (reason === '投票放逐') return '被放逐';
  if (reason === '猎人带走') return '被猎人带走';
  return '夜间出局';
}

function freshGame(): GameState {
  return {
    players: initializePlayers(),
    day: 1,
    phase: Phase.INIT,
    seq: 0,
    logs: [{
      id: 'init', day: 1, phase: Phase.INIT, type: 'system',
      message: '游戏开始！12人预女猎白标准局：4狼人 · 4平民 · 预言家 · 女巫 · 猎人 · 白痴。天黑请闭眼...',
    }],
    witchStatus: { hasSavePotion: true, hasPoisonPotion: true },
    seerRecords: [],
    nightSettled: false,
    lastNightDeaths: [],
    sheriffPendingHandoff: false,
    currentDiscussionIndex: -1,
    discussionDirection: 1,
    votes: {},
    voteReasons: {},
    sheriffCandidates: [],
    sheriffElectAnswered: false,
    isSheriffElectionCompleted: false,
  };
}

/** Kills a player in an already-cloned array. Returns the victim, or null if
 *  the target was already dead (double-targeting is legal and must be a no-op). */
function kill(players: Player[], id: number, reason: DeathReason, day: number): Player | null {
  const p = players.find(x => x.id === id);
  if (!p || !p.isAlive) return null;
  p.isAlive = false;
  p.deathDay = day;
  p.deathReason = reason;
  return p;
}

export default function App() {
  const [gs, setGs] = useState<GameState>(freshGame);
  /** Always-current state. Every async handler reads this, never the closure —
   *  otherwise a speaker mid-round would reason about a stale table. */
  const gsRef = useRef(gs);
  const [busy, setBusy] = useState(false);
  const [speech, setSpeech] = useState('');
  const [mobileTab, setMobileTab] = useState<'game' | 'players'>('game');
  const [showIdentity, setShowIdentity] = useState(true);
  const [entrance, setEntrance] = useState<'welcome' | 'draw' | 'play'>('welcome');
  const [journal, setJournal] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => setSelected(null), [gs.phase]);
  const [discussionOpen, setDiscussionOpen] = useState(false);
  const [questionTarget, setQuestionTarget] = useState<number | null>(null);
  const [questionText, setQuestionText] = useState('');
  const [questionsUsed, setQuestionsUsed] = useState(0);
  const logEnd = useRef<HTMLDivElement>(null);

  const queueRef = useRef<number[]>([]);   // remaining speakers, [0] is on stage
  const runningRef = useRef(false);        // one speech loop at a time
  const ranSeq = useRef(-1);               // last phase-entry the driver handled
  const gameEpochRef = useRef(0);          // invalidates promises from a reset game
  const actionLockRef = useRef(false);     // blocks double-clicked async actions

  useEffect(() => { logEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [gs.logs]);

  // ── State plumbing ──────────────────────────────────────────────────────────
  const commit = useCallback((patch: Partial<GameState> | ((s: GameState) => Partial<GameState>)) => {
    const p = typeof patch === 'function' ? patch(gsRef.current) : patch;
    gsRef.current = { ...gsRef.current, ...p };
    setGs(gsRef.current);
  }, []);

  const log = useCallback((e: Omit<GameLog, 'id'>) => {
    commit(s => ({ logs: [...s.logs, { ...e, id: Math.random().toString(36).slice(2, 9) }] }));
  }, [commit]);

  const say = useCallback((message: string, type: GameLog['type'] = 'system', extra: Partial<GameLog> = {}) => {
    const s = gsRef.current;
    log({ day: s.day, phase: s.phase, type, message, ...extra });
  }, [log]);

  /** Every phase change goes through here so `seq` stays the driver's key. */
  const goto = useCallback((phase: Phase, patch: Partial<GameState> = {}) => {
    commit(s => ({ ...patch, phase, seq: s.seq + 1 }));
  }, [commit]);

  /**
   * Move to `to`, but let pending death-triggered abilities cut in first.
   * They run before the win check because a dying hunter still gets his shot.
   */
  const proceedTo = useCallback((to: Phase, day?: number) => {
    const s = gsRef.current;
    const targetDay = day ?? s.day;
    if (s.sheriffPendingHandoff) { goto(Phase.SHERIFF_ACTION, { resumePhase: to, resumeDay: targetDay }); return; }
    if (s.hunterPendingId)       { goto(Phase.HUNTER_SHOOT,   { resumePhase: to, resumeDay: targetDay }); return; }
    const w = checkWinner(s.players);
    if (w) { goto(Phase.GAME_OVER, { winner: w }); return; }
    goto(to, { day: targetDay, resumePhase: undefined, resumeDay: undefined });
  }, [goto]);

  const advance = useCallback(() => {
    const s = gsRef.current;
    switch (s.phase) {
      case Phase.NIGHT_RESULT:
        return proceedTo(s.day === 1 && !s.isSheriffElectionCompleted ? Phase.SHERIFF_ELECT : Phase.DAY_DISCUSSION);
      case Phase.DAY_RESULT:
        return proceedTo(Phase.NIGHT_GUARD, s.day + 1);
      case Phase.SHERIFF_ACTION:
      case Phase.HUNTER_SHOOT:
        return proceedTo(s.resumePhase ?? Phase.DAY_DISCUSSION, s.resumeDay);
      default:
        return proceedTo(NEXT_PHASE[s.phase] ?? s.phase);
    }
  }, [proceedTo]);

  /** Flags raised by a batch of deaths: badge handoff and the hunter's shot. */
  const pendingAfter = (dead: (Player | null)[]) => {
    const s = gsRef.current;
    const victims = dead.filter((p): p is Player => !!p);
    return {
      sheriffPendingHandoff: s.sheriffPendingHandoff || victims.some(p => p.id === s.sheriffId),
      hunterPendingId: s.hunterPendingId
        ?? victims.find(p => p.role === Role.HUNTER && HUNTER_CAN_SHOOT.includes(p.deathReason!))?.id,
    };
  };

  // ── Night ───────────────────────────────────────────────────────────────────
  const runGuard = useCallback(async () => {
    const guard = gsRef.current.players.find(p => p.role === Role.GUARD && p.isAlive);
    if (!guard) { advance(); return; }
    if (guard.isHuman) return;                        // human acts through the UI
    const epoch = gameEpochRef.current;
    setBusy(true);
    const t = await AI.generateAIGuardAction(guard, gsRef.current);
    if (epoch !== gameEpochRef.current) return;
    setBusy(false);
    commit({ guardTargetId: t ?? undefined });
    advance();
  }, [advance, commit]);

  /** Every living wolf nominates; the most-nominated target dies. */
  const resolveWolfKill = useCallback(async (humanChoice?: number) => {
    if (actionLockRef.current || gsRef.current.phase !== Phase.NIGHT_WOLVES) return;
    actionLockRef.current = true;
    const epoch = gameEpochRef.current;
    setBusy(true);
    const s = gsRef.current;
    const wolves = s.players.filter(p => p.role === Role.WEREWOLF && p.isAlive);
    const votes: Record<number, number> = {};
    if (humanChoice) votes[humanIdOf(s)] = humanChoice;
    for (const w of wolves.filter(p => !p.isHuman)) {
      const t = await AI.generateAIWolfKill(w, gsRef.current);
      if (epoch !== gameEpochRef.current) return;
      if (t) votes[w.id] = t;
    }
    actionLockRef.current = false;
    setBusy(false);
    const { winner, leaders } = tallyVotes(votes);
    const final = winner ?? pick(leaders) ?? null;
    // Only a human wolf may see the pack's plan, and it stays out of AI context.
    if (wolves.some(w => w.isHuman) && final) {
      say(`[狼队] ${Object.entries(votes).map(([w, t]) => `${w}号→${t}号`).join('  ')} ｜ 最终击杀：${final}号`,
        'wolf', { secret: true });
    }
    commit({ nightKilledId: final ?? undefined });
    advance();
  }, [advance, commit, say]);

  const runSeer = useCallback(async () => {
    const seer = gsRef.current.players.find(p => p.role === Role.SEER && p.isAlive);
    if (!seer) { advance(); return; }
    if (seer.isHuman) return;
    const epoch = gameEpochRef.current;
    setBusy(true);
    const t = await AI.generateAISeerCheck(seer, gsRef.current);
    if (epoch !== gameEpochRef.current) return;
    setBusy(false);
    if (t) {
      const tgt = gsRef.current.players.find(p => p.id === t);
      if (tgt) commit(st => ({ seerRecords: [...st.seerRecords, { targetId: t, role: tgt.role, side: getSide(tgt.role) }] }));
    }
    advance();
  }, [advance, commit]);

  const runWitch = useCallback(async () => {
    const witch = gsRef.current.players.find(p => p.role === Role.WITCH && p.isAlive);
    if (!witch) { advance(); return; }
    if (witch.isHuman) return;
    const epoch = gameEpochRef.current;
    setBusy(true);
    const r = await AI.generateAIWitchAction(witch, gsRef.current);
    if (epoch !== gameEpochRef.current) return;
    setBusy(false);
    if (r.action === 'save') {
      commit(s => ({ witchSavedId: s.nightKilledId, witchStatus: { ...s.witchStatus, hasSavePotion: false } }));
    } else if (r.action === 'poison' && r.targetId) {
      commit(s => ({ witchPoisonedId: r.targetId, witchStatus: { ...s.witchStatus, hasPoisonPotion: false } }));
    }
    advance();
  }, [advance, commit]);

  const settleNight = useCallback(async () => {
    const s = gsRef.current;
    const { nightKilledId, witchSavedId, witchPoisonedId, guardTargetId, day } = s;
    const players = s.players.map(p => ({ ...p }));

    const guarded = !!nightKilledId && guardTargetId === nightKilledId;
    const saved   = !!nightKilledId && witchSavedId === nightKilledId;
    // 奶穿: guard and antidote on the same target cancel out and he dies anyway.
    const wolfKillLands = !!nightKilledId && ((!guarded && !saved) || (guarded && saved));

    const dead: (Player | null)[] = [];
    if (wolfKillLands) dead.push(kill(players, nightKilledId!, '狼人猎杀', day));
    if (witchPoisonedId) dead.push(kill(players, witchPoisonedId, '女巫毒杀', day));
    const victims = dead.filter((p): p is Player => !!p);

    commit({ players });
    say(victims.length
      ? `天亮了。昨夜出局：${victims.map(p => `${p.id}号`).join('、')}。（身份不公开）`
      : '天亮了。昨夜平安夜，无人出局。');

    commit({
      ...pendingAfter(dead),
      lastNightDeaths: victims.map(p => p.id),
      nightSettled: true,
      nightKilledId: undefined,
      witchSavedId: undefined,
      witchPoisonedId: undefined,
      lastGuardTargetId: guardTargetId,
      guardTargetId: undefined,
    });
  }, [commit, say]);

  // ── Speech queue (shared by the sheriff election and the day debate) ─────────
  const runQueue = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    const epoch = gameEpochRef.current;
    try {
      while (queueRef.current.length) {
        const id = queueRef.current[0];
        const p = gsRef.current.players.find(x => x.id === id);
        if (!p || !p.isAlive) { queueRef.current.shift(); continue; }

        commit({ currentDiscussionIndex: id });
        if (p.isHuman) return;                       // pause; submitSpeech resumes

        setBusy(true);
        const text = await AI.generateAIDiscussion(p, gsRef.current);
        if (epoch !== gameEpochRef.current) return;
        setBusy(false);
        say(text, 'discussion', { playerName: `${id}号` });
        queueRef.current.shift();
        await sleep(500);
      }
      commit({ currentDiscussionIndex: -1 });
      if (gsRef.current.phase === Phase.DAY_DISCUSSION) {
        setDiscussionOpen(true);
        say('自由讨论开始。你可以点名质疑最多三次，然后进入归票。');
      } else {
        advance();
      }
    } finally {
      runningRef.current = false;
    }
  }, [advance, commit, say]);

  const submitSpeech = () => {
    const text = speech.trim() || '（过）';
    setSpeech('');
    say(text, 'discussion', { playerName: '你' });
    queueRef.current.shift();
    runQueue();
  };

  const startDiscussion = useCallback((dir: 1 | -1) => {
    const s = gsRef.current;
    const aliveIds = s.players.filter(p => p.isAlive).map(p => p.id).sort((a, b) => a - b);
    const start = firstSpeaker(aliveIds, s.lastNightDeaths, dir);
    setDiscussionOpen(false);
    setQuestionTarget(null);
    setQuestionText('');
    setQuestionsUsed(0);
    commit({ discussionDirection: dir });
    say(s.sheriffId
      ? `警长${s.sheriffId}号决定：从${start}号开始，${dir === 1 ? '顺序' : '逆序'}发言。`
      : `本局无警长，从${start}号开始依次发言。`);
    queueRef.current = buildSpeakingOrder(aliveIds, start, dir);
    runQueue();
  }, [commit, runQueue, say]);

  const askPlayer = async () => {
    if (actionLockRef.current || !discussionOpen || questionsUsed >= 3 || !questionTarget || !questionText.trim()) return;
    const target = gsRef.current.players.find(p => p.id === questionTarget && p.isAlive && !p.isHuman);
    if (!target) return;
    actionLockRef.current = true;
    const epoch = gameEpochRef.current;
    const question = questionText.trim();
    setQuestionText('');
    say(question, 'discussion', { playerName: `你 · 质疑${target.id}号` });
    commit({ currentDiscussionIndex: target.id });
    setBusy(true);
    try {
      const reply = await AI.generateAITargetedReply(target, question, gsRef.current);
      if (epoch !== gameEpochRef.current) return;
      say(reply, 'discussion', { playerName: `${target.id}号 · 回应` });

      // One organic interjection per discussion keeps the table alive without
      // turning every question into another full speaking round.
      if (questionsUsed === 1) {
        const interjector = gsRef.current.players.find(p => p.isAlive && !p.isHuman && p.id !== target.id);
        if (interjector) {
          commit({ currentDiscussionIndex: interjector.id });
          const aside = await AI.generateAIDiscussion(interjector, gsRef.current);
          if (epoch !== gameEpochRef.current) return;
          say(aside, 'discussion', { playerName: `${interjector.id}号 · 插话` });
        }
      }
      setQuestionsUsed(n => n + 1);
    } finally {
      if (epoch === gameEpochRef.current) {
        commit({ currentDiscussionIndex: -1 });
        setBusy(false);
      }
      actionLockRef.current = false;
    }
  };

  const finishDiscussion = async () => {
    if (actionLockRef.current || !discussionOpen) return;
    actionLockRef.current = true;
    const epoch = gameEpochRef.current;
    setBusy(true);
    try {
      const aliveAI = gsRef.current.players.filter(p => p.isAlive && !p.isHuman);
      const ordered = [
        ...aliveAI.filter(p => p.id === gsRef.current.sheriffId),
        ...aliveAI.filter(p => p.id !== gsRef.current.sheriffId),
      ].slice(0, 3);
      say('讨论结束，进入归票。三位玩家将给出最后立场。');
      for (const p of ordered) {
        commit({ currentDiscussionIndex: p.id });
        const closing = await AI.generateAIClosingStatement(p, gsRef.current);
        if (epoch !== gameEpochRef.current) return;
        say(closing, 'vote', { playerName: `${p.id}号 · 归票` });
      }
      setDiscussionOpen(false);
      commit({ currentDiscussionIndex: -1 });
      advance();
    } finally {
      if (epoch === gameEpochRef.current) setBusy(false);
      actionLockRef.current = false;
    }
  };

  const startSheriffSpeech = useCallback(() => {
    const s = gsRef.current;
    const cands = s.sheriffCandidates.filter(id => s.players.find(p => p.id === id)?.isAlive);
    if (cands.length === 0) {
      say('无人上警，本局不设警长，直接进入白天发言。');
      commit({ isSheriffElectionCompleted: true });
      proceedTo(Phase.DAY_DISCUSSION);
      return;
    }
    say(`上警名单：${cands.map(id => `${id}号`).join('、')}。按座位号依次发言。`);
    queueRef.current = [...cands].sort((a, b) => a - b);
    runQueue();
  }, [commit, proceedTo, runQueue, say]);

  // ── Sheriff election ────────────────────────────────────────────────────────
  const runSheriffElection = useCallback(async () => {
    const epoch = gameEpochRef.current;
    setBusy(true);
    const cands = [...gsRef.current.sheriffCandidates];
    for (const p of gsRef.current.players.filter(x => x.isAlive && !x.isHuman)) {
      const run = await AI.generateAISheriffChoice(p, { ...gsRef.current, sheriffCandidates: cands });
      if (epoch !== gameEpochRef.current) return;
      if (run) cands.push(p.id);
    }
    setBusy(false);
    cands.sort((a, b) => a - b);
    commit({ sheriffCandidates: cands });
    advance();
  }, [advance, commit]);

  const answerSheriffRun = (run: boolean) => {
    commit(s => ({
      sheriffElectAnswered: true,
      sheriffCandidates: run ? [...s.sheriffCandidates, humanIdOf(s)] : s.sheriffCandidates,
    }));
    say(run ? '你选择上警，参与警长竞选。' : '你选择不上警。');
    runSheriffElection();
  };

  const collectSheriffVotes = useCallback(async (humanVote?: number | null) => {
    if (actionLockRef.current || gsRef.current.phase !== Phase.SHERIFF_VOTE) return;
    actionLockRef.current = true;
    const epoch = gameEpochRef.current;
    setBusy(true);
    const s = gsRef.current;
    const votes: Record<number, number> = {};
    const reasons: Record<number, string> = {};
    const human = s.players.find(p => p.isHuman);
    const humanVotes = !!human?.isAlive && !s.sheriffCandidates.includes(human.id);
    if (humanVotes) {
      if (humanVote) { votes[human!.id] = humanVote; reasons[human!.id] = '你的投票。'; }
      say(humanVote ? `投${humanVote}号。` : '弃权。', 'vote', { playerName: '你' });
    }
    for (const v of s.players.filter(p => p.isAlive && !p.isHuman && !s.sheriffCandidates.includes(p.id))) {
      const r = await AI.generateAIVote(v, gsRef.current, s.sheriffCandidates);
      if (epoch !== gameEpochRef.current) return;
      if (r.voteId) { votes[v.id] = r.voteId; reasons[v.id] = r.reason; }
      say(r.voteId ? `投${r.voteId}号。${r.reason}` : `弃权。${r.reason}`, 'vote', { playerName: `${v.id}号` });
    }
    setBusy(false);
    actionLockRef.current = false;
    const { winner, top } = tallyVotes(votes);
    say(winner ? `🏅 ${winner}号以${top}票当选警长！` : '警长竞选平票，本局不设警长。');
    commit({ sheriffId: winner ?? undefined, isSheriffElectionCompleted: true, votes, voteReasons: reasons });
    advance();
  }, [advance, commit, say]);

  // ── Day vote ────────────────────────────────────────────────────────────────
  const runDayVote = useCallback(async (humanVote?: number | null) => {
    if (actionLockRef.current || gsRef.current.phase !== Phase.DAY_VOTING) return;
    actionLockRef.current = true;
    const epoch = gameEpochRef.current;
    setBusy(true);
    const s = gsRef.current;
    const votes: Record<number, number> = {};
    const reasons: Record<number, string> = {};
    const human = s.players.find(p => p.isHuman);
    const humanVotes = !!human?.isAlive && s.idiotRevealedId !== human.id;
    if (humanVotes) {
      if (humanVote) { votes[human!.id] = humanVote; reasons[human!.id] = '你的投票。'; }
      say(humanVote ? `投${humanVote}号。` : '弃权。', 'vote', { playerName: '你' });
    }
    for (const v of s.players.filter(p => p.isAlive && !p.isHuman && s.idiotRevealedId !== p.id)) {
      const r = await AI.generateAIVote(v, gsRef.current);
      if (epoch !== gameEpochRef.current) return;
      if (r.voteId) { votes[v.id] = r.voteId; reasons[v.id] = r.reason; }
      say(r.voteId ? `投${r.voteId}号。${r.reason}` : `弃权。${r.reason}`, 'vote', { playerName: `${v.id}号` });
    }
    setBusy(false);
    actionLockRef.current = false;

    // The sheriff's ballot is worth 1.5. A tie exiles nobody.
    const { winner, top } = tallyVotes(votes, id => (id === s.sheriffId ? 1.5 : 1));
    commit({ votes, voteReasons: reasons });

    if (!winner) {
      say('平票，本轮无人被放逐。');
    } else {
      const players = s.players.map(p => ({ ...p }));
      const target = players.find(p => p.id === winner)!;
      if (target.role === Role.IDIOT && !s.idiotRevealedId) {
        commit({ idiotRevealedId: winner });
        say(`🃏 ${winner}号翻牌：白痴！免疫放逐，此后失去投票权，但仍可发言。`, 'idiot');
      } else {
        const victim = kill(players, winner, '投票放逐', s.day);
        commit({ players });
        say(`⚖️ ${winner}号被放逐（${top}票）。（身份不公开）`);
        commit(pendingAfter([victim]));
      }
    }
    advance();
  }, [advance, commit, say]);

  // ── Death-triggered abilities ───────────────────────────────────────────────
  const doHandoff = useCallback((t: number | null) => {
    say(t ? `🏅 警长将警徽传给${t}号。` : '🏅 警长撕毁了警徽，本局不再有警长。');
    commit({ sheriffId: t ?? undefined, sheriffPendingHandoff: false });
    advance();
  }, [advance, commit, say]);

  const runSheriffHandoff = useCallback(async () => {
    const s = gsRef.current;
    const sheriff = s.players.find(p => p.id === s.sheriffId);
    if (!sheriff) { commit({ sheriffPendingHandoff: false, sheriffId: undefined }); advance(); return; }
    if (sheriff.isHuman) return;
    const epoch = gameEpochRef.current;
    setBusy(true);
    const t = await AI.generateAISheriffAction(sheriff, gsRef.current);
    if (epoch !== gameEpochRef.current) return;
    setBusy(false);
    doHandoff(t);
  }, [advance, commit, doHandoff]);

  const doHunterShot = useCallback((t: number | null) => {
    const s = gsRef.current;
    const hunterId = s.hunterPendingId!;
    if (!t) {
      say(`🏹 ${hunterId}号亮出猎人身份，选择不开枪。`, 'hunter');
      commit({ hunterPendingId: undefined });
      advance();
      return;
    }
    const players = s.players.map(p => ({ ...p }));
    const victim = kill(players, t, '猎人带走', s.day);
    commit({ players, hunterPendingId: undefined });
    say(`🏹 ${hunterId}号亮出猎人身份，开枪带走${t}号！`, 'hunter');
    commit(st => ({
      sheriffPendingHandoff: st.sheriffPendingHandoff || (!!victim && victim.id === st.sheriffId),
      lastNightDeaths: victim ? [...st.lastNightDeaths, victim.id] : st.lastNightDeaths,
    }));
    advance();
  }, [advance, commit, say]);

  const runHunterShot = useCallback(async () => {
    const s = gsRef.current;
    const hunter = s.players.find(p => p.id === s.hunterPendingId);
    if (!hunter) { commit({ hunterPendingId: undefined }); advance(); return; }
    if (hunter.isHuman) return;
    const epoch = gameEpochRef.current;
    setBusy(true);
    const t = await AI.generateAIHunterShoot(hunter, gsRef.current);
    if (epoch !== gameEpochRef.current) return;
    setBusy(false);
    doHunterShot(t);
  }, [advance, commit, doHunterShot]);

  // ── Phase driver ────────────────────────────────────────────────────────────
  // Keyed on `seq`, so StrictMode's double-invoke can never run a phase twice.
  useEffect(() => {
    if (ranSeq.current === gs.seq) return;
    ranSeq.current = gs.seq;
    const s = gsRef.current;
    const human = s.players.find(p => p.isHuman);

    switch (s.phase) {
      case Phase.NIGHT_GUARD:
        commit({
          nightSettled: false, currentDiscussionIndex: -1,
          nightKilledId: undefined, witchSavedId: undefined, witchPoisonedId: undefined,
          guardTargetId: undefined, votes: {}, voteReasons: {},
        });
        runGuard();
        break;

      case Phase.NIGHT_WOLVES: {
        const wolves = s.players.filter(p => p.role === Role.WEREWOLF && p.isAlive);
        if (wolves.length === 0) { advance(); break; }
        if (wolves.some(w => w.isHuman)) break;      // human wolf nominates in the UI
        resolveWolfKill();
        break;
      }

      case Phase.NIGHT_SEER:   runSeer(); break;
      case Phase.NIGHT_WITCH:  runWitch(); break;
      case Phase.NIGHT_RESULT: settleNight(); break;

      case Phase.SHERIFF_ELECT:
        if (human?.isAlive && !s.sheriffElectAnswered) break;   // ask the human first
        runSheriffElection();
        break;

      case Phase.SHERIFF_SPEECH: startSheriffSpeech(); break;

      case Phase.SHERIFF_VOTE: {
        const humanVotes = !!human?.isAlive && !s.sheriffCandidates.includes(human.id);
        if (humanVotes) break;                        // human ballot comes from the UI
        collectSheriffVotes();
        break;
      }

      case Phase.DAY_DISCUSSION: {
        const sheriff = s.players.find(p => p.id === s.sheriffId && p.isAlive);
        if (sheriff?.isHuman) break;                  // human sheriff picks direction
        startDiscussion(sheriff ? (Math.random() < 0.5 ? 1 : -1) : 1);
        break;
      }

      case Phase.DAY_VOTING: {
        const humanVotes = !!human?.isAlive && s.idiotRevealedId !== human.id;
        if (humanVotes) break;
        runDayVote();
        break;
      }

      case Phase.SHERIFF_ACTION: runSheriffHandoff(); break;
      case Phase.HUNTER_SHOOT:   runHunterShot(); break;
      default: break;                                  // NIGHT_RESULT ack, results, GAME_OVER
    }
  }, [gs.seq, advance, commit, runGuard, resolveWolfKill, runSeer, runWitch, settleNight,
      runSheriffElection, startSheriffSpeech, collectSheriffVotes, startDiscussion, runDayVote,
      runSheriffHandoff, runHunterShot]);

  // ── Human night actions ─────────────────────────────────────────────────────
  const hGuard = (t: number | null) => {
    if (gsRef.current.phase !== Phase.NIGHT_GUARD) return;
    commit({ guardTargetId: t ?? undefined });
    say(t ? `你守护了${t}号。` : '你选择空守。', 'guard', { secret: true });
    advance();
  };
  const hCheck = (id: number) => {
    if (gsRef.current.phase !== Phase.NIGHT_SEER) return;
    const t = gsRef.current.players.find(p => p.id === id)!;
    const side = getSide(t.role);
    commit(s => ({ seerRecords: [...s.seerRecords, { targetId: id, role: t.role, side }] }));
    say(`查验${id}号：${side === Side.GOOD ? '✅ 好人' : '❌ 狼人'}`, 'seer', { secret: true });
    advance();
  };
  const hWitch = (action: 'save' | 'poison' | 'skip', id?: number) => {
    if (gsRef.current.phase !== Phase.NIGHT_WITCH) return;
    if (action === 'save') {
      commit(s => ({ witchSavedId: s.nightKilledId, witchStatus: { ...s.witchStatus, hasSavePotion: false } }));
      say('你使用了解药。', 'witch', { secret: true });
    } else if (action === 'poison' && id) {
      commit(s => ({ witchPoisonedId: id, witchStatus: { ...s.witchStatus, hasPoisonPotion: false } }));
      say(`你毒杀了${id}号。`, 'witch', { secret: true });
    } else {
      say('你没有使用任何药。', 'witch', { secret: true });
    }
    advance();
  };

  const reset = () => {
    gameEpochRef.current += 1;
    actionLockRef.current = false;
    queueRef.current = [];
    runningRef.current = false;
    ranSeq.current = -1;
    setSpeech('');
    setBusy(false);
    setShowIdentity(true);
    setEntrance('welcome');
    setDiscussionOpen(false);
    setQuestionTarget(null);
    setQuestionText('');
    setQuestionsUsed(0);
    gsRef.current = freshGame();
    setGs(gsRef.current);
  };

  // ── Derived view state ──────────────────────────────────────────────────────
  const hp = gs.players.find(p => p.isHuman);
  const hid = hp?.id ?? 1;
  const hr = hp?.role ?? Role.VILLAGER;
  const ha = !!hp?.isAlive;
  const { phase, day } = gs;
  const over = phase === Phase.GAME_OVER;
  const isNight = phase.startsWith('NIGHT');
  const alive = gs.players.filter(p => p.isAlive);
  const bg = isNight ? PHASE_BG.NIGHT
    : phase.startsWith('SHERIFF') ? PHASE_BG.SHERIFF
    : (phase === Phase.DAY_VOTING || phase === Phase.DAY_RESULT) ? PHASE_BG.VOTE
    : PHASE_BG.DAY;

  const iAm = (role: Role) => ha && hr === role;
  const pendingHunterIsHuman = gs.hunterPendingId === hid;
  const sheriffIsHuman = gs.sheriffId === hid;
  const humanIsSheriffVoter = ha && !gs.sheriffCandidates.includes(hid);
  const humanCanDayVote = ha && gs.idiotRevealedId !== hid;
  const waitingForMe =
    (phase === Phase.NIGHT_GUARD && iAm(Role.GUARD)) ||
    (phase === Phase.NIGHT_WOLVES && iAm(Role.WEREWOLF)) ||
    (phase === Phase.NIGHT_SEER && iAm(Role.SEER)) ||
    (phase === Phase.NIGHT_WITCH && iAm(Role.WITCH));

  const stageCandidates = alive.filter(p => {
    if (phase === Phase.SHERIFF_VOTE) return gs.sheriffCandidates.includes(p.id);
    if (phase === Phase.NIGHT_WOLVES) return p.role !== Role.WEREWOLF;
    if (phase === Phase.NIGHT_SEER) return !p.isHuman && !gs.seerRecords.some(r=>r.targetId===p.id);
    if (phase === Phase.NIGHT_WITCH) return !p.isHuman && p.id!==gs.nightKilledId;
    return !p.isHuman && (phase !== Phase.DAY_VOTING || p.id!==gs.idiotRevealedId);
  }).map(p=>p.id);
  const stageSelectable = !busy && ((phase===Phase.DAY_VOTING && humanCanDayVote) ||
    (phase===Phase.SHERIFF_VOTE && humanIsSheriffVoter) ||
    (phase===Phase.NIGHT_WOLVES && iAm(Role.WEREWOLF)) ||
    (phase===Phase.NIGHT_SEER && iAm(Role.SEER)) ||
    (phase===Phase.NIGHT_WITCH && iAm(Role.WITCH) && gs.witchStatus.hasPoisonPotion) ||
    (phase===Phase.HUNTER_SHOOT && pendingHunterIsHuman) ||
    (phase===Phase.SHERIFF_ACTION && sheriffIsHuman));
  const selectionLabel = selected ? `已选择 ${selected}号 · ${gs.players.find(p=>p.id===selected)?.name}` : '点击广场上的人物选择目标';
  const beginNight = () => {
    setShowIdentity(false);
    goto(Phase.NIGHT_GUARD);
  };

  useEffect(() => { setMobileTab('game'); }, [gs.phase, gs.currentDiscussionIndex]);

  return (
    <div className="game-shell h-[100dvh] flex flex-col overflow-hidden text-white"
      style={{
        backgroundImage: `linear-gradient(rgba(4,8,15,.08),rgba(4,7,13,.26)),url(${villageSquare})`,
        fontFamily: "'Noto Serif SC','Songti SC',serif",
      }}>

      {entrance !== 'play' && <div className="entrance-screen"><small>十二个村民 · 一个秘密</small><h1>灰雾村</h1><p>{entrance === 'welcome' ? '钟声响过，谁还能见到黎明？' : '触碰一张牌，揭开你的命运。座位将随机分配。'}</p>{entrance === 'welcome' ? <button onClick={() => setEntrance('draw')}>进入村庄</button> : <div className="draw-deck">{Array.from({length:12},(_,i)=><button key={i} style={{animationDelay:`${i*.045}s`}} aria-label={`抽取第${i+1}张身份牌`} onClick={()=>setEntrance('play')}><span>☽</span><small>灰雾村</small></button>)}</div>}</div>}
      {entrance === 'play' && showIdentity && hp && (
        <div className={`identity-reveal identity-${hr.toLowerCase()}`} role="dialog" aria-modal="true">
          <img className="identity-hero" src={ROLE_ART[hr]} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} />
          <video className="identity-video" src={ROLE_VIDEO[hr]} autoPlay muted playsInline
            poster={ROLE_ART[hr]} onError={e => { e.currentTarget.style.display = 'none'; }} />
          <div className="reveal-moon" />
          <div className="reveal-mist reveal-mist-a" />
          <div className="reveal-mist reveal-mist-b" />
          <motion.div className="identity-card"
            initial={{ opacity: 0, rotateY: 90, scale: .82 }}
            animate={{ opacity: 1, rotateY: 0, scale: 1 }}
            transition={{ duration: .9, ease: [0.16, 1, 0.3, 1] }}>
            <div className="identity-kicker">命运已经落定</div>
            <motion.div className="identity-sigil"
              animate={{ scale: [1, 1.08, 1], filter: ['brightness(1)', 'brightness(1.4)', 'brightness(1)'] }}
              transition={{ duration: 2.4, repeat: Infinity }}>
              {ROLE_ICONS[hr]}
            </motion.div>
            <div className="identity-title">{ROLE_LABELS[hr]}</div>
            <div className="identity-oath">
              {hr === Role.WEREWOLF && '月色会掩盖你的利爪。认清同伴，活到最后。'}
              {hr === Role.SEER && '星辰只向你吐露真相。每夜查验一人的阵营。'}
              {hr === Role.WITCH && '生与死各在一瓶药里。选择比力量更重要。'}
              {hr === Role.VILLAGER && '你没有神力，只有判断。听清每一句谎言。'}
              {hr === Role.HUNTER && '你的枪只响一次。让最后一颗子弹指向黑暗。'}
              {hr === Role.IDIOT && '荒诞是你的护甲。被放逐时，揭开真正的身份。'}
              {hr === Role.GUARD && '守护尚未被黑夜吞没的人。'}
            </div>
            {hr === Role.WEREWOLF && (
              <div className="identity-allies">同伴 · {gs.players.filter(p => p.role === Role.WEREWOLF && !p.isHuman).map(p => `${p.id}号 ${p.name}`).join(' · ')}</div>
            )}
            <button className="enter-village" onClick={beginNight}>进入村庄</button>
          </motion.div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden min-h-0">

        <main className="scene-main">
          <header className="scene-header"><div className="village-brand">灰雾村 <small>THE HOLLOW</small></div><div className="phase-chip">{isNight ? <Moon size={18}/> : <Sun size={18}/>} 第 {day} 天 · {PHASE_LABEL[phase]}</div><nav><button onClick={()=>setJournal(!journal)}>卷宗 {journal ? '收起' : '展开'}</button><button onClick={reset} aria-label="重新开始"><RotateCcw size={16}/></button></nav></header>
          <VillageStage players={gs.players} activeId={gs.currentDiscussionIndex} sheriffId={gs.sheriffId}
            idiotId={gs.idiotRevealedId} humanRole={hr} revealAll={over} selected={selected}
            seerRecords={hr===Role.SEER ? gs.seerRecords : []}
            selectable={stageSelectable}
            candidates={stageCandidates}
            onSelect={setSelected} logs={gs.logs} busy={busy}/>
          <div className="private-identity"><img src={ROLE_ART[hr]} alt=""/><div><small>{hid}号 · 你的身份</small><strong>{ROLE_LABELS[hr]}</strong><span>{alive.length}/12 人存活</span><RoleAnimation role={hr}/></div></div>
          {journal && <aside className="journal-drawer"><header><h2>村庄卷宗</h2><button onClick={()=>setJournal(false)}>关闭 ×</button></header><div>{gs.logs.map(l=><article key={l.id}><small>第{l.day}天 · {l.playerName || '守夜人'} {l.secret && '· 仅你可见'}</small><p>{l.message}</p></article>)}</div></aside>}
          {/* ── Action panel ── */}
          <div className="scene-actions">
            {/* Deliberately NOT wrapped in AnimatePresence: night phases can advance
                faster than an exit animation completes, and mode="wait" would then
                hold the old panel forever and never mount the new controls. */}
            <motion.div key={`${phase}-${gs.currentDiscussionIndex}-${gs.seq}`}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-2xl">

                {/* Night — the human's own role */}
                {phase === Phase.NIGHT_GUARD && iAm(Role.GUARD) && (
                  <Panel label="守卫：选择守护目标" color={RC[Role.GUARD]}>
                    <Btns>
                      {alive.filter(p => p.id !== gs.lastGuardTargetId).map(p =>
                        <Btn key={p.id} color={RC[Role.GUARD]} onClick={() => hGuard(p.id)}>{p.id}号</Btn>)}
                      <Btn color="#555" onClick={() => hGuard(null)}>空守</Btn>
                    </Btns>
                  </Panel>
                )}

                {phase === Phase.NIGHT_WOLVES && iAm(Role.WEREWOLF) && (
                  <Panel label="狼人：提名今晚的击杀目标" color={RC[Role.WEREWOLF]}>
                    <div className="text-center text-xs mb-3 px-3 py-2 rounded-lg"
                      style={{ background: 'rgba(224,82,82,0.1)', border: '1px solid rgba(224,82,82,0.25)' }}>
                      <span className="opacity-50">🐺 队友：</span>
                      <span className="font-bold ml-1" style={{ color: '#e05252' }}>
                        {gs.players.filter(p => p.role === Role.WEREWOLF && p.id !== hid && p.isAlive).map(p => `${p.id}号`).join('、') || '无'}
                      </span>
                      <div className="text-[10px] opacity-30 mt-0.5">所有狼人各提名一人，得票最多者被击杀</div>
                    </div>
                    <Btns>
                      <p className="selection-hint">{selectionLabel}</p>{selected && <Btn color={RC[Role.WEREWOLF]} onClick={()=>resolveWolfKill(selected)}>确认猎杀 {selected}号</Btn>}
                    </Btns>
                  </Panel>
                )}

                {phase === Phase.NIGHT_SEER && iAm(Role.SEER) && (
                  <Panel label="预言家：选择查验目标" color={RC[Role.SEER]}>
                    <Btns>
                      <p className="selection-hint">{selectionLabel}</p>{selected && <Btn color={RC[Role.SEER]} onClick={()=>hCheck(selected)}>查验 {selected}号</Btn>}
                    </Btns>
                  </Panel>
                )}

                {phase === Phase.NIGHT_WITCH && iAm(Role.WITCH) && (
                  <Panel label="女巫：使用你的药" color={RC[Role.WITCH]}>
                    <div className="text-center text-[11px] mb-2 opacity-40">
                      {gs.nightKilledId
                        ? (gs.nightKilledId === hid ? '今晚被刀的是你自己，不可自救。' : `今晚 ${gs.nightKilledId}号 被狼人击杀。`)
                        : '今晚无人被击杀。'}
                    </div>
                    <Btns>
                      {gs.witchStatus.hasSavePotion && !!gs.nightKilledId && gs.nightKilledId !== hid && (
                        <Btn color={RC[Role.WITCH]} onClick={() => hWitch('save')}>💊 救{gs.nightKilledId}号</Btn>
                      )}
                      {gs.witchStatus.hasPoisonPotion && <p className="selection-hint">{selectionLabel} · 使用毒药</p>}{selected && gs.witchStatus.hasPoisonPotion && <Btn color={RC[Role.WEREWOLF]} onClick={()=>hWitch('poison',selected)}>确认毒杀 {selected}号</Btn>}
                      <Btn color="#555" onClick={() => hWitch('skip')}>不操作</Btn>
                    </Btns>
                  </Panel>
                )}

                {isNight && phase !== Phase.NIGHT_RESULT && !waitingForMe && (
                  <p className="text-center opacity-25 text-sm italic">
                    {ha ? '黑夜漫漫，请闭眼...' : '你已出局，静静旁观这一夜...'}
                  </p>
                )}

                {phase === Phase.NIGHT_RESULT && gs.nightSettled && (
                  <CenterBtn onClick={advance}>确认，天亮了</CenterBtn>
                )}

                {/* Hunter — reachable whether he died at night or on the stake */}
                {phase === Phase.HUNTER_SHOOT && pendingHunterIsHuman && (
                  <Panel label="你是猎人，出局后可开枪带走一人" color={RC[Role.HUNTER]}>
                    <Btns>
                      <p className="selection-hint">{selectionLabel}</p>{selected && <Btn color={RC[Role.HUNTER]} onClick={()=>doHunterShot(selected)}>确认开枪 {selected}号</Btn>}
                      <Btn color="#555" onClick={() => doHunterShot(null)}>放弃开枪</Btn>
                    </Btns>
                  </Panel>
                )}
                {phase === Phase.HUNTER_SHOOT && !pendingHunterIsHuman && (
                  <p className="text-center opacity-40 text-sm italic">猎人正在选择枪口方向...</p>
                )}

                {/* Sheriff election */}
                {phase === Phase.SHERIFF_ELECT && ha && !gs.sheriffElectAnswered && (
                  <Panel label="警长竞选：你要上警吗？" color="#fbbf24">
                    <div className="text-xs text-center mb-3 opacity-50">上警后需要公开发言，未上警则只能投票。</div>
                    <Btns>
                      <Btn color="#fbbf24" onClick={() => answerSheriffRun(true)}>⬆️ 上警竞选</Btn>
                      <Btn color="#555" onClick={() => answerSheriffRun(false)}>放弃竞选</Btn>
                    </Btns>
                  </Panel>
                )}
                {phase === Phase.SHERIFF_ELECT && (!ha || gs.sheriffElectAnswered) && (
                  <p className="text-center opacity-40 text-sm italic">其他玩家正在决定是否上警...</p>
                )}

                {phase === Phase.SHERIFF_SPEECH && gs.currentDiscussionIndex === hid && (
                  <div className="space-y-2">
                    <div className="text-center text-[11px] opacity-50">
                      轮到你竞选发言 · 上警名单：{gs.sheriffCandidates.map(id => `${id}号`).join('、')}
                    </div>
                    <SpeechBox value={speech} onChange={setSpeech} onSubmit={submitSpeech} placeholder="输入你的竞选发言（留空则过）..." />
                  </div>
                )}
                {phase === Phase.SHERIFF_SPEECH && gs.currentDiscussionIndex > 0 && gs.currentDiscussionIndex !== hid && (
                  <p className="text-center opacity-40 text-sm italic">{gs.currentDiscussionIndex}号正在竞选发言...</p>
                )}

                {phase === Phase.SHERIFF_VOTE && humanIsSheriffVoter && (
                  <Panel label="投票选出警长" color="#fbbf24">
                    <Btns>
                      <p className="selection-hint">{selected ? `已选择 ${selected}号` : '点击广场上的候选人'}</p>
                      {selected && <Btn color="#fbbf24" onClick={() => collectSheriffVotes(selected)}>确认选举 {selected}号</Btn>}
                      <Btn color="#555" onClick={() => collectSheriffVotes(null)}>弃权</Btn>
                    </Btns>
                  </Panel>
                )}
                {phase === Phase.SHERIFF_VOTE && !humanIsSheriffVoter && (
                  <p className="text-center opacity-40 text-sm italic">
                    {gs.sheriffCandidates.includes(hid) ? '你是候选人，不参与投票。等待计票...' : '正在计票...'}
                  </p>
                )}
                {phase === Phase.SHERIFF_RESULT && <CenterBtn onClick={advance}>确认结果</CenterBtn>}

                {phase === Phase.SHERIFF_ACTION && sheriffIsHuman && (
                  <Panel label="你出局了，移交或撕毁警徽" color="#fbbf24">
                    <Btns>
                      <p className="selection-hint">{selectionLabel}</p>{selected && <Btn color="#fbbf24" onClick={()=>doHandoff(selected)}>传给 {selected}号</Btn>}
                      <Btn color={RC[Role.WEREWOLF]} onClick={() => doHandoff(null)}>撕毁警徽</Btn>
                    </Btns>
                  </Panel>
                )}
                {phase === Phase.SHERIFF_ACTION && !sheriffIsHuman && (
                  <p className="text-center opacity-40 text-sm italic">警长正在决定警徽归属...</p>
                )}

                {/* Day */}
                {phase === Phase.DAY_DISCUSSION && !discussionOpen && gs.currentDiscussionIndex === -1 && sheriffIsHuman && ha && (
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-xs opacity-40">你是警长，决定今天的发言方向：</p>
                    <Btns>
                      <Btn color="#fbbf24" onClick={() => startDiscussion(1)}>顺序发言 →</Btn>
                      <Btn color="#fbbf24" onClick={() => startDiscussion(-1)}>← 逆序发言</Btn>
                    </Btns>
                  </div>
                )}
                {phase === Phase.DAY_DISCUSSION && gs.currentDiscussionIndex === hid && (
                  <SpeechBox value={speech} onChange={setSpeech} onSubmit={submitSpeech} placeholder="轮到你发言（留空则过）..." />
                )}
                {phase === Phase.DAY_DISCUSSION && gs.currentDiscussionIndex > 0 && gs.currentDiscussionIndex !== hid && (
                  <p className="text-center opacity-40 text-sm italic">{gs.currentDiscussionIndex}号正在发言...</p>
                )}

                {phase === Phase.DAY_DISCUSSION && discussionOpen && gs.currentDiscussionIndex === -1 && (
                  <div className="open-floor">
                    <div className="open-floor-head">
                      <div><span>自由讨论</span><small>还可质疑 {3 - questionsUsed} 次</small></div>
                      <button onClick={finishDiscussion}>结束讨论 · 进入归票</button>
                    </div>
                    {questionsUsed < 3 && ha && (
                      <>
                        <div className="target-strip">
                          {alive.filter(p => !p.isHuman).map(p => (
                            <button key={p.id} className={questionTarget === p.id ? 'selected' : ''}
                              onClick={() => setQuestionTarget(p.id)}>{p.id}号 {p.name}</button>
                          ))}
                        </div>
                        <div className="question-compose">
                          <textarea value={questionText} onChange={e => setQuestionText(e.target.value)} maxLength={180}
                            placeholder={questionTarget ? `直接质疑${questionTarget}号，例如：你上一轮说信3号，为什么最后投了5号？` : '先选择一名玩家…'} />
                          <button onClick={askPlayer} disabled={!questionTarget || !questionText.trim()}>点名质疑</button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {phase === Phase.DAY_VOTING && humanCanDayVote && (
                  <Panel label={`投票放逐${gs.sheriffId ? ` · 警长${gs.sheriffId}号 1.5票` : ''}`} color={RC[Role.WEREWOLF]}>
                    <Btns>
                      <p className="selection-hint">{selected ? `已选择 ${selected}号` : '点击广场上的人物，选择放逐目标'}</p>
                      {selected && <Btn color={RC[Role.WEREWOLF]} onClick={() => runDayVote(selected)}>确认放逐 {selected}号</Btn>}
                      <Btn color="#555" onClick={() => runDayVote(null)}>弃权</Btn>
                    </Btns>
                  </Panel>
                )}
                {phase === Phase.DAY_VOTING && !humanCanDayVote && (
                  <p className="text-center opacity-25 text-sm italic">
                    {ha ? '你已翻牌白痴，失去投票权。统计投票中...' : '统计投票中...'}
                  </p>
                )}
                {phase === Phase.DAY_RESULT && <CenterBtn onClick={advance}>进入夜晚</CenterBtn>}

                {over && (
                  <div className="text-center space-y-4 py-2">
                    <div className="text-5xl">{gs.winner === Side.GOOD ? '🎉' : '🐺'}</div>
                    <div className="text-2xl font-black tracking-wider" style={{ color: '#e8c97a' }}>
                      {gs.winner === Side.GOOD ? '好人阵营胜利！' : '狼人阵营胜利！'}
                    </div>
                    <div className="flex flex-wrap gap-1.5 justify-center">
                      {gs.players.map(p => (
                        <span key={p.id} className="px-2 py-1 rounded-lg text-xs"
                          style={{ background: `${RC[p.role]}18`, border: `1px solid ${RC[p.role]}30`, color: RC[p.role], opacity: p.isAlive ? 1 : 0.5 }}>
                          {p.id}号 {ROLE_ICONS[p.role]} {ROLE_LABELS[p.role]}
                        </span>
                      ))}
                    </div>
                    <button onClick={reset}
                      className="px-8 py-3 rounded-xl font-black text-sm transition-all hover:scale-105"
                      style={{ background: '#e8c97a', color: '#1a0a00' }}>再来一局</button>
                  </div>
                )}
            </motion.div>

            {busy && (
              <div className="absolute bottom-2 right-4 flex items-center gap-1.5">
                {[0, 1, 2].map(i => (
                  <motion.div key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: '#e8c97a' }}
                    animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.25 }} />
                ))}
              </div>
            )}
          </div>
        </main>
      </div>


    </div>
  );
}

// ── Mini components ───────────────────────────────────────────────────────────
function Panel({ label, color, children }: { label: string; color: string; children: React.ReactNode }) {
  return (
    <div className="w-full space-y-3">
      <div className="text-center text-xs font-bold uppercase tracking-widest" style={{ color, opacity: 0.8 }}>{label}</div>
      {children}
    </div>
  );
}

function Btns({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2 justify-center">{children}</div>;
}

function Btn({ onClick, color, children }: { onClick: () => void; color: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="px-4 py-2 rounded-xl text-sm font-bold transition-all hover:scale-105 active:scale-95"
      style={{ background: `${color}20`, border: `1px solid ${color}50`, color }}>
      {children}
    </button>
  );
}

function CenterBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <div className="flex justify-center">
      <button onClick={onClick}
        className="px-8 py-3 rounded-xl font-bold text-sm flex items-center gap-2 transition-all hover:scale-105 active:scale-95"
        style={{ background: '#e8c97a', color: '#1a0a00' }}>
        {children}<ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

function SpeechBox({ value, onChange, onSubmit, placeholder }:
  { value: string; onChange: (v: string) => void; onSubmit: () => void; placeholder: string }) {
  return (
    <div className="flex gap-2 w-full">
      <input value={value} onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && onSubmit()}
        placeholder={placeholder} autoFocus
        className="flex-1 px-4 py-2.5 rounded-xl text-sm outline-none"
        style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: '#e8d5b0' }} />
      <button onClick={onSubmit}
        className="px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all hover:scale-105"
        style={{ background: '#e8c97a', color: '#1a0a00' }}>
        <Send className="w-3.5 h-3.5" />发言
      </button>
    </div>
  );
}

