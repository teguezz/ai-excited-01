// ai-excited-01 entry: "THE BARREL AT THE END OF THE DAY"
//
// A program that draws one image and writes it to /output/entry.png.
// The scene: a giant ocean wave curling at sunset — but inside the dark
// barrel of the wave there is no shadow. There is a night sky: stars, a
// crescent moon, a band of Milky Way. A lone surfer rides the exact seam
// between the sunset and the cosmos while the spray off the lip turns
// into stars. Day and night, caught in the same breaking second.
//
// Pure Node 22 standard library. The renderer is a small software
// rasteriser over a float pixel buffer, supersampled 2x and box-filtered
// down to 1024x1024, then written as a PNG with per-row filter choice.
// All randomness comes from a seeded PRNG, so every run produces the
// identical file, byte for byte.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------- PRNG
// mulberry32: tiny deterministic PRNG. One stream for the whole picture.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261116);
const rr = (lo, hi) => lo + rand() * (hi - lo);

// ---------------------------------------------------------------- canvas
const OUT = 1024;          // final image size
const SS = 2;              // supersampling factor
const W = OUT * SS;        // working size (2048)
const H = W;
const buf = new Float32Array(W * H * 3); // r,g,b in 0..255

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const lerp = (a, b, t) => a + (b - a) * t;
function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// alpha-blend one pixel (working resolution coordinates)
function px(x, y, c, alpha) {
  if (x < 0 || y < 0 || x >= W || y >= H || alpha <= 0) return;
  const i = (y * W + x) * 3;
  const a = alpha > 1 ? 1 : alpha;
  buf[i] = buf[i] * (1 - a) + c[0] * a;
  buf[i + 1] = buf[i + 1] * (1 - a) + c[1] * a;
  buf[i + 2] = buf[i + 2] * (1 - a) + c[2] * a;
}
// additive glow blend
function pxAdd(x, y, c, alpha) {
  if (x < 0 || y < 0 || x >= W || y >= H || alpha <= 0) return;
  const i = (y * W + x) * 3;
  buf[i] += c[0] * alpha;
  buf[i + 1] += c[1] * alpha;
  buf[i + 2] += c[2] * alpha;
}

// filled circle with a feathered rim; shade(d) may modulate colour by
// normalised distance from centre. mode 'add' for glows.
function disc(cx, cy, r, color, alpha, feather = 0.06, mode = 'over') {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
  const blend = mode === 'add' ? pxAdd : px;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d > 1) continue;
      const edge = 1 - smoothstep(1 - feather, 1, d);
      blend(x, y, color, alpha * edge);
    }
  }
}

// soft radial glow: alpha falls off quadratically
function glow(cx, cy, r, color, alpha) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d > 1) continue;
      const f = (1 - d) * (1 - d);
      pxAdd(x, y, color, alpha * f);
    }
  }
}

// thick line segment with round caps (a capsule), drawn as stacked discs
function capsule(x1, y1, x2, y2, wdt, color, alpha) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil(len / (wdt * 0.35)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(lerp(x1, x2, t), lerp(y1, y2, t), wdt / 2, color, alpha, 0.35);
  }
}
function polyline(pts, wdt, color, alpha) {
  for (let i = 0; i + 1 < pts.length; i++) {
    capsule(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], wdt, color, alpha);
  }
}

// scanline polygon fill; shader(x, y) returns [r,g,b,alpha] or null
function fillPoly(pts, shader) {
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(H - 1, Math.ceil(maxY));
  const n = pts.length;
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    const xs = [];
    for (let i = 0; i < n; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {
        xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.floor(xs[k])), xb = Math.min(W - 1, Math.ceil(xs[k + 1]));
      for (let x = xa; x <= xb; x++) {
        const c = shader(x, y);
        if (c) px(x, y, c, c[3]);
      }
    }
  }
}
const flat = (c, a) => () => [c[0], c[1], c[2], a];

// rotated ellipse as a sampled polygon
function ellipsePoly(cx, cy, rx, ry, rot) {
  const pts = [];
  const cosr = Math.cos(rot), sinr = Math.sin(rot);
  for (let i = 0; i < 44; i++) {
    const t = (i / 44) * Math.PI * 2;
    const ex = Math.cos(t) * rx, ey = Math.sin(t) * ry;
    pts.push([cx + ex * cosr - ey * sinr, cy + ex * sinr + ey * cosr]);
  }
  return pts;
}

// ---------------------------------------------------------------- scene
// Layout in final-image units (1024), scaled by SS when drawing.
const S = SS;
const HY = 630 * S;                    // horizon line
const SUN = { x: 302 * S, y: HY, r: 128 * S };
const BC = { x: 615 * S, y: 505 * S }; // barrel centre
const RB = 205 * S;                    // barrel radius

const INK = [16, 19, 31];              // silhouette near-black blue

// ---- sky: indigo zenith melting through magenta into sunset orange
{
  const stops = [
    [0.00, [24, 16, 64]], [0.30, [58, 24, 96]], [0.52, [124, 42, 110]],
    [0.68, [196, 62, 92]], [0.86, [244, 110, 54]], [1.00, [255, 158, 60]],
  ];
  const sky = [[0, 0], [W, 0], [W, HY], [0, HY]];
  fillPoly(sky, (x, y) => {
    const t = y / HY;
    let c = stops[stops.length - 1][1];
    for (let i = 0; i + 1 < stops.length; i++) {
      if (t >= stops[i][0] && t <= stops[i + 1][0]) {
        c = mix(stops[i][1], stops[i + 1][1], (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0]));
        break;
      }
    }
    return [c[0], c[1], c[2], 1];
  });
  // faint early stars high in the sky
  for (let i = 0; i < 150; i++) {
    const x = rand() * W, y = rand() * HY * 0.55;
    disc(x, y, rr(0.8, 1.9) * S, [220, 230, 255], rr(0.10, 0.42) * (1 - y / HY), 0.5);
  }
  // clouds: low soft banks lit from below
  const cloudCols = [[150, 60, 140], [255, 130, 90]];
  for (let i = 0; i < 7; i++) {
    const cx = rr(0.03, 0.97) * W, cy = rr(0.16, 0.55) * HY, len = rr(120, 300) * S;
    for (let j = 0; j < 12; j++) {
      const px2 = cx + rr(-0.5, 0.5) * len, py2 = cy + rr(-7, 7) * S;
      disc(px2, py2, rr(14, 42) * S, mix(cloudCols[0], cloudCols[1], cy / HY), 0.055, 0.9);
    }
  }
}

// ---- sun: halo, disc, and a bright seam on the horizon
glow(SUN.x, SUN.y, SUN.r * 3.1, [255, 140, 50], 0.50);
glow(SUN.x, SUN.y, SUN.r * 1.7, [255, 180, 80], 0.55);
disc(SUN.x, SUN.y, SUN.r, [255, 196, 96], 1, 0.012);
disc(SUN.x, SUN.y, SUN.r * 0.82, [255, 226, 150], 1, 0.02);

// ---- sea: deep teal falling to near-black, with the sun's reflection
{
  const sea = [[0, HY], [W, HY], [W, H], [0, H]];
  fillPoly(sea, (x, y) => {
    const t = (y - HY) / (H - HY);
    const c = mix([16, 92, 104], [3, 18, 34], Math.pow(t, 0.7));
    return [c[0], c[1], c[2], 1];
  });
  // the wave's curved face edge, in final-image units: x at a given y
  const faceXAt = (yu) => 345 + (470 - 345) * Math.pow(Math.min(1, Math.max(0, (yu - 630) / 394)), 1.2);
  glow(SUN.x, HY + 120 * S, 190 * S, [255, 140, 50], 0.16); // warm sheen on the water
  for (let i = 0; i < 170; i++) {
    const y = HY + 10 * S + Math.pow(rand(), 1.35) * (H - HY - 26 * S);
    const spread = 12 * S + (y - HY) * 0.17;
    const cx = SUN.x + rr(-1, 1) * spread;
    const len = rr(10, 66) * S * (0.35 + (y - HY) / (H - HY));
    if ((cx + len / 2) / S > faceXAt(y / S) - 10) continue;
    capsule(cx - len / 2, y, cx + len / 2, y, rr(2.2, 3.8) * S,
      mix([255, 190, 100], [255, 130, 46], rand()), rr(0.16, 0.50));
  }
  // a bright seam where sky meets sea, left of the wave
  capsule(0, HY, (faceXAt(630) - 6) * S, HY, 2.6 * S, [255, 214, 140], 0.5);
}

// ---- the wave mass: a wall of water rearing up on the right
{
  const P = (x, y) => [x * S, y * S];
  const mass = [
    P(352, 438), P(430, 300), P(545, 200), P(700, 148), P(860, 148),
    P(1024, 205), P(1024, 1024), P(470, 1024),
    P(430, 880), P(408, 760), P(392, 640), P(372, 540),
  ];
  fillPoly(mass, (x, y) => {
    const t = y / H;
    let c = mix([24, 168, 178], [6, 62, 96], smoothstep(0.10, 0.95, t));
    const d = Math.hypot(x - BC.x, y - BC.y) / RB;
    if (d < 1.9) c = mix(c, [10, 96, 128], (1.9 - d) / 1.9 * 0.45); // darker toward the throat
    const br = (x / W) * (y / H);                                  // sink the far bottom corner
    c = mix(c, [2, 26, 48], br * 0.55);
    return [c[0], c[1], c[2], 1];
  });
  // water streaming down the face: faint curved flow lines on the slope
  for (let i = 0; i < 16; i++) {
    const fx = rr(440, 900), fy = rr(215, 480);
    const pts = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      pts.push([(fx - 84 * t + 20 * t * t) * S, (fy + 205 * t) * S]);
    }
    polyline(pts, rr(3, 7) * S, [180, 244, 238], rr(0.03, 0.06));
  }
  // darker folds low on the face
  for (let i = 0; i < 12; i++) {
    const fx = rr(480, 980), fy = rr(560, 760);
    capsule(fx * S, fy * S, (fx - rr(40, 90)) * S, (fy + rr(120, 200)) * S, rr(8, 18) * S, [4, 48, 78], 0.10);
  }
}

// ---- the curl: a spiral tube of water wrapping the barrel
function spiralPoint(theta, rad) {
  return [BC.x + Math.cos(theta) * rad, BC.y + Math.sin(theta) * rad];
}
{
  const N = 90, tube = [];
  const th0 = -0.45, th1 = -3.95;               // sweep: top-right -> top -> left -> bottom-left
  const radAt = (t) => RB * lerp(1.84, 1.00, Math.pow(t, 0.85));
  const widAt = (t) => S * lerp(150, 58, t);
  const outer = [], inner = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, th = lerp(th0, th1, t), r = radAt(t), w2 = widAt(t) / 2;
    outer.push(spiralPoint(th, r + w2));
    inner.push(spiralPoint(th, r - w2));
  }
  const poly = outer.concat(inner.reverse());
  fillPoly(poly, (x, y) => {
    const d = Math.hypot(x - BC.x, y - BC.y) / RB;
    let c = mix([10, 84, 116], [64, 205, 205], smoothstep(0.95, 1.95, d));
    if (y > BC.y + RB * 0.25 && d < 1.45) c = mix(c, [4, 40, 66], 0.5); // shadowed underside
    if (y < BC.y - RB * 0.9) c = mix(c, [150, 235, 225], 0.28);          // sunset catching the crest
    return [c[0], c[1], c[2], 1];
  });
  // throat shadow: a darker spiral hugging the barrel's upper rim
  const inner2 = [], outer2 = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, th = lerp(th0, th1, t);
    outer2.push(spiralPoint(th, RB * lerp(1.30, 1.02, t)));
    inner2.push(spiralPoint(th, RB * lerp(1.16, 0.99, t)));
  }
  fillPoly(outer2.concat(inner2.reverse()), (x, y) => {
    const d = Math.hypot(x - BC.x, y - BC.y) / RB;
    return [3, 30, 52, 0.38 * smoothstep(1.35, 1.0, d)];
  });
  // fold lines spiralling with the curl, riding its own radius curve so
  // they never leave the tube, and sunset light along its outer crest
  const radAt2 = (t) => RB * lerp(1.84, 1.00, Math.pow(t, 0.85));
  const widAt2 = (t) => S * lerp(150, 58, t);
  for (const [off, al, wd, col] of [[-0.45, 0.13, 5, [6, 70, 104]], [0.05, 0.12, 4, [8, 84, 120]], [0.5, 0.10, 3.4, [10, 100, 140]]]) {
    const pts = [];
    for (let i = 0; i <= 44; i++) {
      const t = lerp(0.04, 0.97, i / 44);
      pts.push(spiralPoint(lerp(th0, th1, t), radAt2(t) + (widAt2(t) / 2) * off));
    }
    polyline(pts, wd * S, col, al);
  }
  const crest = [];
  for (let i = 0; i <= 30; i++) {
    const t = lerp(0.0, 0.55, i / 30);
    crest.push(spiralPoint(lerp(th0, th1, t), radAt2(t) + widAt2(t) / 2));
  }
  polyline(crest, 4.5 * S, [255, 224, 170], 0.30);
}

// ---- inside the barrel: not shadow — a whole night sky
{
  const circ = [];
  for (let i = 0; i < 72; i++) {
    const t = (i / 72) * Math.PI * 2;
    circ.push([BC.x + Math.cos(t) * RB * 0.985, BC.y + Math.sin(t) * RB * 0.985]);
  }
  fillPoly(circ, (x, y) => {
    const t = (y - (BC.y - RB)) / (2 * RB);
    let c = mix([13, 18, 52], [3, 5, 20], t);
    const d = Math.hypot(x - BC.x, y - BC.y) / RB;
    if (d > 0.82) { const k = 1 - 0.35 * smoothstep(0.82, 1.0, d); c = [c[0] * k, c[1] * k, c[2] * k]; }
    return [c[0], c[1], c[2], 1];
  });
  // nebula wisps
  const nebs = [[-0.30, -0.42, 0.46, [110, 70, 200]], [0.34, 0.30, 0.40, [30, 180, 190]],
                [-0.42, 0.38, 0.34, [200, 60, 140]], [0.44, -0.36, 0.30, [70, 90, 220]]];
  for (const [ox, oy, orad, col] of nebs) {
    glow(BC.x + ox * RB, BC.y + oy * RB, orad * RB, col, 0.16);
  }
  // the Milky Way: a soft diagonal river of faint stars
  const bandA = -0.62, bdx = Math.cos(bandA), bdy = Math.sin(bandA);
  for (let i = 0; i < 800; i++) {
    const t = rr(-0.85, 0.85) * RB;
    const off = ((rand() + rand() + rand()) / 3 - 0.5) * 0.42 * RB;
    const x = BC.x + bdx * t - bdy * off, y = BC.y + bdy * t + bdx * off;
    if (Math.hypot(x - BC.x, y - BC.y) > RB * 0.95) continue;
    disc(x, y, rr(0.6, 1.7) * S, mix([190, 215, 255], [255, 240, 210], rand()), rr(0.05, 0.30), 0.6);
  }
  // stars, a few of them bright enough to sparkle
  for (let i = 0; i < 430; i++) {
    const a = rand() * Math.PI * 2, rad = Math.sqrt(rand()) * RB * 0.95;
    const x = BC.x + Math.cos(a) * rad, y = BC.y + Math.sin(a) * rad;
    const b = Math.pow(rand(), 2.2);
    disc(x, y, (0.7 + b * 2.1) * S, mix([170, 195, 255], [255, 255, 255], b), 0.25 + 0.75 * b, 0.5);
    if (b > 0.90) {
      const L = rr(6, 11) * S;
      capsule(x - L, y, x + L, y, 1.6 * S, [230, 240, 255], 0.5);
      capsule(x, y - L, x, y + L, 1.6 * S, [230, 240, 255], 0.5);
    }
  }
  // crescent moon, upper left of the barrel
  const mx = BC.x - 92 * S, my = BC.y - 100 * S;
  glow(mx, my, 62 * S, [255, 214, 130], 0.35);
  disc(mx, my, 29 * S, [255, 220, 150], 1, 0.03);
  disc(mx + 13 * S, my - 8 * S, 25 * S, [10, 15, 44], 1, 0.03);
  // one shooting star
  capsule(BC.x + 30 * S, BC.y - 128 * S, BC.x + 118 * S, BC.y - 92 * S, 2.4 * S, [240, 248, 255], 0.75);
  disc(BC.x + 118 * S, BC.y - 92 * S, 3.4 * S, [255, 255, 255], 0.9, 0.5);
  // rim light where the two worlds meet
  const rim = [];
  for (let i = 0; i <= 40; i++) {
    const th = lerp(-2.65, -0.45, i / 40);
    rim.push(spiralPoint(th, RB * 0.99));
  }
  polyline(rim, 5 * S, [255, 217, 160], 0.55);
  const rim2 = [];
  for (let i = 0; i <= 30; i++) {
    const th = lerp(0.55, 2.35, i / 30);
    rim2.push(spiralPoint(th, RB * 0.99));
  }
  polyline(rim2, 4 * S, [87, 230, 255], 0.30);
}

// ---- foam: the lip is exploding into spray
{
  const lip = [];
  for (let i = 0; i <= 44; i++) {
    const th = lerp(-2.95, -1.10, i / 44);
    lip.push(spiralPoint(th, RB * 1.03));
  }
  polyline(lip, 13 * S, [245, 252, 250], 0.85);
  polyline(lip, 6 * S, [255, 255, 255], 0.9);
  for (let i = 0; i < 300; i++) {
    const th = rr(-3.05, -0.95);
    const rad = RB * rr(0.96, 1.14);
    const [x, y] = spiralPoint(th, rad);
    disc(x + rr(-4, 4) * S, y + rr(-4, 4) * S, rr(1.4, 5.2) * S, [248, 253, 250], rr(0.3, 0.95), 0.5);
  }
  // drips falling off the lip into the barrel light
  for (let i = 0; i < 26; i++) {
    const th = rr(-2.8, -1.3);
    const [x, y] = spiralPoint(th, RB * 1.0);
    capsule(x, y, x + rr(-3, 3) * S, y + rr(6, 17) * S, rr(1.6, 3) * S, [235, 250, 248], rr(0.25, 0.55));
  }
}

// ---- the surfer: a dark silhouette riding the seam of the two worlds
{
  const cx = 446 * S, cy = 706 * S, rot = -0.38;
  const cosr = Math.cos(rot), sinr = Math.sin(rot);
  const T = (lx, ly) => [cx + (lx * cosr - ly * sinr) * S, cy + (lx * sinr + ly * cosr) * S];
  const figure = (offx, offy, color, alpha) => {
    const t2 = (lx, ly) => { const [x, y] = T(lx, ly); return [x + offx, y + offy]; };
    const seg = (a, b, w) => { const [x1, y1] = t2(a[0], a[1]); const [x2, y2] = t2(b[0], b[1]); capsule(x1, y1, x2, y2, w * S, color, alpha); };
    // board
    const bp = ellipsePoly(0, 0, 97, 12, 0).map(([lx, ly]) => t2(lx, ly));
    fillPoly(bp, flat(color, alpha));
    // legs: back leg straight, front leg bent, both low and driving
    seg([2, -26], [30, -5], 9.5);
    seg([0, -27], [-17, -16], 9.5); seg([-17, -16], [-31, -4], 8.5);
    // torso leaning into the turn
    seg([0, -27], [-5, -55], 13.5);
    // arms: one trailing for balance, one reaching toward the barrel
    seg([-5, -52], [-31, -40], 7.5);
    seg([-4, -53], [24, -45], 7.5);
    // head
    const [hx, hy2] = t2(-7, -66);
    disc(hx, hy2, 9.5 * S, color, alpha, 0.25);
  };
  figure(-2.5 * S, -2.5 * S, [190, 240, 255], 0.8); // cyan rim light
  figure(0, 0, INK, 1);
  // the board's wake: a bright slash of foam under the rail, bursting at the tail
  const [wx1, wy1] = T(-104, 9), [wx2, wy2] = T(34, 13);
  capsule(wx1, wy1, wx2, wy2, 5.5 * S, [240, 252, 250], 0.6);
  for (let i = 0; i < 46; i++) {
    const [bx2, by2] = T(rr(-118, -60), rr(2, 16));
    disc(bx2 + rr(-7, 7) * S, by2 + rr(-9, 3) * S, rr(1.4, 4.6) * S, [246, 252, 250], rr(0.35, 0.9), 0.5);
  }
}

// ---- spray off the lip, turning into stars as it flies
{
  for (let i = 0; i < 300; i++) {
    const [ox, oy] = spiralPoint(rr(-2.9, -1.6), RB * rr(1.02, 1.10));
    const t = Math.pow(rand(), 1.6);
    const x = ox + rr(-14, 6) * S - t * rr(50, 185) * S;
    const y = oy + rr(-10, 10) * S - t * rr(24, 105) * S + t * t * 55 * S;
    if (Math.hypot(x - BC.x, y - BC.y) < RB * 0.9) continue;
    const c = mix([250, 253, 250], [255, 205, 110], t);
    disc(x, y, rr(0.9, 3.8) * S * (1 - t * 0.4), c, (1 - t * 0.55) * rr(0.4, 0.95), 0.5);
  }
  // a handful of the spray drops catch the light and become stars:
  // small four-point stars, each tipped at its own angle, hugging the foam
  for (let i = 0; i < 5; i++) {
    const [ox, oy] = spiralPoint(rr(-2.75, -1.75), RB * rr(1.05, 1.15));
    const x = ox + rr(-16, 16) * S, y = oy + rr(-14, 10) * S;
    if (Math.hypot(x - BC.x, y - BC.y) < RB * 0.94) continue;
    const L = rr(4.5, 8) * S, a = rand() * Math.PI;
    const dx = Math.cos(a), dy = Math.sin(a);
    capsule(x - dx * L, y - dy * L, x + dx * L, y + dy * L, 1.5 * S, [255, 236, 180], 0.8);
    capsule(x + dy * L * 0.62, y - dx * L * 0.62, x - dy * L * 0.62, y + dx * L * 0.62, 1.5 * S, [255, 236, 180], 0.8);
    disc(x, y, 2.2 * S, [255, 246, 210], 0.95, 0.5);
  }
}

// ---- foreground water: foam streaks sliding past, and birds heading home
{
  for (let i = 0; i < 46; i++) {
    const y = rr(790, 1005) * S, x = rr(10, 400) * S, len = rr(24, 96) * S;
    capsule(x, y, x + len, y + rr(-3, 3) * S, rr(2.4, 5) * S, [214, 240, 238], rr(0.04, 0.12));
  }
  // whitewater boiling at the base of the wave
  for (let i = 0; i < 210; i++) {
    const x = rr(390, 1010) * S, y = (1024 - Math.pow(rand(), 2.1) * 64) * S;
    disc(x, y, rr(1.6, 6.4) * S, [240, 250, 248], rr(0.10, 0.5) * (1 - (1024 - y / S) / 90), 0.55);
  }
  for (let i = 0; i < 22; i++) {
    const x = rr(400, 950) * S, y = rr(972, 1012) * S, len = rr(30, 110) * S;
    capsule(x, y, x + len, y + rr(-2, 2) * S, rr(2.4, 5) * S, [238, 250, 248], rr(0.08, 0.22));
  }
  const bird = (bx, by, s2) => {
    capsule(bx - 13 * s2, by + 4 * s2, bx, by, 3.4 * S, [26, 16, 48], 0.85);
    capsule(bx, by, bx + 13 * s2, by + 4 * s2, 3.4 * S, [26, 16, 48], 0.85);
  };
  bird(150 * S, 128 * S, 1.0); bird(205 * S, 102 * S, 0.75); bird(112 * S, 168 * S, 0.6);
  bird(838 * S, 96 * S, 0.8); bird(886 * S, 128 * S, 0.62);
}

// ---------------------------------------------------------------- grade
// gentle contrast + saturation, and a vignette to hold the edges
{
  const cx = W / 2, cy = H / 2, maxD = Math.hypot(cx, cy);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      let r = buf[i], g = buf[i + 1], b = buf[i + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      r = luma + (r - luma) * 1.13;
      g = luma + (g - luma) * 1.13;
      b = luma + (b - luma) * 1.13;
      r = (r - 128) * 1.05 + 128;
      g = (g - 128) * 1.05 + 128;
      b = (b - 128) * 1.05 + 128;
      const d = Math.hypot(x - cx, y - cy) / maxD;
      const v = 1 - 0.20 * smoothstep(0.52, 1.05, d);
      buf[i] = clamp255(r * v); buf[i + 1] = clamp255(g * v); buf[i + 2] = clamp255(b * v);
    }
  }
}

// ---------------------------------------------------------------- downsample
const img = new Uint8Array(OUT * OUT * 3);
for (let y = 0; y < OUT; y++) {
  for (let x = 0; x < OUT; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < SS; dy++) {
      for (let dx = 0; dx < SS; dx++) {
        const i = ((y * SS + dy) * W + (x * SS + dx)) * 3;
        r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
      }
    }
    const o = (y * OUT + x) * 3, n = SS * SS;
    img[o] = Math.round(r / n); img[o + 1] = Math.round(g / n); img[o + 2] = Math.round(b / n);
  }
}

// ---------------------------------------------------------------- PNG encode
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
// choose, per row, the filter (None/Sub/Up/Average/Paeth) with the least
// absolute signed-byte sum — keeps gradients and smooth shading small
function encodePNG(width, height, rgb) {
  const bpp = 3, stride = width * bpp;
  const raw = new Uint8Array((stride + 1) * height);
  const filt = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const rowOff = y * stride, outOff = y * (stride + 1);
    let bestType = 0, bestScore = Infinity, bestRow = null;
    for (let type = 0; type <= 4; type++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const cur = rgb[rowOff + i];
        const a = i >= bpp ? rgb[rowOff + i - bpp] : 0;
        const b = y > 0 ? rgb[rowOff - stride + i] : 0;
        const c = y > 0 && i >= bpp ? rgb[rowOff - stride + i - bpp] : 0;
        let v;
        if (type === 0) v = cur;
        else if (type === 1) v = cur - a;
        else if (type === 2) v = cur - b;
        else if (type === 3) v = cur - ((a + b) >> 1);
        else v = cur - paeth(a, b, c);
        v &= 0xFF;
        filt[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) { bestScore = score; bestType = type; bestRow = filt.slice(); }
    }
    raw[outOff] = bestType;
    raw.set(bestRow, outOff + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const idat = deflateSync(raw, { level: 9 });
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { png.set(p, off); off += p.length; }
  return png;
}

const png = encodePNG(OUT, OUT, img);
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'entry.png');
writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${png.length} bytes)`);
