# 狼人杀 · AI Battle

12 人标准局狼人杀：你坐 1 号位，其余 11 席由大模型驱动的 AI 玩家扮演。
采用固定的“预女猎白”标准板子，包含警长竞选（上警发言 / 投票 / 1.5 票 / 警徽移交）、女巫、预言家、猎人、白痴的完整流程。

## 新版体验

- 中世纪月夜村庄主舞台与 12 人环形议会，发言、警长和出局状态一眼可见。
- 每局从身份揭晓动画开始，不同身份拥有独立氛围与使命文案。
- 11 位 AI 各有稳定人格和表达习惯，性格不会随抽到的身份改变。
- 白天轮流发言后进入自由讨论：玩家可点名质疑三次，AI 会正面回应，桌上还会有人插话。
- 投票前由三位关键玩家进行归票，明确给出唯一目标和依据。

## 运行

前置：Node.js 18+

```bash
npm install
cp .env.example .env.local   # 填入你的 API Key
npm run dev                  # http://localhost:3000
```

`npm run lint` 跑 TypeScript 检查，`npm run build` 产出静态站点。

## 配置 AI

默认走 DeepSeek 的 OpenAI 兼容接口。在 `.env.local` 中：

```
VITE_DEEPSEEK_API_KEY="sk-..."
# 可选：换成任意 OpenAI 兼容端点
# VITE_AI_BASE_URL="https://api.deepseek.com"
# VITE_AI_MODEL="deepseek-chat"
```

未配置 Key 时游戏仍可完整进行，但 AI 会退化为离线兜底逻辑（预设发言 + 随机决策），
界面顶部会给出提示。

> ⚠️ 这是纯前端应用，API Key 会被打进浏览器包里。仅适合本地自用，**不要部署到公网**。
> 公开部署请使用仓库自带的 Vercel 服务端代理来保管 Key。

## 部署到 Vercel

仓库已包含 `vercel.json` 和 `/api/chat` 服务端代理。把仓库导入 Vercel 后，只需添加：

```
DEEPSEEK_API_KEY="sk-..."
```

可选服务端变量：`AI_BASE_URL`、`AI_MODEL`。生产环境不要设置 `VITE_DEEPSEEK_API_KEY`，否则 Key 会进入浏览器包。

## 规则要点

- **胜负**：屠边。狼人杀光所有神职或所有平民即胜；好人杀光 4 狼即胜。
  改 `src/constants.ts` 的 `WIN_RULE` 为 `'ALL_KILL'` 可切回屠城。
- **身份不公开**：任何人出局都不翻牌，只公布座位号；白痴翻牌和游戏结束时才亮身份。
- **警长**：第一天竞选，上警者按座位号依次发言，未上警者投票；平票则本局无警长。
  警长投票 1.5 票、决定发言顺序、出局时可传递或撕毁警徽。
- **女巫**：解药毒药各一瓶，同夜只能用一瓶，不可自救。
- **守卫**：不可连守同一人；守卫 + 解药同时作用于一人时该玩家死亡（奶穿）。
- **猎人**：被狼刀或被放逐时可开枪；被女巫毒杀或被另一个猎人带走时不能开枪。
- **白痴**：被放逐时翻牌免死，此后失去投票权但保留发言权。

## 结构

```
src/
  App.tsx                 状态机 + 全部 UI
  types.ts                Phase / GameState / Player
  constants.ts            身份配置、胜负规则、AI 系统提示词
  lib/gameUtils.ts        发牌、胜负判定、发言顺序、计票
  services/aiService.ts   所有 AI 调用（发言 / 投票 / 夜间行动 / 警长决策）
```

流程由 `App.tsx` 里的单一 phase driver 驱动：每次阶段切换递增 `seq`，driver 以 `seq` 去重，
因此 StrictMode 下不会重复触发。所有异步逻辑读 `gsRef.current` 而非闭包快照，
保证后发言的 AI 能看到本轮前面所有人的发言。

