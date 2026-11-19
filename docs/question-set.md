# The interview

Twelve questions, in this order. Ask them in batches of two or three. Each one maps onto
something the engine actually draws, which is why they are these twelve and not an open
"describe your world".

Record every answer in `WORLD-BRIEF.md`. A slot the user has no answer for is recorded as
**empty**, not quietly filled in.

Two standing rules:

- **A weak answer is still an answer.** Each question below names what a weak answer looks
  like. When you get one, say what you are going to assume, give one concrete default, and
  let the user correct it. Do not interrogate.
- **Never refuse a setting.** If the answers leave most slots empty, say so plainly and
  build it anyway.

---

## Q1 — What is the setting?

One or two sentences. Where are we, and what is the one thing you want someone to see.

**Determines:** everything downstream — the palette, the mesh vocabulary, the names in the
menu card, and which slots have an obvious occupant.

**A weak answer looks like:** a genre rather than a place ("something fantasy", "sci-fi
vibes"), or a list of adjectives with no object in it. Push once for a physical noun: what
is overhead, what is underfoot.

**If the setting is outside the family** — the engine is built for enclosed layered volumes
lit from above, so a forest, an ocean, a cavern and a volcanic basin are all one shape —
say so now, once. Name the slots that will be empty. A desert or an open plain empties most
of them and turns haze into heat shimmer, which is a different shader than the one shipped.
Then carry on.

---

## Q2 — What does distance read as here: colour loss, occlusion, or darkness?

This is the highest-value question in the interview. Ask it properly, and explain the three
options if the user hesitates.

- **Colour loss** — far things desaturate and blue out. Red dies first. The world reads as
  vast and sparse, and fog hides the far distance. (This is what an ocean does.)
- **Occlusion** — you see thirty metres because things block you, not because the air eats
  light. The world reads as dense and close. (This is what a forest does.)
- **Darkness** — light falls off with depth and far things simply are not lit. Emissive
  detail carries the read. (This is what a cavern or a deep shaft does.)

**Determines:** density, draw distance, near-camera population, the haze profile, and how
height drives lighting. It is a global, not a slot.

**Why it matters more than the rest:** this single difference drove most of the divergence
between the rainforest world and its ocean parent. Underwater, distance was colour loss, so
the sea was sparse and vast with fog hiding the far field. In the forest it is occlusion, so
the vegetation had to get dense and close, draw distance dropped, near-camera density rose,
and height took over the lighting — dim at the floor, shafts in the mid-storey, blazing sun
above the canopy. Nothing else in the mapping changed that much.

**A weak answer looks like:** "all three", or a restatement of the mood ("mysterious").
Make the user choose a primary. If they genuinely want two, pick one as primary and apply
the second only to the palette.

---

## Q3 — What is the ceiling, and what punches holes in it?

**Determines:** the overhead occluder — one quad with `discard` for the gaps — and therefore
where light gets in at all. Needs two things: the material of the ceiling, and the shape and
spacing of the holes.

**A weak answer looks like:** "open sky". An open sky is a ceiling with no holes, which
switches off this slot *and* Q4 and Q5 with it, because there is nothing for the light to
pass through and nothing to pattern the floor. If the user wants open sky, say that those
three slots go empty together and that the world will read flat from above.

---

## Q4 — What does the light coming through look like?

Colour, hardness, and whether the shafts are a few strong ones or many weak ones.

**Determines:** the volumetric shaft pass — its colour, step count and intensity — and the
sun direction, which is shared with Q5.

**A weak answer looks like:** "sunlight". Ask for the time of day and the weather instead,
and derive colour and hardness from that.

---

## Q5 — What pattern does that light cast on the floor?

**Determines:** the floor projection. It uses the *same* sun projection as the shafts, so
the two line up by construction. Change the sun and both move.

**A weak answer looks like:** a pattern that cannot come from the ceiling in Q3. If the
answer does not follow from the holes, say so — a floor pattern that contradicts the ceiling
is a plain tell that a world was assembled rather than designed.

---

## Q6 — What stands vertically, floor to ceiling?

Count, thickness, how they branch or taper, whether anything hangs off them.

**Determines:** the instanced column meshes, which carry most of the world's silhouette and
most of its triangle budget.

**A weak answer looks like:** a number with no form ("lots of pillars"). Ask what the base
does — flares, splits, sinks into the floor — because the base is at eye level in most of
the viewpoints. Black buttress roots were a real defect in the rainforest world, and that
is exactly where it showed.

---

## Q7 — What drifts in the air?

The motes: size, brightness, how fast they fall or hang, whether they catch the light.

**Determines:** the camera-local particle population. Cheap, and it is what makes the
volume feel like it has air in it rather than being empty space.

**A weak answer looks like:** "dust". Dust is fine, but ask whether it is lit from the side
(visible in the shafts only) or self-lit (visible everywhere), because those look nothing
alike.

---

## Q8 — What moves in groups — many, small, together?

**Determines:** the schooling population, animated in closed form from time on orbiting
paths, with no CPU cost per frame. Fish, butterflies, bats, sparks, whatever the setting
supports.

**A weak answer looks like:** one large creature. That is Q9, not Q8. If the setting has no
group creature, record it empty and say that the world will feel still at mid-distance.

---

## Q9 — What moves alone — large, slow, overhead?

**Determines:** the soaring population — the slow large-wing animation, few instances, large
scale. It is the thing that gives scale to everything else, because the viewer reads its
size against the columns.

**A weak answer looks like:** a creature too small to read at distance. If it would be
pixels at the far viewpoints, it belongs in Q8.

---

## Q10 — How does the air itself change with height?

Thick at the floor and thinning as you climb? Uniform? Thicker above?

**Determines:** the haze profile — density at the floor and its falloff with height — and
with it the payoff of climbing. In the rainforest, breaking through the canopy opens the view
because haze is heavy below and thin above. That moment is a haze setting, not a geometry
setting.

**A weak answer looks like:** "foggy". Ask what it feels like to climb: does the view open up,
close down, or stay the same.

---

## Q11 — The palette, and what night looks like

Three or four colours: the ground, the ceiling, the light, and the far distance. Plus what
the `N` key should do — every world has a day/night toggle, so night has to be designed, not
inherited.

**Determines:** the palette block in `shaders.js`, the sky backdrop, the star field, and the
page's own CSS so the menu card matches the world behind it.

**A weak answer looks like:** day colours only. A night that is just the day palette turned
down is a known defect, not a style: in the rainforest world the canopy stayed daylight-green
at night and it passed a green build. Ask explicitly what is still lit when the sun is gone.

---

## Q12 — What is it called, and whose name goes on it?

Title for the page and the menu card, a subtitle line if they want one, and the name to put
on "recorded by".

**Determines:** `template.html`, the README, and the GitHub links in the menu footer.

**A weak answer looks like:** no answer, which is fine — use the folder name and leave the
"recorded by" line out. The Abyssal Garden credit link stays regardless of what this answer
is; it is not the user's to remove.

---

## After the interview

Before you touch the engine, read the brief back to the user in six lines or fewer: the
setting, the distance answer, and the slots that are going to be empty. That read-back is
the last cheap place to catch a misunderstanding. Everything after it costs a build.
