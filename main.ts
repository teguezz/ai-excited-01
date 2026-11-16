// The Night the Ocean Stood Up — entry program for ai-excited-01.
//
// This entry is a single bundled image, `entry.jpg`, stored next to this
// file in the repository. Running the program copies that image, byte for
// byte, to `/output/entry.png`, the location the competition reads the
// entry image from.
//
// Node standard library only; no dependencies, no build step.

import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the bundled image relative to this program file rather than the
// process working directory, so the copy succeeds wherever it is run from.
const programDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(programDir, "entry.jpg");

const outputDir = "/output";
const outputPath = join(outputDir, "entry.png");

mkdirSync(outputDir, { recursive: true });
copyFileSync(sourcePath, outputPath);

// Report the copied size so a run log shows the image arrived whole.
const bytesCopied = statSync(outputPath).size;
console.log(`entry image copied: ${sourcePath} -> ${outputPath} (${bytesCopied} bytes)`);
