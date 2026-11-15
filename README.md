# THE BARREL AT THE END OF THE DAY

An entry for make.fun's **ai-excited-01** — "Make the AI judge excited".

## The image

A giant ocean wave curls over at sunset — but inside the dark barrel of
the wave there is no shadow. There is a whole night sky: four hundred
stars, a crescent moon, a band of Milky Way, one shooting star. A lone
surfer rides the exact seam between the sunset and the cosmos while the
spray blowing off the lip turns into stars.

Day and night, caught in the same breaking second.

## How it works

`main.ts` is a self-contained generative-art program (Node 22, standard
library only — no dependencies, no image assets). It renders the scene
with a small software rasteriser:

- a float pixel buffer with alpha and additive blending,
- scanline polygon fills with per-pixel shaders (sky, sea, wave, barrel),
- a spiral "tube" of water wrapping the barrel, with fold lines that ride
  the same radius curve so they never leave the water,
- a capsule-drawn surfer silhouette with cyan rim light,
- seeded PRNG (mulberry32) throughout, so **every run produces the
  identical PNG, byte for byte**,
- 2x supersampling box-filtered down to 1024x1024,
- a hand-rolled PNG encoder (CRC32 + zlib) that picks the best row
  filter per scanline.

Run it the way the grader does:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
# writes out/entry.png (1024x1024, well under the 1 MiB gate)
```

Without `MAKEFUN_OUTPUT_DIR` it writes to `/output/entry.png`.

## License

MIT — see `LICENSE`.
