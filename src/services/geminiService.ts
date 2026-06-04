import { GoogleGenAI, Type } from "@google/genai";
import { Player, Role, Phase, GameState, Side, SeerRecord } from "../types";
import { SYSTEM_PROMPT, ROLE_LABELS } from "../constants";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
const MODEL = "gemini-2.0-flash";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildGameContext(player: Player, gameState: GameState): string {
  const alive = gameState.players.filter(p => p.isAlive);
  const dead = gameState.players.filter(p => !p.isAlive);
  const logs = gameState.logs.slice(-12).map(l => `[${l.phase}] ${l.playerName ? l.playerName + ': ' : ''}${l.message}`).join("\n");

  // Only wolves know their partners
  const wolfInfo = player.role === Role.WEREWOLF
    ? `你的狼队友：${gameState.players.filter(p => p.role === Role.WEREWOLF && p.id !== player.id && p.isAlive).map(p => `${p.id}号`).join("、") || "无（已全灭）"}`
    : "";

  // Seer knows their check results
  const seerInfo = player.role === Role.SEER
    ? `你的查验记录：${gameState.seerRecords.map(r => `${r.targetId}号=${r.side === Side.GOOD ? "好人" : "狼人"}`).join("、") || "暂无"}`
    : "";

  // Witch knows potion status
  const witchInfo = player.role === Role.WITCH
    ? `你的药品：解药${gameState.witchStatus.hasSavePotion ? "✅有" : "❌已用"}，毒药${gameState.witchStatus.hasPoisonPotion ? "✅有" : "❌已用"}`
    : "";

  return `
【当前局面】
第${gameState.day}天 | 阶段：${gameState.phase}
你是：${player.id}号玩家（${ROLE_LABELS[player.role]}）
${wolfInfo}${seerInfo}${witchInfo}

存活玩家（${alive.length}人）：${alive.map(p => `${p.id}号${p.id === gameState.sheriffId ? "[警长]" : ""}${gameState.idiotRevealedId === p.id ? "[白痴已翻牌]" : ""}`).join("、")}
已出局（${dead.length}人）：${dead.map(p => `${p.id}号（${ROLE_LABELS[p.role]}，${p.deathReason}，第${p.deathDay}天）`).join("、") || "无"}
${gameState.sheriffId ? `当前警长：${gameState.sheriffId}号` : "本局无警长"}
昨晚死亡：${gameState.lastNightDeaths.length > 0 ? gameState.lastNightDeaths.map(id => `${id}号`).join("、") : "平安夜"}

【近期日志】
${logs}
`.trim();
}

function safeParseJSON<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text || "{}") as T;
  } catch {
    return fallback;
  }
}

// ─── Discussion ───────────────────────────────────────────────────────────────

export async function generateAIDiscussion(
  player: Player,
  gameState: GameState,
): Promise<string> {
  const context = buildGameContext(player, gameState);

  const isSheriffPhase = gameState.phase === Phase.SHERIFF_SPEECH;
  const roleInstruction = {
    [Role.WEREWOLF]: "你是狼人，必须伪装成好人。分析发言找出可推的好人目标，不要暴露队友，语气自然。",
    [Role.SEER]: isSheriffPhase
      ? "你是预言家，现在是警长竞选发言！必须：1.宣布自己是预言家 2.报出昨晚查验结果和理由 3.说明警徽流方向。这是最重要的发言。"
      : "你是预言家，结合已有查验信息分析局势，引导好人找出狼人。",
    [Role.WITCH]: "你是女巫，根据药品状态发言。若已用解药可暗示昨晚平安夜原因；逻辑分析可疑玩家。",
    [Role.HUNTER]: "你是猎人，伪装成平民发言，分析局势，树立公信力，枪口指向最可疑的狼人。",
    [Role.GUARD]: "你是守卫，伪装成平民发言，分析昨晚平安夜是否与守护有关，找出狼人。",
    [Role.IDIOT]: gameState.idiotRevealedId === player.id
      ? "你是已翻牌的白痴，你没有投票权但可以发言，继续分析局势帮助好人。"
      : "你是白痴，伪装成平民，逻辑分析可疑玩家。",
    [Role.VILLAGER]: "你是平民，通过发言逻辑分析找出狼人，可以考虑诈身份帮神职挡刀。",
  }[player.role];

  const prompt = `${context}

【你的任务】
${roleInstruction}

请以${player.id}号玩家身份发言，50-80字，逻辑清晰。直接输出发言内容，不要加引号或前缀。`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: { systemInstruction: SYSTEM_PROMPT },
    });
    return (response.text || "").trim() || "我还在观察，暂时保留意见。";
  } catch (error) {
    console.error("generateAIDiscussion Error:", error);
    const fallbacks: Record<Role, string[]> = {
      [Role.WEREWOLF]: ["昨晚的局势很微妙，我觉得我们应该多听听大家的分析再做决定。", "我支持先把嫌疑最大的人推出去，现在信息还不够充分。"],
      [Role.SEER]: ["我是预言家，我有重要信息想分享，希望大家认真听我说。", "根据我的查验，我们需要重点关注某些玩家的发言逻辑。"],
      [Role.WITCH]: ["昨晚的情况我清楚，大家仔细分析死亡信息和发言逻辑。", "我观察了一下，有几个人的发言前后矛盾，值得重点关注。"],
      [Role.HUNTER]: ["我在仔细观察每个人的发言，有些人逻辑明显有问题。", "根据目前的信息，我认为我们应该重点关注发言异常的玩家。"],
      [Role.GUARD]: ["昨晚的结果已经说明了一些问题，我们要仔细分析。", "我支持先听预言家的信息再做判断。"],
      [Role.IDIOT]: ["我觉得大家应该更仔细地分析发言逻辑，而不是跟风投票。", "有些人的发言明显在掩护某人，这点值得注意。"],
      [Role.VILLAGER]: ["作为平民，我觉得我们应该相信预言家的信息。", "我观察了几个人的发言，有些逻辑漏洞很明显。"],
    };
    const options = fallbacks[player.role];
    return options[Math.floor(Math.random() * options.length)];
  }
}

// ─── Vote ─────────────────────────────────────────────────────────────────────

export async function generateAIVote(
  player: Player,
  gameState: GameState,
  candidatesOverride?: number[] // for sheriff election
): Promise<{ voteId: number | null; reason: string }> {
  const context = buildGameContext(player, gameState);
  const candidates = candidatesOverride
    ?? gameState.players.filter(p => p.isAlive && p.id !== player.id && gameState.idiotRevealedId !== p.id).map(p => p.id);

  const isSheriffVote = !!candidatesOverride;
  const instruction = isSheriffVote
    ? `这是警长竞选投票。候选人：${candidates.map(id => `${id}号`).join("、")}。${player.role === Role.WEREWOLF ? "投给最弱的好人候选人，让悍跳狼获胜。" : "投给最可能是真预言家的候选人。"}弃权返回-1。`
    : `这是日间放逐投票。可投目标：${candidates.map(id => `${id}号`).join("、")}。${player.role === Role.WEREWOLF ? "投给对狼人威胁最大的好人（预言家查杀的人除外——那可能暴露你）。转移嫌疑，不要明显保护队友。" : "投给最可疑的狼人。若有预言家查杀信息，优先出查杀。"}弃权返回-1。`;

  const prompt = `${context}

【投票任务】
${instruction}

只返回JSON，格式：{"voteId": 数字或-1, "reason": "理由"}`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            voteId: { type: Type.INTEGER },
            reason: { type: Type.STRING },
          },
          required: ["voteId", "reason"],
        },
      },
    });
    const result = safeParseJSON<{ voteId: number; reason: string }>(
      response.text || "", { voteId: -1, reason: "信息不足，选择弃权。" }
    );
    if (result.voteId === -1 || !candidates.includes(result.voteId)) {
      return { voteId: null, reason: result.reason || "弃权。" };
    }
    return { voteId: result.voteId, reason: result.reason };
  } catch (error) {
    console.error("generateAIVote Error:", error);
    // Fallback: wolves vote for a random non-wolf, good guys vote for random player
    const fallbackTarget = player.role === Role.WEREWOLF
      ? candidates.find(id => gameState.players.find(p => p.id === id)?.role !== Role.WEREWOLF)
      : candidates[Math.floor(Math.random() * candidates.length)];
    return { voteId: fallbackTarget ?? null, reason: "综合判断。" };
  }
}

// ─── Night: Wolf Kill ─────────────────────────────────────────────────────────

export async function generateAIWolfKill(
  player: Player,
  gameState: GameState
): Promise<number | null> {
  const context = buildGameContext(player, gameState);
  const targets = gameState.players.filter(p => p.isAlive && p.role !== Role.WEREWOLF);

  const prompt = `${context}

【狼人行动】
你们今晚要选择击杀一名好人。
可击杀目标：${targets.map(p => `${p.id}号`).join("、")}
优先级：预言家 > 女巫 > 猎人 > 守卫/白痴 > 平民
根据白天发言判断身份，优先消灭最危险的神职。

只返回JSON：{"targetId": 数字}`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { targetId: { type: Type.INTEGER } },
          required: ["targetId"],
        },
      },
    });
    const result = safeParseJSON<{ targetId: number }>(response.text || "", { targetId: -1 });
    const valid = targets.find(p => p.id === result.targetId);
    return valid ? result.targetId : targets[Math.floor(Math.random() * targets.length)]?.id ?? null;
  } catch (error) {
    console.error("generateAIWolfKill Error:", error);
    return targets[Math.floor(Math.random() * targets.length)]?.id ?? null;
  }
}

// ─── Night: Seer Check ────────────────────────────────────────────────────────

export async function generateAISeerCheck(
  player: Player,
  gameState: GameState
): Promise<number | null> {
  const context = buildGameContext(player, gameState);
  const alreadyChecked = gameState.seerRecords.map(r => r.targetId);
  const targets = gameState.players.filter(p => p.isAlive && p.id !== player.id && !alreadyChecked.includes(p.id));

  if (targets.length === 0) return null;

  const prompt = `${context}

【预言家行动】
你今晚要查验一名玩家。
未查验的存活玩家：${targets.map(p => `${p.id}号`).join("、")}
策略：优先验白天发言最可疑的人；不要重复验已知身份的人。

只返回JSON：{"targetId": 数字}`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { targetId: { type: Type.INTEGER } },
          required: ["targetId"],
        },
      },
    });
    const result = safeParseJSON<{ targetId: number }>(response.text || "", { targetId: -1 });
    return targets.find(p => p.id === result.targetId) ? result.targetId : targets[0].id;
  } catch (error) {
    console.error("generateAISeerCheck Error:", error);
    return targets[0]?.id ?? null;
  }
}

// ─── Night: Witch Action ──────────────────────────────────────────────────────

export async function generateAIWitchAction(
  player: Player,
  gameState: GameState
): Promise<{ action: 'save' | 'poison' | 'skip'; targetId?: number }> {
  const context = buildGameContext(player, gameState);
  const { hasSavePotion, hasPoisonPotion } = gameState.witchStatus;
  const killedId = gameState.nightKilledId;
  const killedPlayer = killedId ? gameState.players.find(p => p.id === killedId) : null;
  const poisonTargets = gameState.players.filter(p => p.isAlive && p.id !== player.id && p.id !== killedId);

  const prompt = `${context}

【女巫行动】
今晚狼人击杀了：${killedId ? `${killedId}号` : "无"}
你的药品状态：解药${hasSavePotion ? "✅有" : "❌已用"}，毒药${hasPoisonPotion ? "✅有" : "❌已用"}
同一晚不能同时使用解药和毒药。

策略：
- 解药：若被救者很重要（预言家/女巫/猎人），可以救；若是普通平民谨慎考虑；若怀疑是狼人自刀骗药则不救。
- 毒药：第二夜或第三夜开始使用；只毒铁狼（预言家查杀目标或发言严重矛盾的玩家）；宁可不毒也不乱毒。
- 不操作：信息不足时选择观察。

可毒目标：${poisonTargets.map(p => `${p.id}号`).join("、")}

只返回JSON，action只能是"save"/"poison"/"skip"：
{"action": "save或poison或skip", "targetId": 毒药目标的id（save或skip时可省略）}`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            action: { type: Type.STRING },
            targetId: { type: Type.INTEGER },
          },
          required: ["action"],
        },
      },
    });
    const result = safeParseJSON<{ action: string; targetId?: number }>(
      response.text || "", { action: "skip" }
    );

    if (result.action === "save" && hasSavePotion && killedId) {
      return { action: "save" };
    }
    if (result.action === "poison" && hasPoisonPotion && result.targetId) {
      const valid = poisonTargets.find(p => p.id === result.targetId);
      if (valid) return { action: "poison", targetId: result.targetId };
    }
    return { action: "skip" };
  } catch (error) {
    console.error("generateAIWitchAction Error:", error);
    return { action: "skip" };
  }
}

// ─── Night: Guard ─────────────────────────────────────────────────────────────

export async function generateAIGuardAction(
  player: Player,
  gameState: GameState
): Promise<number | null> {
  const lastTarget = gameState.lastGuardTargetId;
  const targets = gameState.players.filter(p => p.isAlive && p.id !== lastTarget);
  if (targets.length === 0) return null;

  const context = buildGameContext(player, gameState);

  const prompt = `${context}

【守卫行动】
你今晚要守护一名玩家。
不能守护上晚守护的玩家${lastTarget ? `（${lastTarget}号）` : ""}。
可守护目标：${targets.map(p => `${p.id}号`).join("、")}
策略：${gameState.day === 1 ? "第一晚优先考虑空守（返回-1），避免与女巫解药叠加造成奶穿。" : "优先守护预言家；若预言家已知则守护发言最强的好人；也可守护自己。"}

只返回JSON：{"targetId": 数字（空守返回-1）}`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { targetId: { type: Type.INTEGER } },
          required: ["targetId"],
        },
      },
    });
    const result = safeParseJSON<{ targetId: number }>(response.text || "", { targetId: -1 });
    if (result.targetId === -1) return null;
    const valid = targets.find(p => p.id === result.targetId);
    return valid ? result.targetId : null;
  } catch (error) {
    console.error("generateAIGuardAction Error:", error);
    // Default: guard self on day 1, else guard random alive player
    if (gameState.day === 1) return null;
    return targets[Math.floor(Math.random() * targets.length)]?.id ?? null;
  }
}

// ─── Night: Hunter Shoot ──────────────────────────────────────────────────────

export async function generateAIHunterShoot(
  player: Player,
  gameState: GameState
): Promise<number | null> {
  const context = buildGameContext(player, gameState);
  const targets = gameState.players.filter(p => p.isAlive);
  if (targets.length === 0) return null;

  const prompt = `${context}

【猎人开枪】
你已出局，可以开枪带走一名存活玩家！
存活玩家：${targets.map(p => `${p.id}号`).join("、")}
策略：优先击毙预言家查杀的玩家；其次是发言逻辑最差的玩家；绝对不要打金水玩家。

只返回JSON：{"targetId": 数字}`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { targetId: { type: Type.INTEGER } },
          required: ["targetId"],
        },
      },
    });
    const result = safeParseJSON<{ targetId: number }>(response.text || "", { targetId: -1 });
    return targets.find(p => p.id === result.targetId) ? result.targetId : targets[0].id;
  } catch (error) {
    console.error("generateAIHunterShoot Error:", error);
    return targets[0]?.id ?? null;
  }
}

// ─── Sheriff: Choose to run ───────────────────────────────────────────────────

export async function generateAISheriffChoice(
  player: Player,
  gameState: GameState
): Promise<boolean> {
  // Hard rules first (no need to call AI)
  if (player.role === Role.SEER) return true;   // Seer MUST run
  if (player.role === Role.WEREWOLF) {
    // One wolf should run as fake seer; others stay out
    const runningWolves = gameState.sheriffCandidates.filter(
      id => gameState.players.find(p => p.id === id)?.role === Role.WEREWOLF
    );
    return runningWolves.length === 0; // Only one wolf runs
  }

  const context = buildGameContext(player, gameState);
  const prompt = `${context}

【警长竞选决策】
你是${ROLE_LABELS[player.role]}，要不要上警参与警长竞选？
考虑因素：
- 你有重要信息可以分享吗？
- 上警会暴露你的身份吗？
- 场上局势需要你站出来吗？

返回JSON：{"run": true或false}`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { run: { type: Type.BOOLEAN } },
          required: ["run"],
        },
      },
    });
    const result = safeParseJSON<{ run: boolean }>(response.text || "", { run: false });
    return result.run;
  } catch (error) {
    console.error("generateAISheriffChoice Error:", error);
    return player.role === Role.SEER;
  }
}

// ─── Sheriff: Handoff ─────────────────────────────────────────────────────────

export async function generateAISheriffAction(
  player: Player,
  gameState: GameState
): Promise<number | null> {
  const context = buildGameContext(player, gameState);
  const targets = gameState.players.filter(p => p.isAlive && p.id !== player.id);

  const prompt = `${context}

【警徽移交】
你是警长，你已出局。请选择传递警徽给一名存活玩家，或撕毁警徽。
存活玩家：${targets.map(p => `${p.id}号`).join("、")}
策略（好人）：传给最信任的金水玩家或发言最强的好人。
策略（狼人）：传给狼队友，或撕毁警徽让好人失去优势。

返回JSON：{"targetId": 数字（撕毁返回-1）}`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { targetId: { type: Type.INTEGER } },
          required: ["targetId"],
        },
      },
    });
    const result = safeParseJSON<{ targetId: number }>(response.text || "", { targetId: -1 });
    if (result.targetId === -1) return null;
    return targets.find(p => p.id === result.targetId) ? result.targetId : null;
  } catch (error) {
    console.error("generateAISheriffAction Error:", error);
    return null;
  }
}

// ─── Legacy wrapper (keeps App.tsx compatible) ────────────────────────────────
// App.tsx calls generateAINightAction with actionType string.
// This wrapper routes to the new typed functions above.

export async function generateAINightAction(
  player: Player,
  gameState: GameState,
  actionType: 'KILL' | 'CHECK' | 'WITCH_ACTION' | 'HUNTER_SHOOT'
): Promise<number | null | { action: 'save' | 'poison' | 'skip'; targetId?: number }> {
  switch (actionType) {
    case 'KILL':
      return generateAIWolfKill(player, gameState);
    case 'CHECK':
      return generateAISeerCheck(player, gameState);
    case 'WITCH_ACTION':
      return generateAIWitchAction(player, gameState);
    case 'HUNTER_SHOOT':
      return generateAIHunterShoot(player, gameState);
    default:
      return null;
  }
}
