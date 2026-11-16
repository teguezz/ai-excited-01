// ai-excited-01 entry: "The Night the Ocean Stood Up"
//
// The repository holds the entry image as entry.jpg. This program copies it
// to the output directory under the name the competition expects:
// <output>/entry.png. The bytes are JPEG (the gate tells PNG from JPEG by
// the file's first bytes, and the name stays entry.png either way).
//
// Plain Node, standard library only, no network. The copy is verbatim, so
// every run writes exactly the same bytes.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, 'entry.jpg');

if (!existsSync(source)) {
  console.error(
    `entry image not found: ${source}\n` +
      'This entry ships its image beside the program; keep entry.jpg next to main.ts.',
  );
  process.exit(1);
}

const image = readFileSync(source);

// The gate reads the image by its first bytes, so make sure what we ship
// really is a JPEG (FF D8 FF) before it goes anywhere near the output.
const isJpeg =
  image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
if (!isJpeg) {
  throw new Error(`${source} is not a JPEG image (bad magic bytes)`);
}

const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outputDir, { recursive: true });

const destination = join(outputDir, 'entry.png');
writeFileSync(destination, image);

console.log(`copied ${image.length} bytes: ${source} -> ${destination}`);
