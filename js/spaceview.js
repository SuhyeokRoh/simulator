'use strict';
/* 창세 관측소 — 태양계 보기: 밖에서 본 행성과 궤도, 소행성 충돌 장면, 정착지와 우주선. 그림만 그리고 세계 상태는 건드리지 않습니다. */
(function () {
  const root = typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis;
  const WS = (root.WS = root.WS || {});

  const TAU = Math.PI * 2, DEG = Math.PI / 180;
  const F_BODY = "'IBM Plex Sans KR', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";
  const C_TEXT = '#ebe4d3', C_MUTED = '#a3abbb', C_FAINT = '#858ea1', C_BRASS = '#f1cb86', C_CYAN = '#9fd6e2', C_EMBER = '#ef8a68', C_GREY = '#8a8f9a';
  // 충돌 장면 시간표(초): 들어옴 → 충돌 → 물러남 → 끝
  const T_HIT = 3.8, T_PULL = 5.25, T_END = 6.6;
  // 작은 창은 충돌 직전부터 보여 줍니다. 지도의 섬광과 충격파가 남아 있는 동안 부딪혀야 같은 사건으로 보입니다
  const T_INSET = 3;
  // 자연 충돌은 막 일어난 것만 보여 줍니다(화면 시간 초). 이만큼 더 크면 재생 중인 자연 충돌을 끊고 바로 보여 줍니다
  const FRESH_VIEW = 2.5, BIG_RATIO = 1.5, RECORD_RATIO = 1.2;
  // 휴대폰에서 궤도 아래에 비워 두는 띠: 정착지 한 줄과 다시 보기 단추(28) + 안내(16)
  const NARROW_BAND = 44;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sst = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const ease5 = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
  const now = () => (root.performance && root.performance.now ? root.performance.now() : Date.now());
  function hashStr(s) { s = String(s); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function hashN(n) {
    let t = (Math.imul(n | 0, 0x9e3779b1) + 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function mk(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  // 회전시켜 그리기 (기본 변환은 dpr 배율만 있다고 봅니다)
  function rotDraw(ctx, img, x, y, w, h, ang, dpr) {
    const c = Math.cos(ang) * dpr, s = Math.sin(ang) * dpr;
    ctx.setTransform(c, s, -s, c, x * dpr, y * dpr);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------- 글자 조각 ---------- */
  const textCache = new Map();
  let measure = null;
  function meas() {
    if (measure) return measure;
    measure = mk(4, 4).getContext('2d');
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => textCache.clear()); } catch (e) { /* 글꼴 정보 없음 */ }
    return measure;
  }
  function textSprite(s, size, dpr, o) {
    o = o || {};
    const weight = o.weight || 400, color = o.color || C_TEXT, halo = o.halo !== false;
    const key = dpr + '|' + size + '|' + weight + '|' + color + '|' + (halo ? 1 : 0) + '|' + s;
    let t = textCache.get(key);
    if (t) return t;
    if (textCache.size > 500) textCache.clear();
    const m = meas(), font = weight + ' ' + size + 'px ' + F_BODY;
    m.font = font;
    const pad = halo ? 4 : 1, w = Math.ceil(m.measureText(s).width) + pad * 2, h = Math.ceil(size * 1.5) + 2;
    const c = mk(w * dpr, h * dpr), x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.font = font; x.textBaseline = 'middle';
    if (halo) { x.lineJoin = 'round'; x.lineWidth = 3.2; x.strokeStyle = 'rgba(4,6,11,.8)'; x.strokeText(s, pad, h / 2); }
    x.fillStyle = color; x.fillText(s, pad, h / 2);
    t = { c, w, h, dpr };
    textCache.set(key, t);
    return t;
  }
  function putText(ctx, t, x, y, ax, ay, a) {
    if (a != null && a <= 0.004) return;
    const d = t.dpr, px = Math.round((x - t.w * ax) * d) / d, py = Math.round((y - t.h * ay) * d) / d;
    if (a != null) ctx.globalAlpha = a;
    ctx.drawImage(t.c, px, py, t.w, t.h);
    if (a != null) ctx.globalAlpha = 1;
  }

  /* ---------- 빛 번짐 ---------- */
  const glowCache = new Map();
  function glow(r, g, b, pw) {
    const k = r + ',' + g + ',' + b + ',' + pw;
    let c = glowCache.get(k);
    if (c) return c;
    c = mk(128, 128);
    const x = c.getContext('2d'), G = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (let i = 0; i <= 14; i++) { const u = i / 14; G.addColorStop(u, `rgba(${r},${g},${b},${Math.pow(1 - u, pw).toFixed(4)})`); }
    x.fillStyle = G; x.fillRect(0, 0, 128, 128);
    glowCache.set(k, c);
    return c;
  }

  /* ---------- 오래 걸리는 그림은 일감으로 나눠 조금씩 만듭니다: 처음 들어갈 때 화면이 멈추지 않게 ---------- */
  const jobs = new Map();
  const need = (key, make) => { if (!jobs.has(key)) jobs.set(key, make()); };
  function work(ms) {
    const t0 = now();
    for (const [k, g] of jobs) {
      while (now() - t0 < ms) if (g.next().done) { jobs.delete(k); break; }
      if (now() - t0 >= ms) return;
    }
  }

  /* ---------- 하늘: 은하수와 별 ---------- */
  let nebCache = null;
  function* nebulaJob(seed) {
    const w = 320, h = 200, c = mk(w, h), x = c.getContext('2d'), im = x.createImageData(w, h), d = im.data;
    const N = new WS.Noise(seed), dens = new Float32Array(w * h);
    const ang = -0.44 + (hashN(seed) - 0.5) * 0.35, ca = Math.cos(ang), sa = Math.sin(ang), u0 = 0.18;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const fx = (px / w - 0.5) * 1.6, fy = py / h - 0.5;
        const u = fx * ca - fy * sa, v = fx * sa + fy * ca;
        const vv = v + N.fbm(u * 1.5 + 3, v * 1.5, 1.3, 3) * 0.13;
        const sig = 0.1 + 0.03 * N.n3(u * 2, 7.1, 0) + 0.075 * Math.exp(-(u - u0) * (u - u0) * 7);
        const band = Math.exp(-(vv * vv) / (2 * sig * sig));
        const tex = 0.62 + 0.95 * N.fbm(u * 5, v * 9, 2.7, 5);
        const inner = Math.exp(-(vv * vv) / (2 * sig * sig * 0.22));
        const lane = clamp(1 - Math.abs(N.fbm(u * 3.4, vv * 10, 9.1, 4)) * 5.2, 0, 1) * inner;
        const bulge = Math.exp(-((u - u0) * (u - u0) * 9 + vv * vv * 34));
        const I = Math.max(0, band * tex * (1 - 0.72 * lane));
        const n1 = Math.max(0, N.fbm(fx * 1.7 + 11, fy * 1.7, 4.2, 4)), n2 = Math.max(0, N.fbm(fx * 1.5 - 7, fy * 1.5, 8.2, 4));
        const i = (py * w + px) * 4;
        d[i] = 4 + I * (28 + 84 * bulge) + n1 * 15;
        d[i + 1] = 6 + I * (33 + 60 * bulge) + n1 * 4 + n2 * 9;
        d[i + 2] = 12 + I * (54 + 24 * bulge) + n1 * 17 + n2 * 16;
        d[i + 3] = 255;
        dens[py * w + px] = clamp(I * 0.9 + bulge * 0.3, 0, 1);
      }
      yield;
    }
    x.putImageData(im, 0, 0);
    nebCache = { seed, c, dens, w, h };
  }
  const SKY_M = 1.16;
  let skyCache = null, skyWait = null;
  // 새 하늘이 다 될 때까지는 크기가 다른 옛 하늘을 늘려 씁니다 (처음이면 없음)
  function skyFor(W, H, dpr, seed) {
    const key = W + '|' + H + '|' + dpr + '|' + seed;
    if (skyCache && skyCache.key === key) return skyCache;
    if (skyWait && skyWait !== key && nebCache && nebCache.seed === seed) jobs.delete(skyWait);
    skyWait = key;
    need(key, () => skyJob(key, W, H, dpr, seed));
    return skyCache;
  }
  function* skyJob(key, W, H, dpr, seed) {
    if (!nebCache || nebCache.seed !== seed) yield* nebulaJob(seed);
    const neb = nebCache, cw = W * SKY_M, ch = H * SKY_M;
    const c = mk(cw * dpr, ch * dpr), x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.imageSmoothingQuality = 'high';
    x.drawImage(neb.c, 0, 0, cw, ch);
    const r = new WS.RNG(seed ^ 0x51a7), n = Math.round(clamp((W * H) / 340, 900, 5600));
    const cols = ['#ffffff', '#dfe8ff', '#c4d4ff', '#fff4e4', '#ffe2c0', '#ffc9a8'];
    for (let i = 0; i < n; i++) {
      let u = 0, v = 0;
      for (let k = 0; k < 6; k++) {
        u = r.next(); v = r.next();
        if (r.next() < 0.18 + 0.82 * neb.dens[Math.floor(v * neb.h) * neb.w + Math.floor(u * neb.w)]) break;
      }
      const m = r.next(), mag = m * m * m * m, size = 0.55 + mag * 1.1, pick = r.next();
      x.globalAlpha = 0.16 + 0.5 * r.next() * r.next() + mag * 0.34;
      x.fillStyle = cols[pick < 0.34 ? 0 : pick < 0.6 ? 1 : pick < 0.75 ? 2 : pick < 0.88 ? 3 : pick < 0.96 ? 4 : 5];
      if (size < 1) x.fillRect(u * cw, v * ch, size, size);
      else { x.beginPath(); x.arc(u * cw, v * ch, size * 0.62, 0, TAU); x.fill(); }
      if (i % 200 === 199) yield;
    }
    const bright = Math.round(clamp(n / 90, 12, 44));
    for (let i = 0; i < bright; i++) {
      const u = r.next(), v = r.next(), s = 3.2 + r.next() * 6, tint = r.next();
      const g = tint < 0.5 ? glow(214, 228, 255, 3) : tint < 0.8 ? glow(255, 240, 220, 3) : glow(255, 204, 168, 3);
      x.globalAlpha = 0.5 + r.next() * 0.4;
      x.drawImage(g, u * cw - s, v * ch - s, s * 2, s * 2);
      x.globalAlpha = 0.9; x.fillStyle = '#fff';
      x.beginPath(); x.arc(u * cw, v * ch, 0.55 + s * 0.05, 0, TAU); x.fill();
      if (s > 6.8) {
        x.globalAlpha = 0.22; x.fillRect(u * cw - s * 1.5, v * ch - 0.25, s * 3, 0.5); x.fillRect(u * cw - 0.25, v * ch - s * 1.5, 0.5, s * 3);
      }
    }
    x.globalAlpha = 1;
    const V = x.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.hypot(cw, ch) * 0.52);
    V.addColorStop(0, 'rgba(2,3,7,0)'); V.addColorStop(1, 'rgba(2,3,7,.62)');
    x.fillStyle = V; x.fillRect(0, 0, cw, ch);
    skyCache = { key, c, cw, ch };
    if (skyWait === key) skyWait = null;
  }
  // 가까운 별: 줌할 때 바깥으로 흘러가 깊이를 만듭니다
  let nearStars = null;
  function nearSet() {
    if (nearStars) return nearStars;
    const n = 110, a = new Float32Array(n * 4), r = new WS.RNG(0x7713);
    for (let i = 0; i < n; i++) { a[i * 4] = r.range(-1.05, 1.05); a[i * 4 + 1] = r.range(-1.05, 1.05); a[i * 4 + 2] = r.range(0.25, 1); a[i * 4 + 3] = r.next(); }
    return (nearStars = { n, a });
  }
  function drawSky(ctx, W, H, dpr, seed, zn, panX, panY, stars, zv, t) {
    const sky = skyFor(W, H, dpr, seed), s = 1 + 0.1 * zn;
    const dw = W * SKY_M * s, dh = H * SKY_M * s;
    ctx.fillStyle = '#05070b'; ctx.fillRect(0, 0, W, H);
    if (sky) ctx.drawImage(sky.c, (W - dw) / 2 + panX, (H - dh) / 2 + panY, dw, dh);
    if (zn > 0.01) { ctx.fillStyle = `rgba(3,4,8,${(0.42 * zn).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
    if (!stars) return;
    const N = nearSet(), a = N.a, cx = W / 2, cy = H / 2, smear = clamp(zv * 0.05, 0, 0.09);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.fillStyle = '#dfe8ff'; ctx.strokeStyle = '#dfe8ff';
    for (let i = 0; i < N.n; i++) {
      const dp = a[i * 4 + 2], k = 1 + dp * zn * 2.2, x0 = a[i * 4] * W * 0.5, y0 = a[i * 4 + 1] * H * 0.5;
      const x = cx + x0 * k + panX * dp * 4, y = cy + y0 * k + panY * dp * 4;
      if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      const tw = 0.3 + 0.28 * dp + 0.14 * Math.sin(t * (0.7 + a[i * 4 + 3]) + i);
      ctx.globalAlpha = clamp(tw, 0, 1);
      if (smear > 0.002 && i % 2 === 0) {
        const k2 = 1 + dp * (zn - smear) * 2.2;
        ctx.globalAlpha = clamp(tw * 0.7, 0, 1);
        ctx.lineWidth = 0.5 + dp * 0.4;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx + x0 * k2 + panX * dp * 4, cy + y0 * k2 + panY * dp * 4); ctx.stroke();
      } else {
        const sz = 0.6 + dp * 0.65;
        ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------- 행성 그림 ---------- */
  const mix3 = (o, a, b, t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; };
  function bandOf(tab, y, o) {
    let i = 0;
    while (i < tab.length - 2 && y > tab[i + 1][0]) i++;
    const A = tab[i], B = tab[i + 1], k = clamp((y - A[0]) / (B[0] - A[0]), 0, 1), s = k * k * (3 - 2 * k);
    o[0] = A[1][0] + (B[1][0] - A[1][0]) * s; o[1] = A[1][1] + (B[1][1] - A[1][1]) * s; o[2] = A[1][2] + (B[1][2] - A[1][2]) * s;
  }
  const JUP = [[-1, [118, 108, 104]], [-0.82, [150, 134, 116]], [-0.64, [184, 156, 124]], [-0.5, [224, 202, 168]], [-0.38, [166, 116, 82]], [-0.26, [234, 216, 184]], [-0.12, [158, 102, 68]], [-0.02, [240, 226, 200]], [0.12, [238, 222, 192]], [0.22, [150, 96, 62]], [0.36, [228, 206, 172]], [0.48, [172, 132, 98]], [0.62, [208, 186, 152]], [0.82, [150, 136, 118]], [1, [116, 106, 102]]];
  const SAT = [[-1, [146, 130, 104]], [-0.7, [196, 174, 134]], [-0.45, [224, 202, 158]], [-0.28, [202, 176, 132]], [-0.1, [236, 216, 172]], [0.08, [244, 226, 184]], [0.24, [216, 192, 146]], [0.46, [232, 210, 166]], [0.7, [190, 168, 130]], [1, [140, 126, 104]]];
  const GASP = [
    [[-1, [120, 88, 70]], [-0.6, [190, 140, 100]], [-0.3, [226, 186, 140]], [-0.1, [170, 110, 74]], [0.1, [234, 200, 156]], [0.32, [160, 104, 72]], [0.6, [210, 170, 128]], [1, [116, 86, 70]]],
    [[-1, [96, 84, 110]], [-0.6, [162, 142, 170]], [-0.3, [214, 196, 206]], [-0.1, [136, 116, 150]], [0.1, [222, 208, 214]], [0.32, [130, 112, 148]], [0.6, [190, 172, 190]], [1, [92, 82, 108]]],
    [[-1, [120, 66, 52]], [-0.6, [186, 104, 72]], [-0.3, [226, 158, 108]], [-0.1, [154, 82, 58]], [0.1, [236, 186, 134]], [0.32, [150, 80, 60]], [0.6, [206, 136, 96]], [1, [114, 64, 52]]],
  ];
  const ROCKP = [[[92, 82, 74], [176, 158, 138]], [[110, 66, 48], [204, 142, 104]], [[86, 88, 92], [168, 170, 170]], [[100, 90, 64], [190, 176, 128]]];
  // 크레이터: 표면 위 점을 구면으로 찍어 짧아진 타원으로 그립니다
  function craters(x, S, seed, count, rMin, rMax, dark, lite) {
    const r = new WS.RNG(seed ^ 0xc4a7), R = S / 2 - 1, m = S / 2;
    x.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < count; i++) {
      const th = r.next() * TAU, cz = Math.sqrt(r.next()), sz = Math.sqrt(1 - cz * cz), a = rMin * Math.pow(rMax / rMin, Math.pow(r.next(), 2.6)) * S;
      const px = m + R * sz * Math.cos(th), py = m + R * sz * Math.sin(th), sq = Math.max(0.2, cz);
      x.save(); x.translate(px, py); x.rotate(th); x.scale(sq, 1);
      x.fillStyle = `rgba(0,0,0,${dark})`; x.beginPath(); x.arc(0, 0, a, 0, TAU); x.fill();
      x.strokeStyle = `rgba(255,248,235,${lite})`; x.lineWidth = Math.max(0.5, a * 0.22); x.beginPath(); x.arc(0, 0, a * 1.02, 0, TAU); x.stroke();
      x.restore();
    }
    x.globalCompositeOperation = 'source-over';
  }
  const LOOKS = {
    mercury: { limb: 0.38, fn(N, X, Y, Z, o) { const v = 0.5 + N.fbm(X * 3, Y * 3, Z * 3, 5) * 0.95; mix3(o, [86, 78, 74], [186, 172, 156], v); }, post: (x, S, s) => craters(x, S, s, 46, 0.012, 0.075, 0.18, 0.12) },
    venus: { limb: 0.62, rim: [255, 226, 170], rimA: 0.55, fn(N, X, Y, Z, o) { const w = N.fbm(X * 2, Y * 2, Z * 2, 3); const v = 0.52 + N.fbm(X * 1.4 + w, Y * 4.4 + w * 2, Z * 1.4, 4) * 0.9; mix3(o, [198, 156, 98], [252, 234, 196], v); } },
    earth: {
      limb: 0.45, rim: [120, 170, 255], rimA: 0.9, roll: -0.38,
      fn(N, X, Y, Z, o, s) {
        const e = N.fbm(X * 1.7 + 3, Y * 1.7, Z * 1.7, 5);
        if (e < 0.03) mix3(o, [12, 42, 104], [28, 92, 158], (e + 0.5) * 1.8);
        else { mix3(o, [62, 110, 58], [176, 150, 100], 0.5 + N.fbm(X * 3, Y * 3 + 4, Z * 3, 3) * 1.8); }
        if (Math.abs(Y) + 0.05 * N.n3(X * 5, Y * 5, Z * 5) > 0.84) { o[0] = 232; o[1] = 238; o[2] = 244; }
        const c = sst(0.02, 0.26, N.fbm(X * 2.4 + 5, Y * 4.2, Z * 2.4, 4));
        o[0] += (244 - o[0]) * c * 0.85; o[1] += (246 - o[1]) * c * 0.85; o[2] += (250 - o[2]) * c * 0.85;
      },
    },
    moon: {
      limb: 0.55,
      fn(N, X, Y, Z, o) { const m = sst(-0.08, 0.1, N.fbm(X * 1.5 + 2, Y * 1.5, Z * 1.5 + 7, 4)), v = 0.5 + N.fbm(X * 6, Y * 6, Z * 6, 4) * 0.7; mix3(o, [78, 76, 76], [108, 104, 100], v); const a = o[0], b = o[1], c = o[2]; mix3(o, [158, 154, 146], [208, 204, 194], v); o[0] = a + (o[0] - a) * m; o[1] = b + (o[1] - b) * m; o[2] = c + (o[2] - c) * m; },
      post: (x, S, s) => craters(x, S, s, 90, 0.008, 0.06, 0.13, 0.16),
    },
    mars: {
      limb: 0.48, rim: [255, 176, 130], rimA: 0.35, roll: -0.42,
      fn(N, X, Y, Z, o) {
        const v = 0.5 + N.fbm(X * 3, Y * 3, Z * 3, 5) * 0.8, dk = sst(0.02, 0.2, N.fbm(X * 1.8 + 8, Y * 1.8, Z * 1.8, 4));
        mix3(o, [156, 78, 44], [226, 142, 90], v);
        o[0] += (82 - o[0]) * dk * 0.75; o[1] += (58 - o[1]) * dk * 0.75; o[2] += (48 - o[2]) * dk * 0.75;
        if (Math.abs(Y) + 0.04 * N.n3(X * 7, Y * 7, Z * 7) > 0.9) { o[0] = 240; o[1] = 236; o[2] = 230; }
      },
    },
    ceres: { limb: 0.5, fn(N, X, Y, Z, o) { mix3(o, [92, 88, 86], [150, 146, 140], 0.5 + N.fbm(X * 4, Y * 4, Z * 4, 4)); }, post: (x, S, s) => craters(x, S, s, 40, 0.012, 0.07, 0.2, 0.12) },
    jupiter: {
      limb: 0.34, roll: 0.05,
      fn(N, X, Y, Z, o) {
        const yy = Y + 0.04 * N.fbm(X * 3, Y * 9, Z * 3, 4) + 0.012 * N.n3(X * 11, Y * 28, Z * 11);
        bandOf(JUP, yy, o);
        const k = 1 + N.fbm(X * 2.2, Y * 30, Z * 2.2, 3) * 0.2;
        o[0] *= k; o[1] *= k; o[2] *= k;
        const lat = Math.asin(clamp(Y, -1, 1)), lon = Math.atan2(X, Z), dx = (lon - 0.45) * Math.cos(lat) / 0.3, dy = (lat + 0.38) / 0.145, e = dx * dx + dy * dy;
        if (e < 1.6) { const a = 1 - sst(0.55, 1.6, e); o[0] += (198 - o[0]) * a; o[1] += (92 - o[1]) * a; o[2] += (62 - o[2]) * a; }
      },
    },
    saturn: { limb: 0.42, roll: -0.24, fn(N, X, Y, Z, o) { bandOf(SAT, Y + 0.012 * N.fbm(X * 3, Y * 10, Z * 3, 3), o); const k = 1 + N.fbm(X * 2, Y * 26, Z * 2, 3) * 0.1; o[0] *= k; o[1] *= k; o[2] *= k; } },
    uranus: { limb: 0.55, rim: [210, 245, 250], rimA: 0.55, roll: 1.35, pitch: 0.2, fn(N, X, Y, Z, o) { mix3(o, [146, 206, 214], [196, 236, 238], 0.5 + Y * 0.5 + N.fbm(X * 2, Y * 8, Z * 2, 3) * 0.2); } },
    neptune: {
      limb: 0.42, rim: [150, 190, 255], rimA: 0.7, roll: -0.42,
      fn(N, X, Y, Z, o) {
        mix3(o, [36, 72, 178], [86, 138, 226], 0.5 + N.fbm(X * 1.6, Y * 7, Z * 1.6, 4) * 1.2);
        const c = sst(0.14, 0.34, N.fbm(X * 2.2 + 6, Y * 15, Z * 2.2, 3));
        o[0] += (232 - o[0]) * c * 0.6; o[1] += (240 - o[1]) * c * 0.6; o[2] += (255 - o[2]) * c * 0.6;
        const lat = Math.asin(clamp(Y, -1, 1)), lon = Math.atan2(X, Z), dx = (lon + 0.35) * Math.cos(lat) / 0.26, dy = (lat + 0.33) / 0.13, e = dx * dx + dy * dy;
        if (e < 1.5) { const a = (1 - sst(0.5, 1.5, e)) * 0.65; o[0] += (16 - o[0]) * a; o[1] += (36 - o[1]) * a; o[2] += (110 - o[2]) * a; }
      },
    },
    ganymede: { limb: 0.52, fn(N, X, Y, Z, o) { const g = sst(-0.08, 0.14, N.fbm(X * 2.2, Y * 2.2, Z * 2.2, 4)); mix3(o, [92, 82, 72], [182, 172, 158], g + N.fbm(X * 9, Y * 9, Z * 9, 3) * 0.5); }, post: (x, S, s) => craters(x, S, s, 22, 0.012, 0.05, 0.1, 0.2) },
    europa: { limb: 0.58, fn(N, X, Y, Z, o) { mix3(o, [214, 204, 180], [246, 240, 226], 0.5 + N.fbm(X * 3, Y * 3, Z * 3, 3)); const l = clamp(1 - Math.abs(N.fbm(X * 3.6, Y * 3.6, Z * 3.6, 4)) * 16, 0, 1); o[0] += (150 - o[0]) * l * 0.7; o[1] += (94 - o[1]) * l * 0.7; o[2] += (62 - o[2]) * l * 0.7; } },
    titan: { limb: 0.7, rim: [255, 190, 110], rimA: 0.9, fn(N, X, Y, Z, o) { mix3(o, [190, 128, 54], [234, 176, 92], 0.55 + N.fbm(X * 1.6, Y * 3.2, Z * 1.6, 3) * 0.8); } },
    triton: { limb: 0.55, fn(N, X, Y, Z, o) { mix3(o, [176, 150, 148], [240, 222, 214], 0.5 + N.fbm(X * 3.4, Y * 3.4, Z * 3.4, 4) * 1.2); } },
    rocky: { limb: 0.42, fn(N, X, Y, Z, o, s) { const P = ROCKP[s % ROCKP.length]; mix3(o, P[0], P[1], 0.5 + N.fbm(X * 3, Y * 3, Z * 3, 5) * 0.95); }, post: (x, S, s) => craters(x, S, s, 26, 0.012, 0.06, 0.14, 0.09) },
    ocean: {
      limb: 0.45, rim: [130, 190, 255], rimA: 0.9, roll: -0.3,
      fn(N, X, Y, Z, o) {
        const e = N.fbm(X * 2.1 + 3, Y * 2.1, Z * 2.1, 5);
        if (e < 0.2) mix3(o, [10, 46, 112], [30, 108, 170], (e + 0.5) * 1.3); else mix3(o, [86, 130, 80], [170, 150, 106], (e - 0.2) * 4);
        if (Math.abs(Y) + 0.05 * N.n3(X * 5, Y * 5, Z * 5) > 0.86) { o[0] = 226; o[1] = 236; o[2] = 244; }
        const c = sst(0.03, 0.28, N.fbm(X * 2.4 + 5, Y * 4.4, Z * 2.4, 4));
        o[0] += (242 - o[0]) * c * 0.85; o[1] += (246 - o[1]) * c * 0.85; o[2] += (250 - o[2]) * c * 0.85;
      },
    },
    gas: { limb: 0.34, roll: 0.12, fn(N, X, Y, Z, o, s) { bandOf(GASP[s % GASP.length], Y + 0.035 * N.fbm(X * 3, Y * 9, Z * 3, 4), o); const k = 1 + N.fbm(X * 2.2, Y * 26, Z * 2.2, 3) * 0.18; o[0] *= k; o[1] *= k; o[2] *= k; } },
    ice: { limb: 0.5, rim: [190, 225, 255], rimA: 0.6, roll: -0.3, fn(N, X, Y, Z, o, s) { const P = s % 2 ? [[64, 138, 170], [160, 216, 226]] : [[58, 102, 190], [136, 184, 232]]; mix3(o, P[0], P[1], 0.5 + N.fbm(X * 1.8, Y * 8, Z * 1.8, 4) * 1.2); } },
  };
  const spriteCache = new Map();
  function* planetJob(look, S, seed, done) {
    const def = LOOKS[look] || LOOKS.rocky, c = mk(S, S), x = c.getContext('2d'), im = x.createImageData(S, S), d = im.data;
    const N = new WS.Noise(seed || 1), o = [0, 0, 0];
    const roll = def.roll || 0, pitch = def.pitch == null ? 0.42 : def.pitch, cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const R = S / 2 - 1, m = S / 2, limbA = def.limb, rim = def.rim, rimA = def.rimA || 0;
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const nx = (px + 0.5 - m) / R, ny = (m - py - 0.5) / R, rr = nx * nx + ny * ny;
        if (rr > 1.04) continue;
        const nz = Math.sqrt(Math.max(0, 1 - rr));
        const x1 = nx * cr + ny * sr, y1 = -nx * sr + ny * cr;
        def.fn(N, x1, y1 * cp + nz * sp, -y1 * sp + nz * cp, o, seed >>> 0);
        const lb = limbA + (1 - limbA) * Math.pow(nz, 0.6);
        let r = o[0] * lb, g = o[1] * lb, b = o[2] * lb;
        if (rim) { const f = Math.pow(1 - nz, 2.6) * rimA; r += (rim[0] - r) * f; g += (rim[1] - g) * f; b += (rim[2] - b) * f; }
        const i = (py * S + px) * 4;
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
        d[i + 3] = clamp((1 - Math.sqrt(rr)) * R + 0.5, 0, 1) * 255;
      }
      yield;
    }
    x.putImageData(im, 0, 0);
    if (def.post) def.post(x, S, seed >>> 0);
    done(c);
  }
  function halve(c) {
    const h = mk(c.width / 2, c.height / 2), x = h.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(c, 0, 0, h.width, h.height);
    return h;
  }
  const GENERIC = { rocky: 1, gas: 1, ice: 1, ocean: 1 };
  const spriteSeed = (look, id) => (GENERIC[look] ? hashStr(id) % 8 + 3 : (hashStr(look) % 97) + 5);
  function sprite(look, id) {
    const seed = spriteSeed(look, id), k = look + '|' + seed, s = spriteCache.get(k);
    if (s) return s;
    need(k, () => planetJob(look, 128, seed, (top) => {
      const m64 = halve(top), m32 = halve(m64), m16 = halve(m32);
      spriteCache.set(k, { mips: [m16, m32, m64, top], seed, look, hi: null });
    }));
    return null;
  }
  // 그림이 되기 전에 쓸 민무늬 색: 그 행성의 표면을 한 점만 읽습니다
  const flatCache = new Map();
  function flatColor(look, id) {
    const seed = spriteSeed(look, id), k = look + '|' + seed;
    let c = flatCache.get(k);
    if (c) return c;
    const o = [0, 0, 0];
    (LOOKS[look] || LOOKS.rocky).fn(new WS.Noise(seed), 0.3, 0.2, 0.93, o, seed >>> 0);
    c = `rgb(${o[0] | 0},${o[1] | 0},${o[2] | 0})`;
    flatCache.set(k, c);
    return c;
  }
  function pickMip(s, px) {
    const m = s.mips;
    if (px > 150) {
      if (s.hi) return s.hi;
      need('hi|' + s.look + '|' + s.seed, () => planetJob(s.look, 256, s.seed, (c) => { s.hi = c; }));
      return m[3];
    }
    return px <= 16 ? m[0] : px <= 32 ? m[1] : px <= 64 ? m[2] : m[3];
  }
  // 그늘: 해가 +x쪽에 있는 원판의 어두운 부분. lz는 위상(음수면 초승달, 양수면 볼록달)
  const shadeCache = new Map();
  function shadeSprite(lz, S) {
    const k = lz + '|' + S;
    let c = shadeCache.get(k);
    if (c) return c;
    c = mk(S, S);
    const x = c.getContext('2d'), im = x.createImageData(S, S), d = im.data, R = S / 2 - 0.5, m = S / 2;
    const l = Math.hypot(1, lz), lx = 1 / l, lzz = lz / l;
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const nx = (px + 0.5 - m) / R, ny = (py + 0.5 - m) / R, rr = nx * nx + ny * ny;
      if (rr > 1.04) continue;
      const nz = Math.sqrt(Math.max(0, 1 - rr)), ll = nx * lx + nz * lzz, i = (py * S + px) * 4;
      d[i] = 2; d[i + 1] = 3; d[i + 2] = 8;
      d[i + 3] = (S < 64 ? 134 : 196) * (1 - sst(-0.2, 0.42, ll)) * clamp((1 - Math.sqrt(rr)) * R + 0.7, 0, 1);
    }
    x.putImageData(im, 0, 0);
    shadeCache.set(k, c);
    return c;
  }
  const SHADE_LZ = [0.36, 0.52, 0.74, 1.02];
  function shadeFor(zs, px) {
    const i = zs < -0.55 ? 3 : zs < 0 ? 2 : zs < 0.55 ? 1 : 0;
    return shadeSprite(SHADE_LZ[i], px > 48 ? 128 : 48);
  }
  // 대기 띠: 해 쪽이 밝고 가장자리 밖으로 번집니다 (원판 반지름 = 크기의 1/1.32)
  const atmoCache = new Map();
  const ATMO_K = 1.32;
  function atmoSprite(col) {
    const k = col.join(',');
    let c = atmoCache.get(k);
    if (c) return c;
    const S = 196, m = S / 2, R = m / ATMO_K;
    c = mk(S, S);
    const x = c.getContext('2d'), im = x.createImageData(S, S), d = im.data;
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const dx = px + 0.5 - m, dy = py + 0.5 - m, r = Math.hypot(dx, dy) / R;
      if (r > ATMO_K) continue;
      const side = 0.12 + 0.88 * sst(-0.5, 0.7, dx / Math.max(1e-3, Math.hypot(dx, dy)));
      const prof = r < 1 ? sst(0.9, 1, r) : Math.exp(-(r - 1) * 15);
      const edge = 1 - sst(ATMO_K - 0.06, ATMO_K, r), i = (py * S + px) * 4;
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2];
      d[i + 3] = 255 * prof * side * edge * 0.92;
    }
    x.putImageData(im, 0, 0);
    atmoCache.set(k, c);
    return c;
  }

  /* ---------- 토성 고리 ---------- */
  const RING_MAX = 2.34, RING_SQ = 0.4, RING_ROLL = -0.24;
  let ringBase = null;
  function ringSprites() {
    if (!ringBase) need('ring', ringJob);
    return ringBase;
  }
  function* ringJob() {
    const S = 720, H = Math.round(S * RING_SQ), mx = S / 2, my = H / 2, NB = 44;
    const back = mk(S, H), front = mk(S, H), xb = back.getContext('2d'), xf = front.getContext('2d');
    const ib = xb.createImageData(S, H), iF = xf.createImageData(S, H), n1 = new Float32Array(NB + 2);
    const r0 = new WS.RNG(0xa11);
    for (let i = 0; i < NB + 2; i++) n1[i] = 0.18 + r0.next() * 0.64;
    for (let py = 0; py < H; py++) for (let px = 0; px < S; px++) {
      const X = (px + 0.5 - mx) / mx * RING_MAX, Y = (py + 0.5 - my) / my * RING_MAX, r = Math.hypot(X, Y);
      if (r < 1.2 || r > 2.32) continue;
      let a, cr, cg, cb;
      if (r < 1.53) { a = 0.1 + 0.2 * sst(1.24, 1.53, r); cr = 150; cg = 138; cb = 120; }
      else if (r < 1.95) { a = 0.86; cr = 236; cg = 218; cb = 186; }
      else if (r < 2.03) { a = 0.05; cr = 120; cg = 110; cb = 100; }
      else if (r < 2.27) { a = 0.68; cr = 210; cg = 196; cb = 170; }
      else { a = 0.14; cr = 190; cg = 180; cb = 160; }
      if (Math.abs(r - 2.215) < 0.012) a *= 0.25;
      const nq = (r - 1.2) / 1.12 * NB, ni = Math.floor(nq), nv = lerp(n1[ni], n1[ni + 1], sst(0, 1, nq - ni)), k = 0.62 + nv * 0.82;
      a = clamp(a * (0.6 + nv * 0.85), 0, 1) * sst(1.2, 1.25, r) * (1 - sst(2.29, 2.32, r));
      const im = py < my ? ib : iF, i = (py * S + px) * 4;
      im.data[i] = cr * k; im.data[i + 1] = cg * k; im.data[i + 2] = cb * k; im.data[i + 3] = a * 255;
      if (px === S - 1) yield;
    }
    xb.putImageData(ib, 0, 0); xf.putImageData(iF, 0, 0);
    ringBase = { back: halve(back), front: halve(front), S: S / 2, H: H / 2 };
  }
  // 행성 그림자가 고리에 떨어진 모습. 해 방향이 조금 달라질 때만 다시 만듭니다
  function ringWithShadow(cache, th) {
    if (cache.c && Math.abs(cache.th - th) < 0.03) return cache.c;
    const B = ringSprites();
    if (!B) return null;
    const S = B.S, H = B.H, mx = S / 2, my = H / 2, u = mx / RING_MAX;
    const dx = Math.cos(th), dy = Math.sin(th), L = RING_MAX * 1.2 * u, w = u * 0.98;
    const pts = [[-dy * w, dx * w], [-dy * w + dx * L, dx * w + dy * L], [dy * w + dx * L, -dx * w + dy * L], [dy * w, -dx * w]];
    const make = (src) => {
      const c = mk(S, H), x = c.getContext('2d');
      x.drawImage(src, 0, 0);
      x.globalCompositeOperation = 'destination-out';
      x.globalAlpha = 0.86;
      x.beginPath();
      pts.forEach((p, i) => { const X = mx + p[0], Y = my + p[1] * RING_SQ; if (i) x.lineTo(X, Y); else x.moveTo(X, Y); });
      x.closePath(); x.fill();
      return c;
    };
    const back = make(B.back), front = make(B.front);
    cache.th = th;
    const back2 = halve(back), front2 = halve(front);
    cache.c = { back, front, back2, front2, back3: halve(back2), front3: halve(front2) };
    return cache.c;
  }

  /* ---------- 태양 ---------- */
  const sunCache = new Map();
  function sunSprites(col) {
    const k = col.join(',');
    let s = sunCache.get(k);
    if (s) return s;
    const W_ = [255, 255, 250];
    // 원반: 경계가 빛에 묻히도록
    const S = 128, disc = mk(S, S), xd = disc.getContext('2d'), id = xd.createImageData(S, S), m = S / 2, R = m - 1;
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const nx = (px + 0.5 - m) / R, ny = (py + 0.5 - m) / R, r = Math.hypot(nx, ny);
      if (r > 1) continue;
      const k = Math.pow(r, 2.6), i = (py * S + px) * 4;
      id.data[i] = lerp(W_[0], col[0], k);
      id.data[i + 1] = lerp(W_[1], col[1] * 0.86, k);
      id.data[i + 2] = lerp(W_[2], col[2] * 0.56, k);
      id.data[i + 3] = (1 - sst(0.86, 1, r)) * 255;
    }
    xd.putImageData(id, 0, 0);
    const streak = mk(256, 24), xs = streak.getContext('2d');
    const G = xs.createLinearGradient(0, 0, 256, 0);
    G.addColorStop(0, 'rgba(255,240,215,0)'); G.addColorStop(0.5, 'rgba(255,244,226,.9)'); G.addColorStop(1, 'rgba(255,240,215,0)');
    xs.fillStyle = G;
    for (let i = 0; i < 12; i++) { xs.globalAlpha = Math.pow(1 - i / 12, 2) * 0.4; xs.fillRect(0, 12 - i, 256, i * 2 + 1); }
    s = { disc, rays: [null, null], streak, halo: glow(col[0], Math.round(col[1] * 0.74), Math.round(col[2] * 0.42), 3.2), mid: glow(col[0], Math.round(col[1] * 0.88), Math.round(col[2] * 0.66), 2.6), core: glow(255, 244, 220, 2.2) };
    sunCache.set(k, s);
    need('sun|' + k, () => raysJob(s, col));
    return s;
  }
  // 코로나 줄기
  function* raysJob(s, col) {
    const N = new WS.Noise(0x50e);
    for (let v = 0; v < 2; v++) {
      const Sr = 256, c = mk(Sr, Sr), x = c.getContext('2d'), im = x.createImageData(Sr, Sr), mr = Sr / 2;
      for (let py = 0; py < Sr; py++) {
        for (let px = 0; px < Sr; px++) {
          const dx = (px + 0.5 - mr) / mr, dy = (py + 0.5 - mr) / mr, r = Math.hypot(dx, dy);
          if (r > 1 || r < 0.02) continue;
          const a = Math.atan2(dy, dx), n = N.fbm(Math.cos(a) * 5 + v * 9, Math.sin(a) * 5, r * 0.8 + v * 3, 4);
          const ray = Math.pow(clamp(0.5 + n * 1.5, 0, 1), 2.4), f = Math.pow(1 - r, 2.6) * (0.25 + ray * 1.5), i = (py * Sr + px) * 4;
          im.data[i] = col[0]; im.data[i + 1] = col[1] * 0.84; im.data[i + 2] = col[2] * 0.58; im.data[i + 3] = clamp(f, 0, 1) * 255;
        }
        yield;
      }
      x.putImageData(im, 0, 0);
      s.rays[v] = c;
    }
  }
  function drawSun(ctx, x, y, R, star, t, dpr, veil) {
    const col = star.color || [255, 236, 200], gl = clamp(star.glow == null ? 1 : star.glow, 0.4, 2) * veil, s = sunSprites(col);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.34 * gl; ctx.drawImage(s.halo, x - R * 20, y - R * 20, R * 40, R * 40);
    ctx.globalAlpha = 0.5 * gl; ctx.drawImage(s.halo, x - R * 8.5, y - R * 8.5, R * 17, R * 17);
    ctx.globalAlpha = Math.min(1, 0.72 * gl); if (s.rays[0]) rotDraw(ctx, s.rays[0], x, y, R * 8.6, R * 8.6, t * 0.018, dpr);
    ctx.globalAlpha = Math.min(1, 0.55 * gl); if (s.rays[1]) rotDraw(ctx, s.rays[1], x, y, R * 5.8, R * 5.8, -t * 0.03, dpr);
    ctx.globalAlpha = Math.min(1, 0.7 * gl); ctx.drawImage(s.mid, x - R * 3.1, y - R * 3.1, R * 6.2, R * 6.2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1; ctx.drawImage(s.disc, x - R, y - R, R * 2, R * 2);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.42; ctx.drawImage(s.core, x - R * 1.35, y - R * 1.35, R * 2.7, R * 2.7);
    ctx.globalAlpha = Math.min(1, 0.26 * gl); ctx.drawImage(s.streak, x - R * 9, y - R * 0.42, R * 18, R * 0.84);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------- 구름 잡음표 (조금씩 나눠 만듭니다) ---------- */
  const NT = { w: 512, h: 256, data: null, y: 0, ready: false, N: null, at: 0 };
  function noiseStep(ms) {
    if (NT.ready) return;
    if (!NT.data) { NT.data = new Uint8Array(NT.w * NT.h); NT.N = new WS.Noise(0xc10d); }
    const t0 = now(), N = NT.N, w = NT.w, h = NT.h, d = NT.data;
    while (NT.y < h && now() - t0 < ms) {
      const y = NT.y++, la = (0.5 - (y + 0.5) / h) * Math.PI, sl = Math.sin(la), cl = Math.cos(la), al = Math.abs(la) / (Math.PI / 2);
      const belt = 0.1 * Math.exp(-al * al * 90) - 0.07 * Math.exp(-(al - 0.3) * (al - 0.3) * 60) + 0.09 * Math.exp(-(al - 0.62) * (al - 0.62) * 50);
      for (let x = 0; x < w; x++) {
        const lo = ((x + 0.5) / w) * TAU, X = cl * Math.sin(lo), Z = cl * Math.cos(lo);
        const wv = N.fbm(X * 2 + 4, sl * 2, Z * 2, 2) * 0.55;
        const v = N.fbm(X * 2.4 + wv, sl * 4.2 - wv, Z * 2.4 + wv, 5);
        d[y * w + x] = clamp(128 + (v + belt) * 255, 0, 255);
      }
    }
    if (NT.y >= h) { NT.ready = true; NT.N = null; NT.at = now(); }
  }
  const CLOUD_LUT = new Float32Array(256);
  for (let i = 0; i < 256; i++) CLOUD_LUT[i] = sst(128, 206, i);

  /* ---------- 지구본: 픽셀마다 표면을 찾아 칠합니다 ---------- */
  const DAY = new Float32Array(256), NIGHT = new Float32Array(256), WARM = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const ll = i / 127.5 - 1;
    DAY[i] = 0.02 + 0.98 * Math.pow(sst(-0.05, 0.78, ll), 0.82);
    NIGHT[i] = 1 - sst(-0.12, 0.08, ll);
    WARM[i] = Math.exp(-((ll - 0.03) / 0.065) * ((ll - 0.03) / 0.065));
  }
  const tableCache = new Map();
  function globeTable(N, roll, pitch) {
    const key = N + '|' + roll.toFixed(3) + '|' + pitch.toFixed(3);
    let T = tableCache.get(key);
    if (T) return T;
    if (tableCache.size > 12) tableCache.delete(tableCache.keys().next().value);
    const m = N / 2, RR = m - 1, cap = N * N;
    const PX = new Int32Array(cap), NX = new Float32Array(cap), NY = new Float32Array(cap), NZ = new Float32Array(cap), LON = new Uint16Array(cap), LAT = new Uint16Array(cap), RIM = new Uint8Array(cap), LB = new Float32Array(cap), AA = new Uint8Array(cap);
    const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
    let n = 0;
    for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
      const x = (px + 0.5 - m) / RR, y = (m - py - 0.5) / RR, rr = x * x + y * y;
      if (rr > 1.03) continue;
      const z = Math.sqrt(Math.max(0, 1 - rr));
      const x1 = x * cr + y * sr, y1 = -x * sr + y * cr, Y = y1 * cp + z * sp, Z = -y1 * sp + z * cp;
      PX[n] = (py * N + px) * 4; NX[n] = x; NY[n] = y; NZ[n] = z;
      LON[n] = ((Math.atan2(x1, Z) / TAU + 1) * 65536) & 65535;
      LAT[n] = clamp((0.5 - Math.asin(clamp(Y, -1, 1)) / Math.PI) * 65536, 0, 65535);
      RIM[n] = Math.pow(1 - z, 2.7) * 255;
      LB[n] = 0.58 + 0.42 * Math.sqrt(z);
      AA[n] = clamp((1 - Math.sqrt(rr)) * RR + 0.5, 0, 1) * 255;
      n++;
    }
    T = { N, n, PX, NX, NY, NZ, LON, LAT, RIM, LB, AA };
    tableCache.set(key, T);
    return T;
  }
  const poolGlobe = new Map();
  function globeCanvas(N) {
    let g = poolGlobe.get(N);
    if (g) return g;
    const c = mk(N, N), x = c.getContext('2d'), img = x.createImageData(N, N);
    g = { c, x, img, d: img.data };
    poolGlobe.set(N, g);
    return g;
  }
  // 표면을 부드럽게 늘린 표. 물 마스크와 도시 불빛, 작은 굴곡까지 여기서 준비합니다
  function prepTex(s, tw, th, old) {
    const same = old && old.tw === tw && old.th === th;
    const rgb = same ? old.rgb : new Uint8Array(tw * th * 3), water = same ? old.water : new Uint8Array(tw * th);
    const li = s.lights || null, lights = li ? (same && old.lights ? old.lights : new Uint8Array(tw * th)) : null;
    const sw = s.w, sh = s.h, src = s.rgba, det = NT.ready ? NT.data : null, nw = NT.w, nh = NT.h, coarse = sw < 300;
    // 불빛 번짐: 작은 격자로 줄여 두고 부드럽게 읽습니다
    let bl = null;
    const bw = 64, bh = 32;
    if (li) {
      bl = new Float32Array(bw * bh);
      for (let y = 0; y < sh; y++) { const by = ((y / sh) * bh) | 0; for (let x = 0; x < sw; x++) bl[by * bw + (((x / sw) * bw) | 0)] += li[y * sw + x]; }
      const area = (sw * sh) / (bw * bh);
      for (let i = 0; i < bl.length; i++) bl[i] /= area;
    }
    for (let y = 0; y < th; y++) {
      const fv = ((y + 0.5) / th) * sh - 0.5, y0f = Math.floor(fv), fy = fv - y0f, y0 = y0f < 0 ? 0 : y0f, y1 = y0f + 1 >= sh ? sh - 1 : y0f + 1;
      const dy = Math.floor((y / th) * nh) * nw;
      const gv = ((y + 0.5) / th) * bh - 0.5, g0f = Math.floor(gv), gy = gv - g0f, g0 = g0f < 0 ? 0 : g0f, g1 = g0f + 1 >= bh ? bh - 1 : g0f + 1;
      for (let x = 0; x < tw; x++) {
        const fu = ((x + 0.5) / tw) * sw - 0.5, x0f = Math.floor(fu), fx = fu - x0f, x0 = (x0f + sw) % sw, x1 = (x0f + 1) % sw;
        const a = (y0 * sw + x0) * 4, b = (y0 * sw + x1) * 4, c = (y1 * sw + x0) * 4, e = (y1 * sw + x1) * 4;
        const w0 = (1 - fx) * (1 - fy), w1 = fx * (1 - fy), w2 = (1 - fx) * fy, w3 = fx * fy;
        let r = src[a] * w0 + src[b] * w1 + src[c] * w2 + src[e] * w3;
        let g = src[a + 1] * w0 + src[b + 1] * w1 + src[c + 1] * w2 + src[e + 1] * w3;
        let bb = src[a + 2] * w0 + src[b + 2] * w1 + src[c + 2] * w2 + src[e + 2] * w3;
        const ti = y * tw + x, isW = bb > r * 1.1 && bb > g * 0.9;
        water[ti] = isW ? 255 : 0;
        const dn = det ? det[dy + (((x / tw) * nw + nw / 3) % nw | 0)] : 128;
        if (det) { const k = 1 + ((dn - 128) / 128) * (isW ? 0.06 : 0.26); r *= k; g *= k; bb *= k; }
        rgb[ti * 3] = r > 255 ? 255 : r; rgb[ti * 3 + 1] = g > 255 ? 255 : g; rgb[ti * 3 + 2] = bb > 255 ? 255 : bb;
        if (lights) {
          let l = li[a >> 2] * w0 + li[b >> 2] * w1 + li[c >> 2] * w2 + li[e >> 2] * w3;
          if (coarse && l > 0.02) l *= (hashN(ti) < 0.3 + l * 0.5 ? 1 : 0.1) * (0.35 + clamp((dn - 96) / 60, 0, 1));
          else if (l > 0.02) l *= l * (0.22 + 0.78 * hashN(ti));
          const gu = ((x + 0.5) / tw) * bw - 0.5, h0f = Math.floor(gu), gx = gu - h0f, h0 = (h0f + bw) % bw, h1 = (h0f + 1) % bw;
          const gl = (bl[g0 * bw + h0] * (1 - gx) + bl[g0 * bw + h1] * gx) * (1 - gy) + (bl[g1 * bw + h0] * (1 - gx) + bl[g1 * bw + h1] * gx) * gy;
          lights[ti] = clamp(l * 215 + gl * (coarse ? 110 : 34), 0, 255);
        }
      }
    }
    return { tw, th, rgb, water, lights, noised: !!det };
  }
  function fallbackTex(look, id) {
    const k = 'tex|' + look + '|' + id;
    let t = spriteCache.get(k);
    if (t) return t;
    const def = LOOKS[look] || LOOKS.rocky, w = 256, h = 128, seed = GENERIC[look] ? hashStr(id) % 8 + 3 : (hashStr(look) % 97) + 5;
    const N = new WS.Noise(seed), o = [0, 0, 0], rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const la = (0.5 - (y + 0.5) / h) * Math.PI, sl = Math.sin(la), cl = Math.cos(la);
      for (let x = 0; x < w; x++) {
        const lo = ((x + 0.5) / w - 0.5) * TAU, i = (y * w + x) * 4;
        def.fn(N, cl * Math.sin(lo), sl, cl * Math.cos(lo), o, seed);
        rgba[i] = o[0]; rgba[i + 1] = o[1]; rgba[i + 2] = o[2]; rgba[i + 3] = 255;
      }
    }
    t = { w, h, rgba, lights: null, ver: 0 };
    spriteCache.set(k, t);
    return t;
  }
  const I16 = 1 / 65536;
  function shadeGlobe(T, g, P) {
    const n = T.n, PX = T.PX, NX = T.NX, NY = T.NY, NZ = T.NZ, LON = T.LON, LAT = T.LAT, RIM = T.RIM, LB = T.LB, AA = T.AA, d = g.d;
    const tex = P.tex, rgb = tex.rgb, wat = tex.water, tw = tex.tw, th = tex.th, twm = tw - 1, lig = P.lightsOn ? tex.lights : null, bil = T.N >= 128;
    const off = P.off, Lx = P.L[0], Ly = P.L[1], Lz = P.L[2];
    let Hx = Lx, Hy = Ly, Hz = Lz + 1;
    const hl = Math.hypot(Hx, Hy, Hz); Hx /= hl; Hy /= hl; Hz /= hl;
    const cl = P.cloud > 0.01 && NT.ready ? NT.data : null, cw = NT.w, ch = NT.h, cwm = cw - 1, coff = P.coff, cK = P.cloud;
    const ar = P.atm[0], ag = P.atm[1], ab = P.atm[2], rimA = P.rimA, rimB = P.rimBoost || 0, cR = P.steam ? 132 : 240, cG = P.steam ? 112 : 243, cB = P.steam ? 98 : 248;
    const dust = P.dust * 0.84, lk = T.N < 96 ? 0.55 : 1;
    const St = P.stain, Sx = St ? St.S[0] : 0, Sy = St ? St.S[1] : 0, Sz = St ? St.S[2] : 0, cs = St ? St.cs : 2, stA = St ? St.a : 0, hc = St ? St.hc : 2, hotA = St ? St.hot : 0, nn0 = St ? 1 / (1 - cs) : 0;
    const fc = St && St.fa ? St.fc : 2, fi = St && St.fa ? St.fi : 0, fa = St && St.fa ? St.fa : 0, kc = St && St.ka ? St.kc : 2, ki = St && St.ka ? St.ki : 0, ka = St && St.ka ? St.ka : 0;
    const LUT = CLOUD_LUT;
    for (let i = 0; i < n; i++) {
      const nx = NX[i], ny = NY[i], nz = NZ[i];
      const ll = nx * Lx + ny * Ly + nz * Lz, li = ((ll + 1) * 127.5) | 0;
      const v = LAT[i], lon = LON[i], u = (lon + off) & 65535;
      const uf = u * tw, vf = v * th, c0 = uf >>> 16, r0 = vf >>> 16, ti = r0 * tw + c0, t3 = ti * 3;
      let r, gg, b, ca = 0, nn = 128;
      if (bil) {
        const fx = (uf & 65535) * I16, fy = (vf & 65535) * I16, c1 = (c0 + 1) & twm, r1 = r0 + 1 < th ? r0 + 1 : r0;
        const e = (r0 * tw + c1) * 3, f = (r1 * tw + c0) * 3, h = (r1 * tw + c1) * 3, w0 = (1 - fx) * (1 - fy), w1 = fx * (1 - fy), w2 = (1 - fx) * fy, w3 = fx * fy;
        r = rgb[t3] * w0 + rgb[e] * w1 + rgb[f] * w2 + rgb[h] * w3;
        gg = rgb[t3 + 1] * w0 + rgb[e + 1] * w1 + rgb[f + 1] * w2 + rgb[h + 1] * w3;
        b = rgb[t3 + 2] * w0 + rgb[e + 2] * w1 + rgb[f + 2] * w2 + rgb[h + 2] * w3;
      } else { r = rgb[t3]; gg = rgb[t3 + 1]; b = rgb[t3 + 2]; }
      if (cl) {
        const cuf = ((lon + coff) & 65535) * cw, cvf = v * ch, cc = cuf >>> 16, cr = cvf >>> 16, ci = cr * cw + cc;
        let cv = cl[ci];
        if (bil) {
          const gx = (cuf & 65535) * I16, gy = (cvf & 65535) * I16, cc1 = (cc + 1) & cwm, cr1 = cr + 1 < ch ? cr + 1 : cr;
          cv = (cv * (1 - gx) + cl[cr * cw + cc1] * gx) * (1 - gy) + (cl[cr1 * cw + cc] * (1 - gx) + cl[cr1 * cw + cc1] * gx) * gy;
        }
        ca = LUT[cv | 0] * cK;
        r += (cR - r) * ca; gg += (cG - gg) * ca; b += (cB - b) * ca;
        if (St) nn = cl[cr * cw + ((u * cw) >>> 16)];
      }
      const D = DAY[li];
      let sd = -1;
      if (St) {
        sd = nx * Sx + ny * Sy + nz * Sz;
        if (sd > cs) {
          const b0 = (sd - cs) * nn0;
          let q = b0 * 1.45 + (nn - 128) * 0.012 * (b0 < 0.16 ? b0 * 6.25 : 1);
          q = q < 0 ? 0 : q > 1 ? 1 : q;
          const a = stA * q * q * (3 - 2 * q);
          r += (40 - r) * a; gg += (31 - gg) * a; b += (26 - b) * a;
        }
      }
      const Dn = 1 - D;
      r = r * D + Dn * (2 + r * 0.05); gg = gg * D + Dn * (3.5 + gg * 0.05); b = b * D + Dn * (8 + b * 0.06);
      if (wat[ti]) {
        const h = nx * Hx + ny * Hy + nz * Hz;
        if (h > 0.962) { const s = (h - 0.962) * 26.3, s2 = s * s * s, sa = s2 * (1 - ca) * (1 - dust) * 120; r += sa; gg += sa * 0.95; b += sa * 0.82; }
      }
      const W = WARM[li];
      if (W > 0.02) { r += W * 6; gg += W * 1.6; b -= W * 2.5; }
      const lb = LB[i];
      r *= lb; gg *= lb; b *= lb;
      if (dust > 0) { const hz = 0.14 + D * 0.86; r += (146 * hz - r) * dust; gg += (126 * hz - gg) * dust; b += (106 * hz - b) * dust; }
      if (lig) {
        const nd = NIGHT[li];
        if (nd > 0) {
          let l = lig[ti];
          if (bil) { const fx = (uf & 65535) * I16, fy = (vf & 65535) * I16, c1 = (c0 + 1) & twm, r1 = r0 + 1 < th ? r0 + 1 : r0; l = (l * (1 - fx) + lig[r0 * tw + c1] * fx) * (1 - fy) + (lig[r1 * tw + c0] * (1 - fx) + lig[r1 * tw + c1] * fx) * fy; }
          if (l > 0.5) { const nk = nd * l * (1 - ca * 0.85) * (1 - dust) * lk; r += nk; gg += nk * 0.76; b += nk * 0.46; }
        }
      }
      if (St) {
        if (sd > hc) { const h0 = (sd - hc) / (1 - hc); let a = h0 * 1.15 + (nn - 128) * 0.009 * (h0 < 0.14 ? h0 * 7 : 1); if (a > 0) { a = a > 1 ? 1 : a; a = a * a * (3 - 2 * a) * hotA * (0.6 + (nn - 128) * 0.0085); if (a > 0) { r += a * 300; gg += a * 136; b += a * 34; } } }
        if (fa > 0) {
          const dd = (sd - fc) * fi;
          if (dd > -1 && dd < 1) { const m = 1 - dd * dd, k = m * m * fa * (0.25 + (nn - 96) * 0.0125) * (1 - ca * 0.75); if (k > 0) { r += k * 255; gg += k * 112; b += k * 22; } }
        }
        if (ka > 0) {
          const dd = (sd - kc) * ki;
          if (dd > -1 && dd < 1) { const m = 1 - dd * dd, k = m * m * ka; r += k * 150; gg += k * 190; b += k * 235; }
        }
      }
      const rim = RIM[i];
      if (rim > 2) {
        const a = (rim / 255) * (rimA * (0.1 + 0.9 * D) + rimB);
        const k = a > 1 ? 1 : a, ah = 0.25 + D * 0.85;
        r += (ar * ah - r) * k; gg += (ag * ah - gg) * k; b += (ab * ah - b) * k;
      }
      const p = PX[i];
      d[p] = r; d[p + 1] = gg; d[p + 2] = b; d[p + 3] = AA[i];
    }
    g.x.putImageData(g.img, 0, 0);
  }
  const NCLASS = [32, 48, 64, 96, 128, 160, 192, 224, 256];
  function classN(px, cap) { for (let i = 0; i < NCLASS.length; i++) if (NCLASS[i] >= px || NCLASS[i] >= cap) return NCLASS[i]; return 256; }
  function drawGlobeAt(ctx, x, y, R, dpr, P, cap, roll, pitch) {
    const N = classN(Math.ceil(2 * R * dpr), cap), T = globeTable(N, roll, pitch), g = globeCanvas(N);
    shadeGlobe(T, g, P);
    const k = (N / 2) / (N / 2 - 1);
    ctx.drawImage(g.c, x - R * k, y - R * k, 2 * R * k, 2 * R * k);
  }
  function viewOf(lo, la, ell, roll, pitch, o) {
    const cl = Math.cos(la), qx = cl * Math.sin(lo - ell), qy = Math.sin(la), qz = cl * Math.cos(lo - ell);
    const cp = Math.cos(pitch), sp = Math.sin(pitch), y = qy * cp - qz * sp, z = qy * sp + qz * cp;
    const cr = Math.cos(roll), sr = Math.sin(roll);
    o[0] = qx * cr - y * sr; o[1] = qx * sr + y * cr; o[2] = z;
    return o;
  }

  /* ---------- 상태 ---------- */
  const states = new WeakMap();
  const seqOf = (sim, mode) => { try { return (mode.space.impactSeq(sim) | 0); } catch (e) { return 0; } };
  function ensure(sim, mode) {
    let st = states.get(sim);
    if (st) return st;
    st = {
      t: 0, orbit: 0, orate: 1, lastT: null, dt: 0, seq: seqOf(sim, mode), god: sim.godActs | 0,
      pending: [], cine: null, cool: 0, want: false, lay: null, newest: null, known: null, flights: [], pulses: [],
      hover: null, hoverT: -9, labelPos: Object.create(null), labelOff: Object.create(null), placed: [],
      surf: { tex: null, ver: null, src: null, at: -99, hi: false }, scar: null, cam: { z: 1, ox: 0, oy: 0, hx: 0, hy: 0, e: 0, zv: 0, prevZn: 0 },
      dustV: 0, dustT: -9, ring: {}, order: [], btnReplay: null, btnSkip: null, rows: [], insetBox: null, sunHit: null,
    };
    states.set(sim, st);
    return st;
  }

  /* ---------- 배치 ---------- */
  const WIDE_W = 860;
  const fontUp = (W) => (W >= 1400 ? 1.5 : 0); // 이보다 넓으면 해설 카드와 탭이 위쪽 양 구석만 덮습니다
  function buildLayout(st, scene, W, H, top, bottom) {
    const list = scene.bodies || [], byId = Object.create(null), bodies = [];
    let amax = 0, amin = 1e9, home = null, aHome = 1;
    for (const b of list) { if (!b.parent && b.a > amax) amax = b.a; if (!b.parent && b.a < amin) amin = b.a; if (b.home && !b.parent) aHome = b.a; }
    if (!amax) amax = 1;
    const narrow = W < 520, wide = W >= WIDE_W, availH = Math.max(120, H - top - bottom - (narrow ? NARROW_BAND : 0));
    const sinT = clamp((availH / 2 - 14) / Math.max(40, W / 2 - 16), 0.47, narrow ? 0.74 : 0.57);
    const rN = Math.max(60, Math.min(W / 2 - (narrow ? 12 : 26), (availH / 2 - 14) / sinT));
    // 안쪽 행성에 자리를 더 주는 눈금: 가장 안쪽이 반지름의 21%, 가장 바깥이 100%
    const c = 150 / amax, l0 = Math.log(1 + amin * c), lmax = Math.log(1 + amax * c), ls = lmax - l0;
    const rAt = (a) => (ls < 1e-6 ? rN * 0.5 : rN * (0.21 + (0.79 * (Math.log(1 + a * c) - l0)) / ls));
    const baseR = clamp(rN * 0.034, 7, 26), rSun = clamp(rN * 0.034, 7, 28);
    // 처음 자리: 황금각으로 흩어 놓고, 고향 행성이 오른쪽 앞에 오게 합니다
    const seq = list.filter((b) => !b.parent).sort((p, q) => p.a - q.a), i0 = Math.max(0, seq.findIndex((b) => b.home));
    const ph0 = new Map();
    seq.forEach((b, i) => ph0.set(b.id, 1.35 + (i - i0) * 2.39996));
    for (const b of list) {
      const o = { id: b.id, name: b.name, a: b.a, look: b.look, size: b.size || 0.5, parentId: b.parent || null, p: null, home: !!b.home, rings: !!b.rings, phase: b.phase, x: 0, y: 0, z: 0, th: 0, r: 0, R: 0, w: 0, ph: 0, d: 0, sx: 0, sy: 0, sR: 0, set: null, moon: !!b.parent };
      o.R = Math.max(o.moon ? 1.3 : 1.8, baseR * o.size);
      const h = hashStr(b.id);
      o.ph = b.phase != null ? b.phase * TAU : ph0.has(b.id) ? ph0.get(b.id) : hashN(h) * TAU;
      byId[b.id] = o; bodies.push(o);
      if (b.home) home = o;
    }
    for (const o of bodies) {
      if (o.moon) {
        o.p = byId[o.parentId] || null;
        const pR = o.p ? o.p.R : baseR;
        o.d = pR * (1.3 + o.a * 2.3) + (o.p && o.p.rings ? pR * 0.9 : 0);
        o.w = TAU / (5 + o.a * 8);
      } else {
        o.r = Math.max(rSun * 1.7 + o.R, rAt(o.a));
        o.w = (TAU / 60) * Math.pow(aHome / o.a, 0.75);
      }
    }
    const belt = [];
    if (scene.belt) {
      const a0 = scene.belt.a0, a1 = scene.belt.a1;
      for (let i = 0; i < 320; i++) {
        const a = lerp(a0, a1, hashN(i * 3 + 1)), m = hashN(i * 3 + 2);
        belt.push({ r: rAt(a), th: hashN(i * 3 + 3) * TAU, w: (TAU / 60) * Math.pow(aHome / a, 0.75), lum: m * m, hz: (hashN(i * 7) - 0.5) * 7 });
      }
    }
    // 가까이 본 지구: 넓은 화면에서는 위아래 안내에 걸리지 않는 선에서 크게
    const capH = narrow ? 46 : 52, regT = wide ? 56 : top + 2, regB = H - (wide ? 40 : bottom) - capH, availG = Math.max(120, regB - regT);
    const Rc = Math.min(0.31 * Math.min(W, H) * (narrow ? 1.1 : 1), 0.5 * availG - 6);
    return { key: scene.key, W, H, sT: top, sB: bottom, top, bottom, narrow, wide, availH, cx: W / 2, cy: top + availH / 2 + (narrow ? 0 : 6), sinT, rN, baseR, rSun, bodies, byId, home, belt, c, lmax, Rc, ccx: W / 2, ccy: regT + availG / 2, skySeed: hashStr(scene.key) % 100000 + 7, n: list.length };
  }
  function placeBodies(st, lay) {
    const T = st.orbit, sT = lay.sinT, B = lay.bodies;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (b.moon) continue;
      const th = b.ph + b.w * T, c = Math.cos(th), s = Math.sin(th);
      b.th = th; b.x = b.r * c; b.y = b.r * s * sT; b.z = b.r * s;
    }
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (!b.moon) continue;
      const th = b.ph + b.w * T, c = Math.cos(th), s = Math.sin(th), p = b.p;
      b.th = th;
      b.x = (p ? p.x : 0) + b.d * c; b.y = (p ? p.y : 0) + b.d * s * sT; b.z = (p ? p.z : 0) + b.d * s;
    }
  }

  /* ---------- 충돌 장면 ---------- */
  const reducedMotion = () => { try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } };
  function startCine(st, imp, lay, t0, viaInset) {
    if (!lay.home) return;
    const hb = lay.home, h = hashStr(imp.n + ':' + imp.lo + ':' + imp.la + ':' + imp.D), rnd = (k) => hashN(h + k * 97);
    const D = imp.D == null ? 30 : imp.D, pow = clamp((Math.log10(Math.max(D, 0.1)) + 0.3) / 2.6, 0.12, 1);
    const reduced = reducedMotion();
    st.lastD = D;
    st.maxD = Math.max(st.maxD || 0, D);
    // 바깥쪽에서 비스듬히 들어와 원판에서 그쪽으로 치우친 곳을 맞힙니다
    const out = Math.atan2(hb.y || 1e-3, hb.x || 1e-3), sgn = rnd(1) < 0.5 ? -1 : 1, phiT = out + sgn * lerp(0.6, 1.4, rnd(2));
    const roll = -0.34, off = 0.52, tx = off * Math.cos(phiT), ty = -off * Math.sin(phiT), tz = Math.sqrt(1 - off * off);
    const cr = Math.cos(roll), sr = Math.sin(roll), tx1 = tx * cr + ty * sr, ty1 = -tx * sr + ty * cr;
    const lo = (imp.lo == null ? rnd(3) * 360 - 180 : imp.lo) * DEG, la = clamp(imp.la == null ? (rnd(4) - 0.5) * 120 : imp.la, -88, 88) * DEG;
    const cl = Math.cos(la), sl = Math.sin(la), dl = Math.asin(clamp(tx1 / Math.max(cl, 0.05), -1, 1));
    const pitch = clamp(Math.atan2(sl, cl * Math.cos(dl)) - Math.atan2(ty1, tz), -1.05, 1.05), ell = lo - dl;
    const S = viewOf(lo, la, ell, roll, pitch, [0, 0, 0]);
    const sx = S[0], sy = -S[1], phi1 = Math.atan2(sy, sx), phi0 = phi1 - sgn * 0.3;
    // 해왕성 궤도 바깥 타원과 만나는 시작점
    const a = lay.rN * 1.16, b = a * lay.sinT, dx = Math.cos(phi0), dy = Math.sin(phi0);
    const A = (dx * dx) / (a * a) + (dy * dy) / (b * b), Bq = 2 * ((hb.x * dx) / (a * a) + (hb.y * dy) / (b * b)), Cq = (hb.x * hb.x) / (a * a) + (hb.y * hb.y) / (b * b) - 1;
    const s0 = (-Bq + Math.sqrt(Math.max(0, Bq * Bq - 4 * A * Cq))) / (2 * A);
    const g0 = s0 / lay.Rc, g1 = Math.min(g0 * 0.5, 0.8), g2 = Math.min(1.5, Math.max(1.2, 0.5 * Math.min(lay.W, lay.H) / lay.Rc * 0.92));
    // 분출물
    const nE = Math.round(70 + 150 * pow), ej = new Float32Array(nE * 5);
    for (let i = 0; i < nE; i++) {
      const u = hashN(h + i * 11 + 1), v = hashN(h + i * 11 + 2), w = hashN(h + i * 11 + 3), q = hashN(h + i * 11 + 4);
      ej[i * 5] = u * TAU; ej[i * 5 + 1] = (0.16 + 1.25 * v * v) * (0.55 + 0.75 * pow); ej[i * 5 + 2] = (0.18 + 0.95 * w) * (0.55 + 0.65 * pow); ej[i * 5 + 3] = q; ej[i * 5 + 4] = hashN(h + i * 11 + 5);
    }
    const nP = 16, puffs = new Float32Array(nP * 4);
    for (let i = 0; i < nP; i++) { puffs[i * 4] = hashN(h + i * 17 + 7) * TAU; puffs[i * 4 + 1] = hashN(h + i * 17 + 8); puffs[i * 4 + 2] = hashN(h + i * 17 + 9); puffs[i * 4 + 3] = 0.05 + i * 0.075; }
    st.cine = {
      imp, D, pow, h, lo, la, roll, pitch, ell, spin: 0.09, sx, sy, phi0, phi1, g0, g1, g2, zc: lay.Rc / hb.R, reduced, moonX: Math.cos(phi1) > 0 ? -1 : 1,
      t: reduced ? Math.max(t0, 3.2) : t0, t0: reduced ? 3.2 : t0, viaInset: !!viaInset, ej, nE, puffs, nP, S: [0, 0, 1], U: [1, 0, 0], V: [0, 1, 0], ellNow: ell, ti: -1, rotH: rnd(5) * TAU,
    };
    st.cam.prevZn = 0;
  }
  function endCine(st) {
    const c = st.cine;
    if (c) st.scar = { lo: c.lo, la: c.la, pow: c.pow, at: st.t };
    st.cine = null;
    st.cool = st.t + 4;
  }
  function closeE(c, t) {
    if (c.reduced) return t < T_END - 0.32 ? 1 : 0;
    return t < T_PULL ? ease5((t - 1.35) / 1.45) : 1 - ease5((t - T_PULL) / (T_END - T_PULL));
  }
  function strikeG(c, t) {
    if (t < 1.6) return c.g1 + (c.g0 - c.g1) * Math.pow(1 - t / 1.6, 1.7);
    if (t < 2.8) return lerp(c.g1, c.g2, sst(1.6, 2.8, t));
    return c.g2 * (1 - Math.pow(clamp((t - 2.8) / (T_HIT - 2.8), 0, 1), 2.1));
  }
  function strikeQ(c, t, o) {
    const g = strikeG(c, t), f = 1 - sst(0, 2.6, t), phi = c.phi1 + (c.phi0 - c.phi1) * f * f, w = sst(2.75, T_HIT, t);
    o[0] = Math.cos(phi) * g + c.sx * w; o[1] = Math.sin(phi) * g + c.sy * w;
    return o;
  }
  function strikeFrame(c, t) {
    const ell = c.ell + c.spin * (T_HIT - t);
    c.ellNow = ell; c.ti = t - T_HIT;
    const S = viewOf(c.lo, c.la, ell, c.roll, c.pitch, c.S);
    let ux = S[1], uy = -S[0];
    const l = Math.hypot(ux, uy);
    if (l < 1e-3) { ux = 1; uy = 0; } else { ux /= l; uy /= l; }
    const U = c.U, V = c.V;
    U[0] = ux; U[1] = uy; U[2] = 0;
    V[0] = -S[2] * uy; V[1] = S[2] * ux; V[2] = S[0] * uy - S[1] * ux;
  }
  function stainOf(c) {
    if (c.ti < 0) return null;
    const ti = c.ti, pow = c.pow, as = lerp(0.2, 1.3, pow) * Math.pow(sst(0.05, 2.9, ti), 0.72) + 0.02;
    const af = lerp(0.2, 1.25, pow) * (1 - Math.exp(-ti * 1.15)) + 0.01, fw = 0.05 + 0.1 * pow;
    const ak = lerp(0.42, 2.0, pow) * (1 - Math.exp(-ti * 1.25)) + 0.01, kw = 0.1 + 0.08 * pow;
    return {
      S: c.S, cs: Math.cos(as), a: Math.min(0.94, 0.62 + 0.4 * pow), hc: Math.cos(lerp(0.09, 0.36, pow) * (1 + ti * 0.45)), hot: Math.exp(-ti * 1.05),
      fc: Math.cos(af), fi: 1 / (fw * Math.max(0.12, Math.sin(af))), fa: Math.exp(-ti * 1.05) * (0.6 + 0.5 * pow),
      kc: Math.cos(ak), ki: 1 / (kw * Math.max(0.12, Math.sin(ak))), ka: Math.exp(-ti * 2.5) * (0.22 + 0.36 * pow),
    };
  }
  // 얼룩 자리: 장면이 끝나고도 작은 지구본에 잠시 남습니다
  function scarOf(st, ell, roll, pitch) {
    const sc = st.scar;
    if (!sc) return null;
    const age = st.t - sc.at, f = 1 - sst(4, 20, age);
    if (f <= 0) { st.scar = null; return null; }
    const S = viewOf(sc.lo, sc.la, ell, roll, pitch, [0, 0, 0]);
    return { S, cs: Math.cos(lerp(0.2, 1.3, sc.pow)), a: Math.min(0.94, 0.62 + 0.4 * sc.pow) * f, hc: 2, hot: 0 };
  }
  function pollImpacts(st, sim, mode, scene) {
    const sp = mode.space, seq = seqOf(sim, mode), god = sim.godActs | 0;
    if (seq > st.seq || (scene && scene.impacts && scene.impacts.length && !st.newest)) {
      if (!scene) { try { scene = sp.scene(sim); } catch (e) { scene = null; } }
      const list = (scene && scene.impacts) || [];
      const godNow = god !== st.god;
      for (const imp of list) if (imp.n > st.seq) st.pending.push({ imp, at: st.t, user: imp.user == null ? godNow : !!imp.user });
      if (seq > st.seq) st.seq = seq;
      if (st.pending.length > 3) {
        const sized = (p) => (p.user ? 1e9 : p.imp.D == null ? 30 : p.imp.D);
        st.pending.sort((a, b) => sized(b) - sized(a));
        st.pending.length = 3;
        st.pending.sort((a, b) => a.imp.n - b.imp.n);
      }
    }
    st.god = god;
    if (scene && scene.impacts && scene.impacts.length) st.newest = scene.impacts[scene.impacts.length - 1];
    return scene;
  }
  const strikeD = (imp) => (imp.D == null ? 30 : imp.D);
  // 다음에 보여 줄 충돌의 번호. 관찰자가 떨어뜨린 것이 먼저이고, 자연 충돌은 막 일어난 것 가운데 가장 큰 것입니다. 늦어진 자연 충돌은 여기서 버립니다
  function nextStrike(st, scene) {
    const clock = scene && scene.clock, lim = scene && scene.staleAfter;
    let k = 0, user = -1, big = -1, bd = -1;
    for (let i = 0; i < st.pending.length; i++) {
      const p = st.pending[i];
      if (!p.user && (st.t - p.at > FRESH_VIEW || (lim && p.imp.t != null && clock - p.imp.t > lim))) continue;
      st.pending[k] = p;
      if (p.user) { if (user < 0) user = k; } else if (strikeD(p.imp) >= bd) { bd = strikeD(p.imp); big = k; }
      k++;
    }
    st.pending.length = k;
    return user >= 0 ? user : big;
  }
  function tick(st, time, app, lay, inSolar, scene, sim) {
    let dt = st.lastT == null ? 0 : time - st.lastT;
    st.lastT = time;
    dt = clamp(dt, 0, 0.1);
    st.dt = dt; st.t += dt;
    noiseStep(1.6);
    const paused = !!(app && app.paused);
    st.orate = paused ? 0 : st.orate + ((st.cine ? 0.1 : 1) - st.orate) * Math.min(1, dt * 3);
    st.orbit += dt * st.orate;
    if (st.want && st.newest && lay) {
      st.want = false;
      st.pending = st.pending.filter((p) => p.user);
      startCine(st, st.newest, lay, inSolar ? 0 : T_INSET, !inSolar);
      if (st.cine) st.cine.replay = true;
    }
    if (st.cine) {
      st.cine.t += dt;
      if (st.cine.t >= T_END) endCine(st);
    }
    // 세계가 끝나면 자연 충돌 장면은 끝 카드 뒤에 남지 않게 물러납니다. 다시 보기로 볼 수 있습니다
    if (sim && sim.ended && scene && scene.staleAfter) {
      const c0 = st.cine;
      if (c0 && !c0.user && !c0.replay) {
        if (c0.t > 1.3 && inSolar) st.dip = st.t;
        endCine(st);
      }
      if (st.pending.length) st.pending = st.pending.filter((p) => p.user);
    }
    if (st.pending.length && lay) {
      const i = nextStrike(st, scene), p = i >= 0 ? st.pending[i] : null;
      if (p) {
        const c = st.cine, d = strikeD(p.imp);
        // 빈 때: 관찰자의 운석은 바로, 자연 충돌은 쉬는 시간이 지나야 (앞 장면보다 훨씬 크면 바로)
        // 재생 중: 자연 충돌 장면은 관찰자의 운석이나 훨씬 큰 충돌에 자리를 내줍니다. 관찰자의 운석 장면은 끊지 않습니다
        // 지금까지 본 것 중 가장 큰 기록을 새로 쓴 충돌은 놓치지 않습니다. 다만 앞 장면이 다가가는 중이면 충돌 섬광까지는 보여 주고 넘어갑니다
        const record = d >= (st.maxD || 0) * RECORD_RATIO;
        const go = !c ? p.user || st.t >= st.cool || record || d >= (st.lastD || 0) * BIG_RATIO : !c.user && (p.user || (!c.replay && (d >= c.D * BIG_RATIO || (record && (c.t < 1.35 || c.t >= T_HIT + 0.9)))));
        if (go) {
          if (c) { if (c.t > 1.3 && inSolar) st.dip = st.t; endCine(st); }
          st.pending.splice(i, 1);
          if (!p.user) st.pending = st.pending.filter((q) => q.user);
          startCine(st, p.imp, lay, inSolar ? 0 : T_INSET, !inSolar);
          if (st.cine) {
            st.cine.user = p.user;
            if (c && !inSolar) st.cine.t0 -= 0.3; // 작은 창은 이미 떠 있으므로 다시 나타나는 효과 없이
          }
        }
      }
    }
    // 지도에서 시작하자마자 태양계로 넘어왔다면 처음부터 보여 줍니다
    if (inSolar && st.cine && st.cine.viaInset) {
      if (st.cine.t - st.cine.t0 < 0.45 && !st.cine.reduced) { st.cine.t = 0; st.cine.t0 = 0; }
      st.cine.viaInset = false;
    }
  }
  function camera(st, lay) {
    const cam = st.cam, c = st.cine;
    cam.z = 1; cam.ox = lay.cx; cam.oy = lay.cy; cam.e = 0; cam.zv = 0; cam.shakeX = 0; cam.shakeY = 0;
    if (!c || !lay.home) { cam.prevZn = 0; return cam; }
    const hb = lay.home, zc = (c.zc = lay.Rc / hb.R); // 도중에 크기가 바뀌어도 맞게
    const t = c.t, e = closeE(c, t);
    let z = Math.exp(e * Math.log(zc));
    const push = 1 + 0.03 * sst(2.6, T_PULL, t) * e;
    z *= push;
    const ti = t - T_HIT;
    if (ti > 0 && !c.reduced) z *= 1 + 0.07 * c.pow * Math.exp(-ti * 4.5) * e;
    const hx = lerp(lay.cx + hb.x, lay.ccx, e), hy = lerp(lay.cy + hb.y, lay.ccy, e);
    let sx = 0, sy = 0;
    if (ti > 0 && !c.reduced) {
      const amp = (1.5 + 10 * c.pow) * Math.exp(-ti * 3.1) * e;
      sx = amp * (Math.sin(ti * 67) + Math.sin(ti * 41 + 1)) * 0.5;
      sy = amp * (Math.cos(ti * 59) + Math.sin(ti * 37 + 2)) * 0.5;
    }
    cam.z = z; cam.e = e; cam.hx = hx + sx; cam.hy = hy + sy; cam.shakeX = sx; cam.shakeY = sy;
    cam.ox = hx + sx - hb.x * z; cam.oy = hy + sy - hb.y * z;
    const zn = Math.log(Math.max(z, 1)) / Math.log(Math.max(zc, 1.01));
    cam.zv = Math.abs(zn - cam.prevZn);
    cam.prevZn = zn;
    return cam;
  }
  function zAt(c, t) { return Math.exp(closeE(c, t) * Math.log(c.zc)); }

  // 꼬리: 지나온 자리를 그때의 배율로 되돌려 현재 카메라로 다시 찍고, 가늘어지는 다각형 세 겹으로 칠합니다
  const TR_N = 42, TR_X = new Float32Array(TR_N + 2), TR_Y = new Float32Array(TR_N + 2), TR_L = new Float32Array(TR_N + 2), TR_NX = new Float32Array(TR_N + 2), TR_NY = new Float32Array(TR_N + 2), TR_W = new Float32Array(TR_N + 2), qTmp = [0, 0];
  function trailLayer(ctx, m, total, w0, pw, nose) {
    let last = m;
    ctx.beginPath();
    for (let i = 0; i <= m; i++) {
      const f = 1 - TR_L[i] / total;
      if (f <= 0) { last = i; TR_W[i] = 0; ctx.lineTo(TR_X[i], TR_Y[i]); break; }
      const q = TR_L[i] / nose, w = w0 * Math.pow(f, pw) * (q < 1 ? Math.sqrt(q) : 1);
      TR_W[i] = w;
      if (i) ctx.lineTo(TR_X[i] + TR_NX[i] * w, TR_Y[i] + TR_NY[i] * w); else ctx.moveTo(TR_X[i], TR_Y[i]);
    }
    for (let i = last; i >= 1; i--) ctx.lineTo(TR_X[i] - TR_NX[i] * TR_W[i], TR_Y[i] - TR_NY[i] * TR_W[i]);
    ctx.closePath();
    ctx.fill();
  }
  function drawTrail(ctx, hx, hy, Rc, c, t, rH, zNow, useZoom, maxLen, dpr) {
    let m = 0, dt = 0.012, span = 0;
    strikeQ(c, t, qTmp);
    TR_X[0] = hx + qTmp[0] * Rc; TR_Y[0] = hy + qTmp[1] * Rc;
    for (let i = 1; i <= TR_N; i++) {
      span += dt; dt *= 1.09;
      const tp = t - span;
      if (tp < 0) break;
      strikeQ(c, tp, qTmp);
      const k = useZoom ? zNow / zAt(c, tp) : 1;
      TR_X[i] = hx + qTmp[0] * Rc * k; TR_Y[i] = hy + qTmp[1] * Rc * k; m = i;
    }
    if (m < 1) return;
    // 배율이 바뀌는 구간에서 꺾이지 않게 다듬고, 길이를 잽니다
    for (let p = 0; p < 3; p++) {
      let ax = TR_X[0], ay = TR_Y[0];
      for (let i = 1; i < m; i++) {
        const bx = TR_X[i], by = TR_Y[i];
        TR_X[i] = (ax + 2 * bx + TR_X[i + 1]) * 0.25; TR_Y[i] = (ay + 2 * by + TR_Y[i + 1]) * 0.25;
        ax = bx; ay = by;
      }
    }
    let len = 0;
    TR_L[0] = 0;
    for (let i = 1; i <= m; i++) {
      const d = Math.hypot(TR_X[i] - TR_X[i - 1], TR_Y[i] - TR_Y[i - 1]);
      if (len + d >= maxLen) {
        const q = (maxLen - len) / Math.max(d, 1e-3);
        TR_X[i] = TR_X[i - 1] + (TR_X[i] - TR_X[i - 1]) * q; TR_Y[i] = TR_Y[i - 1] + (TR_Y[i] - TR_Y[i - 1]) * q;
        len = maxLen; TR_L[i] = len; m = i;
        break;
      }
      len += d; TR_L[i] = len;
    }
    if (len < 1) return;
    for (let i = 0; i <= m; i++) {
      const a = i > 0 ? i - 1 : 0, b = i < m ? i + 1 : m, dx = TR_X[b] - TR_X[a], dy = TR_Y[b] - TR_Y[a], l = Math.hypot(dx, dy) || 1;
      TR_NX[i] = -dy / l; TR_NY[i] = dx / l;
    }
    const X0 = TR_X[0], Y0 = TR_Y[0], X1 = TR_X[m], Y1 = TR_Y[m], a0 = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    // 불기운: 머리 가까이 촘촘한 부드러운 덩어리
    if (rH > 2.2) {
      const g = glow(255, 126, 58, 1.7);
      let j = 0;
      const Lp = Math.min(len, Math.max(rH * 36, 80));
      for (let i = 0; i < 24; i++) {
        const u = (i + hashN(i * 5 + c.h)) / 24, d = Lp * u * u;
        while (j < m - 1 && TR_L[j + 1] < d) j++;
        const q = clamp((d - TR_L[j]) / Math.max(TR_L[j + 1] - TR_L[j], 1e-3), 0, 1), r = rH * (1.05 + 3.3 * u) * (0.85 + 0.3 * Math.sin(t * 19 + i * 2.1));
        ctx.globalAlpha = a0 * 0.36 * (1 - u) * (1 - u);
        ctx.drawImage(g, TR_X[j] + (TR_X[j + 1] - TR_X[j]) * q - r, TR_Y[j] + (TR_Y[j + 1] - TR_Y[j]) * q - r, r * 2, r * 2);
      }
      ctx.globalAlpha = a0;
    }
    const nose = Math.max(rH * 2.2, 3);
    // 긴 자취: 어디서 왔는지 보여 주는 가는 선
    let G = ctx.createLinearGradient(X0, Y0, X1, Y1);
    G.addColorStop(0, 'rgba(255,170,110,.34)'); G.addColorStop(0.5, 'rgba(255,130,80,.13)'); G.addColorStop(1, 'rgba(200,90,60,0)');
    ctx.fillStyle = G;
    trailLayer(ctx, m, len, Math.max(rH * 0.34, 0.9), 0.7, nose);
    // 꼬리 세 겹: 길이는 머리 크기를 따릅니다
    const piece = (L, w0, pw, nz, s0, s1, s2, n, soft) => {
      L = Math.min(len, L);
      let j = 0;
      while (j < m && TR_L[j] < L) j++;
      G = ctx.createLinearGradient(X0, Y0, TR_X[j], TR_Y[j]);
      G.addColorStop(0, s0); G.addColorStop(0.42, s1); G.addColorStop(1, s2);
      ctx.fillStyle = G;
      ctx.globalAlpha = a0 / (soft ? n * 0.62 : 1);
      if (w0 < 2.2) n = 1;
      for (let k = 0; k < n; k++) trailLayer(ctx, m, L * (1 - (k / n) * 0.25), w0 * (1 - (k / n) * 0.82), pw, nz);
      ctx.globalAlpha = a0;
    };
    piece(Math.max(rH * 52, 120), Math.max(rH * 2.1, 2.4), 0.8, nose * 1.4, 'rgba(255,110,50,.3)', 'rgba(255,88,42,.12)', 'rgba(180,70,40,0)', 6, true);
    piece(Math.max(rH * 26, 66), Math.max(rH * 1.0, 1.5), 1, nose, 'rgba(255,190,110,.62)', 'rgba(255,140,72,.26)', 'rgba(255,110,60,0)', 5, true);
    piece(Math.max(rH * 11, 26), Math.max(rH * 0.42, 0.9), 1.2, nose * 0.7, 'rgba(255,253,244,.95)', 'rgba(255,226,170,.48)', 'rgba(255,190,120,0)', 3, true);
    // 떨어져 나가는 불똥
    if (rH > 3) {
      ctx.fillStyle = 'rgba(255,214,150,.9)';
      const mq = Math.max(1, Math.floor(m * 0.45));
      for (let i = 0; i < 14; i++) {
        const u = (t * (1.3 + hashN(i + c.h) * 1.4) + hashN(i * 3 + c.h)) % 1, q = Math.floor(u * mq), side = (hashN(i * 7 + c.h) - 0.5) * 2, off = rH * (0.5 + 3.4 * u) * side, sz = Math.max(0.8, rH * 0.16 * (1 - u));
        ctx.fillRect(TR_X[q] + TR_NX[q] * off - sz / 2, TR_Y[q] + TR_NY[q] * off - sz / 2, sz, sz);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  let rockSprite = null;
  function rock() {
    if (rockSprite) return rockSprite;
    const S = 96, c = mk(S, S), x = c.getContext('2d'), im = x.createImageData(S, S), N = new WS.Noise(0xb01d), m = S / 2;
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const dx = (px + 0.5 - m) / (m - 1), dy = (py + 0.5 - m) / (m - 1), r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      const rim = 0.8 + N.fbm(Math.cos(a) * 1.2, Math.sin(a) * 1.2, 0.4, 3) * 0.62;
      if (r > rim + 0.04) continue;
      const nz = Math.sqrt(Math.max(0, 1 - (r / rim) * (r / rim))), v = 0.5 + N.fbm(dx * 3.4, dy * 3.4, nz * 2, 4) * 1.1, lb = 0.32 + 0.68 * nz, i = (py * S + px) * 4;
      im.data[i] = lerp(50, 118, v) * lb; im.data[i + 1] = lerp(42, 100, v) * lb; im.data[i + 2] = lerp(36, 86, v) * lb;
      im.data[i + 3] = clamp((rim - r) * m + 0.5, 0, 1) * 255;
    }
    x.putImageData(im, 0, 0);
    const m48 = halve(c);
    return (rockSprite = { c96: c, c48: m48, c24: halve(m48) });
  }
  function drawHead(ctx, x, y, r, heat, c, t, dpr, dirX, dirY) {
    const gw = glow(255, 240, 214, 2.8), go = glow(255, 132, 56, 2.4);
    ctx.globalCompositeOperation = 'lighter';
    const big = r * lerp(4.5, 8, heat), fx = x + dirX * r * 0.6 * heat, fy = y + dirY * r * 0.6 * heat;
    ctx.globalAlpha = 0.5 + 0.42 * heat; ctx.drawImage(go, fx - big, fy - big, big * 2, big * 2);
    const mid = r * lerp(2.3, 3.2, heat);
    ctx.globalAlpha = 0.7; ctx.drawImage(gw, x - mid, y - mid, mid * 2, mid * 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (r > 3.4) {
      const R = rock(), px = r * 2 * dpr;
      rotDraw(ctx, px > 60 ? R.c96 : px > 30 ? R.c48 : R.c24, x, y, r * 2, r * 2, c.rotH + t * 1.3, dpr);
      // 앞쪽이 달아오릅니다
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.3 + 0.7 * heat;
      const e = r * lerp(1.1, 1.7, heat);
      ctx.drawImage(gw, x + dirX * r * 0.45 - e, y + dirY * r * 0.45 - e, e * 2, e * 2);
    } else {
      ctx.fillStyle = '#fffdf6'; ctx.beginPath(); ctx.arc(x, y, Math.max(0.9, r * 0.62), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  // 구면 위의 원 (보이는 쪽만)
  function sphereRing(ctx, cx, cy, R, c, ang) {
    const S = c.S, U = c.U, V = c.V, ca = Math.cos(ang), sa = Math.sin(ang);
    let on = false;
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const p = (i / 64) * TAU, cp = Math.cos(p) * sa, sp = Math.sin(p) * sa;
      const X = ca * S[0] + cp * U[0] + sp * V[0], Y = ca * S[1] + cp * U[1] + sp * V[1], Z = ca * S[2] + cp * U[2] + sp * V[2];
      if (Z < -0.01) { on = false; continue; }
      const x = cx + R * X, y = cy - R * Y;
      if (on) ctx.lineTo(x, y); else { ctx.moveTo(x, y); on = true; }
    }
    ctx.stroke();
  }
  const EJ_COL = ['rgba(255,250,230,', 'rgba(255,212,128,', 'rgba(255,138,62,', 'rgba(176,72,40,'];
  const EJ_G = 1.25;
  const EP = [0, 0, 0];
  function ejPos(c, az, om, hv, ta) {
    const S = c.S, U = c.U, V = c.V, h = hv * ta - 0.5 * EJ_G * ta * ta, th = om * ta, ct = Math.cos(th), st = Math.sin(th), ca = Math.cos(az), sa = Math.sin(az), rr = 1 + (h > 0 ? h : 0);
    EP[0] = (ct * S[0] + st * (ca * U[0] + sa * V[0])) * rr;
    EP[1] = (ct * S[1] + st * (ca * U[1] + sa * V[1])) * rr;
    EP[2] = (ct * S[2] + st * (ca * U[2] + sa * V[2])) * rr;
    return EP;
  }
  function drawImpactFx(ctx, cx, cy, R, c, W, H, dpr, full) {
    const ti = c.ti;
    if (ti < 0) return;
    const S = c.S, pow = c.pow, U = c.U, V = c.V;
    const sx = cx + R * S[0], sy = cy - R * S[1];
    // 대기를 타고 번지는 얇은 충격파 선
    const fade1 = Math.exp(-ti * 2.1) * (0.42 + 0.58 * pow);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    if (fade1 > 0.015) {
      const a1 = lerp(0.42, 2.0, pow) * (1 - Math.exp(-ti * 1.25)) + 0.01;
      ctx.strokeStyle = `rgba(190,222,255,${(fade1 * 0.12).toFixed(3)})`; ctx.lineWidth = R * 0.05; sphereRing(ctx, cx, cy, R, c, a1);
      ctx.strokeStyle = `rgba(225,240,255,${(fade1 * 0.26).toFixed(3)})`; ctx.lineWidth = Math.max(1, R * 0.007); sphereRing(ctx, cx, cy, R, c, a1);
    }
    // 연기 기둥과 흙먼지
    ctx.globalCompositeOperation = 'source-over';
    const smoke = smokeSprite();
    for (let i = 0; i < c.nP; i++) {
      const born = 0.16 + c.puffs[i * 4 + 3], age = ti - born;
      if (age <= 0 || age > 2.6) continue;
      const az = c.puffs[i * 4], sp = c.puffs[i * 4 + 1], hg = c.puffs[i * 4 + 2], k = 1 - Math.exp(-age * 1.05);
      const th = (0.04 + 0.26 * sp) * k * (0.5 + pow), h = (0.1 + 0.36 * hg) * k * (0.5 + 0.8 * pow), ct = Math.cos(th), st = Math.sin(th);
      const px = (ct * S[0] + st * (Math.cos(az) * U[0] + Math.sin(az) * V[0])) * (1 + h), py = (ct * S[1] + st * (Math.cos(az) * U[1] + Math.sin(az) * V[1])) * (1 + h);
      const size = R * (0.05 + 0.17 * k) * (0.6 + 0.9 * pow), al = sst(0, 0.2, age) * (1 - sst(1.0, 2.6, age)) * 0.72;
      ctx.globalAlpha = al;
      ctx.drawImage(smoke, cx + R * px - size, cy - R * py - size, size * 2, size * 2);
    }
    ctx.globalAlpha = 1;
    // 불덩이
    ctx.globalCompositeOperation = 'lighter';
    const hotG = glow(255, 176, 96, 1.7), whG = glow(255, 250, 235, 2.6);
    const fb = Math.exp(-ti * 3.6), rf = R * (0.14 + 0.62 * pow) * (1 + ti * 1.1);
    if (fb > 0.01) {
      ctx.globalAlpha = fb; ctx.drawImage(hotG, sx - rf, sy - rf, rf * 2, rf * 2);
      const rc = rf * 0.5; ctx.globalAlpha = Math.min(1, fb * 1.25); ctx.drawImage(whG, sx - rc, sy - rc, rc * 2, rc * 2);
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    // 파편의 막: 지나온 궤적을 함께 그려 불꽃 분수처럼 보입니다
    const ej = c.ej, nE = c.nE, lw0 = R * (0.0035 + 0.003 * pow);
    const curtain = Math.min(nE, 54);
    ctx.lineWidth = Math.max(0.8, lw0 * 1.15);
    for (let b = 0; b < 3; b++) {
      ctx.beginPath();
      for (let i = 0; i < curtain; i++) {
        const az = ej[i * 5], om = ej[i * 5 + 1] * 0.62, hv = ej[i * 5 + 2] * 1.25, dly = ej[i * 5 + 4] * 0.12, tt = ti - dly;
        if (tt <= 0) continue;
        const land = (2 * hv) / EJ_G, life = tt / land;
        if (life > 1 || (life < 0.33 ? 0 : life < 0.66 ? 1 : 2) !== b) continue;
        let on = false;
        for (let s = 0; s < 6; s++) {
          const ta = Math.max(0, tt - s * 0.026), P = ejPos(c, az, om, hv, ta);
          if (P[2] < 0 && P[0] * P[0] + P[1] * P[1] < 1) { on = false; continue; }
          const x = cx + R * P[0], y = cy - R * P[1];
          if (on) ctx.lineTo(x, y); else { ctx.moveTo(x, y); on = true; }
          if (ta === 0) break;
        }
      }
      ctx.strokeStyle = b === 0 ? 'rgba(255,226,170,.3)' : b === 1 ? 'rgba(255,170,96,.18)' : 'rgba(210,104,60,.07)';
      ctx.stroke();
    }
    // 작은 불똥
    for (let b = 0; b < 4; b++) {
      ctx.beginPath();
      let any = false;
      for (let i = 0; i < nE; i++) {
        const az = ej[i * 5], om = ej[i * 5 + 1], hv = ej[i * 5 + 2], qq = ej[i * 5 + 3], dly = ej[i * 5 + 4] * 0.25, tt = ti - dly;
        if (tt <= 0) continue;
        const life = tt / ((2 * hv) / EJ_G);
        if (life > 1) continue;
        const lq = life + qq * 0.3, bk = lq < 0.3 ? 0 : lq < 0.62 ? 1 : lq < 0.95 ? 2 : 3;
        if (bk !== b) continue;
        let P = ejPos(c, az, om, hv, tt);
        if (P[2] < 0 && P[0] * P[0] + P[1] * P[1] < 1) continue;
        const x = cx + R * P[0], y = cy - R * P[1];
        P = ejPos(c, az, om, hv, Math.max(0, tt - 0.008 - qq * qq * 0.04));
        ctx.moveTo(x, y); ctx.lineTo(cx + R * P[0], cy - R * P[1]);
        any = true;
      }
      if (any) {
        ctx.strokeStyle = EJ_COL[b] + (b === 3 ? '.55)' : b === 0 ? '.85)' : '.75)');
        ctx.lineWidth = Math.max(0.6, lw0 * (b === 0 ? 0.9 : b === 1 ? 0.85 : 0.7));
        ctx.stroke();
      }
    }
    // 큰 덩어리: 빛나며 포물선을 그립니다
    const nC = Math.round(4 + 10 * pow), gc = glow(255, 190, 110, 2.2);
    for (let i = 0; i < nC; i++) {
      const az = ej[i * 5] + 1.1, om = 0.35 + ej[i * 5 + 3] * 0.55, hv = 0.42 + ej[i * 5 + 4] * 0.5, tt = ti - 0.04, life = tt / ((2 * hv) / EJ_G);
      if (tt <= 0 || life > 1) continue;
      const P = ejPos(c, az, om, hv, tt);
      if (P[2] < 0 && P[0] * P[0] + P[1] * P[1] < 1) continue;
      const x = cx + R * P[0], y = cy - R * P[1], rg = R * (0.016 + 0.018 * pow) * (1.5 - life);
      ctx.globalAlpha = 1 - life * life;
      ctx.drawImage(gc, x - rg * 2.2, y - rg * 2.2, rg * 4.4, rg * 4.4);
    }
    ctx.globalAlpha = 1;
    // 렌즈에 맺히는 빛줄기
    const fl = Math.exp(-ti * 3.6) * lerp(0.45, 1, pow);
    if (fl > 0.01 && full !== 2) {
      const sw = Math.max(W, H) * lerp(0.5, 1.15, pow), st_ = sunSprites([255, 236, 200]).streak;
      ctx.globalAlpha = fl * 0.62; ctx.drawImage(st_, sx - sw, sy - R * 0.065, sw * 2, R * 0.13);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  let smokeC = null;
  function smokeSprite() {
    if (smokeC) return smokeC;
    const S = 64, c = mk(S, S), x = c.getContext('2d'), im = x.createImageData(S, S), N = new WS.Noise(0x5a0c), m = S / 2;
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const dx = (px + 0.5 - m) / m, dy = (py + 0.5 - m) / m, r = Math.hypot(dx, dy);
      if (r > 1) continue;
      const v = N.fbm(dx * 2.2, dy * 2.2, 1.3, 4), a = clamp((1 - r) * 1.7 + v * 1.2 - 0.25, 0, 1), i = (py * S + px) * 4, k = 0.75 + v * 0.8;
      im.data[i] = 74 * k; im.data[i + 1] = 58 * k; im.data[i + 2] = 48 * k; im.data[i + 3] = a * a * 230;
    }
    x.putImageData(im, 0, 0);
    return (smokeC = c);
  }

  /* ---------- 표면 준비 ---------- */
  function texFor(st, scene, hi) {
    const H = scene.home, S = st.surf;
    if (!H) return null;
    // 장면이 도는 동안 세계는 계속 흐릅니다. 표면을 붙들어 두어 자막의 시각과 그림이 어긋나지 않게 합니다
    const c = st.cine, late = S.noisePending && NT.ready;
    if (c && c.held && S.tex && !late) return S.tex;
    const every = hi ? 1 : 2.5;
    if (S.tex && st.t - S.at < every && (!hi || S.hi) && !late) { if (c && S.hi) c.held = true; return S.tex; }
    S.at = st.t;
    let s = null;
    try { s = H.surface ? H.surface() : null; } catch (e) { s = null; }
    if (!s || !s.rgba) {
      if (!hi) return S.tex;
      if (S.ver !== 'fb') { const b = st.lay && st.lay.home; s = fallbackTex(b ? b.look : 'ocean', b ? b.id : 'x'); S.ver = 'fb0'; }
      else return S.tex;
    }
    const tw = hi ? 512 : 256, th = hi ? 256 : 128, sameV = S.src === s && S.ver === s.ver && S.tex && S.tex.tw === tw;
    if (!sameV || (S.noisePending && NT.ready)) {
      S.tex = prepTex(s, tw, th, S.tex);
      S.src = s; S.ver = S.ver === 'fb0' ? 'fb' : s.ver; S.hi = hi || S.hi && S.tex.tw === 512;
      S.noisePending = !S.tex.noised;
    }
    S.hi = S.tex.tw === 512;
    if (c && S.hi) c.held = true;
    return S.tex;
  }

  /* ---------- 그리기: 천체 ---------- */
  function drawPlanetSprite(ctx, b, x, y, R, zs, ang, dpr, st) {
    const px = 2 * R * dpr, s = sprite(b.look, b.id);
    const def = LOOKS[b.look] || LOOKS.rocky;
    if (def.rim && R > 2.4 && def.rimA > 0.5) {
      const A = atmoSprite(def.rim), k = R * ATMO_K;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.75;
      rotDraw(ctx, A, x, y, k * 2, k * 2, ang, dpr);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    if (s) ctx.drawImage(pickMip(s, px), x - R, y - R, R * 2, R * 2);
    else { ctx.fillStyle = flatColor(b.look, b.id); ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill(); }
    rotDraw(ctx, shadeFor(zs, px), x, y, R * 2 + 0.4, R * 2 + 0.4, ang, dpr);
  }
  function drawSaturnLike(ctx, b, x, y, R, zs, ang, dpr, st) {
    const rw = R * RING_MAX * 2, rh = rw * RING_SQ, ring = ringWithShadow(st.ring, b.th), dw = rw * dpr, lv = dw < 100 ? 3 : dw < 200 ? 2 : 1;
    if (!ring) { drawPlanetSprite(ctx, b, x, y, R, zs, ang, dpr, st); return; }
    rotDraw(ctx, lv === 3 ? ring.back3 : lv === 2 ? ring.back2 : ring.back, x, y, rw, rh, RING_ROLL, dpr);
    drawPlanetSprite(ctx, b, x, y, R, zs, ang, dpr, st);
    rotDraw(ctx, lv === 3 ? ring.front3 : lv === 2 ? ring.front2 : ring.front, x, y, rw, rh, RING_ROLL, dpr);
  }
  function drawBodies(ctx, st, lay, scene, cam, W, H, dpr, sunPass) {
    const order = st.order;
    for (let i = 0; i < order.length; i++) {
      const b = order[i];
      if (sunPass === 0 ? b.z >= 0 : b.z < 0) continue;
      const x = b.sx, y = b.sy, R = b.sR, ext = R * (b.rings ? 2.6 : 1.4) + 2;
      if (x < -ext || y < -ext || x > W + ext || y > H + ext) continue;
      const ang = Math.atan2(cam.oy - y, cam.ox - x);
      const zs = st.cine && b.p === lay.home ? -0.8 : (b.moon && b.p ? b.p.z / Math.max(1, b.p.r) : b.z / Math.max(1, b.r));
      if (b.home) {
        drawHome(ctx, st, lay, scene, cam, b, x, y, R, ang, zs, dpr);
        continue;
      }
      if (b.rings) drawSaturnLike(ctx, b, x, y, R, zs, ang, dpr, st);
      else drawPlanetSprite(ctx, b, x, y, R, zs, ang, dpr, st);
      if (b.set && !b.set.lost && R > 2) colonyLights(ctx, b, x, y, R, st);
    }
  }
  function colonyLights(ctx, b, x, y, R, st) {
    const n = clamp(Math.round(Math.log10(1 + b.set.pop) * 1.3), 1, 8), h = hashStr(b.id);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ffe2a0';
    for (let i = 0; i < n; i++) {
      const a = hashN(h + i * 3) * TAU, d = Math.sqrt(hashN(h + i * 3 + 1)) * 0.74 * R, s = clamp(R * 0.07, 0.8, 1.5);
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(st.t * 1.5 + i * 2);
      ctx.fillRect(x + Math.cos(a) * d - s / 2, y + Math.sin(a) * d - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  const L_TMP = [0, 0, 1];
  function lightFor(cam, x, y, lz) {
    let lx = cam.ox - x, ly = -(cam.oy - y);
    const l = Math.hypot(lx, ly) || 1;
    lx /= l; ly /= l;
    const k = Math.hypot(1, lz);
    L_TMP[0] = lx / k; L_TMP[1] = ly / k; L_TMP[2] = lz / k;
    return L_TMP;
  }
  const WIDE_ROLL = -0.34, WIDE_PITCH = 0.3;
  // 장면 동안은 대기 색도 표면과 함께 붙들어 둡니다
  const atmOf = (c, H) => { if (!c) return H.atmosphere; if (c.atm === undefined) c.atm = H.atmosphere; return c.atm; };
  const P_G = { tex: null, off: 0, coff: 0, L: L_TMP, cloud: 0, atm: [120, 170, 255], rimA: 0.9, rimBoost: 0, dust: 0, stain: null, lightsOn: false };
  function globeParams(st, scene, c, L, ell, roll, pitch, tex, extra) {
    const H = scene.home, P = P_G;
    P.tex = tex; P.L = L;
    const u = ((ell + Math.PI) / TAU) * 65536;
    P.off = ((Math.round(u) % 65536) + 65536) % 65536;
    const cl = ((ell + Math.PI + st.t * 0.012) / TAU) * 65536;
    P.coff = ((Math.round(cl) % 65536) + 65536) % 65536;
    const a = atmOf(c, H);
    // 녹은 행성 위의 구름은 흰 구름이 아니라 불빛에 물든 수증기입니다. 장면 동안은 표면과 함께 붙들어 둡니다
    P.steam = c ? (c.steam == null ? (c.steam = !!H.steam) : c.steam) : !!H.steam;
    if (a) { P.atm = a; P.rimA = 0.92; P.cloud = NT.ready ? (P.steam ? 0.5 : 0.92) * sst(0, 700, now() - NT.at) : 0; } else { P.atm = [150, 150, 150]; P.rimA = 0.2; P.cloud = 0; }
    let hd = H.dust || 0;
    if (c) {
      if (c.dust0 == null) c.dust0 = st.t - st.dustT < 0.5 ? st.dustV : Math.min(hd, 0.12);
      hd = lerp(c.dust0, hd, c.ti > 0 ? sst(0.2, 2.4, c.ti) : 0);
    } else { st.dustV = hd; st.dustT = st.t; }
    P.dust = clamp(Math.max(hd, extra || 0), 0, 1);
    P.lightsOn = !scene.homeEmpty;
    P.rimBoost = 0;
    if (c) {
      P.stain = stainOf(c);
      if (c.ti > 0) P.rimBoost = c.pow * 1.1 * Math.exp(-c.ti * 2.2);
    } else P.stain = scarOf(st, ell, roll, pitch);
    return P;
  }
  function drawHome(ctx, st, lay, scene, cam, b, x, y, R, ang, zs, dpr) {
    const H = scene.home, c = st.cine;
    const hiNeed = !!c || R > 40;
    const tex = R >= 3.2 ? texFor(st, scene, hiNeed) : null;
    if (!tex) {
      drawPlanetSprite(ctx, b, x, y, R, zs, ang, dpr, st);
      if (H && H.dust > 0.02) { ctx.globalAlpha = clamp(H.dust, 0, 1) * 0.65; ctx.fillStyle = '#7a6a58'; ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
      return;
    }
    let roll = WIDE_ROLL, pitch = WIDE_PITCH, ell = -st.orbit * 0.42, extra = 0, lz = 0.64 - zs * 0.28;
    if (c) {
      roll = c.roll; pitch = c.pitch; ell = c.ellNow;
      lz = lerp(lz, 0.52, cam.e);
      if (c.ti > 0) extra = c.pow * 0.42 * sst(0.5, 2.6, c.ti);
    }
    const L = lightFor(cam, x, y, lz), atm = atmOf(c, H);
    if (atm && R > 2) {
      const A = atmoSprite(atm), k = R * ATMO_K;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = c && c.ti > 0 ? Math.min(1, 0.85 + c.pow * Math.exp(-c.ti * 2)) : 0.85;
      rotDraw(ctx, A, x, y, k * 2, k * 2, Math.atan2(-L[1], L[0]), dpr);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    const P = globeParams(st, scene, c, L, ell, roll, pitch, tex, extra);
    drawGlobeAt(ctx, x, y, R, dpr, P, 256, roll, pitch);
    if (!c && scene.home && scene.home.sats && R > 4) drawSats(ctx, x, y, R, st);
  }
  function drawSats(ctx, x, y, R, st) {
    ctx.fillStyle = '#dfe8ff';
    for (let i = 0; i < 9; i++) {
      const a = hashN(i + 41) * TAU + st.orbit * (0.7 + hashN(i + 7) * 0.6), inc = (hashN(i + 13) - 0.5) * 1.5, rr = R * (1.12 + hashN(i + 21) * 0.22);
      const px = Math.cos(a), pz = Math.sin(a);
      if (pz < 0 && Math.abs(px) * rr < R) continue;
      const sz = Math.max(0.7, R * 0.012);
      ctx.fillRect(x + px * rr - sz / 2, y + pz * inc * rr * 0.35 - sz / 2, sz, sz);
    }
  }
  function drawOrbits(ctx, st, lay, scene, cam) {
    const z = cam.z, fade = 1 - sst(3, 11, z);
    if (fade <= 0.01) return;
    const B = lay.bodies, sT = lay.sinT, ox = cam.ox, oy = cam.oy;
    ctx.lineWidth = 1;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (b.moon) continue;
      const rx = b.r * z, ry = rx * sT;
      ctx.strokeStyle = b.home ? `rgba(241,203,134,${(0.34 * fade).toFixed(3)})` : `rgba(176,196,232,${(0.11 * fade).toFixed(3)})`;
      ctx.beginPath(); ctx.ellipse(ox, oy, rx, ry, 0, Math.PI, TAU); ctx.stroke();
      ctx.strokeStyle = b.home ? `rgba(241,203,134,${(0.58 * fade).toFixed(3)})` : `rgba(176,196,232,${(0.2 * fade).toFixed(3)})`;
      ctx.beginPath(); ctx.ellipse(ox, oy, rx, ry, 0, 0, Math.PI); ctx.stroke();
      // 지나온 길이 살짝 밝습니다
      const c0 = b.home ? '241,203,134' : '196,214,246';
      ctx.lineWidth = 1.4;
      for (let k = 1; k <= 3; k++) {
        ctx.strokeStyle = `rgba(${c0},${(0.13 * fade).toFixed(3)})`;
        ctx.beginPath(); ctx.ellipse(ox, oy, rx, ry, 0, b.th - 0.2 * k, b.th); ctx.stroke();
      }
      ctx.lineWidth = 1;
    }
  }
  function drawBelt(ctx, st, lay, cam, W, H) {
    if (!lay.belt.length || cam.z > 6) return;
    const fade = 1 - sst(2, 6, cam.z), T = st.orbit, sT = lay.sinT, z = cam.z, ox = cam.ox, oy = cam.oy, B = lay.belt;
    for (let lvl = 0; lvl < 3; lvl++) {
      ctx.fillStyle = lvl === 0 ? `rgba(150,140,128,${(0.38 * fade).toFixed(3)})` : lvl === 1 ? `rgba(186,172,156,${(0.55 * fade).toFixed(3)})` : `rgba(228,214,196,${(0.75 * fade).toFixed(3)})`;
      ctx.beginPath();
      for (let i = 0; i < B.length; i++) {
        const b = B[i], L = b.lum < 0.45 ? 0 : b.lum < 0.82 ? 1 : 2;
        if (L !== lvl) continue;
        const th = b.th + b.w * T, x = ox + b.r * Math.cos(th) * z, y = oy + (b.r * Math.sin(th) * sT + b.hz) * z, s = 0.75 + lvl * 0.3;
        ctx.rect(x, y, s, s);
      }
      ctx.fill();
    }
  }
  function drawZodiac(ctx, lay, cam, star) {
    if (cam.z > 5) return;
    const g = glow(255, 232, 196, 1.6), rx = lay.rN * 0.62 * cam.z, ry = rx * lay.sinT;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.075 * clamp(star.glow == null ? 1 : star.glow, 0.4, 2) * (1 - sst(2, 5, cam.z));
    ctx.drawImage(g, cam.ox - rx, cam.oy - ry, rx * 2, ry * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  function drawBombard(ctx, st, scene, lay, cam) {
    const rate = scene.bombard || 0;
    if (rate <= 0.01 || cam.z > 3) return;
    const n = Math.round(clamp(rate, 0, 1) * 34), T = st.orbit, rO = lay.rN * 1.14, rI = lay.rN * 0.14, sT = lay.sinT, fade = 1 - sst(1.4, 3, cam.z);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const ph = hashN(i * 5 + 1), per = 2.2 + hashN(i * 5 + 2) * 2.6, gap = 1.6 + hashN(i * 5 + 3) * 3.5, cyc = per + gap, loc = (T / cyc + ph) % 1, u = (loc * cyc) / per;
      if (u > 1) continue;
      const a0 = hashN(i * 5 + 4) * TAU, turn = (hashN(i * 5 + 5) - 0.3) * 1.3;
      const pos = (uu) => { const k = Math.pow(uu, 1.5), r = lerp(rO, rI, k), a = a0 + turn * k; return [cam.ox + r * Math.cos(a) * cam.z, cam.oy + r * Math.sin(a) * sT * cam.z]; };
      const P = pos(u), Q = pos(Math.max(0, u - 0.09));
      const al = Math.sin(Math.PI * u) * 0.75 * fade;
      const G = ctx.createLinearGradient(Q[0], Q[1], P[0], P[1]);
      G.addColorStop(0, 'rgba(255,190,130,0)'); G.addColorStop(1, `rgba(255,236,206,${al.toFixed(3)})`);
      ctx.strokeStyle = G;
      ctx.beginPath(); ctx.moveTo(Q[0], Q[1]); ctx.lineTo(P[0], P[1]); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------- 정착지와 우주선 ---------- */
  function arcPoint(ax, ay, bx, by, cx, cy, u, o) {
    const v = 1 - u;
    o[0] = v * v * ax + 2 * v * u * cx + u * u * bx;
    o[1] = v * v * ay + 2 * v * u * cy + u * u * by;
    return o;
  }
  function arcCtrl(ax, ay, bx, by, o) {
    const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
    let nx = -dy / l, ny = dx / l;
    if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
    o[0] = mx + nx * l * 0.24; o[1] = my + ny * l * 0.24;
    return o;
  }
  const P1 = [0, 0], P2 = [0, 0], PC = [0, 0];
  function drawTraffic(ctx, st, scene, lay, cam) {
    const tr = scene.traffic || 0, list = scene.settlements;
    let H = lay.home;
    if (tr <= 0.001 || !H || !list || !list.length || cam.z > 2.2) return;
    // 고향에 아무도 없으면 가장 큰 정착지가 출발지입니다
    if (scene.homeEmpty) {
      let bp = -1;
      for (let i = 0; i < list.length; i++) { const q = list[i], b = lay.byId[q.bodyId]; if (b && !q.lost && (q.pop || 0) > bp) { bp = q.pop || 0; H = b; } }
    }
    const fade = 1 - sst(1.2, 2.2, cam.z);
    let count = 0;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(170,214,255,${(0.42 * fade).toFixed(3)})`;
    ctx.fillStyle = `rgba(240,250,255,${(0.95 * fade).toFixed(3)})`;
    ctx.lineWidth = 1;
    const T = st.orbit, heads = [];
    // 항로
    ctx.strokeStyle = `rgba(150,200,255,${(0.13 * fade).toFixed(3)})`;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (let i = 0; i < list.length; i++) {
      const s = list[i], b = lay.byId[s.bodyId];
      if (s.lost || !b || b === H) continue;
      arcCtrl(H.x, H.y, b.x, b.y, PC);
      ctx.moveTo(cam.ox + H.x * cam.z, cam.oy + H.y * cam.z);
      ctx.quadraticCurveTo(cam.ox + PC[0] * cam.z, cam.oy + PC[1] * cam.z, cam.ox + b.x * cam.z, cam.oy + b.y * cam.z);
    }
    ctx.stroke();
    ctx.strokeStyle = `rgba(190,226,255,${(0.7 * fade).toFixed(3)})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    // 정착지마다 돌아가며 한 척씩: 먼저 세운 곳이 자리를 다 쓰면 나중에 세운 곳에는 배가 가지 않습니다
    for (let k = 0, more = true; more && count < 24; k++) {
      more = false;
      for (let i = 0; i < list.length && count < 24; i++) {
        const s = list[i], b = lay.byId[s.bodyId];
        if (s.lost || !b || b === H || k >= Math.ceil(tr * (1 + Math.log10(1 + (s.pop || 0)) * 0.8))) continue;
        more = true; count++;
        arcCtrl(H.x, H.y, b.x, b.y, PC);
        const hh = hashN(i * 91 + k * 7 + 3), sp = 0.1 + hashN(i * 13 + k + 5) * 0.1;
        let u = (T * sp + hh) % 1, tail = u - 0.06;
        if (k % 2) { u = 1 - u; tail = u + 0.06; }
        tail = clamp(tail, 0, 1);
        arcPoint(H.x, H.y, b.x, b.y, PC[0], PC[1], u, P1);
        arcPoint(H.x, H.y, b.x, b.y, PC[0], PC[1], tail, P2);
        const x = cam.ox + P1[0] * cam.z, y = cam.oy + P1[1] * cam.z;
        ctx.moveTo(x, y); ctx.lineTo(cam.ox + P2[0] * cam.z, cam.oy + P2[1] * cam.z);
        heads.push(x, y);
      }
    }
    ctx.stroke();
    const gs = glow(200, 232, 255, 2.4);
    ctx.globalAlpha = fade;
    for (let i = 0; i < heads.length; i += 2) { ctx.drawImage(gs, heads[i] - 4.5, heads[i + 1] - 4.5, 9, 9); ctx.fillRect(heads[i] - 0.9, heads[i + 1] - 0.9, 1.8, 1.8); }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  function drawFlights(ctx, st, lay, cam) {
    const H = lay.home;
    if (!H) return;
    for (let i = st.flights.length - 1; i >= 0; i--) {
      const f = st.flights[i], age = st.t - f.at, b = lay.byId[f.bodyId];
      if (!b || age > 4.6) { st.flights.splice(i, 1); continue; }
      if (cam.z > 2) continue;
      arcCtrl(H.x, H.y, b.x, b.y, PC);
      const u = ease5(age / 3);
      ctx.globalCompositeOperation = 'lighter';
      if (age < 3) {
        ctx.lineCap = 'round';
        for (let k = 8; k >= 1; k--) {
          arcPoint(H.x, H.y, b.x, b.y, PC[0], PC[1], Math.max(0, u - k * 0.012), P1);
          arcPoint(H.x, H.y, b.x, b.y, PC[0], PC[1], Math.max(0, u - (k - 1) * 0.012), P2);
          ctx.strokeStyle = `rgba(255,232,180,${(0.8 * (1 - k / 9)).toFixed(3)})`;
          ctx.lineWidth = 2 * (1 - k / 10);
          ctx.beginPath(); ctx.moveTo(cam.ox + P1[0] * cam.z, cam.oy + P1[1] * cam.z); ctx.lineTo(cam.ox + P2[0] * cam.z, cam.oy + P2[1] * cam.z); ctx.stroke();
        }
        arcPoint(H.x, H.y, b.x, b.y, PC[0], PC[1], u, P1);
        const x = cam.ox + P1[0] * cam.z, y = cam.oy + P1[1] * cam.z, g = glow(255, 236, 190, 2.4);
        ctx.drawImage(g, x - 8, y - 8, 16, 16);
        ctx.fillStyle = '#fff'; ctx.fillRect(x - 1, y - 1, 2, 2);
      } else {
        const p = (age - 3) / 1.6, x = cam.ox + b.x * cam.z, y = cam.oy + b.y * cam.z, r = b.R * cam.z + 3 + p * 26;
        ctx.strokeStyle = `rgba(255,226,160,${(0.9 * (1 - p)).toFixed(3)})`;
        ctx.lineWidth = 1.6 * (1 - p) + 0.4;
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  function drawMarkers(ctx, st, lay, scene, cam, a) {
    if (a <= 0.01) return;
    const H = lay.home;
    if (H) {
      const x = H.sx, y = H.sy, r = H.sR + 5;
      ctx.globalCompositeOperation = 'lighter';
      const g = glow(241, 203, 134, 2.2), gr = r * 3;
      ctx.globalAlpha = 0.2 * a; ctx.drawImage(g, x - gr, y - gr, gr * 2, gr * 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = (0.72 + 0.14 * Math.sin(st.t * 1.6)) * a;
      ctx.strokeStyle = C_BRASS; ctx.lineWidth = 1;
      const rot = st.t * 0.25;
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(x, y, r, rot + (k * TAU) / 3, rot + (k * TAU) / 3 + 1.6); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    const list = scene.settlements || [];
    for (let i = 0; i < list.length; i++) {
      const s = list[i], b = lay.byId[s.bodyId];
      if (!b || b === H) continue;
      const x = b.sx, y = b.sy, r = b.sR + 3 + clamp(Math.log10(1 + (s.pop || 0)) * 0.5, 0, 3.5);
      ctx.lineWidth = s.lost ? 1 : 1.3;
      if (s.lost) {
        ctx.globalAlpha = 0.55 * a; ctx.strokeStyle = C_GREY;
        ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      } else {
        ctx.globalAlpha = (0.78 + 0.2 * Math.sin(st.t * 2 + i)) * a; ctx.strokeStyle = '#ffd98e';
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
        const g = glow(255, 214, 140, 2.4), gr = r * 2.1;
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.13 * a; ctx.drawImage(g, x - gr, y - gr, gr * 2, gr * 2); ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = 1;
    }
  }
  function drawInterstellar(ctx, st, scene, lay, cam, W, H, dpr, a) {
    const I = scene.interstellar, Hb = lay.home;
    if (!I || !Hb || a <= 0.01) return;
    const ex = W - 26, ey = lay.wide ? 104 : lay.top + (lay.narrow ? 44 : 46), sx = Hb.sx, sy = Hb.sy;
    ctx.globalAlpha = 0.55 * a;
    ctx.strokeStyle = '#a9d8e6'; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = a;
    // 도착 예정인 별
    const g = glow(190, 226, 255, 2.4);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(g, ex - 13, ey - 13, 26, 26);
    ctx.fillStyle = '#fff'; ctx.fillRect(ex - 1, ey - 1, 2, 2);
    // 떠나는 우주선
    const u = (st.orbit * 0.055) % 1, x = lerp(sx, ex, u), y = lerp(sy, ey, u), dx = ex - sx, dy = ey - sy, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, tail = 34;
    const G = ctx.createLinearGradient(x - ux * tail, y - uy * tail, x, y);
    G.addColorStop(0, 'rgba(120,200,255,0)'); G.addColorStop(1, 'rgba(220,244,255,.95)');
    ctx.strokeStyle = G; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - ux * tail, y - uy * tail); ctx.lineTo(x, y); ctx.stroke();
    ctx.drawImage(g, x - 9, y - 9, 18, 18);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x + ux * 4, y + uy * 4); ctx.lineTo(x - ux * 2 - uy * 2, y - uy * 2 + ux * 2); ctx.lineTo(x - ux * 2 + uy * 2, y - uy * 2 - ux * 2); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    const size = (lay.narrow ? 11 : 12) + fontUp(W);
    const t1 = textSprite(I.target + ' · ' + lyText(I.ly) + '광년', size, dpr, { weight: 600, color: C_CYAN }), t2 = I.text ? textSprite(I.text, size - 1, dpr, { color: C_MUTED }) : null;
    const lx = W - 8, ly = ey + 11;
    putText(ctx, t1, lx, ly, 1, 0, a);
    if (t2) putText(ctx, t2, lx, ly + t1.h - 2, 1, 0, a);
  }
  const lyText = (v) => (v == null ? '?' : Math.round(v * 10) / 10);

  /* ---------- 글자: 이름표와 안내 ---------- */
  function overlap(P, n, x, y, w, h) {
    for (let i = 0; i < n; i += 4) if (x < P[i] + P[i + 2] && x + w > P[i] && y < P[i + 1] + P[i + 3] && y + h > P[i + 1]) return true;
    return false;
  }
  const CAND = [[1, 0], [0, -1], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, -1], [-1, 1]];
  const LBL = { x: 0, y: 0 };
  function labelAt(k, b, t, gap) {
    const c = CAND[k];
    // 고리는 옆으로만 깁니다. 대각선 자리는 모서리만 비키면 되므로 조금 가깝게
    const q = c[0] && c[1] ? 0.72 : 1, gx = (b.rings ? b.sR * RING_MAX + 3 : gap) * q, gy = (b.rings ? b.sR * 1.05 + 3 : gap) * q;
    LBL.x = c[0] === 1 ? b.sx + gx : c[0] === -1 ? b.sx - gx - t.w : b.sx - t.w / 2;
    LBL.y = c[1] === -1 ? b.sy - gy - t.h : c[1] === 1 ? b.sy + gy : b.sy - t.h / 2;
    return LBL;
  }
  function pickLabel(P, np, b, t, gap, pre, W, minY, maxY) {
    for (let i = -1; i < CAND.length; i++) {
      const k = i < 0 ? pre : i;
      if (k == null) continue;
      const q = labelAt(k, b, t, gap);
      if (q.x < 2 || q.x + t.w > W - 2 || q.y < minY || q.y + t.h > maxY) continue;
      // 지금 자리는 조금 겹쳐도 버팁니다: 천체가 스칠 때마다 이름표가 옮겨 다니지 않게
      const ix = i < 0 ? 9 : 3, iy = i < 0 ? 5 : 2;
      if (!overlap(P, np, q.x + ix, q.y + iy, t.w - ix * 2, t.h - iy * 2)) return k;
    }
    return -1;
  }
  function drawLabels(ctx, st, lay, scene, cam, W, H, dpr, a) {
    if (a <= 0.01) return;
    const P = st.placed;
    let np = 0;
    const narrow = lay.narrow, base = (narrow ? 11 : 12.5) + fontUp(W), minY = lay.wide ? 4 : lay.top + 2, maxY = lay.wide ? H - 4 : H - lay.bottom - (narrow ? NARROW_BAND : 2);
    const items = [];
    const hoverOn = st.hover && st.t - st.hoverT < 1.5 ? st.hover : null;
    for (let i = 0; i < lay.bodies.length; i++) {
      const b = lay.bodies[i], s = b.set;
      let text = null, size = base, weight = 400, color = '#d6dbe6', pri = 3;
      if (s) {
        // 휴대폰은 이름만: 인구는 아래 한 줄과 누르면 나오는 설명에 있습니다
        if (s.lost) { text = narrow ? (s.name || b.name) : (s.name || b.name) + ' · ' + (s.lostText || '사라짐'); color = C_GREY; pri = 1; }
        else { text = narrow ? (s.name || b.name) : (s.name || b.name) + ' · ' + s.popText; color = '#ffe0a0'; pri = 0; size = base + (narrow ? 0 : clamp(Math.log10(1 + (s.pop || 0)) - 3, 0, 4) * 0.42); weight = 600; }
      } else if (b.home) { text = b.name; color = C_BRASS; weight = 700; size = base + 1; pri = 0; }
      else if (b.moon) { if (b.id !== hoverOn) continue; text = b.name; color = '#d6dae4'; pri = 2; }
      else { text = b.name; pri = b.size > 1 ? 2 : 3; }
      if (b.id === hoverOn) { pri = -1; color = s ? color : '#fff'; }
      items.push({ b, text, size, weight, color, pri });
    }
    items.sort((p, q) => p.pri - q.pri);
    for (let i = 0; i < lay.bodies.length; i++) { const b = lay.bodies[i]; if (b.moon && !b.set) continue; const e = b.sR + (b.set ? 6 : 1), ex = b.rings ? b.sR * RING_MAX : e; P[np++] = b.sx - ex; P[np++] = b.sy - e; P[np++] = ex * 2; P[np++] = e * 2; }
    if (st.sunHit) { const r = st.sunHit.r; P[np++] = st.sunHit.x - r; P[np++] = st.sunHit.y - r; P[np++] = r * 2; P[np++] = r * 2; }
    if (st.boxRect) { P[np++] = st.boxRect.x; P[np++] = st.boxRect.y; P[np++] = st.boxRect.w; P[np++] = st.boxRect.h; }
    if (st.capRect) { P[np++] = st.capRect.x; P[np++] = st.capRect.y; P[np++] = st.capRect.w; P[np++] = st.capRect.h; }
    if (st.noteRect) { P[np++] = st.noteRect.x; P[np++] = st.noteRect.y; P[np++] = st.noteRect.w; P[np++] = st.noteRect.h; }
    if (st.btnReplay) { P[np++] = st.btnReplay.x; P[np++] = st.btnReplay.y; P[np++] = st.btnReplay.w; P[np++] = st.btnReplay.h; }
    if (st.hud) for (const r of st.hud) { P[np++] = r.x; P[np++] = r.y; P[np++] = r.w; P[np++] = r.h; }
    for (const it of items) {
      const b = it.b, sz = Math.round(it.size * 2) / 2, gap = b.sR + (b.set ? 7 : 3) + (b.rings ? b.sR * 1.25 : 0), pre = st.labelPos[b.id];
      let t = textSprite(it.text, sz, dpr, { weight: it.weight, color: it.color }), best = pickLabel(P, np, b, t, gap, pre, W, minY, maxY);
      // 빽빽하면 이름만, 그래도 자리가 없으면 정착지는 목록에 맡깁니다
      if (best < 0 && b.set && !b.set.lost) {
        t = textSprite(b.set.name || b.name, sz, dpr, { weight: it.weight, color: it.color });
        best = pickLabel(P, np, b, t, gap, pre, W, minY, maxY);
      }
      if (best < 0) { if (it.pri > 0 || (it.pri === 0 && b.set && !b.home)) { st.labelOff[b.id] = null; continue; } best = pre != null ? pre : 0; }
      st.labelPos[b.id] = best;
      const q = labelAt(best, b, t, gap), x = clamp(q.x, 2, W - t.w - 2), y = clamp(q.y, minY, maxY - t.h);
      // 자리를 옮길 때는 튀지 않고 천체 곁으로 미끄러집니다
      let o = st.labelOff[b.id];
      if (!o) o = st.labelOff[b.id] = { x: x - b.sx, y: y - b.sy };
      else { const k = 1 - Math.exp(-(st.dt || 0) * 9); o.x += (x - b.sx - o.x) * k; o.y += (y - b.sy - o.y) * k; }
      putText(ctx, t, clamp(b.sx + o.x, 2, W - t.w - 2), clamp(b.sy + o.y, minY, maxY - t.h), 0, 0, a);
      P[np++] = x; P[np++] = y; P[np++] = t.w; P[np++] = t.h;
      if (b.home && scene.homeEmpty) {
        const n = textSprite('고향 행성에는 아무도 남지 않았습니다', base, dpr, { color: C_EMBER }), nx = clamp(b.sx - n.w / 2, 2, W - n.w - 2), ny = clamp(Math.max(y + t.h - 2, b.sy + b.sR + 2), minY, maxY - n.h);
        putText(ctx, n, nx, ny, 0, 0, a);
        P[np++] = nx; P[np++] = ny; P[np++] = n.w; P[np++] = n.h;
      }
    }
    if (st.sunHit && scene.star && scene.star.name) {
      const t = textSprite(scene.star.name, base, dpr, { color: '#f6e6c4', weight: 600 }), x = st.sunHit.x - t.w / 2, y = st.sunHit.y + st.sunHit.r + 4;
      if (!overlap(P, np, x + 3, y + 2, t.w - 6, t.h - 4)) putText(ctx, t, x, y, 0, 0, a);
    }
  }
  // 정착지 상자: 내용이 바뀔 때만 다시 그립니다
  function listBox(scene, dpr, narrow, maxRows, sig, lay, up) {
    const list = (scene.settlements || []).slice().sort((p, q) => (p.lost ? 1 : 0) - (q.lost ? 1 : 0) || (q.pop || 0) - (p.pop || 0));
    const rows = list.slice(0, maxRows), more = list.length - rows.length;
    const size = (narrow ? 11 : 12.5) + up, rh = (narrow ? 17 : 20) + up * 2, head = (narrow ? 20 : 24) + up * 2, pad = narrow ? 7 : 10, ic = (narrow ? 13 : 15) + up * 2;
    const title = scene.listTitle || '인류가 간 곳';
    const m = meas();
    m.font = '600 ' + size + 'px ' + F_BODY;
    let wMax = m.measureText(title).width, wL = 0, wR = 0;
    for (const s of rows) { m.font = '500 ' + size + 'px ' + F_BODY; wL = Math.max(wL, m.measureText(s.name).width); m.font = size + 'px ' + F_BODY; wR = Math.max(wR, m.measureText(s.lost ? (s.lostText || '사라짐') : s.popText).width); }
    const w = Math.ceil(Math.max(wMax, wL + wR + 16 + ic)) + pad * 2, h = head + rows.length * rh + (more > 0 ? rh : 0) + 5;
    const c = mk(w * dpr, h * dpr), x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    rrect(x, 0.5, 0.5, w - 1, h - 1, 8);
    x.fillStyle = 'rgba(8,11,18,.68)'; x.fill();
    x.strokeStyle = 'rgba(241,203,134,.22)'; x.lineWidth = 1; x.stroke();
    x.textBaseline = 'middle';
    x.font = '600 ' + size + 'px ' + F_BODY; x.fillStyle = C_BRASS; x.fillText(title, pad, head / 2 + 2);
    const out = [];
    let missing = false;
    rows.forEach((s, i) => {
      const y = head + i * rh;
      const b = lay && lay.byId[s.bodyId], sp = b ? sprite(b.look, b.id) : null;
      if (b && !sp) missing = true;
      if (sp) { x.globalAlpha = s.lost ? 0.4 : 1; x.drawImage(sp.mips[1], pad, y + (rh - ic) / 2, ic, ic); x.globalAlpha = 1; }
      else { x.fillStyle = s.lost ? C_GREY : '#d9b777'; x.beginPath(); x.arc(pad + ic / 2, y + rh / 2, 2.6, 0, TAU); x.fill(); }
      x.font = '500 ' + size + 'px ' + F_BODY; x.fillStyle = s.lost ? C_GREY : C_TEXT; x.textAlign = 'left';
      x.fillText(s.name, pad + ic + 5, y + rh / 2);
      x.font = size + 'px ' + F_BODY; x.fillStyle = s.lost ? C_GREY : C_MUTED; x.textAlign = 'right';
      x.fillText(s.lost ? (s.lostText || '사라짐') : s.popText, w - pad, y + rh / 2);
      x.textAlign = 'left';
      out.push({ id: s.bodyId, y, h: rh });
    });
    if (more > 0) { x.font = size + 'px ' + F_BODY; x.fillStyle = C_FAINT; x.fillText('외 ' + more + '곳', pad + ic + 5, head + rows.length * rh + rh / 2); }
    return { c, w, h, rows: out, sig, missing };
  }
  // 휴대폰: 상자 대신 궤도 아래 띠에 한 줄. 인구가 많은 곳부터 들어가는 만큼만 적습니다
  function phoneStrip(scene, dpr, maxW, sig) {
    const list = scene.settlements || [], live = list.filter((s) => !s.lost).sort((p, q) => (q.pop || 0) - (p.pop || 0));
    const size = 11, pad = 8, h = 22, title = scene.listTitle || '인류가 간 곳', m = meas();
    const width = (txt, wg) => { m.font = wg + ' ' + size + 'px ' + F_BODY; return m.measureText(txt).width; };
    const wT = width(title, 600) + 6, room = maxW - pad * 2 - wT;
    let body = !live.length ? list.length + '곳 모두 사라짐' : live.length + '곳';
    for (let k = Math.min(3, live.length); k > 0 && live.length; k--) {
      const rest = live.length - k, txt = live.slice(0, k).map((s) => s.name + ' ' + s.popText).join(' · ') + (rest ? ' · 외 ' + rest + '곳' : '');
      if (width(txt, 400) <= room) { body = txt; break; }
    }
    const w = Math.ceil(Math.min(maxW, pad * 2 + wT + width(body, 400))), c = mk(w * dpr, h * dpr), x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    rrect(x, 0.5, 0.5, w - 1, h - 1, 7);
    x.fillStyle = 'rgba(8,11,18,.72)'; x.fill();
    x.strokeStyle = 'rgba(241,203,134,.2)'; x.lineWidth = 1; x.stroke();
    x.textBaseline = 'middle';
    x.font = '600 ' + size + 'px ' + F_BODY; x.fillStyle = C_BRASS; x.fillText(title, pad, h / 2 + 0.5);
    x.font = '400 ' + size + 'px ' + F_BODY; x.fillStyle = live.length ? C_TEXT : C_GREY; x.fillText(body, pad + wT, h / 2 + 0.5);
    return { c, w, h, rows: [], sig, missing: false };
  }
  let boxCache = null;
  function drawHud(ctx, st, lay, scene, W, H, dpr, a, cine) {
    const narrow = lay.narrow, top = lay.top, bottom = lay.bottom;
    st.btnReplay = null;
    st.rows = [];
    st.boxRect = null;
    st.capRect = null;
    st.noteRect = null;
    const up = fontUp(W);
    const note = textSprite('거리는 줄이고 행성은 크게 그렸습니다' + (scene.hidden ? ' · 작은 행성 ' + scene.hidden + '개 생략' : ''), (narrow ? 10.5 : 11) + up * 0.5, dpr, { color: C_FAINT });
    if (a > 0.01) {
      // 머리말 자리: 위쪽 안내 사이 틈이 넉넉하면 그 가운데, 아니면 그 아래
      let gL = 0, gR = W;
      if (st.hud) for (const r of st.hud) if (r.y < 40) { if (r.x + r.w / 2 < W / 2) gL = Math.max(gL, r.x + r.w); else gR = Math.min(gR, r.x); }
      let inGap = lay.wide && gR - gL >= 210, capX = inGap ? (gL + gR) / 2 : W / 2, capY = inGap ? 10 : top + 4, room = (inGap ? gR - gL - 16 : W - 16);
      if (scene.caption) {
        const size = (narrow ? 13 : 15) + up;
        let t = textSprite(scene.caption, size, dpr, { weight: 600, color: '#efe8d8' });
        // 틈에 다 들어가지 않으면 안내 아래로 내립니다. 그래도 길 때만 앞부분만 씁니다
        if (inGap && t.w > room) { inGap = false; capX = W / 2; capY = top + 4; room = W - 16; }
        if (t.w > room) t = textSprite(scene.caption.split(' · ')[0], size, dpr, { weight: 600, color: '#efe8d8' });
        putText(ctx, t, capX, capY, 0.5, 0, a);
        let hh = t.h, ww = t.w;
        if (scene.emptyNote) { const n = textSprite(scene.emptyNote, (narrow ? 11.5 : 12.5) + up, dpr, { color: C_MUTED }); putText(ctx, n, capX, capY + t.h - 1, 0.5, 0, a); hh += n.h; ww = Math.max(ww, n.w); }
        st.capRect = { x: capX - ww / 2, y: capY - 2, w: ww, h: hh + 2 };
      } else if (scene.emptyNote) putText(ctx, textSprite(scene.emptyNote, narrow ? 11.5 : 12.5, dpr, { color: C_MUTED }), capX, capY, 0.5, 0, a);
      const noteY = H - bottom - (narrow ? 2 : 6);
      if (narrow) putText(ctx, note, W / 2, noteY, 0.5, 1, a * 0.9);
      else putText(ctx, note, W - 10, noteY, 1, 1, a * 0.9);
      st.noteRect = narrow ? { x: W / 2 - note.w / 2, y: noteY - note.h, w: note.w, h: note.h } : { x: W - 10 - note.w, y: noteY - note.h, w: note.w, h: note.h };
      const stackB = narrow ? noteY - note.h - 1 : noteY - note.h - 2;
      // 정착지 목록
      const replayT = !cine && st.newest ? textSprite('충돌 다시 보기', narrow ? 11.5 : 12, dpr, { halo: false, color: C_TEXT }) : null;
      if (scene.settlements && scene.settlements.length) {
        const maxRows = clamp(Math.floor((H * 0.36 - 30) / 20), 2, 6);
        const list = scene.settlements, stripW = W - 16 - (replayT ? replayT.w + 38 : 0);
        let sig = dpr + '|' + maxRows + '|' + (narrow ? 'n' + stripW : 0) + '|' + up + '|' + (scene.listTitle || '');
        for (let i = 0; i < list.length; i++) sig += '|' + list[i].name + list[i].popText + (list[i].lost ? 'x' : '') + (list[i].first ? 'f' : '');
        if (!boxCache || boxCache.sig !== sig || boxCache.missing) boxCache = narrow ? phoneStrip(scene, dpr, stripW, sig) : listBox(scene, dpr, narrow, maxRows, sig, lay, up);
        const bx = narrow ? 8 : 10, by = narrow ? stackB - 25 : H - bottom - 8 - boxCache.h;
        ctx.globalAlpha = a; ctx.drawImage(boxCache.c, bx, by, boxCache.w, boxCache.h); ctx.globalAlpha = 1;
        st.boxRect = { x: bx, y: by, w: boxCache.w, h: boxCache.h };
        for (const r of boxCache.rows) st.rows.push({ id: r.id, x: bx, y: by + r.y, w: boxCache.w, h: r.h });
      }
      // 다시 보기 단추
      if (replayT) {
        const t = replayT, bw = t.w + 32, bh = narrow ? 28 : 30, bx = W - 8 - bw, by = btnY(st, lay, W, stackB - bh);
        rrect(ctx, bx + 0.5, by + 0.5, bw - 1, bh - 1, 15);
        ctx.globalAlpha = a; ctx.fillStyle = 'rgba(16,21,30,.82)'; ctx.fill();
        ctx.strokeStyle = 'rgba(241,203,134,.55)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.strokeStyle = C_BRASS; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(bx + 15, by + bh / 2, 4.6, -2.2, 2.4); ctx.stroke();
        ctx.fillStyle = C_BRASS; ctx.beginPath(); ctx.moveTo(bx + 10.6, by + bh / 2 - 5.4); ctx.lineTo(bx + 15.2, by + bh / 2 - 6.6); ctx.lineTo(bx + 13, by + bh / 2 - 2); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
        putText(ctx, t, bx + 24, by + bh / 2, 0, 0.5, a);
        st.btnReplay = { x: bx, y: by, w: bw, h: bh };
      }
    }
  }
  function btnY(st, lay, W, y) {
    if (lay.wide && st.hud) for (const r of st.hud) if (r.y < 40 && r.x + r.w / 2 > W / 2) return r.y + r.h + 8;
    return y;
  }
  function drawCineHud(ctx, st, lay, scene, W, H, dpr) {
    const c = st.cine;
    st.btnSkip = null;
    if (!c) return;
    const t = c.t, narrow = lay.narrow;
    // 건너뛰기
    const sk = textSprite('건너뛰기', narrow ? 11 : 11.5, dpr, { halo: false, color: C_MUTED }), bw = sk.w + 22, bh = 28, bx = W - 8 - bw, by = narrow ? lay.top + 6 : btnY(st, lay, W, H - lay.bottom - 8 - bh);
    const a0 = sst(0.05, 0.4, t - c.t0) * (1 - sst(T_END - 0.5, T_END - 0.1, t));
    if (a0 > 0.01) {
      ctx.globalAlpha = a0;
      rrect(ctx, bx + 0.5, by + 0.5, bw - 1, bh - 1, 14);
      ctx.fillStyle = 'rgba(12,16,24,.66)'; ctx.fill();
      ctx.strokeStyle = 'rgba(160,172,196,.35)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.globalAlpha = 1;
      putText(ctx, sk, bx + bw / 2, by + bh / 2, 0.5, 0.5, a0);
    }
    st.btnSkip = { x: bx, y: by, w: bw, h: bh };
    // 충돌 자막
    const a1 = sst(T_HIT + 0.1, T_HIT + 0.55, t) * (1 - sst(T_END - 0.75, T_END - 0.2, t));
    if (a1 > 0.01) {
      const size = (narrow ? 14 : 18) + fontUp(W) * 2;
      let t1 = textSprite(c.imp.title || '충돌', size, dpr, { weight: 700, color: '#fff3dc' });
      if (t1.w > W - 16) t1 = textSprite(c.imp.title || '충돌', size - 3, dpr, { weight: 700, color: '#fff3dc' });
      const yb = Math.min(H - lay.bottom - 6, lay.ccy + lay.Rc + (c.imp.sub ? 48 : 30)), sub = c.imp.sub ? textSprite(c.imp.sub, (narrow ? 11 : 13) + fontUp(W), dpr, { color: '#d7d9de' }) : null;
      const rise = (1 - sst(T_HIT + 0.1, T_HIT + 0.7, t)) * 8;
      if (sub) { putText(ctx, t1, W / 2, yb - sub.h + 2 + rise, 0.5, 1, a1); putText(ctx, sub, W / 2, yb + rise, 0.5, 1, a1); }
      else putText(ctx, t1, W / 2, yb + rise, 0.5, 1, a1);
    }
  }

  /* ---------- 전체 화면 ---------- */
  function ensureLayout(st, scene, W, H, safe, fromInset) {
    const top = (safe && safe.top) || 0, bottom = (safe && safe.bottom) || 0;
    // 궤도 크기는 안내 글이 한 줄 늘어도 들썩이지 않게 정해 둡니다. 넓은 화면은 고정, 그 밖에는 늘기만 합니다.
    let sT, sB;
    if (W >= WIDE_W) { sT = 44; sB = 46; }
    else {
      if (st.sizeKey !== W + 'x' + H) { st.sizeKey = W + 'x' + H; st.topMax = 0; st.botMax = 0; }
      // 작은 창은 궤도를 그리지 않습니다. 지도 화면의 안내 크기로 태양계 그림을 줄이면 안 됩니다
      if (!fromInset) { st.topMax = Math.max(st.topMax, top); st.botMax = Math.max(st.botMax, bottom); }
      sT = st.topMax; sB = st.botMax;
    }
    let L = st.lay;
    if (!L || L.key !== scene.key || L.W !== W || L.H !== H || L.sT !== sT || L.sB !== sB || L.n !== (scene.bodies || []).length) {
      L = st.lay = buildLayout(st, scene, W, H, sT, sB);
      st.labelPos = Object.create(null);
      st.labelOff = Object.create(null);
      st.ring = {};
    }
    if (fromInset) return L;
    L.top = top; L.bottom = bottom;
    st.hud = (safe && safe.hud) || null;
    return L;
  }
  function frameView(ctx, W, H, time, sim, mode, app) {
    const st = ensure(sim, mode), sp = mode.space, dpr = (app && app.dpr) || 1;
    const scene = sp.scene(sim);
    if (!scene) { ctx.fillStyle = '#05070b'; ctx.fillRect(0, 0, W, H); return; }
    work(8);
    const lay = ensureLayout(st, scene, W, H, app && app.safe);
    pollImpacts(st, sim, mode, scene);
    tick(st, time, app, lay, true, scene, sim);
    placeBodies(st, lay);
    const cam = camera(st, lay), c = st.cine, z = cam.z;
    st.insetBox = null;
    // 정착지 짝 맞추기, 새 정착지는 우주선으로
    for (let i = 0; i < lay.bodies.length; i++) lay.bodies[i].set = null;
    const list = scene.settlements || [];
    if (!st.known) { st.known = new Set(); for (const s of list) st.known.add(s.id); }
    for (const s of list) {
      const b = lay.byId[s.bodyId];
      if (b) b.set = s;
      if (!st.known.has(s.id)) { st.known.add(s.id); if (b && st.flights.length < 6) st.flights.push({ bodyId: s.bodyId, at: st.t }); }
    }
    // 화면 위치
    const B = lay.bodies, order = st.order;
    order.length = 0;
    for (let i = 0; i < B.length; i++) { const b = B[i]; b.sx = cam.ox + b.x * z; b.sy = cam.oy + b.y * z; b.sR = b.R * z; order.push(b); }
    order.sort((p, q) => p.z - q.z);
    if (c && lay.home && cam.e > 0) {
      for (let i = 0; i < B.length; i++) {
        const b = B[i];
        if (b.p !== lay.home) continue;
        const k = cam.e;
        b.sx = lerp(b.sx, cam.hx + c.moonX * Math.min(1.71 * lay.Rc, W / 2 - lay.Rc * 0.17 - 6), k); b.sy = lerp(b.sy, cam.hy - 0.43 * 1.9 * lay.Rc, k); b.sR = lerp(b.sR, lay.Rc * 0.17, k);
      }
    }
    const zn = c ? Math.log(Math.max(z, 1)) / Math.log(Math.max(c.zc, 1.01)) : 0;
    let panX = 0, panY = 0;
    if (c) { panX = -lay.home.x * 0.05 * zn + cam.shakeX * 0.4; panY = -lay.home.y * 0.05 * zn + cam.shakeY * 0.4; }
    drawSky(ctx, W, H, dpr, lay.skySeed, zn, panX, panY, true, c ? cam.zv : 0, st.t);
    const star = scene.star || { color: [255, 236, 200], glow: 1 };
    drawZodiac(ctx, lay, cam, star);
    drawOrbits(ctx, st, lay, scene, cam);
    drawBelt(ctx, st, lay, cam, W, H);
    if (c) strikeFrame(c, c.t);
    drawBodies(ctx, st, lay, scene, cam, W, H, dpr, 0);
    const sunX = cam.ox, sunY = cam.oy, sunR = lay.rSun * z;
    const sunVeil = 1 - sst(0.62, 0.95, zn), sunM = sunR * (sunVeil > 0 ? 18 : 1.2);
    if (sunX > -sunM && sunY > -sunM && sunX < W + sunM && sunY < H + sunM) drawSun(ctx, sunX, sunY, sunR, star, st.t, dpr, sunVeil);
    st.sunHit = z < 1.4 ? { x: sunX, y: sunY, r: sunR + 3 } : null;
    drawBodies(ctx, st, lay, scene, cam, W, H, dpr, 1);
    drawBombard(ctx, st, scene, lay, cam);
    const hudA = !c ? 1 : c.reduced ? 0 : c.t < T_PULL ? 1 - sst(c.t0, c.t0 + 0.55, c.t) : sst(T_PULL + 0.6, T_END, c.t);
    const lblA = !c ? 1 : c.reduced ? 0 : c.t < T_PULL ? 1 - sst(1.5, 1.95, c.t) : sst(T_PULL + 0.75, T_END, c.t);
    drawTraffic(ctx, st, scene, lay, cam);
    drawFlights(ctx, st, lay, cam);
    drawMarkers(ctx, st, lay, scene, cam, lblA);
    drawInterstellar(ctx, st, scene, lay, cam, W, H, dpr, lblA);
    // 소행성
    if (c && c.ti < 0) drawStrikerFull(ctx, st, lay, cam, c, W, H, dpr);
    if (c && c.ti >= 0 && lay.home) {
      const hb = lay.home;
      drawImpactFx(ctx, hb.sx, hb.sy, hb.sR, c, W, H, dpr, 1);
    }
    drawHud(ctx, st, lay, scene, W, H, dpr, hudA, !!c);
    drawLabels(ctx, st, lay, scene, cam, W, H, dpr, lblA);
    // 번쩍임과 페이드
    if (c) {
      if (c.ti > -0.06) drawFlash(ctx, c, lay.home.sx + lay.home.sR * c.S[0], lay.home.sy - lay.home.sR * c.S[1], W, H);
      if (c.reduced) {
        const dip = Math.max(1 - sst(c.t0, c.t0 + 0.4, c.t), sst(T_END - 0.7, T_END - 0.34, c.t) * (1 - sst(T_END - 0.3, T_END, c.t)));
        if (dip > 0.004) { ctx.fillStyle = `rgba(4,6,11,${dip.toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
      }
      drawCineHud(ctx, st, lay, scene, W, H, dpr);
    } else st.btnSkip = null;
    // 장면을 끊고 넘어갈 때 잠깐 어두워집니다. 카메라가 갑자기 옮겨 가는 것이 끊어진 장면처럼 보입니다
    if (st.dip != null) {
      const k = 1 - (st.t - st.dip) / 0.3;
      if (k > 0) { ctx.fillStyle = `rgba(4,6,11,${k.toFixed(3)})`; ctx.fillRect(0, 0, W, H); } else st.dip = null;
    }
  }
  function drawFlash(ctx, c, sx, sy, W, H) {
    const t0 = Math.max(0, c.ti), base = c.reduced ? 0.2 : lerp(0.6, 1, c.pow), f = base * Math.exp(-t0 * 7) * sst(-0.06, 0, c.ti);
    if (f <= 0.004) return;
    const rr = Math.max(W, H) * (0.62 + 0.8 * c.pow), g = glow(255, 244, 222, 1.5);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, f * 1.3); ctx.drawImage(g, sx - rr, sy - rr, rr * 2, rr * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const u = f * Math.exp(-t0 * 17);
    if (u > 0.01) { ctx.fillStyle = `rgba(255,252,244,${Math.min(1, u).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
  }
  function drawStrikerFull(ctx, st, lay, cam, c, W, H, dpr) {
    const t = c.t, Rc = lay.Rc, hx = cam.hx, hy = cam.hy;
    const heat = sst(3.0, T_HIT - 0.15, t), rNear = Rc * (0.04 + 0.05 * c.pow), rH = lerp(lerp(2.7, 4.3, c.pow), rNear, Math.pow(sst(1.7, T_HIT - 0.05, t), 1.5));
    const a = sst(0, 0.18, t);
    // 표적 표시
    if (t < 2.2 && lay.home) {
      const hb = lay.home, r = hb.sR + 9, A = (1 - sst(1.6, 2.2, t)) * sst(0.05, 0.5, t);
      ctx.globalAlpha = A * (0.6 + 0.4 * Math.sin(t * 9));
      ctx.strokeStyle = C_EMBER; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(hb.sx, hb.sy, r, 0, TAU); ctx.stroke();
      for (let k = 0; k < 4; k++) { const an = k * Math.PI / 2 + Math.PI / 4; ctx.beginPath(); ctx.moveTo(hb.sx + Math.cos(an) * r, hb.sy + Math.sin(an) * r); ctx.lineTo(hb.sx + Math.cos(an) * (r + 5), hb.sy + Math.sin(an) * (r + 5)); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = a;
    drawTrail(ctx, hx, hy, Rc, c, t, rH, Math.exp(closeE(c, t) * Math.log(c.zc)), true, lerp(Math.max(320, lay.rN * 1.25), Math.max(W, H) * 0.95, closeE(c, t)), dpr);
    strikeQ(c, t, qTmp);
    const x = hx + qTmp[0] * Rc, y = hy + qTmp[1] * Rc, qx = qTmp[0], qy = qTmp[1];
    strikeQ(c, Math.max(0, t - 0.03), qTmp);
    const vx = qx - qTmp[0], vy = qy - qTmp[1], vl = Math.hypot(vx, vy) || 1;
    drawHead(ctx, x, y, rH, heat, c, t, dpr, vx / vl, vy / vl);
    ctx.globalAlpha = 1;
    if (t < 2.1 && c.imp.title) {
      const L = textSprite(c.imp.title, (lay.narrow ? 11 : 12) + fontUp(W), dpr, { weight: 600, color: '#ffd9b0' }), A = sst(0.15, 0.5, t) * (1 - sst(1.65, 2.1, t));
      putText(ctx, L, clamp(x + 10, 4, W - L.w - 4), clamp(y - 8, lay.top + 2, H - L.h - 2), 0, 1, A);
    }
  }

  /* ---------- 작은 창 ---------- */
  let inCache = null;
  function insetCanvas(w, h, dpr) {
    const cw = Math.ceil(w * dpr), ch = Math.ceil(h * dpr);
    if (inCache && inCache.c.width === cw && inCache.c.height === ch) return inCache;
    const c = mk(cw, ch);
    return (inCache = { c, x: c.getContext('2d'), w, h });
  }
  function warmUp(st, sim, mode, W, H, dpr, app) {
    const key = W + '|' + H + '|' + dpr;
    if (st.warm === key) return;
    st.warm = key;
    const scene = mode.space.scene(sim);
    if (!scene) return;
    const lay = ensureLayout(st, scene, W, H, app && app.safe, true);
    skyFor(W, H, dpr, lay.skySeed);
    sunSprites((scene.star && scene.star.color) || [255, 236, 200]);
    for (const b of lay.bodies) {
      sprite(b.look, b.id);
      if (b.rings) ringSprites();
    }
    if (mode.space.prepare) need(sim, () => mode.space.prepare(sim));
    need('shade', function* () { for (const lz of SHADE_LZ) { shadeSprite(lz, 128); shadeSprite(lz, 48); yield; } });
  }
  function insetView(ctx, W, H, time, sim, mode, app) {
    const sp = mode.space;
    let st = states.get(sim);
    if (!st) st = ensure(sim, mode);
    const seq = seqOf(sim, mode), dpr = (app && app.dpr) || 1;
    warmUp(st, sim, mode, W, H, dpr, app);
    work(3); // 지도를 보는 동안 태양계 그림을 조금씩 미리 만들어 둡니다
    if (!st.cine && seq <= st.seq && !st.pending.length && !st.want) { st.lastT = time; st.insetBox = null; return; }
    const scene = sp.scene(sim);
    if (!scene || !scene.home) { st.lastT = time; if (seq > st.seq) st.seq = seq; return; }
    const lay = ensureLayout(st, scene, W, H, app && app.safe, true);
    pollImpacts(st, sim, mode, scene);
    placeBodies(st, lay);
    tick(st, time, app, lay, false, scene, sim);
    const c = st.cine;
    if (!c) { st.insetBox = null; return; }
    strikeFrame(c, c.t);
    // 자리와 크기
    const safe = (app && app.safe) || { top: 0, bottom: 0 }, phone = W < 520;
    const iw = phone ? Math.round(W * 0.46) : Math.round(Math.min(0.32 * W, 340)), ih = Math.round(iw * (phone ? 0.78 : 0.64));
    let bx = phone ? W - iw - 8 : 12;
    const by = phone ? (safe.top || 0) + 8 : H - (safe.bottom || 0) - 12 - ih;
    // 충돌 지점을 가리면 반대쪽 구석으로 옮깁니다 (장면마다 한 번 정함)
    if (c.flip == null) {
      let p = null;
      try { p = sp.site ? sp.site(sim, c.imp, W, H) : null; } catch (e) { p = null; }
      c.flip = !!p && p[0] > bx - 14 && p[0] < bx + iw + 14 && p[1] > by - 14 && p[1] < by + ih + 14;
    }
    if (c.flip) bx = phone ? 8 : W - iw - 12;
    const I = insetCanvas(iw, ih, dpr), x = I.x, t = c.t;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    // 배경
    const sky = skyFor(W, H, dpr, lay.skySeed);
    if (sky) { const sw = sky.c.width * 0.42, sh = sw * (ih / iw), s = sst(c.t0, T_HIT, t) * 0.04; x.drawImage(sky.c, sky.c.width * (0.3 - s), sky.c.height * (0.25 - s), sw, sh, 0, 0, iw, ih); }
    x.fillStyle = sky ? 'rgba(3,4,8,.46)' : '#05070b'; x.fillRect(0, 0, iw, ih);
    const Rf = ih * 0.37, R = lerp(ih * 0.27, Rf, sst(1.7, T_HIT - 0.4, t)) * (c.ti > 0 ? 1 + 0.05 * c.pow * Math.exp(-c.ti * 4.5) : 1);
    let cx = iw * 0.5, cy = ih * 0.47;
    if (c.ti > 0) { const amp = (0.6 + 3 * c.pow) * Math.exp(-c.ti * 3.2); cx += amp * Math.sin(c.ti * 63); cy += amp * Math.cos(c.ti * 53); }
    const hb = lay.home, tex = texFor(st, scene, true) || null;
    // 해 방향
    const fakeCam = { ox: 0, oy: 0 };
    const L = lightFor(fakeCam, hb.x, hb.y, 0.52), atm0 = atmOf(c, scene.home);
    if (atm0) {
      const A = atmoSprite(atm0), k = R * ATMO_K;
      x.globalCompositeOperation = 'lighter'; x.globalAlpha = c.ti > 0 ? Math.min(1, 0.85 + c.pow * Math.exp(-c.ti * 2)) : 0.85;
      rotDraw(x, A, cx, cy, k * 2, k * 2, Math.atan2(-L[1], L[0]), dpr);
      x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    }
    if (tex) {
      const extra = c.ti > 0 ? c.pow * 0.42 * sst(0.5, 2.6, c.ti) : 0;
      const P = globeParams(st, scene, c, L, c.ellNow, c.roll, c.pitch, tex, extra);
      drawGlobeAt(x, cx, cy, R, dpr, P, 160, c.roll, c.pitch);
    }
    if (c.ti < 0) {
      const heat = sst(2.9, T_HIT - 0.12, t), rH = lerp(1.6, Rf * (0.03 + 0.04 * c.pow), sst(1.8, T_HIT - 0.1, t));
      drawTrail(x, cx, cy, Rf, c, t, rH, 1, false, iw * 1.1, dpr);
      strikeQ(c, t, qTmp);
      const qx = qTmp[0], qy = qTmp[1];
      strikeQ(c, Math.max(0, t - 0.03), qTmp);
      const vl = Math.hypot(qx - qTmp[0], qy - qTmp[1]) || 1;
      drawHead(x, cx + qx * Rf, cy + qy * Rf, rH, heat, c, t, dpr, (qx - qTmp[0]) / vl, (qy - qTmp[1]) / vl);
    } else {
      drawImpactFx(x, cx, cy, R, c, iw, ih, dpr, 2);
      drawFlash(x, c, cx + R * c.S[0], cy - R * c.S[1], iw, ih);
    }
    // 글자
    const cap = textSprite('충돌 장면 · 크게 보기', phone ? 10.5 : 11.5, dpr, { halo: false, color: '#f3ead6' });
    x.fillStyle = 'rgba(6,8,13,.66)'; x.fillRect(0, ih - cap.h - 4, iw, cap.h + 4);
    putText(x, cap, iw / 2, ih - 2, 0.5, 1, 1);
    if (c.ti > 0.1 && c.imp.title) {
      const a = sst(0.1, 0.45, c.ti);
      putText(x, textSprite(c.imp.title, phone ? 10.5 : 12, dpr, { weight: 700, color: '#fff3dc' }), iw / 2, 4, 0.5, 0, a);
    }
    // 본 화면에 붙이기
    const al = sst(c.t0, c.t0 + 0.3, t) * (1 - sst(T_END - 0.6, T_END - 0.05, t));
    ctx.save();
    ctx.globalAlpha = al * 0.5; ctx.fillStyle = '#000'; rrect(ctx, bx - 3, by - 2, iw + 6, ih + 7, 12); ctx.fill();
    ctx.globalAlpha = al;
    rrect(ctx, bx, by, iw, ih, 10);
    ctx.save(); ctx.clip();
    ctx.drawImage(I.c, bx, by, iw, ih);
    ctx.restore();
    ctx.strokeStyle = 'rgba(241,203,134,.75)'; ctx.lineWidth = 1.2; rrect(ctx, bx, by, iw, ih, 10); ctx.stroke();
    ctx.restore();
    st.insetBox = { x: bx, y: by, w: iw, h: ih };
  }

  /* ---------- 공개 ---------- */
  const inR = (r, x, y) => r && x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
  WS.SpaceView = {
    frame: frameView,
    inset: insetView,
    hit(sim, mode, x, y, W, H, app) {
      const st = states.get(sim);
      if (!st || !mode || !mode.space) return null;
      const inSolar = app && app.view === mode.space.view;
      if (!inSolar) return st.cine && inR(st.insetBox, x, y) ? { kind: 'inset' } : null;
      if (st.cine) return { kind: 'skip' };
      if (inR(st.btnReplay, x, y)) return { kind: 'replay' };
      for (const r of st.rows) if (inR(r, x, y)) { st.hover = r.id; st.hoverT = st.t; return { kind: 'body', id: r.id }; }
      const lay = st.lay;
      if (!lay) return null;
      let best = null, bd = 1e9;
      for (const b of lay.bodies) {
        const settled = !!b.set, reach = Math.max(b.sR + (b.rings ? b.sR * 1.1 : 6), 14), d = Math.hypot(b.sx - x, b.sy - y);
        if (d <= reach && d - (b.moon && !settled ? 3 : 0) < bd) { bd = d - (b.moon && !settled ? 3 : 0); best = b; }
      }
      if (best) { st.hover = best.id; st.hoverT = st.t; return { kind: 'body', id: best.id }; }
      if (st.sunHit && Math.hypot(st.sunHit.x - x, st.sunHit.y - y) <= Math.max(st.sunHit.r + 6, 14)) return { kind: 'body', id: 'sun' };
      return null;
    },
    replay(sim) {
      const st = states.get(sim);
      if (!st || !st.newest) return false;
      st.cine = null; st.pending = st.pending.filter((p) => p.user); st.want = true;
      return true;
    },
    skip(sim) {
      const st = states.get(sim);
      if (!st || !st.cine) return false;
      endCine(st);
      st.pending = st.pending.filter((p) => p.user); // 건너뛰어도 관찰자가 떨어뜨린 운석은 보여 줍니다
      return true;
    },
    active(sim) { const st = states.get(sim); return !!(st && st.cine); },
  };
})();
