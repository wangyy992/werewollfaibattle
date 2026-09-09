# Village scene interface

The gameplay view is a full-screen village environment with twelve independently rendered residents. The old roster sidebar, avatar table and permanent log stream are removed.

- Entry: welcome screen, choose one of twelve face-down cards, identity video, enter village. Human seating is still randomized by the rules engine.
- Conversation: current speech is attached to its resident; the upper-right journal holds historical and private logs.
- Target actions: select a resident, then confirm in the contextual action panel. Applies to exile voting, sheriff voting, wolf attacks, seer checks, witch poison, hunter shots and sheriff handoff.
- Animation: procedural idle/speaking movement, selection seals, fire and fog, desaturated translucent dead residents. These are portrait animations, not skeletal animation or lip sync.
- Public images have a neutral background removed at render time using an edge-connected flood fill. Supplied portraits are cropped below the knees; lower edges fade into the scene. Identity art retains a soft vignette because its scenic background is not a neutral extraction plate.
- White Wolf King remains an unused expansion asset. The standard board uses the Idiot.

## Background provenance

Created using the built-in image generation tool and saved as `src/assets/village-stage.png`.

Prompt:

```text
Use case: stylized-concept. Asset type: finished 16:9 game background for a medieval werewolf social deduction game. Paint an empty medieval village council square at blue hour, from an elevated gently downward camera. Entire lower two thirds must show detailed visible cobblestone ground, a broad open unobstructed oval gathering area to composite twelve standing characters later. Surrounding half-timbered houses and a bell tower occupy the upper third, warm amber windows and wall torches, distant forested hills, cool blue twilight mist. Premium realistic painterly dark fantasy game environment matching realistic medieval character paintings. Ground is clearly lit blue-gray, visible across full width, never blacked out. Gentle warm firelight at center of plaza but NO fire, NO table, NO chairs, NO people, NO silhouettes, NO UI, NO lettering, NO border, NO watermark. Enough light to see the village and ground texture. Wide 16:9 composition.
```
