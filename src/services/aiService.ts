import OpenAI from "openai";
import { Player, Role, Phase, GameState, Side } from "../types";
import { SYSTEM_PROMPT, ROLE_LABELS, AI_PERSONAS } from "../constants";

// ─── Provider config ──────────────────────────────────────────────────────────
// The key is read from .env.local (see .env.example). Vite exposes it through
// import.meta.env, and vite.config.ts also accepts the un-prefixed name.
const API_KEY = import.meta.env.VITE_DEEPSEEK_API_KEY || "";
const BASE_URL = import.meta.env.VITE_AI_BASE_URL || "https://api.deepseek.com";
const MODEL = import.meta.env.VITE_AI_MODEL || "deepseek-chat";
const TIMEOUT_MS = 25_000;

/** False when no key is configured — the UI says so instead of silently
 *  running every AI on canned fallback lines. */
export const AI_ENABLED = API_KEY.length > 0 || import.meta.env.PROD;

const ai = new OpenAI({
  apiKey: API_KEY,
  baseURL: BASE_URL,
  dangerouslyAllowBrowser: true,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildGameContext(player: Player, gameState: GameState): string {
  const alive = gameState.players.filter(p => p.isAlive);
  const dead = gameState.players.filter(p => !p.isAlive);

  // `secret` logs are the human player's own private knowledge (their seer
  // checks, their wolf team's plan). Feeding them to an AI would hand it the
  // human's cards, so they never enter the context.
  const recentLogs = gameState.logs
    .filter(l => !l.secret)
    .slice(-25)
    .map(l => `[第${l.day}天/${l.phase}]${l.playerName ? " " + l.playerName + ":" : ""} ${l.message}`)
    .join("\n");

  const wolfInfo = player.role === Role.WEREWOLF
    ? `【你的狼队友】${gameState.players.filter(p => p.role === Role.WEREWOLF && p.id !== player.id && p.isAlive).map(p => `${p.id}号`).join("、") || "无（已全灭）"}\n`
    : "";

  const seerInfo = player.role === Role.SEER && gameState.seerRecords.length > 0
    ? `【你的查验记录】${gameState.seerRecords.map(r => `${r.targetId}号=${r.side === Side.GOOD ? "好人✅" : "狼人❌"}`).join("、")}\n`
    : "";

  const witchInfo = player.role === Role.WITCH
    ? `【你的药品】解药${gameState.witchStatus.hasSavePotion ? "✅有" : "❌已用"}，毒药${gameState.witchStatus.hasPoisonPotion ? "✅有" : "❌已用"}\n`
    : "";

  const sheriffInfo = gameState.sheriffId
    ? `【当前警长】${gameState.sheriffId}号\n`
    : "【本局无警长】\n";

  const candidatesInfo = gameState.sheriffCandidates.length > 0
    ? `【警长候选人】${gameState.sheriffCandidates.map(id => `${id}号`).join("、")}\n`
    : "";

  const nightInfo = gameState.lastNightDeaths.length > 0
    ? `【昨晚死亡】${gameState.lastNightDeaths.map(id => `${id}号`).join("、")}`
    : "【昨晚】平安夜，无人死亡";

  const persona = AI_PERSONAS[player.id];

  return `=== 你的固定人物 ===
${persona ? `你叫${persona.name}。说话特点：${persona.voice}。判断习惯：${persona.instinct}。` : '保持自然、简短的口语表达。'}
人物性格与身份无关；不要因为抽到特殊身份而突然改变口吻。

=== 当前局面 ===
第${gameState.day}天 | 阶段：${gameState.phase}
你是：${player.id}号（${ROLE_LABELS[player.role]}）
${wolfInfo}${seerInfo}${witchInfo}${sheriffInfo}${candidatesInfo}
存活（${alive.length}人）：${alive.map(p => `${p.id}号${p.id === gameState.sheriffId ? "[警]" : ""}${gameState.idiotRevealedId === p.id ? "[白痴已翻]" : ""}`).join("、")}
出局（${dead.length}人）：${dead.length > 0 ? dead.map(p => `${p.id}号(第${p.deathDay}天${p.deathReason === "投票放逐" ? "被放逐" : p.deathReason === "猎人带走" ? "被猎人带走" : "夜间出局"})`).join("、") : "无"}
${nightInfo}

=== 近期发言记录 ===
${recentLogs || "（暂无记录）"}

⚠️ 只允许引用以上真实信息。无法确认的内容必须说成猜测，严禁捏造事件。`;
}

function safeJSON<T>(text: string | null | undefined, fallback: T): T {
  try {
    const cleaned = (text || "").replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

async function callAI(prompt: string, json = false): Promise<string> {
  if (!AI_ENABLED) throw new Error("AI disabled: no API key configured");
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: prompt },
  ];

  // Production uses a same-origin Vercel function so the provider key never
  // reaches the browser. Local development may still use a VITE_ key directly.
  if (!API_KEY) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, json }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'AI proxy request failed');
      return data.content || '';
    } finally {
      window.clearTimeout(timer);
    }
  }
  const response = await ai.chat.completions.create(
    {
      model: MODEL,
      messages,
      ...(json ? { response_format: { type: "json_object" as const } } : {}),
      temperature: 0.88,
    },
    // Without this a stalled request would freeze the whole game loop.
    { timeout: TIMEOUT_MS }
  );
  return response.choices[0]?.message?.content || "";
}

/** Picks a random element; used by every fallback path so a dead API still plays. */
function pick<T>(arr: T[]): T | undefined {
  return arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined;
}

// ─── Discussion ───────────────────────────────────────────────────────────────

export async function generateAIDiscussion(
  player: Player,
  gameState: GameState,
): Promise<string> {
  const context = buildGameContext(player, gameState);
  const isSheriffPhase = gameState.phase === Phase.SHERIFF_SPEECH;

  // Role-specific speaking strategy
  const strategies: Record<Role, string> = {
    [Role.WEREWOLF]: isSheriffPhase
      ? `你是悍跳狼，正在竞选警长伪装预言家。
发言格式：1.宣布"我是预言家" 2.编造查验结果（给你的一个狼队友发金水，给发言最强的好人发查杀） 3.编造验人心路历程（要饱满有逻辑，如"看他摸牌时表情异常"）4.报警徽流（留给你编造的金水）。
注意：必须果断，不能犹豫；警徽流要有逻辑。`
      : `你是狼人（深水狼），伪装平民。
发言策略：分析发言逻辑找合理目标带节奏；不要主动帮队友辩护（容易暴露）；适当质疑发言最强的好人；语气自然中规中矩。`,
    [Role.SEER]: isSheriffPhase
      ? `你是真预言家，必须上警竞选！
发言格式：1."我是预言家" 2.报查验结果"昨晚验了X号，结果是【好人/狼人】" 3.说验人心路历程（选他的原因） 4.报警徽流"警徽留给X号"（留给金水或发言最强好人）。
态度要坚定自信，这是你最重要的发言。`
      : `你是预言家，结合${gameState.seerRecords.length > 0 ? "你的查验记录" : "当前局势"}发言。
若有查杀信息：坚定呼吁出票；若有金水：让对方为你背书；分析发言逻辑找出狼人破绽。`,
    [Role.WITCH]: `你是女巫。
${isSheriffPhase ? "竞选发言时可暗示自己是好人神职，不需要完全暴露身份。" : ""}
若昨晚你用了解药且是平安夜：可以暗示"昨晚我处理了被刀的情况"来确认银水身份。
分析刀法规律推断狼人位置；不要轻易暴露双药状态。`,
    [Role.HUNTER]: `你是猎人，伪装平民发言。
树立公信力，分析发言逻辑找出最可疑的狼人；暗示自己有重要判断但不暴露身份；枪口指向最可疑的人。`,
    [Role.GUARD]: `你是守卫，伪装平民发言。
分析昨晚平安夜是否与你的守护有关（不要明说）；推断发言逻辑找狼人；不要暴露守卫身份。`,
    [Role.IDIOT]: gameState.idiotRevealedId === player.id
      ? `你是已翻牌的白痴，失去了投票权但可以继续发言帮助好人。
分析局势，指出最可疑的玩家，你没有什么可失去的，可以大胆说出判断。`
      : `你是白痴，伪装平民发言。分析发言逻辑找出狼人。`,
    [Role.VILLAGER]: `你是平民，通过逻辑分析找出狼人。
可以考虑诈身份（诈女巫/猎人）帮真神职挡刀，但要注意这会增加你的嫌疑。
重点关注：谁在保护谁？谁的票投得最蹊跷？谁发言前后矛盾？`,
  };

  const prompt = `${context}

【你的发言策略】
${strategies[player.role]}

${isSheriffPhase
  ? `这是警长竞选发言，你已上警。请直接开始你的竞选发言。`
  : `请以${player.id}号玩家身份发言。`}
先在心里完成判断：本轮最想影响谁、依据是哪一条公开事实、希望桌上采取什么行动。
然后用真实玩家的口吻说出来，35-75字。可以犹豫、改口或带情绪，但不能写成主持人解说。
不要使用“大家要多听发言”“不要盲目跟风”“综合判断”“我还在观察”这类空话。
必须至少包含一个具体座位号；若现场信息确实不足，就向某个座位提出一个具体问题。

只返回JSON：{"thought":"一句内部判断，不会展示给玩家","speech":"最终发言"}`;

  try {
    const text = await callAI(prompt, true);
    const result = safeJSON<{ thought?: string; speech?: string }>(text, {});
    return result.speech?.trim() || `${player.id === 2 ? '3' : '2'}号，你上一轮的站边理由能再说具体一点吗？`;
  } catch (error) {
    console.error("generateAIDiscussion Error:", error);
    const fallbacks: Record<Role, string> = {
      [Role.WEREWOLF]: "我觉得我们要多分析发言逻辑，不能跟风投票，先听听大家的判断。",
      [Role.SEER]: "我是预言家，我有重要的查验信息想和大家分享，请大家认真听我说。",
      [Role.WITCH]: "根据昨晚的情况和今天大家的发言，我有自己的判断，先听听其他人说。",
      [Role.HUNTER]: "我在仔细分析每个人的发言，有些人的逻辑明显有问题，值得重点关注。",
      [Role.GUARD]: "昨晚的结果已经说明了一些问题，大家要仔细分析死亡信息。",
      [Role.IDIOT]: "大家应该更仔细地分析发言逻辑，而不是盲目跟风投票。",
      [Role.VILLAGER]: "我觉得我们应该相信预言家的信息，跟着逻辑走，不要被狼人带节奏。",
    };
    return fallbacks[player.role];
  }
}

export async function generateAITargetedReply(
  player: Player,
  question: string,
  gameState: GameState,
): Promise<string> {
  const context = buildGameContext(player, gameState);
  const prompt = `${context}

【1号玩家正在当面质疑你】
“${question.slice(0, 180)}”

判断对方真正怀疑你的原因，然后正面回答。可以反驳、承认疏漏、反问或改变判断，但不能回避。
保持固定人物口吻，30-70字，至少提到一个具体座位号。不要复述问题，不要说空话。
只返回JSON：{"thought":"真实应对意图","speech":"当场回答"}`;
  try {
    const result = safeJSON<{ speech?: string }>(await callAI(prompt, true), {});
    return result.speech?.trim() || `1号，你问到点上了。我现在更想听${player.id === 2 ? 3 : 2}号解释他的票。`;
  } catch {
    return `1号，我不回避。我的判断可能有偏差，但${player.id === 2 ? 3 : 2}号的立场变化更值得追。`;
  }
}

export async function generateAIClosingStatement(player: Player, gameState: GameState): Promise<string> {
  const context = buildGameContext(player, gameState);
  const prompt = `${context}

【归票阶段】讨论即将结束。用20-45字给出唯一放逐目标和最关键的一条理由。
必须明确说“我会投X号”或“我弃票”，不可列出多个备选，不要重复规则。
只返回JSON：{"voteId":数字或-1,"speech":"归票发言"}`;
  try {
    const result = safeJSON<{ speech?: string }>(await callAI(prompt, true), {});
    return result.speech?.trim() || '我暂时没有足够把握，这一票会谨慎处理。';
  } catch {
    const targets = gameState.players.filter(p => p.isAlive && p.id !== player.id);
    const target = pick(targets);
    return target ? `我会投${target.id}号，他这一轮没有正面交代自己的站边。` : '我弃票。';
  }
}

// ─── Vote ─────────────────────────────────────────────────────────────────────

export async function generateAIVote(
  player: Player,
  gameState: GameState,
  candidatesOverride?: number[]
): Promise<{ voteId: number | null; reason: string }> {
  const context = buildGameContext(player, gameState);
  const isSheriffVote = !!candidatesOverride;
  const candidates = candidatesOverride
    ?? gameState.players
      .filter(p => p.isAlive && p.id !== player.id && gameState.idiotRevealedId !== p.id)
      .map(p => p.id);

  if (candidates.length === 0) return { voteId: null, reason: "无可投目标。" };

  const instruction = isSheriffVote
    ? `这是警长竞选投票。候选人：${candidates.map(id => `${id}号`).join("、")}。
${player.role === Role.WEREWOLF
  ? "投给最弱的好人候选人，帮助悍跳狼获得警徽。若队友在候选人中则投队友。"
  : "投给最可信的候选人（最可能是真预言家的人）。通过发言逻辑判断：真预言家心态好、发言流畅、验人心路历程饱满。"}
弃权返回-1。`
    : `这是日间放逐投票。可投目标：${candidates.map(id => `${id}号`).join("、")}。
${player.role === Role.WEREWOLF
  ? "投票策略：若预言家发出查杀，投给查杀旁边的好人转移注意力；不要太明显地保护队友；优先投发言最强的好人威胁。"
  : "投票策略：若有预言家查杀信息，优先出查杀；否则投发言逻辑最差、最可疑的玩家；结合票型判断谁在带节奏。"}
弃权返回-1。`;

  const prompt = `${context}

【投票决策】
${instruction}

只返回JSON：{"voteId": 数字或-1, "reason": "投票理由（20字内）"}`;

  try {
    const text = await callAI(prompt, true);
    const result = safeJSON<{ voteId: number; reason: string }>(text, { voteId: -1, reason: "弃权。" });
    if (result.voteId === -1 || !candidates.includes(result.voteId)) {
      return { voteId: null, reason: result.reason || "弃权。" };
    }
    return { voteId: result.voteId, reason: result.reason || "综合判断。" };
  } catch (error) {
    console.error("generateAIVote Error:", error);
    const wolfSafe = candidates.filter(
      id => gameState.players.find(p => p.id === id)?.role !== Role.WEREWOLF
    );
    const fallback = player.role === Role.WEREWOLF
      ? pick(wolfSafe) ?? pick(candidates)
      : pick(candidates);
    return { voteId: fallback ?? null, reason: "综合判断。" };
  }
}

// ─── Night Actions ────────────────────────────────────────────────────────────

export async function generateAIWolfKill(player: Player, gameState: GameState): Promise<number | null> {
  const context = buildGameContext(player, gameState);
  const targets = gameState.players.filter(p => p.isAlive && p.role !== Role.WEREWOLF);
  if (targets.length === 0) return null;

  const prompt = `${context}

【狼人夜间行动】
可击杀目标：${targets.map(p => `${p.id}号`).join("、")}
击杀优先级：预言家 > 女巫 > 猎人 > 守卫/白痴 > 平民
根据白天发言表现推断神职身份，优先消灭最危险的目标。
注意：不要连续两晚刀同一区域（会暴露刀法规律）。

只返回JSON：{"targetId": 数字}`;

  try {
    const text = await callAI(prompt, true);
    const result = safeJSON<{ targetId: number }>(text, { targetId: -1 });
    return targets.some(p => p.id === result.targetId) ? result.targetId : pick(targets)!.id;
  } catch {
    return pick(targets)!.id;
  }
}

export async function generateAISeerCheck(player: Player, gameState: GameState): Promise<number | null> {
  const context = buildGameContext(player, gameState);
  const checked = gameState.seerRecords.map(r => r.targetId);
  const targets = gameState.players.filter(p => p.isAlive && p.id !== player.id && !checked.includes(p.id));
  if (targets.length === 0) return null;

  const prompt = `${context}

【预言家夜间查验】
未验过的存活玩家：${targets.map(p => `${p.id}号`).join("、")}
查验策略：
- 第一晚：验白天发言最可疑的人，或发言过于强势可能是悍跳狼的人
- 第二晚起：验白天发言有逻辑漏洞的人；不要验已知身份的人

只返回JSON：{"targetId": 数字}`;

  try {
    const text = await callAI(prompt, true);
    const result = safeJSON<{ targetId: number }>(text, { targetId: -1 });
    return targets.some(p => p.id === result.targetId) ? result.targetId : pick(targets)!.id;
  } catch {
    return pick(targets)!.id;
  }
}

export async function generateAIWitchAction(
  player: Player,
  gameState: GameState
): Promise<{ action: 'save' | 'poison' | 'skip'; targetId?: number }> {
  const context = buildGameContext(player, gameState);
  const { hasSavePotion, hasPoisonPotion } = gameState.witchStatus;
  const killedId = gameState.nightKilledId;
  // 女巫不可自救 — her own name is never a valid save target.
  const canSave = hasSavePotion && !!killedId && killedId !== player.id;
  const poisonTargets = gameState.players.filter(p => p.isAlive && p.id !== player.id && p.id !== killedId);

  const prompt = `${context}

【女巫夜间行动】
今晚被狼人击杀：${killedId ? `${killedId}号` : "无"}
解药状态：${hasSavePotion ? "✅有（可用）" : "❌已用完"}${hasSavePotion && killedId === player.id ? "（但被刀的是你自己，不可自救）" : ""}
毒药状态：${hasPoisonPotion ? "✅有（可用）" : "❌已用完"}
同一晚不能同时使用解药和毒药。

解药策略：
- 若被杀者可能是神职（发言强，逻辑好）→ 倾向救
- 若第一晚且不确定 → 通常救（标准局惯例）
- 若怀疑是狼人自刀骗药 → 不救（但要谨慎判断）
- 女巫不可自救

毒药策略：
- 第二夜或第三夜开始用，不要第一晚乱毒
- 只毒铁狼：预言家查杀目标 OR 发言严重矛盾被多人质疑的人
- 宁可不毒也不乱毒！

可毒目标：${poisonTargets.map(p => `${p.id}号`).join("、")}

只返回JSON，action只能是save/poison/skip：
{"action": "save或poison或skip", "targetId": 毒药目标id（仅poison时需要）}`;

  try {
    const text = await callAI(prompt, true);
    const result = safeJSON<{ action: string; targetId?: number }>(text, { action: "skip" });

    if (result.action === "save" && canSave) return { action: "save" };
    if (result.action === "poison" && hasPoisonPotion && result.targetId
        && poisonTargets.some(p => p.id === result.targetId)) {
      return { action: "poison", targetId: result.targetId };
    }
    return { action: "skip" };
  } catch {
    // No API: fall back to the standard night-one save.
    return canSave && gameState.day === 1 ? { action: "save" } : { action: "skip" };
  }
}

export async function generateAIGuardAction(player: Player, gameState: GameState): Promise<number | null> {
  const lastTarget = gameState.lastGuardTargetId;
  const targets = gameState.players.filter(p => p.isAlive && p.id !== lastTarget);
  if (targets.length === 0) return null;

  const context = buildGameContext(player, gameState);

  const prompt = `${context}

【守卫夜间守护】
不能守护上晚目标${lastTarget ? `（${lastTarget}号）` : ""}
可守护：${targets.map(p => `${p.id}号`).join("、")}

守护策略：
${gameState.day === 1
  ? "第一晚建议空守（返回-1），防止与女巫解药叠加造成奶穿！"
  : "优先守护预言家（若已知）；其次守护发言最强、最可能是神职的好人；也可守自己。"}

只返回JSON：{"targetId": 数字，空守返回-1}`;

  try {
    const text = await callAI(prompt, true);
    const result = safeJSON<{ targetId: number }>(text, { targetId: -1 });
    if (result.targetId === -1) return null;
    return targets.some(p => p.id === result.targetId)
      ? result.targetId
      : (gameState.day === 1 ? null : pick(targets)!.id);
  } catch {
    return gameState.day === 1 ? null : pick(targets)?.id ?? null;
  }
}

export async function generateAIHunterShoot(player: Player, gameState: GameState): Promise<number | null> {
  const context = buildGameContext(player, gameState);
  const targets = gameState.players.filter(p => p.isAlive && p.id !== player.id);
  if (targets.length === 0) return null;

  const prompt = `${context}

【猎人开枪】你已出局，可开枪带走一人。
存活玩家：${targets.map(p => `${p.id}号`).join("、")}
开枪优先级：预言家查杀目标 > 发言逻辑最差的 > 与自己对立最深的
绝对不要打预言家的金水玩家！

只返回JSON：{"targetId": 数字，放弃开枪返回-1}`;

  try {
    const text = await callAI(prompt, true);
    const result = safeJSON<{ targetId: number }>(text, { targetId: -1 });
    if (result.targetId === -1) return null;
    return targets.some(p => p.id === result.targetId) ? result.targetId : pick(targets)!.id;
  } catch {
    return pick(targets)!.id;
  }
}

// ─── Sheriff ──────────────────────────────────────────────────────────────────

export async function generateAISheriffChoice(player: Player, gameState: GameState): Promise<boolean> {
  // Hard rules (no AI needed)
  if (player.role === Role.SEER) return true;
  if (player.role === Role.WEREWOLF) {
    // Exactly one wolf runs, as the fake seer.
    const wolfCandidates = gameState.sheriffCandidates.filter(
      id => gameState.players.find(p => p.id === id)?.role === Role.WEREWOLF
    );
    return wolfCandidates.length === 0;
  }

  const context = buildGameContext(player, gameState);
  const prompt = `${context}

【警长竞选决策】你是${ROLE_LABELS[player.role]}，要不要上警竞选警长？
上警后你必须公开发言，会吸引狼人注意；不上警则无法争夺警徽。
考虑：你有重要信息可分享吗？上警会暴露身份吗？局势需要你站出来吗？
只返回JSON：{"run": true或false}`;

  try {
    const text = await callAI(prompt, true);
    return safeJSON<{ run: boolean }>(text, { run: false }).run === true;
  } catch {
    // No API: villagers and gods run about a third of the time so the
    // election is never empty.
    return Math.random() < 0.35;
  }
}

export async function generateAISheriffAction(player: Player, gameState: GameState): Promise<number | null> {
  const context = buildGameContext(player, gameState);
  const targets = gameState.players.filter(p => p.isAlive && p.id !== player.id);
  if (targets.length === 0) return null;

  const prompt = `${context}

【警徽移交】你是警长，你出局了！
存活玩家：${targets.map(p => `${p.id}号`).join("、")}
${player.role === Role.WEREWOLF
  ? "策略：传给你的狼队友；若队友都不在则撕毁警徽（返回-1）。"
  : "策略：传给最信任的金水玩家或发言最强的好人；若不确定则撕毁警徽。"}

只返回JSON：{"targetId": 数字或-1（撕毁）}`;

  try {
    const text = await callAI(prompt, true);
    const result = safeJSON<{ targetId: number }>(text, { targetId: -1 });
    if (result.targetId === -1) return null;
    return targets.some(p => p.id === result.targetId) ? result.targetId : null;
  } catch {
    return null;
  }
}
