# Gemini 静态美术提示词

目标：11 张公开人物立绘 + 6 张身份揭晓主视觉，共 17 张。公开人物与隐藏身份完全独立。

## 使用方式

优先使用 Gemini Nano Banana Pro。先生成“角色合集母版”，选定画风；之后在同一个对话中逐个生成角色，每次附上母版作为风格参考。人物图生成后统一抠图为透明 WebP。

所有人物提示词都追加下面的固定规范：

```text
Create a premium character portrait asset for a cinematic medieval social-deduction game.
Late-medieval isolated European mountain village, realistic painterly dark-fantasy concept art, believable face, weathered natural fabric and leather, restrained historical detail.
Half-body portrait, three-quarter view facing slightly toward the center of a village council circle, hands visible where practical, clean readable silhouette.
Cold blue moonlight from upper left and subtle warm firelight rim from lower front. Charcoal, weathered brown and desaturated earth palette with one restrained accent color.
Match the supplied character-sheet reference exactly in rendering style, camera height, proportions, lighting and detail density.
Plain neutral gray background for easy extraction. No magical effects, no role symbols, no text, no logo, no watermark, no modern objects, no anime proportions, no cropped head.
The character must look like an ordinary resident. Their hidden Werewolf-game role must not be visually inferable.
Portrait orientation, 1536x2048.
```

## 0. 十一人母版

```text
Create one unified character lineup sheet for eleven distinct residents of the same late-medieval European mountain village: an elderly male bell keeper, a composed female tailor, a broad male blacksmith, a restrained middle-aged monk, a sensitive young female baker, a decisive male hunter, a quiet male carpenter, a gentle female weaver, a worldly middle-aged male tavern keeper, an impulsive young male stable hand, and an enigmatic androgynous raven messenger.

All eleven stand in one row with equal scale, consistent camera height, realistic anatomy, clearly different faces, ages, silhouettes and restrained accent colors. Premium realistic painterly dark-fantasy game concept art. Cold moonlight from upper left and warm firelight rim from lower front. Ordinary villagers only: no supernatural effects and nothing that reveals a hidden game role. Full body, neutral poses, plain gray studio background, no text, no labels, no logo, no watermark, 16:9.
```

## 1–11. 公开人物

将对应段落放在固定规范之前。

### `bell-keeper.webp` — 老钟 / 守钟人

```text
Character: Lao Zhong, an elderly male bell keeper in his late sixties. Lean weathered face, deep-set attentive eyes, short gray beard, heavy dark wool coat, worn leather gloves, a small iron bell key at his belt. Reserved closed posture, hands loosely folded, cautious and observant rather than frail. Accent color: oxidized bronze.
```

### `tailor-eve.webp` — 伊芙 / 裁缝

```text
Character: Eve, a composed female tailor in her early thirties. Sharp intelligent eyes, dark hair pinned neatly beneath a simple linen head covering, fitted layered dress with visible hand stitching, measuring cord and a small pin cushion at her belt. Upright direct posture. Accent color: muted burgundy.
```

### `blacksmith.webp` — 铁匠

```text
Character: a broad male blacksmith in his forties. Soot-marked angular face, cropped dark hair, rolled linen sleeves, heavy cracked leather apron, muscular forearms, one scar across an eyebrow. Impatient defensive posture, one hand resting on the apron. No weapon. Accent color: ember rust.
```

### `monk.webp` — 修士

```text
Character: a restrained middle-aged male monk. Calm lined face, tonsured dark-gray hair, plain charcoal-brown wool habit, rope belt, small closed manuscript held against the chest. Precise composed posture and analytical gaze. No glowing religious symbols. Accent color: faded parchment.
```

### `baker-mira.webp` — 米拉 / 面包师

```text
Character: Mira, a young female baker in her mid twenties. Soft expressive face, chestnut hair loosely tied back, flour-dusted sleeves, practical layered dress and apron. Slightly guarded posture with hands held together, sensitive eyes watching the council. Accent color: muted wheat gold.
```

### `hunter.webp` — 猎户

```text
Character: a decisive male village hunter in his late thirties. Wind-burned face, short brown hair, trimmed beard, weatherproof hooded cloak, leather bracers and practical field clothing. Confident forward posture. A utility knife remains sheathed; no bow or gun visible. Accent color: dark forest green.
```

### `carpenter-noah.webp` — 诺亚 / 木匠

```text
Character: Noah, a quiet male carpenter in his early thirties. Thoughtful tired eyes, wavy dark-blond hair, simple linen shirt under a worn vest, leather tool roll at the belt without exposed blades. Reserved posture, gaze slightly lowered as if listening carefully. Accent color: muted slate blue.
```

### `weaver-vera.webp` — 薇拉 / 织布工

```text
Character: Vera, a gentle female weaver in her late thirties. Warm observant face, dark braided hair, layered wool dress, woven shawl with a subtle geometric edge, a small wooden spindle at the belt. Relaxed posture but unusually attentive eyes. Accent color: dusty teal.
```

### `tavern-keeper.webp` — 酒馆老板

```text
Character: a worldly male tavern keeper in his early fifties. Broad expressive face, receding brown-gray hair, rolled shirt sleeves, dark waistcoat, stained apron and a ring of cellar keys. Familiar half-smile that could become a skeptical question. Accent color: dark amber.
```

### `stable-hand-alan.webp` — 阿兰 / 马夫

```text
Character: Alan, an impulsive young male stable hand around twenty. Lean energetic face, messy sandy hair, rough open-collar shirt, patched vest, leather wrist wraps and traces of straw on one shoulder. Restless forward-leaning posture. Accent color: faded red ochre.
```

### `raven-messenger.webp` — 渡鸦使者 / 信使

```text
Character: an enigmatic androgynous raven messenger in the late twenties. Pale angular face, shoulder-length black hair, travel-worn layered cloak with a narrow hood, sealed message satchel and one ordinary black feather tucked into a clasp. Alert sideward gaze and controlled posture. No pet raven, no magic, no plague-doctor mask. Accent color: muted indigo.
```

## 12–17. 身份揭晓主视觉

身份图是玩家私人全屏演出，可以出现超自然效果。统一要求：电影级写实暗黑奇幻、16:9、人物位于中央偏下、上方保留标题空间、无文字、无 logo、无水印、适合作为 3–4 秒图生视频首帧。

### `role-werewolf.webp` — 狼人

```text
A cinematic Werewolf identity reveal in a late-medieval mountain village. A human villager stands beneath a huge pale moon turning blood red; the face remains human, the head lowered, dim crimson eyes just becoming visible. A giant wolf-shaped shadow stretches behind the figure across timber houses, with subtle claw scratches in the foreground. Cold navy fog, restrained red rim light, ominous and elegant, no gore, no full animal transformation, no extra characters. Wide 16:9 composition, stable centered hero pose, no text or watermark.
```

### `role-seer.webp` — 预言家

```text
A cinematic Seer identity reveal inside a dark medieval observatory chamber. A composed human figure holds both hands around a luminous crystal orb; a faint brass astrolabe and constellation lines form a halo behind them. Violet-blue starlight reflects in the eyes while candles remain dim at the edges. Mysterious, intelligent and sacred rather than flashy. Wide 16:9 composition, stable centered hero pose, no text or watermark.
```

### `role-witch.webp` — 女巫

```text
A cinematic Witch identity reveal in a believable medieval apothecary. A powerful human figure stands behind a worn wooden table; one green antidote bottle and one violet poison bottle glow on opposite sides. Restrained colored mist curls around the hands, shelves and dried herbs remain in shadow. Intelligent and morally ambiguous, not an elderly caricature, no pointed hat, no broom. Wide 16:9 composition, stable centered hero pose, no text or watermark.
```

### `role-hunter.webp` — 猎人

```text
A cinematic Hunter identity reveal at the edge of a moonlit medieval forest. A weathered human figure checks a historically inspired flintlock pistol held safely downward; a tiny ignition spark and thin smoke catch the cold light. Strong alert eyes, leather field coat, dark trees and distant village lanterns. Heroic but restrained, no firing, no weapon aimed at camera. Wide 16:9 composition, stable centered hero pose, no text or watermark.
```

### `role-idiot.webp` — 白痴

```text
A cinematic Idiot identity reveal in an abandoned medieval festival tent. An enigmatic human figure holds a cracked smiling mask beside their unchanged face while worn playing cards hang frozen in the air. Candlelight creates a second contradictory smile in the mirror behind them. Eerie, intelligent and tragic, never comedic or cartoonish. Wide 16:9 composition, stable centered hero pose, no text or watermark.
```

### `role-villager.webp` — 村民

```text
A cinematic Villager identity reveal at a heavy wooden doorway overlooking a moonlit mountain village. An ordinary but courageous human figure holds a warm lantern and steps into the cold blue night, looking toward the distant council square. Wind moves the coat edge and fog crosses the cobblestones. Grounded, vulnerable and dignified; no magic and no weapons. Wide 16:9 composition, stable centered hero pose, no text or watermark.
```

## 验收规则

- 11 名公开人物不能出现水晶球、药瓶、狼纹、枪械、面具等身份暗示。
- 同一人物返工时必须附上母版和上一张成图，并要求锁定脸、服装、比例、镜头与光线。
- 手指或脸部明显错误直接重生成，不靠后期硬修。
- 人物最终输出透明 WebP；身份主视觉输出 1920×1080 WebP。
- 保留无损原图，项目内再压缩，不要反复压缩源文件。

