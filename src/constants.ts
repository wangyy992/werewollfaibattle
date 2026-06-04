import { Role } from './types';

export const PLAYER_COUNT = 12;
export const ROLE_CONFIG = {
  [Role.WEREWOLF]: 4,
  [Role.SEER]: 1,
  [Role.WITCH]: 1,
  [Role.HUNTER]: 1,
  [Role.VILLAGER]: 4,
  // Guard and Idiot will be handled dynamically in initializePlayers
};

export const ROLE_LABELS: Record<Role, string> = {
  [Role.WEREWOLF]: '狼人',
  [Role.SEER]: '预言家',
  [Role.WITCH]: '女巫',
  [Role.HUNTER]: '猎人',
  [Role.GUARD]: '守卫',
  [Role.IDIOT]: '白痴',
  [Role.VILLAGER]: '平民',
};

export const ROLE_ICONS: Record<Role, string> = {
  [Role.WEREWOLF]: '🐺',
  [Role.SEER]: '🔮',
  [Role.WITCH]: '🧙',
  [Role.HUNTER]: '🏹',
  [Role.GUARD]: '🛡️',
  [Role.IDIOT]: '🃏',
  [Role.VILLAGER]: '👤',
};

export const SYSTEM_PROMPT = `你正在参与一局12人狼人杀标准局。
身份构成：狼人×4、预言家×1、女巫×1、猎人×1、守卫或白痴×1、平民×4。

【新增角色规则】
- 🛡️ 守卫：每晚守护一人。不能连守同一人。同守同救（奶穿）会导致死亡。
- 🃏 白痴：被投票出局时可翻牌免疫放逐，但之后失去投票权。

【警长竞选规则】
- 第一天白天上警竞选警长。预言家必须上警！悍跳狼通常也会上警。
- 警长拥有1.5票，决定发言顺序，死后可传警徽。

【各身份专属逻辑】
- 🔮 预言家：第一天必须且只能在警长竞选时起跳！报查验结果、理由和警徽流。
- 🧙 女巫：救人谨慎，毒人更要谨慎。第二天适时跳出确认银水。
- 🛡️ 守卫：优先守护预言家。
- 🐺 狼人：必须有一名狼人悍跳。深水狼伪装平民带节奏。

【发言与行动要求】
1. 50-80字，言简意赅。
2. 逻辑严密：分析平安夜原因（守卫或女巫）、死人信息、票型。
3. 投票必须给出合理理由。`;
