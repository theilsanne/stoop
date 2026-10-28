// The stamp you carry: a 3D rubber stamp drawn in WebGL over the list. It rests in the bottom
// right, follows your finger or mouse while you drag it, and presses down on the listing you
// drop it on. This is the only way to stamp. The button under it is the hit area, and it shows
// your picture flat when WebGL isn't there.
import * as THREE from "three";
import { animate } from "motion";
import type { Profile } from "./types.ts";
import { hueOf, initials } from "./util.ts";

type Face = Pick<Profile, "id" | "display_name" | "avatar_url">;

const LIFT = 46;        // how high the stamp is carried, in px
const GRIP_DY = 30;     // at rest, the stamp's face sits this far below the centre of its button
const MOVE_PX = 6;      // how far a press has to move before it's a drag
const SCALE = 0.85;     // the model is built at full size and shown at this scale
const SPRING = { type: "spring", stiffness: 420, damping: 32 } as const;
const PRESS = { duration: 0.12, ease: "easeIn" } as const;
const BOUNCE = { duration: 0.08, ease: "easeOut" } as const;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A rounded square, for the base of the stamp. */
function roundedSquare(size: number, r: number) {
  const s = new THREE.Shape(), h = size / 2;
  s.moveTo(-h + r, -h); s.lineTo(h - r, -h); s.quadraticCurveTo(h, -h, h, -h + r);
  s.lineTo(h, h - r); s.quadraticCurveTo(h, h, h - r, h); s.lineTo(-h + r, h);
  s.quadraticCurveTo(-h, h, -h, h - r); s.lineTo(-h, -h + r); s.quadraticCurveTo(-h, -h, -h + r, -h);
  return s;
}

/** Mounts the stamp once. `onStamp` runs when the stamp lands on a listing, with the point it landed on. */
export function mountStamp({ onStamp }: { onStamp: (listingId: string, x: number, y: number) => void }) {
  const canvas = document.createElement("canvas");
  canvas.className = "stamp-gl";
  canvas.setAttribute("aria-hidden", "true");
  canvas.hidden = true;
  document.body.append(canvas);

  let renderer: THREE.WebGLRenderer | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch {
    renderer = null; // no WebGL: the flat picture on the button is the stamp, and dragging still stamps
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 5000);
  const pose = { x: 0, y: 0, z: 0 };  // the stamp's face centre in screen px, and how high it's lifted
  let w = 1, h = 1;

  // ---- the stamp: a turned wooden knob, a brass neck, an iron base and the picture on its face
  const wood = new THREE.MeshStandardMaterial({ color: 0x8b5e3c, roughness: 0.55 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb9a57a, roughness: 0.3, metalness: 0.8 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2b2824, roughness: 0.45 });
  const faceCanvas = document.createElement("canvas");
  faceCanvas.width = faceCanvas.height = 256;
  const faceTex = new THREE.CanvasTexture(faceCanvas);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.8 });

  const stamp = new THREE.Group();
  stamp.scale.setScalar(SCALE);
  stamp.rotation.set(-0.9, 0.4, 0);  // seen from the front and a little above, so the face shows
  scene.add(stamp);

  const knob = new THREE.LatheGeometry([
    new THREE.Vector2(0, 34), new THREE.Vector2(20, 35), new THREE.Vector2(22, 42), new THREE.Vector2(14, 52),
    new THREE.Vector2(12, 64), new THREE.Vector2(22, 76), new THREE.Vector2(24, 86), new THREE.Vector2(18, 96),
    new THREE.Vector2(0, 100),
  ], 48);
  stamp.add(new THREE.Mesh(knob, wood));

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(9, 12, 16, 32), brass);
  neck.position.y = 27;
  stamp.add(neck);

  // extruded upward from y = 0, so its bottom sits on the face
  const baseGeo = new THREE.ExtrudeGeometry(roundedSquare(96, 16), {
    depth: 14, bevelEnabled: true, bevelSize: 2.5, bevelThickness: 2.5, bevelSegments: 4, curveSegments: 8,
  });
  baseGeo.rotateX(-Math.PI / 2);
  baseGeo.translate(0, 2.5, 0);
  stamp.add(new THREE.Mesh(baseGeo, iron));

  const faceGeo = new THREE.CircleGeometry(36, 48);
  faceGeo.rotateX(Math.PI / 2);  // facing down, out of the base
  const face = new THREE.Mesh(faceGeo, faceMat);
  face.position.y = -0.5;
  stamp.add(face);

  // a soft shadow on the page, behind the stamp; it spreads and fades as the stamp is lifted
  const radial = document.createElement("canvas");
  radial.width = radial.height = 128;
  const rctx = radial.getContext("2d")!;
  const grad = rctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.6)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  rctx.fillStyle = grad;
  rctx.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(radial), transparent: true, depthWrite: false }),
  );
  shadow.position.z = -1;
  scene.add(shadow);

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(-120, 200, 260);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(160, -80, 120);
  scene.add(fill);

  // ---- the picture on the face: the photo cropped round, or initials on a colour of their own
  let faceKey = "";
  function setFace(p: Face) {
    const who = `${p.id}|${p.avatar_url ?? ""}|${p.display_name}`;
    if (who === faceKey) return;
    faceKey = who;
    const ring = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#1f6b4a";
    const paint = (img?: HTMLImageElement) => {
      if (who !== faceKey) return;  // a newer picture is on its way
      const ctx = faceCanvas.getContext("2d")!;
      ctx.clearRect(0, 0, 256, 256);
      ctx.save();
      ctx.beginPath();
      ctx.arc(128, 128, 108, 0, Math.PI * 2);
      ctx.clip();
      if (img) {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 20, 20, 216, 216);
      } else {
        ctx.fillStyle = `hsl(${hueOf(p.id)} 45% 40%)`;
        ctx.fillRect(0, 0, 256, 256);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 104px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(initials(p.display_name), 128, 138);
      }
      ctx.restore();
      ctx.lineWidth = 12;
      ctx.strokeStyle = ring;
      ctx.beginPath();
      ctx.arc(128, 128, 116, 0, Math.PI * 2);
      ctx.stroke();
      faceTex.needsUpdate = true;
      draw();
    };
    if (!p.avatar_url) return paint();
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => paint(img);
    img.onerror = () => paint();  // a photo that won't load: the initials stand in
    img.src = p.avatar_url;
  }

  // ---- drawing: on demand, when the pose changes; no loop runs while the stamp rests
  function fit() {
    w = innerWidth;
    h = innerHeight;
    renderer?.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer?.setSize(w, h, false);
    camera.aspect = w / h;
    // at the page plane (z = 0), one world unit is one CSS pixel, with the origin in the middle
    camera.position.set(0, 0, h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
    camera.updateProjectionMatrix();
  }

  function draw() {
    if (!renderer) return;
    const { x, y, z } = pose;
    stamp.position.set(x - w / 2, h / 2 - y, z);
    shadow.position.set(x - w / 2 + z * 0.4, h / 2 - y - z * 0.4, -1);
    shadow.scale.setScalar(1 + z / 120);
    (shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.45 - z / 120);
    renderer.render(scene, camera);
  }

  // ---- where it rests: over the button in the bottom right
  const hitButton = () => document.querySelector<HTMLElement>("[data-drag-stamp]");
  function restPose() {
    const r = hitButton()?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 + GRIP_DY } : null;
  }
  function toRest() {
    const r = restPose();
    if (r) { pose.x = r.x; pose.y = r.y; }
    pose.z = 0;
    draw();
  }

  /** Move one part of the pose: on a spring, or at once when reduced motion is on. */
  function glide(key: keyof typeof pose, to: number, transition: typeof SPRING | typeof PRESS | typeof BOUNCE) {
    if (reduced()) { pose[key] = to; draw(); return Promise.resolve(); }
    return animate(pose[key], to, { ...transition, onUpdate: (v: number) => { pose[key] = v; draw(); } }).finished;
  }

  // ---- the press: it comes down on the listing, the listing is stamped, and it springs back to rest
  let busy = false;
  async function press(id: string, x: number, y: number) {
    busy = true;
    await glide("z", 0, PRESS);
    onStamp(id, x, y);  // the picture is placed on the listing, and stays there
    await glide("z", 10, BOUNCE);
    await home();
  }

  async function home() {
    const r = restPose();
    if (r) await Promise.all([glide("x", r.x, SPRING), glide("y", r.y, SPRING), glide("z", 0, SPRING)]);
    busy = false;
  }

  // ---- the drag: a press on the button, then a move past MOVE_PX, is a drag; less is a tap
  let shown = false;
  let drag: { id: number; ox: number; oy: number; sx: number; sy: number; active: boolean; over: Element | null } | null = null;
  let justDragged = false;

  const targetAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-stamp-id]")) ?? null;

  function highlight(card: Element | null) {
    if (!drag || card === drag.over) return;
    drag.over?.classList.remove("drop-target");
    card?.classList.add("drop-target");
    drag.over = card;
  }

  /** Let go of the stamp: over a listing it presses down on it, anywhere else it goes home. */
  function letGo(cancelled: boolean) {
    if (!drag) return;
    const { active, over } = drag;
    drag = null;
    over?.classList.remove("drop-target");
    if (!active) return;  // a tap: the button's own click says how it works
    justDragged = true;
    setTimeout(() => (justDragged = false), 0);
    const target = cancelled ? null : targetAt(pose.x, pose.y);
    if (target?.dataset.stampId) void press(target.dataset.stampId, pose.x, pose.y);
    else { busy = true; void home(); }
  }

  document.addEventListener("pointerdown", (e) => {
    const hit = (e.target as HTMLElement).closest<HTMLElement>("[data-drag-stamp]");
    if (!hit || e.button !== 0 || busy) return;
    const r = restPose();
    if (!r) return;
    try { hit.setPointerCapture(e.pointerId); } catch { /* the button went away; events still reach the document */ }
    drag = { id: e.pointerId, ox: r.x - e.clientX, oy: r.y - e.clientY, sx: e.clientX, sy: e.clientY, active: false, over: null };
  });

  document.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < MOVE_PX) return;
      drag.active = true;
      void glide("z", LIFT, SPRING);
    }
    pose.x = e.clientX + drag.ox;
    pose.y = e.clientY + drag.oy;
    draw();
    highlight(targetAt(pose.x, pose.y));
  });

  document.addEventListener("pointerup", (e) => { if (drag && e.pointerId === drag.id) letGo(false); });
  document.addEventListener("pointercancel", (e) => { if (drag && e.pointerId === drag.id) letGo(true); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drag?.active) letGo(true); });
  // the release that ends a drag isn't also a tap on the button
  document.addEventListener("click", (e) => { if (justDragged) { e.stopPropagation(); e.preventDefault(); } }, true);

  window.addEventListener("resize", () => {
    if (!shown || drag || busy) return;
    fit();
    toRest();
  });

  /** Show the stamp over the list, or hide it. Called on every redraw, so it only resets the pose when it first appears. */
  function setShown(on: boolean) {
    const hit = hitButton();
    hit?.classList.toggle("gl", on && !!renderer);  // with WebGL, the 3D stamp takes the button's place
    canvas.hidden = !(on && renderer);
    shown = on && !!renderer;
    if (!shown || drag || busy) return;
    fit();
    toRest();
  }

  fit();
  return { setShown, setFace };
}
