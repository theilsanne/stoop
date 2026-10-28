// The stamp you carry: a wooden rubber stamp on its ink pad, drawn in WebGL over the list.
// Pick it up off the pad and carry it (it swings from the handle as you move, and turns more
// upright in your hand). Over a listing it squares up toward the page. Let go and it comes down
// toward the page, tipped a little, and the die meets the page flat: that press leaves your seal
// in ink. Then it lifts and goes home to its pad. This is the only way to stamp. The button under
// the pad is the hit area; without WebGL it shows a flat seal that drags the same way. A focused
// listing can be stamped with S, and the stamp flies over to it.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Profile } from "./types.ts";
import { initials, sealName } from "./util.ts";

type Face = Pick<Profile, "id" | "display_name" | "avatar_url">;
type Mode = "rest" | "hover" | "held" | "fly" | "press" | "lift" | "home";

interface Options {
  /** Whether you can stamp this listing: not one you've stamped already. */
  canStamp: (listingId: string) => boolean;
  /** The stamp came down on a listing: print the seal. `x, y` is where it landed. */
  onStamp: (listingId: string, x: number, y: number) => void;
  /** It came down on a listing you'd already stamped. */
  onRefused: (listingId: string) => void;
}

// Sizes are CSS px at full scale. On a phone the pad and stamp are drawn smaller (see fit).
const PAD_W = 136, PAD_D = 96, PAD_H = 14;
const REST_Z = PAD_H + 1.5;          // standing on the felt
const GRIP = 96;                     // the top of the handle: where you hold it, and what it swings from
// How the stamp is turned toward you, in radians. 0 is square to the page: the handle points straight
// at you and the die lies flat on the listing, which is how a stamp has to land to leave a clean print.
// More negative leans the handle up the screen. On its pad it's seen like an object on a desk, in your
// hand it's more upright, over a listing it's nearly square, and at contact it's square.
const REST_VIEW = -0.96, CARRY_VIEW = -0.62, AIM_VIEW = -0.34, LAND_VIEW = -0.12, FLAT_VIEW = -0.03;
const HOVER_Z = REST_Z + 12, CARRY_Z = 96, AIM_Z = 58, LIFT_Z = 42;
const MOVE_PX = 6;                   // how far a press moves before it's a drag
const SWING = 0.0011;                // radians of swing per px/s of movement
const MAX_SWING = 0.55;
// where a card's first seal sits, from the photo's bottom-left corner: matches .impressions in styles.css
const SEAL_LEFT = 6, SEAL_BOTTOM = 4, SEAL_R = 39;
const SHEET_R = 40;                  // the sheet's seals are a little bigger than a card's
// the die is drawn the size of the seal it prints on a card (radius SEAL_R), so the stamp could have made the mark
const STAMP_GROW = SEAL_R / 36;

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A damped spring, stepped every frame. Stiff ones follow closely; loose ones wobble. */
class Spring {
  x: number; to: number; v = 0; k: number; c: number;
  constructor(x: number, k: number, c: number) { this.x = this.to = x; this.k = k; this.c = c; }
  step(dt: number) {
    this.v += (this.k * (this.to - this.x) - this.c * this.v) * dt;
    this.x += this.v * dt;
  }
  snap(x = this.to) { this.x = this.to = x; this.v = 0; }
  get settled() { return Math.abs(this.to - this.x) < 0.05 && Math.abs(this.v) < 0.05; }
}

// ---------- materials drawn on canvases ----------

/** Turned wood: long grain lines in a darker tone, running the length of the piece. */
function woodTexture(light: string, dark: string) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = light;
  g.fillRect(0, 0, 256, 512);
  g.strokeStyle = dark;
  for (let i = 0; i < 70; i++) {
    const x0 = Math.random() * 256, amp = 2 + Math.random() * 6, f = 0.01 + Math.random() * 0.02, ph = Math.random() * 6;
    g.globalAlpha = 0.08 + Math.random() * 0.3;
    g.lineWidth = 0.6 + Math.random() * 2.4;
    g.beginPath();
    for (let y = 0; y <= 512; y += 8) {
      const x = x0 + Math.sin(y * f + ph) * amp;
      if (y === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Felt: fine fibres in light and dark, multiplied by the ink colour so the pad looks soaked, not painted. */
function feltTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#d8d8d8";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const v = Math.random() < 0.5 ? 255 : 90;
    g.fillStyle = `rgba(${v},${v},${v},${0.08 + Math.random() * 0.18})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2.5, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(0.012, 0.012); // the felt's UVs are in pad units: about one tile across the pad
  return t;
}

/** A soft round shadow, dark in the middle and gone at the edge. */
function blobTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.55)");
  grad.addColorStop(0.6, "rgba(0,0,0,0.2)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** Lettering round a circle, spaced to fill it, each letter upright to the ring. */
function ringText(g: CanvasRenderingContext2D, text: string, c: number, r: number, size: number) {
  g.font = `800 ${size}px Archivo, "Arial Narrow", sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const chars = [...text], widths = chars.map((ch) => g.measureText(ch).width);
  const gap = (2 * Math.PI * r - widths.reduce((a, b) => a + b, 0)) / chars.length;
  let a = -Math.PI / 2;
  chars.forEach((ch, i) => {
    const step = (widths[i] + gap) / r;
    a += step / 2;
    g.save();
    g.translate(c + r * Math.cos(a), c + r * Math.sin(a));
    g.rotate(a + Math.PI / 2);
    g.fillText(ch, 0, 0);
    g.restore();
    a += step / 2;
  });
}

/** The label on top of the handle: your seal printed on paper, so you can see what the stamp prints. */
function paintLabel(cv: HTMLCanvasElement, face: Face, ink: string, img: HTMLImageElement | null) {
  const n = cv.width, c = n / 2, g = cv.getContext("2d")!;
  g.save();
  g.fillStyle = "#f4eee2";
  g.fillRect(0, 0, n, n);
  g.strokeStyle = ink;
  g.fillStyle = ink;
  for (const [r, lw] of [[0.445, 0.035], [0.31, 0.013]]) {
    g.lineWidth = n * lw;
    g.beginPath();
    g.arc(c, c, n * r, 0, Math.PI * 2);
    g.stroke();
  }
  ringText(g, `${sealName(face.display_name)} ★ REALLY LIKES IT ★ `, c, n * 0.375, n * 0.075);
  g.beginPath();
  g.arc(c, c, n * 0.285, 0, Math.PI * 2);
  g.clip();
  if (img) {
    // the photo in ink: grey, then screened with the ink, so dark prints as ink and light as paper
    const side = Math.min(img.naturalWidth, img.naturalHeight), d = n * 0.57;
    g.filter = "grayscale(1) contrast(1.35)";
    g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, c - d / 2, c - d / 2, d, d);
    g.filter = "none";
    g.globalCompositeOperation = "screen";
    g.fillRect(0, 0, n, n);
  } else {
    g.font = `700 ${n * 0.26}px Georgia, "Times New Roman", serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(initials(face.display_name), c, c + n * 0.015);
  }
  g.restore();
}

/** A rounded rectangle, for the pad's tin and its felt. */
function roundedRect(w: number, d: number, r: number) {
  const s = new THREE.Shape(), x = w / 2, y = d / 2;
  s.moveTo(-x + r, -y); s.lineTo(x - r, -y); s.quadraticCurveTo(x, -y, x, -y + r);
  s.lineTo(x, y - r); s.quadraticCurveTo(x, y, x - r, y); s.lineTo(-x + r, y);
  s.quadraticCurveTo(-x, y, -x, y - r); s.lineTo(-x, -y + r); s.quadraticCurveTo(-x, -y, -x + r, -y);
  return s;
}

/** A turned part, from its profile as [radius, height] pairs, standing along z. */
function lathe(profile: [number, number][]) {
  const g = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), 64);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Mounts the stamp once. Returns what the app calls on each redraw. */
export function mountStamp({ canStamp, onStamp, onRefused }: Options) {
  const canvas = document.createElement("canvas");
  canvas.className = "stamp-gl";
  canvas.setAttribute("aria-hidden", "true");
  canvas.hidden = true;
  document.body.append(canvas);
  // the button under the pad: the hit area everywhere (the list and the sheet), and the flat seal when there's no WebGL
  const stampBtn = document.createElement("button");
  stampBtn.className = "drag-stamp";
  stampBtn.dataset.dragStamp = "";
  stampBtn.dataset.action = "stamphint";
  stampBtn.setAttribute("aria-label", "Your stamp. Drag it onto a listing to stamp it, or focus a listing and press S");
  stampBtn.title = "Drag it onto a listing to stamp it";
  stampBtn.hidden = true;
  document.body.append(stampBtn);

  let renderer: THREE.WebGLRenderer | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch {
    renderer = null; // no WebGL: the flat seal on the button is the stamp
  }

  const scene = new THREE.Scene();
  // perspective, set so that one world unit is one CSS pixel at the page (z = 0): the stamp grows as it
  // lifts toward you and shrinks as it comes down, and draw() keeps it under the cursor at any height
  const camera = new THREE.PerspectiveCamera(46, 1, 10, 6000);
  let w = 1, h = 1, scale = 1, camDist = 1000;
  const rest = { x: 0, y: 0 };
  const world = (x: number, y: number) => [x - w / 2, h / 2 - y] as const;

  if (renderer) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }

  // ---- light: a warm key from the upper left, a cool fill from the right, and a rim from behind
  // that catches the edges of the wood and brass
  const lights: [number, number, [number, number, number]][] = [
    [0xfff1e0, 2.2, [-300, 500, 600]], [0xdfe8ff, 0.5, [400, -100, 300]], [0xffffff, 1.4, [200, 600, -500]],
  ];
  for (const [color, intensity, [x, y, z]] of lights) {
    const l = new THREE.DirectionalLight(color, intensity);
    l.position.set(x, y, z);
    scene.add(l);
  }

  // ---- materials
  const walnut = new THREE.MeshPhysicalMaterial({ map: woodTexture("#5c3520", "#2e170c"), roughness: 0.38, clearcoat: 0.9, clearcoatRoughness: 0.18 });
  const maple = new THREE.MeshPhysicalMaterial({ map: woodTexture("#c99a5e", "#8f6230"), roughness: 0.45, clearcoat: 0.7, clearcoatRoughness: 0.25 });
  const brass = new THREE.MeshPhysicalMaterial({ color: 0xd2a94f, metalness: 1, roughness: 0.24, clearcoat: 0.4 });
  const rubber = new THREE.MeshPhysicalMaterial({ color: 0x7a1d14, roughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.3 });
  const tinMat = new THREE.MeshPhysicalMaterial({ color: 0x1d2733, metalness: 0.5, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 });
  const felt = new THREE.MeshPhysicalMaterial({ map: feltTexture(), color: 0x3a120c, roughness: 0.95, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x6a2018) });
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = labelCanvas.height = 512;
  const labelTex = new THREE.CanvasTexture(labelCanvas);
  labelTex.colorSpace = THREE.SRGBColorSpace;
  labelTex.anisotropy = 4;
  const labelMat = new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.75 });
  const aimMat = new THREE.MeshBasicMaterial({ color: 0xc23a2b, transparent: true, opacity: 0.6, depthWrite: false });

  // ---- the stamp, built standing along z with its face at z = 0, and hung from the grip:
  // rig (at the face, tipped to the view) > swing (at the grip, tilts) > body (the stamp, squashes toward its face)
  const body = new THREE.Group();
  body.position.z = -GRIP;
  const swing = new THREE.Group();
  swing.position.z = GRIP;
  swing.add(body);
  const rig = new THREE.Group();
  rig.rotation.x = REST_VIEW;
  rig.add(swing);
  scene.add(rig);
  const part = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.Mesh(geo, mat);
    body.add(m);
    return m;
  };
  part(lathe([[0, 0], [36, 0], [36.6, 0.6], [36.6, 4.2], [0, 4.2]]), rubber);                         // the rubber die
  part(lathe([[0, 4], [37, 4], [39.4, 4.6], [40, 6.5], [40, 19.5], [39.4, 21.4], [37, 22], [0, 22]]), maple); // the mount
  part(lathe([[0, 22], [13.2, 22], [14, 22.8], [14, 29.5], [13.2, 30.5], [0, 30.5]]), brass);         // the ferrule
  part(lathe([[0, 30.5], [9.5, 30.5], [8.6, 36], [7.2, 44], [7.8, 52], [11.5, 60], [16.5, 68], [20.5, 76],
    [22.8, 84], [23, 89.5], [22.2, 93.2], [20.6, 95.4], [0, 95.4]]), walnut);                           // the handle
  const label = part(new THREE.CircleGeometry(19.6, 64), labelMat);                                   // your seal, on top
  label.position.z = 95.45;

  // ---- the ink pad it rests on: an enamel tin with felt soaked in your ink, and its own soft shadow
  const pad = new THREE.Group();
  pad.rotation.x = REST_VIEW;
  scene.add(pad);
  const tinGeo = new THREE.ExtrudeGeometry(roundedRect(PAD_W, PAD_D, 16),
    { depth: PAD_H - 4, bevelEnabled: true, bevelThickness: 2, bevelSize: 2, bevelSegments: 5, curveSegments: 12 });
  tinGeo.translate(0, 0, 2);
  pad.add(new THREE.Mesh(tinGeo, tinMat));
  const feltGeo = new THREE.ExtrudeGeometry(roundedRect(PAD_W - 22, PAD_D - 22, 10),
    { depth: 1.2, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.6, bevelSegments: 2, curveSegments: 12 });
  feltGeo.translate(0, 0, PAD_H - 0.6);
  pad.add(new THREE.Mesh(feltGeo, felt));
  const padShadow = new THREE.Mesh(new THREE.PlaneGeometry(PAD_W * 1.3, PAD_D * 1.45),
    new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }));
  padShadow.position.set(6, -8, 0.2);
  pad.add(padShadow);

  // ---- the stamp's own contact shadow on whatever it stands over: dark and tight when it touches,
  // wide and faint when it's lifted. It stays at the stamp's foot, so you see how high it is.
  const footMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false });
  const foot = new THREE.Mesh(new THREE.PlaneGeometry(104, 104), footMat);
  scene.add(foot);

  // ---- where the seal will land, drawn on the listing while you aim: a thin ink ring, faintly filled
  const aimRing = new THREE.Group();
  aimRing.add(new THREE.Mesh(new THREE.RingGeometry(SEAL_R - 2, SEAL_R, 72), aimMat));
  const aimFillMat = new THREE.MeshBasicMaterial({ color: 0xc23a2b, transparent: true, opacity: 0.1, depthWrite: false });
  aimRing.add(new THREE.Mesh(new THREE.CircleGeometry(SEAL_R - 2, 72), aimFillMat));
  aimRing.visible = false;
  scene.add(aimRing);

  // ---- the stamp's motion: where its face is on screen, how high, how it's tilted, how squashed
  const sx = new Spring(0, 190, 26), sy = new Spring(0, 190, 26), sz = new Spring(REST_Z, 320, 30);
  const tx = new Spring(0, 210, 13), ty = new Spring(0, 210, 13), sq = new Spring(1, 700, 22);
  const vw = new Spring(REST_VIEW, 170, 19); // how the stamp is turned toward the page, see REST_VIEW
  const springs = [sx, sy, sz, tx, ty, sq, vw];
  let mode: Mode = "rest";
  let shown = false;
  let grab: { id: number; x0: number; y0: number; dx: number; dy: number; active: boolean } | null = null;
  let press: { id: string; x: number; y: number; refused: boolean; touched: boolean } | null = null;
  let aimed: HTMLElement | null = null;
  let justDragged = false;
  const pointer = { x: 0, y: 0 }, prev = { x: 0, y: 0 }, vel = { x: 0, y: 0 };

  const cardAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-stamp-id]") ?? null;

  /** Where your seal goes: bottom left of a card's photo, or the middle of your empty slot on the sheet. */
  function spotOf(card: HTMLElement) {
    const slot = card.querySelector<HTMLElement>("[data-seal-spot]");
    if (slot) {
      const r = slot.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    const r = (card.querySelector(".ph") ?? card).getBoundingClientRect();
    return { x: r.left + SEAL_LEFT + SEAL_R, y: r.bottom - SEAL_BOTTOM - SEAL_R };
  }

  function aim(card: HTMLElement | null) {
    if (card !== aimed) {
      aimed?.classList.remove("drop-target");
      card?.classList.add("drop-target");
      aimed = card;
    }
    aimRing.visible = !!card && !!renderer;
    if (card) {
      const s = spotOf(card), [x, y] = world(s.x, s.y);
      aimRing.position.set(x, y, 0.5);
      aimRing.scale.setScalar(card.querySelector("[data-seal-spot]") ? SHEET_R / SEAL_R : 1);
    }
  }

  function setMode(m: Mode) {
    mode = m;
    const tight = m === "held" || m === "press";
    sx.k = sy.k = tight ? 900 : m === "fly" ? 260 : 190;
    sx.c = sy.c = tight ? 62 : m === "fly" ? 30 : 26;
    sz.k = m === "press" ? 900 : 320;
    sz.c = m === "press" ? 55 : 30;
    vw.k = m === "press" ? 420 : 170;  // the die squares up quickly as it meets the page
    vw.c = m === "press" ? 30 : 19;
    if (m !== "held") aim(null);
    wake();
  }

  /** Each frame, where the stamp is heading. */
  function steer() {
    const restZ = REST_Z * scale;
    const swingFrom = (vx: number, vy: number, k = 1) => {
      ty.to = clamp(vx * SWING * k, -MAX_SWING, MAX_SWING);
      tx.to = clamp(vy * SWING * k, -MAX_SWING, MAX_SWING);
    };
    switch (mode) {
      case "rest":
        sx.to = rest.x; sy.to = rest.y; sz.to = restZ; tx.to = ty.to = 0; vw.to = REST_VIEW;
        break;
      case "hover":
        // it lifts a little off the felt and leans toward the pointer: pick me up
        sx.to = rest.x; sy.to = rest.y; sz.to = HOVER_Z * scale; vw.to = REST_VIEW + 0.08;
        ty.to = clamp((pointer.x - rest.x) * 0.003, -0.18, 0.18);
        tx.to = clamp((pointer.y - rest.y) * 0.003, -0.18, 0.18);
        break;
      case "held": {
        const x = pointer.x + grab!.dx, y = pointer.y + grab!.dy, card = cardAt(x, y);
        // it stays exactly under the cursor, wherever it's carried; the ring shows where it would print
        sx.to = x; sy.to = y;
        aim(card);
        sz.to = (card ? AIM_Z : CARRY_Z) * scale;
        vw.to = card ? AIM_VIEW : CARRY_VIEW; // upright in your hand, squaring up over a listing
        swingFrom(vel.x, vel.y);
        break;
      }
      case "fly":
        sx.to = press!.x; sy.to = press!.y; sz.to = CARRY_Z * scale; vw.to = AIM_VIEW;
        swingFrom(sx.v, sy.v, 0.8);
        if (Math.hypot(press!.x - sx.x, press!.y - sy.x) < 3) setMode("press");
        break;
      case "press": {
        // it comes down over the spot, tipped a little, and squares up as the die nears the page,
        // so it lands flat. touchDown() takes it from there
        sx.to = press!.x; sy.to = press!.y;
        if (press!.touched) break;
        const over = Math.hypot(press!.x - sx.x, press!.y - sy.x) < 4;
        const high = clamp(sz.x / (AIM_Z * scale), 0, 1); // 1 in the air, 0 at the page
        vw.to = LAND_VIEW + (AIM_VIEW - LAND_VIEW) * high;
        tx.to = 0; ty.to = 0.1 * high;
        sz.to = over ? -6 : AIM_Z * scale;
        break;
      }
      case "lift":
        sz.to = LIFT_Z * scale; tx.to = ty.to = 0; vw.to = AIM_VIEW;
        break;
      case "home": {
        // an arc back to the pad: up and over, turning from the hand's angle to the desk angle as it nears the pad
        sx.to = rest.x; sy.to = rest.y;
        const d = Math.hypot(rest.x - sx.x, rest.y - sy.x);
        sz.to = d > 24 ? CARRY_Z * 0.8 * scale : restZ;
        vw.to = d > 60 ? CARRY_VIEW : REST_VIEW;
        tx.to = ty.to = 0; // level on the way home, not swung by the motion
        if (d < 1 && Math.abs(sz.x - restZ) < 0.6) setMode("rest");
        break;
      }
    }
  }

  /** The page is solid: the stamp stops at it, and the first touch in a press prints the seal. */
  function touchDown() {
    if (sz.x >= 0) return;
    sz.x = 0;
    if (sz.v < 0) sz.v = 0;
    if (mode !== "press" || !press || press.touched) return;
    press.touched = true;
    const p = press;
    if (p.refused) {
      tx.v -= 4; ty.v += 7; // a shake: already stamped
      onRefused(p.id);
      later(240, () => setMode("home"));
      return;
    }
    sq.snap(1);
    sq.to = 0.9; // the handle gives into the press
    tx.to = ty.to = 0;
    vw.to = FLAT_VIEW; // the die goes flat onto the page
    sq.v = -4;
    navigator.vibrate?.(14);
    onStamp(p.id, p.x, p.y);
    // hold the press a moment, so you see the die flat on the page, then lift off and go home
    later(260, () => {
      sq.to = 1;
      setMode("lift");
      later(200, () => setMode("home"));
    });
  }

  function draw() {
    if (!renderer) {
      // no WebGL: the flat seal on the button moves instead
      const hit = stampBtn;
      if (hit) hit.style.transform = mode === "rest" || mode === "hover" ? "" : `translate(${sx.x - rest.x}px, ${sy.x - rest.y}px)`;
      return;
    }
    const [x, y] = world(sx.x, sy.x);
    rig.rotation.x = vw.x;
    swing.rotation.set(tx.x, ty.x, 0);
    // With perspective, a point at height z is drawn at (x, y) only if it sits at (x, y) scaled toward
    // the middle of the screen. That keeps the die exactly under the cursor however high it's lifted.
    const near = (camDist - sz.x) / camDist;
    // The tilt turns about the handle, which moves the die. Work out where the die is after the tilt
    // (in the stamp's own units, so scaled), and shift the stamp so the die stays where it should be.
    const die = new THREE.Vector3(0, 0, -GRIP).applyEuler(swing.rotation).add(new THREE.Vector3(0, 0, GRIP))
      .applyEuler(rig.rotation).multiplyScalar(scale * STAMP_GROW);
    rig.position.set(x * near - die.x, y * near - die.y, sz.x - die.z);
    body.scale.z = sq.x;
    // over the pad its shadow falls on the felt, tipped like the pad; anywhere else, flat on the page
    const onPad = Math.abs(sx.x - rest.x) < (PAD_W / 2) * scale && Math.abs(sy.x - rest.y) < (PAD_D / 2) * Math.cos(REST_VIEW) * scale;
    const floor = onPad ? PAD_H * scale : 0, lift = Math.max(0, sz.x - REST_Z * scale);
    const onFloor = (camDist - floor) / camDist;
    // the shadow falls down and to the right, further away the higher it's lifted
    foot.rotation.x = onPad ? REST_VIEW : 0;
    foot.position.set((x + lift * 0.35) * onFloor, (y - lift * 0.35) * onFloor, floor + 0.3);
    foot.scale.setScalar(scale * (1 + lift / 140));
    footMat.opacity = clamp(1 - lift / 170, 0.25, 1);
    renderer.render(scene, camera);
  }

  // ---- the frame loop: runs while anything moves, and stops when the stamp is still on its pad
  let raf = 0, last = 0;
  // delays run on the animation's own clock, so they stay in step with the motion if frames drop
  let clock = 0;
  let timers: { at: number; run: () => void }[] = [];
  const later = (ms: number, run: () => void) => { timers.push({ at: clock + ms / 1000, run }); wake(); };
  function wake() {
    if (raf || !shown) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function frame(now: number) {
    raf = 0;
    // real time, so a slow phone drops frames rather than playing in slow motion
    const dt = clamp((now - last) / 1000, 1 / 240, 0.25);
    last = now;
    clock += dt;
    if (timers.some((t) => t.at <= clock)) {
      const due = timers.filter((t) => t.at <= clock);
      timers = timers.filter((t) => t.at > clock);
      due.forEach((t) => t.run());
    }
    // the pointer's speed, smoothed: what the stamp swings with while you carry it
    vel.x += ((pointer.x - prev.x) / dt - vel.x) * 0.25;
    vel.y += ((pointer.y - prev.y) / dt - vel.y) * 0.25;
    prev.x = pointer.x;
    prev.y = pointer.y;
    steer();
    if (reduced()) springs.forEach((s) => s.snap());
    else {
      // small fixed steps keep the stiff springs (the press) stable however long the frame was
      const n = Math.ceil(dt * 240);
      for (let i = 0; i < n; i++) springs.forEach((s) => s.step(dt / n));
    }
    touchDown();
    draw();
    if (mode !== "rest" || !springs.every((s) => s.settled)) raf = requestAnimationFrame(frame);
  }

  function fit() {
    w = innerWidth;
    h = innerHeight;
    const r = stampBtn?.getBoundingClientRect();
    if (r) {
      // the pad sits at the bottom of the button, and the stamp stands up from it
      scale = r.width / PAD_W;
      rest.x = r.left + r.width / 2;
      rest.y = r.bottom - 34 * scale;
    }
    if (!renderer) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    // one world unit is one CSS pixel at the page, with the origin in the middle of the screen
    camDist = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    camera.aspect = w / h;
    camera.position.set(0, 0, camDist);
    camera.updateProjectionMatrix();
    const [px, py] = world(rest.x, rest.y);
    pad.position.set(px, py, 0);
    pad.scale.setScalar(scale);
    rig.scale.setScalar(scale * STAMP_GROW);
  }

  function toRest() {
    mode = "rest";
    sx.snap(rest.x); sy.snap(rest.y); sz.snap(REST_Z * scale);
    tx.snap(0); ty.snap(0); sq.snap(1); vw.snap(REST_VIEW);
  }

  // ---- your seal on the label, and your ink in the pad, the die and the aim ring
  let faceKey = "";
  function setFace(face: Face, ink: string, flat: string) {
    const key = [face.id, face.avatar_url, face.display_name, ink].join("|");
    if (key === faceKey) return;
    faceKey = key;
    stampBtn.innerHTML = flat; // the flat seal: what shows when there's no WebGL, and hidden under the 3D stamp otherwise
    felt.color.set(ink).multiplyScalar(0.22);
    felt.sheenColor.set(ink).multiplyScalar(0.55);
    rubber.color.set(ink).multiplyScalar(0.6);
    aimMat.color.set(ink);
    aimFillMat.color.set(ink);
    const paint = (img: HTMLImageElement | null) => {
      if (key !== faceKey) return; // a newer picture is on its way
      paintLabel(labelCanvas, face, ink, img);
      labelTex.needsUpdate = true;
      if (renderer && shown && mode === "rest") draw();
    };
    const fonts = document.fonts?.load("800 40px Archivo").catch(() => []) ?? Promise.resolve([]);
    if (!face.avatar_url) { fonts.then(() => paint(null)); return; }
    const img = new Image();
    img.crossOrigin = "anonymous"; // a photo the browser won't share with a canvas falls back to initials
    img.onload = () => fonts.then(() => paint(img));
    img.onerror = () => fonts.then(() => paint(null));
    img.src = face.avatar_url;
  }

  // ---- picking it up, carrying it, letting go
  function letGo(cancelled: boolean) {
    const g = grab;
    grab = null;
    if (!g?.active) return; // a tap: the button's own click says how it works
    justDragged = true;
    setTimeout(() => (justDragged = false), 0);
    const card = cancelled ? null : cardAt(pointer.x + g.dx, pointer.y + g.dy);
    if (!card) { setMode("home"); return; }
    const s = spotOf(card), id = card.dataset.stampId!;
    press = { id, x: s.x, y: s.y, refused: !canStamp(id), touched: false };
    setMode("press");
  }

  document.addEventListener("pointerdown", (e) => {
    const hit = (e.target as Element).closest<HTMLElement>("[data-drag-stamp]");
    if (!hit || e.button !== 0 || !shown || (mode !== "rest" && mode !== "hover")) return;
    try { hit.setPointerCapture(e.pointerId); } catch { /* the button went away; events still reach the document */ }
    pointer.x = prev.x = e.clientX;
    pointer.y = prev.y = e.clientY;
    grab = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: sx.x - e.clientX, dy: sy.x - e.clientY, active: false };
  });

  document.addEventListener("pointermove", (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    if (grab && e.pointerId === grab.id) {
      if (!grab.active) {
        if (Math.hypot(e.clientX - grab.x0, e.clientY - grab.y0) < MOVE_PX) return;
        grab.active = true;
        navigator.vibrate?.(8);
        setMode("held");
      }
      wake();
      return;
    }
    // a mouse over the stamp at rest
    if (e.pointerType === "mouse" && shown && (mode === "rest" || mode === "hover")) {
      const over = !!(e.target as Element).closest?.("[data-drag-stamp]");
      if (over !== (mode === "hover")) setMode(over ? "hover" : "rest");
      else if (over) wake();
    }
  });

  document.addEventListener("pointerup", (e) => { if (grab && e.pointerId === grab.id) letGo(false); });
  document.addEventListener("pointercancel", (e) => { if (grab && e.pointerId === grab.id) letGo(true); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && grab?.active) letGo(true); });
  // the release that ends a drag isn't also a tap on the button
  document.addEventListener("click", (e) => { if (justDragged) { e.stopPropagation(); e.preventDefault(); } }, true);
  // while you carry it, a finger moving shouldn't scroll the page
  document.addEventListener("touchmove", (e) => { if (grab?.active) e.preventDefault(); }, { passive: false });

  window.addEventListener("resize", () => {
    if (!shown) return;
    fit();
    if (mode === "rest") toRest();
    draw();
  });

  /** Show the stamp over the list, or hide it. Called on every redraw: it only resets when it first appears. */
  function setShown(on: boolean) {
    stampBtn.hidden = !on;
    stampBtn.classList.toggle("gl", on && !!renderer);
    canvas.hidden = !(on && renderer);
    const was = shown;
    shown = on;
    if (!on) {
      cancelAnimationFrame(raf);
      raf = 0;
      grab = null;
      press = null;
      timers = [];
      aim(null);
      mode = "rest";
      return;
    }
    if (!was) { fit(); toRest(); }
    draw();
  }

  /** The keyboard's way: the stamp flies over to a listing and presses it. */
  function stampCard(card: HTMLElement) {
    if (!shown || (mode !== "rest" && mode !== "hover")) return;
    const s = spotOf(card), id = card.dataset.stampId!;
    press = { id, x: s.x, y: s.y, refused: !canStamp(id), touched: false };
    setMode("fly");
  }

  return { setShown, setFace, stampCard };
}
