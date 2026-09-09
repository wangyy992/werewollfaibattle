# Full-body character integration

Sources: the eleven JPG files supplied by the user from E:/Download. Originals are retained under public/images/characters. Two separate repaired PNG files are used by artAssets.ts; original JPGs are not replaced by generated repairs.

Method: built-in image_gen, precise-object-edit (not CLI). Existing canvas rendering removes neutral edge-connected backgrounds at runtime. This is a lightweight animated illustration, not skeletal animation.

## Tavern keeper prompt

Use case: precise-object-edit. Image 1 is the edit target: medieval female tavern keeper full-body game sprite. Remove ONLY the disconnected extra floating hand and cup to the left of her waist. Preserve her real raised hand holding its cup, real lowered hand, face, hair, expression, costume, body proportions, pose, both feet, framing and painted style exactly. Keep plain neutral gray background unchanged. One full-body character only; no inset details, extra limbs or props. Entire boots visible.

Output: public/images/characters/tavern-keeper-repaired.png

## Weaver prompt

Use case: precise-object-edit. Image 1 is the edit target: medieval female weaver full-body game sprite. Repair ONLY the ghostly extra sleeve fragments protruding from both sides at waist level: remove these detached/fading duplicates and give the existing shawl a clean natural silhouette with arms concealed underneath. Preserve face, hair, expression, shawl pattern, costume, hanging weaving tools, pose, body proportions, full skirt, both shoes, framing and painted style. Keep the same plain neutral gray background. No extra hands, no new props, no redesign. Entire feet visible.

Output: public/images/characters/weaver-vera-repaired.png
