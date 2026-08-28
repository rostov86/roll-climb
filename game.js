/* Ролл вверх — hyper-casual vertical climber. Sushi roll auto-bounces; player rotates the tower. */
(function () {
  "use strict";
  if (typeof THREE === "undefined") {
    var ov = document.getElementById("overlay");
    if (ov) ov.innerHTML = "<h1>Нет Three.js</h1>";
    return;
  }

  var TOWER_R = 2.42;
  var PLAT_IN = TOWER_R + 0.04;
  var PLAT_OUT = TOWER_R + 1.28;
  var PLAT_THICK = 0.34;
  /* platGeo: extrude depth along +Z, bevelThickness 0.045, rotateX(-90),
     translate(0,-PLAT_THICK,0) → TOP at local Y ≈ +0.045, NOT centered (+0.17). */
  var PLAT_TOP_OFF = 0.045;
  var LAND_EPS = 0.06;
  var FALL_FLOORS = 1.5;
  /* Bounce height v^2/2g = 14.6^2 / 64 = 3.33. Floor 2.28 → 1.05 m spare.
     Air ~0.72s. Keys 2.75 rad/s → ~2.0 rad per jump. Steps stay under 1.45. */
  var FLOOR_H = 2.28;
  var PLAYER_Z = TOWER_R + 0.68;
  var PLAYER_R = 0.44;
  var PLAYER_H = 0.50;
  var GRAVITY = 32;
  var BOUNCE_V = 14.6;
  var SPRING_V = 20.5;
  var JET_DUR = 2.35;
  var JET_V = 10.2;
  var ANG_PAD = 0.08;
  var MAX_TURN = 1.42;
  var KEY_ROT = 2.75;
  var START_LIVES = 3;

  var ZONES = [
    { y: 0,   name: "ЗОНА 01 — НОРИ",   sky: 0x7ed2fb, fog: 0xb5e4fa, hemi: 0xfff6e6, ground: 0x4aa3c8 },
    { y: 100, name: "ЗОНА 02 — ЗАКАТ",  sky: 0xff8d62, fog: 0xffc4a0, hemi: 0xffd8b0, ground: 0xd06088 },
    { y: 200, name: "ЗОНА 03 — ИКРА",   sky: 0xd060a8, fog: 0xeba0c8, hemi: 0xffd4ea, ground: 0x6e3c8c },
    { y: 320, name: "ЗОНА 04 — ВАСАБИ", sky: 0x3eae82, fog: 0x72cba4, hemi: 0xdcffd4, ground: 0x1c6346 },
    { y: 460, name: "ЗОНА 05 — НОЧЬ УМИ", sky: 0x1a1a62, fog: 0x32327a, hemi: 0xd0d8ff, ground: 0x0c0c32 }
  ];

  var overlay = document.getElementById("overlay");
  var ovMsg = document.getElementById("ovMsg");
  var ovStats = document.getElementById("ovStats");
  var ovGo = document.getElementById("ovGo");
  var ovTitle = overlay.querySelector("h1");
  var ovTag = overlay.querySelector(".tag");
  var scoreEl = document.getElementById("score");
  var scorePop = document.getElementById("score-pop");
  var flowEl = document.getElementById("flow");
  var flowN = document.getElementById("flow-n");
  var roeEl = document.getElementById("roe");
  var altEl = document.getElementById("alt");
  var livesEl = document.getElementById("lives");
  var hintEl = document.getElementById("hint");
  var bannerEl = document.getElementById("banner");
  var hurtEl = document.getElementById("hurtflash");

  var mode = "menu";
  var score = 0, shownScore = 0, combo = 0, maxCombo = 0, roe = 0, lives = START_LIVES;
  var maxY = 0, lastLandY = 0, lastLandAng = 0, zoneIdx = 0, shownZone = -1;
  var invuln = 0, jetT = 0, shake = 0, hurtFlash = 0, hintT = 6;
  var time = 0, lastT = 0, popT = 0;

  var player = { y: 1.2, vy: 0, prevY: 1.2, squash: 1, spin: 0, dead: false };
  var towerRot = 0, rotVel = 0;
  var dragging = false, lastPX = 0, lastPY = 0;
  var keys = Object.create(null);

  var platforms = [];
  var pickups = [];
  var maces = [];
  var particles = [];
  var clouds = [];
  var lanterns = [];
  var genFloor = 0;
  var lastSafeAng = 0;
  var stairDir = 1;
  var rngSeed = 1;

  function rand() {
    rngSeed = (rngSeed * 16807 + 0) % 2147483647;
    return (rngSeed - 1) / 2147483646;
  }
  function irand(a, b) { return a + Math.floor(rand() * (b - a + 1)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function wrapPi(a) {
    a = (a + Math.PI) % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return a - Math.PI;
  }
  function hexMix(a, b, t) {
    var ca = new THREE.Color(a), cb = new THREE.Color(b);
    return ca.lerp(cb, t);
  }

  /* ---------- audio ---------- */
  var ac = null;
  function ensureAudio() {
    if (!ac) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ac = new AC();
    }
    if (ac && ac.state === "suspended") ac.resume();
  }
  function tone(freq, dur, type, vol, slide) {
    if (!ac) return;
    var o = ac.createOscillator();
    var g = ac.createGain();
    o.type = type || "square";
    o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, slide), ac.currentTime + dur);
    g.gain.value = vol || 0.07;
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + dur);
  }
  function sfx(kind) {
    ensureAudio();
    if (kind === "bounce") {
      var p = 380 + Math.min(combo, 18) * 18;
      tone(p, 0.09, "triangle", 0.06, p * 1.5);
    } else if (kind === "spring") {
      tone(220, 0.08, "square", 0.06, 640);
      tone(520, 0.16, "sine", 0.05, 980);
    } else if (kind === "roe") {
      tone(740, 0.07, "sine", 0.06);
      tone(1100, 0.12, "sine", 0.04);
    } else if (kind === "jet") {
      tone(180, 0.28, "sawtooth", 0.05, 520);
    } else if (kind === "hurt") {
      tone(240, 0.22, "square", 0.08, 70);
    } else if (kind === "zone") {
      tone(392, 0.12, "sine", 0.06);
      setTimeout(function () { tone(523, 0.14, "sine", 0.06); }, 90);
      setTimeout(function () { tone(659, 0.2, "sine", 0.07); }, 180);
    } else if (kind === "lose") {
      tone(280, 0.28, "sawtooth", 0.07, 80);
    } else if (kind === "start") {
      tone(440, 0.1, "sine", 0.05, 660);
    }
  }

  /* ---------- renderer / scene ---------- */
  var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x7ed2fb, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.insertBefore(renderer.domElement, document.body.firstChild);

  var scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xb5e4fa, 18, 54);

  var camera = new THREE.PerspectiveCamera(52, innerWidth / Math.max(1, innerHeight), 0.1, 80);
  camera.position.set(0, -2.2, 8.4);

  var hemi = new THREE.HemisphereLight(0xfff4dc, 0x4aa0d0, 0.62);
  scene.add(hemi);
  var sun = new THREE.DirectionalLight(0xfff2d4, 1.08);
  sun.position.set(6, 14, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 1024;
  sun.shadow.mapSize.height = 1024;
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 36;
  sun.shadow.camera.left = -7;
  sun.shadow.camera.right = 7;
  sun.shadow.camera.top = 8;
  sun.shadow.camera.bottom = -6;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 1.6;
  scene.add(sun);
  scene.add(sun.target);
  var fillLite = new THREE.DirectionalLight(0xffe0b8, 0.32);
  fillLite.position.set(-6, 8, 3);
  scene.add(fillLite);
  var rimLite = new THREE.DirectionalLight(0xc5e0ff, 0.34);
  rimLite.position.set(7.2, 4, 5.4);
  scene.add(rimLite);
  scene.add(new THREE.AmbientLight(0xffffff, 0.12));

  var world = new THREE.Group();
  scene.add(world);
  var towerGroup = new THREE.Group();
  world.add(towerGroup);

  function layout() {
    camera.aspect = innerWidth / Math.max(1, innerHeight);
    camera.fov = camera.aspect < 0.7 ? 56 : 50;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  }
  layout();
  addEventListener("resize", layout);

  /* ---------- textures ---------- */
  function canvasTex(w, h, draw) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    var t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }

  function stdMat(opts) {
    var m;
    if (THREE.MeshStandardMaterial) {
      m = new THREE.MeshStandardMaterial(opts);
      if (opts.metalness == null) m.metalness = 0.1;
      if (opts.roughness == null) m.roughness = 0.5;
      return m;
    }
    m = new THREE.MeshPhongMaterial(opts);
    m.shininess = opts.roughness != null ? Math.max(8, 90 * (1 - opts.roughness)) : 36;
    if (opts.metalness != null && opts.metalness > 0.4) m.specular = new THREE.Color(0xffe6a8);
    return m;
  }

  var noriTex = canvasTex(128, 256, function (g, w, h) {
    var i, j, x, y;
    g.fillStyle = "#163824";
    g.fillRect(0, 0, w, h);
    for (i = 0; i < 70; i++) {
      g.fillStyle = i % 2 ? "rgba(8,28,16,.4)" : "rgba(78,132,88,.16)";
      g.fillRect(0, (i / 70) * h, w, 5);
    }
    g.strokeStyle = "rgba(10,26,14,.32)";
    g.lineWidth = 1;
    for (j = 0; j < 12; j++) {
      g.beginPath();
      x = (j / 12) * w + Math.sin(j * 1.7) * 3;
      g.moveTo(x, 0);
      g.lineTo(x + 4, h);
      g.stroke();
    }
    for (i = 0; i < 24; i++) {
      g.fillStyle = "rgba(220, 236, 180, 0.14)";
      g.fillRect(6 + (i * 17) % w, (i * 37) % h, 2, 18);
    }
    g.fillStyle = "rgba(255,255,255,.08)";
    g.fillRect(w * 0.18, 0, 7, h);
  });
  noriTex.wrapS = noriTex.wrapT = THREE.RepeatWrapping;

  var capTex = canvasTex(256, 256, function (g) {
    var cx = 128, cy = 128, i, a, x, y, rr;
    g.fillStyle = "#12281c";
    g.beginPath(); g.arc(cx, cy, 127, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#1e4a30";
    g.beginPath(); g.arc(cx, cy, 120, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#2f6844";
    g.beginPath(); g.arc(cx, cy, 114, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff7ec";
    g.beginPath(); g.arc(cx, cy, 102, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#ffe9c8";
    g.beginPath(); g.arc(cx, cy, 96, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fffaf2";
    g.beginPath(); g.arc(cx, cy, 90, 0, Math.PI * 2); g.fill();
    for (i = 0; i < 140; i++) {
      a = Math.random() * Math.PI * 2;
      rr = 12 + Math.random() * 82;
      x = cx + Math.cos(a) * rr;
      y = cy + Math.sin(a) * rr;
      g.fillStyle = Math.random() > 0.45 ? "#ffffff" : (Math.random() > 0.5 ? "#f4ead4" : "#ffe8c2");
      g.beginPath();
      g.ellipse(x, y, 3.6, 1.7, a + 0.4, 0, Math.PI * 2);
      g.fill();
    }
    for (i = 0; i < 28; i++) {
      a = Math.random() * Math.PI * 2;
      rr = 20 + Math.random() * 70;
      g.fillStyle = Math.random() > 0.5 ? "#2a2218" : "#f4efe2";
      g.beginPath();
      g.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1.3 + Math.random(), 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "#ff8a4a";
    g.beginPath(); g.ellipse(cx - 12, cy + 4, 38, 50, -0.38, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#f05a32";
    g.beginPath(); g.ellipse(cx - 8, cy + 8, 26, 36, -0.38, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#ffb08a";
    g.beginPath(); g.ellipse(cx - 22, cy - 6, 10, 16, -0.5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "rgba(255,236,220,.85)";
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(cx - 34, cy - 10);
    g.quadraticCurveTo(cx - 4, cy - 32, cx + 18, cy + 6);
    g.stroke();
    g.beginPath();
    g.moveTo(cx - 28, cy + 10);
    g.quadraticCurveTo(cx - 6, cy - 8, cx + 10, cy + 18);
    g.stroke();
    g.fillStyle = "#7cb83a";
    g.beginPath(); g.ellipse(cx + 32, cy + 12, 22, 28, 0.48, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#c6e85c";
    g.beginPath(); g.ellipse(cx + 30, cy + 8, 13, 15, 0.48, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#6a3e16";
    g.beginPath(); g.arc(cx + 36, cy + 14, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(255,255,255,.28)";
    g.beginPath(); g.arc(cx + 34, cy + 12, 2.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#86d06a";
    g.beginPath(); g.ellipse(cx + 8, cy - 30, 16, 20, 0.18, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#d8f48a";
    g.beginPath(); g.ellipse(cx + 6, cy - 34, 7, 8, 0.18, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#1e4d2c";
    for (i = 0; i < 6; i++) {
      a = (i / 6) * Math.PI * 2;
      g.beginPath();
      g.arc(cx + 8 + Math.cos(a) * 7, cy - 30 + Math.sin(a) * 8, 1.5, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "rgba(255,255,255,.5)";
    g.beginPath(); g.ellipse(cx - 42, cy - 42, 24, 12, -0.5, 0, Math.PI * 2); g.fill();
  });

  var towerTex = canvasTex(256, 512, function (g, w, h) {
    var y, i, band, x;
    g.fillStyle = "#f4e6d0";
    g.fillRect(0, 0, w, h);
    for (y = 0; y < h; y += 40) {
      band = (y / 40) % 2 === 0;
      g.fillStyle = band ? "#f8efe2" : "#ead4b6";
      g.fillRect(0, y, w, 38);
      g.fillStyle = "rgba(255,255,255,.22)";
      g.fillRect(0, y + 2, w, 7);
      g.fillStyle = "#d4a84a";
      g.fillRect(0, y + 35, w, 3);
      g.fillStyle = "rgba(255, 236, 180, 0.65)";
      g.fillRect(0, y + 35, w, 1);
      if (!band) {
        g.fillStyle = "rgba(46, 90, 58, 0.32)";
        g.fillRect(0, y + 10, w, 3);
      }
      for (x = 0; x < w; x += 18) {
        g.fillStyle = "rgba(140, 96, 48, 0.06)";
        g.fillRect(x + (y % 12), y + 6, 2, 26);
      }
    }
    g.strokeStyle = "rgba(180, 150, 110, .22)";
    g.lineWidth = 2;
    for (i = 0; i < 10; i++) {
      g.beginPath();
      g.moveTo(8 + i * 26, 0);
      g.lineTo(8 + i * 26, h);
      g.stroke();
    }
  });
  towerTex.wrapS = towerTex.wrapT = THREE.RepeatWrapping;
  towerTex.repeat.set(1, 8);

  function paintWood(g, w, h, c0, c1, c2) {
    var i, x, y;
    g.fillStyle = c0;
    g.fillRect(0, 0, w, h);
    for (i = 0; i < 30; i++) {
      y = (i / 30) * h;
      g.strokeStyle = i % 2 ? c1 : c2;
      g.globalAlpha = 0.38;
      g.lineWidth = 2 + (i % 3);
      g.beginPath();
      g.moveTo(0, y);
      for (x = 0; x <= w; x += 14) g.lineTo(x, y + Math.sin(x * 0.07 + i * 0.8) * 5);
      g.stroke();
    }
    g.globalAlpha = 1;
    for (i = 0; i < 90; i++) {
      g.fillStyle = "rgba(70,36,10,0.07)";
      g.fillRect((i * 19) % w, (i * 47) % h, 2, 9);
    }
  }
  var woodTex = canvasTex(256, 128, function (g, w, h) {
    paintWood(g, w, h, "#c9955a", "#a06a38", "#e8c48a");
    g.fillStyle = "rgba(255, 220, 150, 0.16)";
    g.fillRect(0, 0, w, 10);
  });
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
  var woodDarkTex = canvasTex(256, 128, function (g, w, h) {
    paintWood(g, w, h, "#7a4a28", "#5a3018", "#a06a3c");
    g.fillStyle = "rgba(0,0,0,0.12)";
    g.fillRect(0, h * 0.7, w, h * 0.3);
  });
  woodDarkTex.wrapS = woodDarkTex.wrapT = THREE.RepeatWrapping;

  var cloudTex = canvasTex(128, 128, function (g, w, h) {
    var blobs = [[64, 78, 34], [36, 74, 26], [92, 74, 28], [64, 50, 30], [48, 56, 22], [82, 54, 24], [64, 92, 18]];
    var i, b, grd;
    g.clearRect(0, 0, w, h);
    for (i = 0; i < blobs.length; i++) {
      b = blobs[i];
      grd = g.createRadialGradient(b[0], b[1], 2, b[0], b[1], b[2]);
      grd.addColorStop(0, "rgba(255,255,255,0.95)");
      grd.addColorStop(0.55, "rgba(255,250,246,0.7)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd;
      g.beginPath(); g.arc(b[0], b[1], b[2], 0, Math.PI * 2); g.fill();
    }
  });

  var blobTex = canvasTex(64, 64, function (g, w, h) {
    var grd = g.createRadialGradient(32, 32, 3, 32, 32, 30);
    grd.addColorStop(0, "rgba(40,18,8,0.55)");
    grd.addColorStop(0.45, "rgba(40,18,8,0.2)");
    grd.addColorStop(1, "rgba(40,18,8,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });

  var sparkTex = canvasTex(32, 32, function (g) {
    var grd = g.createRadialGradient(16, 16, 1, 16, 16, 14);
    grd.addColorStop(0, "rgba(255,248,220,1)");
    grd.addColorStop(0.35, "rgba(255,214,120,0.7)");
    grd.addColorStop(1, "rgba(255,200,80,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 32);
  });

  var lanternTex = canvasTex(64, 80, function (g, w, h) {
    var grd = g.createRadialGradient(32, 40, 4, 32, 40, 28);
    grd.addColorStop(0, "#ffe9a0");
    grd.addColorStop(0.45, "#ff8a4a");
    grd.addColorStop(1, "rgba(180,40,10,0)");
    g.fillStyle = grd;
    g.beginPath(); g.ellipse(32, 42, 20, 26, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#c47820";
    g.fillRect(24, 12, 16, 6);
    g.fillRect(26, 68, 12, 5);
    g.strokeStyle = "rgba(120,40,10,.35)";
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(32, 18); g.lineTo(32, 66); g.stroke();
  });

  var mats = {
    nori: stdMat({ map: noriTex, color: 0xffffff, metalness: 0.06, roughness: 0.68 }),
    cap: stdMat({ map: capTex, metalness: 0.05, roughness: 0.52 }),
    tower: stdMat({ map: towerTex, color: 0xffffff, metalness: 0.08, roughness: 0.46 }),
    plat: stdMat({ map: woodTex, color: 0xf0d8b4, side: THREE.DoubleSide, metalness: 0.12, roughness: 0.42 }),
    platTop: stdMat({ map: woodTex, color: 0xfff1dc, side: THREE.DoubleSide, metalness: 0.14, roughness: 0.38 }),
    platEdge: stdMat({ color: 0xe8dcc4, side: THREE.DoubleSide, metalness: 0.06, roughness: 0.55 }),
    spike: stdMat({ color: 0xff3d5c, emissive: 0xff2040, emissiveIntensity: 0.25, metalness: 0.2, roughness: 0.32 }),
    spikeDark: stdMat({ color: 0x2a2428, side: THREE.DoubleSide, metalness: 0.18, roughness: 0.5 }),
    spikeGlow: new THREE.MeshBasicMaterial({ color: 0xff4466, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false }),
    spring: stdMat({ color: 0x7ee8a0, metalness: 0.1, roughness: 0.4 }),
    springDk: stdMat({ color: 0x3cb86a, side: THREE.DoubleSide, metalness: 0.1, roughness: 0.45 }),
    springCap: stdMat({ color: 0xd4ff90, emissive: 0x6ab030, emissiveIntensity: 0.15, metalness: 0.12, roughness: 0.35 }),
    mace: stdMat({ color: 0xff3b6b, metalness: 0.22, roughness: 0.36 }),
    maceArm: stdMat({ color: 0x6d5c7a, metalness: 0.35, roughness: 0.48 }),
    metal: stdMat({ color: 0xcfd8dc, metalness: 0.55, roughness: 0.35 }),
    gold: stdMat({ color: 0xe8c35a, metalness: 0.72, roughness: 0.28, emissive: 0x5a3a10, emissiveIntensity: 0.12 }),
    rice: stdMat({ color: 0xfff6ea, metalness: 0.05, roughness: 0.55 }),
    sesame: stdMat({ color: 0xf5f0e0, metalness: 0.05, roughness: 0.6 }),
    roe: stdMat({ color: 0xff5ea8, emissive: 0x6a1038, emissiveIntensity: 0.4, metalness: 0.08, roughness: 0.42 }),
    roeHi: new THREE.MeshBasicMaterial({ color: 0xffc4e0 }),
    jet: stdMat({ color: 0x41e0a0, emissive: 0x0a6a40, emissiveIntensity: 0.4, metalness: 0.15, roughness: 0.4 }),
    jetCap: stdMat({ color: 0xffe082, metalness: 0.2, roughness: 0.36 }),
    flame: new THREE.MeshBasicMaterial({ color: 0xff9100, transparent: true, opacity: 0.9 }),
    flame2: new THREE.MeshBasicMaterial({ color: 0xffe082, transparent: true, opacity: 0.85 }),
    cloud: new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: 0.9, depthWrite: false, color: 0xfff8f0 }),
    lantern: new THREE.MeshBasicMaterial({ map: lanternTex, transparent: true, opacity: 0.92, depthWrite: false }),
    shadow: new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity: 0.9, depthWrite: false }),
    base: stdMat({ map: woodDarkTex, color: 0xffffff, metalness: 0.08, roughness: 0.55 }),
    baseDk: stdMat({ color: 0xb08968, metalness: 0.1, roughness: 0.5 }),
    wasabi: stdMat({ color: 0x9ccc65, metalness: 0.08, roughness: 0.48 })
  };

  var geoCache = {};
  function platGeo(half) {
    var key = "p" + Math.round(half * 100);
    if (geoCache[key]) return geoCache[key];
    var shape = new THREE.Shape();
    var segs = 16, i, a, x, y;
    for (i = 0; i <= segs; i++) {
      a = -half + (2 * half * i) / segs;
      x = Math.sin(a) * PLAT_OUT;
      y = Math.cos(a) * PLAT_OUT;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    for (i = segs; i >= 0; i--) {
      a = -half + (2 * half * i) / segs;
      x = Math.sin(a) * PLAT_IN;
      y = Math.cos(a) * PLAT_IN;
      shape.lineTo(x, y);
    }
    var g = new THREE.ExtrudeGeometry(shape, {
      depth: PLAT_THICK,
      bevelEnabled: true,
      bevelThickness: 0.045,
      bevelSize: 0.045,
      bevelSegments: 1
    });
    g.rotateX(-Math.PI / 2);
    g.rotateY(Math.PI);
    g.translate(0, -PLAT_THICK, 0);
    geoCache[key] = g;
    return g;
  }

  var towerSegs = [];
  var SEG_H = 72;
  var towerFillMat = stdMat({ color: 0xf2e4cc, metalness: 0.06, roughness: 0.55 });
  function makeTowerSeg() {
    var wrap = new THREE.Group();
    var mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(TOWER_R, TOWER_R, SEG_H, 40, 1, true),
      mats.tower
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    var fill = new THREE.Mesh(
      new THREE.CylinderGeometry(TOWER_R - 0.04, TOWER_R - 0.04, SEG_H, 20),
      towerFillMat
    );
    fill.receiveShadow = true;
    wrap.add(fill);
    wrap.add(mesh);
    towerGroup.add(wrap);
    towerSegs.push(wrap);
    return wrap;
  }
  makeTowerSeg();
  makeTowerSeg();

  var capBot = new THREE.Mesh(new THREE.CircleGeometry(TOWER_R, 40), mats.base);
  capBot.rotation.x = Math.PI / 2;
  capBot.position.y = 0.02;
  capBot.receiveShadow = true;
  towerGroup.add(capBot);

  var base = new THREE.Mesh(new THREE.CylinderGeometry(TOWER_R + 1.55, TOWER_R + 1.7, 0.42, 32), mats.base);
  base.position.y = -0.18;
  base.castShadow = true;
  base.receiveShadow = true;
  towerGroup.add(base);
  var baseRim = new THREE.Mesh(new THREE.CylinderGeometry(TOWER_R + 1.78, TOWER_R + 1.78, 0.12, 32), mats.gold);
  baseRim.position.y = 0.06;
  towerGroup.add(baseRim);
  var baseGold = new THREE.Mesh(new THREE.TorusGeometry(TOWER_R + 1.62, 0.04, 8, 40), mats.gold);
  baseGold.rotation.x = Math.PI / 2;
  baseGold.position.y = 0.05;
  towerGroup.add(baseGold);

  var goldRings = [];
  (function makeGoldRings() {
    var i, ring, geo;
    geo = new THREE.TorusGeometry(TOWER_R + 0.028, 0.02, 6, 36);
    for (i = 0; i < 12; i++) {
      ring = new THREE.Mesh(geo, mats.gold);
      ring.rotation.x = Math.PI / 2;
      towerGroup.add(ring);
      goldRings.push(ring);
    }
  })();
  function placeGoldRings() {
    var step = 8;
    var baseY = Math.floor((player.y - 6) / step) * step;
    var i;
    for (i = 0; i < goldRings.length; i++) goldRings[i].position.y = baseY + i * step + 4;
  }

  /* ---------- sushi roll ---------- */
  var roll = new THREE.Group();
  var rollBody = new THREE.Mesh(
    new THREE.CylinderGeometry(PLAYER_R, PLAYER_R, PLAYER_H, 28),
    [mats.nori, mats.cap, mats.cap]
  );
  roll.add(rollBody);
  rollBody.castShadow = true;
  rollBody.receiveShadow = true;
  var riceLip = new THREE.Mesh(
    new THREE.TorusGeometry(PLAYER_R * 0.86, 0.035, 8, 24),
    mats.rice
  );
  riceLip.rotation.x = Math.PI / 2;
  riceLip.position.y = PLAYER_H * 0.42;
  roll.add(riceLip);
  var riceLip2 = riceLip.clone();
  riceLip2.position.y = -PLAYER_H * 0.42;
  roll.add(riceLip2);
  var sesGeo = new THREE.SphereGeometry(0.035, 6, 5);
  var si;
  for (si = 0; si < 10; si++) {
    var sm = new THREE.Mesh(sesGeo, mats.sesame);
    var sa = (si / 10) * Math.PI * 2 + 0.2;
    sm.position.set(Math.sin(sa) * (PLAYER_R + 0.01), (si % 3 - 1) * 0.12, Math.cos(sa) * (PLAYER_R + 0.01));
    roll.add(sm);
  }
  var sheen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.1, PLAYER_H * 0.52),
    new THREE.MeshBasicMaterial({ color: 0xd8f0c8, transparent: true, opacity: 0.22, depthWrite: false })
  );
  sheen.position.set(-0.16, 0.04, PLAYER_R + 0.006);
  roll.add(sheen);
  function cuteEye(ox) {
    var e = new THREE.Mesh(
      new THREE.CircleGeometry(0.095, 14),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    e.position.set(ox, 0.055, PLAYER_R + 0.012);
    var pupil = new THREE.Mesh(
      new THREE.CircleGeometry(0.046, 12),
      new THREE.MeshBasicMaterial({ color: 0x2a1810 })
    );
    pupil.position.set(-ox * 0.12, -0.012, 0.006);
    e.add(pupil);
    var hi = new THREE.Mesh(
      new THREE.CircleGeometry(0.016, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    hi.position.set(-0.012, 0.014, 0.008);
    pupil.add(hi);
    roll.add(e);
    return e;
  }
  cuteEye(-0.13);
  cuteEye(0.13);
  var flameG = new THREE.Group();
  flameG.visible = false;
  var fl1 = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 8), mats.flame);
  fl1.rotation.x = Math.PI;
  fl1.position.y = -PLAYER_H * 0.55;
  flameG.add(fl1);
  var fl2 = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 8), mats.flame2);
  fl2.rotation.x = Math.PI;
  fl2.position.y = -PLAYER_H * 0.62;
  flameG.add(fl2);
  roll.add(flameG);
  var blob = new THREE.Mesh(new THREE.CircleGeometry(0.58, 20), mats.shadow);
  blob.rotation.x = -Math.PI / 2;
  scene.add(blob);
  scene.add(roll);

  /* ---------- clouds ---------- */
  (function spawnClouds() {
    var i, j, g, p, s, side;
    for (i = 0; i < 12; i++) {
      g = new THREE.Group();
      s = 0.85 + Math.random() * 1.25;
      for (j = 0; j < 2; j++) {
        p = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.1), mats.cloud);
        p.position.set((j - 0.5) * 0.85, j * 0.18, j * 0.04);
        p.scale.set(1 - j * 0.12, 1 - j * 0.08, 1);
        g.add(p);
      }
      g.scale.set(s, s, 1);
      side = Math.random() < 0.5 ? -1 : 1;
      g.position.set(
        side * (7 + Math.random() * 12),
        Math.random() * 40,
        -9 - Math.random() * 14
      );
      g.userData.baseX = g.position.x;
      g.userData.offY = Math.random() * 44;
      g.userData.ph = Math.random() * Math.PI * 2;
      scene.add(g);
      clouds.push(g);
    }
  })();

  (function spawnLanterns() {
    var i, m, side;
    for (i = 0; i < 7; i++) {
      m = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), mats.lantern);
      side = i % 2 ? -1 : 1;
      m.position.set(side * (5.5 + (i % 3) * 1.8), i * 5.5, -7 - (i % 4) * 2.2);
      m.userData.baseX = m.position.x;
      m.userData.offY = 8 + i * 6;
      m.userData.ph = i * 0.9;
      scene.add(m);
      lanterns.push(m);
    }
  })();

  var sparkCount = 42;
  var sparkPos = new Float32Array(sparkCount * 3);
  (function spawnSparks() {
    var i, a, r;
    for (i = 0; i < sparkCount; i++) {
      a = Math.random() * Math.PI * 2;
      r = 4.2 + Math.random() * 9;
      sparkPos[i * 3] = Math.sin(a) * r;
      sparkPos[i * 3 + 1] = Math.random() * 40;
      sparkPos[i * 3 + 2] = Math.cos(a) * r - 2;
    }
  })();
  var sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
  var sparkMat = new THREE.PointsMaterial({
    map: sparkTex, size: 0.14, transparent: true, opacity: 0.8,
    depthWrite: false, sizeAttenuation: true, color: 0xfff2c8
  });
  var sparkles = new THREE.Points(sparkGeo, sparkMat);
  scene.add(sparkles);

  /* ---------- builders ---------- */
  function makeSpikes(half, parent) {
    var n = Math.max(3, Math.round(half * 7));
    var i, cone, a, rm, glow;
    rm = (PLAT_IN + PLAT_OUT) * 0.5;
    for (i = 0; i < n; i++) {
      a = -half + (2 * half * (i + 0.5)) / n;
      cone = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.38, 7), mats.spike);
      cone.position.set(Math.sin(a) * rm, 0.2, Math.cos(a) * rm);
      parent.add(cone);
    }
    glow = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.02, 6, 18), mats.spikeGlow);
    glow.rotation.x = Math.PI / 2;
    glow.position.set(0, 0.21, rm);
    parent.add(glow);
  }

  function makeSpring(parent) {
    var g = new THREE.Group();
    var i, t;
    for (i = 0; i < 5; i++) {
      t = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 6, 14), i % 2 ? mats.spring : mats.springDk);
      t.rotation.x = Math.PI / 2;
      t.position.y = 0.12 + i * 0.1;
      g.add(t);
    }
    var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 12), mats.springCap);
    cap.position.y = 0.62;
    g.add(cap);
    var flash = new THREE.Mesh(
      new THREE.CircleGeometry(0.34, 14),
      new THREE.MeshBasicMaterial({ color: 0xe8ffb0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
    );
    flash.rotation.x = -Math.PI / 2;
    flash.position.y = 0.64;
    g.add(flash);
    g.userData.flash = flash;
    g.position.set(0, 0, (PLAT_IN + PLAT_OUT) * 0.5);
    parent.add(g);
    return g;
  }

  function makeMace(y, ang) {
    var g = new THREE.Group();
    g.position.y = y + 0.55;
    g.rotation.y = ang;
    var arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.55, 8), mats.maceArm);
    arm.rotation.z = Math.PI / 2;
    arm.position.x = 0.78;
    g.add(arm);
    var hub = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), mats.metal);
    g.add(hub);
    var ball = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), mats.mace);
    ball.position.x = 1.55;
    g.add(ball);
    var k, sp, sa;
    for (k = 0; k < 8; k++) {
      sp = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 6), mats.spike);
      sa = (k / 8) * Math.PI * 2;
      sp.position.set(1.55 + Math.cos(sa) * 0.28, Math.sin(sa) * 0.28, 0);
      sp.rotation.z = sa - Math.PI / 2;
      g.add(sp);
    }
    g.userData.ball = ball;
    g.userData.phase = rand() * Math.PI * 2;
    g.userData.speed = 1.4 + rand() * 1.1;
    g.userData.amp = 0.7 + rand() * 0.5;
    g.userData.baseAng = ang;
    towerGroup.add(g);
    maces.push(g);
    return g;
  }

  function makeRoe(y, ang) {
    var g = new THREE.Group();
    var s = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), mats.roe);
    g.add(s);
    var hi = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), mats.roeHi);
    hi.position.set(-0.05, 0.06, 0.06);
    g.add(hi);
    var r = (PLAT_IN + PLAT_OUT) * 0.5;
    g.position.set(Math.sin(ang) * r, y + 0.72, Math.cos(ang) * r);
    g.userData.ang = ang;
    g.userData.y = y + 0.72;
    g.userData.ph = rand() * 6;
    g.userData.alive = true;
    towerGroup.add(g);
    pickups.push(g);
    return g;
  }

  function makeJet(y, ang) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.42, 10), mats.jet);
    body.rotation.x = Math.PI / 2;
    g.add(body);
    var nose = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.22, 10), mats.jetCap);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 0.28;
    g.add(nose);
    var r = (PLAT_IN + PLAT_OUT) * 0.5;
    g.position.set(Math.sin(ang) * r, y + 0.85, Math.cos(ang) * r);
    g.userData.ang = ang;
    g.userData.y = y + 0.85;
    g.userData.kind = "jet";
    g.userData.ph = rand() * 6;
    g.userData.alive = true;
    towerGroup.add(g);
    pickups.push(g);
    return g;
  }

  function addPlatform(floor, ang, half, type) {
    var y = floor * FLOOR_H;
    var g = new THREE.Group();
    var mesh = new THREE.Mesh(platGeo(half), type === "spike" ? mats.spikeDark : type === "spring" ? mats.springDk : mats.plat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    var top = new THREE.Mesh(
      platGeo(Math.max(0.12, half - 0.04)),
      type === "spike" ? mats.spike : type === "spring" ? mats.spring : mats.platTop
    );
    top.position.y = 0.02;
    top.scale.set(0.92, 1, 0.92);
    top.castShadow = true;
    top.receiveShadow = true;
    g.add(top);
    if (type === "spike") makeSpikes(half, g);
    if (type === "spring") g.userData.spr = makeSpring(g);
    g.rotation.y = ang;
    g.position.y = y;
    towerGroup.add(g);
    var p = { y: y, ang: ang, half: half, type: type, mesh: g, floor: floor, alive: true };
    platforms.push(p);
    return p;
  }

  function pickHalf(n, diff, style) {
    var t = clamp((n - 2) / 28, 0, 1);
    if (style === "wide") return lerp(0.62, 0.40, t);
    if (style === "thin") return lerp(0.22, 0.13, t);
    return lerp(0.40, 0.24, t);
  }

  function pickStep(n) {
    var r = rand(), step;
    if (n <= 2) return 0.28 + rand() * 0.22;
    if (r < 0.20) step = 0.20 + rand() * 0.14;
    else if (r < 0.45) step = 0.46 + rand() * 0.22;
    else if (r < 0.75) step = 0.78 + rand() * 0.28;
    else step = 1.12 + rand() * 0.28;
    return Math.min(MAX_TURN, step);
  }

  function pickStyle() {
    var r = rand();
    if (r < 0.28) return "wide";
    if (r < 0.55) return "thin";
    return "mid";
  }

  function buildFloor(n) {
    var diff = clamp(n / 36, 0, 1);
    var half, ang, step, kind, r, near, far, aSafe, aTrap, hSafe, hTrap, dir;
    if (n === 0) {
      addPlatform(0, 0, 0.95, "safe");
      lastSafeAng = 0;
      stairDir = 1;
      return;
    }

    r = rand();
    if (n <= 2) kind = "go";
    else if (n === 3) kind = "go";
    else if (r < 0.22) kind = "go";
    else if (r < 0.38) kind = "hold";
    else if (r < 0.52) kind = "nudge";
    else if (r < 0.64) kind = "flip";
    else if (r < 0.78) kind = "decoyNear";
    else if (r < 0.90) kind = "decoyFar";
    else kind = "fork";

    if (n > 6 && n % 9 === 4 && kind === "go") kind = "spring";

    dir = stairDir;
    if (kind === "flip") {
      stairDir *= -1;
      dir = stairDir;
    }

    if (kind === "nudge") step = 0.18 + rand() * 0.16;
    else if (kind === "hold") step = 0.95 + rand() * 0.40;
    else step = pickStep(n);
    step = Math.min(MAX_TURN, step);

    var paired = false;
    if (kind === "decoyNear" || kind === "decoyFar") {
      hTrap = Math.min(0.34, pickHalf(n, diff, "mid"));
      hSafe = Math.min(0.24, pickHalf(n, diff, "thin"));
      near = 0.32 + rand() * 0.18;
      var gap = 0.45;
      var need = hTrap + hSafe + gap;
      far = near + need;
      if (far > MAX_TURN) kind = "fork";
      else {
        if (kind === "decoyNear") {
          aTrap = lastSafeAng + dir * near;
          aSafe = lastSafeAng + dir * far;
        } else {
          aSafe = lastSafeAng + dir * near;
          aTrap = lastSafeAng + dir * far;
        }
        addPlatform(n, aTrap, hTrap, "spike");
        addPlatform(n, aSafe, hSafe, "safe");
        lastSafeAng = aSafe;
        ang = aSafe;
        paired = true;
      }
    }
    if (!paired && kind === "fork") {
      hTrap = Math.min(0.36, pickHalf(n, diff, "mid"));
      hSafe = Math.min(0.24, pickHalf(n, diff, "thin"));
      aTrap = lastSafeAng + dir * Math.min(MAX_TURN, 0.70 + rand() * 0.40);
      aSafe = lastSafeAng - dir * Math.min(MAX_TURN, 0.70 + rand() * 0.40);
      addPlatform(n, aTrap, hTrap, "spike");
      addPlatform(n, aSafe, hSafe, rand() < 0.2 ? "spring" : "safe");
      lastSafeAng = aSafe;
      stairDir = -dir;
      ang = aSafe;
      paired = true;
    }
    if (!paired) {
      half = n <= 2 ? 0.50 : pickHalf(n, diff, pickStyle());
      ang = lastSafeAng + dir * step;
      addPlatform(n, ang, half, kind === "spring" ? "spring" : "safe");
      lastSafeAng = ang;
    }

    if (kind !== "decoyNear" && kind !== "decoyFar" && kind !== "fork" && rand() < 0.36) {
      makeRoe(n * FLOOR_H, ang);
    }
    if (n > 12 && n % 17 === 8) makeJet(n * FLOOR_H, ang);
    if (n > 9 && n % 8 === 3) makeMace(n * FLOOR_H, ang + 1.35);
    if (n > 22 && n % 13 === 2) makeMace(n * FLOOR_H, ang - 1.4);
  }

  function ensureFloors() {
    var need = Math.floor(player.y / FLOOR_H) + 16;
    while (genFloor <= need) {
      buildFloor(genFloor);
      genFloor++;
    }
    var i, p, cut = player.y - 16;
    for (i = platforms.length - 1; i >= 0; i--) {
      p = platforms[i];
      if (p.y < cut) {
        towerGroup.remove(p.mesh);
        p.alive = false;
        platforms.splice(i, 1);
      }
    }
    for (i = pickups.length - 1; i >= 0; i--) {
      if (pickups[i].userData.y < cut || !pickups[i].userData.alive) {
        towerGroup.remove(pickups[i]);
        pickups.splice(i, 1);
      }
    }
    for (i = maces.length - 1; i >= 0; i--) {
      if (maces[i].position.y < cut) {
        towerGroup.remove(maces[i]);
        maces.splice(i, 1);
      }
    }
  }

  function placeTowerSegs() {
    var base = Math.floor((player.y - 10) / SEG_H) * SEG_H;
    towerSegs[0].position.y = base + SEG_H * 0.5;
    towerSegs[1].position.y = base + SEG_H * 1.5;
    placeGoldRings();
  }

  /* ---------- particles ---------- */
  var pGeo = new THREE.SphereGeometry(1, 6, 5);
  function burst(x, y, z, color, n, spd) {
    var i, m, a;
    n = n || 8;
    while (particles.length > 70) {
      scene.remove(particles[0]);
      particles.shift();
    }
    for (i = 0; i < n; i++) {
      m = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({
        color: color, transparent: true, opacity: 1
      }));
      m.position.set(x, y, z);
      a = rand() * Math.PI * 2;
      m.userData.vx = Math.cos(a) * (spd || 1.8) * rand();
      m.userData.vy = 1.2 + rand() * 2.4;
      m.userData.vz = Math.sin(a) * (spd || 1.8) * rand();
      m.userData.life = 0.35 + rand() * 0.35;
      m.userData.max = m.userData.life;
      m.scale.setScalar(0.04 + rand() * 0.06);
      scene.add(m);
      particles.push(m);
    }
  }
  function updateParticles(dt) {
    var i, p;
    for (i = particles.length - 1; i >= 0; i--) {
      p = particles[i];
      p.userData.life -= dt;
      p.userData.vy -= 8 * dt;
      p.position.x += p.userData.vx * dt;
      p.position.y += p.userData.vy * dt;
      p.position.z += p.userData.vz * dt;
      p.material.opacity = Math.max(0, p.userData.life / p.userData.max);
      p.scale.multiplyScalar(0.98);
      if (p.userData.life <= 0) {
        scene.remove(p);
        particles.splice(i, 1);
      }
    }
  }

  /* ---------- HUD ---------- */
  function setLives() {
    var s = "", i;
    for (i = 0; i < START_LIVES; i++) s += i < lives ? "❤ " : "♡ ";
    livesEl.textContent = s.trim();
  }
  function popGain(n) {
    scorePop.textContent = "+" + n;
    scorePop.classList.remove("show");
    void scorePop.offsetWidth;
    scorePop.classList.add("show");
    popT = 0.7;
  }
  function showBanner(text) {
    bannerEl.textContent = text;
    bannerEl.classList.remove("show");
    void bannerEl.offsetWidth;
    bannerEl.classList.add("show");
  }
  function updateHud(dt) {
    shownScore = lerp(shownScore, score, 1 - Math.pow(0.001, dt));
    var n = Math.round(shownScore);
    scoreEl.textContent = n < 10000 ? String(n).padStart(4, "0") : String(n);
    roeEl.textContent = String(roe);
    altEl.textContent = "↑ " + Math.floor(Math.max(0, maxY)) + "М";
    if (combo >= 2) {
      flowEl.classList.add("on");
      flowN.textContent = String(combo);
    } else flowEl.classList.remove("on");
    if (popT > 0) {
      popT -= dt;
      if (popT <= 0) scorePop.classList.remove("show");
    }
    if (hintT > 0 && mode === "play") {
      hintT -= dt;
      hintEl.style.opacity = hintT < 1.2 ? String(hintT / 1.2) : "1";
      if (hintT <= 0) hintEl.style.display = "none";
    }
  }

  /* ---------- game flow ---------- */
  function resetRun() {
    var i;
    for (i = platforms.length - 1; i >= 0; i--) towerGroup.remove(platforms[i].mesh);
    for (i = pickups.length - 1; i >= 0; i--) towerGroup.remove(pickups[i]);
    for (i = maces.length - 1; i >= 0; i--) towerGroup.remove(maces[i]);
    platforms.length = 0;
    pickups.length = 0;
    maces.length = 0;
    rngSeed = (Date.now() % 2147483646) + 1;
    genFloor = 0;
    lastSafeAng = 0;
    stairDir = 1;
    score = 0; shownScore = 0; combo = 0; maxCombo = 0; roe = 0;
    lives = START_LIVES;
    maxY = 0; lastLandY = 0; lastLandAng = 0; zoneIdx = 0; shownZone = -1;
    invuln = 0; jetT = 0; shake = 0; hurtFlash = 0;
    player.y = 1.15; player.vy = 0; player.prevY = 1.15;
    player.squash = 1; player.spin = 0; player.dead = false;
    towerRot = 0; rotVel = 0;
    flameG.visible = false;
    setLives();
    ensureFloors();
    overlay.classList.remove("lose");
    ovTitle.textContent = "РОЛЛ ВВЕРХ";
    ovTag.textContent = "Крути башню · ролл прыгает сам";
    ovMsg.textContent = "Крути цилиндр, чтобы площадка оказалась под роллом. Не прыгай — он прыгает сам. Колючки и булавы — мимо.";
    ovStats.textContent = "";
    ovGo.textContent = "Нажми, чтобы начать";
  }

  function startPlay() {
    if (mode === "play") return;
    ensureAudio();
    sfx("start");
    if (mode === "dead" || mode === "menu") resetRun();
    mode = "play";
    overlay.classList.add("hidden");
    hintEl.style.display = "";
    hintT = 5.5;
    hintEl.style.opacity = "1";
    player.vy = BOUNCE_V * 0.55;
    showBanner(ZONES[0].name);
    shownZone = 0;
    sfx("zone");
  }

  function gameOver() {
    mode = "dead";
    player.dead = true;
    sfx("lose");
    overlay.classList.remove("hidden");
    overlay.classList.add("lose");
    ovTitle.textContent = "Ролл упал!";
    ovTag.textContent = "Башня крутится · ролл прыгает сам";
    ovMsg.textContent = "Не попал на площадку или задел шипы.";
    ovStats.textContent = "Счёт " + score + "  ·  " + Math.floor(maxY) + " м  ·  флоу ×" + maxCombo;
    ovGo.textContent = "Ещё раз";
  }

  function standOnLastSafe() {
    towerRot = wrapPi(-lastLandAng);
    rotVel = 0;
    player.y = lastLandY + PLAT_TOP_OFF + PLAYER_H * 0.5 + 0.02;
    player.vy = 0;
    player.prevY = player.y;
    player.squash = 1;
  }

  function hurt(reason) {
    if (invuln > 0 || jetT > 0 || mode !== "play") return;
    lives -= 1;
    setLives();
    invuln = 1.35;
    hurtFlash = 0.22;
    shake = 0.45;
    combo = 0;
    hurtEl.classList.add("on");
    sfx("hurt");
    burst(0, player.y, PLAYER_Z, 0xff4d6a, 12, 2.6);
    if (lives <= 0) {
      player.vy = -2;
      gameOver();
    } else if (reason === "fall") {
      standOnLastSafe();
    } else if (reason === "spike") {
      player.vy = Math.min(player.vy, -6);
    } else {
      player.vy = BOUNCE_V * 0.85;
    }
  }

  function landOn(p) {
    var platTop = p.y + PLAT_TOP_OFF;
    player.y = platTop + PLAYER_H * 0.5 + 0.02;
    lastLandY = p.y;
    lastLandAng = p.ang;
    var boost = p.type === "spring";
    player.vy = boost ? SPRING_V : BOUNCE_V;
    player.squash = boost ? 0.55 : 0.68;
    combo += 1;
    if (combo > maxCombo) maxCombo = combo;
    var gain = Math.round((boost ? 50 : 25) * (1 + Math.min(combo, 24) * 0.07));
    score += gain;
    popGain(gain);
    sfx(boost ? "spring" : "bounce");
    shake = boost ? 0.28 : 0.12;
    burst(0, platTop + 0.08, PLAYER_Z, boost ? 0x9eef88 : 0xffe2b0, boost ? 14 : 8, boost ? 3 : 1.6);
    if (p.mesh) {
      p.mesh.scale.y = 0.7;
      if (boost && p.mesh.userData.spr && p.mesh.userData.spr.userData.flash) {
        p.mesh.userData.spr.userData.flash.material.opacity = 0.75;
      }
    }
  }

  function angHit(p) {
    var worldAng = wrapPi(p.ang + towerRot);
    return Math.abs(worldAng) <= p.half + ANG_PAD;
  }

  function tryLand() {
    if (player.vy >= 0) return;
    var feet = player.y - PLAYER_H * 0.5;
    var prevFeet = player.prevY - PLAYER_H * 0.5;
    var i, p, platTop;
    for (i = 0; i < platforms.length; i++) {
      p = platforms[i];
      if (!p.alive) continue;
      platTop = p.y + PLAT_TOP_OFF;
      if (prevFeet >= platTop - 0.04 && feet <= platTop + 0.08) {
        if (angHit(p)) {
          if (p.type === "spike") {
            hurt("spike");
            return;
          }
          landOn(p);
          return;
        }
      }
    }
  }

  function collectPickups() {
    var i, u, worldAng, dy, da, r;
    r = jetT > 0 ? 0.85 : 0.48;
    for (i = 0; i < pickups.length; i++) {
      u = pickups[i].userData;
      if (!u.alive) continue;
      worldAng = wrapPi(u.ang + towerRot);
      dy = Math.abs(u.y - player.y);
      da = Math.abs(worldAng);
      if (dy < r + 0.35 && da < 0.42) {
        u.alive = false;
        pickups[i].visible = false;
        if (u.kind === "jet") {
          player.vy = SPRING_V * 1.2;
          player.squash = 0.5;
          jetT = 0.45;
          invuln = Math.max(invuln, 0.45);
          flameG.visible = true;
          combo += 1;
          score += 80;
          popGain(80);
          sfx("jet");
          burst(0, player.y, PLAYER_Z, 0x41e0a0, 16, 3);
        } else {
          roe += 1;
          score += 15 + Math.min(combo, 10);
          popGain(15);
          sfx("roe");
          burst(0, player.y + 0.3, PLAYER_Z, 0xff5ea8, 10, 2.2);
        }
      }
    }
  }

  var _wp = new THREE.Vector3();
  function hitMaces(dt) {
    var i, m, ball, d;
    for (i = 0; i < maces.length; i++) {
      m = maces[i];
      m.rotation.y = m.userData.baseAng + Math.sin(time * m.userData.speed + m.userData.phase) * m.userData.amp;
      if (invuln > 0 || jetT > 0 || mode !== "play") continue;
      ball = m.userData.ball;
      ball.getWorldPosition(_wp);
      d = Math.hypot(_wp.x - 0, _wp.y - player.y, _wp.z - PLAYER_Z);
      if (d < 0.55 + 0.28) hurt("mace");
    }
  }

  function currentZone() {
    var i, z = 0;
    for (i = 0; i < ZONES.length; i++) if (maxY >= ZONES[i].y) z = i;
    return z;
  }

  var skyCol = new THREE.Color(ZONES[0].sky);
  var fogCol = new THREE.Color(ZONES[0].fog);
  var cloudTint = new THREE.Color(0xffffff);
  function updateAtmosphere(dt) {
    var z = currentZone();
    var zn = ZONES[z];
    var next = ZONES[Math.min(z + 1, ZONES.length - 1)];
    var span = (next.y - zn.y) || 1;
    var t = z === ZONES.length - 1 ? 0 : clamp((maxY - zn.y) / span, 0, 1);
    skyCol.copy(hexMix(zn.sky, next.sky, t * 0.85));
    fogCol.copy(hexMix(zn.fog, next.fog, t * 0.85));
    renderer.setClearColor(skyCol, 1);
    scene.fog.color.copy(fogCol);
    scene.fog.near = 18;
    scene.fog.far = 54;
    hemi.color.setHex(zn.hemi);
    hemi.groundColor.setHex(zn.ground);
    cloudTint.copy(hexMix(zn.sky, 0xffffff, 0.84));
    mats.cloud.color.copy(cloudTint);
    if (z !== zoneIdx && mode === "play") {
      zoneIdx = z;
      showBanner(zn.name);
      sfx("zone");
    }
  }

  /* ---------- input ---------- */
  function onDown(e) {
    if (mode !== "play") return;
    dragging = true;
    lastPX = e.clientX;
    lastPY = e.clientY;
  }
  function onMove(e) {
    if (!dragging || mode !== "play") return;
    var dx = e.clientX - lastPX;
    lastPX = e.clientX;
    lastPY = e.clientY;
    rotVel = dx * 0.55;
    towerRot += dx * 0.0095;
  }
  function onUp() { dragging = false; }

  renderer.domElement.addEventListener("pointerdown", onDown);
  addEventListener("pointermove", onMove);
  addEventListener("pointerup", onUp);
  addEventListener("pointercancel", onUp);
  renderer.domElement.addEventListener("touchstart", function (e) { e.preventDefault(); }, { passive: false });
  renderer.domElement.addEventListener("touchmove", function (e) { e.preventDefault(); }, { passive: false });

  overlay.addEventListener("click", function () { startPlay(); });
  overlay.addEventListener("touchend", function (e) { e.preventDefault(); startPlay(); }, { passive: false });

  addEventListener("keydown", function (e) {
    keys[e.code] = true;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].indexOf(e.code) >= 0) e.preventDefault();
    if ((e.code === "Enter" || e.code === "Space") && mode !== "play") startPlay();
  });
  addEventListener("keyup", function (e) { keys[e.code] = false; });
  addEventListener("blur", function () {
    keys = Object.create(null);
    dragging = false;
  });

  /* ---------- loop ---------- */
  resetRun();

  function tick(now) {
    requestAnimationFrame(tick);
    var dt = Math.min(0.033, (now - lastT) / 1000 || 0.016);
    lastT = now;
    time += dt;

    var left = keys.KeyA || keys.ArrowLeft;
    var right = keys.KeyD || keys.ArrowRight;
    if (mode === "play" || mode === "menu") {
      if (left) rotVel = KEY_ROT;
      else if (right) rotVel = -KEY_ROT;
      else if (!dragging) rotVel *= Math.pow(0.90, dt * 60);
      if (!dragging) towerRot += rotVel * dt;
    }
    towerGroup.rotation.y = towerRot;

    if (mode === "menu" || mode === "play") {
      if (mode === "menu") {
        player.vy -= GRAVITY * dt;
        player.prevY = player.y;
        player.y += player.vy * dt;
        tryLand();
        if (player.y < 0.4) { player.y = 0.4 + PLAYER_H * 0.5; player.vy = BOUNCE_V; }
      } else {
        player.vy -= GRAVITY * dt;
        if (jetT > 0) {
          jetT -= dt;
          flameG.visible = true;
          fl1.scale.y = 0.8 + Math.sin(time * 24) * 0.25;
          fl2.scale.y = 0.7 + Math.sin(time * 30 + 1) * 0.3;
          if (jetT <= 0) flameG.visible = false;
          if (Math.random() < 0.5) burst(0, player.y - 0.35, PLAYER_Z, 0xff9100, 1, 0.6);
        }
        player.prevY = player.y;
        player.y += player.vy * dt;
        tryLand();
        collectPickups();
        if (player.y < lastLandY - FLOOR_H * FALL_FLOORS) hurt("fall");
        if (Math.random() < (jetT > 0 ? 0.55 : 0.28)) {
          burst(0, player.y - PLAYER_H * 0.4, PLAYER_Z, jetT > 0 ? 0xff9100 : 0xffc0de, 1, 0.45);
        }
      }
    } else if (mode === "dead") {
      player.vy -= GRAVITY * dt * 0.7;
      player.y += player.vy * dt;
    }

    if (invuln > 0) invuln -= dt;
    if (hurtFlash > 0) {
      hurtFlash -= dt;
      if (hurtFlash <= 0) hurtEl.classList.remove("on");
    }
    player.squash = lerp(player.squash, 1, 1 - Math.pow(0.0008, dt));
    player.spin += dt * (jetT > 0 ? 8 : 1.6);

    if (player.y > maxY) maxY = player.y;
    ensureFloors();
    placeTowerSegs();
    hitMaces(dt);
    updateAtmosphere(dt);
    updateParticles(dt);

    var i, pk;
    for (i = 0; i < pickups.length; i++) {
      pk = pickups[i];
      if (!pk.userData.alive) continue;
      pk.position.y = pk.userData.y + Math.sin(time * 3 + pk.userData.ph) * 0.12;
      pk.rotation.y = time * 2.2 + pk.userData.ph;
    }
    for (i = 0; i < platforms.length; i++) {
      if (platforms[i].mesh.scale.y < 0.99) {
        platforms[i].mesh.scale.y = lerp(platforms[i].mesh.scale.y, 1, 1 - Math.pow(0.002, dt));
      }
      if (platforms[i].mesh.userData.spr && platforms[i].mesh.userData.spr.userData.flash) {
        var fls = platforms[i].mesh.userData.spr.userData.flash;
        if (fls.material.opacity > 0.01) {
          fls.material.opacity = lerp(fls.material.opacity, 0, 1 - Math.pow(0.0006, dt));
        }
      }
    }
    for (i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      var span = 48;
      var cy = player.y - 10 + ((c.userData.offY - player.y * 0.08) % span + span) % span;
      c.position.y = cy;
      c.position.x = c.userData.baseX + Math.sin(time * 0.15 + c.userData.ph) * 1.4;
    }
    for (i = 0; i < lanterns.length; i++) {
      var ln = lanterns[i];
      var lspan = 42;
      ln.position.y = player.y - 8 + ((ln.userData.offY - player.y * 0.06) % lspan + lspan) % lspan;
      ln.position.x = ln.userData.baseX + Math.sin(time * 0.4 + ln.userData.ph) * 0.35;
    }
    var si2, relY;
    for (si2 = 0; si2 < sparkCount; si2++) {
      relY = sparkPos[si2 * 3 + 1] - player.y;
      if (relY > 22) sparkPos[si2 * 3 + 1] -= 44;
      else if (relY < -22) sparkPos[si2 * 3 + 1] += 44;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkMat.opacity = 0.52 + Math.sin(time * 2.5) * 0.22;

    roll.position.set(0, player.y, PLAYER_Z);
    var sq = player.squash;
    var blink = (invuln > 0 && Math.floor(time * 18) % 2 === 0) ? 0.35 : 1;
    roll.visible = blink > 0.5 || invuln <= 0;
    roll.scale.set(2 - sq, sq, 2 - sq);
    roll.rotation.y = Math.sin(time * 2.4) * 0.15;
    roll.rotation.z = clamp(rotVel * 0.12, -0.38, 0.38);
    roll.rotation.x = player.vy > 2 ? -0.12 : player.vy < -2 ? 0.1 : 0;

    var shadowY = lastLandY + 0.03;
    blob.position.set(0, shadowY, PLAYER_Z);
    blob.scale.setScalar(clamp(1.15 - (player.y - lastLandY) * 0.12, 0.35, 1.2));
    blob.material.opacity = 0.82 * clamp(1.2 - (player.y - lastLandY) * 0.15, 0.15, 1);

    var camY = player.y;
    var shx = (Math.random() - 0.5) * shake * 0.25;
    var shy = (Math.random() - 0.5) * shake * 0.2;
    shake = Math.max(0, shake - dt * 2.4);
    camera.position.set(shx + Math.sin(time * 0.55) * 0.05, camY - 3.15 + shy + Math.cos(time * 0.62) * 0.025, 8.15);
    camera.lookAt(0, camY + 2.35, 0.2);

    sun.position.set(5.2, player.y + 11, 7.5);
    sun.target.position.set(0, player.y + 0.4, 0.3);
    fillLite.position.set(-6, player.y + 8, 3);
    rimLite.position.set(7.2, player.y + 4, 5.4);

    for (i = 0; i < clouds.length; i++) clouds[i].quaternion.copy(camera.quaternion);
    for (i = 0; i < lanterns.length; i++) lanterns[i].quaternion.copy(camera.quaternion);

    updateHud(dt);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(tick);
})();
