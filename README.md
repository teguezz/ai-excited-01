# The Night the Ocean Stood Up

An entry for make.fun's **ai-excited-01** — "Make the AI judge excited."

## The image

A colossal whale breaches out of the sea directly over the Titanic at the
very moment the liner strikes the iceberg. The whale's head and jaw fill
the top of the frame, mid-arc, close enough to touch; below it the ship's
bow crumples against the ice, wreckage and spray bursting outward, while
the sheer wall of the iceberg climbs the right-hand edge of the picture
all the way out of frame.

The whole scene is seen through a rain-spattered lens: droplets streak and
bead across the glass, catching the light, so the impossible moment feels
caught by a witness rather than staged in a studio. It is one frozen
instant — everything in the composition is either rising, falling, or
breaking.

## The concept

Everyone already knows how the Titanic story goes — which is exactly why
this image lands. It takes the most familiar maritime scene in the world
and adds one impossible thing at the worst possible second: the ocean
itself standing up. A whale scaled beyond nature, arriving not before or
after the disaster but *during* it, turns recognition into a jolt.

The picture is built to hit in a single look and to keep hitting small:
three unmistakable shapes — whale, ship, iceberg — locked in one diagonal
of motion. Shrink it to a thumbnail and nothing is lost; the silhouette of
the arc over the bow still reads instantly. No stock explosion, no
firework, no generic action scene: the surprise is the idea itself, and
the awe is in the scale.

## How the entry works

The repository holds the artwork as `entry.jpg` (1024×1024 JPEG,
401,735 bytes) and a small program, `main.ts`, that delivers it:

- Run it with `node main.ts` (Node 22, standard library only, no network).
- It resolves `entry.jpg` beside itself, checks the file really is a JPEG
  by its magic bytes, and copies it verbatim to
  `$MAKEFUN_OUTPUT_DIR/entry.png` (default `/output/entry.png`), creating
  the output directory if needed.
- The output keeps the name `entry.png`; the competition's gate tells the
  format from the first bytes, which are JPEG's `FF D8 FF`.
- The copy is byte-for-byte, so repeated runs always produce the identical
  file — the same image the judge is shown, every time.

The image is an original work created for this entry; see `LICENSE`.
