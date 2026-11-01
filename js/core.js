'use strict';
/* 창세 관측소 — 공통 엔진: 난수, 노이즈, FFT, 포맷, 시뮬레이션 기반 클래스 */
(function () {
  const WS = (window.WS = window.WS || {});
  WS.modes = {};
  WS.registerMode = (def) => { WS.modes[def.id] = def; };

  /* ---------- 난수 (mulberry32) ---------- */
  class RNG {
    constructor(seed) { this.s = (seed >>> 0) || 1; }
    next() {
      let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    range(a, b) { return a + (b - a) * this.next(); }
    int(a, b) { return a + Math.floor((b - a + 1) * this.next()); }
    chance(p) { return this.next() < p; }
    pick(a) { return a[Math.floor(this.next() * a.length)]; }
    normal() {
      let u = 0;
      while (u === 0) u = this.next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
    }
    logRange(a, b) { return Math.exp(this.range(Math.log(a), Math.log(b))); }
    poisson(l) {
      if (l <= 0) return 0;
      if (l > 30) return Math.max(0, Math.round(l + Math.sqrt(l) * this.normal()));
      const L = Math.exp(-l);
      let k = 0, p = 1;
      do { k++; p *= this.next(); } while (p > L);
      return k - 1;
    }
    weighted(items, w) {
      let total = 0;
      for (const it of items) total += Math.max(0, w(it));
      if (total <= 0) return null;
      let r = this.next() * total;
      for (const it of items) { r -= Math.max(0, w(it)); if (r <= 0) return it; }
      return items[items.length - 1];
    }
  }
  WS.RNG = RNG;
  WS.randomSeed = () => (Math.floor(Math.random() * 1e9) + 1) >>> 0;

  /* ---------- 3D 펄린 노이즈 ---------- */
  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a, b, t) { return a + t * (b - a); }
  function grad(h, x, y, z) {
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }
  class Noise {
    constructor(seed) {
      const r = new RNG(seed ^ 0x9e3779b9);
      const p = new Uint8Array(256);
      for (let i = 0; i < 256; i++) p[i] = i;
      for (let i = 255; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
      this.P = new Uint8Array(512);
      for (let i = 0; i < 512; i++) this.P[i] = p[i & 255];
    }
    n3(x, y, z) {
      const P = this.P;
      let X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
      x -= X; y -= Y; z -= Z; X &= 255; Y &= 255; Z &= 255;
      const u = fade(x), v = fade(y), w = fade(z);
      const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z, B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
      return lerp(
        lerp(lerp(grad(P[AA] & 15, x, y, z), grad(P[BA] & 15, x - 1, y, z), u),
          lerp(grad(P[AB] & 15, x, y - 1, z), grad(P[BB] & 15, x - 1, y - 1, z), u), v),
        lerp(lerp(grad(P[AA + 1] & 15, x, y, z - 1), grad(P[BA + 1] & 15, x - 1, y, z - 1), u),
          lerp(grad(P[AB + 1] & 15, x, y - 1, z - 1), grad(P[BB + 1] & 15, x - 1, y - 1, z - 1), u), v), w);
    }
    fbm(x, y, z, oct, lac, gain) {
      oct = oct || 4; lac = lac || 2; gain = gain || 0.5;
      let a = 1, f = 1, s = 0, n = 0;
      for (let i = 0; i < oct; i++) { s += a * this.n3(x * f, y * f, z * f); n += a; a *= gain; f *= lac; }
      return s / n;
    }
  }
  WS.Noise = Noise;

  /* ---------- FFT (radix-2, 제자리) ---------- */
  WS.fft = function (re, im, inv) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (2 * Math.PI / len) * (inv ? 1 : -1);
      const wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let j = 0; j < half; j++) {
          const a = i + j, b = a + half;
          const br = re[b] * cr - im[b] * ci, bi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - br; im[b] = im[a] - bi;
          re[a] += br; im[a] += bi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
    if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  };
  const fftTmp = {};
  WS.fft2 = function (re, im, n, inv) {
    if (!fftTmp[n]) fftTmp[n] = [new Float64Array(n), new Float64Array(n)];
    const [tr, ti] = fftTmp[n];
    for (let y = 0; y < n; y++) {
      const o = y * n;
      for (let x = 0; x < n; x++) { tr[x] = re[o + x]; ti[x] = im[o + x]; }
      WS.fft(tr, ti, inv);
      for (let x = 0; x < n; x++) { re[o + x] = tr[x]; im[o + x] = ti[x]; }
    }
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) { tr[y] = re[y * n + x]; ti[y] = im[y * n + x]; }
      WS.fft(tr, ti, inv);
      for (let y = 0; y < n; y++) { re[y * n + x] = tr[y]; im[y * n + x] = ti[y]; }
    }
  };

  /* ---------- 표기 ---------- */
  function trimNum(v) {
    if (v >= 100) return Math.round(v).toLocaleString('ko-KR');
    if (v >= 10) return v.toFixed(1).replace(/\.0$/, '');
    return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }
  WS.trimNum = trimNum;
  WS.fmtYears = function (y) {
    const a = Math.abs(y);
    if (a >= 1e12) return trimNum(a / 1e12) + '조 년';
    if (a >= 1e8) return trimNum(a / 1e8) + '억 년';
    if (a >= 1e4) return trimNum(a / 1e4) + '만 년';
    if (a >= 10) return Math.round(a).toLocaleString('ko-KR') + '년';
    return trimNum(a) + '년';
  };
  WS.fmtCount = function (n, unit) {
    unit = unit || '';
    const a = Math.abs(n);
    let s;
    if (a >= 1e12) s = trimNum(a / 1e12) + '조';
    else if (a >= 1e8) s = trimNum(a / 1e8) + '억';
    else if (a >= 1e4) s = trimNum(a / 1e4) + '만';
    else s = Math.round(a).toLocaleString('ko-KR');
    return (n < 0 ? '-' : '') + s + unit;
  };
  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  WS.sup = (n) => String(n).split('').map((c) => SUP[c] || c).join('');
  WS.fmtSeconds = function (s) {
    if (s < 1e-3) return '10' + WS.sup(Math.round(Math.log10(s))) + '초';
    if (s < 60) return trimNum(s) + '초';
    if (s < 3600) return trimNum(s / 60) + '분';
    if (s < 86400 * 2) return trimNum(s / 3600) + '시간';
    if (s < 3.156e7) return trimNum(s / 86400) + '일';
    return WS.fmtYears(s / 3.156e7);
  };
  WS.fmtCalendar = function (y) {
    y = Math.round(y);
    if (y <= 0) return '기원전 ' + (1 - y).toLocaleString('ko-KR') + '년';
    return '서기 ' + y + '년';
  };
  WS.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  WS.lerp = lerp;
  WS.smooth = (e0, e1, x) => { const t = WS.clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  WS.rgb = (c, a) => (a === undefined ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);
  WS.mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  WS.hsl2rgb = function (h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    const f = (n) => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
    return [f(0), f(8), f(4)];
  };
  /* 0..1 값을 여러 색 정지점으로 보간 */
  WS.ramp = function (stops, t) {
    t = WS.clamp(t, 0, 1) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(t));
    return WS.mix(stops[i], stops[i + 1], t - i);
  };

  /* ---------- 시뮬레이션 기반 ---------- */
  // headless 모드에서도 남기는 중요한 기록 종류 (실험실 연대기용)
  const KEEP_HEADLESS = { milestone: 1, disaster: 1, end: 1, god: 1 };
  class SimBase {
    constructor(seed, opts) {
      this.seed = seed >>> 0;
      this.opts = opts || {};
      this.headless = !!this.opts.headless; // 화면 작업만 생략 (난수 소비·해상도는 그대로)
      this.lite = !!this.opts.lite;         // 빠른 실행용 낮은 해상도
      this.cond = Object.assign({}, this.opts.cond || {});
      this.rng = new RNG(this.seed);
      // 개입 전용 난수: 개입이 주 난수 흐름을 밀어내지 않도록 따로 둡니다 (WS.intervene이 교체)
      this.irng = new RNG((this.seed ^ 0x5bd1e995) >>> 0 || 7);
      this.godActs = 0;
      this.events = [];
      this.eventSeq = 0;
      this.reached = {};
      this.history = [];
      this.fx = [];
      this.ended = false;
      this.steps = 0;
      this.outcome = null;
    }
    timeLabel() { return ''; }
    timeValue() { return 0; }
    log(text, kind) {
      kind = kind || 'info';
      const e = { id: ++this.eventSeq, time: this.timeLabel(), v: this.timeValue(), text, kind };
      if (!this.headless) {
        this.events.push(e);
        if (this.events.length > 400) this.events.shift();
      } else if (KEEP_HEADLESS[kind]) {
        this.events.push(e);
        if (this.events.length > 160) {
          // 가장 오래된 재난 기록부터 버려 이정표가 남도록 합니다
          const i = this.events.findIndex((x) => x.kind === 'disaster');
          this.events.splice(i >= 0 ? i : 0, 1);
        }
      }
      return e;
    }
    reach(id, text) {
      if (this.reached[id]) return false;
      this.reached[id] = { v: this.timeValue(), label: this.timeLabel() };
      this.log(text, 'milestone');
      return true;
    }
    end(title, text, outcome) {
      if (this.ended) return;
      this.ended = true;
      this.endTitle = title;
      this.endText = text;
      this.outcome = outcome || title;
      this.log(title + ' — ' + text, 'end');
    }
    addFx(f) { if (!this.headless) { f.max = f.life; this.fx.push(f); } }
  }
  WS.SimBase = SimBase;

  /* 시작 조건 읽기: sim.cond[key]가 유한한 수이면 그 값, 아니면 기본값 */
  WS.cond = function (sim, key, def) {
    const c = sim && sim.cond ? sim.cond[key] : undefined;
    return typeof c === 'number' && isFinite(c) ? c : def;
  };

  /* 관찰자의 개입. 개입 중에는 sim.rng를 sim.irng로 바꿔 끼워 주 난수 흐름이 밀리지 않게 합니다.
     → 메시지 문자열, 적용할 수 없으면 false */
  WS.intervene = function (mode, sim, ivOrId, w) {
    if (!mode || !sim || sim.ended) return false;
    const iv = typeof ivOrId === 'string' ? (mode.interventions || []).find((x) => x.id === ivOrId) : ivOrId;
    if (!iv || typeof iv.apply !== 'function') return false;
    if (iv.available && !iv.available(sim)) return false;
    if (!sim.irng) sim.irng = new RNG((sim.seed ^ 0x5bd1e995) >>> 0 || 7);
    const main = sim.rng;
    let msg;
    sim.rng = sim.irng;
    try {
      msg = iv.apply(sim, w);
    } finally {
      sim.irng = sim.rng; // 진행된 개입 난수를 그대로 보관
      sim.rng = main;
    }
    if (msg === false) return false;
    const text = typeof msg === 'string' && msg ? msg : iv.name;
    sim.godActs = (sim.godActs || 0) + 1;
    sim.log('관찰자의 개입 · ' + text, 'god');
    return text;
  };

  /* 효과(섬광·고리) 공통 그리기: toScreen(x,y) → [sx, sy, 단위 배율] */
  WS.drawFx = function (ctx, sim, toScreen) {
    for (const f of sim.fx) {
      const p = toScreen(f.x, f.y);
      if (!p) continue;
      const k = 1 - f.life / f.max; // 0 → 1 진행
      const a = Math.max(0, f.life / f.max);
      const col = f.color || [255, 230, 180];
      if (f.type === 'ring') {
        ctx.strokeStyle = WS.rgb(col, a * 0.9);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p[0], p[1], Math.max(1, (f.r0 || 2) + (f.r * p[2] - (f.r0 || 2)) * k), 0, Math.PI * 2);
        ctx.stroke();
      } else if (f.type === 'flash') {
        const r = Math.max(2, f.r * p[2] * (0.4 + k * 0.6));
        const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
        g.addColorStop(0, WS.rgb(col, a));
        g.addColorStop(1, WS.rgb(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill();
      } else if (f.type === 'bolt') {
        if (!f.path) {
          f.path = [];
          let x = 0, y = -60;
          f.path.push([x, y]);
          while (y < 0) { y += 8 + Math.random() * 10; x += (Math.random() - 0.5) * 16; f.path.push([x, Math.min(0, y)]); }
        }
        ctx.strokeStyle = WS.rgb([230, 240, 255], a);
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        f.path.forEach((q, i) => (i ? ctx.lineTo(p[0] + q[0], p[1] + q[1]) : ctx.moveTo(p[0] + q[0], p[1] + q[1])));
        ctx.stroke();
        const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], 26);
        g.addColorStop(0, WS.rgb([200, 220, 255], a * 0.7));
        g.addColorStop(1, WS.rgb([200, 220, 255], 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p[0], p[1], 26, 0, Math.PI * 2); ctx.fill();
      }
    }
  };

  /* 정방형 그리드 이름 생성기 (외계 종·나라 이름) */
  WS.makeName = function (rng, kind) {
    const A = ['아', '카', '타', '로', '미', '세', '바', '도', '리', '네', '수', '오', '하', '젠', '키', '루', '벨', '마', '사', '이', '란', '테', '코', '노', '페', '시', '우', '라', '엘', '보'];
    const B = ['르', '나', '스', '안', '렌', '디', '모', '탄', '린', '고', '베', '아', '토', '샤', '드', '칸', '레', '니', '온', '바'];
    const n = rng.int(2, 3);
    let s = rng.pick(A);
    for (let i = 1; i < n; i++) s += rng.pick(B);
    if (kind === 'latin') {
      const L1 = ['Proto', 'Neo', 'Eo', 'Archae', 'Thalasso', 'Litho', 'Myco', 'Cyano', 'Ptero', 'Mega', 'Micro', 'Ortho', 'Pseudo', 'Hydro', 'Xeno', 'Paleo', 'Chloro', 'Necto', 'Cteno', 'Lepido'];
      const L2 = ['bion', 'phyta', 'zoon', 'morpha', 'cytes', 'pod', 'saurus', 'therium', 'phagus', 'cyclus', 'derma', 'gnathus', 'pteris', 'lithus', 'nema', 'coccus', 'cerus', 'odon'];
      const L3 = ['primus', 'vulgaris', 'gigas', 'minor', 'aurea', 'nova', 'borealis', 'australis', 'marinus', 'terrestris', 'rapax', 'sapiens', 'velox', 'profunda', 'lucida', 'antiquus'];
      return rng.pick(L1) + rng.pick(L2) + ' ' + rng.pick(L3);
    }
    return s;
  };

  /* ---------- 아이콘 ---------- */
  WS.icons = {
    bolt: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z"/>',
    meteor: '<circle cx="8" cy="16" r="4"/><path d="M11 13 20 4M8.5 10.5 14 5M13.5 15.5 19 10"/>',
    volcano: '<path d="M2.5 21h19l-6-10h-7z"/><path d="M10 7.5c0-2 2-2 2-4.5M14 7.5c0-1.5 1.5-1.5 1.5-3.5"/>',
    wave: '<path d="M3 13a9 9 0 0 1 18 0M6.5 13a5.5 5.5 0 0 1 11 0M10 13a2 2 0 0 1 4 0"/>',
    nova: '<circle cx="12" cy="12" r="2.5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5 19 19M19 5l-3.5 3.5M8.5 15.5 5 19"/>',
    ripple: '<circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="6" stroke-dasharray="2 3"/><circle cx="12" cy="12" r="10" stroke-dasharray="1 4"/>',
    hole: '<circle cx="12" cy="12" r="3.5"/><ellipse cx="12" cy="12" rx="10" ry="3.5"/>',
    comet: '<circle cx="16" cy="8" r="3"/><path d="M13.5 10.5 3 21M12 8.5 5 15.5M15.5 12 9 18.5"/>',
    star: '<circle cx="15" cy="9" r="4"/><path d="M3 20l7-7M3 15l4-4M8 21l4-4"/>',
    dna: '<path d="M7 2c0 6 10 7 10 10s-10 4-10 10M17 2c0 6-10 7-10 10s10 4 10 10M8.5 6h7M8.5 18h7"/>',
    plague: '<circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5 19 19M19 5l-2.5 2.5M7.5 16.5 5 19"/><circle cx="12" cy="2" r=".6"/><circle cx="12" cy="22" r=".6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>',
    drought: '<path d="M2.5 12h19M8 12l-2.5 7M15 12l2 6M11.5 12l.5 4-1.5 3"/><path d="M12 3c2 2.5 3 4 3 5.5a3 3 0 0 1-6 0C9 7 10 5.5 12 3z"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/>',
    snow: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 2 3-2M9 20l3-2 3 2"/>',
    seed: '<path d="M12 21c0-6 0-9 0-12"/><path d="M12 12c-4 0-7-3-7-7 4 0 7 3 7 7zM12 9c3 0 6-2 6-6-3 0-6 2-6 6z"/>',
    play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
    pause: '<path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" fill="currentColor"/>',
    reroll: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
    arrow: '<path d="M4 12h15M13 6l6 6-6 6"/>',
    back: '<path d="M20 12H5M11 6l-6 6 6 6"/>',
    flask: '<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7 15h10"/>',
    butterfly: '<path d="M12 7v12"/><path d="M12 9C10 5 4.5 3 3.5 5.5S5 11.5 11 11.5M12 9c2-4 7.5-6 8.5-3.5S19 11.5 13 11.5"/><path d="M11 12.5c-4 0-6 1.5-5.5 3.5s3.5 2 5.5-1.5M13 12.5c4 0 6 1.5 5.5 3.5s-3.5 2-5.5-1.5"/><path d="M12 7 10.5 4.5M12 7l1.5-2.5"/>',
    chart: '<path d="M3.5 3.5v17h17"/><path d="M7 15l4-5 3.5 3 5-7"/>',
    branch: '<circle cx="6" cy="5.5" r="2"/><circle cx="6" cy="18.5" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7.5v9M18 10c0 4-6 3.5-11 7"/>',
    scale: '<path d="M12 3.5v17M7 20.5h10M4.5 7h15M12 4.5 4.5 7M12 4.5 19.5 7"/><path d="M4.5 7 2 13a2.5 2.5 0 0 0 5 0zM19.5 7 17 13a2.5 2.5 0 0 0 5 0z"/>',
    question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.2-2.5 4"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r=".6" fill="currentColor"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/>',
    leaf: '<path d="M5 19C4 11 9 5 20 4c-.5 10-6 15.5-15 15z"/><path d="M5 19c3-5 6-8 10-10"/>',
    paw: '<ellipse cx="12" cy="16" rx="4" ry="3.5"/><circle cx="6" cy="10.5" r="1.8"/><circle cx="18" cy="10.5" r="1.8"/><circle cx="9.3" cy="6.5" r="1.8"/><circle cx="14.7" cy="6.5" r="1.8"/>',
    rocket: '<path d="M12 2.5c3 2.2 4.5 5.5 4.5 9.5l-2 4h-5l-2-4c0-4 1.5-7.3 4.5-9.5z"/><circle cx="12" cy="9.5" r="1.6"/><path d="M7.5 12 4.5 15v3l3-1.5M16.5 12l3 3v3l-3-1.5M10.5 18.5 12 21.5l1.5-3"/>',
    atom: '<circle cx="12" cy="12" r="1.5" fill="currentColor"/><ellipse cx="12" cy="12" rx="9.5" ry="3.8"/><ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(120 12 12)"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6"/><path d="M15.5 4.9a3.2 3.2 0 0 1 0 6.2M17.5 14.3c2 .8 3.5 2.8 3.5 5.7"/>',
    thermo: '<path d="M10 4.5a2 2 0 0 1 4 0v9.3a4 4 0 1 1-4 0z"/><path d="M12 9v7.5"/><circle cx="12" cy="17.2" r="1.3" fill="currentColor"/>',
    book: '<path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/><path d="M11 4c.6.6 1.4.6 2 0M11 20c.6-.6 1.4-.6 2 0"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  };
  WS.icon = (name, cls) => `<svg class="ico ${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${WS.icons[name] || ''}</svg>`;
})();
