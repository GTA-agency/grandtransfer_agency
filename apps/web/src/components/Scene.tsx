import { useId, useMemo } from "react";

/**
 * Hand-built inline-SVG scenery: striped retro sun, two-layer skyline with lit windows,
 * palm silhouettes and a water line with sun reflections. All shapes are generated from a
 * seed, so a scene always draws the same.
 */

export type SceneVariant = "sunset" | "ocean" | "busted" | "night" | "gold";

const PALETTES: Record<
  SceneVariant,
  {
    sky: [string, string, string, string];
    sun: [string, string, string];
    far: string;
    near: string;
    palm: string;
    water: [string, string];
    glow: string;
    window: string;
  }
> = {
  sunset: {
    sky: ["#2b1550", "#7a2d8c", "#ff7eb3", "#ffb070"],
    sun: ["#fff1b8", "#ffb36b", "#ff4f9a"],
    far: "#6a2a7e",
    near: "#2a1347",
    palm: "#1a0b2e",
    water: ["#4a1d63", "#1c0d33"],
    glow: "#ffb070",
    window: "#ffd59a",
  },
  ocean: {
    sky: ["#0b1f3a", "#0f4f66", "#2aa39b", "#a6eac8"],
    sun: ["#f4fff0", "#b9f2d6", "#4fd1b5"],
    far: "#16566a",
    near: "#0a2a3d",
    palm: "#06192a",
    water: ["#0f4458", "#071a2a"],
    glow: "#a6eac8",
    window: "#d6fff0",
  },
  busted: {
    sky: ["#160510", "#4d0c28", "#b0213f", "#ff7a5a"],
    sun: ["#ffd2b0", "#ff7a5a", "#d11f4a"],
    far: "#5e1330",
    near: "#24060f",
    palm: "#150309",
    water: ["#3d0a1f", "#12030a"],
    glow: "#ff7a5a",
    window: "#ffb59a",
  },
  night: {
    sky: ["#090a1c", "#1d1548", "#4b2470", "#a2427f"],
    sun: ["#ffe3f0", "#ff9cc2", "#c2408c"],
    far: "#35205e",
    near: "#15102e",
    palm: "#0b0820",
    water: ["#24164a", "#0c0a1f"],
    glow: "#ff9cc2",
    window: "#ffd1e6",
  },
  gold: {
    sky: ["#1d1640", "#6b3a7d", "#f08a6a", "#ffd27a"],
    sun: ["#fffbe0", "#ffe08a", "#ff9a5a"],
    far: "#7a3f6e",
    near: "#2c1840",
    palm: "#1c0f2a",
    water: ["#5a2c5e", "#22122f"],
    glow: "#ffd27a",
    window: "#fff0b8",
  },
};

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 1200;
const H = 600;

interface Building {
  x: number;
  w: number;
  h: number;
  windows: { x: number; y: number }[];
  antenna: boolean;
}

function skyline(
  seed: number,
  horizon: number,
  minH: number,
  maxH: number,
  gapChance: number,
  windows: boolean,
) {
  const r = rng(seed);
  const out: Building[] = [];
  let x = -20;
  while (x < W + 20) {
    const w = 28 + Math.floor(r() * 70);
    if (r() < gapChance) {
      x += w * 0.6;
      continue;
    }
    const h = minH + Math.floor(r() * r() * (maxH - minH));
    const b: Building = { x, w, h, windows: [], antenna: r() < 0.18 && h > maxH * 0.5 };
    if (windows) {
      for (let wy = horizon - h + 10; wy < horizon - 8; wy += 11) {
        for (let wx = x + 6; wx < x + w - 8; wx += 9) {
          if (r() < 0.12) b.windows.push({ x: wx, y: wy });
        }
      }
    }
    out.push(b);
    x += w - 1;
  }
  return out;
}

/** A palm: tapered curved trunk + drooping fronds, as filled paths. */
function palmPaths(
  x: number,
  ground: number,
  height: number,
  lean: number,
  scale: number,
  seed: number,
) {
  const r = rng(seed);
  const top = { x: x + lean, y: ground - height };
  const c = { x: x + lean * 0.15, y: ground - height * 0.55 };
  const w0 = 13 * scale;
  const w1 = 5 * scale;
  const trunk = [
    `M ${x - w0 / 2} ${ground}`,
    `Q ${c.x - (w0 + w1) / 4} ${c.y} ${top.x - w1 / 2} ${top.y}`,
    `L ${top.x + w1 / 2} ${top.y}`,
    `Q ${c.x + (w0 + w1) / 4} ${c.y} ${x + w0 / 2} ${ground}`,
    "Z",
  ].join(" ");

  // trunk rings
  const rings: string[] = [];
  for (let i = 1; i < 14; i++) {
    const t = i / 14;
    const px = (1 - t) * (1 - t) * x + 2 * (1 - t) * t * c.x + t * t * top.x;
    const py = (1 - t) * (1 - t) * ground + 2 * (1 - t) * t * c.y + t * t * top.y;
    const hw = (w0 + (w1 - w0) * t) / 2 + 1.2;
    rings.push(`M ${px - hw} ${py} L ${px + hw} ${py - 2.5 * scale}`);
  }

  const fronds: string[] = [];
  // Fan of fronds: each is a curved, tapering blade with leaflets hanging off its lower edge.
  const angles = [-178, -158, -136, -112, -88, -64, -40, -18, 0, -146, -30];
  for (const [i, base] of angles.entries()) {
    const deg = base + (r() - 0.5) * 10;
    const a = (deg * Math.PI) / 180;
    const upright = Math.abs(deg + 90) < 30;
    const len = (upright ? 78 + r() * 18 : 120 + r() * 40) * scale * (i > 8 ? 0.82 : 1);
    const dir = { x: Math.cos(a), y: Math.sin(a) };
    const sag = (upright ? 0.15 : 0.75) * len;
    const tip = { x: top.x + dir.x * len, y: top.y + dir.y * len * 0.6 + sag };
    const ctrl = { x: top.x + dir.x * len * 0.6, y: top.y + dir.y * len * 0.6 - len * 0.12 };
    const n = { x: -dir.y, y: dir.x };
    const side = dir.x >= 0 ? 1 : -1;
    const wid = 7 * scale;
    fronds.push(
      `M ${top.x} ${top.y} Q ${ctrl.x - n.x * wid * side} ${ctrl.y - Math.abs(n.y) * wid - wid} ${tip.x} ${tip.y} Q ${ctrl.x + n.x * wid * side} ${ctrl.y + wid} ${top.x} ${top.y + 2 * scale} Z`,
    );
    const leaflets = 11;
    for (let k = 1; k <= leaflets; k++) {
      const t = k / (leaflets + 1);
      const px = (1 - t) * (1 - t) * top.x + 2 * (1 - t) * t * ctrl.x + t * t * tip.x;
      const py = (1 - t) * (1 - t) * top.y + 2 * (1 - t) * t * ctrl.y + t * t * tip.y;
      const ll = (30 - t * 20) * scale * (upright ? 0.7 : 1);
      const lean = side * (6 + t * 10) * scale;
      const w = (3.2 - t * 1.6) * scale;
      fronds.push(
        `M ${px - w * side} ${py} Q ${px + lean * 0.3} ${py + ll * 0.6} ${px + lean} ${py + ll} Q ${px + lean * 0.5} ${py + ll * 0.4} ${px + w * side * 1.4} ${py - 1} Z`,
      );
    }
  }
  const coconuts = [0, 1, 2].map((k) => ({
    cx: top.x + (k - 1) * 6 * scale,
    cy: top.y + 6 * scale + (k === 1 ? 3 * scale : 0),
    r: 4.2 * scale,
  }));
  return { trunk: fix(trunk), rings: fix(rings.join(" ")), fronds: fronds.map(fix), coconuts };
}

/**
 * Rounds path numbers to 2 decimals. Math.sin/cos can differ in the last digit between the
 * server (Node) and the browser, which made React report a hydration mismatch on the palms.
 */
function fix(path: string): string {
  return path.replace(/-?\d+\.\d+/g, (n) => String(Math.round(Number(n) * 100) / 100));
}

export interface SceneProps {
  variant?: SceneVariant;
  seed?: number;
  /** Sun center, 0..1 across the width. */
  sunX?: number;
  sunSize?: number;
  palms?: "both" | "left" | "right" | "none";
  skyline?: boolean;
  stars?: boolean;
  horizon?: number;
  className?: string;
}

export function Scene({
  variant = "sunset",
  seed = 7,
  sunX = 0.5,
  sunSize = 1,
  palms = "both",
  skyline: showSkyline = true,
  stars = true,
  horizon = 470,
  className = "scene",
}: SceneProps) {
  const raw = useId();
  const id = raw.replace(/[^a-zA-Z0-9_-]/g, "");
  const p = PALETTES[variant];

  const art = useMemo(() => {
    const r = rng(seed * 31 + 3);
    const starList = Array.from({ length: 60 }, () => ({
      x: r() * W,
      y: r() * horizon * 0.55,
      r: r() < 0.85 ? 0.9 + r() * 0.8 : 1.8,
      o: 0.35 + r() * 0.6,
    }));
    const far = skyline(seed + 101, horizon, 40, 150, 0.15, false);
    const near = skyline(seed + 202, horizon, 22, 104, 0.25, true);
    const pal: ReturnType<typeof palmPaths>[] = [];
    if (palms === "both" || palms === "left") {
      pal.push(palmPaths(110, H + 10, 370, 60, 1.15, seed + 1));
      pal.push(palmPaths(250, H + 10, 270, -26, 0.85, seed + 2));
    }
    if (palms === "both" || palms === "right") {
      pal.push(palmPaths(1090, H + 10, 390, -70, 1.2, seed + 3));
      pal.push(palmPaths(955, H + 10, 250, 34, 0.8, seed + 4));
    }
    const reflections = Array.from({ length: 9 }, (_, i) => {
      const y = horizon + 14 + i * i * 1.8 + i * 6;
      const half = (150 - i * 11) * sunSize;
      return { y, half, o: 0.75 - i * 0.07 };
    });
    return { starList, far, near, pal, reflections };
  }, [seed, horizon, palms, sunSize]);

  const sunR = 150 * sunSize;
  const sunCx = W * sunX;
  const sunCy = horizon - sunR * 0.35;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.sky[0]} />
          <stop offset="0.42" stopColor={p.sky[1]} />
          <stop offset="0.78" stopColor={p.sky[2]} />
          <stop offset="1" stopColor={p.sky[3]} />
        </linearGradient>
        <linearGradient id={`${id}sun`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.sun[0]} />
          <stop offset="0.5" stopColor={p.sun[1]} />
          <stop offset="1" stopColor={p.sun[2]} />
        </linearGradient>
        <radialGradient id={`${id}glow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={p.glow} stopOpacity="0.55" />
          <stop offset="1" stopColor={p.glow} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}water`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.water[0]} />
          <stop offset="1" stopColor={p.water[1]} />
        </linearGradient>
        <mask id={`${id}stripes`}>
          <rect x="0" y="0" width={W} height={H} fill="white" />
          {Array.from({ length: 7 }, (_, i) => {
            const y = sunCy - sunR * 0.38 + i * i * 1.6 + i * 12;
            return <rect key={i} x="0" y={y} width={W} height={2.5 + i * 1.6} fill="black" />;
          })}
        </mask>
      </defs>

      <rect width={W} height={H} fill={`url(#${id}sky)`} />
      {stars && (
        <g className="lyr lyr-stars">
          {art.starList.map((s, i) => (
            <circle
              key={i}
              className={i % 5 === 0 ? "twinkle" : undefined}
              style={i % 5 === 0 ? { animationDelay: `${(i % 7) * 0.7}s` } : undefined}
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill="#fff"
              opacity={s.o}
            />
          ))}
        </g>
      )}

      <g className="lyr lyr-sun">
        <circle
          className="sun-glow"
          cx={sunCx}
          cy={sunCy}
          r={sunR * 2.1}
          fill={`url(#${id}glow)`}
        />
        <circle
          cx={sunCx}
          cy={sunCy}
          r={sunR}
          fill={`url(#${id}sun)`}
          mask={`url(#${id}stripes)`}
        />
      </g>

      {showSkyline && (
        <>
          <g className="lyr lyr-far" fill={p.far} opacity="0.75">
            {art.far.map((b, i) => (
              <rect key={i} x={b.x} y={horizon - b.h} width={b.w} height={b.h} />
            ))}
          </g>
          <g className="lyr lyr-near">
            <g fill={p.near}>
              {art.near.map((b, i) => (
                <g key={i}>
                  <rect x={b.x} y={horizon - b.h} width={b.w} height={b.h} />
                  {b.antenna && (
                    <rect x={b.x + b.w / 2 - 1.5} y={horizon - b.h - 22} width="3" height="22" />
                  )}
                </g>
              ))}
            </g>
            <g fill={p.window} opacity="0.7">
              {art.near.flatMap((b, i) =>
                b.windows.map((w, k) => (
                  <rect key={`${i}-${k}`} x={w.x} y={w.y} width="3.5" height="4.5" />
                )),
              )}
            </g>
          </g>
        </>
      )}

      <rect x="0" y={horizon} width={W} height={H - horizon} fill={`url(#${id}water)`} />
      <g fill={p.sun[1]}>
        {art.reflections.map((l, i) => (
          <rect
            key={i}
            x={sunCx - l.half}
            y={l.y}
            width={l.half * 2}
            height={2.2 + i * 0.4}
            rx="1.5"
            opacity={l.o}
          />
        ))}
      </g>

      <g className="lyr lyr-palms">
        {art.pal.map((pp, i) => (
          <g key={i} fill={p.palm} className="palm" style={{ animationDelay: `${-i * 1.7}s` }}>
            <path d={pp.trunk} />
            <path
              d={pp.rings}
              stroke={p.sky[1]}
              strokeOpacity="0.22"
              strokeWidth="1.4"
              fill="none"
            />
            {pp.fronds.map((d, k) => (
              <path key={k} d={d} />
            ))}
            {pp.coconuts.map((c, k) => (
              <circle key={k} cx={c.cx} cy={c.cy} r={c.r} />
            ))}
          </g>
        ))}
      </g>
    </svg>
  );
}
