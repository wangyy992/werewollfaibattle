/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  Moon, 
  Sun, 
  Shield, 
  Eye, 
  Flame, 
  Gavel, 
  ScrollText, 
  AlertCircle,
  Skull,
  Trophy,
  ChevronRight,
  Send,
  MessageSquare,
  History,
  RotateCcw
} from 'lucide-react';
import { 
  Player, Role, Phase, GameLog, GameState, Side, SeerRecord 
} from './types';
import { 
  PLAYER_COUNT, ROLE_LABELS, ROLE_ICONS 
} from './constants';
import { 
  initializePlayers, checkWinner, getSide 
} from './lib/gameUtils';
import { 
  generateAIDiscussion, 
  generateAIVote, 
  generateAINightAction,
  generateAIGuardAction,
  generateAISheriffChoice,
  generateAISheriffAction
} from './services/geminiService';

const INITIAL_STATE: GameState = {
  players: [],
  day: 1,
  phase: Phase.INIT,
  logs: [],
  witchStatus: { hasSavePotion: true, hasPoisonPotion: true },
  seerRecords: [],
  currentDiscussionIndex: -1,
  votes: {},
  voteReasons: {},
  lastNightDeaths: [],
  discussionDirection: 1,
  sheriffCandidates: [],
  isSheriffElectionCompleted: false,
};

export default function App() {
  const [gameState, setGameState] = useState<GameState>(INITIAL_STATE);
  const [isProcessing, setIsProcessing] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [gameState.logs]);

  // Initial setup
  useEffect(() => {
    if (gameState.phase === Phase.INIT) {
      const players = initializePlayers();
      const human = players.find(p => p.isHuman)!;
      addLog({
        day: 1,
        phase: Phase.INIT,
        message: `游戏开始！你的身份是：${ROLE_LABELS[human.role]} ${ROLE_ICONS[human.role]}`,
        type: 'system'
      }, players);
      
      setGameState(prev => ({
        ...prev,
        players,
        phase: Phase.NIGHT_GUARD
      }));
    }
  }, [gameState.phase]);

  const addLog = (log: Omit<GameLog, 'id'>, players = gameState.players) => {
    setGameState(prev => ({
      ...prev,
      players, // Ensure players state is updated if passed
      logs: [...prev.logs, { ...log, id: Math.random().toString(36).substr(2, 9) }]
    }));
  };

  const nextPhase = () => {
    const winner = checkWinner(gameState.players);
    if (winner) {
      setGameState(prev => ({ ...prev, phase: Phase.GAME_OVER, winner }));
      addLog({ day: gameState.day, phase: Phase.GAME_OVER, message: `游戏结束！${winner === Side.GOOD ? '好人阵营' : '狼人阵营'}获胜！`, type: 'system' });
      return;
    }

    setGameState(prev => {
      let next: Phase = prev.phase;
      let nextDay = prev.day;

      switch (prev.phase) {
        case Phase.NIGHT_GUARD: next = Phase.NIGHT_WOLVES; break;
        case Phase.NIGHT_WOLVES: next = Phase.NIGHT_SEER; break;
        case Phase.NIGHT_SEER: next = Phase.NIGHT_WITCH; break;
        case Phase.NIGHT_WITCH: next = Phase.NIGHT_RESULT; break;
        case Phase.NIGHT_RESULT: 
          if (prev.day === 1 && !prev.isSheriffElectionCompleted) {
            next = Phase.SHERIFF_ELECT;
          } else {
            next = Phase.DAY_DISCUSSION;
          }
          break;
        case Phase.SHERIFF_ELECT: next = Phase.SHERIFF_SPEECH; break;
        case Phase.SHERIFF_SPEECH: next = Phase.SHERIFF_VOTE; break;
        case Phase.SHERIFF_VOTE: next = Phase.SHERIFF_RESULT; break;
        case Phase.SHERIFF_RESULT: next = Phase.DAY_DISCUSSION; break;
        case Phase.DAY_DISCUSSION: next = Phase.DAY_VOTING; break;
        case Phase.DAY_VOTING: next = Phase.DAY_RESULT; break;
        case Phase.DAY_RESULT: 
          next = Phase.NIGHT_WOLVES; 
          nextDay++; 
          break;
        default: break;
      }
      return { ...prev, phase: next, day: nextDay };
    });
  };

  // AI actions triggers
  useEffect(() => {
    if (gameState.phase === Phase.NIGHT_GUARD && !gameState.players.find(p => p.isHuman && p.role === Role.GUARD)) {
      handleAIGuard();
    } else if (gameState.phase === Phase.NIGHT_WOLVES && !gameState.players.find(p => p.isHuman && p.role === Role.WEREWOLF)) {
      handleAIWolves();
    } else if (gameState.phase === Phase.NIGHT_SEER && !gameState.players.find(p => p.isHuman && p.role === Role.SEER)) {
      handleAISeer();
    } else if (gameState.phase === Phase.NIGHT_WITCH && !gameState.players.find(p => p.isHuman && p.role === Role.WITCH)) {
      handleAIWitch();
    } else if (gameState.phase === Phase.NIGHT_RESULT) {
      handleSettlement();
    } else if (gameState.phase === Phase.SHERIFF_ELECT) {
      handleAISheriffElect();
    } else if (gameState.phase === Phase.SHERIFF_SPEECH) {
      handleAISheriffSpeech();
    } else if (gameState.phase === Phase.SHERIFF_VOTE) {
      handleAISheriffVote();
    } else if (gameState.phase === Phase.SHERIFF_ACTION) {
      handleAISheriffAction();
    }
  }, [gameState.phase]);

  // AI Actions Logic
  const handleAIGuard = async () => {
    setIsProcessing(true);
    const guard = gameState.players.find(p => p.role === Role.GUARD && p.isAlive);
    if (guard) {
      const targetId = await generateAIGuardAction(guard, gameState);
      setGameState(prev => ({ ...prev, guardTargetId: targetId || undefined }));
    }
    setIsProcessing(false);
    nextPhase();
  };

  const handleHumanGuardAction = (targetId: number | null) => {
    setGameState(prev => ({ ...prev, guardTargetId: targetId || undefined }));
    if (targetId) {
      addLog({ day: gameState.day, phase: Phase.NIGHT_GUARD, message: `你守护了 ${targetId}号玩家。`, type: 'guard' });
    } else {
      addLog({ day: gameState.day, phase: Phase.NIGHT_GUARD, message: `你今晚空守。`, type: 'guard' });
    }
    nextPhase();
  };

  const handleAISheriffAction = async () => {
    setIsProcessing(true);
    const sheriff = gameState.players.find(p => p.id === gameState.sheriffId);
    if (sheriff && !sheriff.isHuman) {
      const targetId = await generateAISheriffAction(sheriff, gameState) as number;
      applySheriffAction(targetId);
    }
    setIsProcessing(false);
  };

  const applySheriffAction = (targetId: number | null) => {
    if (targetId && targetId !== -1) {
      addLog({ day: gameState.day, phase: Phase.SHERIFF_ACTION, message: `${gameState.sheriffId}号玩家将警徽移交给了${targetId}号。`, type: 'system' });
      setGameState(prev => ({ ...prev, sheriffId: targetId, sheriffMustAct: false }));
    } else {
      addLog({ day: gameState.day, phase: Phase.SHERIFF_ACTION, message: `${gameState.sheriffId}号玩家撕掉了警徽。`, type: 'system' });
      setGameState(prev => ({ ...prev, sheriffId: undefined, sheriffMustAct: false }));
    }
    
    // Check if hunter still needs to shoot
    if (!gameState.hunterMustShoot) {
      nextPhase();
    } else {
      // Hunter shoot is usually handled in NIGHT_RESULT or DAY_RESULT UI
      // If we are in SHERIFF_ACTION, let's go back to results to let hunter shoot
      setGameState(prev => ({ ...prev, phase: prev.phase === Phase.SHERIFF_ACTION ? (prev.day > 1 || prev.isSheriffElectionCompleted ? Phase.DAY_RESULT : Phase.NIGHT_RESULT) : prev.phase }));
    }
  };

  const handleAISheriffElect = async () => {
    setIsProcessing(true);
    try {
      const candidates: number[] = [];
      const aliveAI = gameState.players.filter(p => !p.isHuman && p.isAlive);
      
      for (const aiP of aliveAI) {
        const run = await generateAISheriffChoice(aiP, gameState);
        if (run) candidates.push(aiP.id);
      }

      setGameState(prev => ({ ...prev, sheriffCandidates: candidates }));
    } catch (error) {
      console.error("Sheriff Elect AI Error:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAISheriffSpeech = async () => {
    if (gameState.sheriffCandidates.length === 0) {
      nextPhase();
      return;
    }
    setGameState(prev => ({ ...prev, currentDiscussionIndex: prev.sheriffCandidates[0] }));
  };

  const handleAISheriffVote = async () => {
    setIsProcessing(true);
    try {
      const votes: Record<number, number> = {};
      const voteReasons: Record<number, string> = {};
      
      const voters = gameState.players.filter(p => p.isAlive && !gameState.sheriffCandidates.includes(p.id));
      
      for (const voter of voters) {
        if (voter.isHuman) continue;
        const result = await generateAIVote(voter, gameState);
        if (result.voteId && gameState.sheriffCandidates.includes(result.voteId)) {
          votes[voter.id] = result.voteId;
          voteReasons[voter.id] = result.reason;
        }
      }
      
      setGameState(prev => ({ ...prev, votes: { ...prev.votes, ...votes }, voteReasons: { ...prev.voteReasons, ...voteReasons } }));
      
      if (!voters.find(p => p.isHuman)) {
        finalizeSheriffVote({ ...gameState.votes, ...votes }, { ...gameState.voteReasons, ...voteReasons });
      }
    } catch (error) {
      console.error("Sheriff Vote AI Error:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const finalizeSheriffVote = (votes: Record<number, number>, voteReasons: Record<number, string>) => {
    const counts: Record<number, number> = {};
    Object.values(votes).forEach(vid => counts[vid] = (counts[vid] || 0) + 1);

    let maxVotes = 0;
    let candidates: number[] = [];
    Object.entries(counts).forEach(([vid, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        candidates = [Number(vid)];
      } else if (count === maxVotes) {
        candidates.push(Number(vid));
      }
    });

    const electedId = candidates.length === 1 ? candidates[0] : null;
    if (electedId) {
      addLog({ day: gameState.day, phase: Phase.SHERIFF_RESULT, message: `${electedId}号玩家当选警长！`, type: 'system' });
    } else {
      addLog({ day: gameState.day, phase: Phase.SHERIFF_RESULT, message: "由于平票或无人竞选，本局无警长。", type: 'system' });
    }

    setGameState(prev => ({ 
      ...prev, 
      sheriffId: electedId || undefined, 
      isSheriffElectionCompleted: true,
      votes,
      voteReasons
    }));
    setIsProcessing(false);
    nextPhase();
  };

  const handleHumanSheriffElectChoice = (run: boolean) => {
    const candidates = [...gameState.sheriffCandidates];
    if (run) candidates.push(1);
    
    setGameState(prev => ({ ...prev, sheriffCandidates: candidates.sort((a,b) => a-b) }));
    addLog({ day: gameState.day, phase: Phase.SHERIFF_ELECT, message: `警长竞选名单确认：${candidates.join(", ")}号`, type: 'system' });
    nextPhase();
  };

  const handleHumanSheriffVote = (targetId: number | null) => {
    // Collect AI votes first if not already done, or merge
    // For simplicity, let's assume we do this synchronously here or triggered by this
    const votes: Record<number, number> = { ...gameState.votes };
    const voteReasons: Record<number, string> = { ...gameState.voteReasons };
    if (targetId) {
      votes[1] = targetId;
      voteReasons[1] = "真人玩家投票。";
    }
    finalizeSheriffVote(votes, voteReasons);
  };
  const handleAIWolves = async () => {
    setIsProcessing(true);
    try {
      const wolf = gameState.players.find(p => p.role === Role.WEREWOLF && p.isAlive);
      if (wolf) {
        const targetId = await generateAINightAction(wolf, gameState, 'KILL') as number;
        setGameState(prev => ({ ...prev, nightKilledId: targetId }));
      }
    } catch (error) {
      console.error("AI Wolves Error:", error);
    } finally {
      setIsProcessing(false);
      nextPhase();
    }
  };

  const handleAISeer = async () => {
    setIsProcessing(true);
    try {
      const seer = gameState.players.find(p => p.role === Role.SEER && p.isAlive);
      if (seer) {
        const targetId = await generateAINightAction(seer, gameState, 'CHECK') as number;
        if (targetId && targetId !== -1) {
          const target = gameState.players.find(p => p.id === targetId)!;
          const side = getSide(target.role);
          const result: SeerRecord = { targetId, role: target.role, side };
          setGameState(prev => ({ ...prev, seerRecords: [...prev.seerRecords, result] }));
        }
      }
    } catch (error) {
      console.error("AI Seer Error:", error);
    } finally {
      setIsProcessing(false);
      nextPhase();
    }
  };

  const handleAIWitch = async () => {
    setIsProcessing(true);
    try {
      const witch = gameState.players.find(p => p.role === Role.WITCH && p.isAlive);
      if (witch) {
        const result = await generateAINightAction(witch, gameState, 'WITCH_ACTION') as { action: 'save' | 'poison' | 'skip', targetId?: number };
        if (result && result.action === 'save') {
          setGameState(prev => ({ ...prev, witchSavedId: prev.nightKilledId, witchStatus: { ...prev.witchStatus, hasSavePotion: false } }));
        } else if (result && result.action === 'poison' && result.targetId) {
          setGameState(prev => ({ ...prev, witchPoisonedId: result.targetId, witchStatus: { ...prev.witchStatus, hasPoisonPotion: false } }));
        }
      }
    } catch (error) {
      console.error("AI Witch Error:", error);
    } finally {
      setIsProcessing(false);
      nextPhase();
    }
  };

  const handleSettlement = async () => {
    const deaths: { id: number, name: string }[] = [];
    let updatedPlayers = [...gameState.players];
    const { nightKilledId, witchSavedId, witchPoisonedId, guardTargetId } = gameState;
    let hunterMustShoot = false;
    const nightDeathIds: number[] = [];

    // Milk Penetration: Guard and Witch save same target
    const isMilkPenetrated = nightKilledId && guardTargetId === nightKilledId && witchSavedId === nightKilledId;
    
    let kill: number | null = null;
    if (isMilkPenetrated) {
      kill = nightKilledId;
    } else if (nightKilledId) {
      const isProtected = guardTargetId === nightKilledId || witchSavedId === nightKilledId;
      if (!isProtected) {
        kill = nightKilledId;
      }
    }
    
    const poison = witchPoisonedId;

    for (const id of [kill, poison]) {
      if (id) {
        const player = updatedPlayers.find(p => p.id === id);
        if (player && player.isAlive) {
          player.isAlive = false;
          player.deathDay = gameState.day;
          player.deathReason = id === poison ? '女巫毒杀' : '狼人猎杀';
          deaths.push({ id, name: `${id}号玩家(${PLAYER_COUNT === 10 && id === 1 ? '你' : player.name})` });
          nightDeathIds.push(id);

          // Hunter logic
          if (player.role === Role.HUNTER) {
            if (player.isHuman) {
              hunterMustShoot = true;
              addLog({ day: gameState.day, phase: Phase.NIGHT_RESULT, message: "你是猎人，你出局了！点击目标开枪带走一人。", type: 'hunter' });
            } else {
              setIsProcessing(true);
              try {
                const targetId = await generateAINightAction(player, { ...gameState, players: updatedPlayers }, 'HUNTER_SHOOT') as number;
                if (targetId && targetId !== -1) {
                  const shotPlayer = updatedPlayers.find(p => p.id === targetId);
                  if (shotPlayer && shotPlayer.isAlive) {
                    shotPlayer.isAlive = false;
                    shotPlayer.deathDay = gameState.day;
                    shotPlayer.deathReason = '猎人带走';
                    deaths.push({ id: targetId, name: `${targetId}号玩家(${shotPlayer.name}) [猎人带走]` });
                  }
                }
              } catch (error) {
                console.error("AI Hunter Shoot Error:", error);
              } finally {
                setIsProcessing(false);
              }
            }
          }
        }
      }
    }

    if (deaths.length === 0) {
      addLog({ day: gameState.day, phase: Phase.NIGHT_RESULT, message: "今晚是平安夜。", type: 'system' }, updatedPlayers);
    } else {
      addLog({ day: gameState.day, phase: Phase.NIGHT_RESULT, message: `出局的玩家有：${deaths.map(d => d.name).join(", ")}`, type: 'system' }, updatedPlayers);
    }

    const deadSheriff = gameState.sheriffId && !updatedPlayers.find(p => p.id === gameState.sheriffId && p.isAlive);

    setGameState(prev => ({ 
      ...prev, 
      players: updatedPlayers, 
      nightKilledId: undefined, 
      witchSavedId: undefined, 
      witchPoisonedId: undefined,
      lastGuardTargetId: prev.guardTargetId,
      guardTargetId: undefined,
      hunterMustShoot,
      sheriffMustAct: !!deadSheriff,
      lastNightDeaths: nightDeathIds
    }));

    if (deadSheriff) {
      setGameState(prev => ({ ...prev, phase: Phase.SHERIFF_ACTION }));
    } else if (!hunterMustShoot) {
      nextPhase();
    }
  };

  const handleHumanHunterShoot = (targetId: number | null) => {
    let updatedPlayers = [...gameState.players];
    if (targetId) {
      const player = updatedPlayers.find(p => p.id === targetId)!;
      player.isAlive = false;
      player.deathDay = gameState.day;
      player.deathReason = '猎人带走';
      addLog({ day: gameState.day, phase: Phase.NIGHT_RESULT, message: `你开枪带走了${targetId}号玩家，其身份是：${ROLE_LABELS[player.role]}`, type: 'hunter' }, updatedPlayers);
    }
    setGameState(prev => ({ ...prev, players: updatedPlayers, hunterMustShoot: false }));
    nextPhase();
  };

  // Human Actions
  const handleHumanKill = (id: number) => {
    setGameState(prev => ({ ...prev, nightKilledId: id }));
    addLog({ day: gameState.day, phase: Phase.NIGHT_WOLVES, message: `你选择击杀 ${id}号玩家。`, type: 'wolf' });
    nextPhase();
  };

  const handleHumanCheck = (id: number) => {
    const target = gameState.players.find(p => p.id === id)!;
    const side = getSide(target.role);
    const result: SeerRecord = { targetId: id, role: target.role, side };
    setGameState(prev => ({ ...prev, seerRecords: [...prev.seerRecords, result] }));
    addLog({ day: gameState.day, phase: Phase.NIGHT_SEER, message: `查验结果：${id}号玩家是${side === Side.GOOD ? '好人' : '狼人'}。`, type: 'seer' });
    nextPhase();
  };

  const handleHumanWitchAction = (action: 'save' | 'poison' | 'skip', id?: number) => {
    if (action === 'save') {
      setGameState(prev => ({ ...prev, witchSavedId: prev.nightKilledId, witchStatus: { ...prev.witchStatus, hasSavePotion: false } }));
      addLog({ day: gameState.day, phase: Phase.NIGHT_WITCH, message: `你使用了面解药。`, type: 'witch' });
    } else if (action === 'poison' && id) {
      setGameState(prev => ({ ...prev, witchPoisonedId: id, witchStatus: { ...prev.witchStatus, hasPoisonPotion: false } }));
      addLog({ day: gameState.day, phase: Phase.NIGHT_WITCH, message: `你对${id}号玩家使用了毒药。`, type: 'witch' });
    } else {
      addLog({ day: gameState.day, phase: Phase.NIGHT_WITCH, message: `你没有进行任何操作。`, type: 'witch' });
    }
    nextPhase();
  };

  // Effect to handle sequential discussion
  const processedDiscussionIds = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (gameState.phase !== Phase.DAY_DISCUSSION && gameState.phase !== Phase.SHERIFF_SPEECH) {
      processedDiscussionIds.current.clear();
    }
  }, [gameState.phase]);

  useEffect(() => {
    if ((gameState.phase === Phase.DAY_DISCUSSION || gameState.phase === Phase.SHERIFF_SPEECH) && gameState.currentDiscussionIndex >= 0) {
      if (isProcessing) return; // Prevent multiple concurrent AI speech processes

      const alivePlayers = gameState.players.filter(p => p.id !== -1).map(p => p.id).sort((a,b) => a - b);
      const currentIndex = gameState.currentDiscussionIndex;
      const direction = gameState.discussionDirection || 1;
      
      const isSheriffPhase = gameState.phase === Phase.SHERIFF_SPEECH;
      const participants = isSheriffPhase ? gameState.sheriffCandidates : gameState.players.filter(p => p.isAlive).map(p => p.id).sort((a,b) => a - b);

      // Discussion ends if all players in current phase spoke
      if (!isSheriffPhase && processedDiscussionIds.current.size >= participants.length) {
        setTimeout(() => {
          setGameState(prev => ({ ...prev, currentDiscussionIndex: -1 }));
          nextPhase();
        }, 1000);
        return;
      }

      const player = gameState.players.find(p => p.id === currentIndex);
      if (!player || (gameState.phase === Phase.DAY_DISCUSSION && !player.isAlive) || processedDiscussionIds.current.has(currentIndex)) {
        // Find next player in sequence
        const currentPos = participants.indexOf(currentIndex);
        if (currentPos === -1) {
          // If current candidate is somehow not in list (e.g. died during sheriff speech - rare)
          const nextId = isSheriffPhase ? (gameState.sheriffCandidates[0] || -1) : participants[0];
          setGameState(prev => ({ ...prev, currentDiscussionIndex: nextId }));
          return;
        }

        if (isSheriffPhase) {
          if (currentPos < participants.length - 1) {
            setGameState(prev => ({ ...prev, currentDiscussionIndex: participants[currentPos + 1] }));
          } else {
            setGameState(prev => ({ ...prev, currentDiscussionIndex: -1 }));
            nextPhase();
          }
        } else {
          let nextPos = (currentPos + direction) % participants.length;
          if (nextPos < 0) nextPos = participants.length - 1;
          const nextId = participants[nextPos];
          setGameState(prev => ({ ...prev, currentDiscussionIndex: nextId }));
        }
        return;
      }

      if (player.isHuman) {
        return;
      }

      const runAIDiscussion = async () => {
        setIsProcessing(true);
        try {
          const speech = await generateAIDiscussion(player, gameState);
          const type = isSheriffPhase ? 'system' : 'discussion';
          addLog({ 
            day: gameState.day, 
            phase: gameState.phase, 
            message: speech || "过。", 
            type, 
            playerName: `${player.id}号` 
          });
          processedDiscussionIds.current.add(player.id);
          
          // Move to next player
          if (isSheriffPhase) {
            const currentPos = participants.indexOf(player.id);
            if (currentPos < participants.length - 1) {
              const nextId = participants[currentPos + 1];
              setTimeout(() => setGameState(prev => ({ ...prev, currentDiscussionIndex: nextId })), 1500);
            } else {
              setTimeout(() => {
                setGameState(prev => ({ ...prev, currentDiscussionIndex: -1 }));
                nextPhase();
              }, 1500);
            }
          } else {
            const currentPos = participants.indexOf(player.id);
            let nextPos = (currentPos + direction) % participants.length;
            if (nextPos < 0) nextPos = participants.length - 1;
            const nextId = participants[nextPos];
            setTimeout(() => {
              setGameState(prev => ({ ...prev, currentDiscussionIndex: nextId }));
            }, 1500);
          }
        } catch (error) {
          console.error("AI Discussion Error:", error);
          // If error, just skip this player to avoid hang
          processedDiscussionIds.current.add(player.id);
          setGameState(prev => ({ ...prev, currentDiscussionIndex: -1 })); // Reset or skip logic needed here
        } finally {
          setIsProcessing(false);
        }
      };

      runAIDiscussion();
    }
  }, [gameState.phase, gameState.currentDiscussionIndex, isProcessing]);

  const handleStartDiscussion = async (directionChoice?: 1 | -1) => {
    const alivePlayers = gameState.players.filter(p => p.isAlive).map(p => p.id).sort((a,b) => a - b);
    if (alivePlayers.length === 0) return;

    // If AI is sheriff, it decides direction randomly for now
    let direction: 1 | -1 = directionChoice || 1;
    if (!directionChoice && gameState.sheriffId) {
      const sheriff = gameState.players.find(p => p.id === gameState.sheriffId);
      if (sheriff && !sheriff.isHuman) {
        direction = Math.random() > 0.5 ? 1 : -1;
      }
    }

    let startId = alivePlayers[0];
    if (gameState.lastNightDeaths.length > 0) {
      const lastDeadId = gameState.lastNightDeaths[gameState.lastNightDeaths.length - 1];
      const potentialStarts = alivePlayers.filter(id => id > lastDeadId);
      if (potentialStarts.length > 0) {
        startId = potentialStarts[0];
      } else {
        startId = alivePlayers[0];
      }
    } else {
      startId = alivePlayers[0];
    }
    
    setGameState(prev => ({ ...prev, currentDiscussionIndex: startId, discussionDirection: direction }));
    if (gameState.sheriffId) {
      addLog({ day: gameState.day, phase: Phase.DAY_DISCUSSION, message: `警长决定发言顺序：${direction === 1 ? '顺时针' : '逆时针'}。`, type: 'system' });
    }
  };

  const handleHumanSpeech = (speech: string) => {
    const type = (gameState.phase === Phase.SHERIFF_SPEECH) ? 'system' : 'discussion';
    addLog({ 
      day: gameState.day, 
      phase: gameState.phase, 
      message: speech || "过。", 
      type, 
      playerName: "你" 
    });
    processedDiscussionIds.current.add(1);
    
    if (gameState.phase === Phase.SHERIFF_SPEECH) {
      const currentPos = gameState.sheriffCandidates.indexOf(1);
      if (currentPos < gameState.sheriffCandidates.length - 1) {
        const nextId = gameState.sheriffCandidates[currentPos + 1];
        setGameState(prev => ({ ...prev, currentDiscussionIndex: nextId }));
      } else {
        setGameState(prev => ({ ...prev, currentDiscussionIndex: -1 }));
        nextPhase();
      }
    } else {
      const direction = gameState.discussionDirection || 1;
      const alivePlayers = gameState.players.filter(p => p.isAlive).map(p => p.id).sort((a,b) => a - b);
      const currentPos = alivePlayers.indexOf(1);
      let nextPos = (currentPos + direction) % alivePlayers.length;
      if (nextPos < 0) nextPos = alivePlayers.length - 1;
      const nextId = alivePlayers[nextPos];
      setGameState(prev => ({ ...prev, currentDiscussionIndex: nextId }));
    }
  };

  const handleStartVoting = async () => {
    setGameState(prev => ({ ...prev, votes: {} }));
  };

  const handleHumanVote = async (targetId: number | null) => {
    setIsProcessing(true);
    const votes: Record<number, number> = {};
    const voteReasons: Record<number, string> = {};
    if (targetId) {
      votes[1] = targetId;
      voteReasons[1] = "真人玩家投票。";
    }

    const aliveAI = gameState.players.filter(p => p.isAlive && !p.isHuman);
    for (const ai of aliveAI) {
      const result = await generateAIVote(ai, gameState);
      if (result.voteId) {
        votes[ai.id] = result.voteId;
        voteReasons[ai.id] = result.reason;
        addLog({ day: gameState.day, phase: Phase.DAY_VOTING, message: `${ai.id}号投票给了 ${result.voteId}号。理由：${result.reason}`, type: 'vote' });
      } else {
        voteReasons[ai.id] = result.reason;
        addLog({ day: gameState.day, phase: Phase.DAY_VOTING, message: `${ai.id}号弃权了。理由：${result.reason}`, type: 'vote' });
      }
    }

    // Settlement
    const counts: Record<number, number> = {};
    Object.entries(votes).forEach(([voterId, vid]) => {
      const weight = Number(voterId) === gameState.sheriffId ? 1.5 : 1;
      counts[vid] = (counts[vid] || 0) + weight;
    });
    
    let maxVotes = 0;
    let candidates: number[] = [];
    Object.entries(counts).forEach(([vid, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        candidates = [Number(vid)];
      } else if (count === maxVotes) {
        candidates.push(Number(vid));
      }
    });

    let exiledId = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : null;
    
    let updatedPlayers = [...gameState.players];
    let deadSheriff = false;
    let idiotRevealedId: number | undefined = undefined;

    if (exiledId) {
      const player = updatedPlayers.find(p => p.id === exiledId)!;
      if (player.role === Role.IDIOT && !gameState.idiotRevealedId) {
        // Idiot Reveal
        idiotRevealedId = exiledId;
        addLog({ day: gameState.day, phase: Phase.DAY_RESULT, message: `${exiledId}号玩家是【白痴】，翻牌免疫本次放逐！他将失去投票权。`, type: 'idiot' }, updatedPlayers);
      } else {
        player.isAlive = false;
        player.deathDay = gameState.day;
        player.deathReason = '投票放逐';
        addLog({ day: gameState.day, phase: Phase.DAY_RESULT, message: `${exiledId}号玩家被投票放逐（得票数：${maxVotes}），其身份是：${ROLE_LABELS[player.role]}`, type: 'system' }, updatedPlayers);
        
        if (exiledId === gameState.sheriffId) {
          deadSheriff = true;
        }
      }
    } else {
      addLog({ day: gameState.day, phase: Phase.DAY_RESULT, message: "由于平票或弃权，无人出局。", type: 'system' });
    }

    setIsProcessing(false);
    setGameState(prev => ({ 
      ...prev, 
      players: updatedPlayers, 
      votes, 
      voteReasons,
      idiotRevealedId: idiotRevealedId || prev.idiotRevealedId,
      sheriffMustAct: deadSheriff
    }));
    
    if (deadSheriff) {
      setGameState(prev => ({ ...prev, phase: Phase.SHERIFF_ACTION }));
    } else {
      nextPhase();
    }
  };

  const resetGame = () => {
    setGameState(INITIAL_STATE);
  };

  const humanPlayer = gameState.players.find(p => p.isHuman) || { role: Role.VILLAGER } as Player;

  return (
    <div className="flex h-screen bg-[#FDFCFB] text-[#1A1A1A] font-sans selection:bg-[#F27D26]/20">
      {/* Sidebar: Players and Info */}
      <aside className="w-80 border-r border-[#E4E3E0] overflow-y-auto bg-[#E4E3E0]/30 p-6 flex flex-col gap-8">
        <div>
          <div className="flex items-center gap-2 mb-6">
            <Users className="w-5 h-5 opacity-40" />
            <h2 className="text-xs uppercase tracking-widest font-semibold opacity-60">玩家状态</h2>
          </div>
          <div className="space-y-3">
            {gameState.players.map(player => (
              <div 
                key={player.id}
                className={`p-4 rounded-xl border transition-all duration-300 ${
                  player.isAlive 
                    ? player.id === 1 ? 'bg-white border-[#F27D26] shadow-sm' : 'bg-white border-[#E4E3E0] hover:border-[#141414]/20'
                    : 'bg-[#E4E3E0]/50 border-transparent opacity-60 grayscale'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-mono font-bold opacity-30">{player.id.toString().padStart(2, '0')}</span>
                    <span className={`font-medium ${player.id === 1 ? 'text-[#F27D26]' : ''}`}>
                      {player.name}
                    </span>
                  </div>
                  {!player.isAlive && (
                    <div className="flex items-center gap-1 text-[10px] bg-[#141414] text-white px-2 py-0.5 rounded-full uppercase tracking-tighter">
                      <Skull className="w-3 h-3" />
                      {ROLE_LABELS[player.role]}
                    </div>
                  )}
                  {player.isAlive && player.id === gameState.sheriffId && (
                    <div className="text-[10px] bg-yellow-500 text-white px-2 py-0.5 rounded-full uppercase tracking-tighter font-bold ml-1">
                      警
                    </div>
                  )}
                  {player.id === gameState.idiotRevealedId && (
                    <div className="text-[10px] bg-blue-500 text-white px-2 py-0.5 rounded-full uppercase tracking-tighter font-bold ml-1">
                      🤡
                    </div>
                  )}
                  {player.isAlive && player.id === 1 && (
                    <div className="text-[10px] bg-[#F27D26] text-white px-2 py-0.5 rounded-full uppercase tracking-tighter font-bold">
                      你
                    </div>
                  )}
                </div>
                {!player.isAlive && (
                  <div className="mt-2 text-[10px] opacity-40 font-mono italic">
                    Day {player.deathDay} • {player.deathReason}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {humanPlayer && (
          <div className="mt-auto">
            <div className="p-6 bg-[#141414] text-[#E4E3E0] rounded-2xl shadow-xl overflow-hidden relative">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-2xl" />
              <div className="relative z-10">
                <div className="text-[10px] uppercase tracking-widest opacity-40 mb-2 font-bold">你的身份</div>
                <div className="flex items-center gap-4">
                  <span className="text-4xl">{ROLE_ICONS[humanPlayer.role]}</span>
                  <div>
                    <div className="text-xl font-serif italic">{ROLE_LABELS[humanPlayer.role]}</div>
                    <div className="text-[10px] opacity-60 font-mono uppercase tracking-tighter">
                      {getSide(humanPlayer.role) === Side.GOOD ? '好人阵营' : '狼人阵营'}
                    </div>
                  </div>
                </div>

                {humanPlayer.role === Role.SEER && gameState.seerRecords.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-white/10">
                    <div className="text-[10px] uppercase tracking-widest opacity-40 mb-2 font-bold">查验记录</div>
                    <div className="space-y-1">
                      {gameState.seerRecords.map((r, i) => (
                        <div key={i} className="text-xs flex justify-between font-mono">
                          <span>{r.targetId}号</span>
                          <span className={r.side === Side.GOOD ? 'text-green-400' : 'text-red-400'}>{r.side === Side.GOOD ? '好人' : '狼人'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden bg-white">
        {/* Phase Header */}
        <header className="h-20 border-b border-[#E4E3E0] px-8 flex items-center justify-between bg-white/80 backdrop-blur-md sticky top-0 z-20">
          <div className="flex items-center gap-6">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors duration-500 ${
              gameState.phase.startsWith('NIGHT') ? 'bg-[#141414] text-white' : 'bg-[#F27D26] text-white shadow-lg shadow-[#F27D26]/20'
            }`}>
              {gameState.phase.startsWith('NIGHT') ? <Moon className="w-6 h-6" /> : <Sun className="w-6 h-6" />}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-30">第 {gameState.day} 天</div>
              <h1 className="text-xl font-serif italic tracking-tight text-black">
                {gameState.phase === Phase.NIGHT_GUARD && '守卫降临：守护生命之火'}
                {gameState.phase === Phase.NIGHT_WOLVES && '狼人出动：黑暗笼罩森林'}
                {gameState.phase === Phase.NIGHT_SEER && '预言家入梦：窥探真相'}
                {gameState.phase === Phase.NIGHT_WITCH && '女巫研药：生命与剧毒'}
                {gameState.phase === Phase.NIGHT_RESULT && '黎明报信：昨夜战况'}
                {gameState.phase === Phase.SHERIFF_ELECT && '警长竞选：群雄逐鹿'}
                {gameState.phase === Phase.SHERIFF_SPEECH && '竞选发言：唇枪舌战'}
                {gameState.phase === Phase.SHERIFF_VOTE && '警长投票：庄严选择'}
                {gameState.phase === Phase.SHERIFF_RESULT && '执政之锤：新警长诞生'}
                {gameState.phase === Phase.DAY_DISCUSSION && '自由辩论：逻辑的博弈'}
                {gameState.phase === Phase.DAY_VOTING && '投票表决：谁是有罪者？'}
                {gameState.phase === Phase.DAY_RESULT && '审判结果：放逐之刻'}
                {gameState.phase === Phase.GAME_OVER && '游戏结束：真相大白'}
              </h1>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-4 py-2 bg-[#E4E3E0]/30 rounded-full border border-[#E4E3E0]">
              <div className={`w-2 h-2 rounded-full animate-pulse ${isProcessing ? 'bg-[#F27D26]' : 'bg-green-500'}`} />
              <span className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                {isProcessing ? 'AI 正在推理...' : '准备就绪'}
              </span>
            </div>
            {gameState.phase === Phase.GAME_OVER && (
              <button 
                onClick={resetGame}
                className="flex items-center gap-2 px-5 py-2 bg-[#141414] text-white rounded-full hover:bg-black transition-all font-medium text-xs flex-shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                重新开始
              </button>
            )}
          </div>
        </header>

        {/* Logs Area */}
        <div className="flex-1 overflow-y-auto p-8 space-y-6 scrollbar-hide">
          <AnimatePresence>
            {gameState.logs.map((log, index) => (
              <motion.div
                key={log.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-4 ${log.type === 'discussion' ? 'items-start' : 'items-center'}`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  log.type === 'system' ? 'bg-[#E4E3E0] text-[#141414]' :
                  log.type === 'wolf' ? 'bg-red-100 text-red-600' :
                  log.type === 'seer' ? 'bg-purple-100 text-purple-600' :
                  log.type === 'witch' ? 'bg-green-100 text-green-600' :
                  log.type === 'discussion' ? 'bg-blue-50 text-blue-500' :
                  'bg-gray-100 text-gray-500'
                }`}>
                  {log.type === 'system' && <ScrollText className="w-4 h-4" />}
                  {log.type === 'wolf' && <Skull className="w-4 h-4" />}
                  {log.type === 'seer' && <Eye className="w-4 h-4" />}
                  {log.type === 'witch' && <Shield className="w-4 h-4" />}
                  {log.type === 'guard' && <Shield className="w-4 h-4" />}
                  {log.type === 'idiot' && <ScrollText className="w-4 h-4" />}
                  {log.type === 'discussion' && <MessageSquare className="w-4 h-4" />}
                  {log.type === 'vote' && <Gavel className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  {log.playerName && (
                    <div className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-1">
                      {log.playerName}
                    </div>
                  )}
                  <div className={`text-sm leading-relaxed ${log.type === 'discussion' ? 'font-serif text-base italic text-[#141414]' : 'text-[#666]'}`}>
                    {log.message}
                  </div>
                </div>
                <div className="text-[10px] font-mono opacity-20 whitespace-nowrap self-start mt-1">
                  DAY {log.day}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={logEndRef} />
        </div>

        {/* Action Panel */}
        <div className="p-8 bg-[#FDFCFB] border-t border-[#E4E3E0] min-h-[160px] flex items-center justify-center relative">
          {!isProcessing && (
            <AnimatePresence mode="wait">
              {/* NIGHT ACTIONS */}
              {gameState.phase === Phase.NIGHT_GUARD && humanPlayer.role === Role.GUARD && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-6">
                  <p className="text-sm font-medium opacity-50 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-blue-500" />
                    守卫，请选择一名玩家进行守护
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {gameState.players.filter(p => p.isAlive && p.id !== gameState.lastGuardTargetId).map(p => (
                      <button 
                        key={p.id}
                        onClick={() => handleHumanGuardAction(p.id)}
                        className="px-6 py-2 border-2 border-blue-600 text-blue-600 rounded-xl hover:bg-blue-600 hover:text-white transition-all font-bold text-sm"
                      >
                        {p.id}号 {p.name}
                      </button>
                    ))}
                    <button 
                      onClick={() => handleHumanGuardAction(null)}
                      className="px-6 py-2 border-2 border-gray-400 text-gray-400 rounded-xl hover:bg-gray-400 hover:text-white transition-all font-bold text-sm"
                    >
                      空守
                    </button>
                  </div>
                </motion.div>
              )}

              {gameState.phase === Phase.SHERIFF_ELECT && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-6">
                  <p className="text-sm font-medium opacity-60">第一天：警长竞选。预言家必须上警！</p>
                  <div className="flex gap-4">
                    <button 
                      onClick={() => handleHumanSheriffElectChoice(true)}
                      className="px-8 py-3 bg-[#F27D26] text-white rounded-xl shadow-lg shadow-[#F27D26]/20 font-bold hover:scale-105 transition-all"
                    >
                      参与竞选 (上警)
                    </button>
                    <button 
                      onClick={() => handleHumanSheriffElectChoice(false)}
                      className="px-8 py-3 bg-[#141414] text-white rounded-xl font-bold hover:bg-black transition-all"
                    >
                      放弃竞选 (不上)
                    </button>
                  </div>
                </motion.div>
              )}

              {gameState.phase === Phase.SHERIFF_SPEECH && (
                <div className="w-full max-w-2xl text-center">
                  {gameState.currentDiscussionIndex === 1 ? (
                    <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="flex gap-4">
                      <input 
                        id="sheriff-speech"
                        placeholder="输入你的竞选发言..."
                        className="flex-1 bg-white border-2 border-[#E4E3E0] rounded-2xl px-6 py-4 focus:border-[#F27D26] outline-none transition-all placeholder:italic text-lg italic font-serif"
                      />
                      <button 
                        onClick={() => {
                          const input = document.getElementById('sheriff-speech') as HTMLInputElement;
                          handleHumanSpeech(input.value);
                          input.value = '';
                        }}
                        className="px-8 bg-[#F27D26] text-white rounded-2xl font-bold hover:bg-[#E26D16] transition-all flex items-center gap-2"
                      >
                        <Send className="w-4 h-4" />
                        发言
                      </button>
                    </motion.div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex items-center gap-2 text-[#F27D26]">
                        <ScrollText className="w-5 h-5 animate-pulse" />
                        <span className="font-bold tracking-tight">{gameState.currentDiscussionIndex}号玩家正在进行竞选发言...</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {gameState.phase === Phase.SHERIFF_VOTE && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-6">
                   <p className="text-sm font-medium opacity-50 flex items-center gap-2">
                    <Gavel className="w-4 h-4 text-[#F27D26]" />
                    警长选举：请投出你的一票
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {gameState.sheriffCandidates.map(cid => (
                      <button 
                        key={cid}
                        onClick={() => handleHumanSheriffVote(cid)}
                        className="px-6 py-3 border-2 border-[#E4E3E0] rounded-2xl hover:border-[#F27D26] hover:text-[#F27D26] transition-all font-bold text-sm bg-white"
                      >
                        投给 {cid}号
                      </button>
                    ))}
                    <button 
                      onClick={() => handleHumanSheriffVote(null)}
                      className="px-8 py-3 bg-[#E4E3E0] text-[#141414] rounded-2xl font-bold hover:bg-[#D4D3D0] transition-all text-sm"
                    >
                      弃权
                    </button>
                  </div>
                </motion.div>
              )}

              {gameState.phase === Phase.SHERIFF_RESULT && (
                 <button 
                    onClick={nextPhase}
                    className="group px-10 py-4 bg-[#F27D26] text-white rounded-2xl shadow-2xl flex items-center gap-3 hover:scale-105 active:scale-95 transition-all"
                  >
                    <span className="font-bold tracking-tight">确认选举结果</span>
                    <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </button>
              )}

              {gameState.phase === Phase.SHERIFF_ACTION && gameState.players.find(p => p.id === gameState.sheriffId)?.isHuman && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-6">
                  <p className="text-sm font-medium opacity-50 flex items-center gap-2">
                    <History className="w-4 h-4 text-[#F27D26]" />
                    移交警徽：请选择继任者或撕掉警徽
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {gameState.players.filter(p => p.isAlive && p.id !== 1).map(p => (
                      <button 
                        key={p.id}
                        onClick={() => applySheriffAction(p.id)}
                        className="px-6 py-2 border-2 border-[#141414] rounded-xl hover:bg-[#141414] hover:text-white transition-all font-bold text-sm"
                      >
                        交位给 {p.id}号
                      </button>
                    ))}
                    <button 
                      onClick={() => applySheriffAction(null)}
                      className="px-6 py-2 border-2 border-red-500 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all font-bold text-sm"
                    >
                      撕掉警徽
                    </button>
                  </div>
                </motion.div>
              )}

              {gameState.phase === Phase.NIGHT_WOLVES && humanPlayer.role === Role.WEREWOLF && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-6">
                  <p className="text-sm font-medium opacity-50 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500" />
                    请选择一名玩家进行击杀
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {gameState.players.filter(p => p.isAlive && p.role !== Role.WEREWOLF).map(p => (
                      <button 
                        key={p.id}
                        onClick={() => handleHumanKill(p.id)}
                        className="px-6 py-2 border-2 border-[#141414] rounded-xl hover:bg-[#141414] hover:text-white transition-all font-bold text-sm"
                      >
                        {p.id}号 {p.name}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}

              {gameState.phase === Phase.NIGHT_SEER && humanPlayer.role === Role.SEER && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-6">
                  <p className="text-sm font-medium opacity-50 flex items-center gap-2">
                    <Eye className="w-4 h-4 text-purple-500" />
                    请选择一名玩家查验身份
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {gameState.players.filter(p => p.isAlive && !p.isHuman).map(p => (
                      <button 
                        key={p.id}
                        onClick={() => handleHumanCheck(p.id)}
                        className="px-6 py-2 border-2 border-purple-600 text-purple-600 rounded-xl hover:bg-purple-600 hover:text-white transition-all font-bold text-sm"
                      >
                        {p.id}号 {p.name}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}

              {gameState.phase === Phase.NIGHT_WITCH && humanPlayer.role === Role.WITCH && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-6">
                  <p className="text-sm font-medium opacity-60">女巫，你有一瓶灵药和一瓶毒药...</p>
                  <div className="flex gap-4">
                    {gameState.witchStatus.hasSavePotion && gameState.nightKilledId && (
                      <button 
                        onClick={() => handleHumanWitchAction('save')}
                        className="px-6 py-3 bg-green-600 text-white rounded-xl shadow-lg shadow-green-600/20 hover:scale-105 transition-all font-bold text-sm"
                      >
                        解救 {gameState.nightKilledId}号
                      </button>
                    )}
                    {gameState.witchStatus.hasPoisonPotion && (
                      <div className="flex gap-2">
                        {gameState.players.filter(p => p.isAlive && !p.isHuman).map(p => (
                          <button 
                            key={p.id}
                            onClick={() => handleHumanWitchAction('poison', p.id)}
                            className="w-12 h-12 border-2 border-red-500 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all font-bold text-xs"
                          >
                            毒{p.id}
                          </button>
                        ))}
                      </div>
                    )}
                    <button onClick={() => handleHumanWitchAction('skip')} className="px-6 py-3 border-2 border-[#E4E3E0] rounded-xl hover:bg-[#E4E3E0] transition-all font-bold text-sm">
                      不进行任何操作
                    </button>
                  </div>
                </motion.div>
              )}

              {/* Waiting phases */}
              {(
                (gameState.phase === Phase.NIGHT_WOLVES && humanPlayer.role !== Role.WEREWOLF) ||
                (gameState.phase === Phase.NIGHT_SEER && humanPlayer.role !== Role.SEER) ||
                (gameState.phase === Phase.NIGHT_WITCH && humanPlayer.role !== Role.WITCH)
              ) && (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-10 h-10 border-4 border-[#141414]/10 border-t-[#141414] rounded-full animate-spin" />
                  <p className="text-xs uppercase tracking-widest font-bold opacity-30 italic">长夜漫漫，请闭眼...</p>
                </div>
              )}

              {gameState.phase === Phase.NIGHT_RESULT && !gameState.hunterMustShoot && (
                <button 
                  onClick={nextPhase}
                  className="group px-10 py-4 bg-[#141414] text-white rounded-2xl shadow-2xl flex items-center gap-3 hover:scale-105 active:scale-95 transition-all"
                >
                  <span className="font-bold tracking-tight">确认并进入白天</span>
                  <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
              )}

              {gameState.hunterMustShoot && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-6">
                  <p className="text-sm font-medium opacity-50 flex items-center gap-2">
                    <Flame className="w-4 h-4 text-red-600" />
                    你是猎人！请在死前带走一人
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {gameState.players.filter(p => p.isAlive && !p.isHuman).map(p => (
                      <button 
                        key={p.id}
                        onClick={() => handleHumanHunterShoot(p.id)}
                        className="px-6 py-2 bg-red-600 text-white rounded-xl hover:bg-black transition-all font-bold text-sm"
                      >
                        击杀 {p.id}号 {p.name}
                      </button>
                    ))}
                    <button onClick={() => handleHumanHunterShoot(null)} className="px-6 py-2 border border-[#E4E3E0] rounded-xl text-xs opacity-50 hover:opacity-100">
                      放弃开枪
                    </button>
                  </div>
                </motion.div>
              )}

              {/* DISCUSSION */}
              {gameState.phase === Phase.DAY_DISCUSSION && (
                <div className="w-full max-w-2xl">
                  {gameState.currentDiscussionIndex === -1 ? (
                    <div className="flex flex-col items-center gap-6">
                      {gameState.sheriffId === 1 ? (
                        <div className="flex flex-col items-center gap-4">
                           <p className="text-sm font-medium opacity-60">你是警长，请选择发言方向：</p>
                           <div className="flex gap-4">
                              <button 
                                onClick={() => handleStartDiscussion(1)}
                                className="px-8 py-3 bg-[#F27D26] text-white rounded-xl shadow-lg shadow-[#F27D26]/20 font-bold hover:scale-105 transition-all"
                              >
                                顺时针发言
                              </button>
                              <button 
                                onClick={() => handleStartDiscussion(-1)}
                                className="px-8 py-3 bg-[#141414] text-white rounded-xl font-bold hover:bg-black transition-all"
                              >
                                逆时针发言
                              </button>
                           </div>
                        </div>
                      ) : (
                        <button 
                          onClick={() => handleStartDiscussion()}
                          className="px-10 py-4 bg-[#F27D26] text-white rounded-2xl shadow-2xl shadow-[#F27D26]/20 font-bold hover:scale-105 transition-all"
                        >
                          开始全员辩论
                        </button>
                      )}
                    </div>
                  ) : gameState.currentDiscussionIndex === 1 ? (
                    <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="flex gap-4">
                      <input 
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleHumanVote(null); // Just for test or add speech
                        }}
                        placeholder="输入你的发言（或留空过）..."
                        className="flex-1 bg-white border-2 border-[#E4E3E0] rounded-2xl px-6 py-4 focus:border-[#F27D26] outline-none transition-all placeholder:italic text-lg italic font-serif"
                        id="human-speech"
                      />
                      <button 
                        onClick={() => {
                          const input = document.getElementById('human-speech') as HTMLInputElement;
                          handleHumanSpeech(input.value);
                          input.value = '';
                        }}
                        className="px-8 bg-[#141414] text-white rounded-2xl font-bold hover:bg-black transition-all flex items-center gap-2"
                      >
                        <Send className="w-4 h-4" />
                        发言
                      </button>
                    </motion.div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex items-center gap-2 text-[#F27D26]">
                        <MessageSquare className="w-5 h-5 animate-bounce" />
                        <span className="font-bold tracking-tight">{gameState.currentDiscussionIndex}号玩家正在发言...</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* VOTING */}
              {gameState.phase === Phase.DAY_VOTING && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-6">
                   <p className="text-sm font-medium opacity-50 flex items-center gap-2">
                    <Gavel className="w-4 h-4 text-[#F27D26]" />
                    最后审判：请投出你的一票
                  </p>
                  {gameState.idiotRevealedId === 1 ? (
                    <div className="flex flex-col items-center gap-4">
                      <p className="text-red-500 font-bold">你已翻牌揭示身份，本局游戏失去投票权。</p>
                      <button 
                        onClick={() => handleHumanVote(null)}
                        className="px-10 py-4 bg-[#141414] text-white rounded-2xl font-bold hover:bg-black transition-all"
                      >
                        确认此结果
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 justify-center">
                      {gameState.players.filter(p => p.isAlive && !p.isHuman).map(p => (
                        <button 
                          key={p.id}
                          onClick={() => handleHumanVote(p.id)}
                          className="px-6 py-3 border-2 border-[#E4E3E0] rounded-2xl hover:border-[#F27D26] hover:text-[#F27D26] transition-all font-bold text-sm bg-white"
                        >
                          投票给 {p.id}号
                        </button>
                      ))}
                      <button 
                        onClick={() => handleHumanVote(null)}
                        className="px-8 py-3 bg-[#E4E3E0] text-[#141414] rounded-2xl font-bold hover:bg-[#D4D3D0] transition-all text-sm"
                      >
                        弃权
                      </button>
                    </div>
                  )}
                </motion.div>
              )}

              {gameState.phase === Phase.DAY_RESULT && (
                <button 
                  onClick={nextPhase}
                  className="group px-10 py-4 bg-[#141414] text-white rounded-2xl shadow-2xl flex items-center gap-3 hover:scale-105 active:scale-95 transition-all"
                >
                  <span className="font-bold tracking-tight">确认并进入夜晚</span>
                  <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
              )}

              {/* GAME OVER */}
              {gameState.phase === Phase.GAME_OVER && (
                <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center">
                  <div className={`text-6xl mb-4 ${gameState.winner === Side.GOOD ? 'text-green-500' : 'text-red-500'}`}>
                    <Trophy className="w-16 h-16 mx-auto mb-4" />
                    {gameState.winner === Side.GOOD ? '好人胜利' : '狼人胜利'}
                  </div>
                  <p className="text-[#666] font-serif italic text-xl">尘埃落定，森林恢复了往日的宁静...</p>
                </motion.div>
              )}
            </AnimatePresence>
          )}

          {isProcessing && (
            <div className="flex flex-col items-center gap-4">
              <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                    className="w-2.5 h-2.5 bg-[#F27D26] rounded-full"
                  />
                ))}
              </div>
              <span className="text-[10px] uppercase tracking-[0.3em] font-bold text-[#F27D26]">AI 正在思考局面</span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
