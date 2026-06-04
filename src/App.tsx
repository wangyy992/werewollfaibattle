import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Moon, Sun, Shield, Eye, Skull, Trophy,
  ChevronRight, Send, RotateCcw, Swords, Crown,
  FlameKindling, Wand2, Crosshair, UserX, Vote
} from 'lucide-react';
import { Player, Role, Phase, GameState, Side, SeerRecord } from './types';
import { PLAYER_COUNT, ROLE_LABELS, ROLE_ICONS } from './constants';
import { initializePlayers, checkWinner, getSide } from './lib/gameUtils';
import {
  generateAIDiscussion, generateAIVote, generateAINightAction,
  generateAIGuardAction, generateAISheriffChoice, generateAISheriffAction,
  generateAIWolfKill
} from './services/geminiService';

// ─── Theme ────────────────────────────────────────────────────────────────────
const PHASE_COLORS: Record<string, string> = {
  NIGHT: '#1a0a2e',
  DAY: '#2d1a00',
  VOTE: '#1a0000',
  SHERIFF: '#0a1a2e',
};

const ROLE_COLORS: Record<Role, string> = {
  [Role.WEREWOLF]: '#c0392b',
  [Role.SEER]: '#8e44ad',
  [Role.WITCH]: '#16a085',
  [Role.HUNTER]: '#d35400',
  [Role.GUARD]: '#2980b9',
  [Role.IDIOT]: '#f39c12',
  [Role.VILLAGER]: '#7f8c8d',
};

const LOG_ICONS: Record<string, React.ReactNode> = {
  system: <FlameKindling className="w-3.5 h-3.5" />,
  wolf: <Skull className="w-3.5 h-3.5" />,
  seer: <Eye className="w-3.5 h-3.5" />,
  witch: <Wand2 className="w-3.5 h-3.5" />,
  guard: <Shield className="w-3.5 h-3.5" />,
  hunter: <Crosshair className="w-3.5 h-3.5" />,
  idiot: <UserX className="w-3.5 h-3.5" />,
  discussion: <Send className="w-3.5 h-3.5" />,
  vote: <Vote className="w-3.5 h-3.5" />,
};

const INITIAL_STATE: GameState = {
  players: [], day: 1, phase: Phase.INIT, logs: [],
  witchStatus: { hasSavePotion: true, hasPoisonPotion: true },
  seerRecords: [], currentDiscussionIndex: -1, votes: {},
  voteReasons: {}, lastNightDeaths: [], discussionDirection: 1,
  sheriffCandidates: [], isSheriffElectionCompleted: false,
};

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [gameState, setGameState] = useState<GameState>(INITIAL_STATE);
  const [isProcessing, setIsProcessing] = useState(false);
  const [humanSpeechInput, setHumanSpeechInput] = useState('');
  const [humanVoted, setHumanVoted] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const processedIds = useRef<Set<number>>(new Set());

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [gameState.logs]);

  // Init
  useEffect(() => {
    if (gameState.phase === Phase.INIT) {
      const players = initializePlayers();
      const human = players.find(p => p.isHuman)!;
      setGameState(prev => ({
        ...prev, players, phase: Phase.NIGHT_GUARD,
        logs: [{ id: 'init', day: 1, phase: Phase.INIT, type: 'system',
          message: `🎮 游戏开始！共12人，4狼4民3神1特殊。你的身份已在左侧显示。` }]
      }));
    }
  }, [gameState.phase === Phase.INIT]);

  const addLog = (log: Omit<typeof gameState.logs[0], 'id'>) => {
    setGameState(prev => ({
      ...prev,
      logs: [...prev.logs, { ...log, id: Math.random().toString(36).substr(2, 9) }]
    }));
  };

  const updatePlayers = (players: Player[]) => {
    setGameState(prev => ({ ...prev, players }));
  };

  const nextPhase = (stateOverride?: Partial<GameState>) => {
    setGameState(prev => {
      const merged = { ...prev, ...stateOverride };
      const winner = checkWinner(merged.players);
      if (winner) return { ...merged, phase: Phase.GAME_OVER, winner };

      let next = prev.phase;
      let nextDay = prev.day;
      switch (prev.phase) {
        case Phase.NIGHT_GUARD: next = Phase.NIGHT_WOLVES; break;
        case Phase.NIGHT_WOLVES: next = Phase.NIGHT_SEER; break;
        case Phase.NIGHT_SEER: next = Phase.NIGHT_WITCH; break;
        case Phase.NIGHT_WITCH: next = Phase.NIGHT_RESULT; break;
        case Phase.NIGHT_RESULT:
          next = prev.day === 1 && !prev.isSheriffElectionCompleted ? Phase.SHERIFF_ELECT : Phase.DAY_DISCUSSION; break;
        case Phase.SHERIFF_ELECT: next = Phase.SHERIFF_SPEECH; break;
        case Phase.SHERIFF_SPEECH: next = Phase.SHERIFF_VOTE; break;
        case Phase.SHERIFF_VOTE: next = Phase.SHERIFF_RESULT; break;
        case Phase.SHERIFF_RESULT: next = Phase.DAY_DISCUSSION; break;
        case Phase.DAY_DISCUSSION: next = Phase.DAY_VOTING; break;
        case Phase.DAY_VOTING: next = Phase.DAY_RESULT; break;
        case Phase.DAY_RESULT: next = Phase.NIGHT_GUARD; nextDay++; break;
        default: break;
      }
      return { ...merged, phase: next, day: nextDay };
    });
  };

  // ── AI Triggers ──
  useEffect(() => {
    const { phase, players } = gameState;
    const humanRole = players.find(p => p.isHuman)?.role;

    if (phase === Phase.NIGHT_GUARD && humanRole !== Role.GUARD) handleAIGuard();
    else if (phase === Phase.NIGHT_WOLVES && humanRole !== Role.WEREWOLF) handleAIWolves();
    else if (phase === Phase.NIGHT_SEER && humanRole !== Role.SEER) handleAISeer();
    else if (phase === Phase.NIGHT_WITCH && humanRole !== Role.WITCH) handleAIWitch();
    else if (phase === Phase.NIGHT_RESULT) handleNightSettlement();
    else if (phase === Phase.SHERIFF_ELECT) handleAISheriffElect();
    else if (phase === Phase.SHERIFF_SPEECH) handleAISheriffSpeech();
    else if (phase === Phase.SHERIFF_VOTE) handleAISheriffVotePhase();
    else if (phase === Phase.SHERIFF_ACTION) handleAISheriffActionPhase();
  }, [gameState.phase]);

  useEffect(() => {
    if (gameState.phase !== Phase.DAY_DISCUSSION && gameState.phase !== Phase.SHERIFF_SPEECH) {
      processedIds.current.clear();
    }
  }, [gameState.phase]);

  // ── Night Handlers ──
  const handleAIGuard = async () => {
    setIsProcessing(true);
    const guard = gameState.players.find(p => p.role === Role.GUARD && p.isAlive && !p.isHuman);
    if (guard) {
      const targetId = await generateAIGuardAction(guard, gameState);
      setGameState(prev => ({ ...prev, guardTargetId: targetId ?? undefined }));
    }
    setIsProcessing(false);
    nextPhase();
  };

  const handleAIWolves = async () => {
    setIsProcessing(true);
    const wolf = gameState.players.find(p => p.role === Role.WEREWOLF && p.isAlive && !p.isHuman);
    if (wolf) {
      const targetId = await generateAINightAction(wolf, gameState, 'KILL') as number;
      setGameState(prev => ({ ...prev, nightKilledId: targetId }));
    }
    setIsProcessing(false);
    nextPhase();
  };

  const handleAISeer = async () => {
    setIsProcessing(true);
    const seer = gameState.players.find(p => p.role === Role.SEER && p.isAlive && !p.isHuman);
    if (seer) {
      const targetId = await generateAINightAction(seer, gameState, 'CHECK') as number;
      if (targetId && targetId !== -1) {
        const target = gameState.players.find(p => p.id === targetId)!;
        const record: SeerRecord = { targetId, role: target.role, side: getSide(target.role) };
        setGameState(prev => ({ ...prev, seerRecords: [...prev.seerRecords, record] }));
      }
    }
    setIsProcessing(false);
    nextPhase();
  };

  const handleAIWitch = async () => {
    setIsProcessing(true);
    const witch = gameState.players.find(p => p.role === Role.WITCH && p.isAlive && !p.isHuman);
    if (witch) {
      const result = await generateAINightAction(witch, gameState, 'WITCH_ACTION') as { action: string; targetId?: number };
      if (result?.action === 'save') {
        setGameState(prev => ({ ...prev, witchSavedId: prev.nightKilledId, witchStatus: { ...prev.witchStatus, hasSavePotion: false } }));
      } else if (result?.action === 'poison' && result.targetId) {
        setGameState(prev => ({ ...prev, witchPoisonedId: result.targetId, witchStatus: { ...prev.witchStatus, hasPoisonPotion: false } }));
      }
    }
    setIsProcessing(false);
    nextPhase();
  };

  const handleNightSettlement = async () => {
    let players = [...gameState.players];
    const { nightKilledId, witchSavedId, witchPoisonedId, guardTargetId } = gameState;
    const deaths: string[] = [];
    let hunterMustShoot = false;
    const nightDeathIds: number[] = [];

    const milkPenetrated = nightKilledId && guardTargetId === nightKilledId && witchSavedId === nightKilledId;

    const toKill: (number | undefined)[] = [];
    if (milkPenetrated) {
      toKill.push(nightKilledId);
    } else if (nightKilledId) {
      const protected_ = guardTargetId === nightKilledId || witchSavedId === nightKilledId;
      if (!protected_) toKill.push(nightKilledId);
    }
    if (witchPoisonedId) toKill.push(witchPoisonedId);

    for (const id of toKill) {
      if (!id) continue;
      const p = players.find(pl => pl.id === id);
      if (p && p.isAlive) {
        p.isAlive = false;
        p.deathDay = gameState.day;
        p.deathReason = id === witchPoisonedId ? '女巫毒杀' : '狼人猎杀';
        deaths.push(`${id}号(${ROLE_LABELS[p.role]})`);
        nightDeathIds.push(id);

        if (p.role === Role.HUNTER) {
          if (p.isHuman) {
            hunterMustShoot = true;
          } else {
            setIsProcessing(true);
            const targetId = await generateAINightAction(p, { ...gameState, players }, 'HUNTER_SHOOT') as number;
            if (targetId && targetId !== -1) {
              const shot = players.find(pl => pl.id === targetId);
              if (shot?.isAlive) {
                shot.isAlive = false; shot.deathDay = gameState.day; shot.deathReason = '猎人带走';
                deaths.push(`${targetId}号(${ROLE_LABELS[shot.role]})[猎人带走]`);
              }
            }
            setIsProcessing(false);
          }
        }
      }
    }

    const msg = deaths.length > 0 ? `昨夜出局：${deaths.join('、')}` : '昨夜是平安夜，无人出局。';
    addLog({ day: gameState.day, phase: Phase.NIGHT_RESULT, message: msg, type: 'system' });

    const deadSheriff = gameState.sheriffId && !players.find(p => p.id === gameState.sheriffId && p.isAlive);

    setGameState(prev => ({
      ...prev, players,
      nightKilledId: undefined, witchSavedId: undefined, witchPoisonedId: undefined,
      lastGuardTargetId: prev.guardTargetId, guardTargetId: undefined,
      hunterMustShoot, sheriffMustAct: !!deadSheriff, lastNightDeaths: nightDeathIds,
    }));

    if (deadSheriff) {
      setGameState(prev => ({ ...prev, phase: Phase.SHERIFF_ACTION }));
    } else if (!hunterMustShoot) {
      nextPhase();
    }
  };

  // ── Sheriff Handlers ──
  const handleAISheriffElect = async () => {
    setIsProcessing(true);
    const candidates: number[] = [];
    for (const p of gameState.players.filter(pl => !pl.isHuman && pl.isAlive)) {
      const runs = await generateAISheriffChoice(p, gameState);
      if (runs) candidates.push(p.id);
    }
    setIsProcessing(false);
    setGameState(prev => ({ ...prev, sheriffCandidates: candidates }));
  };

  const handleAISheriffSpeech = () => {
    if (gameState.sheriffCandidates.length === 0) { nextPhase(); return; }
    setGameState(prev => ({ ...prev, currentDiscussionIndex: prev.sheriffCandidates[0] }));
  };

  const handleAISheriffVotePhase = async () => {
    setIsProcessing(true);
    const voters = gameState.players.filter(p => p.isAlive && !gameState.sheriffCandidates.includes(p.id) && !p.isHuman);
    const votes: Record<number, number> = { ...gameState.votes };
    const voteReasons: Record<number, string> = { ...gameState.voteReasons };
    for (const voter of voters) {
      const result = await generateAIVote(voter, gameState, gameState.sheriffCandidates);
      if (result.voteId) { votes[voter.id] = result.voteId; voteReasons[voter.id] = result.reason; }
    }
    setIsProcessing(false);
    // Check if human is a voter; if not, finalize immediately
    const humanIsVoter = gameState.players.find(p => p.isHuman && p.isAlive && !gameState.sheriffCandidates.includes(1));
    if (!humanIsVoter) finalizeSheriffVote(votes, voteReasons);
    else setGameState(prev => ({ ...prev, votes, voteReasons }));
  };

  const finalizeSheriffVote = (votes: Record<number, number>, voteReasons: Record<number, string>) => {
    const counts: Record<number, number> = {};
    Object.values(votes).forEach(id => counts[id] = (counts[id] || 0) + 1);
    let max = 0; let winners: number[] = [];
    Object.entries(counts).forEach(([id, c]) => {
      if (c > max) { max = c; winners = [+id]; } else if (c === max) winners.push(+id);
    });
    const electedId = winners.length === 1 ? winners[0] : null;
    addLog({ day: gameState.day, phase: Phase.SHERIFF_RESULT, type: 'system',
      message: electedId ? `🏅 ${electedId}号玩家当选警长！` : '平票，本局无警长。' });
    setGameState(prev => ({ ...prev, sheriffId: electedId ?? undefined, isSheriffElectionCompleted: true, votes, voteReasons }));
    nextPhase();
  };

  const handleAISheriffActionPhase = async () => {
    const sheriff = gameState.players.find(p => p.id === gameState.sheriffId);
    if (!sheriff || sheriff.isHuman) return;
    setIsProcessing(true);
    const targetId = await generateAISheriffAction(sheriff, gameState) as number | null;
    applySheriffHandoff(targetId);
    setIsProcessing(false);
  };

  const applySheriffHandoff = (targetId: number | null) => {
    if (targetId) {
      addLog({ day: gameState.day, phase: Phase.SHERIFF_ACTION, type: 'system', message: `🏅 警长将警徽传给${targetId}号。` });
      setGameState(prev => ({ ...prev, sheriffId: targetId, sheriffMustAct: false }));
    } else {
      addLog({ day: gameState.day, phase: Phase.SHERIFF_ACTION, type: 'system', message: `💥 警长撕毁了警徽，本局不再有警长。` });
      setGameState(prev => ({ ...prev, sheriffId: undefined, sheriffMustAct: false }));
    }
    if (!gameState.hunterMustShoot) nextPhase();
  };

  // ── Discussion (sequential) ──
  useEffect(() => {
    const { phase, currentDiscussionIndex, players } = gameState;
    if (phase !== Phase.DAY_DISCUSSION && phase !== Phase.SHERIFF_SPEECH) return;
    if (currentDiscussionIndex < 0 || isProcessing) return;

    const isSheriff = phase === Phase.SHERIFF_SPEECH;
    const participants = isSheriff
      ? gameState.sheriffCandidates
      : players.filter(p => p.isAlive).map(p => p.id).sort((a, b) => a - b);

    if (!isSheriff && processedIds.current.size >= participants.length) {
      setTimeout(() => { setGameState(prev => ({ ...prev, currentDiscussionIndex: -1 })); nextPhase(); }, 800);
      return;
    }

    const player = players.find(p => p.id === currentDiscussionIndex);
    if (!player || processedIds.current.has(currentDiscussionIndex)) {
      advanceDiscussion(participants, currentDiscussionIndex, isSheriff);
      return;
    }
    if (player.isHuman) return;

    const runSpeech = async () => {
      setIsProcessing(true);
      try {
        const speech = await generateAIDiscussion(player, gameState);
        addLog({ day: gameState.day, phase, type: 'discussion', playerName: `${player.id}号`, message: speech });
        processedIds.current.add(player.id);
        setTimeout(() => advanceDiscussion(participants, currentDiscussionIndex, isSheriff), 1200);
      } catch (e) {
        processedIds.current.add(player.id);
        advanceDiscussion(participants, currentDiscussionIndex, isSheriff);
      } finally {
        setIsProcessing(false);
      }
    };
    runSpeech();
  }, [gameState.phase, gameState.currentDiscussionIndex, isProcessing]);

  const advanceDiscussion = (participants: number[], current: number, isSheriff: boolean) => {
    const pos = participants.indexOf(current);
    if (pos === -1 || pos >= participants.length - 1) {
      setGameState(prev => ({ ...prev, currentDiscussionIndex: -1 }));
      if (isSheriff) nextPhase();
      return;
    }
    const dir = gameState.discussionDirection;
    let next = isSheriff ? participants[pos + 1] : participants[(pos + dir + participants.length) % participants.length];
    setGameState(prev => ({ ...prev, currentDiscussionIndex: next }));
  };

  const startDiscussion = (direction: 1 | -1 = 1) => {
    const alive = gameState.players.filter(p => p.isAlive).map(p => p.id).sort((a, b) => a - b);
    if (alive.length === 0) return;
    let startId = alive[0];
    if (gameState.lastNightDeaths.length > 0) {
      const lastDead = gameState.lastNightDeaths[gameState.lastNightDeaths.length - 1];
      const after = alive.filter(id => id > lastDead);
      startId = after.length > 0 ? after[0] : alive[0];
    }
    if (gameState.sheriffId) {
      addLog({ day: gameState.day, phase: Phase.DAY_DISCUSSION, type: 'system',
        message: `🏅 警长决定${direction === 1 ? '顺时针' : '逆时针'}发言，从${startId}号开始。` });
    }
    setGameState(prev => ({ ...prev, currentDiscussionIndex: startId, discussionDirection: direction }));
  };

  const submitHumanSpeech = () => {
    const speech = humanSpeechInput.trim() || '（过）';
    const isSheriff = gameState.phase === Phase.SHERIFF_SPEECH;
    addLog({ day: gameState.day, phase: gameState.phase, type: 'discussion', playerName: '你', message: speech });
    setHumanSpeechInput('');
    processedIds.current.add(1);

    const participants = isSheriff
      ? gameState.sheriffCandidates
      : gameState.players.filter(p => p.isAlive).map(p => p.id).sort((a, b) => a - b);
    advanceDiscussion(participants, 1, isSheriff);
  };

  // ── Day Vote (wait for human first) ──
  const handleHumanVote = async (targetId: number | null) => {
    setIsProcessing(true);
    setHumanVoted(true);
    const votes: Record<number, number> = {};
    const voteReasons: Record<number, string> = {};
    if (targetId) { votes[1] = targetId; voteReasons[1] = '你的投票。'; }

    const aliveAI = gameState.players.filter(p => p.isAlive && !p.isHuman);
    for (const ai of aliveAI) {
      if (gameState.idiotRevealedId === ai.id) continue;
      const result = await generateAIVote(ai, gameState);
      if (result.voteId) {
        votes[ai.id] = result.voteId;
        voteReasons[ai.id] = result.reason;
        addLog({ day: gameState.day, phase: Phase.DAY_VOTING, type: 'vote',
          playerName: `${ai.id}号`, message: `投票给${result.voteId}号。${result.reason}` });
      } else {
        addLog({ day: gameState.day, phase: Phase.DAY_VOTING, type: 'vote',
          playerName: `${ai.id}号`, message: `弃权。${result.reason}` });
      }
    }

    // Tally (sheriff gets 1.5 votes)
    const counts: Record<number, number> = {};
    Object.entries(votes).forEach(([voterId, vid]) => {
      const w = +voterId === gameState.sheriffId ? 1.5 : 1;
      counts[vid] = (counts[vid] || 0) + w;
    });
    let max = 0; let top: number[] = [];
    Object.entries(counts).forEach(([id, c]) => { if (c > max) { max = c; top = [+id]; } else if (c === max) top.push(+id); });
    const exiledId = top.length > 0 ? top[Math.floor(Math.random() * top.length)] : null;

    let players = [...gameState.players];
    let deadSheriff = false;
    let idiotRevealedId = gameState.idiotRevealedId;

    if (exiledId) {
      const p = players.find(pl => pl.id === exiledId)!;
      if (p.role === Role.IDIOT && !gameState.idiotRevealedId) {
        idiotRevealedId = exiledId;
        addLog({ day: gameState.day, phase: Phase.DAY_RESULT, type: 'idiot',
          message: `🃏 ${exiledId}号翻牌！ta是白痴，免疫本次放逐，但失去投票权！` });
      } else {
        p.isAlive = false; p.deathDay = gameState.day; p.deathReason = '投票放逐';
        addLog({ day: gameState.day, phase: Phase.DAY_RESULT, type: 'system',
          message: `⚖️ ${exiledId}号被放逐（得票${max}票），身份：${ROLE_LABELS[p.role]}` });
        if (exiledId === gameState.sheriffId) deadSheriff = true;

        // Hunter shot at exile
        if (p.role === Role.HUNTER && !p.isHuman) {
          const targetId = await generateAINightAction(p, { ...gameState, players }, 'HUNTER_SHOOT') as number;
          if (targetId) {
            const shot = players.find(pl => pl.id === targetId);
            if (shot?.isAlive) {
              shot.isAlive = false; shot.deathDay = gameState.day; shot.deathReason = '猎人带走';
              addLog({ day: gameState.day, phase: Phase.DAY_RESULT, type: 'hunter',
                message: `🏹 猎人${exiledId}号开枪带走${targetId}号！` });
            }
          }
        }
      }
    } else {
      addLog({ day: gameState.day, phase: Phase.DAY_RESULT, type: 'system', message: '无人被放逐（平票）。' });
    }

    setIsProcessing(false);
    setHumanVoted(false);
    setGameState(prev => ({ ...prev, players, votes, voteReasons, idiotRevealedId, sheriffMustAct: deadSheriff }));
    if (deadSheriff) setGameState(prev => ({ ...prev, phase: Phase.SHERIFF_ACTION }));
    else nextPhase({ players });
  };

  // ── Human Night Actions ──
  const humanGuardAction = (targetId: number | null) => {
    setGameState(prev => ({ ...prev, guardTargetId: targetId ?? undefined }));
    addLog({ day: gameState.day, phase: Phase.NIGHT_GUARD, type: 'guard',
      message: targetId ? `你守护了${targetId}号。` : '你选择空守。' });
    nextPhase();
  };
  const humanKillVote = async (myVote: number) => {
    setIsProcessing(true);
    const votes: Record<number, number> = { 1: myVote };
    const aiWolves = gameState.players.filter(
      p => p.role === Role.WEREWOLF && p.isAlive && !p.isHuman
    );
    for (const wolf of aiWolves) {
      const targetId = await generateAIWolfKill(wolf, gameState) as number | null;
      if (targetId) votes[wolf.id] = targetId;
    }
    // 取票数最多的目标
    const counts: Record<number, number> = {};
    Object.values(votes).forEach(id => counts[id] = (counts[id] || 0) + 1);
    const finalTarget = +Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const voteLog = Object.entries(votes).map(([w, t]) => `${w}号投${t}号`).join('、');
    addLog({ day: gameState.day, phase: Phase.NIGHT_WOLVES, type: 'wolf',
      message: `[狼队内部] 投票：${voteLog} → 最终击杀${finalTarget}号。` });
    setGameState(prev => ({ ...prev, nightKilledId: finalTarget }));
    setIsProcessing(false);
    nextPhase();
  };
  const humanCheck = (id: number) => {
    const target = gameState.players.find(p => p.id === id)!;
    const side = getSide(target.role);
    setGameState(prev => ({ ...prev, seerRecords: [...prev.seerRecords, { targetId: id, role: target.role, side }] }));
    addLog({ day: gameState.day, phase: Phase.NIGHT_SEER, type: 'seer',
      message: `查验${id}号：${side === Side.GOOD ? '✅ 好人' : '❌ 狼人'}` });
    nextPhase();
  };
  const humanWitch = (action: 'save' | 'poison' | 'skip', id?: number) => {
    if (action === 'save') {
      setGameState(prev => ({ ...prev, witchSavedId: prev.nightKilledId, witchStatus: { ...prev.witchStatus, hasSavePotion: false } }));
      addLog({ day: gameState.day, phase: Phase.NIGHT_WITCH, type: 'witch', message: `你使用了解药。` });
    } else if (action === 'poison' && id) {
      setGameState(prev => ({ ...prev, witchPoisonedId: id, witchStatus: { ...prev.witchStatus, hasPoisonPotion: false } }));
      addLog({ day: gameState.day, phase: Phase.NIGHT_WITCH, type: 'witch', message: `你毒杀了${id}号。` });
    } else {
      addLog({ day: gameState.day, phase: Phase.NIGHT_WITCH, type: 'witch', message: `你没有使用任何药。` });
    }
    nextPhase();
  };
  const humanHunterShoot = (id: number | null) => {
    if (id) {
      const p = [...gameState.players];
      const shot = p.find(pl => pl.id === id)!;
      shot.isAlive = false; shot.deathDay = gameState.day; shot.deathReason = '猎人带走';
      addLog({ day: gameState.day, phase: Phase.NIGHT_RESULT, type: 'hunter',
        message: `🏹 你开枪带走了${id}号（${ROLE_LABELS[shot.role]}）` });
      setGameState(prev => ({ ...prev, players: p, hunterMustShoot: false }));
    } else {
      setGameState(prev => ({ ...prev, hunterMustShoot: false }));
    }
    nextPhase();
  };
  const humanSheriffElect = (run: boolean) => {
    const candidates = run ? [...gameState.sheriffCandidates, 1].sort((a, b) => a - b) : gameState.sheriffCandidates;
    setGameState(prev => ({ ...prev, sheriffCandidates: candidates }));
    addLog({ day: gameState.day, phase: Phase.SHERIFF_ELECT, type: 'system',
      message: `竞选名单：${candidates.length > 0 ? candidates.map(id => `${id}号`).join('、') : '无人上警'}` });
    nextPhase();
  };

  // ─── Derived State ────────────────────────────────────────────────────────
  const humanPlayer = gameState.players.find(p => p.isHuman);
  const humanRole = humanPlayer?.role ?? Role.VILLAGER;
  const humanAlive = humanPlayer?.isAlive ?? false;
  const { phase, day } = gameState;
  const isNight = phase.startsWith('NIGHT');
  const alivePlayers = gameState.players.filter(p => p.isAlive);

  const bgColor = isNight ? PHASE_COLORS.NIGHT
    : phase.startsWith('SHERIFF') ? PHASE_COLORS.SHERIFF
    : phase === Phase.DAY_VOTING || phase === Phase.DAY_RESULT ? PHASE_COLORS.VOTE
    : PHASE_COLORS.DAY;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col lg:flex-row h-screen overflow-hidden transition-colors duration-1000"
      style={{ background: bgColor, fontFamily: "'Noto Serif SC', serif" }}>

      {/* ── Sidebar ── */}
      <aside className="w-full lg:w-72 flex-shrink-0 border-b lg:border-b-0 lg:border-r overflow-y-auto"
        style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)' }}>

        <div className="p-4 lg:p-5">
          {/* Title */}
          <div className="text-center mb-5 lg:mb-6">
            <div className="text-2xl lg:text-3xl mb-1">🐺</div>
            <h1 className="text-base lg:text-lg font-bold tracking-[0.3em]" style={{ color: '#e8c97a' }}>狼人杀</h1>
            <div className="text-[10px] tracking-widest opacity-40 uppercase mt-0.5">AI 博弈对战</div>
          </div>

          {/* Your Role Card */}
          {humanPlayer && (
            <div className="mb-4 p-3 lg:p-4 rounded-xl border" style={{
              background: `${ROLE_COLORS[humanRole]}18`,
              borderColor: `${ROLE_COLORS[humanRole]}50`,
            }}>
              <div className="text-[10px] uppercase tracking-widest opacity-50 mb-2">你的身份</div>
              <div className="flex items-center gap-3">
                <span className="text-3xl">{ROLE_ICONS[humanRole]}</span>
                <div>
                  <div className="font-bold text-base" style={{ color: ROLE_COLORS[humanRole] }}>{ROLE_LABELS[humanRole]}</div>
                  <div className="text-[10px] opacity-50">{getSide(humanRole) === Side.GOOD ? '好人阵营' : '狼人阵营'}</div>
                </div>
              </div>
              {humanRole === Role.WEREWOLF && (
                <div className="mt-2 text-[11px] opacity-60">
                  狼队友：{gameState.players.filter(p => p.role === Role.WEREWOLF && p.id !== 1 && p.isAlive).map(p => `${p.id}号`).join('、') || '无'}
                </div>
              )}
              {humanRole === Role.SEER && gameState.seerRecords.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  <div className="text-[10px] uppercase tracking-widest opacity-40 mb-1">查验记录</div>
                  {gameState.seerRecords.map((r, i) => (
                    <div key={i} className="flex justify-between text-[11px] font-mono">
                      <span className="opacity-70">{r.targetId}号</span>
                      <span style={{ color: r.side === Side.GOOD ? '#52e090' : '#e05252' }}>
                        {r.side === Side.GOOD ? '✅ 好人' : '❌ 狼人'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {humanRole === Role.WITCH && (
                <div className="mt-2 flex gap-3 text-[11px]">
                  <span style={{ color: gameState.witchStatus.hasSavePotion ? '#52e090' : '#666' }}>
                    {gameState.witchStatus.hasSavePotion ? '💊 解药' : '💊 已用'}
                  </span>
                  <span style={{ color: gameState.witchStatus.hasPoisonPotion ? '#e05252' : '#666' }}>
                    {gameState.witchStatus.hasPoisonPotion ? '🧪 毒药' : '🧪 已用'}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Player List */}
          <div className="text-[10px] uppercase tracking-widest opacity-40 mb-2">玩家列表</div>
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-1.5 lg:gap-2">
            {gameState.players.map(p => (
              <div key={p.id}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all"
                style={{
                  background: p.isAlive ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.3)',
                  border: p.id === 1 ? `1px solid ${ROLE_COLORS[humanRole]}60` : '1px solid rgba(255,255,255,0.06)',
                  opacity: p.isAlive ? 1 : 0.45,
                }}>
                <span className="text-[10px] font-mono opacity-30 w-4">{p.id}</span>
                <span className="text-sm">{p.isAlive ? '❓' : ROLE_ICONS[p.role]}</span>
                <span className="text-xs flex-1 truncate" style={{ color: p.id === 1 ? ROLE_COLORS[humanRole] : '#ccc', textDecoration: p.isAlive ? 'none' : 'line-through' }}>
                  {p.id === 1 ? '你' : p.name}
                </span>
                {p.id === gameState.sheriffId && p.isAlive && <Crown className="w-3 h-3 text-yellow-400 flex-shrink-0" />}
                {!p.isAlive && <Skull className="w-3 h-3 opacity-30 flex-shrink-0" />}
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Phase Header */}
        <header className="flex-shrink-0 px-4 lg:px-6 py-3 flex items-center justify-between"
          style={{ background: 'rgba(0,0,0,0.5)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: isNight ? '#2d1b69' : '#6b3a1f' }}>
              {isNight ? <Moon className="w-4 h-4 text-purple-300" /> : <Sun className="w-4 h-4 text-amber-300" />}
            </div>
            <div>
              <div className="text-[10px] opacity-40 uppercase tracking-widest">第 {day} 天</div>
              <div className="text-sm font-bold" style={{ color: '#e8c97a' }}>
                {phase === Phase.NIGHT_GUARD && '守卫降临'}
                {phase === Phase.NIGHT_WOLVES && '黑夜猎杀'}
                {phase === Phase.NIGHT_SEER && '预言家查验'}
                {phase === Phase.NIGHT_WITCH && '女巫行动'}
                {phase === Phase.NIGHT_RESULT && '黎明降临'}
                {phase === Phase.SHERIFF_ELECT && '警长竞选'}
                {phase === Phase.SHERIFF_SPEECH && '竞选发言'}
                {phase === Phase.SHERIFF_VOTE && '警长投票'}
                {phase === Phase.SHERIFF_RESULT && '当选结果'}
                {phase === Phase.DAY_DISCUSSION && '白天辩论'}
                {phase === Phase.DAY_VOTING && '投票放逐'}
                {phase === Phase.DAY_RESULT && '放逐结果'}
                {phase === Phase.GAME_OVER && '游戏结束'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isProcessing && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] uppercase tracking-widest font-bold"
                style={{ background: 'rgba(255,200,50,0.1)', color: '#e8c97a', border: '1px solid rgba(255,200,50,0.2)' }}>
                <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                AI思考中
              </div>
            )}
            <button onClick={() => setGameState(INITIAL_STATE)}
              className="p-2 rounded-lg opacity-40 hover:opacity-80 transition-opacity"
              style={{ background: 'rgba(255,255,255,0.05)' }}>
              <RotateCcw className="w-3.5 h-3.5 text-white" />
            </button>
          </div>
        </header>

        {/* Log Area */}
        <div className="flex-1 overflow-y-auto px-4 lg:px-6 py-4 space-y-2.5">
          <AnimatePresence>
            {gameState.logs.map(log => (
              <motion.div key={log.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="flex gap-3 items-start">
                <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{
                    background: log.type === 'wolf' ? '#c0392b30' : log.type === 'seer' ? '#8e44ad30'
                      : log.type === 'witch' ? '#16a08530' : log.type === 'guard' ? '#2980b930'
                      : log.type === 'hunter' ? '#d3540030' : log.type === 'discussion' ? '#ffffff15'
                      : log.type === 'vote' ? '#e8c97a20' : '#ffffff10',
                    color: log.type === 'wolf' ? '#e05252' : log.type === 'seer' ? '#b07ae0'
                      : log.type === 'witch' ? '#52c0a0' : log.type === 'guard' ? '#52a0e0'
                      : log.type === 'hunter' ? '#e09052' : '#999',
                  }}>
                  {LOG_ICONS[log.type] || LOG_ICONS.system}
                </div>
                <div className="flex-1 min-w-0">
                  {log.playerName && (
                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-40 mr-2">
                      {log.playerName}
                    </span>
                  )}
                  <span className={`text-sm leading-relaxed ${log.type === 'discussion' ? 'italic' : 'opacity-80'}`}
                    style={{ color: log.type === 'discussion' ? '#e8d5b0' : '#aaa' }}>
                    {log.message}
                  </span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={logEndRef} />
        </div>

        {/* Action Panel */}
        <div className="flex-shrink-0 px-4 lg:px-6 py-4 min-h-[120px] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.5)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <AnimatePresence mode="wait">
            {!isProcessing && (
              <motion.div key={phase} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }} className="w-full max-w-xl">

                {/* Guard */}
                {phase === Phase.NIGHT_GUARD && humanRole === Role.GUARD && (
                  <ActionPanel label="守卫，选择守护目标" icon={<Shield className="w-4 h-4" />} color="#2980b9">
                    <div className="flex flex-wrap gap-2 justify-center">
                      {alivePlayers.filter(p => p.id !== gameState.lastGuardTargetId).map(p => (
                        <ActionBtn key={p.id} onClick={() => humanGuardAction(p.id)} color="#2980b9">{p.id}号</ActionBtn>
                      ))}
                      <ActionBtn onClick={() => humanGuardAction(null)} color="#555">空守</ActionBtn>
                    </div>
                  </ActionPanel>
                )}

                {/* Wolf Kill */}
                {phase === Phase.NIGHT_WOLVES && humanRole === Role.WEREWOLF && (
                  <ActionPanel label="狼人行动：选择击杀目标" icon={<Swords className="w-4 h-4" />} color="#c0392b">
                    <div className="text-center text-xs mb-3 px-3 py-2 rounded-lg"
                      style={{ background: 'rgba(192,57,43,0.15)', border: '1px solid rgba(192,57,43,0.3)' }}>
                      <span className="opacity-60">🐺 你的狼队友：</span>
                      <span className="font-bold ml-1" style={{ color: '#e05252' }}>
                        {gameState.players
                          .filter(p => p.role === Role.WEREWOLF && p.id !== 1 && p.isAlive)
                          .map(p => `${p.id}号`).join('、') || '（无存活队友）'}
                      </span>
                      <div className="text-[10px] opacity-40 mt-1">所有狼人各自投票，票数最多的目标被击杀</div>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {alivePlayers.filter(p => p.role !== Role.WEREWOLF).map(p => (
                        <ActionBtn key={p.id} onClick={() => humanKillVote(p.id)} color="#c0392b">{p.id}号</ActionBtn>
                      ))}
                    </div>
                  </ActionPanel>
                )}

                {/* Seer */}
                {phase === Phase.NIGHT_SEER && humanRole === Role.SEER && (
                  <ActionPanel label="预言家，选择查验目标" icon={<Eye className="w-4 h-4" />} color="#8e44ad">
                    <div className="flex flex-wrap gap-2 justify-center">
                      {alivePlayers.filter(p => !p.isHuman && !gameState.seerRecords.find(r => r.targetId === p.id)).map(p => (
                        <ActionBtn key={p.id} onClick={() => humanCheck(p.id)} color="#8e44ad">{p.id}号</ActionBtn>
                      ))}
                    </div>
                  </ActionPanel>
                )}

                {/* Witch */}
                {phase === Phase.NIGHT_WITCH && humanRole === Role.WITCH && (
                  <ActionPanel label="女巫，使用你的药" icon={<Wand2 className="w-4 h-4" />} color="#16a085">
                    <div className="flex flex-wrap gap-2 justify-center">
                      {gameState.witchStatus.hasSavePotion && gameState.nightKilledId && (
                        <ActionBtn onClick={() => humanWitch('save')} color="#52c0a0">
                          💊 救{gameState.nightKilledId}号
                        </ActionBtn>
                      )}
                      {gameState.witchStatus.hasPoisonPotion && alivePlayers.filter(p => !p.isHuman).map(p => (
                        <ActionBtn key={p.id} onClick={() => humanWitch('poison', p.id)} color="#c0392b">
                          🧪 毒{p.id}号
                        </ActionBtn>
                      ))}
                      <ActionBtn onClick={() => humanWitch('skip')} color="#555">不操作</ActionBtn>
                    </div>
                  </ActionPanel>
                )}

                {/* Night waiting */}
                {((phase === Phase.NIGHT_WOLVES && humanRole !== Role.WEREWOLF) ||
                  (phase === Phase.NIGHT_SEER && humanRole !== Role.SEER) ||
                  (phase === Phase.NIGHT_WITCH && humanRole !== Role.WITCH) ||
                  (phase === Phase.NIGHT_GUARD && humanRole !== Role.GUARD)) && (
                  <div className="text-center opacity-30 text-sm italic">黑夜降临，请闭眼...</div>
                )}

                {/* Night Result */}
                {phase === Phase.NIGHT_RESULT && !gameState.hunterMustShoot && (
                  <div className="text-center">
                    <ConfirmBtn onClick={() => nextPhase()}>确认，进入白天</ConfirmBtn>
                  </div>
                )}

                {/* Hunter shoot */}
                {gameState.hunterMustShoot && humanAlive && (
                  <ActionPanel label="你是猎人！死前开枪带走一人" icon={<Crosshair className="w-4 h-4" />} color="#d35400">
                    <div className="flex flex-wrap gap-2 justify-center">
                      {alivePlayers.filter(p => !p.isHuman).map(p => (
                        <ActionBtn key={p.id} onClick={() => humanHunterShoot(p.id)} color="#d35400">{p.id}号</ActionBtn>
                      ))}
                      <ActionBtn onClick={() => humanHunterShoot(null)} color="#555">放弃开枪</ActionBtn>
                    </div>
                  </ActionPanel>
                )}

                {/* Sheriff Election */}
                {phase === Phase.SHERIFF_ELECT && (
                  <ActionPanel label="警长竞选：是否上警？" icon={<Crown className="w-4 h-4" />} color="#e8c97a">
                    <div className="flex gap-3 justify-center">
                      <ActionBtn onClick={() => humanSheriffElect(true)} color="#e8c97a">参与竞选 ⬆️</ActionBtn>
                      <ActionBtn onClick={() => humanSheriffElect(false)} color="#555">放弃竞选</ActionBtn>
                    </div>
                  </ActionPanel>
                )}

                {/* Sheriff Speech */}
                {phase === Phase.SHERIFF_SPEECH && gameState.currentDiscussionIndex === 1 && (
                  <SpeechInput value={humanSpeechInput} onChange={setHumanSpeechInput} onSubmit={submitHumanSpeech}
                    placeholder="输入竞选发言..." />
                )}
                {phase === Phase.SHERIFF_SPEECH && gameState.currentDiscussionIndex !== 1 && gameState.currentDiscussionIndex > 0 && (
                  <div className="text-center opacity-50 text-sm italic">{gameState.currentDiscussionIndex}号玩家正在发言...</div>
                )}

                {/* Sheriff Vote */}
                {phase === Phase.SHERIFF_VOTE && (
                  <ActionPanel label="投票选出警长" icon={<Crown className="w-4 h-4" />} color="#e8c97a">
                    <div className="flex flex-wrap gap-2 justify-center">
                      {gameState.sheriffCandidates.map(id => (
                        <ActionBtn key={id} onClick={() => { const v: Record<number,number> = {...gameState.votes, 1: id}; finalizeSheriffVote(v, gameState.voteReasons); }} color="#e8c97a">
                          投{id}号
                        </ActionBtn>
                      ))}
                      <ActionBtn onClick={() => finalizeSheriffVote(gameState.votes, gameState.voteReasons)} color="#555">弃权</ActionBtn>
                    </div>
                  </ActionPanel>
                )}

                {/* Sheriff Result */}
                {phase === Phase.SHERIFF_RESULT && (
                  <div className="text-center"><ConfirmBtn onClick={() => nextPhase()}>确认结果</ConfirmBtn></div>
                )}

                {/* Sheriff Handoff */}
                {phase === Phase.SHERIFF_ACTION && gameState.players.find(p => p.id === gameState.sheriffId)?.isHuman && (
                  <ActionPanel label="你出局了！传递或撕毁警徽" icon={<Crown className="w-4 h-4" />} color="#e8c97a">
                    <div className="flex flex-wrap gap-2 justify-center">
                      {alivePlayers.filter(p => !p.isHuman).map(p => (
                        <ActionBtn key={p.id} onClick={() => applySheriffHandoff(p.id)} color="#e8c97a">传给{p.id}号</ActionBtn>
                      ))}
                      <ActionBtn onClick={() => applySheriffHandoff(null)} color="#c0392b">撕毁警徽</ActionBtn>
                    </div>
                  </ActionPanel>
                )}

                {/* Day Discussion */}
                {phase === Phase.DAY_DISCUSSION && gameState.currentDiscussionIndex === -1 && (
                  <div className="flex flex-col items-center gap-3">
                    {gameState.sheriffId === 1 ? (
                      <>
                        <div className="text-xs opacity-50">你是警长，选择发言方向：</div>
                        <div className="flex gap-3">
                          <ActionBtn onClick={() => startDiscussion(1)} color="#e8c97a">顺时针 →</ActionBtn>
                          <ActionBtn onClick={() => startDiscussion(-1)} color="#e8c97a">← 逆时针</ActionBtn>
                        </div>
                      </>
                    ) : (
                      <ConfirmBtn onClick={() => startDiscussion()}>开始辩论</ConfirmBtn>
                    )}
                  </div>
                )}
                {phase === Phase.DAY_DISCUSSION && gameState.currentDiscussionIndex === 1 && (
                  <SpeechInput value={humanSpeechInput} onChange={setHumanSpeechInput} onSubmit={submitHumanSpeech}
                    placeholder="输入你的发言（可留空跳过）..." />
                )}
                {phase === Phase.DAY_DISCUSSION && gameState.currentDiscussionIndex > 1 && (
                  <div className="text-center opacity-50 text-sm italic">{gameState.currentDiscussionIndex}号玩家正在发言...</div>
                )}

                {/* Day Voting — Wait for human */}
                {phase === Phase.DAY_VOTING && !humanVoted && (
                  <ActionPanel label={`投票放逐（警长${gameState.sheriffId ? gameState.sheriffId + '号，1.5票' : '无'}）`}
                    icon={<Vote className="w-4 h-4" />} color="#e05252">
                    <div className="flex flex-wrap gap-2 justify-center">
                      {alivePlayers.filter(p => !p.isHuman && gameState.idiotRevealedId !== p.id).map(p => (
                        <ActionBtn key={p.id} onClick={() => handleHumanVote(p.id)} color="#e05252">投{p.id}号</ActionBtn>
                      ))}
                      <ActionBtn onClick={() => handleHumanVote(null)} color="#555">弃权</ActionBtn>
                    </div>
                  </ActionPanel>
                )}
                {phase === Phase.DAY_VOTING && humanVoted && (
                  <div className="text-center opacity-50 text-sm italic">正在统计AI投票...</div>
                )}

                {/* Day Result */}
                {phase === Phase.DAY_RESULT && !gameState.hunterMustShoot && (
                  <div className="text-center"><ConfirmBtn onClick={() => nextPhase()}>进入夜晚</ConfirmBtn></div>
                )}

                {/* Game Over */}
                {phase === Phase.GAME_OVER && (
                  <div className="text-center space-y-4">
                    <div className="text-4xl">{gameState.winner === Side.GOOD ? '🎉' : '🐺'}</div>
                    <div className="text-xl font-bold" style={{ color: '#e8c97a' }}>
                      {gameState.winner === Side.GOOD ? '好人阵营胜利！' : '狼人阵营胜利！'}
                    </div>
                    <div className="flex flex-wrap gap-2 justify-center text-xs opacity-60">
                      {gameState.players.map(p => (
                        <span key={p.id} className="px-2 py-1 rounded-md"
                          style={{ background: 'rgba(255,255,255,0.05)' }}>
                          {p.id}号 {ROLE_ICONS[p.role]} {ROLE_LABELS[p.role]}
                        </span>
                      ))}
                    </div>
                    <button onClick={() => setGameState(INITIAL_STATE)}
                      className="px-6 py-2.5 rounded-xl font-bold text-sm transition-all hover:scale-105"
                      style={{ background: '#e8c97a', color: '#1a0a00' }}>
                      再来一局
                    </button>
                  </div>
                )}

              </motion.div>
            )}
            {isProcessing && (
              <div className="flex items-center gap-3">
                {[0,1,2].map(i => (
                  <motion.div key={i} animate={{ scale: [1,1.5,1], opacity: [0.3,1,0.3] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                    className="w-2 h-2 rounded-full" style={{ background: '#e8c97a' }} />
                ))}
              </div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

// ─── Sub Components ────────────────────────────────────────────────────────────
function ActionPanel({ label, icon, color, children }: { label: string; icon: React.ReactNode; color: string; children: React.ReactNode }) {
  return (
    <div className="w-full space-y-3">
      <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest" style={{ color, opacity: 0.8 }}>
        {icon}{label}
      </div>
      {children}
    </div>
  );
}

function ActionBtn({ onClick, color, children }: { onClick: () => void; color: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="px-4 py-2 rounded-xl text-sm font-bold transition-all hover:scale-105 active:scale-95"
      style={{ background: `${color}25`, border: `1px solid ${color}60`, color }}>
      {children}
    </button>
  );
}

function ConfirmBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="px-8 py-3 rounded-xl font-bold text-sm flex items-center gap-2 mx-auto transition-all hover:scale-105"
      style={{ background: '#e8c97a', color: '#1a0a00' }}>
      {children}<ChevronRight className="w-4 h-4" />
    </button>
  );
}

function SpeechInput({ value, onChange, onSubmit, placeholder }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void; placeholder: string;
}) {
  return (
    <div className="flex gap-2 w-full">
      <input value={value} onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && onSubmit()}
        placeholder={placeholder}
        className="flex-1 px-4 py-2.5 rounded-xl text-sm outline-none"
        style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#e8d5b0' }} />
      <button onClick={onSubmit}
        className="px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all hover:scale-105"
        style={{ background: '#e8c97a', color: '#1a0a00' }}>
        <Send className="w-3.5 h-3.5" />发言
      </button>
    </div>
  );
}
