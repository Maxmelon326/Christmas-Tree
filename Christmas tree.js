import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import {
  Video,
  Hand,
  Volume2,
  VolumeX,
  RefreshCw,
  X,
  AlertTriangle,
  Palette,
} from "lucide-react";

/**
 * NOTE：浏览器安全限制决定了摄像头权限无法被“代码绕过”。
 * 最佳实践：在用户一次点击/触摸（手势）后自动发起 getUserMedia 请求。
 */

// -----------------------------
// Pure helper(s) for testing
// -----------------------------
export const computeTreeTopFromPositions = (positions) => {
  let maxY = -Infinity;
  const n = positions.length / 3;

  for (let i = 0; i < n; i++) {
    const y = positions[i * 3 + 1];
    if (y > maxY) maxY = y;
  }

  // Weighted center on a top band -> stable but still sits on apex center
  const band = 0.45;
  let sumX = 0,
    sumZ = 0,
    sumW = 0;

  for (let i = 0; i < n; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const d = maxY - y;
    if (d >= 0 && d <= band) {
      const w = 1 - d / band; // closer to maxY => higher weight
      sumX += x * w;
      sumZ += z * w;
      sumW += w;
    }
  }

  const cx = sumW > 0 ? sumX / sumW : 0;
  const cz = sumW > 0 ? sumZ / sumW : 0;

  return { x: cx, y: maxY, z: cz };
};

// -----------------------------
// Style presets (视觉不变，只用于切换按钮；不切换也不影响)
// -----------------------------
const STYLE_PRESETS = {
  warm: {
    name: "Classic Warm",
    bg: 0x02050a,
    fog: 0x02050a,
    fogDensity: 0.015,
    bloom: { strength: 2.2, radius: 0.4, threshold: 0.85 },
    tree: { size: 0.035, baseOpacity: 0.3 },
    ribbon: {
      size: 0.05,
      colorA: new THREE.Color("#FFE68A"),
      colorB: new THREE.Color("#FFCC33"),
    },
    snow: { size: 0.11, color: 0xffffff, opacity: 0.5 },
    treePalette: {
      green: new THREE.Color(0.12, 0.85, 0.26),
      red: new THREE.Color(1.0, 0.18, 0.14),
      gold: new THREE.Color(1.0, 0.82, 0.22),
    },
    lightColors: [0xff3333, 0x33ff33, 0xffcc33, 0xfff3d1, 0xffffff],
    star: {
      glow0: "rgba(255,245,210,1)",
      glow1: "rgba(255,215,120,0.55)",
      glow2: "rgba(255,180,60,0.14)",
      fill0: "rgba(255,255,245,1)",
      fill1: "rgba(255,220,130,1)",
      fill2: "rgba(200,140,30,1)",
      stroke: "rgba(255,255,255,0.45)",
    },
  },
  galaxy: {
    name: "Galaxy Neon",
    bg: 0x03061a,
    fog: 0x03061a,
    fogDensity: 0.012,
    bloom: { strength: 2.8, radius: 0.45, threshold: 0.72 },
    tree: { size: 0.03, baseOpacity: 0.28 },
    ribbon: {
      size: 0.045,
      colorA: new THREE.Color("#66FFF2"),
      colorB: new THREE.Color("#7AA8FF"),
    },
    snow: { size: 0.095, color: 0xeef6ff, opacity: 0.38 },
    treePalette: {
      ice: new THREE.Color(0.92, 0.97, 1.0),
      blue: new THREE.Color(0.62, 0.78, 1.0),
      gold: new THREE.Color(1.0, 0.92, 0.65),
    },
    lightColors: [0xffffff, 0xbfe3ff, 0x66fff2, 0x8db2ff],
    star: {
      glow0: "rgba(220,245,255,1)",
      glow1: "rgba(130,230,255,0.55)",
      glow2: "rgba(80,170,255,0.14)",
      fill0: "rgba(245,255,255,1)",
      fill1: "rgba(160,230,255,1)",
      fill2: "rgba(90,150,255,1)",
      stroke: "rgba(255,255,255,0.38)",
    },
  },
  gift: {
    name: "Gift Box",
    bg: 0x02050a,
    fog: 0x02050a,
    fogDensity: 0.014,
    bloom: { strength: 2.4, radius: 0.42, threshold: 0.8 },
    snow: { size: 0.11, color: 0xffffff, opacity: 0.5 },
  },
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const lerpColor = (c1, c2, t) => c1.clone().lerp(c2, t);

const App = () => {
  // --- 状态管理 ---
  const [appState, setAppState] = useState("Loading");
  const [cameraActive, setCameraActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [trackingStatus, setTrackingStatus] = useState("Disconnected");
  const [cameraError, setCameraError] = useState("");
  const [styleMode, setStyleMode] = useState("warm"); // warm | galaxy | gift

  const mountRef = useRef(null);
  const videoRef = useRef(null);

  const sceneRef = useRef({
    scene: null,
    camera: null,
    renderer: null,
    composer: null,
    bloomPass: null,

    treeGroup: null,
    controls: null,

    treePoints: null,
    ribbon: null,
    snow: null,
    lights: [],
    star: null,

    // gift box
    giftGroup: null,
    giftMats: [],

    // gesture targets
    targetScale: 1,

    // NEW: rotation targets
    targetRot: { x: 0, y: 0, z: 0 },

    // NEW: flip (180°) offset + debounce
    flipOffsetY: 0,
    lastFlipAt: 0,

    treeTop: { x: 0, y: 7.0, z: 0 },
  });

  const handTrackerRef = useRef({
    hands: null,
    rafId: 0,
    stream: null,
    isActive: false,
    scriptsReady: false,
  });

  const autoCameraTriedRef = useRef(false);

  // -----------------------------
  // Star sprite texture
  // -----------------------------
  const makeStarTexture = (size = 256, palette = STYLE_PRESETS.warm.star) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;

    // soft glow
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.48);
    glow.addColorStop(0.0, palette.glow0);
    glow.addColorStop(0.22, palette.glow1);
    glow.addColorStop(0.6, palette.glow2);
    glow.addColorStop(1.0, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.48, 0, Math.PI * 2);
    ctx.fill();

    // star body
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 2);

    const outer = size * 0.22;
    const inner = size * 0.09;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (i * Math.PI) / 5;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();

    const fill = ctx.createLinearGradient(0, -outer, 0, outer);
    fill.addColorStop(0, palette.fill0);
    fill.addColorStop(0.5, palette.fill1);
    fill.addColorStop(1, palette.fill2);
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.strokeStyle = palette.stroke;
    ctx.lineWidth = Math.max(2, size * 0.01);
    ctx.stroke();

    ctx.restore();

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return tex;
  };

  const createStarSpriteAtTop = (group, top, styleKey = "warm") => {
    // Remove previous star if any
    if (sceneRef.current.star) {
      try {
        group.remove(sceneRef.current.star);
      } catch (_) {}
      sceneRef.current.star = null;
    }

    const starContainer = new THREE.Group();
    starContainer.position.set(top.x, top.y + 0.75, top.z);

    const tex = makeStarTexture(256, STYLE_PRESETS[styleKey].star);
    if (!tex) return;

    const mat = new THREE.SpriteMaterial({
      map: tex,
      color: 0xffffff,
      transparent: true,
      opacity: 0.0, // animated during light-up
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });

    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(3.0, 3.0, 1.0);

    starContainer.add(sprite);
    group.add(starContainer);

    sceneRef.current.star = starContainer;
  };

  const updateStarTexture = (styleKey) => {
    const star = sceneRef.current.star;
    if (!star) return;
    const sprite = star.children?.[0];
    if (!sprite?.material) return;

    const prevOpacity = sprite.material.opacity;
    const oldMap = sprite.material.map;

    const tex = makeStarTexture(256, STYLE_PRESETS[styleKey].star);
    if (!tex) return;

    sprite.material.map = tex;
    sprite.material.needsUpdate = true;
    sprite.material.opacity = prevOpacity;

    oldMap?.dispose?.();
  };

  // -----------------------------
  // MediaPipe loader + camera/hand tracking runner
  // -----------------------------
  const ensureMediaPipeHands = async () => {
    if (handTrackerRef.current.scriptsReady && window.Hands) return;

    const loadScript = (src) =>
      new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });

    await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js");
    handTrackerRef.current.scriptsReady = true;
  };

  const stopHandTracking = () => {
    handTrackerRef.current.isActive = false;

    if (handTrackerRef.current.rafId) {
      cancelAnimationFrame(handTrackerRef.current.rafId);
      handTrackerRef.current.rafId = 0;
    }

    if (handTrackerRef.current.hands) {
      try {
        handTrackerRef.current.hands.close();
      } catch (_) {}
      handTrackerRef.current.hands = null;
    }

    if (handTrackerRef.current.stream) {
      try {
        handTrackerRef.current.stream.getTracks().forEach((t) => t.stop());
      } catch (_) {}
      handTrackerRef.current.stream = null;
    }

    if (videoRef.current) {
      try {
        videoRef.current.pause();
      } catch (_) {}
      videoRef.current.srcObject = null;
    }
  };

  const closeCamera = () => {
    stopHandTracking();
    setCameraActive(false);
    setTrackingStatus("Disconnected");
  };

  const startHandTracking = async () => {
    setCameraError("");

    if (!navigator.mediaDevices?.getUserMedia) {
      setTrackingStatus("Unavailable");
      setCameraError("当前浏览器不支持摄像头访问（getUserMedia 不可用）。");
      setCameraActive(false);
      return;
    }

    if (!window.isSecureContext) {
      setTrackingStatus("Insecure");
      setCameraError("需要在 HTTPS 或 localhost 环境下才能调用摄像头。");
      setCameraActive(false);
      return;
    }

    if (!videoRef.current) {
      setTrackingStatus("Disconnected");
      setCameraError("Video 元素未就绪。");
      setCameraActive(false);
      return;
    }

    setTrackingStatus("Requesting");

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
    } catch (err) {
      const name = err?.name || "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setTrackingStatus("Denied");
        setCameraError("摄像头权限被拒绝。请在浏览器地址栏的摄像头图标里允许访问后重试。");
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setTrackingStatus("NoDevice");
        setCameraError("未检测到摄像头设备。");
      } else {
        setTrackingStatus("Disconnected");
        setCameraError(`无法启动摄像头：${err?.message || "未知错误"}`);
      }
      stopHandTracking();
      setCameraActive(false);
      return;
    }

    try {
      // Attach stream immediately
      handTrackerRef.current.stream = stream;
      videoRef.current.srcObject = stream;

      try {
        await videoRef.current.play();
      } catch (_) {}

      await ensureMediaPipeHands();
      if (!window.Hands) throw new Error("MediaPipe Hands 脚本加载失败");

      const hands = new window.Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      // -----------------------------
      // Gesture mapping (scale + rotate + flip)
      // -----------------------------
      hands.onResults((results) => {
        if (!handTrackerRef.current.isActive) return;

        const lms = results.multiHandLandmarks;
        if (!lms || lms.length < 1) {
          setTrackingStatus("Lost");
          return;
        }

        setTrackingStatus("Active");

        const now = performance.now();

        // Tuning knobs
        const yawRange = Math.PI * 1.2; // 左右
        const pitchRange = Math.PI * 0.55; // 上下
        const rollRange = Math.PI * 0.35; // 双手扭转
        const smooth = 0.22; // 手势 -> 目标的平滑

        const flipThreshold = 0.11; // 双手靠近
        const flipCooldownMs = 1200; // 防抖

        // ---------- SCALE ----------
        let distance = 0;
        if (lms.length === 1) {
          // 单手：thumb-index pinch
          const thumb = lms[0][4];
          const index = lms[0][8];
          distance = Math.hypot(thumb.x - index.x, thumb.y - index.y);
        } else {
          // 双手：wrist 距离
          const w1 = lms[0][0];
          const w2 = lms[1][0];
          distance = Math.hypot(w1.x - w2.x, w1.y - w2.y);
        }

        const minD = 0.05;
        const maxD = 0.45;
        const norm = Math.max(0, Math.min(1, (distance - minD) / (maxD - minD)));
        sceneRef.current.targetScale = 0.7 + norm * 2.3;

        // ---------- ROTATION ----------
        if (lms.length === 1) {
          // 单手：wrist位置控制 yaw/pitch
          const wrist = lms[0][0];
          const x = clamp01(wrist.x);
          const y = clamp01(wrist.y);

          const targetYaw = (x - 0.5) * yawRange;
          const targetPitch = (0.5 - y) * pitchRange;

          sceneRef.current.targetRot.y = lerp(sceneRef.current.targetRot.y, targetYaw, smooth);
          sceneRef.current.targetRot.x = lerp(sceneRef.current.targetRot.x, targetPitch, smooth);
          // 单手时 roll 回正
          sceneRef.current.targetRot.z = lerp(sceneRef.current.targetRot.z, 0, smooth);
        } else {
          // 双手：中点控制 yaw/pitch；连线角度控制 roll
          const w1 = lms[0][0];
          const w2 = lms[1][0];

          const midX = clamp01((w1.x + w2.x) * 0.5);
          const midY = clamp01((w1.y + w2.y) * 0.5);

          const targetYaw = (midX - 0.5) * yawRange;
          const targetPitch = (0.5 - midY) * pitchRange;

          const ang = Math.atan2(w2.y - w1.y, w2.x - w1.x); // -pi..pi
          const targetRoll = THREE.MathUtils.clamp(ang * 0.55, -rollRange, rollRange);

          sceneRef.current.targetRot.y = lerp(sceneRef.current.targetRot.y, targetYaw, smooth);
          sceneRef.current.targetRot.x = lerp(sceneRef.current.targetRot.x, targetPitch, smooth);
          sceneRef.current.targetRot.z = lerp(sceneRef.current.targetRot.z, targetRoll, smooth);

          // ---------- FLIP (180°) ----------
          const wristDist = Math.hypot(w1.x - w2.x, w1.y - w2.y);
          if (wristDist < flipThreshold && now - sceneRef.current.lastFlipAt > flipCooldownMs) {
            sceneRef.current.flipOffsetY = sceneRef.current.flipOffsetY === 0 ? Math.PI : 0;
            sceneRef.current.lastFlipAt = now;
          }
        }
      });

      handTrackerRef.current.hands = hands;
      handTrackerRef.current.isActive = true;

      const pump = async () => {
        if (!handTrackerRef.current.isActive) return;

        const v = videoRef.current;
        if (v && v.readyState >= 2) {
          try {
            await hands.send({ image: v });
          } catch (_) {}
        }

        handTrackerRef.current.rafId = requestAnimationFrame(pump);
      };

      setTrackingStatus("Active");
      pump();
    } catch (err) {
      setTrackingStatus("Disconnected");
      setCameraError(`无法启动手势识别：${err?.message || "未知错误"}`);
      stopHandTracking();
      setCameraActive(false);
    }
  };

  // -----------------------------
  // Style application (optional)
  // -----------------------------
  const applyStyle = (styleKey) => {
    const preset = STYLE_PRESETS[styleKey];
    const { scene, bloomPass, snow } = sceneRef.current;
    if (!scene || !bloomPass || !preset) return;

    scene.background = new THREE.Color(preset.bg);
    scene.fog = new THREE.FogExp2(preset.fog, preset.fogDensity);

    bloomPass.strength = preset.bloom.strength;
    bloomPass.radius = preset.bloom.radius;
    bloomPass.threshold = preset.bloom.threshold;

    if (snow?.material && preset.snow) {
      snow.material.size = preset.snow.size;
      snow.material.color = new THREE.Color(preset.snow.color);
      snow.material.opacity = preset.snow.opacity;
      snow.material.needsUpdate = true;
    }
  };

  const disposeObject3D = (obj) => {
    if (!obj) return;
    obj.traverse?.((child) => {
      if (child.geometry) child.geometry.dispose?.();
      if (child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) {
          if (!m) continue;
          if (m.map) m.map.dispose?.();
          m.dispose?.();
        }
      }
    });
  };

  const clearVisualsInTreeGroup = () => {
    const tg = sceneRef.current.treeGroup;
    if (!tg) return;
    // remove & dispose all children
    for (let i = tg.children.length - 1; i >= 0; i--) {
      const ch = tg.children[i];
      tg.remove(ch);
      disposeObject3D(ch);
    }

    // reset refs
    sceneRef.current.treePoints = null;
    sceneRef.current.ribbon = null;
    sceneRef.current.star = null;
    sceneRef.current.lights = [];
    sceneRef.current.giftGroup = null;
    sceneRef.current.giftMats = [];
  };

  const syncVisibilityToAppState = () => {
    // If already lit up, new mode should appear lit too
    const lit = appState === "Interactive";

    if (sceneRef.current.ribbon?.material) sceneRef.current.ribbon.material.opacity = lit ? 0.9 : 0;

    for (const l of sceneRef.current.lights || []) {
      l.material.opacity = lit ? 0.95 : 0;
    }

    const sprite = sceneRef.current.star?.children?.[0];
    if (sprite?.material) sprite.material.opacity = lit ? 1 : 0;
  };

  const buildSceneForMode = (mode) => {
    // Apply environment (bg/fog/bloom/snow)
    applyStyle(mode);

    // Rebuild foreground visuals
    clearVisualsInTreeGroup();

    const tg = sceneRef.current.treeGroup;
    if (!tg) return;

    if (mode === "gift") {
      // Gift box only (no tree)
      createGiftBox(tg);
    } else {
      // Classic/Galaxy tree
      createChristmasTree(tg, mode);
      createRibbon(tg, mode);
    }

    syncVisibilityToAppState();
  };

  // -----------------------------
  // Three.js init
  // -----------------------------
  useEffect(() => {
    const width = window.innerWidth;
    const height = window.innerHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(STYLE_PRESETS.warm.bg);
    scene.fog = new THREE.FogExp2(STYLE_PRESETS.warm.fog, STYLE_PRESETS.warm.fogDensity);

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.set(0, 5, 20);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ReinhardToneMapping;

    if (mountRef.current) mountRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 45;
    controls.minDistance = 8;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 2.2, 0.4, 0.85);
    composer.addPass(bloomPass);

    const treeGroup = new THREE.Group();
    scene.add(treeGroup);

    sceneRef.current = {
      ...sceneRef.current,
      scene,
      camera,
      renderer,
      composer,
      bloomPass,
      controls,
      treeGroup,
      lights: [],
    };

    createChristmasTree(treeGroup, "warm");
    createRibbon(treeGroup, "warm");
    createEnvironment(scene, "warm");
    buildSceneForMode("warm");

    let frameId;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const time = Date.now() * 0.001;

      const tg = sceneRef.current.treeGroup;
      if (tg) {
        // scale
        const currentScale = tg.scale.x;
        const nextScale = THREE.MathUtils.lerp(currentScale, sceneRef.current.targetScale, 0.1);
        tg.scale.set(nextScale, nextScale, nextScale);

        // rotation (NEW)
        const tr = sceneRef.current.targetRot;
        const targetX = tr.x;
        const targetY = tr.y + sceneRef.current.flipOffsetY;
        const targetZ = tr.z;

        tg.rotation.x = THREE.MathUtils.lerp(tg.rotation.x, targetX, 0.12);
        tg.rotation.y = THREE.MathUtils.lerp(tg.rotation.y, targetY, 0.12);
        tg.rotation.z = THREE.MathUtils.lerp(tg.rotation.z, targetZ, 0.12);
      }

      // Star animation
      if (sceneRef.current.star) {
        const sprite = sceneRef.current.star.children?.[0];
        sceneRef.current.star.rotation.y = time * 0.25;
        if (sprite && sprite.material) {
          const baseSize = 3.0;
          const pulse = 1 + Math.sin(time * 3.0) * 0.04;
          sprite.scale.set(baseSize * pulse, baseSize * pulse, 1);
        }
      }

      if (sceneRef.current.ribbon) {
        sceneRef.current.ribbon.rotation.y = time * 0.15;
      }

      sceneRef.current.lights.forEach((l, i) => {
        const pulse = 0.3 + Math.sin(time * 2.5 + i) * 0.7;
        l.material.opacity = pulse * 0.95;
      });

      // Gift box subtle sparkle + gather animation
      if (sceneRef.current.giftMats?.length) {
        const gPulse = 0.78 + Math.sin(time * 2.2) * 0.1;
        for (const m of sceneRef.current.giftMats) {
          if (m) m.opacity = gPulse;
        }
      }

      // Gift gather-to-form animation (only when gift mode is active)
      if (sceneRef.current.giftGroup?.userData?.gatherActive) {
        const g = sceneRef.current.giftGroup;
        const startT = g.userData.gatherStart || performance.now();
        const dur = g.userData.gatherDuration || 1200;
        const tt = Math.max(0, Math.min(1, (performance.now() - startT) / dur));
        // smoothstep
        const eased = tt * tt * (3 - 2 * tt);

        g.traverse((ch) => {
          if (!ch.isPoints) return;
          const geom = ch.geometry;
          if (!geom?.userData?.target || !geom?.userData?.start) return;

          const pos = geom.attributes.position.array;
          const start = geom.userData.start;
          const target = geom.userData.target;
          for (let i = 0; i < pos.length; i++) {
            pos[i] = start[i] + (target[i] - start[i]) * eased;
          }
          geom.attributes.position.needsUpdate = true;
        });

        if (tt >= 1) {
          g.userData.gatherActive = false;
        }
      }

      if (sceneRef.current.snow) {
        const pos = sceneRef.current.snow.geometry.attributes.position.array;
        for (let i = 1; i < pos.length; i += 3) {
          pos[i] -= 0.03;
          if (pos[i] < -15) pos[i] = 25;
        }
        sceneRef.current.snow.geometry.attributes.position.needsUpdate = true;
      }

      controls.update();
      composer.render();
    };

    animate();
    setAppState("Idle");

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      composer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);

      stopHandTracking();

      try {
        controls.dispose();
      } catch (_) {}

      try {
        const sprite = sceneRef.current.star?.children?.[0];
        if (sprite?.material?.map) sprite.material.map.dispose();
        sprite?.material?.dispose?.();
      } catch (_) {}

      if (mountRef.current && renderer.domElement) mountRef.current.removeChild(renderer.domElement);
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sceneRef.current.scene) return;
    buildSceneForMode(styleMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleMode]);

  // -----------------------------
  // Scene builders
  // -----------------------------
  const createChristmasTree = (group, styleKey = "warm") => {
    const preset = STYLE_PRESETS[styleKey];

    const particleCount = 28000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      const h = Math.random() * 12;
      const radius = (1 - h / 12) * 5.5;
      const angle = Math.random() * Math.PI * 2;
      const spread = Math.pow(Math.random(), 0.85);

      const x = Math.cos(angle) * radius * spread;
      const y = h - 5;
      const z = Math.sin(angle) * radius * spread;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      const height01 = clamp01((y + 5) / 12);
      const sparkle = 0.55 + Math.random() * 0.45;
      const gradient = 0.85 + height01 * 0.15;
      const b = Math.min(1, sparkle * gradient);

      const r = Math.random();
      let baseColor;

      if (styleKey === "warm") {
        baseColor = r < 0.7 ? preset.treePalette.green : r < 0.9 ? preset.treePalette.red : preset.treePalette.gold;
      } else {
        baseColor = r < 0.78 ? preset.treePalette.ice : r < 0.95 ? preset.treePalette.blue : preset.treePalette.gold;
      }

      colors[i * 3] = Math.min(1, baseColor.r * b);
      colors[i * 3 + 1] = Math.min(1, baseColor.g * b);
      colors[i * 3 + 2] = Math.min(1, baseColor.b * b);
    }

    const top = computeTreeTopFromPositions(positions);
    sceneRef.current.treeTop = top;

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: preset.tree.size,
      vertexColors: true,
      transparent: true,
      opacity: preset.tree.baseOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const treePoints = new THREE.Points(geometry, material);
    group.add(treePoints);
    sceneRef.current.treePoints = treePoints;

    // Lights
    const colorsList = preset.lightColors;
    for (let i = 0; i < 140; i++) {
      const h = Math.random() * 11.2;
      const rr = (1 - h / 12) * 5.4;
      const a = Math.random() * Math.PI * 2;

      const lightGeo = new THREE.SphereGeometry(0.12, 8, 8);
      const lightMat = new THREE.MeshBasicMaterial({
        color: colorsList[Math.floor(Math.random() * colorsList.length)],
        transparent: true,
        opacity: 0,
      });

      const light = new THREE.Mesh(lightGeo, lightMat);
      light.position.set(Math.cos(a) * rr, h - 5, Math.sin(a) * rr);
      group.add(light);
      sceneRef.current.lights.push(light);
    }

    createStarSpriteAtTop(group, top, styleKey);
  };

  const createRibbon = (group, styleKey = "warm") => {
    const preset = STYLE_PRESETS[styleKey];

    const pointsCount = 6500;
    const ribbonGeo = new THREE.BufferGeometry();
    const ribbonPos = new Float32Array(pointsCount * 3);
    const ribbonColors = new Float32Array(pointsCount * 3);

    // 轻量“伪噪声”平滑扰动
    const seed = Math.random() * 1000;
    const wobble = (t, f, a) => Math.sin((t + seed) * f) * a;

    for (let i = 0; i < pointsCount; i++) {
      const t = i / (pointsCount - 1);
      const h = t * 11.5;

      const baseRadius = (1 - (h - 0.5) / 12) * 5.8;
      const turnNonUniform = 1 + wobble(t, Math.PI * 2.0, 0.035) + wobble(t, Math.PI * 5.0, 0.018);

      const angleBase = t * Math.PI * 18 * turnNonUniform;
      const angleJitter = wobble(t, Math.PI * 12.0, 0.12);

      const radiusJitter = 0.92 + wobble(t, Math.PI * 2.6, 0.06) + wobble(t, Math.PI * 7.2, 0.03);
      const rad = Math.max(0.35, baseRadius * radiusJitter);

      const x = Math.cos(angleBase + angleJitter) * rad;
      const y = h - 5 + wobble(t, Math.PI * 4.2, 0.18);
      const z = Math.sin(angleBase + angleJitter) * rad;

      ribbonPos[i * 3] = x;
      ribbonPos[i * 3 + 1] = y;
      ribbonPos[i * 3 + 2] = z;

      const c = lerpColor(preset.ribbon.colorA, preset.ribbon.colorB, t);
      const sparkle = 0.78 + Math.random() * 0.22;
      ribbonColors[i * 3] = c.r * sparkle;
      ribbonColors[i * 3 + 1] = c.g * sparkle;
      ribbonColors[i * 3 + 2] = c.b * sparkle;
    }

    ribbonGeo.setAttribute("position", new THREE.BufferAttribute(ribbonPos, 3));
    ribbonGeo.setAttribute("color", new THREE.BufferAttribute(ribbonColors, 3));

    const ribbonMat = new THREE.PointsMaterial({
      size: preset.ribbon.size,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const ribbon = new THREE.Points(ribbonGeo, ribbonMat);
    group.add(ribbon);
    sceneRef.current.ribbon = ribbon;
  };

  const createEnvironment = (scene, styleKey = "warm") => {
    const preset = STYLE_PRESETS[styleKey];

    const snowCount = 2200;
    const snowGeo = new THREE.BufferGeometry();
    const snowPos = new Float32Array(snowCount * 3);

    for (let i = 0; i < snowCount; i++) {
      snowPos[i * 3] = (Math.random() - 0.5) * 80;
      snowPos[i * 3 + 1] = (Math.random() - 0.5) * 50 + 10;
      snowPos[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }

    snowGeo.setAttribute("position", new THREE.BufferAttribute(snowPos, 3));

    const snowMat = new THREE.PointsMaterial({
      size: preset.snow.size,
      color: preset.snow.color,
      transparent: true,
      opacity: preset.snow.opacity,
      depthWrite: false,
    });

    const snowPoints = new THREE.Points(snowGeo, snowMat);
    scene.add(snowPoints);
    sceneRef.current.snow = snowPoints;
  };

  // -----------------------------
  // Gift Box (particle cube + red/gold ribbon + bow)
  // -----------------------------
  const createGiftBox = (parentGroup) => {
    // Cleanup old
    if (sceneRef.current.giftGroup) {
      try {
        parentGroup.remove(sceneRef.current.giftGroup);
      } catch (_) {}
      sceneRef.current.giftGroup = null;
      sceneRef.current.giftMats = [];
    }

    const gift = new THREE.Group();
    // Gift mode hero: centered (move a bit up so it sits visually in the middle)
    gift.position.set(0, 1.1, 0);
    gift.scale.set(1.25, 1.25, 1.25);

    const size = 3.6;
    const half = size / 2;

    // Shared palette (high-contrast red / gold for clear checkerboard)
    const GOLD = new THREE.Color("#FFD56A");
    const RED = new THREE.Color("#FF2A2A");

    // Scatter cloud radius
    const scatterRadius = 9.5;

    // Helper: random point in sphere (with cbrt for uniform volume)
    const randSphere = (R) => {
      const rr = R * Math.cbrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      const b = Math.acos(2 * Math.random() - 1);
      return {
        x: Math.cos(a) * Math.sin(b) * rr,
        y: Math.cos(b) * rr,
        z: Math.sin(a) * Math.sin(b) * rr,
      };
    };

    // ---------------------------------
    // BOX BODY (faces with 2x2 checkerboard)
    // ---------------------------------
    const bodyCount = 9800;
    const bodyGeo = new THREE.BufferGeometry();
    const bodyTarget = new Float32Array(bodyCount * 3);
    const bodyStartAttr = new Float32Array(bodyCount * 3); // this is what we animate
    const bodyStartFrozen = new Float32Array(bodyCount * 3); // immutable copy
    const bodyCol = new Float32Array(bodyCount * 3);

    for (let i = 0; i < bodyCount; i++) {
      // pick a face and its local (u,v)
      const f = Math.floor(Math.random() * 6);
      const u = (Math.random() - 0.5) * size;
      const v = (Math.random() - 0.5) * size;

      let x = 0,
        y = 0,
        z = 0;

      if (f === 0) {
        x = half;
        y = u;
        z = v;
      } else if (f === 1) {
        x = -half;
        y = u;
        z = v;
      } else if (f === 2) {
        y = half;
        x = u;
        z = v;
      } else if (f === 3) {
        y = -half;
        x = u;
        z = v;
      } else if (f === 4) {
        z = half;
        x = u;
        y = v;
      } else {
        z = -half;
        x = u;
        y = v;
      }

      // target (formed cube)
      bodyTarget[i * 3] = x;
      bodyTarget[i * 3 + 1] = y;
      bodyTarget[i * 3 + 2] = z;

      // start (scattered cloud)
      const s = randSphere(scatterRadius);
      bodyStartAttr[i * 3] = s.x;
      bodyStartAttr[i * 3 + 1] = s.y;
      bodyStartAttr[i * 3 + 2] = s.z;

      bodyStartFrozen[i * 3] = s.x;
      bodyStartFrozen[i * 3 + 1] = s.y;
      bodyStartFrozen[i * 3 + 2] = s.z;

      // checkerboard: 2x2 quadrants using signs of (u,v)
      // parity 0/1 makes alternating blocks
      const parity = (u > 0 ? 1 : 0) ^ (v > 0 ? 1 : 0);
      const base = parity === 0 ? GOLD : RED;

      // brightness: mild variation (keep blocks readable)
      const sparkle = 0.82 + Math.random() * 0.18;
      bodyCol[i * 3] = base.r * sparkle;
      bodyCol[i * 3 + 1] = base.g * sparkle;
      bodyCol[i * 3 + 2] = base.b * sparkle;
    }

    bodyGeo.setAttribute("position", new THREE.BufferAttribute(bodyStartAttr, 3));
    bodyGeo.setAttribute("color", new THREE.BufferAttribute(bodyCol, 3));
    bodyGeo.userData = { start: bodyStartFrozen, target: bodyTarget };

    const bodyMat = new THREE.PointsMaterial({
      size: 0.052,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    gift.add(new THREE.Points(bodyGeo, bodyMat));

    // ---------------------------------
    // RIBBON (two perpendicular red bands)
    // ---------------------------------
    const ribbonCount = 5600;
    const ribGeo = new THREE.BufferGeometry();
    const ribTarget = new Float32Array(ribbonCount * 3);
    const ribStartAttr = new Float32Array(ribbonCount * 3);
    const ribStartFrozen = new Float32Array(ribbonCount * 3);
    const ribCol = new Float32Array(ribbonCount * 3);

    const band = 0.34;
    const RIB_RED = new THREE.Color("#FF3A3A");

    for (let i = 0; i < ribbonCount; i++) {
      const f = Math.floor(Math.random() * 6);
      let x = (Math.random() - 0.5) * size;
      let y = (Math.random() - 0.5) * size;
      let z = (Math.random() - 0.5) * size;

      // Force into one of two perpendicular bands
      if (Math.random() < 0.5) x = (Math.random() * 2 - 1) * band;
      else z = (Math.random() * 2 - 1) * band;

      // Project to a random face
      if (f === 0) x = half;
      else if (f === 1) x = -half;
      else if (f === 2) y = half;
      else if (f === 3) y = -half;
      else if (f === 4) z = half;
      else z = -half;

      ribTarget[i * 3] = x;
      ribTarget[i * 3 + 1] = y;
      ribTarget[i * 3 + 2] = z;

      const s = randSphere(scatterRadius * 0.85);
      ribStartAttr[i * 3] = s.x;
      ribStartAttr[i * 3 + 1] = s.y;
      ribStartAttr[i * 3 + 2] = s.z;

      ribStartFrozen[i * 3] = s.x;
      ribStartFrozen[i * 3 + 1] = s.y;
      ribStartFrozen[i * 3 + 2] = s.z;

      const sparkle = 0.84 + Math.random() * 0.16;
      ribCol[i * 3] = RIB_RED.r * sparkle;
      ribCol[i * 3 + 1] = RIB_RED.g * sparkle;
      ribCol[i * 3 + 2] = RIB_RED.b * sparkle;
    }

    ribGeo.setAttribute("position", new THREE.BufferAttribute(ribStartAttr, 3));
    ribGeo.setAttribute("color", new THREE.BufferAttribute(ribCol, 3));
    ribGeo.userData = { start: ribStartFrozen, target: ribTarget };

    const ribMat = new THREE.PointsMaterial({
      size: 0.062,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    gift.add(new THREE.Points(ribGeo, ribMat));

    // ---------------------------------
    // BOW (two loops + knot)
    // ---------------------------------
    const bowGeo = new THREE.BufferGeometry();
    const bowCount = 3200;
    const bowTarget = new Float32Array(bowCount * 3);
    const bowStartAttr = new Float32Array(bowCount * 3);
    const bowStartFrozen = new Float32Array(bowCount * 3);
    const bowCol = new Float32Array(bowCount * 3);

    const bowY = half + 0.25;
    const loopR = 0.66;
    const loopSep = 0.78;

    const sampleLoop = (cx, cz, t) => {
      const r = loopR * (0.72 + 0.28 * Math.sin(t * 2));
      return { x: cx + Math.cos(t) * r, z: cz + Math.sin(t) * r };
    };

    for (let i = 0; i < bowCount; i++) {
      const which = Math.random();
      let x, y, z;
      const t = Math.random() * Math.PI * 2;

      if (which < 0.46) {
        const p = sampleLoop(-loopSep / 2, 0, t);
        x = p.x;
        z = p.z;
        y = bowY + (Math.random() - 0.5) * 0.26;
      } else if (which < 0.92) {
        const p = sampleLoop(loopSep / 2, 0, t);
        x = p.x;
        z = p.z;
        y = bowY + (Math.random() - 0.5) * 0.26;
      } else {
        const rr = 0.2 * Math.cbrt(Math.random());
        const a = Math.random() * Math.PI * 2;
        const b = Math.acos(2 * Math.random() - 1);
        x = Math.cos(a) * Math.sin(b) * rr;
        y = bowY + Math.cos(b) * rr;
        z = Math.sin(a) * Math.sin(b) * rr;
      }

      bowTarget[i * 3] = x;
      bowTarget[i * 3 + 1] = y;
      bowTarget[i * 3 + 2] = z;

      const s = randSphere(scatterRadius * 0.65);
      bowStartAttr[i * 3] = s.x;
      bowStartAttr[i * 3 + 1] = s.y + 0.6;
      bowStartAttr[i * 3 + 2] = s.z;

      bowStartFrozen[i * 3] = bowStartAttr[i * 3];
      bowStartFrozen[i * 3 + 1] = bowStartAttr[i * 3 + 1];
      bowStartFrozen[i * 3 + 2] = bowStartAttr[i * 3 + 2];

      // bow: rich red + a few gold sparkles
      const base = Math.random() < 0.88 ? RED : GOLD;
      const sparkle = 0.86 + Math.random() * 0.14;
      bowCol[i * 3] = base.r * sparkle;
      bowCol[i * 3 + 1] = base.g * sparkle;
      bowCol[i * 3 + 2] = base.b * sparkle;
    }

    bowGeo.setAttribute("position", new THREE.BufferAttribute(bowStartAttr, 3));
    bowGeo.setAttribute("color", new THREE.BufferAttribute(bowCol, 3));
    bowGeo.userData = { start: bowStartFrozen, target: bowTarget };

    const bowMat = new THREE.PointsMaterial({
      size: 0.068,
      vertexColors: true,
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    gift.add(new THREE.Points(bowGeo, bowMat));

    // elegant pose
    gift.rotation.y = -0.18;
    gift.rotation.x = 0.06;

    // Start gather animation
    gift.userData.gatherActive = true;
    gift.userData.gatherStart = performance.now();
    gift.userData.gatherDuration = 1500;

    parentGroup.add(gift);
    sceneRef.current.giftGroup = gift;
    sceneRef.current.giftMats = [bodyMat, ribMat, bowMat];
  };

  const tryAutoStartCameraOnce = () => {
    if (autoCameraTriedRef.current) return;
    autoCameraTriedRef.current = true;

    setCameraActive(true);
    startHandTracking();
  };

  const handleLightUp = () => {
    if (appState !== "Idle") return;

    tryAutoStartCameraOnce();

    setAppState("LightingUp");

    let progress = 0;
    const interval = setInterval(() => {
      progress += 0.01;

      if (sceneRef.current.ribbon) sceneRef.current.ribbon.material.opacity = progress * 0.9;

      sceneRef.current.lights.forEach((l) => {
        if (progress > (l.position.y + 5) / 12) l.material.opacity = 0.95;
      });

      if (progress >= 1) {
        clearInterval(interval);

        const sprite = sceneRef.current.star?.children?.[0];
        if (sprite?.material) sprite.material.opacity = 1;

        setAppState("Interactive");
        sceneRef.current.controls.autoRotate = false;
      }
    }, 25);
  };

  const statusText = {
    Disconnected: "手势：关闭",
    Requesting: "正在请求权限…",
    Active: "手势：已连接",
    Lost: "未检测到手部",
    Denied: "权限被拒绝",
    Unavailable: "浏览器不支持",
    Insecure: "需要 HTTPS",
    NoDevice: "未检测到摄像头",
  };

  const resetTreePose = () => {
    // Reset both targets and actual transform immediately
    sceneRef.current.targetScale = 1;
    sceneRef.current.targetRot = { x: 0, y: 0, z: 0 };
    sceneRef.current.flipOffsetY = 0;
    // prevent immediate re-flip after switching
    sceneRef.current.lastFlipAt = performance.now();

    const tg = sceneRef.current.treeGroup;
    if (tg) {
      tg.scale.set(1, 1, 1);
      tg.rotation.set(0, 0, 0);
    }
  };

  const toggleStyle = () => {
    // When switching mode, return object to initial pose
    resetTreePose();

    setStyleMode((prev) => {
      if (prev === "warm") return "galaxy";
      if (prev === "galaxy") return "gift";
      return "warm";
    });
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#02050a] text-white select-none">
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Great+Vibes&family=Playfair+Display:ital,wght@1,700&display=swap');
          .gold-script { font-family: 'Great Vibes', cursive; background: linear-gradient(to bottom, #fff7d6 0%, #ffdf6b 45%, #b58d1d 55%, #ffe68a 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
          .festive-sub { font-family: 'Playfair Display', serif; letter-spacing: 0.4em; }
        `}
      </style>

      <div ref={mountRef} className="absolute inset-0 z-0" />

      {/* hidden video */}
      <video ref={videoRef} className="hidden" playsInline muted />

      {/* Merry Christmas (moved under the tree) */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10 pointer-events-none text-center animate-in fade-in duration-1000">
        <div className="gold-script text-4xl md:text-5xl leading-none">Merry Christmas</div>
        <div className="mt-2 flex items-center justify-center gap-3">
          <div className="h-[1px] w-16 bg-gradient-to-r from-transparent via-yellow-500/60 to-transparent" />
          <p className="festive-sub text-[9px] text-white/35 uppercase">
            {styleMode === "warm" ? "Classic Warm Glow" : "Galaxy Neon Stardust"}
          </p>
          <div className="h-[1px] w-16 bg-gradient-to-r from-transparent via-yellow-500/60 to-transparent" />
        </div>
      </div>

      {/* Top-right controls */}
      <div className="absolute top-10 right-10 flex flex-col gap-5 z-10 items-end">
        <button
          onClick={toggleStyle}
          className="p-4 rounded-full bg-white/5 border border-white/10 backdrop-blur-xl hover:bg-white/20 transition-all flex items-center gap-3"
          aria-label="Toggle Style"
        >
          <Palette size={22} />
          <span className="text-[10px] tracking-widest uppercase opacity-60">
            {styleMode === "warm" ? "Classic" : "Galaxy"}
          </span>
        </button>

        <button
          onClick={() => setIsMuted(!isMuted)}
          className="p-4 rounded-full bg-white/5 border border-white/10 backdrop-blur-xl hover:bg-white/20 transition-all"
          aria-label={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <VolumeX size={22} /> : <Volume2 size={22} />}
        </button>

        <button
          onClick={() => {
            setCameraError("");
            setCameraActive((prev) => {
              const next = !prev;
              if (next) startHandTracking();
              else {
                stopHandTracking();
                setTrackingStatus("Disconnected");
              }
              return next;
            });
          }}
          className={`p-4 rounded-full border backdrop-blur-xl transition-all flex items-center gap-3 ${
            cameraActive ? "bg-amber-500/20 border-amber-500 text-amber-400" : "bg-white/5 border-white/10"
          }`}
          aria-label={cameraActive ? "Disable Camera" : "Enable Camera"}
        >
          {trackingStatus === "Requesting" ? <RefreshCw className="animate-spin" size={22} /> : <Video size={22} />}
          <span className="text-[10px] tracking-widest uppercase opacity-60">
            {statusText[trackingStatus] || trackingStatus}
          </span>
        </button>

        {cameraError && (
          <div className="max-w-[320px] rounded-2xl bg-black/60 border border-white/10 backdrop-blur-xl p-3 text-xs text-white/70 flex gap-2 items-start">
            <AlertTriangle className="mt-[2px]" size={14} />
            <div className="leading-relaxed">
              <div className="text-white/80 font-semibold mb-1">摄像头不可用</div>
              <div>{cameraError}</div>
              <div className="mt-2 flex gap-2">
                <button
                  className="px-3 py-1 rounded-full bg-white/10 hover:bg-white/20"
                  onClick={() => {
                    setCameraError("");
                    setCameraActive(true);
                    startHandTracking();
                  }}
                >
                  重试
                </button>
                <button className="px-3 py-1 rounded-full bg-white/10 hover:bg-white/20" onClick={() => setCameraError("")}
                >
                  关闭提示
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Idle CTA */}
      {appState === "Idle" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
          <button
            className="gold-script text-3xl md:text-5xl bg-white/5 border border-white/10 backdrop-blur-3xl px-20 py-10 rounded-full hover:bg-white/10 transition-all"
            onClick={handleLightUp}
          >
            点亮圣诞
          </button>
          <p className="mt-5 text-xs text-white/40">
            提示：点击后会自动请求摄像头权限用于手势控制（可拒绝，不影响体验）
          </p>
          <p className="mt-2 text-[10px] text-white/35">
            手势：捏合缩放；移动手部旋转；双手扭转可倾斜；双手合拢可翻转
          </p>
        </div>
      )}

      {/* Gesture HUD */}
      {cameraActive && (
        <div className="absolute bottom-12 right-12 w-72 h-48 bg-black/90 border border-white/10 rounded-[2.5rem] overflow-hidden z-20 animate-in fade-in slide-in-from-right-10 shadow-2xl">
          <div className="absolute inset-0 flex items-center justify-center opacity-20 bg-gradient-to-br from-amber-500/30 to-blue-900/40">
            <Hand size={44} className={trackingStatus === "Active" ? "text-amber-400" : "text-white/10"} />
          </div>
          <div className="absolute top-6 left-6 flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                trackingStatus === "Active"
                  ? "bg-green-500 animate-pulse"
                  : trackingStatus === "Requesting"
                  ? "bg-amber-500 animate-pulse"
                  : "bg-gray-700"
              }`}
            />
            <span className="text-[10px] font-bold tracking-widest uppercase text-white/50">Tracking</span>
          </div>
          <div className="absolute bottom-6 left-6 right-6 text-[10px] opacity-50 text-center">
            {trackingStatus === "Active"
              ? "捏合缩放 / 移动旋转 / 双手扭转倾斜 / 合拢翻转"
              : trackingStatus === "Denied"
              ? "权限被拒绝：请允许摄像头后重试"
              : trackingStatus === "Insecure"
              ? "需要 HTTPS/localhost"
              : "请将手部置于镜头前"}
          </div>
          <button
            onClick={closeCamera}
            className="absolute top-5 right-5 p-2 hover:bg-white/10 rounded-full"
            aria-label="Close camera"
          >
            <X size={16} className="opacity-30" />
          </button>
        </div>
      )}
    </div>
  );
};

export default App;

// -----------------------------
// Tests (Vitest/Jest compatible)
// -----------------------------
if (typeof describe === "function") {
  describe("computeTreeTopFromPositions", () => {
    it("returns maxY and reasonable center for a simple cone-like set", () => {
      const pos = new Float32Array([0, 0, 0, 1, 0.1, 0, -1, 0.1, 0, 0.2, 0.9, 0.1, -0.2, 1.0, -0.1]);
      const top = computeTreeTopFromPositions(pos);
      expect(top.y).toBe(1.0);
      expect(Math.abs(top.x)).toBeLessThan(0.5);
      expect(Math.abs(top.z)).toBeLessThan(0.5);
    });

    it("handles empty/degenerate input gracefully", () => {
      const pos = new Float32Array([]);
      const top = computeTreeTopFromPositions(pos);
      expect(top.y).toBe(-Infinity);
      expect(top.x).toBe(0);
      expect(top.z).toBe(0);
    });
  });
}