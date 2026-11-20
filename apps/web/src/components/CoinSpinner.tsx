"use client";
import { useEffect, useRef, useState } from "react";

const S = 1024; // face texture size
const C = S / 2;

/** The coin face, used on both sides: a gold rim around "$GTA" in sunset colors. */
async function faceTexture(font: string) {
  const face = document.createElement("canvas");
  face.width = face.height = S;
  const f = face.getContext("2d")!;

  // gold rim
  const g = f.createRadialGradient(C - 140, C - 160, 60, C, C, C);
  g.addColorStop(0, "#fff4c4");
  g.addColorStop(0.55, "#ffc477");
  g.addColorStop(0.85, "#f08a3c");
  g.addColorStop(1, "#b9562a");
  f.fillStyle = g;
  f.beginPath();
  f.arc(C, C, C, 0, Math.PI * 2);
  f.fill();
  f.strokeStyle = "rgb(120 40 20 / 0.55)";
  f.lineWidth = 6;
  for (const r of [C - 16, 432]) {
    f.beginPath();
    f.arc(C, C, r, 0, Math.PI * 2);
    f.stroke();
  }

  // inner disc
  const disc = f.createRadialGradient(C, C - 140, 40, C, C, 424);
  disc.addColorStop(0, "#5a2475");
  disc.addColorStop(1, "#1a0b2e");
  f.fillStyle = disc;
  f.beginPath();
  f.arc(C, C, 424, 0, Math.PI * 2);
  f.fill();

  // $GTA, sized to fill the disc
  f.textAlign = "center";
  f.textBaseline = "middle";
  f.font = `400 100px ${font}`;
  const size = Math.min(420, (100 * 640) / f.measureText("$GTA").width);
  f.font = `400 ${size}px ${font}`;
  const y = C + size * 0.04;
  const tg = f.createLinearGradient(0, y - size * 0.45, 0, y + size * 0.45);
  tg.addColorStop(0, "#fff1b8");
  tg.addColorStop(0.5, "#ffb36b");
  tg.addColorStop(1, "#ff4f9a");
  f.fillStyle = "#6a1f63";
  f.fillText("$GTA", C, y + 14);
  f.fillStyle = tg;
  f.fillText("$GTA", C, y);
  return face;
}

/**
 * The $GTA coin as a real 3D object (three.js): a gold, reeded-edge coin with
 * "$GTA" on both sides. It spins on its own; drag to flick it. Without
 * WebGL a flat CSS coin stays in place.
 */
export function CoinSpinner({ className = "" }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const probe = document.createElement("canvas");
      if (!(probe.getContext("webgl2") ?? probe.getContext("webgl"))) return;
      const [THREE, { RoomEnvironment }] = await Promise.all([
        import("three"),
        import("three/examples/jsm/environments/RoomEnvironment.js"),
      ]);
      await document.fonts.ready;
      const font =
        getComputedStyle(document.documentElement).getPropertyValue("--font-anton").trim() ||
        "Impact, sans-serif";
      const art = await faceTexture(font);
      if (disposed) return;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      const canvas = renderer.domElement;
      canvas.className = "coin-canvas";
      canvas.setAttribute("aria-hidden", "true");
      host.appendChild(canvas);

      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envTex;

      const R = 1.6;
      const depth = 0.24;
      // reeded edge: fine vertical ridges as a bump map
      const reed = document.createElement("canvas");
      reed.width = 2048;
      reed.height = 4;
      const rc = reed.getContext("2d")!;
      for (let i = 0; i < 2048; i += 8) {
        rc.fillStyle = "#fff";
        rc.fillRect(i, 0, 4, 4);
        rc.fillStyle = "#000";
        rc.fillRect(i + 4, 0, 4, 4);
      }
      const reedTex = new THREE.CanvasTexture(reed);
      const gold = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color("#ffb45e"),
        metalness: 1,
        roughness: 0.26,
        clearcoat: 0.6,
        bumpMap: reedTex,
        bumpScale: 2.5,
        envMapIntensity: 1.3,
      });
      const capGold = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color("#e8903f"),
        metalness: 1,
        roughness: 0.3,
      });
      const body = new THREE.CylinderGeometry(R, R, depth, 160, 1, false);
      body.rotateX(Math.PI / 2);
      const coin = new THREE.Group();
      coin.add(new THREE.Mesh(body, [gold, capGold, capGold]));

      const faceMat = (c: HTMLCanvasElement) => {
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        return new THREE.MeshPhysicalMaterial({
          map: t,
          emissiveMap: t,
          emissive: new THREE.Color("#ffffff"),
          emissiveIntensity: 0.62,
          metalness: 0.35,
          roughness: 0.32,
          clearcoat: 1,
          clearcoatRoughness: 0.15,
          envMapIntensity: 0.9,
        });
      };
      // Both sides wear the same face; the back disc is turned around so it reads correctly.
      const faceMaterial = faceMat(art);
      const faceGeo = new THREE.CircleGeometry(R * 0.995, 160);
      const front = new THREE.Mesh(faceGeo, faceMaterial);
      front.position.z = depth / 2 + 0.002;
      const back = new THREE.Mesh(faceGeo, faceMaterial);
      back.rotation.y = Math.PI;
      back.position.z = -depth / 2 - 0.002;
      coin.add(front, back);
      scene.add(coin);

      scene.add(new THREE.AmbientLight("#ffe2f0", 0.4));
      const key = new THREE.DirectionalLight("#fff1dc", 2.4);
      key.position.set(-3, 4, 6);
      scene.add(key);
      const pink = new THREE.PointLight("#ff2e93", 45, 20);
      pink.position.set(4, 1.5, -2);
      scene.add(pink);
      const sun = new THREE.PointLight("#ffb070", 40, 20);
      sun.position.set(-2.5, -3, -3);
      scene.add(sun);

      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
      const resize = () => {
        const r = host.getBoundingClientRect();
        const w = Math.max(1, r.width);
        const h = Math.max(1, r.height);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        const fit = Math.max(R * 2, (R * 2) / camera.aspect) * 1.18;
        camera.position.set(0, 0, fit / 2 / Math.tan((camera.fov * Math.PI) / 360));
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(host);

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const base = reduced ? 0 : 0.012; // idle spin per frame
      let rotY = -0.5;
      let vel = base;
      let active = false;
      let lastX = 0;
      const onDown = (e: PointerEvent) => {
        active = true;
        lastX = e.clientX;
        canvas.setPointerCapture(e.pointerId);
      };
      const onMove = (e: PointerEvent) => {
        if (!active) return;
        const dx = e.clientX - lastX;
        lastX = e.clientX;
        rotY += dx * 0.012;
        vel = dx * 0.012;
      };
      const onUp = (e: PointerEvent) => {
        active = false;
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      };
      canvas.addEventListener("pointerdown", onDown);
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerup", onUp);
      canvas.addEventListener("pointercancel", onUp);

      let visible = true;
      const io = new IntersectionObserver(([en]) => (visible = en!.isIntersecting));
      io.observe(host);
      let frame = 0;
      const t0 = performance.now();
      const tick = () => {
        frame = requestAnimationFrame(tick);
        if (!visible || document.hidden) return;
        const t = (performance.now() - t0) / 1000;
        if (!active) {
          rotY += vel;
          vel += (base - vel) * 0.03; // a flick slows back down to the idle spin
        }
        coin.rotation.set(reduced ? 0.12 : 0.12 + Math.sin(t * 0.7) * 0.08, rotY, 0);
        coin.position.y = reduced ? 0 : Math.sin(t * 1.2) * 0.07;
        renderer.render(scene, camera);
      };
      tick();
      setReady(true);

      cleanup = () => {
        cancelAnimationFrame(frame);
        ro.disconnect();
        io.disconnect();
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
        body.dispose();
        faceGeo.dispose();
        for (const m of [gold, capGold, faceMaterial]) {
          m.map?.dispose();
          m.dispose();
        }
        reedTex.dispose();
        envTex.dispose();
        pmrem.dispose();
        renderer.dispose();
        canvas.remove();
      };
      if (disposed) cleanup();
    })().catch(() => {
      /* WebGL or image decode failed: the CSS coin stays */
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={`coin-spinner${ready ? " ready" : ""} ${className}`}
      role="img"
      aria-label="The $GTA coin. Drag to spin it."
    >
      <div className="coin-fallback" aria-hidden="true">
        <span>$GTA</span>
      </div>
    </div>
  );
}
