/**
 * Traces the outline of an image's opaque area, so a flat logo PNG can be extruded into a
 * real 3D shape. Every separate island gets its own outline, and transparent gaps enclosed by
 * an island (e.g. between two lines of lettering) become real holes, so a rotated sign never
 * shows a slab of empty, black texture there. Outlines are simplified with Douglas–Peucker.
 */

type Pt = [number, number];

export interface SilhouetteShape {
  /** Outer outline in pixel coordinates of the traced (downscaled) image, y pointing down. */
  outer: Pt[];
  /** Enclosed transparent gaps inside this island. */
  holes: Pt[][];
}

export interface Silhouette {
  shapes: SilhouetteShape[];
  width: number;
  height: number;
}

export function traceSilhouette(img: HTMLImageElement, targetWidth = 520): Silhouette {
  const scale = targetWidth / img.naturalWidth;
  const w = Math.round(img.naturalWidth * scale) + 2; // 1px empty border all round
  const h = Math.round(img.naturalHeight * scale) + 2;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 1, 1, w - 2, h - 2);
  const { data } = ctx.getImageData(0, 0, w, h);

  // 1 = opaque. Then flood the outside from the border: anything not reached is "inside".
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = data[i * 4 + 3]! > 110 ? 1 : 0;
  const outside = new Uint8Array(w * h);
  const stack: number[] = [0];
  outside[0] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!outside[j] && !solid[j]) {
        outside[j] = 1;
        stack.push(j);
      }
    }
  }
  // Islands of solid pixels (8-connected).
  const island = new Int32Array(w * h);
  const shapes = new Map<number, SilhouetteShape>();
  let next = 1;
  const minArea = w * h * 0.002;
  for (let start = 0; start < w * h; start++) {
    if (!solid[start] || island[start]) continue;
    const area = fill(island, start, next, w, h, (j) => solid[j] === 1, true);
    if (area >= minArea) {
      const sx = start % w;
      const raw = traceBoundary(island, next, w, h, sx, (start - sx) / w);
      if (raw.length > 8) shapes.set(next, { outer: simplify(raw, 0.75), holes: [] });
    }
    next++;
  }

  // Holes: transparent regions the outside flood never reached (4-connected).
  const hole = new Int32Array(w * h);
  const minHole = Math.max(12, w * h * 0.00004);
  let hid = 1;
  for (let start = 0; start < w * h; start++) {
    if (solid[start] || outside[start] || hole[start]) continue;
    const area = fill(hole, start, hid, w, h, (j) => !solid[j] && !outside[j], false);
    // The pixel left of a hole's first (raster-order) pixel is the island that encloses it.
    const owner = shapes.get(island[start - 1] ?? 0);
    if (owner && area >= minHole) {
      const sx = start % w;
      const raw = traceBoundary(hole, hid, w, h, sx, (start - sx) / w);
      if (raw.length > 4) owner.holes.push(simplify(raw, 0.6));
    }
    hid++;
  }
  return { shapes: [...shapes.values()], width: w, height: h };
}

/** Flood-fill one region with `id`; returns its pixel count. */
function fill(
  label: Int32Array,
  start: number,
  id: number,
  w: number,
  h: number,
  inside: (j: number) => boolean,
  eight: boolean,
): number {
  let area = 0;
  const q = [start];
  label[start] = id;
  while (q.length) {
    const i = q.pop()!;
    area++;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx === 0 && dy === 0) || (!eight && dx !== 0 && dy !== 0)) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!label[j] && inside(j)) {
          label[j] = id;
          q.push(j);
        }
      }
  }
  return area;
}

/** Moore-neighbour boundary tracing with Jacob's stopping criterion. */
function traceBoundary(
  label: Int32Array,
  id: number,
  w: number,
  h: number,
  sx: number,
  sy: number,
): [number, number][] {
  const N8 = [
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
  ] as const;
  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && label[y * w + x] === id;
  let cx = sx;
  let cy = sy;
  let back = 0; // we "entered" from the west: the start is the first pixel in raster order
  const startBack = back;
  const pts: [number, number][] = [[cx, cy]];
  for (let guard = 0; guard < w * h * 2; guard++) {
    let moved = false;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      const nx = cx + N8[d]![0];
      const ny = cy + N8[d]![1];
      if (inside(nx, ny)) {
        const pd = (back + k - 1) % 8;
        const bx = cx + N8[pd]![0];
        const by = cy + N8[pd]![1];
        cx = nx;
        cy = ny;
        back = N8.findIndex(([dx, dy]) => cx + dx === bx && cy + dy === by);
        moved = true;
        break;
      }
    }
    if (!moved || back < 0) break;
    if (cx === sx && cy === sy && back === startBack) break;
    pts.push([cx, cy]);
  }
  return pts;
}

function simplify(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a]!;
    const [bx, by] = pts[b]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let max = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]!;
      const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (max > eps && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
