import { GoogleGenAI, Type } from "@google/genai";
import { Player, Role, Phase, GameLog, GameState, Side } from "../types";
import { SYSTEM_PROMPT, ROLE_LABELS } from "../constants";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function generateAIDiscussion(
  player: Player,
  gameState: GameState,
): Promise<string> {
  const alivePlayers = gameState.players.filter(p => p.isAlive).map(p => `${p.id}号(${p.name})`).join(", ");
  const wolfPartners = player.role === Role.WEREWOLF 
    ? gameState.players.filter(p => p.role === Role.WEREWOLF && p.id !== player.id).map(p => `${p.id}号`).join(", ")
    : "未知";

  const context = `
    当前天数：第${gameState.day}天
    你的身份：${ROLE_LABELS[player.role]}
    你的座位号：${player.id}号
    存活玩家：${alivePlayers}
    你的狼队友（如果你是狼）：${wolfPartners}
    
    最近游戏日志：
    ${gameState.logs.slice(-10).map(l => `[${l.phase}] ${l.message}`).join("\n")}

    请以${player.id}号玩家的身份进行发言。要求符合角色逻辑，分析当前局势，50-80字。
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: context,
      config: {
        systemInstruction: SYSTEM_PROMPT,
      },
    });
    return response.text || "我还在观察，暂时没什么要说的。";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "我相信逻辑，让我们投出最可疑的那个人。";
  }
}

export async function generateAIVote(
  player: Player,
  gameState: GameState
): Promise<{ voteId: number | null, reason: string }> {
  const alivePlayers = gameState.players.filter(p => p.isAlive && p.id !== player.id);
  const targets = alivePlayers.map(p => ({ id: p.id, description: `${p.id}号(${p.name})` }));

  const context = `
    当前天数：第${gameState.day}天
    你的身份：${ROLE_LABELS[player.role]}
    你的座位号：${player.id}号
    存活对手：${targets.map(t => t.description).join(", ")}
    
    基于先前的讨论和你的身份逻辑，请在存活的可投玩家中选择一个你认为最可疑的玩家投票放逐（如果是狼人，请投给好人）。
    只返回该玩家的座位号(数字)和理由。如果要弃权请返回-1。
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: context,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            voteId: { type: Type.INTEGER },
            reason: { type: Type.STRING }
          },
          required: ["voteId", "reason"]
        }
      },
    });
    const result = JSON.parse(response.text || '{"voteId": -1, "reason": "观察不足，选择弃权。"}');
    const voteId = result.voteId;
    const reason = result.reason;
    if (voteId === -1) return { voteId: null, reason };
    if (gameState.players.find(p => p.id === voteId && p.isAlive)) return { voteId, reason };
    return { voteId: null, reason: "无效投票，选择弃权。" };
  } catch (error) {
    console.error("Gemini Error:", error);
    return { voteId: null, reason: "逻辑混乱，选择弃权。" };
  }
}

export async function generateAIGuardAction(
  player: Player,
  gameState: GameState
): Promise<number | null> {
  const alivePlayers = gameState.players.filter(p => p.isAlive);
  const lastTarget = gameState.lastGuardTargetId;

  const prompt = `你是${player.id}号玩家，身份是守卫。现在是黑夜，请选择一名玩家进行守护。
    存活玩家：${alivePlayers.map(p => `${p.id}号(${ROLE_LABELS[p.role]})`).join(", ")}
    注意：你不能连续两晚守护同一人${lastTarget ? `（昨晚守护了${lastTarget}号）` : ''}。
    返回由你选择的玩家座位号(数字)。`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            targetId: { type: Type.INTEGER }
          },
          required: ["targetId"]
        }
      },
    });
    const result = JSON.parse(response.text || '{"targetId": -1}');
    const targetId = result.targetId;
    if (targetId && targetId !== -1 && targetId !== lastTarget && gameState.players.find(p => p.id === targetId && p.isAlive)) {
      return targetId;
    }
    return null;
  } catch (error) {
    console.error("Gemini Error:", error);
    return null;
  }
}

export async function generateAISheriffChoice(
  player: Player,
  gameState: GameState
): Promise<boolean> {
  const prompt = `你是${player.id}号玩家，身份是${ROLE_LABELS[player.role]}。现在是第一天。你要参与竞选警长（上警）吗？
    记住：预言家必须上警！返回 true 代表竞选，false 代表弃权。`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            run: { type: Type.BOOLEAN }
          },
          required: ["run"]
        }
      },
    });
    const result = JSON.parse(response.text || '{"run": false}');
    return result.run;
  } catch (error) {
    console.error("Gemini Error:", error);
    return player.role === Role.SEER;
  }
}

export async function generateAISheriffAction(
  player: Player,
  gameState: GameState
): Promise<number | null> {
  const alivePlayers = gameState.players.filter(p => p.isAlive && p.id !== player.id);
  const prompt = `你是警长，你出局了！请选出一个存活玩家传递警徽，或者撕毁警徽。
    存活玩家：${alivePlayers.map(p => `${p.id}号`).join(", ")}
    返回传递的目标座位号，如果撕毁警徽请返回 -1。`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            targetId: { type: Type.INTEGER }
          },
          required: ["targetId"]
        }
      },
    });
    const result = JSON.parse(response.text || '{"targetId": -1}');
    if (result.targetId === -1) return null;
    return result.targetId;
  } catch (error) {
    console.error("Gemini Error:", error);
    return null;
  }
}

export async function generateAINightAction(
  player: Player,
  gameState: GameState,
  actionType: 'KILL' | 'CHECK' | 'WITCH_SAVE' | 'WITCH_POISON' | 'HUNTER_SHOOT'
): Promise<number | null | { save: boolean, poisonId: number | null }> {
  const alivePlayers = gameState.players.filter(p => p.isAlive && p.id !== player.id);
  
  let prompt = "";
  let schema: any = {
    type: Type.OBJECT,
    properties: {
      targetId: { type: Type.INTEGER }
    },
    required: ["targetId"]
  };

  if (actionType === 'KILL') {
    prompt = `你是狼人，请从以下存活的非狼人玩家中选出一个今晚要击杀的目标：
      ${gameState.players.filter(p => p.isAlive && p.role !== Role.WEREWOLF).map(p => `${p.id}号`).join(", ")}
      目标是消灭神职人员。返回目标座位号。`;
  } else if (actionType === 'CHECK') {
    prompt = `你是预言家，请从以下存活玩家中选出一个今晚要查验的目标：
      ${alivePlayers.map(p => `${p.id}号`).join(", ")}
      返回目标座位号。`;
  } else if (actionType === 'WITCH_SAVE') {
    const killed = gameState.players.find(p => p.id === gameState.nightKilledId);
    prompt = `你是女巫，今晚${killed ? killed.id : '无'}号玩家被杀了。你要用解药救他吗？
      救人返回 true，不救返回 false。`;
    schema = {
      type: Type.OBJECT,
      properties: {
        save: { type: Type.BOOLEAN }
      },
      required: ["save"]
    };
  } else if (actionType === 'WITCH_POISON') {
    prompt = `你是女巫，你要使用毒药毒死一名存活玩家吗？
      ${alivePlayers.map(p => `${p.id}号`).join(", ")}
      返回目标座位号，如果不使用返回 -1。`;
  } else if (actionType === 'HUNTER_SHOOT') {
    prompt = `你是猎人，你出局了！请选出一个存活玩家开枪带走：
      ${alivePlayers.map(p => `${p.id}号`).join(", ")}
      返回目标座位号。`;
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: schema
      },
    });
    const result = JSON.parse(response.text || '{}');
    if (actionType === 'WITCH_SAVE') return { save: result.save, poisonId: null };
    if (result.targetId === -1) return null;
    return result.targetId;
  } catch (error) {
    console.error("Gemini Error:", error);
    return null;
  }
}
