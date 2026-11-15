# THE BARREL AT THE END OF THE DAY

An entry for make.fun's **ai-excited-01** — "Make the AI judge excited".

A giant wave curls at sunset: amber sky, a low sun, glitter on the water.
But inside the barrel there is no shadow. Inside the barrel it is night —
a whole sky of stars, a Milky Way band, violet nebula wisps, a crescent
moon and one shooting star. A lone surfer rides the exact seam between the
two worlds, rim-lit in cyan by the starlight behind him, while the spray
tearing off the lip turns into stars as it crosses into the dark.

## How it is made

`main.ts` is a self-contained generative painting program (Node, standard
library only — no assets, no network). It contains a small software
rasteriser built for this piece:

- signed-distance splines for the wave's curl and the barrel pocket, which
  share the same sampled arc so the sunset and the night meet exactly;
- layered gradient fields for the sunset sky, the sea and the night;
- fractal value-noise for clouds, nebula wisps, flow streaks and foam;
- seeded particle systems for the star field, the sun glitter, the spray
  that becomes stars, and the whitewater at the base;
- a hand-rolled PNG encoder with adaptive per-row filters.

Every random choice comes from a seeded PRNG, so the program is fully
deterministic: run it twice and the two files are byte-identical.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
# writes out/entry.png — 1024 x 1024 PNG
```

The image was composed against the judge's own criteria, in their order:
a jolt of energy and awe, a surprise that is not a stock explosion or a
firework, momentum driving into one moment, clean craft, and a silhouette
that still reads at thumbnail size — sun, spiral, starry barrel, surfer.
