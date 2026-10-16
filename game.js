import * as THREE from './vendor/three.module.js';

/* ------------------------------------------------------------------
   start.ng connection (the hidden connect page, see start.ng/docs.md)
------------------------------------------------------------------- */
const START_NG = 'https://start.ng';
let frame;

function connectFrame() {
  frame ??= new Promise((resolve, reject) => {
    const el = document.createElement('iframe');
    el.src = `${START_NG}/connect`;
    el.hidden = true;
    el.onload = () => resolve(el);
    el.onerror = reject;
    document.body.append(el);
  });
  return frame;
}

// Sends a message and resolves to start.ng's reply, or null if it didn't answer.
async function askStartNg(message, replyType, timeoutMs = 5000) {
  let el;
  try { el = await connectFrame(); } catch { return null; }
  return new Promise((resolve) => {
    const requestId = Math.random().toString(36).slice(2);
    const done = (reply) => { clearTimeout(timer); removeEventListener('message', onMessage); resolve(reply); };
    const timer = setTimeout(() => done(null), timeoutMs);
    function onMessage(e) {
      if (e.origin !== START_NG || e.source !== el.contentWindow) return;
      if (e.data?.type === replyType && e.data.requestId === requestId) done(e.data);
    }
    addEventListener('message', onMessage);
    el.contentWindow.postMessage({ ...message, requestId }, START_NG);
  });
}

const signInUrl = () => `${START_NG}/?return_to=${encodeURIComponent(location.origin + location.pathname)}`;
const goSignIn = () => { location.href = signInUrl(); };

/* ------------------------------------------------------------------
   Player + character style
------------------------------------------------------------------- */
const FALLBACK_STYLE = {
  body: 'male', primaryColor: '#4b7bec', secondaryColor: '#2b2f4a', skinColor: '#8d5524',
  hairColor: '#17120f', hair: 'short', hat: 'none', accessory: 'none',
};
const HAIRS = ['short', 'afro', 'braids', 'bun', 'ponytail', 'dreads', 'bald'];
const HATS = ['none', 'cap', 'beanie', 'tophat', 'crown'];
const ACCESSORIES = ['none', 'glasses', 'earrings', 'beard', 'scarf', 'backpack'];

const hex = (v, fallback) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);
const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);

function normaliseStyle(s) {
  const f = FALLBACK_STYLE;
  s = s && typeof s === 'object' ? s : {};
  return {
    body: pick(s.body, ['female', 'male'], f.body),
    primaryColor: hex(s.primaryColor, f.primaryColor),
    secondaryColor: hex(s.secondaryColor, f.secondaryColor),
    skinColor: hex(s.skinColor, f.skinColor),
    hairColor: hex(s.hairColor, f.hairColor),
    hair: pick(s.hair, HAIRS, f.hair),
    hat: pick(s.hat, HATS, f.hat),
    accessory: pick(s.accessory, ACCESSORIES, f.accessory),
  };
}

let player = { name: 'Guest', account: null, id: null, face: null, style: FALLBACK_STYLE, signedIn: false };

async function loadPlayer() {
  const reply = await askStartNg({ type: 'startng:whoami' }, 'startng:user', 3000);
  const p = reply?.user ?? reply?.guest;
  if (!p) return { name: 'Guest', account: null, id: null, face: null, style: FALLBACK_STYLE, signedIn: false };
  return {
    name: String(p.name ?? 'Guest').slice(0, 40),
    account: reply.user?.account ? String(reply.user.account).slice(0, 40) : null,
    id: reply.user?.id ?? null,
    face: typeof p.face === 'string' && p.face.startsWith('data:image/') ? p.face : null,
    style: normaliseStyle(p.style),
    signedIn: !!reply.user,
  };
}

/* ------------------------------------------------------------------
   Three.js scene
------------------------------------------------------------------- */
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14151a);
scene.fog = new THREE.Fog(0x14151a, 30, 70);

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
const CAM_OFFSET = new THREE.Vector3(0, 9.5, 7.5);

scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x303548, 1.05));
const sun = new THREE.DirectionalLight(0xffffff, 2.1);
sun.position.set(10, 22, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 70 });
scene.add(sun);
scene.add(sun.target);

const ARENA = 14;
const floorMat = new THREE.MeshStandardMaterial({ color: 0x23262f, roughness: 0.95 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2 + 2, ARENA * 2 + 2), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(ARENA * 2, 18, 0x4a4f60, 0x333747);
grid.position.y = 0.01;
scene.add(grid);

const wallMat = new THREE.MeshStandardMaterial({ color: 0xd8fd71, roughness: 0.5, emissive: 0x3a4a10 });
for (const [x, z, w, d] of [[0, -ARENA - 1, ARENA * 2 + 3, 0.6], [0, ARENA + 1, ARENA * 2 + 3, 0.6], [-ARENA - 1, 0, 0.6, ARENA * 2 + 3], [ARENA + 1, 0, 0.6, ARENA * 2 + 3]]) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, d), wallMat);
  wall.position.set(x, 0.35, z);
  wall.castShadow = true;
  wall.receiveShadow = true;
  scene.add(wall);
}

/* ------------------------------------------------------------------
   The character, built from the player's start.ng style
------------------------------------------------------------------- */
function buildCharacter(raw) {
  const s = normaliseStyle(raw);
  const mat = (color, rough = 0.7) => new THREE.MeshStandardMaterial({ color, roughness: rough });
  const top = mat(s.primaryColor);
  const bottom = mat(s.secondaryColor);
  const skin = mat(s.skinColor, 0.55);
  const hairM = mat(s.hairColor, 0.9);
  const gold = new THREE.MeshStandardMaterial({ color: 0xf5c542, roughness: 0.3, metalness: 0.6 });
  const dark = mat(0x17120f, 0.4);
  const female = s.body === 'female';

  const root = new THREE.Group();
  const model = new THREE.Group();
  root.add(model);
  const add = (geo, m, parent = model) => {
    const o = new THREE.Mesh(geo, m);
    o.castShadow = true;
    parent.add(o);
    return o;
  };

  // torso
  add(new THREE.BoxGeometry(female ? 0.52 : 0.64, 0.7, 0.34), top).position.y = 1.0;
  add(new THREE.CylinderGeometry(0.08, 0.09, 0.16, 12), skin).position.y = 1.4;

  // legs (skin under a skirt, trousers otherwise)
  const legs = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * (female ? 0.12 : 0.16), 0.7, 0);
    model.add(pivot);
    add(new THREE.BoxGeometry(0.2, 0.7, 0.22), female ? skin : bottom, pivot).position.y = -0.35;
    add(new THREE.BoxGeometry(0.22, 0.1, 0.32), dark, pivot).position.set(0, -0.65, 0.05);
    legs.push(pivot);
  }
  if (female) add(new THREE.CylinderGeometry(0.26, 0.42, 0.42, 20), bottom).position.y = 0.74;

  // arms
  const arms = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * (female ? 0.34 : 0.42), 1.32, 0);
    model.add(pivot);
    add(new THREE.BoxGeometry(0.16, 0.55, 0.16), top, pivot).position.y = -0.27;
    add(new THREE.SphereGeometry(0.09, 12, 10), skin, pivot).position.y = -0.6;
    arms.push(pivot);
  }

  // head
  const head = new THREE.Group();
  head.position.y = 1.64;
  model.add(head);
  add(new THREE.SphereGeometry(0.27, 24, 20), skin, head);
  for (const side of [-1, 1]) add(new THREE.SphereGeometry(0.035, 10, 8), dark, head).position.set(side * 0.1, 0.03, 0.245);

  // hair
  const cap = (r, portion) => new THREE.SphereGeometry(r, 24, 16, 0, Math.PI * 2, 0, Math.PI * portion);
  const strands = (count, spread, len, radius, y) => {
    for (let i = 0; i < count; i++) {
      const a = Math.PI + (i / (count - 1) - 0.5) * spread; // around the back of the head
      const strand = add(new THREE.CylinderGeometry(radius, radius * 0.8, len, 8), hairM, head);
      strand.position.set(Math.sin(a) * 0.27, y - len / 2, Math.cos(a) * 0.27);
    }
  };
  switch (s.hair) {
    case 'short': add(cap(0.29, 0.52), hairM, head).rotation.x = -0.3; break;
    case 'afro': {
      const m = add(cap(0.44, 0.62), hairM, head);
      m.rotation.x = -0.45;
      m.position.set(0, 0.04, -0.06);
      break;
    }
    case 'braids':
      add(cap(0.29, 0.52), hairM, head).rotation.x = -0.3;
      strands(7, 2.6, 0.55, 0.035, 0.0);
      break;
    case 'bun':
      add(cap(0.29, 0.52), hairM, head).rotation.x = -0.3;
      add(new THREE.SphereGeometry(0.13, 14, 12), hairM, head).position.set(0, 0.3, -0.08);
      break;
    case 'ponytail': {
      add(cap(0.29, 0.52), hairM, head).rotation.x = -0.3;
      const tail = add(new THREE.CapsuleGeometry(0.07, 0.38, 6, 10), hairM, head);
      tail.position.set(0, -0.05, -0.36);
      tail.rotation.x = 0.35;
      break;
    }
    case 'dreads':
      add(cap(0.29, 0.52), hairM, head).rotation.x = -0.3;
      strands(11, 3.4, 0.5, 0.04, 0.02);
      break;
    default: break; // bald
  }

  // hat
  switch (s.hat) {
    case 'cap': {
      const dome = add(cap(0.31, 0.5), bottom, head);
      dome.position.y = 0.03;
      dome.rotation.x = -0.12;
      add(new THREE.BoxGeometry(0.34, 0.025, 0.2), bottom, head).position.set(0, 0.13, 0.3);
      break;
    }
    case 'beanie': {
      const dome = add(cap(0.32, 0.56), bottom, head);
      dome.position.y = 0.03;
      dome.rotation.x = -0.1;
      add(new THREE.SphereGeometry(0.06, 10, 8), top, head).position.y = 0.34;
      break;
    }
    case 'tophat':
      add(new THREE.CylinderGeometry(0.4, 0.4, 0.03, 24), dark, head).position.y = 0.21;
      add(new THREE.CylinderGeometry(0.2, 0.22, 0.4, 20), dark, head).position.y = 0.42;
      add(new THREE.CylinderGeometry(0.221, 0.221, 0.07, 20), top, head).position.y = 0.28;
      break;
    case 'crown': {
      add(new THREE.CylinderGeometry(0.25, 0.23, 0.14, 20, 1, true), gold, head).position.y = 0.3;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const spike = add(new THREE.ConeGeometry(0.05, 0.14, 8), gold, head);
        spike.position.set(Math.sin(a) * 0.24, 0.43, Math.cos(a) * 0.24);
      }
      break;
    }
    default: break;
  }

  // accessory
  switch (s.accessory) {
    case 'glasses':
      for (const side of [-1, 1]) add(new THREE.TorusGeometry(0.075, 0.014, 8, 20), dark, head).position.set(side * 0.105, 0.04, 0.262);
      add(new THREE.BoxGeometry(0.06, 0.012, 0.012), dark, head).position.set(0, 0.05, 0.268);
      break;
    case 'earrings':
      for (const side of [-1, 1]) {
        add(new THREE.SphereGeometry(0.04, 10, 8), gold, head).position.set(side * 0.27, -0.06, 0);
        add(new THREE.SphereGeometry(0.03, 10, 8), gold, head).position.set(side * 0.27, -0.14, 0);
      }
      break;
    case 'beard': {
      const b = add(new THREE.SphereGeometry(0.2, 16, 12), hairM, head);
      b.scale.set(1.05, 0.75, 0.8);
      b.position.set(0, -0.14, 0.1);
      break;
    }
    case 'scarf': {
      const ring = add(new THREE.TorusGeometry(0.2, 0.07, 10, 24), bottom);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 1.4;
      add(new THREE.BoxGeometry(0.12, 0.42, 0.04), bottom).position.set(0.14, 1.2, 0.2);
      break;
    }
    case 'backpack':
      add(new THREE.BoxGeometry(0.42, 0.52, 0.2), bottom).position.set(0, 1.02, -0.27);
      add(new THREE.BoxGeometry(0.3, 0.12, 0.04), gold).position.set(0, 0.9, -0.38);
      break;
    default: break;
  }

  const bobBase = model.position.y;
  return {
    root,
    update(t, speed) {
      const swing = Math.sin(t * 11) * 0.85 * speed;
      legs[0].rotation.x = swing;
      legs[1].rotation.x = -swing;
      arms[0].rotation.x = -swing * 0.9;
      arms[1].rotation.x = swing * 0.9;
      model.position.y = bobBase + Math.abs(Math.sin(t * 11)) * 0.07 * speed + Math.sin(t * 2) * 0.01 * (1 - speed);
    },
  };
}

let hero = null;
let heroKey = '';
function setHero(style) {
  const key = JSON.stringify(normaliseStyle(style));
  if (key === heroKey) return;
  heroKey = key;
  const pos = hero ? hero.root.position.clone() : new THREE.Vector3();
  const rot = hero ? hero.root.rotation.y : 0;
  if (hero) scene.remove(hero.root);
  hero = buildCharacter(style);
  hero.root.position.copy(pos);
  hero.root.rotation.y = rot;
  scene.add(hero.root);
  // the arena takes a hint of the player's own colour
  const accent = new THREE.Color(normaliseStyle(style).primaryColor);
  floorMat.color.set(0x23262f).lerp(accent, 0.08);
}

/* ------------------------------------------------------------------
   Game objects
------------------------------------------------------------------- */
const ROUND = 45;
const COMBO_WINDOW = 1.6;
const ORB_COUNT = 6;
const SPIKE_COUNT = 4;

const orbGeo = new THREE.SphereGeometry(0.42, 18, 14);
const orbMat = new THREE.MeshStandardMaterial({ color: 0xf5c542, emissive: 0xb07800, emissiveIntensity: 0.9, roughness: 0.25, metalness: 0.4 });
const spikeGeo = new THREE.OctahedronGeometry(0.62, 0);
const spikeMat = new THREE.MeshStandardMaterial({ color: 0xff5a5f, emissive: 0x8a1018, emissiveIntensity: 0.9, roughness: 0.4 });

const orbs = [];
const spikes = [];

function randomSpot(minFromPlayer = 4) {
  for (let i = 0; i < 30; i++) {
    const x = (Math.random() * 2 - 1) * (ARENA - 2);
    const z = (Math.random() * 2 - 1) * (ARENA - 2);
    if (!hero || Math.hypot(x - hero.root.position.x, z - hero.root.position.z) > minFromPlayer) return { x, z };
  }
  return { x: 0, z: 0 };
}

function spawnOrb() {
  const m = new THREE.Mesh(orbGeo, orbMat);
  m.castShadow = true;
  const { x, z } = randomSpot();
  m.position.set(x, 0.9, z);
  m.userData.phase = Math.random() * 6.28;
  scene.add(m);
  orbs.push(m);
}

function spawnSpike() {
  const m = new THREE.Mesh(spikeGeo, spikeMat);
  m.castShadow = true;
  const { x, z } = randomSpot(8);
  m.position.set(x, 0.8, z);
  const a = Math.random() * 6.28;
  m.userData.vx = Math.cos(a) * 2.6;
  m.userData.vz = Math.sin(a) * 2.6;
  scene.add(m);
  spikes.push(m);
}

function clearField() {
  for (const m of orbs) scene.remove(m);
  for (const m of spikes) scene.remove(m);
  orbs.length = 0;
  spikes.length = 0;
}

// little burst of sparks on pickup
const sparks = [];
const sparkGeo = new THREE.SphereGeometry(0.07, 6, 5);
function burst(pos, color) {
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.position.copy(pos);
    const a = Math.random() * 6.28;
    const sp = 2 + Math.random() * 3;
    m.userData = { vx: Math.cos(a) * sp, vy: 3 + Math.random() * 3, vz: Math.sin(a) * sp, life: 0.6 };
    scene.add(m);
    sparks.push(m);
  }
}

/* ------------------------------------------------------------------
   Sound (tiny synthesised beeps, no audio files)
------------------------------------------------------------------- */
let audio;
function beep(freq, dur = 0.09, type = 'sine', vol = 0.08) {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + dur);
  } catch { /* sound is optional */ }
}

/* ------------------------------------------------------------------
   Input: keyboard + drag joystick
------------------------------------------------------------------- */
const keys = new Set();
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if ((e.code === 'Enter' || e.code === 'Space') && state !== 'playing') {
    if (!document.getElementById('start').hidden) startGame();
    else if (!document.getElementById('end').hidden) startGame();
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const stick = document.getElementById('stick');
const knob = document.getElementById('knob');
const joy = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'playing') return;
  joy.active = true;
  joy.id = e.pointerId;
  joy.ox = e.clientX;
  joy.oy = e.clientY;
  joy.x = joy.y = 0;
  stick.style.left = `${e.clientX}px`;
  stick.style.top = `${e.clientY}px`;
  stick.hidden = false;
  knob.style.transform = 'translate(0,0)';
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!joy.active || e.pointerId !== joy.id) return;
  let dx = e.clientX - joy.ox;
  let dy = e.clientY - joy.oy;
  const len = Math.hypot(dx, dy);
  const max = 60;
  if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
  joy.x = dx / max;
  joy.y = dy / max;
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
});
const endJoy = (e) => {
  if (e.pointerId !== joy.id) return;
  joy.active = false;
  joy.x = joy.y = 0;
  stick.hidden = true;
};
canvas.addEventListener('pointerup', endJoy);
canvas.addEventListener('pointercancel', endJoy);

function inputVector() {
  let x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  let z = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
  if (joy.active) { x += joy.x; z += joy.y; }
  const len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; }
  return { x: len < 0.12 ? 0 : x, z: len < 0.12 ? 0 : z };
}

/* ------------------------------------------------------------------
   UI
------------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);
const els = {
  card: $('player-card'), face: $('player-face'), name: $('player-name'), account: $('player-account'), cardSignIn: $('player-sign-in'),
  hud: $('hud'), orbs: $('hud-orbs'), time: $('hud-time'), timePill: $('time-pill'), combo: $('combo'), toast: $('toast'), tag: $('nametag'),
  start: $('start'), end: $('end'), endOrbs: $('end-orbs'), endCombo: $('end-combo'), saved: $('saved'), board: $('board'),
  startSignIn: $('start-sign-in'), endSignIn: $('end-sign-in'),
};
const asGuestOnly = new URLSearchParams(location.search).has('guest');

function renderPlayerUi() {
  els.name.textContent = player.name;
  els.account.textContent = player.account ? `@${player.account}` : 'Not signed in';
  if (player.face) els.face.src = player.face; else els.face.removeAttribute('src');
  els.cardSignIn.hidden = player.signedIn;
  els.startSignIn.hidden = player.signedIn || asGuestOnly;
  els.endSignIn.hidden = player.signedIn;
  els.card.hidden = false;
  els.tag.textContent = player.name;
}
els.cardSignIn.onclick = goSignIn;
els.startSignIn.onclick = goSignIn;
els.endSignIn.onclick = goSignIn;

let toastTimer;
function toast(text, ms = 900) {
  els.toast.textContent = text;
  els.toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('on'), ms);
}

function renderBoard(entries) {
  els.board.replaceChildren();
  if (!Array.isArray(entries) || entries.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No scores yet. Be the first!';
    els.board.append(li);
    return;
  }
  for (const e of entries) {
    const li = document.createElement('li');
    if (player.id != null && e.player_id === player.id) li.className = 'me';
    const rk = document.createElement('span'); rk.className = 'rk'; rk.textContent = `#${e.rank}`;
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = String(e.name ?? '');
    const st = document.createElement('span'); st.className = 'st';
    const orbsN = e.stats?.orbs ?? e.score ?? 0;
    st.textContent = e.stats?.combo != null ? `${orbsN} orbs · x${e.stats.combo}` : `${orbsN} orbs`;
    li.append(rk, nm, st);
    els.board.append(li);
  }
}

/* ------------------------------------------------------------------
   Game loop
------------------------------------------------------------------- */
let state = 'ready'; // ready | playing | over
let timeLeft = ROUND;
let orbCount = 0;
let combo = 0;
let bestCombo = 0;
let lastPickup = -99;
let tNow = 0;
const vel = new THREE.Vector3();
const timer = new THREE.Timer();

function startGame() {
  if (!hero) return;
  beep(440, 0.06);
  clearField();
  for (let i = 0; i < ORB_COUNT; i++) spawnOrb();
  hero.root.position.set(0, 0, 0);
  vel.set(0, 0, 0);
  for (let i = 0; i < SPIKE_COUNT; i++) spawnSpike();
  timeLeft = ROUND;
  orbCount = 0;
  combo = 0;
  bestCombo = 0;
  lastPickup = -99;
  els.orbs.textContent = '0';
  els.time.textContent = String(ROUND);
  els.timePill.classList.remove('low');
  els.combo.classList.remove('on');
  els.start.hidden = true;
  els.end.hidden = true;
  els.hud.hidden = false;
  els.tag.hidden = false;
  state = 'playing';
}

async function endGame() {
  state = 'over';
  joy.active = false;
  stick.hidden = true;
  els.hud.hidden = true;
  els.combo.classList.remove('on');
  beep(220, 0.35, 'triangle');
  els.endOrbs.textContent = String(orbCount);
  els.endCombo.textContent = String(bestCombo);
  els.saved.textContent = '';
  els.board.replaceChildren();
  els.end.hidden = false;

  const fresh = await loadPlayer(); // they may have signed in on another tab
  if (fresh.signedIn !== player.signedIn || fresh.name !== player.name) applyPlayer(fresh);

  if (player.signedIn) {
    if (orbCount > 0) {
      els.saved.textContent = 'Saving your score…';
      const saved = await askStartNg({ type: 'startng:score', stats: { orbs: orbCount, combo: bestCombo } }, 'startng:scoreSaved', 8000);
      if (saved?.ok) {
        els.saved.textContent = saved.result.improved ? `New personal best! You're #${saved.result.rank}` : `Not your best this time (you're #${saved.result.rank})`;
      } else {
        els.saved.textContent = saved?.error ? `Couldn't save: ${saved.error}` : "Couldn't reach start.ng to save your score.";
      }
    } else {
      els.saved.textContent = 'Collect at least one orb to get on the board.';
    }
  } else {
    els.saved.textContent = 'Sign in to put your score on the leaderboard.';
  }

  const board = await askStartNg({ type: 'startng:leaderboard', limit: 10 }, 'startng:leaderboardData', 6000);
  renderBoard(board?.ok ? board.entries : []);
}

function collectOrb(i) {
  const m = orbs[i];
  burst(m.position, 0xf5c542);
  scene.remove(m);
  orbs.splice(i, 1);
  spawnOrb();

  combo = tNow - lastPickup <= COMBO_WINDOW ? combo + 1 : 1;
  lastPickup = tNow;
  bestCombo = Math.max(bestCombo, combo);
  orbCount += 1;
  els.orbs.textContent = String(orbCount);
  beep(520 + Math.min(combo, 10) * 55, 0.09);

  if (combo >= 3) {
    timeLeft += 0.5;
    els.combo.textContent = `x${combo} combo  +0.5s`;
    els.combo.classList.add('on');
  }
}

function hitSpike(i) {
  const m = spikes[i];
  burst(m.position, 0xff5a5f);
  const { x, z } = randomSpot(10);
  m.position.set(x, 0.8, z);
  timeLeft = Math.max(0, timeLeft - 3);
  combo = 0;
  lastPickup = -99;
  els.combo.classList.remove('on');
  toast('-3s');
  beep(150, 0.25, 'sawtooth', 0.07);
}

const tmp = new THREE.Vector3();
function update(dt) {
  tNow += dt;
  const accel = 1 - Math.exp(-dt * 14);
  let speed01 = 0;

  if (state === 'playing') {
    const inp = inputVector();
    const SPEED = 8;
    vel.x += (inp.x * SPEED - vel.x) * accel;
    vel.z += (inp.z * SPEED - vel.z) * accel;
    hero.root.position.x = THREE.MathUtils.clamp(hero.root.position.x + vel.x * dt, -ARENA + 0.6, ARENA - 0.6);
    hero.root.position.z = THREE.MathUtils.clamp(hero.root.position.z + vel.z * dt, -ARENA + 0.6, ARENA - 0.6);
    speed01 = Math.min(1, Math.hypot(vel.x, vel.z) / SPEED);
    if (speed01 > 0.08) {
      const target = Math.atan2(vel.x, vel.z);
      let diff = target - hero.root.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      hero.root.rotation.y += diff * (1 - Math.exp(-dt * 12));
    }

    timeLeft -= dt;
    if (combo > 0 && tNow - lastPickup > COMBO_WINDOW) { combo = 0; els.combo.classList.remove('on'); }
    els.time.textContent = String(Math.max(0, Math.ceil(timeLeft)));
    els.timePill.classList.toggle('low', timeLeft <= 10);

    const hp = hero.root.position;
    for (let i = orbs.length - 1; i >= 0; i--) {
      if (Math.hypot(orbs[i].position.x - hp.x, orbs[i].position.z - hp.z) < 0.95) collectOrb(i);
    }
    for (let i = 0; i < spikes.length; i++) {
      if (Math.hypot(spikes[i].position.x - hp.x, spikes[i].position.z - hp.z) < 0.95) hitSpike(i);
    }
    if (timeLeft <= 0) endGame();
  } else {
    vel.set(0, 0, 0);
    if (hero && state === 'ready') hero.root.rotation.y = Math.sin(tNow * 0.9) * 0.7; // sway toward the camera to show the character off
  }

  for (const m of orbs) {
    m.position.y = 0.9 + Math.sin(tNow * 3 + m.userData.phase) * 0.15;
    m.rotation.y += dt * 2;
  }
  for (const m of spikes) {
    m.position.x += m.userData.vx * dt;
    m.position.z += m.userData.vz * dt;
    if (Math.abs(m.position.x) > ARENA - 0.8) { m.userData.vx *= -1; m.position.x = Math.sign(m.position.x) * (ARENA - 0.8); }
    if (Math.abs(m.position.z) > ARENA - 0.8) { m.userData.vz *= -1; m.position.z = Math.sign(m.position.z) * (ARENA - 0.8); }
    m.rotation.x += dt * 2.2;
    m.rotation.y += dt * 1.6;
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const m = sparks[i];
    const u = m.userData;
    u.life -= dt;
    u.vy -= 14 * dt;
    m.position.x += u.vx * dt;
    m.position.y = Math.max(0.05, m.position.y + u.vy * dt);
    m.position.z += u.vz * dt;
    m.material.opacity = Math.max(0, u.life / 0.6);
    if (u.life <= 0) { scene.remove(m); m.material.dispose(); sparks.splice(i, 1); }
  }

  if (hero) {
    hero.update(tNow, speed01);
    // camera follows
    tmp.copy(hero.root.position).add(CAM_OFFSET);
    camera.position.lerp(tmp, 1 - Math.exp(-dt * 5));
    tmp.copy(hero.root.position);
    tmp.y = 0.8;
    camera.lookAt(tmp);
    sun.position.set(hero.root.position.x + 10, 22, hero.root.position.z + 8);
    sun.target.position.copy(hero.root.position);

    // name tag above the head
    tmp.copy(hero.root.position);
    tmp.y = 2.45;
    tmp.project(camera);
    els.tag.style.left = `${(tmp.x * 0.5 + 0.5) * innerWidth}px`;
    els.tag.style.top = `${(-tmp.y * 0.5 + 0.5) * innerHeight}px`;
  }
}

function resize() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // keep the arena in view on tall phone screens
  camera.fov = w / h < 0.8 ? 62 : 48;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

function loop() {
  requestAnimationFrame(loop);
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  update(dt);
  renderer.render(scene, camera);
}

/* ------------------------------------------------------------------
   Boot
------------------------------------------------------------------- */
function applyPlayer(p) {
  player = p;
  setHero(p.style);
  renderPlayerUi();
}

// Start with a placeholder look right away so the screen is never empty, then swap in the real player.
applyPlayer({ ...player });
camera.position.copy(hero.root.position).add(CAM_OFFSET);
for (let i = 0; i < ORB_COUNT; i++) spawnOrb(); // something to look at behind the start screen
for (let i = 0; i < SPIKE_COUNT; i++) spawnSpike();
loop();
loadPlayer().then(applyPlayer);

$('play').onclick = startGame;
$('again').onclick = startGame;

// They may have signed in or out on start.ng while this tab was away.
async function refreshPlayer() {
  if (state === 'playing') return;
  const fresh = await loadPlayer();
  if (JSON.stringify(fresh) !== JSON.stringify(player)) applyPlayer(fresh);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshPlayer(); });
addEventListener('focus', refreshPlayer);
