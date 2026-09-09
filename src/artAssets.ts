import { Role } from './types';

export const CHARACTER_ART: Record<string, string> = {
  '老钟': '/images/characters/bell-keeper.jpg',
  '伊芙': '/images/characters/tailor-eve.jpg',
  '铁匠': '/images/characters/blacksmith.jpg',
  '修士': '/images/characters/monk.jpg',
  '米拉': '/images/characters/baker-mira.jpg',
  '猎户': '/images/characters/hunter.jpg',
  '诺亚': '/images/characters/carpenter-noah.jpg',
  '薇拉': '/images/characters/weaver-vera-repaired.png',
  '酒馆老板': '/images/characters/tavern-keeper-repaired.png',
  '阿兰': '/images/characters/stable-hand-alan.jpg',
  '渡鸦使者': '/images/characters/raven-messenger.jpg',
};

export const ROLE_ART: Record<Role, string> = {
  [Role.WEREWOLF]: '/images/roles/role-werewolf.jpg',
  [Role.SEER]: '/images/roles/role-seer.jpg',
  [Role.WITCH]: '/images/roles/role-witch.jpg',
  [Role.HUNTER]: '/images/roles/role-hunter.jpg',
  [Role.IDIOT]: '/images/roles/role-idiot.jpg',
  [Role.VILLAGER]: '/images/roles/role-villager.jpg',
  [Role.GUARD]: '/images/roles/role-villager.jpg',
};

// Retained for a future special-wolf ruleset; the standard 12-player game does
// not deal this role because “预女猎白” uses the Idiot, not the White Wolf King.
export const EXPANSION_ART = {
  whiteWolfKing: '/images/roles/role-white-wolf-king.jpg',
  whiteWolfKingVideo: '/videos/roles/white-wolf-king.mp4',
};

export const ROLE_VIDEO: Partial<Record<Role, string>> = {
  [Role.WEREWOLF]: '/videos/roles/werewolf.mp4',
  [Role.SEER]: '/videos/roles/seer.mp4',
  [Role.WITCH]: '/videos/roles/witch.mp4',
  [Role.HUNTER]: '/videos/roles/hunter.mp4',
  [Role.IDIOT]: '/videos/roles/idiot.mp4',
  [Role.VILLAGER]: '/videos/roles/villager.mp4',
};

