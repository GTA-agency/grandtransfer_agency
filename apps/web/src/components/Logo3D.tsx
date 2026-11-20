/**
 * The logo as a 3D sign. Thickness comes from a chain of 1-step drop-shadows (each copies the
 * whole silhouette one step further back, darker towards the rear). The sign tilts with the
 * pointer (--mx/--my from the parallax parent) on top of a slow idle sway, a sheen masked to
 * the logo sweeps across the face, and a soft shadow sits underneath.
 */
const STEPS = 18;

/** Extrusion towards bottom-right (light from top-left), plum fading to near black. */
const EXTRUDE = Array.from({ length: STEPS }, (_, i) => {
  const t = i / (STEPS - 1);
  const l = Math.round(34 - t * 26);
  return `drop-shadow(1.2px 1.7px 0 hsl(${300 - t * 22} 62% ${l}%))`;
}).join(" ");

export function Logo3D({ className = "" }: { className?: string }) {
  return (
    <div className={`logo3d ${className}`}>
      <div className="logo3d-sway">
        <div className="logo3d-tilt">
          <img
            className="logo3d-face"
            src="/logo.png"
            alt="Grand Transfer Agent"
            width={1378}
            height={1015}
            style={{
              filter: `${EXTRUDE} drop-shadow(0 0 22px rgb(255 46 147 / 0.35)) drop-shadow(0 24px 30px rgb(10 4 24 / 0.55))`,
            }}
          />
          <span className="logo3d-sheen" aria-hidden="true" />
        </div>
      </div>
      <span className="logo3d-shadow" aria-hidden="true" />
    </div>
  );
}
