// THE BARREL AT THE END OF THE DAY
// A generative painting for make.fun's ai-excited-01 ("Make the AI judge excited").
//
// A giant wave curls at sunset. Inside its barrel there is no shadow and no
// foam-dark: there is a whole night sky — stars, a Milky Way band, nebula
// wisps, a crescent moon, one shooting star. A surfer rides the exact seam
// between the sunset world and the cosmos, spray off the lip turning into
// stars as it crosses into the dark.
//
// Everything is drawn by this program alone: a small software rasteriser
// (signed-distance shapes, layered gradients, seeded particle splats) and a
// hand-rolled PNG encoder. Node standard library only, no assets, no
// network, fully deterministic — a seeded PRNG drives every random choice,
// so two runs write byte-identical files.

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) and value noise
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(0xba22e1);

// Hash-based 2D value noise with smooth interpolation; deterministic.
function hash2(ix, iy) {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x, y, oct) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    v += amp * vnoise(x * f, y * f);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return v / norm;
}

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
function mix3(c0, c1, t) {
  return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
}

// Catmull-Rom spline through control points -> dense polyline.
function spline(pts, samplesPerSeg) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i];
    const p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    for (let j = 0; j < samplesPerSeg; j++) {
      const t = j / samplesPerSeg, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(pts[n - 1].slice());
  return out;
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = clamp(t, 0, 1);
  const ex = ax + dx * t - px, ey = ay + dy * t - py;
  return Math.sqrt(ex * ex + ey * ey);
}

// Distance to a polyline (array of [x,y]).
function distToLine(pts, px, py) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const dd = distToSeg(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (dd < d) d = dd;
  }
  return d;
}

// Even-odd point-in-polygon test for a closed polyline.
function insidePoly(pts, px, py) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Canvas: float RGB buffer with blend / add brushes
// ---------------------------------------------------------------------------

const W = 1024, H = 1024;
const buf = new Float32Array(W * H * 3);

function blendPx(x, y, c, a) {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 3;
  const ia = 1 - a;
  buf[i] = buf[i] * ia + c[0] * a;
  buf[i + 1] = buf[i + 1] * ia + c[1] * a;
  buf[i + 2] = buf[i + 2] * ia + c[2] * a;
}

function addPx(x, y, c, a) {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 3;
  buf[i] += c[0] * a;
  buf[i + 1] += c[1] * a;
  buf[i + 2] += c[2] * a;
}

// Soft radial splat (additive).
function splat(cx, cy, r, c, a) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      const d2 = (dx * dx + dy * dy) / (r * r);
      if (d2 < 1) {
        const fall = (1 - d2) * (1 - d2);
        addPx(x, y, c, a * fall);
      }
    }
  }
}

// Filled disc with soft edge (blend).
function disc(cx, cy, r, soft, c, a) {
  const R = r + soft;
  const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(W - 1, Math.ceil(cx + R));
  const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(H - 1, Math.ceil(cy + R));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      blendPx(x, y, c, a * smooth(r + soft, r - soft, d));
    }
  }
}

// Capsule (thick line with round caps) via SDF, blend.
function capsule(ax, ay, bx, by, r, c, a) {
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 2)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + r + 2));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 2)), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + r + 2));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = distToSeg(x, y, ax, ay, bx, by);
      blendPx(x, y, c, a * smooth(r + 1.2, r - 1.2, d));
    }
  }
}

// ---------------------------------------------------------------------------
// Scene geometry (1024 x 1024, y grows downward)
// ---------------------------------------------------------------------------

// Wave silhouette: up the back, over the crest, lip tip, back along the
// underside, out and down the face to the toe, along the bottom, closed.
const WAVE_OUTER = [
  [-20, 818], [28, 646], [92, 472], [182, 332], [302, 216], [452, 142],
  [598, 106], [750, 136], [854, 206], [882, 296], [862, 388], [808, 434],
  [724, 464],
];
const WAVE_INNER = [
  [650, 430], [566, 410], [480, 410], [414, 434], [380, 480], [404, 556],
  [454, 626], [538, 684], [656, 724], [788, 752], [874, 784], [874, 842],
  [400, 852], [-20, 846],
];
const wavePoly = spline(WAVE_OUTER.concat(WAVE_INNER), 10);

// The barrel pocket (night sky) shares the wave's own inner arc, sampled
// from the very same polyline, so the night and the wave meet exactly —
// no sliver of sunset can leak between them. The pocket runs: lip tip ->
// underside -> face arc down to (656,724) -> a closing edge back up across
// the face to the lip tip.
const LIP_IDX = (WAVE_OUTER.length - 1) * 10; // lip tip's index in wavePoly
const FACE_END_IDX = LIP_IDX + 8 * 10;        // (656,724)'s index in wavePoly
const innerArc = wavePoly.slice(LIP_IDX, FACE_END_IDX + 1);
const pocketClose = spline([[656, 724], [706, 648], [730, 550], [724, 464]], 10);
const pocketPoly = innerArc.concat(pocketClose.slice(1, -1));
// close the pocket spline back to its first point for the fill test
const pocketClosed = pocketPoly.concat([pocketPoly[0]]);

// Lip line for foam and spray: crest shoulder -> lip tip -> underside.
const lipLine = wavePoly.slice(80, LIP_IDX + 31);
const crestLine = wavePoly.slice(30, 111);
const underLine = wavePoly.slice(LIP_IDX + 6, LIP_IDX + 66);

const SUN = [898, 452], SUN_R = 56;
const WATER_Y = 700;

// ---------------------------------------------------------------------------
// Paint: sunset sky
// ---------------------------------------------------------------------------

const SKY_TOP = [0.16, 0.07, 0.28];
const SKY_MID = [0.62, 0.16, 0.38];
const SKY_LOW = [0.98, 0.45, 0.16];
const SKY_HOR = [1.0, 0.68, 0.30];

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const v = y / H;
    let c;
    if (v < 0.42) c = mix3(SKY_TOP, SKY_MID, v / 0.42);
    else if (v < 0.68) c = mix3(SKY_MID, SKY_LOW, (v - 0.42) / 0.26);
    else c = mix3(SKY_LOW, SKY_HOR, clamp((v - 0.68) / 0.1, 0, 1));
    // warm bloom around the sun
    const dx = x - SUN[0], dy = (y - SUN[1]) * 1.25;
    const sd = Math.sqrt(dx * dx + dy * dy);
    const glow = Math.exp(-sd / 300) * 0.55 + Math.exp(-sd / 90) * 0.5;
    c = [c[0] + glow * 0.95, c[1] + glow * 0.5, c[2] + glow * 0.18];
    const i = (y * W + x) * 3;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
  }
}

// Soft sunset clouds: stretched fbm bands, warm-lit.
for (let y = 0; y < 700; y++) {
  for (let x = 0; x < W; x++) {
    const n = fbm(x * 0.0016, y * 0.012, 4);
    const band = smooth(0.58, 0.78, n) * smooth(700, 420, y);
    if (band > 0.01) {
      const warm = clamp(1 - y / 700, 0, 1);
      const cc = mix3([0.45, 0.16, 0.34], [1.0, 0.55, 0.30], warm * 0.7);
      blendPx(x, y, cc, band * 0.35);
    }
  }
}

// Sun disc with a hot core.
disc(SUN[0], SUN[1], SUN_R, 3, [1.0, 0.72, 0.34], 1);
disc(SUN[0], SUN[1], SUN_R * 0.62, 10, [1.0, 0.86, 0.55], 0.9);
splat(SUN[0], SUN[1], 190, [1.0, 0.6, 0.22], 0.30);

// ---------------------------------------------------------------------------
// Paint: the sea (before the wave; the wave covers the middle)
// ---------------------------------------------------------------------------

const SEA_TOP = [0.13, 0.10, 0.30];
const SEA_BOT = [0.03, 0.05, 0.14];
for (let y = WATER_Y; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const t = (y - WATER_Y) / (H - WATER_Y);
    let c = mix3(SEA_TOP, SEA_BOT, t);
    // dusk sheen drifting from the sun side
    const sheen = Math.exp(-Math.abs(x - SUN[0]) / 260) * (1 - t) * 0.35;
    c = [c[0] + sheen * 0.9, c[1] + sheen * 0.45, c[2] + sheen * 0.12];
    const streak = fbm(x * 0.02, y * 0.11, 3);
    const s = smooth(0.62, 0.85, streak) * 0.10 * (1 - t * 0.6);
    c = [c[0] + s, c[1] + s * 0.9, c[2] + s * 0.8];
    const i = (y * W + x) * 3;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
  }
}

// Sun glitter: dashed horizontal sparkles in a column under the sun.
for (let k = 0; k < 900; k++) {
  const gy = WATER_Y + 8 + Math.pow(rng(), 1.4) * (H - WATER_Y - 20);
  const spread = 60 + (gy - WATER_Y) * 0.55;
  const gx = SUN[0] + (rng() * 2 - 1) * spread;
  const len = 3 + rng() * (10 + (gy - WATER_Y) * 0.05);
  const bright = (0.25 + rng() * 0.75) * clamp(1.15 - (gy - WATER_Y) / 340, 0.15, 1);
  capsule(gx - len / 2, gy, gx + len / 2, gy, 1.1, [1.0, 0.66, 0.28], bright * 0.55);
}

// ---------------------------------------------------------------------------
// Paint: the night sky inside the barrel
// ---------------------------------------------------------------------------

const NIGHT_TOP = [0.012, 0.016, 0.05];
const NIGHT_BOT = [0.05, 0.08, 0.19];
const pocketBox = { x0: 330, y0: 360, x1: 780, y1: 760 };

// Milky Way band: a diagonal through the pocket.
const MW_A = [392, 428], MW_B = [692, 664];
function milkyWay(x, y) {
  const d = distToSeg(x, y, MW_A[0], MW_A[1], MW_B[0], MW_B[1]);
  const band = Math.exp(-(d * d) / (2 * 58 * 58));
  const mottle = 0.45 + 0.55 * fbm(x * 0.012 + 7, y * 0.012 - 3, 4);
  return band * mottle;
}

for (let y = pocketBox.y0; y < pocketBox.y1; y++) {
  for (let x = pocketBox.x0; x < pocketBox.x1; x++) {
    if (!insidePoly(pocketClosed, x, y)) continue;
    const dEdge = distToLine(pocketPoly, x, y);
    const edge = smooth(0, 2, dEdge); // 0 at the lip line, 1 deep inside
    const t = (y - pocketBox.y0) / (pocketBox.y1 - pocketBox.y0);
    let c = mix3(NIGHT_TOP, NIGHT_BOT, t);
    // nebula wisps
    const neb = fbm(x * 0.006 - 4, y * 0.006 + 9, 4);
    const neb2 = fbm(x * 0.009 + 11, y * 0.009 + 2, 3);
    const violet = smooth(0.55, 0.85, neb) * 0.5;
    const teal = smooth(0.58, 0.88, neb2) * 0.4;
    c = [
      c[0] + violet * 0.30 + teal * 0.05,
      c[1] + violet * 0.12 + teal * 0.26,
      c[2] + violet * 0.48 + teal * 0.34,
    ];
    // Milky Way glow
    const mw = milkyWay(x, y);
    c = [c[0] + mw * 0.34, c[1] + mw * 0.38, c[2] + mw * 0.5];
    blendPx(x, y, c, edge);
  }
}

// Stars inside the pocket (seeded; denser and brighter along the Milky Way).
const starTints = [
  [1, 1, 1], [0.82, 0.88, 1], [1, 0.92, 0.78], [0.72, 0.95, 1],
];
let placed = 0, guard = 0;
while (placed < 460 && guard++ < 20000) {
  const x = pocketBox.x0 + rng() * (pocketBox.x1 - pocketBox.x0);
  const y = pocketBox.y0 + rng() * (pocketBox.y1 - pocketBox.y0);
  if (!insidePoly(pocketClosed, x, y)) continue;
  if (distToLine(pocketPoly, x, y) < 4) continue;
  const mw = milkyWay(x, y);
  if (rng() > 0.35 + mw * 0.9) continue; // density follows the band
  const big = rng();
  const r = big > 0.96 ? 3.4 : big > 0.8 ? 2.2 : 1.3;
  const bright = (0.3 + rng() * 0.7) * (0.65 + mw * 0.6);
  const tint = starTints[Math.floor(rng() * starTints.length)];
  splat(x, y, r, tint, bright);
  if (big > 0.96) splat(x, y, 9, tint, 0.16); // halo on the few bright ones
  placed++;
}

// Crescent moon, low in the barrel's right side.
const MOON = [612, 522], MOON_R = 30;
splat(MOON[0], MOON[1], 95, [0.75, 0.78, 0.9], 0.20);
disc(MOON[0], MOON[1], MOON_R, 2, [0.96, 0.93, 0.80], 1);
// bite out of the moon with the night colour sampled as a flat deep tone,
// softened: paint the offset disc in deep indigo, then re-star a little.
disc(MOON[0] + 14, MOON[1] - 7, MOON_R - 3, 3, [0.035, 0.05, 0.13], 1);
for (let k = 0; k < 26; k++) {
  const x = MOON[0] + 14 + (rng() * 2 - 1) * 26;
  const y = MOON[1] - 7 + (rng() * 2 - 1) * 26;
  if (insidePoly(pocketClosed, x, y)) {
    splat(x, y, 1.2, [1, 1, 1], 0.25 + rng() * 0.5);
  }
}

// One shooting star, upper left of the barrel.
{
  const ax = 448, ay = 452, bx = 520, by = 487;
  for (let s = 0; s <= 40; s++) {
    const t = s / 40;
    const x = lerp(ax, bx, t), y = lerp(ay, by, t);
    const fade = t * t; // bright head at b, fading tail at a
    splat(x, y, 1.6 + fade * 1.6, [0.9, 0.95, 1], 0.10 + fade * 0.5);
  }
  splat(bx, by, 7, [1, 1, 1], 0.5);
}

// ---------------------------------------------------------------------------
// Paint: the wave body
// ---------------------------------------------------------------------------

const WAVE_TOP = [0.06, 0.38, 0.45];
const WAVE_MID = [0.03, 0.25, 0.38];
const WAVE_LOW = [0.02, 0.13, 0.26];

for (let y = 90; y < 880; y++) {
  for (let x = 0; x < W; x++) {
    if (!insidePoly(wavePoly, x, y)) continue;
    const dEdge = distToLine(wavePoly, x, y);
    const edge = smooth(0, 2, dEdge);
    const t = clamp((y - 110) / 740, 0, 1);
    let c = t < 0.5 ? mix3(WAVE_TOP, WAVE_MID, t * 2) : mix3(WAVE_MID, WAVE_LOW, (t - 0.5) * 2);
    // broad tonal variation so the face never reads as flat plastic
    const tone = 0.93 + 0.10 * fbm(x * 0.0035 + 3, y * 0.0035 - 6, 3);
    c = [c[0] * tone, c[1] * tone, c[2] * tone];
    // sun warmth on the upper, sun-facing shoulder
    const warm = smooth(500, 950, x) * smooth(620, 240, y);
    c = [c[0] + warm * 0.34, c[1] + warm * 0.13, c[2] + warm * 0.01];
    // flow streaks running down the face
    const streak = fbm(x * 0.006 + y * 0.0016, y * 0.028, 3);
    const sAmt = smooth(0.55, 0.82, streak) * 0.27 * smooth(780, 470, y);
    c = [c[0] + sAmt * 0.7, c[1] + sAmt * 0.95, c[2] + sAmt];
    // broken foam patches washing down the upper face (face only, never the back)
    const patch = fbm(x * 0.011 - 8, y * 0.02 + 5, 3);
    const pAmt = smooth(0.62, 0.9, patch) * 0.20 * smooth(700, 380, y) * smooth(280, 380, y) * smooth(320, 430, x);
    c = [c[0] + pAmt * 0.85, c[1] + pAmt * 0.95, c[2] + pAmt];
    // shadow in the throat, just outside the barrel lip
    const dPocket = distToLine(pocketPoly, x, y);
    const throat = smooth(110, 12, dPocket) * 0.45;
    c = [c[0] * (1 - throat), c[1] * (1 - throat * 0.9), c[2] * (1 - throat * 0.7)];
    // starlight bounce on the underside, just outside the pocket edge
    const bounce = smooth(46, 6, dPocket) * smooth(700, 430, x) * 0.30;
    c = [c[0] + bounce * 0.25, c[1] + bounce * 0.6, c[2] + bounce * 0.75];
    blendPx(x, y, c, edge);
  }
}

// Bright sunlit rim along the crest: a continuous stroked glow, not dots.
for (let i = 0; i < crestLine.length - 1; i++) {
  const a = crestLine[i], b = crestLine[i + 1];
  capsule(a[0], a[1] - 2, b[0], b[1] - 2, 2.6, [1.0, 0.62, 0.26], 0.15);
}
for (let i = 0; i < crestLine.length; i += 14) {
  const p = crestLine[i];
  splat(p[0], p[1] - 3, 11, [1.0, 0.6, 0.24], 0.10);
}

// Foam along the lip underside: a bright broken line with short drips.
for (let k = 0; k < 380; k++) {
  const p = lipLine[Math.floor(rng() * lipLine.length)];
  const jx = p[0] + (rng() * 2 - 1) * 7, jy = p[1] + (rng() * 2 - 1) * 7;
  splat(jx, jy, 1.5 + rng() * 3.2, [0.95, 0.99, 1.0], 0.16 + rng() * 0.3);
}
// Short drips hanging only from the underside of the lip, angled with the flow.
for (let k = 0; k < 9; k++) {
  const p = underLine[Math.floor(rng() * underLine.length)];
  const len = 10 + rng() * 22;
  capsule(p[0], p[1] + 2, p[0] - 4 + rng() * 3, p[1] + 2 + len, 2.0, [0.92, 0.97, 1.0], 0.30);
}

// Whitewater at the base, anchored to the toe line where face meets sea:
// dense soft blobs hugging the line, thinning as they wash forward.
const toeLine = wavePoly.slice(LIP_IDX + 80, LIP_IDX + 121);
for (let k = 0; k < 1250; k++) {
  const p = toeLine[Math.floor(rng() * toeLine.length)];
  const bx = p[0] + (rng() * 2 - 1) * 26;
  const by = p[1] + 6 + Math.pow(rng(), 2.2) * 52;
  if (fbm(bx * 0.02, by * 0.05, 3) < 0.46) continue; // broken, never a solid sheet
  const fade = clamp(1 - (by - p[1]) / 64, 0.1, 1);
  splat(bx, by, 3 + rng() * 10, [0.93, 0.97, 1.0], (0.05 + rng() * 0.13) * fade);
}
// Foam streaks washing forward over the water.
for (let k = 0; k < 150; k++) {
  const fx = 60 + rng() * 880, fy = 806 + rng() * 120;
  const len = 14 + rng() * 46;
  capsule(fx, fy, fx + len, fy + (rng() * 2 - 1) * 3, 1.6, [0.9, 0.95, 1.0], 0.08 + rng() * 0.13);
}

// ---------------------------------------------------------------------------
// Spray off the lip — droplets in the sunset, stars in the dark
// ---------------------------------------------------------------------------

const sprayLine = wavePoly.slice(LIP_IDX - 6, LIP_IDX + 46);
for (let k = 0; k < 240; k++) {
  const p = sprayLine[Math.floor(rng() * sprayLine.length)];
  const out = 6 + Math.pow(rng(), 1.7) * 95;
  const ang = -Math.PI * (0.55 + rng() * 0.75); // up and to the left, off the lip
  const x = p[0] + Math.cos(ang) * out + (rng() * 2 - 1) * 5;
  const y = p[1] + Math.sin(ang) * out * 0.8 + (rng() * 2 - 1) * 5;
  const inDark = insidePoly(pocketClosed, x, y);
  if (inDark) {
    const tint = starTints[Math.floor(rng() * starTints.length)];
    splat(x, y, 1.4 + rng() * 2.0, tint, 0.35 + rng() * 0.55);
  } else {
    splat(x, y, 1.3 + rng() * 2.4, [1.0, 0.9, 0.75], 0.20 + rng() * 0.4);
  }
}

// A brighter burst right at the lip tip, where the wave throws hardest:
// droplets fan out into the sunset, the furthest ones already stars.
for (let k = 0; k < 46; k++) {
  const out = 10 + Math.pow(rng(), 1.5) * 130;
  const ang = -Math.PI * (0.35 + rng() * 0.85);
  const x = 724 + Math.cos(ang) * out + (rng() * 2 - 1) * 6;
  const y = 464 + Math.sin(ang) * out * 0.85 + (rng() * 2 - 1) * 6;
  if (insidePoly(pocketClosed, x, y)) {
    const tint = starTints[Math.floor(rng() * starTints.length)];
    splat(x, y, 1.8 + rng() * 2.4, tint, 0.45 + rng() * 0.5);
  } else {
    splat(x, y, 1.7 + rng() * 2.8, [1.0, 0.92, 0.78], 0.30 + rng() * 0.45);
  }
}

// ---------------------------------------------------------------------------
// The surfer, riding the seam at the barrel's lower-left edge
// ---------------------------------------------------------------------------
// Local skeleton (unit space), facing down-left in a deep crouch: front arm
// reaching toward the face, back arm trailing high, hips low over the board.
// Transformed by scale + a slight lean rotation around the board centre.
const S = {
  boardA: [-66, 17], boardB: [70, -21],
  backFoot: [27, -11], frontFoot: [-26, 5],
  backKnee: [42, -38], frontKnee: [-36, -30],
  hip: [0, -60], shoulder: [-18, -98], head: [-26, -116],
  frontHand: [-62, -62], backHand: [48, -92],
};
const SC = [436, 656];
const S_SCALE = 0.68, S_ROT = -0.12;
const S_COS = Math.cos(S_ROT), S_SIN = Math.sin(S_ROT);
function sp(p) {
  const x = p[0] * S_SCALE, y = p[1] * S_SCALE;
  return [SC[0] + x * S_COS - y * S_SIN, SC[1] + x * S_SIN + y * S_COS];
}

const RIM = [0.45, 0.92, 1.0];
const BODY = [0.016, 0.022, 0.05];
function drawSurfer(off, color, alpha) {
  const o = (p) => { const q = sp(p); return [q[0] + off[0], q[1] + off[1]]; };
  let a, b;
  a = o(S.boardA); b = o(S.boardB);
  capsule(a[0], a[1], b[0], b[1], 5.5, color, alpha);
  // legs: foot -> knee -> hip
  a = o(S.backFoot); b = o(S.backKnee); capsule(a[0], a[1], b[0], b[1], 7, color, alpha);
  a = o(S.backKnee); b = o(S.hip); capsule(a[0], a[1], b[0], b[1], 7.5, color, alpha);
  a = o(S.frontFoot); b = o(S.frontKnee); capsule(a[0], a[1], b[0], b[1], 7, color, alpha);
  a = o(S.frontKnee); b = o(S.hip); capsule(a[0], a[1], b[0], b[1], 7.5, color, alpha);
  // torso and arms
  a = o(S.hip); b = o(S.shoulder); capsule(a[0], a[1], b[0], b[1], 9.5, color, alpha);
  a = o(S.shoulder); b = o(S.frontHand); capsule(a[0], a[1], b[0], b[1], 6, color, alpha);
  a = o(S.shoulder); b = o(S.backHand); capsule(a[0], a[1], b[0], b[1], 6, color, alpha);
  const h = o(S.head);
  disc(h[0], h[1], 10, 1.5, color, alpha);
}
// cyan rim light first (starlight from the barrel, up-left), then the body.
drawSurfer([-3, -3.5], RIM, 0.85);
drawSurfer([0, 0], BODY, 1);
// a bright edge along the board's top
{
  const a = sp(S.boardA), b = sp(S.boardB);
  capsule(a[0], a[1] - 4.5, b[0], b[1] - 4.5, 1.4, RIM, 0.8);
}
// splash bursting at the board, and a wake trailing up the face behind it
for (let k = 0; k < 110; k++) {
  const bx = SC[0] + (rng() * 2 - 1) * 52;
  const by = SC[1] + 10 + rng() * 18;
  splat(bx, by, 1.4 + rng() * 3.6, [0.94, 0.98, 1.0], 0.16 + rng() * 0.32);
}
for (let k = 0; k < 14; k++) {
  const t = k / 14;
  const wx = SC[0] + 30 + t * 90, wy = SC[1] + 6 - t * 26;
  splat(wx, wy, 2 + rng() * 4, [0.92, 0.97, 1.0], 0.13 * (1 - t) + 0.03);
}

// ---------------------------------------------------------------------------
// Finish: vignette + deterministic dither, then encode
// ---------------------------------------------------------------------------

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2);
    const d2 = dx * dx + dy * dy;
    const vig = 1 - 0.16 * smooth(0.55, 1.45, d2);
    const i = (y * W + x) * 3;
    buf[i] *= vig; buf[i + 1] *= vig; buf[i + 2] *= vig;
  }
}

// Minimal PNG encoder: 8-bit RGB, adaptive per-row filters, zlib deflate.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let n = 0; n < bytes.length; n++) {
    crc ^= bytes[n];
    for (let k = 0; k < 8; k++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  const crcData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  out.writeUInt32BE(crc32(crcData), 8 + data.length);
  return out;
}

function encodePNG() {
  const raw = Buffer.alloc(H * (1 + W * 3));
  const prev = new Uint8Array(W * 3);
  const cur = new Uint8Array(W * 3);
  let pos = 0;
  const dith = mulberry32(0xd17e);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const dn = (dith() - 0.5) * (1.6 / 255);
      cur[x * 3] = clamp(Math.round((buf[i] + dn) * 255), 0, 255);
      cur[x * 3 + 1] = clamp(Math.round((buf[i + 1] + dn) * 255), 0, 255);
      cur[x * 3 + 2] = clamp(Math.round((buf[i + 2] + dn) * 255), 0, 255);
    }
    // choose the filter with the smallest signed-byte score
    let bestType = 0, bestData = null, bestScore = Infinity;
    for (let f = 0; f <= 4; f++) {
      const fd = new Uint8Array(W * 3);
      let score = 0;
      for (let n = 0; n < W * 3; n++) {
        const a = n >= 3 ? cur[n - 3] : 0;
        const b = prev[n];
        const c = n >= 3 ? prev[n - 3] : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 3) pred = (a + b) >> 1;
        else if (f === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const v = (cur[n] - pred) & 0xff;
        fd[n] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) { bestScore = score; bestType = f; bestData = fd; }
    }
    raw[pos++] = bestType;
    raw.set(bestData, pos);
    pos += W * 3;
    prev.set(cur);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
mkdirSync(outDir, { recursive: true });
const png = encodePNG();
writeFileSync(join(outDir, "entry.png"), png);
console.log(`wrote ${join(outDir, "entry.png")} (${png.length} bytes)`);
