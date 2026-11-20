"use client";
import { useEffect, useRef, useState } from "react";
import { traceSilhouette } from "@/lib/silhouette";
import { Logo3D } from "./Logo3D";

/**
 * The logo as a real 3D object (three.js): the PNG's outline is traced and extruded into a
 * bevelled slab, the logo artwork is mapped on the front and back faces, and the sides are
 * glossy magenta. Drag (mouse or touch) to spin it with momentum; when left alone it eases
 * back to face the viewer and sways gently. Falls back to the CSS version without WebGL.
 */
export function LogoSpinner({ className = "" }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const probe = document.createElement("canvas");
      if (!(probe.getContext("webgl2") ?? probe.getContext("webgl"))) return; // keep fallback

      const [THREE, { RoomEnvironment }] = await Promise.all([
        import("three"),
        import("three/examples/jsm/environments/RoomEnvironment.js"),
      ]);
      const img = new Image();
      img.src = "/logo.png";
      await img.decode();
      if (disposed) return;

      // ---- geometry: traced outline → extruded, bevelled slab ----
      const sil = traceSilhouette(img);
      const W = 4; // world width of the logo
      const s = W / sil.width;
      const H = sil.height * s;
      const toWorld = ([x, y]: [number, number]): [number, number] => [
        (x - sil.width / 2) * s,
        -(y - sil.height / 2) * s,
      ];
      const shapes = sil.shapes.map(({ outer, holes }) => {
        const shape = new THREE.Shape(outer.map((p) => new THREE.Vector2(...toWorld(p))));
        for (const h of holes) {
          shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(...toWorld(p)))));
        }
        return shape;
      });
      const depth = 0.36;
      const bevel = 0.055;
      const geometry = new THREE.ExtrudeGeometry(shapes, {
        depth,
        curveSegments: 1,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelOffset: -bevel, // keep the outer edge on the traced outline
        bevelSegments: 4,
      });
      geometry.translate(0, 0, -depth / 2);
      // Caps (group 0): the same planar UVs front and back, so from behind the artwork is a true
      // mirror image and lines up with the extruded outline, like a real two-sided sign.
      const pos = geometry.attributes.position!;
      const uv = geometry.attributes.uv!;
      const capGroup = geometry.groups.find((g) => g.materialIndex === 0);
      if (capGroup) {
        for (let i = capGroup.start; i < capGroup.start + capGroup.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);
          const u = (x + W / 2) / W;
          const v = (y + H / 2) / H;
          uv.setXY(i, u, v);
        }
        uv.needsUpdate = true;
      }
      geometry.computeVertexNormals();

      // ---- renderer, scene, lights ----
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      const canvas = renderer.domElement;
      canvas.className = "spinner-canvas";
      canvas.setAttribute("aria-hidden", "true");
      host.appendChild(canvas);

      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envTex;

      // Artwork over the logo's own pink rim colour: any transparent texel left at an edge
      // shows as rim, never as black.
      const art = document.createElement("canvas");
      art.width = img.naturalWidth;
      art.height = img.naturalHeight;
      const actx = art.getContext("2d")!;
      actx.fillStyle = "#f90a96";
      actx.fillRect(0, 0, art.width, art.height);
      actx.drawImage(img, 0, 0);
      const texture = new THREE.CanvasTexture(art);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      texture.needsUpdate = true;

      // The face shows the artwork in its exact brand colors (unlit, not tone mapped); the
      // lit, glossy sides carry the 3D look.
      const face = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
      const side = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color("#b3155f"),
        // A floor of magenta glow: walls facing away from every light (e.g. inside the gaps
        // between lines of lettering) stay pink instead of going black.
        emissive: new THREE.Color("#5c0a33"),
        emissiveIntensity: 1,
        metalness: 0.35,
        roughness: 0.32,
        clearcoat: 1,
        clearcoatRoughness: 0.2,
        envMapIntensity: 1.1,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, [face, side]);
      const rig = new THREE.Group();
      rig.add(mesh);
      scene.add(rig);

      scene.add(new THREE.AmbientLight("#ffd9ec", 0.35));
      const key = new THREE.DirectionalLight("#fff1dc", 2.2);
      key.position.set(-3, 4, 6);
      scene.add(key);
      const rimPink = new THREE.PointLight("#ff2e93", 40, 20);
      rimPink.position.set(4, 1.5, -2.5);
      scene.add(rimPink);
      const sunset = new THREE.PointLight("#ffb070", 30, 20);
      sunset.position.set(-3.5, -3, 2.5);
      scene.add(sunset);

      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
      const resize = () => {
        const r = host.getBoundingClientRect();
        const width = Math.max(1, r.width);
        const height = Math.max(1, r.height);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        // fit the slab (plus room to tilt) inside the view
        const fitH = Math.max(H, W / camera.aspect) * 1.12;
        camera.position.set(0, 0, fitH / 2 / Math.tan((camera.fov * Math.PI) / 360));
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(host);

      // ---- interaction: drag to spin with momentum, ease home when idle ----
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let rotY = -0.35;
      let rotX = 0.12;
      let velY = 0;
      let velX = 0;
      let lastX = 0;
      let lastY = 0;
      let lastT = 0;
      let lastInput = -1e9;
      let active = false;
      const onDown = (e: PointerEvent) => {
        active = true;
        setDragging(true);
        lastX = e.clientX;
        lastY = e.clientY;
        lastT = performance.now();
        velX = velY = 0;
        canvas.setPointerCapture(e.pointerId);
      };
      const onMove = (e: PointerEvent) => {
        if (!active) return;
        const now = performance.now();
        const dt = Math.max(1, now - lastT);
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        rotY += dx * 0.012;
        rotX = Math.max(-0.7, Math.min(0.7, rotX + dy * 0.008));
        velY = (dx * 0.012) / (dt / 16.7);
        velX = (dy * 0.008) / (dt / 16.7);
        lastX = e.clientX;
        lastY = e.clientY;
        lastT = now;
        lastInput = now;
      };
      const onUp = (e: PointerEvent) => {
        active = false;
        setDragging(false);
        lastInput = performance.now();
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      };
      canvas.addEventListener("pointerdown", onDown);
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerup", onUp);
      canvas.addEventListener("pointercancel", onUp);

      // ---- loop (paused when off screen or the tab is hidden) ----
      let visible = true;
      const io = new IntersectionObserver(([en]) => (visible = en!.isIntersecting));
      io.observe(host);
      let frame = 0;
      const clock = new THREE.Clock();
      const tick = () => {
        frame = requestAnimationFrame(tick);
        if (!visible || document.hidden) return;
        const t = clock.getElapsedTime();
        const now = performance.now();
        if (!active) {
          rotY += velY;
          rotX = Math.max(-0.7, Math.min(0.7, rotX + velX));
          velY *= 0.95;
          velX *= 0.9;
          const idle = now - lastInput > 2200 && Math.abs(velY) < 0.004;
          if (idle) {
            // ease back to the nearest front-facing turn, then sway
            const home = Math.round(rotY / (Math.PI * 2)) * Math.PI * 2;
            const swayY = reduced ? -0.3 : Math.sin(t * 0.55) * 0.42 - 0.12;
            const swayX = reduced ? 0.1 : 0.1 + Math.sin(t * 0.8) * 0.06;
            rotY += (home + swayY - rotY) * 0.035;
            rotX += (swayX - rotX) * 0.04;
          }
        }
        rig.rotation.set(rotX, rotY, 0);
        rig.position.y = reduced ? 0 : Math.sin(t * 1.1) * 0.06;
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
        geometry.dispose();
        face.dispose();
        side.dispose();
        texture.dispose();
        envTex.dispose();
        pmrem.dispose();
        renderer.dispose();
        canvas.remove();
      };
      if (disposed) cleanup();
    })().catch(() => {
      /* WebGL or decode failed: the CSS logo stays */
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={`logo-spinner${ready ? " ready" : ""}${dragging ? " dragging" : ""} ${className}`}
      role="img"
      aria-label="Grand Transfer Agent logo. Drag to spin it."
    >
      <div className="spinner-fallback">
        <Logo3D />
      </div>
      <span className="spinner-hint" aria-hidden="true">
        Drag to spin
      </span>
    </div>
  );
}
