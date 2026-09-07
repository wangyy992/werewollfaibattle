import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Moon, Sun, Skull, ChevronRight, Send, RotateCcw, Crown, AlertTriangle } from 'lucide-react';
import { Player, Role, Phase, GameState, GameLog, Side, DeathReason, HUNTER_CAN_SHOOT } from './types';
import { ROLE_LABELS, ROLE_ICONS, HUMAN_ID } from './constants';
import {
  initializePlayers, checkWinner, getSide,
  buildSpeakingOrder, firstSpeaker, tallyVotes,
} from './lib/gameUtils';
import * as AI from './services/aiService';

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
  NIGHT_GUARD:'守卫守护', NIGHT_WOLVES:'狼人出击', NIGHT_SEER:'预言家查验',
  NIGHT_WITCH:'女巫行动', NIGHT_RESULT:'黎明来临', SHERIFF_ELECT:'警长竞选',
  SHERIFF_SPEECH:'竞选发言', SHERIFF_VOTE:'警长投票', SHERIFF_RESULT:'选举结果',
  DAY_DISCUSSION:'白天辩论', DAY_VOTING:'投票放逐', DAY_RESULT:'放逐结果',
  SHERIFF_ACTION:'警徽移交', HUNTER_SHOOT:'猎人开枪', GAME_OVER:'游戏结束',
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const pick = <T,>(a: T[]): T | undefined => a.length ? a[Math.floor(Math.random() * a.length)] : undefined;

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
    phase: Phase.NIGHT_GUARD,
    seq: 0,
    logs: [{
      id: 'init', day: 1, phase: Phase.INIT, type: 'system',
      message: '游戏开始！12人局：4狼人 · 4平民 · 预言家 · 女巫 · 猎人 · 守卫或白痴（随机）。天黑请闭眼...',
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
  const logEnd = useRef<HTMLDivElement>(null);

  const queueRef = useRef<number[]>([]);   // remaining speakers, [0] is on stage
  const runningRef = useRef(false);        // one speech loop at a time
  const ranSeq = useRef(-1);               // last phase-entry the driver handled

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
    setBusy(true);
    const t = await AI.generateAIGuardAction(guard, gsRef.current);
    setBusy(false);
    commit({ guardTargetId: t ?? undefined });
    advance();
  }, [advance, commit]);

  /** Every living wolf nominates; the most-nominated target dies. */
  const resolveWolfKill = useCallback(async (humanChoice?: number) => {
    setBusy(true);
    const s = gsRef.current;
    const wolves = s.players.filter(p => p.role === Role.WEREWOLF && p.isAlive);
    const votes: Record<number, number> = {};
    if (humanChoice) votes[HUMAN_ID] = humanChoice;
    for (const w of wolves.filter(p => !p.isHuman)) {
      const t = await AI.generateAIWolfKill(w, gsRef.current);
      if (t) votes[w.id] = t;
    }
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
    setBusy(true);
    const t = await AI.generateAISeerCheck(seer, gsRef.current);
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
    setBusy(true);
    const r = await AI.generateAIWitchAction(witch, gsRef.current);
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
    try {
      while (queueRef.current.length) {
        const id = queueRef.current[0];
        const p = gsRef.current.players.find(x => x.id === id);
        if (!p || !p.isAlive) { queueRef.current.shift(); continue; }

        commit({ currentDiscussionIndex: id });
        if (p.isHuman) return;                       // pause; submitSpeech resumes

        setBusy(true);
        const text = await AI.generateAIDiscussion(p, gsRef.current);
        setBusy(false);
        say(text, 'discussion', { playerName: `${id}号` });
        queueRef.current.shift();
        await sleep(500);
      }
      commit({ currentDiscussionIndex: -1 });
      advance();
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
    commit({ discussionDirection: dir });
    say(s.sheriffId
      ? `警长${s.sheriffId}号决定：从${start}号开始，${dir === 1 ? '顺序' : '逆序'}发言。`
      : `本局无警长，从${start}号开始依次发言。`);
    queueRef.current = buildSpeakingOrder(aliveIds, start, dir);
    runQueue();
  }, [commit, runQueue, say]);

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
    setBusy(true);
    const cands = [...gsRef.current.sheriffCandidates];
    for (const p of gsRef.current.players.filter(x => x.isAlive && !x.isHuman)) {
      const run = await AI.generateAISheriffChoice(p, { ...gsRef.current, sheriffCandidates: cands });
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
      sheriffCandidates: run ? [...s.sheriffCandidates, HUMAN_ID] : s.sheriffCandidates,
    }));
    say(run ? '你选择上警，参与警长竞选。' : '你选择不上警。');
    runSheriffElection();
  };

  const collectSheriffVotes = useCallback(async (humanVote?: number | null) => {
    setBusy(true);
    const s = gsRef.current;
    const votes: Record<number, number> = {};
    const reasons: Record<number, string> = {};
    const human = s.players.find(p => p.isHuman);
    const humanVotes = !!human?.isAlive && !s.sheriffCandidates.includes(HUMAN_ID);
    if (humanVotes) {
      if (humanVote) { votes[HUMAN_ID] = humanVote; reasons[HUMAN_ID] = '你的投票。'; }
      say(humanVote ? `投${humanVote}号。` : '弃权。', 'vote', { playerName: '你' });
    }
    for (const v of s.players.filter(p => p.isAlive && !p.isHuman && !s.sheriffCandidates.includes(p.id))) {
      const r = await AI.generateAIVote(v, gsRef.current, s.sheriffCandidates);
      if (r.voteId) { votes[v.id] = r.voteId; reasons[v.id] = r.reason; }
      say(r.voteId ? `投${r.voteId}号。${r.reason}` : `弃权。${r.reason}`, 'vote', { playerName: `${v.id}号` });
    }
    setBusy(false);
    const { winner, top } = tallyVotes(votes);
    say(winner ? `🏅 ${winner}号以${top}票当选警长！` : '警长竞选平票，本局不设警长。');
    commit({ sheriffId: winner ?? undefined, isSheriffElectionCompleted: true, votes, voteReasons: reasons });
    advance();
  }, [advance, commit, say]);

  // ── Day vote ────────────────────────────────────────────────────────────────
  const runDayVote = useCallback(async (humanVote?: number | null) => {
    setBusy(true);
    const s = gsRef.current;
    const votes: Record<number, number> = {};
    const reasons: Record<number, string> = {};
    const human = s.players.find(p => p.isHuman);
    const humanVotes = !!human?.isAlive && s.idiotRevealedId !== HUMAN_ID;
    if (humanVotes) {
      if (humanVote) { votes[HUMAN_ID] = humanVote; reasons[HUMAN_ID] = '你的投票。'; }
      say(humanVote ? `投${humanVote}号。` : '弃权。', 'vote', { playerName: '你' });
    }
    for (const v of s.players.filter(p => p.isAlive && !p.isHuman && s.idiotRevealedId !== p.id)) {
      const r = await AI.generateAIVote(v, gsRef.current);
      if (r.voteId) { votes[v.id] = r.voteId; reasons[v.id] = r.reason; }
      say(r.voteId ? `投${r.voteId}号。${r.reason}` : `弃权。${r.reason}`, 'vote', { playerName: `${v.id}号` });
    }
    setBusy(false);

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
    setBusy(true);
    const t = await AI.generateAISheriffAction(sheriff, gsRef.current);
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
    setBusy(true);
    const t = await AI.generateAIHunterShoot(hunter, gsRef.current);
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
        const humanVotes = !!human?.isAlive && !s.sheriffCandidates.includes(HUMAN_ID);
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
        const humanVotes = !!human?.isAlive && s.idiotRevealedId !== HUMAN_ID;
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
    commit({ guardTargetId: t ?? undefined });
    say(t ? `你守护了${t}号。` : '你选择空守。', 'guard', { secret: true });
    advance();
  };
  const hCheck = (id: number) => {
    const t = gsRef.current.players.find(p => p.id === id)!;
    const side = getSide(t.role);
    commit(s => ({ seerRecords: [...s.seerRecords, { targetId: id, role: t.role, side }] }));
    say(`查验${id}号：${side === Side.GOOD ? '✅ 好人' : '❌ 狼人'}`, 'seer', { secret: true });
    advance();
  };
  const hWitch = (action: 'save' | 'poison' | 'skip', id?: number) => {
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
    queueRef.current = [];
    runningRef.current = false;
    ranSeq.current = -1;
    setSpeech('');
    setBusy(false);
    gsRef.current = freshGame();
    setGs(gsRef.current);
  };

  // ── Derived view state ──────────────────────────────────────────────────────
  const hp = gs.players.find(p => p.isHuman);
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
  const pendingHunterIsHuman = gs.hunterPendingId === HUMAN_ID;
  const sheriffIsHuman = gs.sheriffId === HUMAN_ID;
  const humanIsSheriffVoter = ha && !gs.sheriffCandidates.includes(HUMAN_ID);
  const humanCanDayVote = ha && gs.idiotRevealedId !== HUMAN_ID;
  const waitingForMe =
    (phase === Phase.NIGHT_GUARD && iAm(Role.GUARD)) ||
    (phase === Phase.NIGHT_WOLVES && iAm(Role.WEREWOLF)) ||
    (phase === Phase.NIGHT_SEER && iAm(Role.SEER)) ||
    (phase === Phase.NIGHT_WITCH && iAm(Role.WITCH));

  useEffect(() => { setMobileTab('game'); }, [gs.phase, gs.currentDiscussionIndex]);

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden text-white"
      style={{ background: bg, transition: 'background 1s ease', fontFamily: "'Noto Serif SC',serif" }}>

      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ── Sidebar ── */}
        <aside className={`${mobileTab === 'players' ? 'flex' : 'hidden'} lg:flex w-full lg:w-64 flex-shrink-0 flex-col overflow-hidden`}
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(16px)', borderRight: '1px solid rgba(255,255,255,0.07)' }}>

          <div className="px-5 pt-5 pb-4 border-b flex-shrink-0" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
            <div className="flex items-center gap-3">
              <div className="text-3xl">🐺</div>
              <div>
                <div className="font-black tracking-[0.25em] text-base" style={{ color: '#e8c97a' }}>狼 人 杀</div>
                <div className="text-[10px] tracking-widest opacity-30 uppercase">AI Battle · Day {day}</div>
              </div>
            </div>
          </div>

          {hp && (
            <div className="mx-4 mt-4 p-4 rounded-2xl relative overflow-hidden flex-shrink-0"
              style={{ background: `linear-gradient(135deg,${RC[hr]}22,${RC[hr]}08)`, border: `1px solid ${RC[hr]}44` }}>
              <div className="absolute -right-4 -top-4 text-6xl opacity-10">{ROLE_ICONS[hr]}</div>
              <div className="text-[10px] uppercase tracking-widest opacity-40 mb-2">
                你的身份{!ha && ' · 已出局'}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-2xl">{ROLE_ICONS[hr]}</span>
                <div>
                  <div className="font-bold text-lg leading-tight" style={{ color: RC[hr] }}>{ROLE_LABELS[hr]}</div>
                  <div className="text-[10px] opacity-40">{getSide(hr) === Side.GOOD ? '好人阵营' : '狼人阵营'}</div>
                </div>
              </div>
              {hr === Role.WEREWOLF && (
                <div className="mt-3 pt-3 border-t text-xs" style={{ borderColor: `${RC[hr]}30` }}>
                  <span className="opacity-40">队友：</span>
                  <span style={{ color: RC[hr] }}>
                    {gs.players.filter(p => p.role === Role.WEREWOLF && p.id !== HUMAN_ID && p.isAlive).map(p => `${p.id}号`).join('、') || '无'}
                  </span>
                </div>
              )}
              {hr === Role.SEER && gs.seerRecords.length > 0 && (
                <div className="mt-3 pt-3 border-t space-y-1" style={{ borderColor: `${RC[hr]}30` }}>
                  <div className="text-[10px] opacity-40 uppercase tracking-widest">查验记录</div>
                  {gs.seerRecords.map((r, i) => (
                    <div key={i} className="flex justify-between text-xs font-mono">
                      <span className="opacity-60">{r.targetId}号</span>
                      <span style={{ color: r.side === Side.GOOD ? '#52e090' : '#e05252' }}>
                        {r.side === Side.GOOD ? '✅ 好人' : '❌ 狼人'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {hr === Role.WITCH && (
                <div className="mt-3 pt-3 border-t flex gap-4 text-xs" style={{ borderColor: `${RC[hr]}30` }}>
                  <span style={{ color: gs.witchStatus.hasSavePotion ? '#52e090' : '#555' }}>💊 解药{gs.witchStatus.hasSavePotion ? '' : '(已用)'}</span>
                  <span style={{ color: gs.witchStatus.hasPoisonPotion ? '#e05252' : '#555' }}>🧪 毒药{gs.witchStatus.hasPoisonPotion ? '' : '(已用)'}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 mt-4 pb-20 lg:pb-4 space-y-1.5">
            <div className="text-[10px] uppercase tracking-widest opacity-30 mb-2">
              玩家列表 · 存活{alive.length}/{gs.players.length}
            </div>
            {gs.players.map(p => {
              // Roles stay hidden until the game ends — the human only knows
              // what their own role has earned them.
              const known = over || p.isHuman
                || (hr === Role.WEREWOLF && p.role === Role.WEREWOLF)
                || p.id === gs.idiotRevealedId;
              return (
                <div key={p.id} className="flex items-center gap-2.5 px-3 py-2 rounded-xl"
                  style={{
                    background: p.isAlive ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.3)',
                    border: p.id === HUMAN_ID ? `1px solid ${RC[hr]}40` : '1px solid rgba(255,255,255,0.05)',
                    opacity: p.isAlive ? 1 : 0.45,
                  }}>
                  <span className="text-[10px] font-mono opacity-20 w-4 text-right">{p.id}</span>
                  <span className="text-base">{known ? ROLE_ICONS[p.role] : '❓'}</span>
                  <span className="text-xs flex-1 truncate"
                    style={{ color: p.id === HUMAN_ID ? RC[hr] : '#ccc', textDecoration: p.isAlive ? 'none' : 'line-through' }}>
                    {p.id === HUMAN_ID ? '你' : p.name}
                  </span>
                  {!p.isAlive && <span className="text-[9px] opacity-30">{publicDeath(p.deathReason)}</span>}
                  {p.id === gs.sheriffId && p.isAlive && <Crown className="w-3 h-3 flex-shrink-0" style={{ color: '#fbbf24' }} />}
                  {!p.isAlive && <Skull className="w-3 h-3 opacity-20 flex-shrink-0" />}
                  {p.id === gs.idiotRevealedId && <span className="text-[10px]">🃏</span>}
                </div>
              );
            })}
          </div>
        </aside>

        {/* ── Main ── */}
        <main className={`${mobileTab === 'game' ? 'flex' : 'hidden'} lg:flex flex-1 flex-col min-h-0 overflow-hidden`}>

          <header className="flex-shrink-0 px-4 py-3 flex items-center justify-between"
            style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{
                  background: isNight ? 'rgba(139,92,246,0.2)' : 'rgba(251,191,36,0.2)',
                  border: isNight ? '1px solid rgba(139,92,246,0.4)' : '1px solid rgba(251,191,36,0.4)',
                }}>
                {isNight ? <Moon className="w-4 h-4" style={{ color: '#a78bfa' }} /> : <Sun className="w-4 h-4" style={{ color: '#fbbf24' }} />}
              </div>
              <div>
                <div className="text-[10px] opacity-30 uppercase tracking-widest">第 {day} 天</div>
                <div className="text-sm font-bold" style={{ color: '#e8c97a' }}>{PHASE_LABEL[phase] || phase}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="lg:hidden px-2 py-1 rounded-lg text-xs font-bold"
                style={{ background: `${RC[hr]}20`, border: `1px solid ${RC[hr]}40`, color: RC[hr] }}>
                {ROLE_ICONS[hr]} {ROLE_LABELS[hr]}
              </div>
              {busy && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px]"
                  style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }}>
                  <motion.div className="w-1.5 h-1.5 rounded-full bg-yellow-400"
                    animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1, repeat: Infinity }} />
                  思考中
                </div>
              )}
              <button onClick={reset} className="p-2 rounded-lg opacity-40 hover:opacity-80" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </header>

          {!AI.AI_ENABLED && (
            <div className="flex-shrink-0 px-4 py-2 flex items-start gap-2 text-[11px]"
              style={{ background: 'rgba(224,82,82,0.12)', borderBottom: '1px solid rgba(224,82,82,0.25)', color: '#f0a0a0' }}>
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>未检测到 API Key，AI 玩家将使用离线兜底逻辑（发言为预设文本）。在 <code>.env.local</code> 中设置 <code>VITE_DEEPSEEK_API_KEY</code> 后重启开发服务器。</span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2 pb-4">
            <AnimatePresence initial={false}>
              {gs.logs.map(l => (
                <motion.div key={l.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3 items-start">
                  <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 text-xs"
                    style={{
                      background: l.type === 'wolf' ? 'rgba(224,82,82,0.15)' : l.type === 'seer' ? 'rgba(167,139,250,0.15)'
                        : l.type === 'witch' ? 'rgba(52,211,153,0.15)' : l.type === 'vote' ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.06)',
                      color: l.type === 'wolf' ? '#e05252' : l.type === 'seer' ? '#a78bfa'
                        : l.type === 'witch' ? '#34d399' : l.type === 'vote' ? '#fbbf24' : '#888',
                    }}>
                    {l.type === 'wolf' ? '🐺' : l.type === 'seer' ? '🔮' : l.type === 'witch' ? '🧙'
                      : l.type === 'guard' ? '🛡' : l.type === 'hunter' ? '🏹' : l.type === 'idiot' ? '🃏'
                      : l.type === 'vote' ? '⚖' : l.type === 'discussion' ? '💬' : '📜'}
                  </div>
                  <div className="flex-1 min-w-0">
                    {l.playerName && (
                      <span className="text-[10px] font-bold uppercase tracking-widest mr-2" style={{ color: '#e8c97a', opacity: 0.7 }}>
                        {l.playerName}
                      </span>
                    )}
                    {l.secret && <span className="text-[9px] mr-1.5 opacity-40">🔒仅你可见</span>}
                    <span className={`text-sm leading-relaxed ${l.type === 'discussion' ? 'italic' : ''}`}
                      style={{ color: l.type === 'discussion' ? '#e8d5b0' : 'rgba(255,255,255,0.55)' }}>
                      {l.message}
                    </span>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={logEnd} />
          </div>

          {/* ── Action panel ── */}
          <div className="flex-shrink-0 px-4 py-4 min-h-28 flex items-center justify-center relative"
            style={{ background: 'rgba(0,0,0,0.5)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
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
                        {gs.players.filter(p => p.role === Role.WEREWOLF && p.id !== HUMAN_ID && p.isAlive).map(p => `${p.id}号`).join('、') || '无'}
                      </span>
                      <div className="text-[10px] opacity-30 mt-0.5">所有狼人各提名一人，得票最多者被击杀</div>
                    </div>
                    <Btns>
                      {alive.filter(p => p.role !== Role.WEREWOLF).map(p =>
                        <Btn key={p.id} color={RC[Role.WEREWOLF]} onClick={() => resolveWolfKill(p.id)}>{p.id}号</Btn>)}
                    </Btns>
                  </Panel>
                )}

                {phase === Phase.NIGHT_SEER && iAm(Role.SEER) && (
                  <Panel label="预言家：选择查验目标" color={RC[Role.SEER]}>
                    <Btns>
                      {alive.filter(p => !p.isHuman && !gs.seerRecords.some(r => r.targetId === p.id)).map(p =>
                        <Btn key={p.id} color={RC[Role.SEER]} onClick={() => hCheck(p.id)}>{p.id}号</Btn>)}
                    </Btns>
                  </Panel>
                )}

                {phase === Phase.NIGHT_WITCH && iAm(Role.WITCH) && (
                  <Panel label="女巫：使用你的药" color={RC[Role.WITCH]}>
                    <div className="text-center text-[11px] mb-2 opacity-40">
                      {gs.nightKilledId
                        ? (gs.nightKilledId === HUMAN_ID ? '今晚被刀的是你自己，不可自救。' : `今晚 ${gs.nightKilledId}号 被狼人击杀。`)
                        : '今晚无人被击杀。'}
                    </div>
                    <Btns>
                      {gs.witchStatus.hasSavePotion && !!gs.nightKilledId && gs.nightKilledId !== HUMAN_ID && (
                        <Btn color={RC[Role.WITCH]} onClick={() => hWitch('save')}>💊 救{gs.nightKilledId}号</Btn>
                      )}
                      {gs.witchStatus.hasPoisonPotion && alive.filter(p => !p.isHuman && p.id !== gs.nightKilledId).map(p =>
                        <Btn key={p.id} color={RC[Role.WEREWOLF]} onClick={() => hWitch('poison', p.id)}>🧪 毒{p.id}号</Btn>)}
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
                      {alive.filter(p => !p.isHuman).map(p =>
                        <Btn key={p.id} color={RC[Role.HUNTER]} onClick={() => doHunterShot(p.id)}>{p.id}号</Btn>)}
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

                {phase === Phase.SHERIFF_SPEECH && gs.currentDiscussionIndex === HUMAN_ID && (
                  <div className="space-y-2">
                    <div className="text-center text-[11px] opacity-50">
                      轮到你竞选发言 · 上警名单：{gs.sheriffCandidates.map(id => `${id}号`).join('、')}
                    </div>
                    <SpeechBox value={speech} onChange={setSpeech} onSubmit={submitSpeech} placeholder="输入你的竞选发言（留空则过）..." />
                  </div>
                )}
                {phase === Phase.SHERIFF_SPEECH && gs.currentDiscussionIndex > 0 && gs.currentDiscussionIndex !== HUMAN_ID && (
                  <p className="text-center opacity-40 text-sm italic">{gs.currentDiscussionIndex}号正在竞选发言...</p>
                )}

                {phase === Phase.SHERIFF_VOTE && humanIsSheriffVoter && (
                  <Panel label="投票选出警长" color="#fbbf24">
                    <Btns>
                      {gs.sheriffCandidates.map(id =>
                        <Btn key={id} color="#fbbf24" onClick={() => collectSheriffVotes(id)}>投{id}号</Btn>)}
                      <Btn color="#555" onClick={() => collectSheriffVotes(null)}>弃权</Btn>
                    </Btns>
                  </Panel>
                )}
                {phase === Phase.SHERIFF_VOTE && !humanIsSheriffVoter && (
                  <p className="text-center opacity-40 text-sm italic">
                    {gs.sheriffCandidates.includes(HUMAN_ID) ? '你是候选人，不参与投票。等待计票...' : '正在计票...'}
                  </p>
                )}
                {phase === Phase.SHERIFF_RESULT && <CenterBtn onClick={advance}>确认结果</CenterBtn>}

                {phase === Phase.SHERIFF_ACTION && sheriffIsHuman && (
                  <Panel label="你出局了，移交或撕毁警徽" color="#fbbf24">
                    <Btns>
                      {alive.filter(p => !p.isHuman).map(p =>
                        <Btn key={p.id} color="#fbbf24" onClick={() => doHandoff(p.id)}>传给{p.id}号</Btn>)}
                      <Btn color={RC[Role.WEREWOLF]} onClick={() => doHandoff(null)}>撕毁警徽</Btn>
                    </Btns>
                  </Panel>
                )}
                {phase === Phase.SHERIFF_ACTION && !sheriffIsHuman && (
                  <p className="text-center opacity-40 text-sm italic">警长正在决定警徽归属...</p>
                )}

                {/* Day */}
                {phase === Phase.DAY_DISCUSSION && gs.currentDiscussionIndex === -1 && sheriffIsHuman && ha && (
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-xs opacity-40">你是警长，决定今天的发言方向：</p>
                    <Btns>
                      <Btn color="#fbbf24" onClick={() => startDiscussion(1)}>顺序发言 →</Btn>
                      <Btn color="#fbbf24" onClick={() => startDiscussion(-1)}>← 逆序发言</Btn>
                    </Btns>
                  </div>
                )}
                {phase === Phase.DAY_DISCUSSION && gs.currentDiscussionIndex === HUMAN_ID && (
                  <SpeechBox value={speech} onChange={setSpeech} onSubmit={submitSpeech} placeholder="轮到你发言（留空则过）..." />
                )}
                {phase === Phase.DAY_DISCUSSION && gs.currentDiscussionIndex > 0 && gs.currentDiscussionIndex !== HUMAN_ID && (
                  <p className="text-center opacity-40 text-sm italic">{gs.currentDiscussionIndex}号正在发言...</p>
                )}

                {phase === Phase.DAY_VOTING && humanCanDayVote && (
                  <Panel label={`投票放逐${gs.sheriffId ? ` · 警长${gs.sheriffId}号 1.5票` : ''}`} color={RC[Role.WEREWOLF]}>
                    <Btns>
                      {alive.filter(p => !p.isHuman && gs.idiotRevealedId !== p.id).map(p =>
                        <Btn key={p.id} color={RC[Role.WEREWOLF]} onClick={() => runDayVote(p.id)}>投{p.id}号</Btn>)}
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

      {/* ── Mobile tabs ── */}
      <div className="lg:hidden flex-shrink-0 flex border-t"
        style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(16px)', borderColor: 'rgba(255,255,255,0.08)' }}>
        {(['game', 'players'] as const).map(tab => (
          <button key={tab} onClick={() => setMobileTab(tab)}
            className="flex-1 py-3 flex flex-col items-center gap-1 transition-all"
            style={{ color: mobileTab === tab ? '#e8c97a' : 'rgba(255,255,255,0.3)' }}>
            <span className="text-lg">{tab === 'game' ? '🎮' : '👥'}</span>
            <span className="text-[10px] font-bold uppercase tracking-wider">{tab === 'game' ? '游戏' : '玩家'}</span>
          </button>
        ))}
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
