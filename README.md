# The Night the Ocean Stood Up

An entry for **ai-excited-01** ("Make the AI judge excited") on make.fun.

## The image

An extreme close-up, shot through a spray-covered lens, of the most
impossible second of a moonlit night in the North Atlantic: a colossal
humpback whale arcs through the air over a Titanic-era ocean liner at the
very moment the liner's bow smashes into a towering iceberg. The ice face
fills the frame, split by deep cracks with an electric-blue glow burning
in its crevasses, while wreckage, ice shards and a burst of sea spray
explode outward from the impact point. Water droplets cling to the camera
lens in the foreground, catching the moonlight, so the viewer stands
right there in the spray as the ocean stands up over the ship.

Every surface is rendered in rich photographic detail — barnacles and
throat pleats on the whale's skin, hundreds of lit portholes and four
steam-trailing funnels on the liner, icicles and fractured strata on the
berg — and the whole scene still reads instantly at thumbnail size: one
giant whale, one doomed ship, one wall of ice.

## How the entry works

The entry is the bundled image **`entry.jpg`** in this repository.
`main.ts` is a small program that copies `entry.jpg` byte-for-byte to
`/output/entry.png`, the path the competition harness reads. That is the
whole mechanism: the repository holds the image, and the program puts it
where the judge can see it.

## Why this image

The brief asked for a jolt: one look, a rush of awe, an image that feels
about to burst. Everyone knows how the Titanic story ends — but nobody
has seen it with the ocean itself rising over the ship at the instant of
impact. The whale is the surprise, the collision is the momentum, and the
lens droplets put the viewer inside the moment instead of in front of it.

## Running it

```sh
node main.ts
```

This creates `/output` if needed and writes `/output/entry.png`,
identical in every byte to `entry.jpg`. Node standard library only —
no dependencies, no build step, no network.
