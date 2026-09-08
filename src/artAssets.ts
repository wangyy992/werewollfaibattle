import { Role } from './types';

export const CHARACTER_ART: Record<string, string> = {
  '老钟': '/images/characters/bell-keeper.webp',
  '伊芙': '/images/characters/tailor-eve.webp',
  '铁匠': '/images/characters/blacksmith.webp',
  '修士': '/images/characters/monk.webp',
  '米拉': '/images/characters/baker-mira.webp',
  '猎户': '/images/characters/hunter.webp',
  '诺亚': '/images/characters/carpenter-noah.webp',
  '薇拉': '/images/characters/weaver-vera.webp',
  '酒馆老板': '/images/characters/tavern-keeper.webp',
  '阿兰': '/images/characters/stable-hand-alan.webp',
  '渡鸦使者': '/images/characters/raven-messenger.webp',
};

export const ROLE_ART: Record<Role, string> = {
  [Role.WEREWOLF]: '/images/roles/role-werewolf.webp',
  [Role.SEER]: '/images/roles/role-seer.webp',
  [Role.WITCH]: '/images/roles/role-witch.webp',
  [Role.HUNTER]: '/images/roles/role-hunter.webp',
  [Role.IDIOT]: '/images/roles/role-idiot.webp',
  [Role.VILLAGER]: '/images/roles/role-villager.webp',
  [Role.GUARD]: '/images/roles/role-villager.webp',
};

export const ROLE_VIDEO: Partial<Record<Role, string>> = {
  [Role.WEREWOLF]: '/videos/roles/werewolf.mp4',
  [Role.SEER]: '/videos/roles/seer.mp4',
  [Role.WITCH]: '/videos/roles/witch.mp4',
  [Role.HUNTER]: '/videos/roles/hunter.mp4',
  [Role.IDIOT]: '/videos/roles/idiot.mp4',
  [Role.VILLAGER]: '/videos/roles/villager.mp4',
};

