'use strict';
/* 창세 관측소 — 다중 세계 실험실: 네 가지 질문(미래 · 수렴 · 개입 · 조건)에 여러 세계를 돌려 답합니다.
   계산은 js/labcore.js (WS.LabCore), 화면은 이 파일. <section id="lab">을 채웁니다. */
(function () {
  const WS = window.WS;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fin = Number.isFinite;
  const LC = () => WS.LabCore;
  const Ex = (id) => LC().exp(WS.modes[id]);
  const short = (s) => String(s).replace(/^서기\s*/, '');
  // 시작 표기: 로그 축의 첫 표본(1만 년 등)이나 0년은 실제 출발점이 아니므로 '처음'이라고 씁니다
  const startTxt = (X, x0) => (X.axis === 'log' || x0 === 0 ? '처음' : short(X.xfmt(x0)));
  const noParen = (t) => String(t).replace(/\s*\(.*\)\s*$/, '');
  const ORDER = ['universe', 'stellar', 'life', 'civ'];
  const STAGE_ICON = { universe: 'atom', stellar: 'sun', life: 'leaf', civ: 'users' };
  const CA = '#d8a85b', CB = '#84c6d2'; // A(또는 개입 안 함) = 황동, B(또는 개입함) = 청록
  const NS = [10, 20, 40, 100];
  const DEF_N = { civ: 40, universe: 20, stellar: 20, life: 20 };
  // 기본 기간 세계 하나의 대략적인 계산 시간(ms). 문명은 시작 시점마다 크게 다릅니다. 한 번 돌리면 실제 값으로 보정됩니다.
  const COST = { civ: 600, universe: 700, stellar: 1800, life: 2400 };
  const COST_CIV = { ad2026: 350, ad1900: 350, ad1500: 500, ad1: 1300, bc3000: 1600, bc10000: 1900 };
  const STORE = 'ws.lab.v1', CAL = 'ws.lab.cal.v1';
  const SEED_STEP = 7919;
  // Q3 기본 개입 시점의 하한 (그 뒤에도 개입이 가능할 때만): 항성계는 원반 단계(약 100만 년 이후)에서 작은 흔들림이 의미가 있음
  const MIN_AT = { stellar: 1e6 };
  // 개입 가능 시점을 찾을 때 살펴볼 위치 (기간 안의 비율, 축 기준)
  const PROBE_FR = [0.03, 0.06, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  // 개입별 기본값: 생명 단계의 번개는 생명이 생긴 뒤에는 육지의 생물에게만 효과가 있습니다
  const IV_DEF = { life: { bolt: { target: 'land', at: 4.2e9, note: '생명이 생긴 뒤의 번개는 육지의 생물에게만 효과가 있어서, 처음 값은 육지에 생물이 자리 잡은 때와 무작위 육지로 골랐습니다.' } } };
  const RR_EX = { civ: '사고·만남·날씨', life: '돌연변이·소행성·기후 변화', stellar: '천체가 부딪치는 각도와 속도', universe: '별과 은하가 생기는 곳과 때' };
  const REROLL_TXT = {
    on: ['함께 바뀜 (나비 효과)', (id) => `실제 세상처럼, 개입이 만든 작은 차이가 그 뒤의 모든 우연${RR_EX[id] ? `(${RR_EX[id]})` : ''}을 바꿉니다.`],
    off: ['그대로 (같은 주사위)', () => '두 세계가 개입 뒤에도 같은 우연을 겪습니다. 세계 스스로가 차이를 키우는지 지우는지만 봅니다.'],
  };
  const QS = [
    { q: 1, icon: 'globe', tag: '미래', title: '지금부터 인류의 미래는?', sub: '2026년의 지구에서 출발해 미래를 여러 번 돌려 봅니다.',
      steps: ['지금의 지구(인구 · 나라 · 기술 · 기후)에서 출발합니다.', '씨앗(우연의 흐름)만 바꾼 세계를 여러 개, 정한 해까지 돌립니다.', '세계들이 어떤 미래에 이르렀는지, 어떤 사건이 얼마나 자주 일어났는지 모아 봅니다.'] },
    { q: 2, icon: 'branch', tag: '수렴', title: '다시 돌려도 같은 역사가 될까?', sub: '같은 출발점에서 우연만 바꿔 여러 번 돌리고, 결과가 모이는지 흩어지는지 봅니다.',
      steps: ['같은 출발점에서 씨앗만 바꾼 세계를 여러 개 돌립니다.', '같은 시점마다 세계들이 서로 얼마나 다른지 잽니다.', '그 차이가 시간이 갈수록 커지는지(발산) 줄어드는지(수렴), 결말이 한곳에 모이는지 봅니다.'] },
    { q: 3, icon: 'butterfly', tag: '개입', title: '개입해도 미래는 같은 곳으로 갈까?', sub: '쌍둥이 세계를 만들어 한쪽에만 개입하고, 둘이 얼마나 달라지는지 비교합니다.',
      steps: ['같은 씨앗으로 쌍둥이 세계를 만듭니다. 개입 전까지 두 세계는 완전히 같습니다.', '정한 때에 한쪽 세계에만 개입합니다. 나비의 날갯짓처럼 아주 작은 것도 됩니다. 기본으로는 실제 세상처럼 개입 뒤의 우연(주사위)도 함께 바뀝니다.', '구체적인 역사가 얼마나 갈라지는지, 그리고 결말의 확률과 큰 지표(큰 흐름)까지 바뀌는지 따로 봅니다.'] },
    { q: 4, icon: 'scale', tag: '조건', title: '조건이 다르면 무엇이 달라질까?', sub: '시작 조건을 바꾼 두 무리의 세계를 나란히 돌려 비교합니다.',
      steps: ['A와 B, 두 가지 시작 조건을 정합니다.', '각 조건으로 같은 수의 세계를 같은 씨앗들로 돌립니다.', '결말 · 지표 · 사건이 어떻게 달라지는지, 그 차이가 우연인지 함께 봅니다.'] },
  ];
  const QDEF = { 1: { modeId: 'civ', setup: { start: 'ad2026' } }, 2: { modeId: 'civ', setup: { start: 'ad1500' } }, 3: { modeId: 'civ', setup: { start: 'ad2026' } }, 4: { modeId: 'civ', setup: { start: 'ad2026' } } };

  const lsGet = (k) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v && typeof v === 'object' ? v : null; } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가: 무시 */ } };
  const mmss = (ms) => { if (!fin(ms)) return '—'; if (ms < 950) return '1초 미만'; const s = Math.max(1, Math.round(ms / 1000)); if (s < 60) return s + '초'; const m = Math.floor(s / 60); return m + '분' + (s % 60 ? ' ' + (s % 60) + '초' : ''); };
  const pct = (p) => (fin(p) ? Math.round(p * 100) + '%' : '—');
  const pfmt = (p) => (!fin(p) ? '—' : p < 0.001 ? 'p < 0.001' : 'p = ' + (p < 0.01 ? p.toFixed(3) : p.toFixed(2)));
  const axisFrac = (axis, x0, x, x1) => (axis === 'log' && x0 > 0 ? Math.log(x / x0) / Math.log(x1 / x0) : (x - x0) / (x1 - x0));
  const axisAt = (axis, x0, x1, f) => (axis === 'log' && x0 > 0 ? x0 * Math.pow(x1 / x0, f) : x0 + f * (x1 - x0));
  // 개입 시점을 보기 좋은 값으로 (로그 축: 유효숫자 2자리, 긴 선형 축: 정수)
  const niceAt = (axis, x0, x1, at) => (axis === 'log' ? +at.toPrecision(2) : x1 - x0 >= 50 ? Math.round(at) : at);
  // 로그(1+x)처럼 그린 지표는 눈금을 x의 둥근 값에 둡니다 (fmt(1000)이 '999…'면 1만큼 밀림)
  const tickShift = (m) => { if (fin(m.tickShift)) return m.tickShift; if (!m.log || !m.fmt) return 0; try { return /9{2,}/.test(String(m.fmt(1000))) && !/9{2,}/.test(String(m.fmt(1001))) ? 1 : 0; } catch (e) { return 0; } };

  /* =====================================================================
     차트 (캔버스, DPR 대응, 마우스를 올리면 값 표시)
     ===================================================================== */
  const charts = new Set();
  let ro = null, roQueued = new Set(), roRaf = 0, FONT = 'sans-serif';
  function ensureRO() {
    if (ro || typeof ResizeObserver === 'undefined') return;
    ro = new ResizeObserver((ents) => {
      ents.forEach((e) => roQueued.add(e.target._ch));
      if (!roRaf) roRaf = requestAnimationFrame(() => { roRaf = 0; roQueued.forEach((ch) => ch && charts.has(ch) && draw(ch)); roQueued.clear(); });
    });
  }
  function resetCharts() { if (ro) ro.disconnect(); charts.clear(); }
  function niceStep(range, n) { const raw = range / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
  function ticks(lo, hi, n, minStep) {
    if (!(hi > lo)) return [lo];
    const s = Math.max(niceStep(hi - lo, n), minStep || 0), out = [];
    const dec = Math.max(0, Math.min(12, -Math.floor(Math.log10(s)) + 1));
    const i0 = Math.ceil(lo / s - 1e-9), i1 = Math.floor(hi / s + 1e-9);
    for (let i = i0; i <= i1; i++) { const v = +(i * s).toFixed(dec); out.push(Math.abs(v) < s * 1e-9 ? 0 : v); }
    return out;
  }
  function logTicks(lo, hi, n, shift) {
    // shift: 지표가 log(값 + shift)로 그려질 때 (예: 지구 밖 인구 = 1 + 사람 수) 눈금을 '사람 수'의 둥근 값에 둡니다
    if (shift > 0) {
      const v0 = Math.pow(10, lo) - shift, v1 = Math.pow(10, hi) - shift;
      if (!(v1 > 0)) return [];
      const l0 = Math.log10(Math.max(v0, 1)), l1 = Math.log10(v1);
      return (l1 > l0 ? logTicks(l0, l1, n) : [l0]).map((u) => Math.log10(Math.pow(10, u) + shift));
    }
    const a = Math.ceil(lo - 1e-9), b = Math.floor(hi + 1e-9);
    // 한 자릿수(10배) 안쪽이면 값 공간에서 보기 좋은 눈금
    if (hi - lo < 1.3) return ticks(Math.pow(10, lo), Math.pow(10, hi), Math.max(2, n)).filter((v) => v > 0).map((v) => Math.log10(v));
    const step = Math.max(1, Math.ceil((b - a + 1) / Math.max(2, n)));
    const out = [];
    for (let v = a; v <= b; v += step) out.push(v);
    return out;
  }
  function makeChart(host, cfg) {
    const box = document.createElement('div');
    box.className = 'lc-chart';
    const cv = document.createElement('canvas');
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', cfg.aria || '차트');
    const tip = document.createElement('div');
    tip.className = 'lc-tip';
    tip.hidden = true;
    box.append(cv, tip);
    host.appendChild(box);
    const ch = { box, cv, tip, cfg, hk: -1, hr: -1 };
    box._ch = ch;
    const mv = (e) => hover(ch, e);
    cv.addEventListener('pointermove', mv);
    cv.addEventListener('pointerdown', mv);
    cv.addEventListener('pointerleave', () => { ch.hk = -1; ch.hr = -1; tip.hidden = true; draw(ch); });
    charts.add(ch);
    ensureRO();
    if (ro) ro.observe(box);
    draw(ch);
    return ch;
  }
  function layout(ch, c, w) {
    const cfg = ch.cfg, strip = cfg.type === 'strip';
    const lg = cfg.axis === 'log';
    const xt = lg ? (x) => Math.log10(Math.max(x, 1e-300)) : (x) => x;
    const xa = xt(cfg.xs ? cfg.xs[0] : cfg.xMin), xb0 = xt(cfg.xs ? cfg.xs[cfg.xs.length - 1] : cfg.xMax);
    const xb = xb0 > xa ? xb0 : xa + 1;
    const h = strip ? Math.max(80, cfg.rows.length * 30 + 40) : cfg.height || 200;
    const T = strip ? 14 : 12, B = 26, R = 14;
    let L, yt = null, lo = 0, hi = 1, yTicks = [], yLab = [];
    c.font = `11px ${FONT}`;
    if (strip) {
      L = Math.min(Math.max(70, ...cfg.rows.map((r) => c.measureText(r.label).width + 16)), Math.round(w * 0.42));
    } else {
      yt = cfg.ylog ? (v) => Math.log10(Math.max(v, 1e-30)) : (v) => v;
      lo = Infinity; hi = -Infinity;
      let ints = !cfg.ylog;
      const take = (arr) => { for (const v of arr || []) { if (!fin(v)) continue; const u = yt(v); if (!fin(u)) continue; if (u < lo) lo = u; if (u > hi) hi = u; if (ints && Math.abs(v - Math.round(v)) > 1e-9) ints = false; } };
      (cfg.bands || []).forEach((b) => { take(b.lo); take(b.hi); });
      (cfg.lines || []).forEach((l) => take(l.ys));
      (cfg.hmarks || []).forEach((m) => take([m.y]));
      const dLo = lo, dHi = hi; // 자료의 범위
      if (fin(cfg.yMin)) lo = Math.min(fin(lo) ? lo : yt(cfg.yMin), yt(cfg.yMin));
      if (fin(cfg.yMax)) hi = Math.max(fin(hi) ? hi : yt(cfg.yMax), yt(cfg.yMax));
      if (fin(cfg.yMin) && cfg.yClamp) lo = yt(cfg.yMin);
      if (fin(cfg.yMax) && cfg.yClamp) hi = yt(cfg.yMax);
      if (!fin(lo) || !fin(hi)) { lo = 0; hi = 1; }
      if (hi - lo < 1e-9) { const p = Math.abs(hi) * 0.1 || 0.5; lo -= p; hi += p; }
      const pad = (hi - lo) * 0.06;
      if (!(fin(cfg.yMin) && cfg.yClamp)) lo -= pad;
      if (!(fin(cfg.yMax) && cfg.yClamp)) hi += pad;
      const n = Math.max(2, Math.round((h - T - B) / 44));
      // 값이 모두 정수인 지표(나라 수 등)는 눈금을 1보다 잘게 나누지 않음. 범위를 정해 둔(yClamp) 차트는 그대로.
      const intAxis = ints && !cfg.yClamp;
      if (intAxis && hi - lo < 2) { const c0 = (lo + hi) / 2; lo = Math.min(lo, Math.floor(c0) - 1); hi = Math.max(hi, Math.ceil(c0) + 1); }
      // 자료가 yMin/yMax 안에 있으면 넓힌 범위도 그 밖으로 나가지 않게 (예: 차이 그래프에 -1이 보이지 않도록)
      if (fin(cfg.yMin) && !(dLo < yt(cfg.yMin))) lo = Math.max(lo, yt(cfg.yMin) - pad);
      if (fin(cfg.yMax) && !(dHi > yt(cfg.yMax))) hi = Math.min(hi, yt(cfg.yMax) + pad);
      yTicks = (cfg.ylog ? logTicks(lo, hi, n, cfg.yshift) : ticks(lo, hi, n, intAxis || cfg.intTicks ? 1 : 0)).filter((u) => u >= lo - 1e-9 && u <= hi + 1e-9);
      yLab = yTicks.map((u) => (cfg.yfmt ? cfg.yfmt(cfg.ylog ? Math.pow(10, u) : u) : WS.trimNum(u)));
      L = Math.max(30, ...yLab.map((s) => c.measureText(s).width + 12));
    }
    const pw = Math.max(10, w - L - R), ph = h - T - B;
    return {
      h, L, R, T, B, pw, ph, xa, xb, xt, yt, lo, hi, yTicks, yLab, lg,
      px: (x) => L + ((xt(x) - xa) / (xb - xa)) * pw,
      pu: (u) => L + ((u - xa) / (xb - xa)) * pw,
      py: (v) => T + (1 - (yt(v) - lo) / (hi - lo)) * ph,
    };
  }
  function draw(ch) {
    const { cv, cfg, box } = ch;
    const w = Math.round(box.clientWidth);
    if (!w) return;
    const c = cv.getContext('2d');
    const G = layout(ch, c, w);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(G.h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(G.h * dpr); cv.style.height = G.h + 'px'; }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, G.h);
    c.font = `11px ${FONT}`;
    c.lineJoin = 'round'; c.lineCap = 'round';
    const { L, T, pw, ph } = G;
    // x 눈금
    const nx = Math.max(2, Math.floor(pw / 92));
    const xts = G.lg ? logTicks(G.xa, G.xb, nx) : ticks(G.xa, G.xb, nx);
    c.textBaseline = 'top';
    let lastR = -Infinity;
    xts.forEach((u) => {
      const x = G.pu(u);
      if (x < L - 1 || x > L + pw + 1) return;
      c.strokeStyle = 'rgba(146,154,171,.10)';
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(Math.round(x) + 0.5, T); c.lineTo(Math.round(x) + 0.5, T + ph); c.stroke();
      const s = short(cfg.xfmt(G.lg ? Math.pow(10, u) : u));
      const tw = c.measureText(s).width;
      let tx = Math.min(L + pw - tw / 2, Math.max(L + tw / 2 - 6, x));
      if (tx - tw / 2 < lastR + 8) return;
      lastR = tx + tw / 2;
      c.fillStyle = '#8d95a6';
      c.textAlign = 'center';
      c.fillText(s, tx, T + ph + 7);
    });
    c.textAlign = 'left';
    if (cfg.type === 'strip') { drawStrip(ch, c, G, w); return; }
    // y 눈금
    c.textBaseline = 'middle';
    G.yTicks.forEach((u, i) => {
      const y = Math.round(T + (1 - (u - G.lo) / (G.hi - G.lo)) * ph) + 0.5;
      c.strokeStyle = 'rgba(146,154,171,.13)';
      c.beginPath(); c.moveTo(L, y); c.lineTo(L + pw, y); c.stroke();
      c.fillStyle = '#8d95a6';
      c.textAlign = 'right';
      c.fillText(G.yLab[i], L - 7, y);
    });
    c.textAlign = 'left';
    c.strokeStyle = 'rgba(146,154,171,.35)';
    c.beginPath(); c.moveTo(L, T + ph + 0.5); c.lineTo(L + pw, T + ph + 0.5); c.stroke();
    const xs = cfg.xs;
    const run = (ys, fn) => { let seg = []; for (let k = 0; k < xs.length; k++) { if (fin(ys[k]) && fin(G.yt(ys[k]))) seg.push(k); else { if (seg.length) fn(seg); seg = []; } } if (seg.length) fn(seg); };
    c.save();
    c.beginPath(); c.rect(L, T - 2, pw, ph + 4); c.clip();
    // 띠
    (cfg.bands || []).forEach((b) => {
      c.fillStyle = b.color; c.globalAlpha = b.a || 0.18;
      const ok = xs.map((_, k) => fin(b.lo[k]) && fin(b.hi[k]) ? 1 : NaN);
      run(ok, (seg) => {
        c.beginPath();
        seg.forEach((k, i) => { const x = G.px(xs[k]), y = G.py(b.hi[k]); i ? c.lineTo(x, y) : c.moveTo(x, y); });
        for (let i = seg.length - 1; i >= 0; i--) { const k = seg[i]; c.lineTo(G.px(xs[k]), G.py(b.lo[k])); }
        c.closePath(); c.fill();
      });
    });
    c.globalAlpha = 1;
    // 가로 기준선
    (cfg.hmarks || []).forEach((m) => {
      const y = Math.round(G.py(m.y)) + 0.5;
      c.strokeStyle = m.color || 'rgba(235,228,211,.45)'; c.setLineDash([4, 4]); c.lineWidth = 1;
      c.beginPath(); c.moveTo(L, y); c.lineTo(L + pw, y); c.stroke(); c.setLineDash([]);
    });
    // 선
    (cfg.lines || []).forEach((l) => {
      c.strokeStyle = l.color; c.lineWidth = l.w || 2; c.globalAlpha = l.a || 1;
      if (l.dash) c.setLineDash(l.dash);
      run(l.ys, (seg) => {
        c.beginPath();
        seg.forEach((k, i) => { const x = G.px(xs[k]), y = G.py(l.ys[k]); i ? c.lineTo(x, y) : c.moveTo(x, y); });
        if (seg.length === 1) { const x = G.px(xs[seg[0]]), y = G.py(l.ys[seg[0]]); c.moveTo(x - 2, y); c.lineTo(x + 2, y); }
        c.stroke();
      });
      c.setLineDash([]); c.globalAlpha = 1;
    });
    c.restore();
    // 세로 표시 (개입 시점 등): 선, 그리고 위쪽에 이름표
    const boxes = [];
    (cfg.vmarks || []).forEach((m) => {
      if (!fin(m.x)) return;
      const x = Math.round(G.px(m.x)) + 0.5;
      if (x < L || x > L + pw + 1) return;
      c.strokeStyle = m.color || '#84c6d2'; c.lineWidth = 1.5; c.setLineDash([5, 4]);
      c.beginPath(); c.moveTo(x, T); c.lineTo(x, T + ph); c.stroke(); c.setLineDash([]);
      const tw = c.measureText(m.label).width;
      const tx = x + 5 + tw > L + pw ? x - 5 - tw : x + 5;
      boxes.push({ x0: tx - 3, x1: tx + tw + 3, y0: T, y1: T + 16, draw: () => {
        c.textBaseline = 'top';
        c.fillStyle = 'rgba(17,22,31,.9)'; c.fillRect(tx - 3, T, tw + 6, 16);
        c.fillStyle = m.color || '#84c6d2'; c.textAlign = 'left';
        c.fillText(m.label, tx, T + 2);
      } });
    });
    // 가로 기준선 이름표: 오른쪽 끝, 선 위 (세로 표시 이름표와 겹치면 선 아래로)
    (cfg.hmarks || []).forEach((m) => {
      if (!m.label) return;
      const y = G.py(m.y);
      if (!(y >= T - 1 && y <= T + ph + 1)) return;
      const tw = c.measureText(m.label).width;
      const bx = L + pw - tw - 9;
      let by = y - 18;
      const hit = (b) => !(b.x1 < bx || b.x0 > bx + tw + 6 || b.y1 < by || b.y0 > by + 15);
      if (by < T || boxes.some(hit)) by = y + 3;
      boxes.push({ x0: bx, x1: bx + tw + 6, y0: by, y1: by + 15, draw: () => {
        c.fillStyle = 'rgba(17,22,31,.9)'; c.fillRect(bx, by, tw + 6, 15);
        c.fillStyle = '#a9b0bf'; c.textAlign = 'left'; c.textBaseline = 'top';
        c.fillText(m.label, bx + 3, by + 2);
      } });
    });
    boxes.forEach((b) => b.draw());
    c.textAlign = 'left';
    // 마우스 위치
    if (ch.hk >= 0 && ch.hk < xs.length) {
      const x = Math.round(G.px(xs[ch.hk])) + 0.5;
      c.strokeStyle = 'rgba(235,228,211,.5)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, T); c.lineTo(x, T + ph); c.stroke();
      (cfg.lines || []).forEach((l) => {
        if (!l.dot) return;
        const v = l.ys[ch.hk];
        if (!fin(v)) return;
        c.fillStyle = l.color; c.strokeStyle = '#11161f'; c.lineWidth = 2;
        c.beginPath(); c.arc(G.px(xs[ch.hk]), G.py(v), 4.5, 0, Math.PI * 2); c.fill(); c.stroke();
      });
    }
    ch.G = G;
  }
  function drawStrip(ch, c, G, w) {
    const { cfg } = ch, { L, T, pw } = G;
    const rows = cfg.rows;
    c.textBaseline = 'middle';
    rows.forEach((r, i) => {
      const y = T + 10 + i * 30;
      if (i === ch.hr) { c.fillStyle = 'rgba(235,228,211,.05)'; c.fillRect(0, y - 14, w, 28); }
      c.strokeStyle = 'rgba(146,154,171,.16)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(L, Math.round(y) + 0.5); c.lineTo(L + pw, Math.round(y) + 0.5); c.stroke();
      c.fillStyle = '#d9d3c4'; c.textAlign = 'right';
      let lab = r.label;
      while (c.measureText(lab).width > L - 14 && lab.length > 3) lab = lab.slice(0, -2) + '…';
      c.fillText(lab, L - 10, y);
      c.textAlign = 'left';
      // 점: 같은 자리에 겹치면 위아래로 살짝 흩뜨림
      const used = new Map();
      r.pts.forEach((p) => {
        if (!fin(p.x)) return;
        const x = G.px(p.x);
        if (x < L - 2 || x > L + pw + 2) return;
        const key = Math.round(x / 4);
        const n = used.get(key) || 0; used.set(key, n + 1);
        const dy = n === 0 ? 0 : (n % 2 ? -1 : 1) * Math.min(10, Math.ceil(n / 2) * 3.2);
        c.fillStyle = p.color || CA; c.globalAlpha = 0.85;
        c.beginPath(); c.arc(x, y + dy, 3.6, 0, Math.PI * 2); c.fill();
        c.globalAlpha = 1;
      });
      if (fin(r.real)) {
        const x = G.px(r.real);
        if (x >= L - 2 && x <= L + pw + 2) {
          c.fillStyle = '#ebe4d3'; c.strokeStyle = '#11161f'; c.lineWidth = 1.5;
          c.beginPath(); c.moveTo(x, y - 7); c.lineTo(x + 6, y); c.lineTo(x, y + 7); c.lineTo(x - 6, y); c.closePath(); c.fill(); c.stroke();
        }
      }
    });
    ch.G = G;
  }
  function hover(ch, e) {
    const G = ch.G, cfg = ch.cfg;
    if (!G) return;
    const r = ch.cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let html = '';
    if (cfg.type === 'strip') {
      const i = Math.floor((y - G.T + 5) / 30);
      if (i < 0 || i >= cfg.rows.length) { ch.hr = -1; ch.tip.hidden = true; draw(ch); return; }
      if (i !== ch.hr) { ch.hr = i; draw(ch); }
      html = cfg.rows[i].tip || esc(cfg.rows[i].label);
    } else {
      const xs = cfg.xs;
      let best = -1, bd = Infinity;
      for (let k = 0; k < xs.length; k++) { const d = Math.abs(G.px(xs[k]) - x); if (d < bd) { bd = d; best = k; } }
      if (best < 0 || x < G.L - 10) { ch.hk = -1; ch.tip.hidden = true; draw(ch); return; }
      if (best !== ch.hk) { ch.hk = best; draw(ch); }
      html = cfg.tip ? cfg.tip(best) : '';
    }
    if (!html) { ch.tip.hidden = true; return; }
    const t = ch.tip;
    t.innerHTML = html;
    t.hidden = false;
    const bw = ch.box.clientWidth, tw = t.offsetWidth, th = t.offsetHeight;
    let left = x + 14;
    if (left + tw > bw - 2) left = Math.max(2, x - tw - 14);
    t.style.left = left + 'px';
    t.style.top = Math.max(0, Math.min(G.h - th, y - th - 10 < 0 ? y + 14 : y - th - 10)) + 'px';
  }

  /* =====================================================================
     CSS (공용 토큰 사용, 한 번만 주입)
     ===================================================================== */
  const CSS = `
#lab { overflow-y: auto; min-height: 0; background: radial-gradient(900px 480px at 8% -8%, #172133 0%, transparent 62%), var(--ink);
  padding-block: 18px 56px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
#lab .lab-in { max-width: 1260px; margin: 0 auto; display: grid; gap: 16px; min-width: 0; }
#lab .lab-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px 20px; flex-wrap: wrap; }
#lab .lab-kicker, #lab .lc-kicker { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; letter-spacing: .06em; color: var(--brass); font-weight: 600; }
#lab .lab-kicker .ico, #lab .lc-kicker .ico { width: 15px; height: 15px; }
#lab .lab-head h2 { font-family: var(--f-display); font-size: clamp(22px, 3vw, 30px); line-height: 1.25; margin: 2px 0 4px; text-wrap: balance; }
#lab .lab-head p { margin: 0; color: var(--muted); max-width: 68ch; }
#lab .lab-qs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
#lab .lab-q { text-align: left; border: 1px solid var(--line); background: var(--ink-2); border-radius: 12px; padding: 12px 14px 13px; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; align-items: start; color: var(--text); transition: border-color .15s, background .15s; }
#lab .lab-q:hover { border-color: var(--faint); }
#lab .lab-q .ico { width: 22px; height: 22px; color: var(--brass); grid-row: 1 / span 3; margin-top: 2px; }
#lab .lab-q .n { font-size: 11px; color: var(--muted); letter-spacing: .05em; }
#lab .lab-q b { font-family: var(--f-display); font-size: 16.5px; line-height: 1.35; font-weight: 700; }
#lab .lab-q .s { font-size: 12.5px; color: var(--muted); line-height: 1.45; }
#lab .lab-q[aria-selected="true"] { border-color: var(--brass); background: linear-gradient(180deg, rgba(216,168,91,.13), rgba(216,168,91,.03)), var(--ink-2); box-shadow: inset 0 0 0 1px rgba(216,168,91,.55); }
#lab .lab-q[aria-selected="true"] .n { color: var(--brass-hi); }
#lab .lab-grid { display: grid; grid-template-columns: 372px minmax(0, 1fr); gap: 16px; align-items: start; }
#lab .lab-setup { background: var(--ink-2); border: 1px solid var(--line); border-radius: 12px; padding: 16px; display: grid; gap: 16px; min-width: 0; }
#lab .lab-setup h3 { margin: 0; font-family: var(--f-display); font-size: 18px; }
#lab .lf { display: grid; gap: 6px; min-width: 0; }
#lab .lf-l { font-size: 13px; color: var(--text); font-weight: 600; display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
#lab .lf-l b { font-weight: 600; color: var(--brass-hi); font-size: 13px; font-variant-numeric: tabular-nums; }
#lab .lf-h { font-size: 12px; color: var(--muted); line-height: 1.5; margin: 0; }
#lab select, #lab input[type="text"], #lab .lab-seed input { width: 100%; min-width: 0; background: var(--ink-3); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; color: var(--text); }
#lab select:hover { border-color: var(--faint); }
#lab input[type="range"] { width: 100%; accent-color: var(--brass); margin: 4px 0; }
#lab .lab-stages { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
#lab .lab-stage { display: flex; gap: 8px; align-items: center; text-align: left; border: 1px solid var(--line); background: var(--ink-3); border-radius: 8px; padding: 8px 10px; color: var(--muted); min-width: 0; }
#lab .lab-stage .ico { color: var(--faint); }
#lab .lab-stage span { display: grid; min-width: 0; }
#lab .lab-stage b { color: var(--text); font-weight: 600; font-size: 13.5px; }
#lab .lab-stage small { font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#lab .lab-stage[aria-pressed="true"] { border-color: var(--brass); background: #241e12; }
#lab .lab-stage[aria-pressed="true"] .ico { color: var(--brass-hi); }
#lab .seg { display: flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
#lab .seg button { flex: 1; border: 0; background: var(--ink-3); padding: 7px 4px; font-family: var(--f-mono); font-size: 13px; color: var(--muted); border-right: 1px solid var(--line); }
#lab .seg button:last-child { border-right: 0; }
#lab .seg button[aria-pressed="true"] { background: #2a2214; color: var(--brass-hi); box-shadow: inset 0 -2px 0 var(--brass); }
#lab .lab-seed { display: flex; gap: 6px; }
#lab .lab-seed input { font-family: var(--f-mono); }
#lab .lab-box { border: 1px solid var(--line); border-radius: 10px; padding: 12px; display: grid; gap: 12px; background: rgba(5,7,11,.25); }
#lab .lab-box > .lab-box-h { display: flex; align-items: center; gap: 8px; font-family: var(--f-display); font-weight: 700; font-size: 15px; }
#lab .lab-box > .lab-box-h .ico { color: var(--cyan); }
#lab .lab-ivdesc { font-size: 12.5px; color: var(--muted); background: var(--ink-3); border-radius: 8px; padding: 8px 10px; margin: 0; line-height: 1.5; }
#lab .lab-presets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
#lab .lab-presets label { display: grid; gap: 4px; font-size: 12px; color: var(--muted); }
#lab .tagab { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 4px; font-size: 11px; font-weight: 700; color: #11161f; flex: none; }
#lab .tagab.a { background: ${CA}; } #lab .tagab.b { background: ${CB}; }
#lab .lab-cond { display: grid; gap: 2px; padding: 8px 0; border-top: 1px solid rgba(37,46,62,.7); }
#lab .lab-cond-h { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 13px; font-weight: 600; }
#lab .lab-cond-r { display: grid; grid-template-columns: 18px minmax(0, 1fr) 64px; gap: 8px; align-items: center; }
#lab .lab-cond-r b { font-family: var(--f-mono); font-weight: 500; font-size: 12px; text-align: right; color: var(--muted); }
#lab .lab-cond-r b.chg { color: var(--text); }
#lab .lab-cond-r input.b, #lab .lab-cond-r input.b[type="checkbox"] { accent-color: var(--cyan); }
#lab .lab-cond-r input[type="checkbox"] { width: 18px; height: 18px; accent-color: var(--brass); justify-self: start; }
#lab .lab-go { display: grid; gap: 8px; position: sticky; bottom: -56px; z-index: 2; background: var(--ink-2); box-shadow: 0 -18px 16px -6px var(--ink-2); padding: 10px 0 16px; margin-bottom: -16px; border-radius: 0 0 12px 12px; }
#lab .lab-est { font-size: 12.5px; color: var(--muted); display: flex; gap: 6px; align-items: flex-start; }
#lab .lab-est .ico { width: 15px; height: 15px; margin-top: 2px; color: var(--faint); }
#lab .lab-run { justify-content: center; padding: 11px 14px; font-size: 15px; border-radius: 10px; width: 100%; }
#lab .lab-run:disabled { opacity: .5; cursor: not-allowed; }
#lab .lab-note { font-size: 12.5px; color: var(--muted); border-left: 3px solid var(--cyan); background: rgba(132,198,210,.06); padding: 9px 11px; border-radius: 0 8px 8px 0; margin: 0; line-height: 1.55; }
#lab .lab-out { display: grid; gap: 14px; min-width: 0; }
#lab .lc-sec { background: var(--ink-2); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; display: grid; gap: 12px; min-width: 0; }
#lab .lc-sec > h3 { margin: 0; font-family: var(--f-display); font-size: 18px; font-weight: 700; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
#lab .lc-sec > .lead { margin: -6px 0 0; color: var(--muted); font-size: 13px; max-width: 80ch; line-height: 1.55; }
#lab .lc-head { display: flex; justify-content: space-between; gap: 10px 16px; flex-wrap: wrap; align-items: flex-end; padding: 2px 2px 0; }
#lab .lc-head h3 { margin: 2px 0 2px; font-family: var(--f-display); font-size: clamp(19px, 2.4vw, 23px); line-height: 1.3; }
#lab .lc-head p { margin: 0; color: var(--muted); font-size: 12.5px; }
#lab .lc-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; }
#lab .lc-cards.n4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
#lab .lc-cards.n2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
#lab .lc-card { background: var(--ink-2); border: 1px solid var(--line); border-left: 3px solid var(--faint); border-radius: 10px; padding: 13px 15px 14px; display: grid; gap: 5px; align-content: start; min-width: 0; }
#lab .lc-card .t { display: flex; gap: 7px; align-items: center; font-size: 12.5px; font-weight: 600; color: var(--muted); letter-spacing: .02em; }
#lab .lc-card .t i { width: 9px; height: 9px; border-radius: 50%; flex: none; }
#lab .lc-card p { margin: 0; font-size: 15px; line-height: 1.6; color: var(--text); text-wrap: pretty; }
#lab .lc-card.main { border-left-color: var(--brass); background: linear-gradient(135deg, rgba(216,168,91,.10), rgba(216,168,91,0) 60%), var(--ink-2); }
#lab .lc-card.main .t { color: var(--brass-hi); }
#lab .lc-card.main p { font-size: 16px; }
#lab .lc-card.main { grid-column: 1 / -1; }
#lab .lc-card details.lc-det { margin-top: 2px; }
#lab .lc-card details.lc-det summary { cursor: pointer; font-size: 12px; color: var(--faint); width: fit-content; }
#lab .lc-card details.lc-det summary:hover { color: var(--muted); }
#lab .lc-card details.lc-det p { font-size: 12.5px; line-height: 1.5; color: var(--muted); margin-top: 3px; }
#lab .lc-card.info { border-left-color: var(--cyan); }
#lab .lc-card.warn { border-left-color: var(--ember); }
#lab .lc-card.warn .t { color: #f09a83; }
#lab .lc-card.soft { border-left-color: var(--leaf); }
#lab .lc-ob { display: grid; gap: 10px; }
#lab .lc-ob-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(90px, 1.3fr) 92px; gap: 6px 12px; align-items: center; }
#lab .lc-ob-row.ab { grid-template-columns: minmax(0, 1fr) minmax(90px, 1.3fr) 112px; }
#lab .lc-ob-lab { display: grid; grid-template-columns: 10px minmax(0, 1fr); gap: 0 8px; align-items: baseline; font-size: 13.5px; min-width: 0; }
#lab .lc-ob-lab i { width: 10px; height: 10px; border-radius: 3px; transform: translateY(1px); }
#lab .lc-ob-lab small { grid-column: 2; color: var(--muted); font-size: 11.5px; line-height: 1.45; }
#lab .lc-ob-bars { display: grid; gap: 3px; }
#lab .lc-ob-bar { height: 12px; background: var(--ink-3); border-radius: 4px; overflow: hidden; }
#lab .lc-ob-bar b { display: block; height: 100%; border-radius: 4px; min-width: 2px; }
#lab .lc-ob-bar b.z { min-width: 0; }
#lab .lc-ob-v { font-size: 13px; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; display: grid; gap: 1px; }
#lab .lc-ob-v small { color: var(--muted); font-size: 11px; }
#lab .lc-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12.5px; color: var(--muted); align-items: center; }
#lab .lc-legend span { display: inline-flex; align-items: center; gap: 6px; }
#lab .lc-legend i { width: 14px; height: 3px; border-radius: 2px; display: inline-block; }
#lab .lc-legend i.sq { width: 10px; height: 10px; border-radius: 3px; }
#lab .lc-legend i.dia { width: 9px; height: 9px; background: #ebe4d3; transform: rotate(45deg); border-radius: 1px; }
#lab .lc-legend i.dot { width: 8px; height: 8px; border-radius: 50%; }
#lab .lc-grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
#lab .lc-mini { border: 1px solid rgba(37,46,62,.8); border-radius: 10px; padding: 10px 12px 6px; display: grid; gap: 4px; min-width: 0; background: rgba(5,7,11,.22); }
#lab .lc-mini h4 { margin: 0; font-size: 14px; font-weight: 600; display: flex; justify-content: space-between; gap: 8px; align-items: baseline; flex-wrap: wrap; }
#lab .lc-mini h4 span { font-weight: 500; font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
#lab .lc-chart { position: relative; min-width: 0; }
#lab .lc-chart canvas { display: block; width: 100%; touch-action: pan-y; }
#lab .lc-tip { position: absolute; z-index: 3; pointer-events: none; background: rgba(9,12,18,.96); border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; font-size: 12px; line-height: 1.5; max-width: 260px; box-shadow: 0 8px 24px rgba(0,0,0,.45); }
#lab .lc-tip b { color: var(--brass-hi); font-weight: 600; }
#lab .lc-tip .r { display: flex; gap: 8px; align-items: center; justify-content: space-between; white-space: nowrap; }
#lab .lc-tip .r i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 5px; }
#lab .lc-tip .r em { font-style: normal; font-family: var(--f-mono); }
#lab .lc-toggle { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: var(--muted); cursor: pointer; font-family: var(--f-body); font-weight: 400; }
#lab .lc-toggle input { width: 16px; height: 16px; accent-color: var(--brass); }
#lab .lc-stories { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 12px; }
#lab .lc-story { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; display: grid; gap: 8px; align-content: start; background: rgba(5,7,11,.22); min-width: 0; }
#lab .lc-story header { display: grid; gap: 2px; }
#lab .lc-story h4 { margin: 0; font-family: var(--f-display); font-size: 17px; display: flex; gap: 8px; align-items: center; }
#lab .lc-story h4 i { width: 10px; height: 10px; border-radius: 3px; flex: none; }
#lab .lc-story .meta { font-size: 12px; color: var(--muted); font-family: var(--f-mono); }
#lab .lc-story ol { list-style: none; margin: 0; padding: 0; max-height: 300px; overflow-y: auto; display: grid; }
#lab .lc-story li { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 8px; padding: 5px 0; border-bottom: 1px solid rgba(37,46,62,.55); font-size: 12.5px; line-height: 1.5; }
#lab .lc-story li time { font-family: var(--f-mono); font-size: 11px; color: var(--faint); padding-top: 1px; }
#lab .lc-story li.milestone span { color: var(--brass-hi); }
#lab .lc-story li.disaster span { color: #f09a83; }
#lab .lc-story li.god span { color: var(--cyan); }
#lab .lc-story li.end span { color: var(--text); font-weight: 600; }
#lab .lc-tw { overflow-x: auto; margin: 0 -4px; padding: 0 4px; }
#lab table.lc-t { width: 100%; border-collapse: collapse; font-size: 13px; }
#lab .lc-t th { text-align: left; font-weight: 500; color: var(--muted); font-size: 11.5px; padding: 6px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
#lab .lc-t td { padding: 7px 8px; border-bottom: 1px solid rgba(37,46,62,.6); vertical-align: middle; }
#lab .lc-t td.v { font-size: 12.5px; white-space: nowrap; font-variant-numeric: tabular-nums; }
#lab .lc-t td.seed { font-family: var(--f-mono); font-size: 12px; color: var(--muted); }
#lab .lc-t .mut { color: var(--muted); }
#lab .lc-t td:first-child { min-width: 6.5em; }
#lab .lc-t .oc { display: inline-flex; gap: 6px; align-items: center; }
#lab .lc-t .oc i { width: 9px; height: 9px; border-radius: 3px; flex: none; }
#lab .lc-t .sig { color: var(--brass-hi); }
#lab .lc-t button { white-space: nowrap; }
#lab .btn.sm { padding: 4px 8px; font-size: 12px; gap: 4px; }
#lab .btn.sm .ico { width: 14px; height: 14px; }
#lab .lc-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); font-family: var(--f-body); font-weight: 500; }
#lab .lc-badge.sig { border-color: rgba(216,168,91,.6); color: var(--brass-hi); background: rgba(216,168,91,.08); }
#lab .lc-meter { display: grid; grid-template-columns: auto minmax(80px, 240px) auto; gap: 10px; align-items: center; font-size: 13px; }
#lab .lc-meter .bar { height: 10px; background: linear-gradient(90deg, #5e8f73, #c9a35a, #d4664b); border-radius: 5px; position: relative; }
#lab .lc-meter .bar b { position: absolute; top: -4px; width: 4px; height: 18px; background: var(--text); border-radius: 2px; transform: translateX(-2px); box-shadow: 0 0 0 2px var(--ink-2); }
#lab .lc-run { gap: 14px; }
#lab .lc-run-h { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
#lab .lc-run-h h3 { margin: 2px 0 0; font-family: var(--f-display); font-size: 20px; }
#lab .lc-prog { height: 10px; background: var(--ink-3); border-radius: 5px; overflow: hidden; }
#lab .lc-prog div { height: 100%; width: 0; background: linear-gradient(90deg, var(--brass), var(--brass-hi)); border-radius: 5px; transition: width .25s; }
#lab .lc-run-meta { display: flex; flex-wrap: wrap; gap: 4px 18px; font-size: 13px; color: var(--muted); }
#lab .lc-run-meta b { color: var(--text); font-weight: 600; font-family: var(--f-mono); }
#lab .lc-dots { display: flex; flex-wrap: wrap; gap: 4px; }
#lab .lc-dots i { width: 12px; height: 12px; border-radius: 3px; background: var(--ink-3); border: 1px solid var(--line); transition: background .3s; }
#lab .lc-dots i.on { background: var(--brass); border-color: var(--brass); }
#lab .lc-dots i.half { background: linear-gradient(90deg, var(--brass) 50%, var(--ink-3) 50%); }
#lab .lc-empty { justify-items: start; padding: 22px 22px 24px; }
#lab .lc-empty .ic { width: 46px; height: 46px; border-radius: 12px; display: grid; place-items: center; background: rgba(216,168,91,.1); color: var(--brass-hi); border: 1px solid rgba(216,168,91,.35); }
#lab .lc-empty .ic .ico { width: 26px; height: 26px; }
#lab .lc-empty h3 { margin: 0; font-family: var(--f-display); font-size: 22px; }
#lab .lc-empty p { margin: 0; color: var(--muted); max-width: 64ch; }
#lab .lc-steps { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; counter-reset: st; max-width: 64ch; }
#lab .lc-steps li { counter-increment: st; display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 10px; align-items: start; font-size: 14px; line-height: 1.55; }
#lab .lc-steps li::before { content: counter(st); width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--brass); color: var(--brass-hi); display: grid; place-items: center; font-family: var(--f-mono); font-size: 12px; }
#lab .lc-caveat { font-size: 12px; color: var(--faint); margin: 2px 2px 0; line-height: 1.55; }
#lab .lc-banner { font-size: 13px; color: var(--muted); border: 1px dashed var(--line); border-radius: 10px; padding: 8px 12px; display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
#lab .lc-more { justify-self: start; }
#lab .seg.seg-t button { font-family: var(--f-body); font-size: 12.5px; line-height: 1.3; padding: 8px 6px; }
#lab .seg button:disabled { cursor: not-allowed; }
#lab .seg button:disabled:not([aria-pressed="true"]) { opacity: .45; }
#lab .lab-rr { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
#lab .lab-rr li { font-size: 12px; color: var(--faint); line-height: 1.5; padding-left: 9px; border-left: 2px solid var(--line); }
#lab .lab-rr li.on { color: var(--muted); border-left-color: var(--brass); }
#lab .lab-rr li b { font-weight: 600; color: inherit; }
#lab .lab-rr li.on b { color: var(--text); }
#lab .lab-avnote { color: #e9c58a; }
#lab .lab-busy { margin: 0; font-size: 12.5px; color: var(--muted); display: flex; gap: 6px; align-items: flex-start; line-height: 1.55; }
#lab .lab-busy .ico { width: 15px; height: 15px; margin-top: 2px; color: var(--cyan); flex: none; }
#lab .lab-link { background: none; border: 0; padding: 0; color: var(--cyan); font: inherit; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
@media (max-width: 1100px) { #lab .lab-grid { grid-template-columns: 330px minmax(0, 1fr); } }
@media (max-width: 900px) {
  #lab { overflow: visible; }
  #lab .lab-grid { grid-template-columns: minmax(0, 1fr); }
  #lab .lab-qs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  #lab .lab-go { position: static; background: none; padding-top: 0; }
}
@media (max-width: 560px) {
  #lab .lab-q { padding: 10px 11px; grid-template-columns: minmax(0, 1fr); }
  #lab .lab-q .ico { display: none; }
  #lab .lab-q b { font-size: 14.5px; }
  #lab .lab-q .s { display: none; }
  #lab .lc-sec { padding: 14px 13px; }
  #lab .lc-ob-row, #lab .lc-ob-row.ab { grid-template-columns: minmax(0, 1fr) 84px; }
  #lab .lc-ob-row .lc-ob-bars { grid-column: 1 / -1; grid-row: 2; }
  #lab .lc-grid2, #lab .lc-stories, #lab .lc-cards.n4, #lab .lc-cards.n2 { grid-template-columns: minmax(0, 1fr); }
  #lab .lc-story li { grid-template-columns: 70px minmax(0, 1fr); }
  #lab .lc-card p { font-size: 14.5px; }
  #lab .lc-card.main p { font-size: 15px; }
}
@media (max-width: 720px) {
  /* 손가락으로 누르기 쉽게 */
  #lab .btn.sm { min-height: 36px; padding: 6px 10px; }
  /* 표: 옆으로 밀지 않아도 모두 보이게 줄마다 카드처럼 쌓기 (data-l = 칸 이름) */
  #lab .lc-tw:has(.lc-stack) { overflow: visible; margin: 0; padding: 0; }
  #lab table.lc-stack, #lab .lc-stack tbody, #lab .lc-stack td { display: block; width: auto; }
  #lab .lc-stack thead { display: none; }
  #lab .lc-stack tr { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 6px 12px; padding: 10px 0; border-bottom: 1px solid rgba(37,46,62,.6); }
  #lab .lc-stack tr[hidden] { display: none; }
  #lab .lc-stack td { border: 0; padding: 0; white-space: normal; min-width: 0; order: 5; }
  #lab .lc-stack td:first-child { min-width: 0; }
  #lab .lc-t.lc-stack td.v { white-space: normal; }
  #lab .lc-stack td.ev { grid-column: 1 / -1; font-weight: 600; order: 0; }
  #lab .lc-stack td.full { grid-column: 1 / -1; }
  #lab .lc-stack td.o1 { order: 1; } #lab .lc-stack td.o2 { order: 2; } #lab .lc-stack td.o3 { order: 3; } #lab .lc-stack td.o4 { order: 4; }
  #lab .lc-stack td.act { grid-column: 1 / -1; order: 9; }
  #lab .lc-stack td[data-l]::before { content: attr(data-l); display: block; font-size: 11px; color: var(--muted); font-weight: 400; font-family: var(--f-body); }
}
@media (prefers-reduced-motion: reduce) { #lab .lc-prog div, #lab .lc-dots i { transition: none; } }
`;

  /* =====================================================================
     실험실
     ===================================================================== */
  const Lab = (WS.Lab = {
    st: null, res: {}, running: null, built: false, lastProg: 0, probes: {}, waitProbe: false, _probeT: 0,

    /* ---------- 상태 ---------- */
    init() {
      if (this.st) return;
      const s = lsGet(STORE) || {};
      const app = WS.App || {};
      this.st = {
        q: [1, 2, 3, 4].includes(s.q) ? s.q : 1,
        qs: Object.assign({}, s.qs || {}),
        setup: Object.assign({}, s.setup || {}),
        horizon: Object.assign({}, s.horizon || {}),
        N: Object.assign({}, s.N || {}),
        iv: Object.assign({}, s.iv || {}),
        cond: Object.assign({}, s.cond || {}),
        xcond: {}, // 단계별로 이어받은 시작 조건 (질문 1~3에 적용, 저장하지 않음: 새로 고치면 기본 조건으로)
        seed: (s.seed >>> 0) || (app.seed >>> 0) || 20261031,
        spaghetti: !!s.spaghetti,
      };
      this.cal = lsGet(CAL) || {};
    },
    save() { const { xcond, ...st } = this.st; lsSet(STORE, st); },
    modeId(q) {
      q = q || this.st.q;
      const id = (this.st.qs[q] && this.st.qs[q].modeId) || QDEF[q].modeId;
      if (WS.modes[id]) return id;
      return ORDER.find((k) => WS.modes[k]) || Object.keys(WS.modes)[0];
    },
    setupKey(q, id) { return q + ':' + id; },
    setupOpts(q, id) {
      q = q || this.st.q; id = id || this.modeId(q);
      const m = WS.modes[id], o = {};
      const saved = this.st.setup[this.setupKey(q, id)] || (QDEF[q].modeId === id ? QDEF[q].setup : null) || {};
      (m.setup || []).forEach((f) => { const v = saved[f.id]; o[f.id] = f.options.some(([ov]) => ov === v) ? v : f.value; });
      return o;
    },
    hKey(id, opts) { return id + '|' + JSON.stringify(opts); },
    horizonList(id, opts) { try { return Ex(id).horizonOptions(opts) || []; } catch (e) { return []; } },
    horizon(id, opts) {
      const H = this.horizonList(id, opts);
      const sv = this.st.horizon[this.hKey(id, opts)];
      const hit = H.find((o) => fin(sv) && Math.abs(o.value - sv) <= 1e-9 * Math.max(1, Math.abs(sv)));
      return hit ? hit.value : (H.find((o) => o.def) || H[H.length - 1] || { value: Ex(id).span(opts)[1] }).value;
    },
    N(id) { const n = this.st.N[id]; return n > 0 ? n : DEF_N[id] || 20; },
    ivCfg(id, opts, x0, x1) {
      const X = Ex(id);
      const list = X.schedulable.map((k) => X.iv(k)).filter(Boolean);
      const s = Object.assign({}, this.st.iv[id] || {});
      if (!list.some((iv) => iv.id === s.id)) s.id = (list.find((iv) => iv.id === 'butterfly') || list[0] || {}).id || null;
      // 사용자가 직접 고른 시점은 (단계 · 설정 · 개입)마다 기억
      const key = id + '|' + JSON.stringify(opts) + '|' + s.id;
      const def = (IV_DEF[id] && IV_DEF[id][s.id]) || null;
      let at = s.at && fin(s.at[key]) ? s.at[key] : NaN, auto = false, probe = null, fixedAt = false;
      if (!(at > x0 && at <= x1)) {
        auto = true;
        if (id === 'civ' && Math.abs(x0 - 2026) < 0.5 && x1 > 2030) { at = 2030; fixedAt = true; }
        else if (def && fin(def.at) && def.at > x0 && def.at <= x1) { at = def.at; fixedAt = true; }
        else {
          // 시험 세계 하나로 이 개입이 가능한 이른 시점을 찾아 기본값으로 (찾는 동안은 기간의 10% 지점)
          probe = s.id ? this.probeFor(id, opts, x0, x1) : null;
          const pa = probe && probe.done ? this.pickAt(id, probe, s.id, x0, x1) : NaN;
          at = fin(pa) ? pa : niceAt(X.axis, x0, x1, axisAt(X.axis, x0, x1, 0.1));
        }
      }
      if (!probe && s.id && id !== 'civ') probe = this.probeFor(id, opts, x0, x1);
      // 장소: 이 개입에서 직접 고른 곳 > 이 개입의 기본값 > 다른 개입에서 고른 곳 > 목록의 첫째
      const okT = (k) => X.targets.some((t) => t.key === k);
      const mine = s.tgBy ? s.tgBy[s.id] : undefined;
      const tg = okT(mine) ? mine : def && okT(def.target) ? def.target : okT(s.target) ? s.target : X.targets[0] ? X.targets[0].key : null;
      const coupled = !!X.chanceCoupled;
      const reroll = coupled || s.reroll !== false;
      return { list, id: s.id, iv: list.find((iv) => iv.id === s.id) || null, at, auto, fixedAt, probe, target: tg, key, reroll, coupled, defNote: def && def.note && (auto || !mine) ? def.note : '' };
    },
    /* ---------- 개입 가능 시점 찾기 (시험 세계 하나, 화면이 멈추지 않게 조금씩) ---------- */
    probeFor(id, opts, x0, x1) {
      this.probes = this.probes || {};
      const carry = this.carried(id), cond = carry ? carry.cond : null;
      const key = id + '|' + JSON.stringify(opts) + '|' + x1 + '|' + JSON.stringify(cond);
      let P = this.probes[key];
      if (P) return P;
      const X = Ex(id);
      let xs = PROBE_FR.map((f) => axisAt(X.axis, x0, x1, f));
      if (fin(MIN_AT[id]) && MIN_AT[id] > x0 && MIN_AT[id] < x1) xs.push(MIN_AT[id]);
      xs = xs.map((x) => niceAt(X.axis, x0, x1, x)).filter((x) => x > x0 && x <= x1).sort((a, b) => a - b).filter((x, i, a) => i === 0 || x !== a[i - 1]);
      P = { key, id, xs, done: false, avail: null, waiters: [] };
      try { P.job = LC().makeProbe({ modeId: id, opts, cond, x1, xs, seed: 1 }); } catch (e) { P.done = true; P.avail = {}; }
      this.probes[key] = P;
      this.pumpProbes();
      return P;
    },
    pumpProbes() {
      if (this._probeT) return;
      const tick = () => {
        this._probeT = 0;
        const P = Object.values(this.probes || {}).find((p) => !p.done);
        if (!P) return;
        let done = false;
        try { done = P.job.advance(10); } catch (e) { done = true; }
        if (done) {
          P.done = true; P.avail = P.job.avail || {}; P.xs = P.job.xs || P.xs;
          P.waiters.splice(0).forEach((f) => f());
          this.onProbeDone(P);
        }
        this._probeT = setTimeout(tick, 0);
      };
      this._probeT = setTimeout(tick, 0);
    },
    probeReady(P) { return !P || P.done ? Promise.resolve() : new Promise((r) => P.waiters.push(r)); },
    onProbeDone(P) {
      // 질문 3 설정을 보고 있으면 기본 시점과 안내를 새로 그립니다
      const lab = $('lab');
      if (!lab || lab.hidden || this.st.q !== 3 || this.modeId(3) !== P.id || this.waitProbe) return;
      const box = $('labIv');
      if (!box) return;
      const a = document.activeElement;
      if (a && box.contains(a) && a.matches('select,input')) return; // 사용자가 만지는 중이면 다음 기회에
      this.renderSetup();
    },
    // 기본 시점 고르기: 기간의 10% 지점(항성계는 원반 단계) 이후 처음으로 가능한 때. 그때 처음 가능해졌다면 한 칸 더 뒤(세계마다 조금씩 다르므로).
    pickAt(id, P, ivId, x0, x1) {
      const av = P.avail && P.avail[ivId], xs = P.xs;
      if (!av || !av.some(Boolean)) return NaN;
      const X = Ex(id);
      const base = axisAt(X.axis, x0, x1, 0.1);
      let lo = base;
      if (fin(MIN_AT[id]) && MIN_AT[id] > base && xs.some((x, i) => x >= MIN_AT[id] && av[i])) lo = MIN_AT[id];
      const i = xs.findIndex((x) => x >= lo * (1 - 1e-9));
      let j = -1;
      if (i >= 0) for (let t = i; t < xs.length; t++) if (av[t]) { j = t; break; }
      if (j < 0) { for (let t = (i < 0 ? xs.length : i) - 1; t >= 0; t--) if (av[t]) { j = t; break; } return j >= 0 ? xs[j] : NaN; }
      if (j > i && j + 1 < xs.length && av[j + 1]) j++;
      return xs[j];
    },
    // 시험 세계에서 이 개입을 할 수 있었던 때 (안내 문구)
    availNote(id, c, x0, x1) {
      const P = c.probe, X = Ex(id);
      if (!P || !c.iv) return '';
      const needs = !!c.iv.available || c.iv.target !== 'global';
      if (!P.done) return needs && !c.fixedAt ? '알맞은 개입 시점을 찾는 중…' : '';
      const av = P.avail[c.id], xs = P.xs;
      if (!av || !xs.length) return '';
      const f = av.indexOf(true), l = av.lastIndexOf(true);
      let t = '';
      if (f < 0) return '시험 삼아 돌린 세계에서는 이 기간에 이 개입을 할 수 있는 때가 없었습니다. 다른 개입이나 기간을 골라 보세요.';
      if (av.every(Boolean)) t = '';
      else if (l === xs.length - 1) t = `시험 삼아 돌린 세계에서는 ${short(X.xfmt(xs[f]))}쯤부터 할 수 있었습니다.`;
      else t = `시험 삼아 돌린 세계에서는 ${short(X.xfmt(xs[f]))} ~ ${short(X.xfmt(xs[l]))} 무렵에 할 수 있었습니다.`;
      // 고른 때와 가장 가까운 확인 지점에서 불가능했으면 알림
      let ni = 0, nd = Infinity;
      xs.forEach((x, i) => { const d = Math.abs(axisFrac(X.axis, x0, x, x1) - axisFrac(X.axis, x0, c.at, x1)); if (d < nd) { nd = d; ni = i; } });
      if (!av[ni]) t += (t ? ' ' : '') + '지금 고른 때에는 적용되지 않을 수 있습니다.';
      return t;
    },
    // 질문 4의 조건을 이어받아 질문 1~3을 돌릴 때의 조건. 모두 기본값이면 없는 것과 같습니다.
    carried(id) {
      const raw = this.st.xcond[id];
      if (!raw) return null;
      const X = Ex(id), vals = {};
      X.conditions.forEach((k) => { vals[k.key] = fin(raw[k.key]) ? raw[k.key] : k.def; });
      const diff = X.conditions.filter((k) => Math.abs(vals[k.key] - k.def) > 1e-9);
      if (!diff.length) return null;
      return { cond: Object.assign({}, raw), label: this.sideLabel(X, vals) || '직접 조절한 조건', diff: diff.map((k) => `${k.label} ${k.fmt ? k.fmt(vals[k.key]) : WS.trimNum(vals[k.key])}`) };
    },
    carryHTML(id) {
      const c = this.carried(id);
      if (!c) return '';
      return `<div class="lab-box lab-carry"><div class="lab-box-h">${WS.icon('scale')}시작 조건: ${esc(c.label)}</div>
        <p class="lf-h">이 실험의 모든 세계는 기본값이 아니라 이 조건으로 돌아갑니다. ${esc(c.diff.join(' · '))}</p>
        <button type="button" class="btn sm" data-clearcond>기본값으로 되돌리기</button></div>`;
    },
    condCfg(id) {
      const X = Ex(id);
      const c = this.st.cond[id] || {};
      const norm = (side) => { const o = {}; X.conditions.forEach((k) => { const v = c[side] ? c[side][k.key] : undefined; o[k.key] = fin(v) ? Math.min(k.max, Math.max(k.min, v)) : k.def; }); return o; };
      let A = norm('A'), B = norm('B');
      if (!c.B && X.presets[0]) { B = Object.assign({}, B, X.presets[0].cond); }
      return { X, A, B };
    },
    sideLabel(X, vals) {
      const isDef = X.conditions.every((k) => Math.abs(vals[k.key] - k.def) < 1e-9);
      if (isDef) return '기본값';
      const p = X.presets.find((pr) => X.conditions.every((k) => Math.abs(vals[k.key] - (pr.cond[k.key] !== undefined ? pr.cond[k.key] : k.def)) < 1e-9));
      return p ? p.label : null;
    },
    /* 현재 설정으로 실험 구성 */
    config() {
      const st = this.st, q = st.q, id = this.modeId(q), X = Ex(id), opts = this.setupOpts(q, id);
      const span = X.span(opts), x0 = span[0], x1 = this.horizon(id, opts);
      const cfg = { q, modeId: id, opts, x0, x1, N: this.N(id), seed: st.seed >>> 0, samples: 64, axis: X.axis };
      if (q !== 4) { const c = this.carried(id); if (c) { cfg.cond = c.cond; cfg.condLabel = c.label; } }
      if (q === 3) {
        const iv = this.ivCfg(id, opts, x0, x1);
        cfg.iv = iv.iv ? { id: iv.iv.id, name: iv.iv.name, at: iv.at, target: iv.iv.target === 'global' ? null : iv.target, reroll: iv.reroll, coupled: iv.coupled } : null;
        cfg.probe = iv.auto && !iv.fixedAt ? iv.probe : null;
        // reroll: 개입 직후 개입한 세계의 주사위를 섞음 (관측 화면에서도 같은 예약으로 똑같이 재현됨)
        cfg.schedule = cfg.iv ? [{ id: cfg.iv.id, at: cfg.iv.at, target: cfg.iv.target, reroll: !!cfg.iv.reroll }] : null;
        if (cfg.iv && cfg.iv.target) { const t = X.targets.find((tt) => tt.key === cfg.iv.target); cfg.iv.targetLabel = t ? t.label : ''; }
      }
      if (q === 4) {
        const c = this.condCfg(id);
        cfg.condA = c.A; cfg.condB = c.B;
        cfg.labelA = this.sideLabel(X, c.A) || '조건 A'; cfg.labelB = this.sideLabel(X, c.B) || '조건 B';
        cfg.sameCond = X.conditions.every((k) => Math.abs(c.A[k.key] - c.B[k.key]) <= 1e-9);
      }
      return cfg;
    },
    specs(cfg) {
      const base = (i) => Object.assign({ modeId: cfg.modeId, opts: cfg.opts, seed: (cfg.seed + i * SEED_STEP) >>> 0, x1: cfg.x1, samples: cfg.samples, lite: true }, cfg.cond ? { cond: cfg.cond } : null);
      const out = [];
      for (let i = 0; i < cfg.N; i++) {
        if (cfg.q === 3) out.push(Object.assign(base(i), { pair: { schedule: cfg.schedule || [] } }));
        else if (cfg.q === 4) out.push(Object.assign(base(i), { cond: cfg.condA }));
        else out.push(base(i));
      }
      if (cfg.q === 4) for (let i = 0; i < cfg.N; i++) out.push(Object.assign(base(i), { cond: cfg.condB }));
      return out;
    },
    calKey(cfg) { return cfg.modeId + '|' + JSON.stringify(cfg.opts); },
    perWorldMs(cfg) {
      const X = Ex(cfg.modeId);
      const H = this.horizonList(cfg.modeId, cfg.opts);
      const def = (H.find((o) => o.def) || H[H.length - 1] || { value: cfg.x1 }).value;
      const f = Math.max(0.05, axisFrac(X.axis, cfg.x0, cfg.x1, def));
      const base = this.cal[this.calKey(cfg)] || (cfg.modeId === 'civ' && COST_CIV[cfg.opts.start]) || COST[cfg.modeId] || 3000;
      return base * f;
    },
    estimate(cfg) {
      const pool = LC().pool;
      const workers = pool.canWork() ? pool.calcSize() : 1;
      const jobs = cfg.q === 4 ? cfg.N * 2 : cfg.N;
      const per = this.perWorldMs(cfg) * (cfg.q === 3 ? 2 : 1);
      const par = Math.max(1, Math.min(workers, jobs));
      return { ms: Math.ceil(jobs / par) * per * (workers > 1 ? 1.15 : 1.05), workers };
    },

    /* ---------- 열기 / 닫기 ---------- */
    open(preset) {
      this.init();
      this.build();
      const st = this.st;
      if (preset && typeof preset === 'object') {
        if ([1, 2, 3, 4].includes(preset.q)) st.q = preset.q;
        const q = st.q;
        if (preset.modeId && WS.modes[preset.modeId]) {
          st.qs[q] = { modeId: preset.modeId };
          if (preset.opts) {
            const m = WS.modes[preset.modeId], o = {};
            (m.setup || []).forEach((f) => { if (preset.opts[f.id] !== undefined) o[f.id] = preset.opts[f.id]; });
            st.setup[this.setupKey(q, preset.modeId)] = o;
          }
          // 관측 화면에서 가져온 시작 조건도 함께 이어받습니다 (없으면 기본 조건)
          const pc = preset.opts && preset.opts.cond;
          if (pc && Object.keys(pc).length) st.xcond[preset.modeId] = Object.assign({}, pc);
          else delete st.xcond[preset.modeId];
        } else if (q === 1 && !preset.keep) {
          // 지금부터의 미래: 문명 · 2026년 (기본 조건)
          st.qs[1] = { modeId: 'civ' };
          delete st.xcond.civ;
          if (WS.modes.civ) st.setup[this.setupKey(1, 'civ')] = Object.assign({}, this.st.setup[this.setupKey(1, 'civ')] || {}, { start: 'ad2026' });
        }
        if (WS.App && WS.App.seed && !this.res[q] && !this.running) st.seed = WS.App.seed >>> 0;
        this.save();
      }
      const lab = $('lab');
      ['lobby', 'observe'].forEach((id) => { const el = $(id); if (el) el.hidden = true; });
      lab.hidden = false;
      this.render();
      if (preset) { lab.scrollTop = 0; this.spot = null; }
    },
    // "실험실로 돌아가기": 설정과 결과를 그대로 둔 채, 관측하러 갔던 그 줄을 다시 보여 줌
    resume() { this.open(); this.restoreSpot(); },
    rememberSpot(btn) {
      const all = [...$('labOut').querySelectorAll('[data-open]')];
      this.spot = { q: this.st.q, idx: all.indexOf(btn), top: btn.getBoundingClientRect().top };
    },
    restoreSpot() {
      const sp = this.spot;
      this.spot = null;
      if (!sp || sp.idx < 0 || sp.q !== this.st.q || !this.res[sp.q]) return;
      const go = () => {
        const btn = $('labOut').querySelectorAll('[data-open]')[sp.idx];
        if (!btn) return;
        const d = btn.getBoundingClientRect().top - sp.top;
        if (Math.abs(d) < 1) return;
        const lab = $('lab'), oy = getComputedStyle(lab).overflowY;
        if (oy === 'auto' || oy === 'scroll') lab.scrollTop += d;
        else window.scrollBy(0, d); // 좁은 화면에서는 창 전체가 스크롤됩니다
      };
      go();
      // 화면 전환이 곧이어 창을 맨 위로 되돌릴 수 있으므로 끝난 뒤에 한 번 더 맞춥니다
      Promise.resolve().then(go);
      setTimeout(go, 0);
    },
    close() { const lab = $('lab'); if (lab) lab.hidden = true; },
    toLobby() { this.close(); if (WS.App && WS.App.toLobby) WS.App.toLobby(); },

    /* ---------- 뼈대 ---------- */
    build() {
      if (this.built) return;
      const lab = $('lab');
      if (!lab) throw new Error('#lab section missing');
      if (!document.getElementById('lab-style')) {
        const s = document.createElement('style');
        s.id = 'lab-style';
        s.textContent = CSS;
        document.head.appendChild(s);
      }
      try { FONT = (getComputedStyle(document.body).getPropertyValue('--f-body') || '').trim() || 'sans-serif'; } catch (e) { /* 무시 */ }
      lab.setAttribute('aria-label', '다중 세계 실험실');
      lab.innerHTML = `<div class="lab-in">
        <header class="lab-head">
          <div>
            <span class="lab-kicker">${WS.icon('flask')}다중 세계 실험실</span>
            <h2>여러 세계를 돌려 질문에 답합니다</h2>
            <p>같은 규칙에서 씨앗(우연의 흐름)만 바꾼 세계 여러 개를 화면 없이 빠르게 돌린 뒤, 결과를 모아 한눈에 보여 줍니다.</p>
          </div>
          <button class="btn ghost" type="button" data-act="lobby">${WS.icon('back')}<span>로비로</span></button>
        </header>
        <div class="lab-qs" role="tablist" aria-label="질문 고르기">${QS.map((Q) => `
          <button class="lab-q" type="button" role="tab" data-q="${Q.q}" aria-selected="false">${WS.icon(Q.icon)}
            <span class="n">질문 ${Q.q} · ${Q.tag}</span><b>${esc(Q.title)}</b><span class="s">${esc(Q.sub)}</span></button>`).join('')}
        </div>
        <div class="lab-grid">
          <form class="lab-setup" id="labSetup" novalidate></form>
          <div class="lab-out" id="labOut" aria-live="polite"></div>
        </div>
      </div>`;
      lab.querySelector('[data-act="lobby"]').addEventListener('click', () => this.toLobby());
      lab.querySelectorAll('.lab-q').forEach((b) => b.addEventListener('click', () => { this.st.q = +b.dataset.q; this.save(); this.render(); }));
      const form = $('labSetup');
      form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches && e.target.matches('input[data-seed]')) { e.preventDefault(); e.target.blur(); } });
      form.addEventListener('submit', (e) => { e.preventDefault(); if (this.running && this.running.q === this.st.q) this.cancel(); else this.run(); });
      form.addEventListener('click', (e) => this.onSetupClick(e));
      form.addEventListener('change', (e) => this.onSetupChange(e));
      form.addEventListener('input', (e) => this.onSetupInput(e));
      $('labOut').addEventListener('click', (e) => this.onOutClick(e));
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => charts.forEach(draw)).catch(() => {});
      this.built = true;
    },
    render() {
      const lab = $('lab');
      lab.querySelectorAll('.lab-q').forEach((b) => b.setAttribute('aria-selected', +b.dataset.q === this.st.q ? 'true' : 'false'));
      this.renderSetup();
      this.renderOut();
    },

    /* ---------- 설정 패널 ---------- */
    renderSetup() {
      const st = this.st, q = st.q, id = this.modeId(q), m = WS.modes[id], X = Ex(id);
      const opts = this.setupOpts(q, id);
      const span = X.span(opts), x0 = span[0];
      const H = this.horizonList(id, opts), hz = this.horizon(id, opts);
      const N = this.N(id);
      const Q = QS[q - 1];
      let h = `<h3>실험 설정</h3>`;
      h += `<div class="lf"><span class="lf-l">어느 단계를 실험할까요?</span><div class="lab-stages">${ORDER.filter((k) => WS.modes[k]).map((k) => `
        <button type="button" class="lab-stage" data-stage="${k}" aria-pressed="${k === id}">${WS.icon(STAGE_ICON[k] || 'globe')}<span><b>${esc(WS.modes[k].name)}</b><small>${esc(WS.modes[k].when || '')}</small></span></button>`).join('')}</div>`;
      if (q === 1 && id !== 'civ') h += `<p class="lf-h">‘지금부터의 미래’는 보통 문명 단계를 2026년에서 시작해 봅니다. 다른 단계도 같은 방식으로 실험할 수 있어요.</p>`;
      if (q === 2 && id === 'civ' && opts.start === 'ad1500') h += `<p class="lf-h">기본은 1500년에서 2026년까지입니다. 실제 역사와 가장 잘 맞춰 둔 구간이라, 결과의 ◆ 표시로 실제 역사와 견줄 수 있습니다.</p>`;
      h += `</div>`;
      (m.setup || []).forEach((f) => {
        h += `<label class="lf"><span class="lf-l">${esc(f.label)}</span><select data-setup="${esc(f.id)}">${f.options.map(([v, l]) => `<option value="${esc(v)}"${v === opts[f.id] ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
      });
      if (q !== 4) h += this.carryHTML(id);
      const fromCap = startTxt(X, x0) === '처음';
      // 로그 축 단계(우주 · 항성계)의 '직접 지켜보기'는 실험 기본 기간보다 길게 이어집니다
      const obsEnd = span[1], longer = X.axis === 'log' && obsEnd > hz * 1.001;
      const canPick = longer && H.some((o) => Math.abs(o.value - obsEnd) <= 1e-6 * obsEnd);
      h += `<label class="lf"><span class="lf-l">언제까지 볼까요?</span><select data-horizon>${H.map((o, i) => `<option value="${i}"${o.value === hz ? ' selected' : ''}>${esc(o.label)}${o.def ? ' · 기본' : ''}</option>`).join('')}</select>
        <span class="lf-h">${fromCap ? `처음부터 ${esc(short(X.xfmt(hz)))}까지` : `${esc(short(X.xfmt(x0)))}에서 출발해 ${esc(short(X.xfmt(hz)))}까지`} 지켜봅니다.${longer ? ` ‘직접 지켜보기’는 ${esc(short(X.xfmt(obsEnd)))}까지 이어집니다${canPick ? '. 더 멀리 보려면 위에서 고르세요' : ''}.` : ''}</span></label>`;
      const ns = NS.includes(N) ? NS : NS.concat([N]).sort((a, b) => a - b);
      h += `<div class="lf"><span class="lf-l">${q === 3 ? '쌍둥이 세계 몇 쌍?' : q === 4 ? '조건마다 세계 몇 개?' : '세계 몇 개?'}</span>
        <div class="seg" role="group" aria-label="세계 수">${ns.map((n) => `<button type="button" data-n="${n}" aria-pressed="${n === N}">${n}</button>`).join('')}</div>
        <span class="lf-h">${q === 3 ? `쌍마다 세계 2개(원래 · 개입)를 돌립니다. ` : q === 4 ? `A와 B에 각각 ${N}개씩, 모두 ${N * 2}개를 돌립니다. ` : ''}많을수록 결과가 믿을 만해지지만 오래 걸립니다.</span></div>`;
      if (q === 3) h += this.ivHTML(id, opts, x0, hz);
      if (q === 4) h += this.condHTML(id);
      h += `<div class="lf"><span class="lf-l">시작 씨앗</span><div class="lab-seed"><input type="text" data-seed inputmode="numeric" autocomplete="off" aria-label="시작 씨앗" value="${st.seed >>> 0}"><button type="button" class="btn" data-reroll title="새 씨앗 뽑기" aria-label="새 씨앗 뽑기">${WS.icon('reroll')}</button></div>
        <span class="lf-h">세계마다 씨앗이 하나씩 다릅니다. 씨앗이 같으면 결과도 똑같이 다시 나옵니다.</span></div>`;
      const R = this.running, running = R && R.q === q, busy = R && R.q !== q;
      const blocked = (q === 3 && !this.ivCfg(id, opts, x0, hz).iv) || (q === 4 && !X.conditions.length);
      const label = running ? WS.icon('close') + '실험 취소' : this.waitProbe ? WS.icon('info') + '개입 시점 확인 중…' : WS.icon('play') + `${esc(Q.tag)} 실험 시작`;
      // 다른 질문의 실험이 도는 중이면 시작하지 못하게 (진행 중인 실험을 말없이 버리지 않음)
      h += `<div class="lab-go"><div class="lab-est" id="labEst"></div>
        <button type="submit" class="btn ${running ? '' : 'primary'} lab-run"${(blocked && !running) || busy || this.waitProbe ? ' disabled' : ''}>${label}</button>
        ${busy ? `<p class="lab-busy">${WS.icon('info')}<span>질문 ${R.q} 실험이 아직 진행 중입니다. 그 실험이 끝나거나 취소한 뒤에 새 실험을 시작할 수 있어요. <button type="button" class="lab-link" data-goq="${R.q}">진행 중인 실험 보기</button></span></p>` : ''}</div>`;
      $('labSetup').innerHTML = h;
      this.updateEstimate();
    },
    ivHTML(id, opts, x0, x1) {
      const X = Ex(id), c = this.ivCfg(id, opts, x0, x1);
      let h = `<div class="lab-box" id="labIv"><div class="lab-box-h">${WS.icon('butterfly')}쌍둥이 중 한쪽에만 할 개입</div>`;
      if (!c.list.length) return h + `<p class="lab-note">이 단계에는 실험실에서 쓸 수 있는 개입이 아직 없습니다. 다른 단계를 골라 보세요.</p></div>`;
      h += `<label class="lf"><span class="lf-l">무엇을?</span><select data-iv>${c.list.map((iv) => `<option value="${esc(iv.id)}"${iv.id === c.id ? ' selected' : ''}>${esc(iv.name)}</option>`).join('')}</select></label>`;
      if (c.iv && c.iv.desc) h += `<p class="lab-ivdesc">${esc(c.iv.desc)}${c.iv.available ? '<br><span style="color:var(--faint)">이 개입은 세계가 알맞은 상태일 때만 할 수 있습니다. 고른 때에 조건이 맞지 않으면 적용되지 않고, 결과에 그렇게 알려 드립니다.</span>' : ''}</p>`;
      const pos = Math.round(WS.clamp(axisFrac(X.axis, x0, c.at, x1), 0, 1) * 1000);
      const note = this.availNote(id, c, x0, x1);
      h += `<div class="lf"><span class="lf-l">언제? <b data-atv>${esc(short(X.xfmt(c.at)))}</b></span><input type="range" min="1" max="1000" step="1" value="${pos}" data-at aria-label="개입 시점">
        <span class="lf-h">${esc(short(X.xfmt(x0)))} ~ ${esc(short(X.xfmt(x1)))} 사이에서 고릅니다.${c.defNote ? ' ' + esc(c.defNote) : c.auto && !c.fixedAt && c.probe && c.probe.done ? ' 처음 값은 이 개입이 가능한 이른 때로 골랐습니다.' : ''}</span>
        <span class="lf-h lab-avnote" data-avnote${note ? '' : ' hidden'}>${esc(note)}</span></div>`;
      if (c.iv && c.iv.target !== 'global' && X.targets.length) {
        h += `<label class="lf"><span class="lf-l">어디에?</span><select data-target>${X.targets.map((t) => `<option value="${esc(t.key)}"${t.key === c.target ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
          <span class="lf-h">정확한 지점은 고른 지역 안에서 쌍마다 우연히 정해집니다.</span></label>`;
      }
      // 개입 뒤의 우연: 함께 바뀜(기본) / 그대로
      const opt = (on) => { const [t, d] = REROLL_TXT[on ? 'on' : 'off']; return { t, d: d(id), sel: c.reroll === on }; };
      const o1 = opt(true), o0 = opt(false);
      h += `<div class="lf"><span class="lf-l">개입 뒤의 우연</span>
        <div class="seg seg-t" role="group" aria-label="개입 뒤의 우연">
          <button type="button" data-rr="1" aria-pressed="${o1.sel}"${c.coupled ? ' disabled' : ''}>${esc(o1.t)}</button>
          <button type="button" data-rr="0" aria-pressed="${o0.sel}"${c.coupled ? ' disabled' : ''}>${esc(o0.t)}</button></div>
        <ul class="lab-rr">${[o1, o0].map((o) => `<li class="${o.sel ? 'on' : ''}"><b>${esc(o.t.replace(/\s*\(.*\)$/, ''))}</b> ${esc(o.d)}</li>`).join('')}</ul>
        ${c.coupled ? `<p class="lab-note">이 모형은 사람 수가 조금만 달라져도 그 뒤에 일어날 우연이 모두 달라집니다. 그래서 언제나 ‘함께 바뀜’으로 계산됩니다.</p>`
          : !c.reroll && c.id === 'butterfly' ? `<p class="lab-note">같은 주사위에서는 나비의 날갯짓처럼 아주 작은 개입이 아무 차이도 만들지 못할 수 있습니다. 그렇다면 결과에 그대로 알려 드립니다.</p>` : ''}</div>`;
      h += `<p class="lf-h">쌍둥이 세계는 같은 씨앗으로 출발해 개입 전까지 완전히 같습니다. 개입 자체는 따로 떼어 둔 우연을 써서, 개입하지 않은 세계는 원래 흐름 그대로 갑니다.</p></div>`;
      return h;
    },
    condHTML(id) {
      const { X, A, B } = this.condCfg(id);
      let h = `<div class="lab-box"><div class="lab-box-h">${WS.icon('scale')}두 가지 시작 조건</div>`;
      if (!X.conditions.length) {
        return h + `<p class="lab-note">이 단계는 아직 실험실에서 바꿀 수 있는 시작 조건이 준비되지 않았어요. 대신 위의 설정(예: 시작 시점)을 바꿔 가며 ‘질문 2 · 수렴’ 실험을 각각 돌려 비교해 볼 수 있습니다.</p></div>`;
      }
      const presetSel = (side, vals) => {
        const lab = this.sideLabel(X, vals);
        return `<label><span style="display:flex;gap:6px;align-items:center"><span class="tagab ${side.toLowerCase()}">${side}</span>조건 ${side}</span><select data-preset="${side}">
          <option value="def"${lab === '기본값' ? ' selected' : ''}>기본값</option>
          ${X.presets.map((p, i) => `<option value="${i}"${lab === p.label ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}
          ${lab ? '' : '<option value="custom" selected>직접 조절함</option>'}</select></label>`;
      };
      h += `<div class="lab-presets">${presetSel('A', A)}${presetSel('B', B)}</div>`;
      const pdesc = (vals) => { const p = X.presets.find((pr) => pr.label === this.sideLabel(X, vals)); return p && p.desc ? p.desc : ''; };
      const dA = pdesc(A), dB = pdesc(B);
      if (dA || dB) h += `<p class="lf-h">${dA ? `<b style="color:${CA}">A</b> ${esc(dA)} ` : ''}${dB ? `<b style="color:${CB}">B</b> ${esc(dB)}` : ''}</p>`;
      if (X.conditions.every((k) => Math.abs(A[k.key] - B[k.key]) <= 1e-9)) h += `<p class="lab-note">지금은 A와 B의 조건이 같습니다. 씨앗도 같아서 두 묶음이 똑같이 나옵니다. 차이를 보려면 한쪽 조건을 바꿔 보세요.</p>`;
      h += `<div>`;
      X.conditions.forEach((k) => {
        const row = (side, vals) => {
          const v = vals[k.key], chg = Math.abs(v - k.def) > 1e-9;
          const f = k.fmt ? k.fmt(v) : WS.trimNum(v);
          if (k.kind === 'bool') return `<div class="lab-cond-r"><span class="tagab ${side.toLowerCase()}">${side}</span><input type="checkbox" class="${side.toLowerCase()}" data-cond="${side}:${esc(k.key)}"${v ? ' checked' : ''} aria-label="${esc(k.label)} ${side}"><b class="${chg ? 'chg' : ''}" data-cv="${side}:${esc(k.key)}">${esc(f)}</b></div>`;
          return `<div class="lab-cond-r"><span class="tagab ${side.toLowerCase()}">${side}</span><input type="range" class="${side.toLowerCase()}" min="0" max="1000" step="1" value="${this.condPos(k, v)}" data-cond="${side}:${esc(k.key)}" aria-label="${esc(k.label)} ${side}"><b class="${chg ? 'chg' : ''}" data-cv="${side}:${esc(k.key)}">${esc(f)}</b></div>`;
        };
        h += `<div class="lab-cond"><div class="lab-cond-h"><span>${esc(k.label)}</span></div>${k.desc ? `<p class="lf-h">${esc(k.desc)}</p>` : ''}${row('A', A)}${row('B', B)}</div>`;
      });
      h += `</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn sm" data-reset="A">A = 기본값</button><button type="button" class="btn sm" data-reset="B">B = 기본값</button><button type="button" class="btn sm" data-swap>A ↔ B 바꾸기</button></div></div>`;
      return h;
    },
    /* 슬라이더 눈금: 양수 배율이 넓으면 로그, 0을 지나며 아주 넓으면(예: 암흑 에너지 -3…200) '대칭 로그'
       (기본값 크기 c 안쪽은 거의 선형, 밖은 로그) → 없음(0)·×1·×2 같은 작은 값도 고를 수 있게 */
    condMap(k) {
      if (k.kind === 'mult' && k.min > 0 && k.max / k.min > 3) return 'log';
      const c = Math.max(Math.abs(k.def), k.step || 0, 1e-9);
      return k.kind !== 'bool' && (k.max - k.min) / c > 20 ? 'symlog' : 'lin';
    },
    condSym(k) { const c = Math.max(Math.abs(k.def), k.step || 0, 1e-9); return { c, f: (x) => Math.sign(x) * Math.log10(1 + Math.abs(x) / c), fi: (u) => Math.sign(u) * c * (Math.pow(10, Math.abs(u)) - 1) }; },
    condPos(k, v) {
      const mp = this.condMap(k);
      let t;
      if (mp === 'log') t = Math.log(v / k.min) / Math.log(k.max / k.min);
      else if (mp === 'symlog') { const { f } = this.condSym(k); t = (f(v) - f(k.min)) / (f(k.max) - f(k.min)); }
      else t = (v - k.min) / (k.max - k.min);
      return Math.round(WS.clamp(t, 0, 1) * 1000);
    },
    condVal(k, pos) {
      const t = WS.clamp(pos / 1000, 0, 1), mp = this.condMap(k);
      let v;
      if (mp === 'log') { v = k.min * Math.pow(k.max / k.min, t); const p = Math.pow(10, Math.floor(Math.log10(v)) - 1); v = Math.round(v / p) * p; }
      else if (mp === 'symlog') {
        const { f, fi } = this.condSym(k);
        v = fi(f(k.min) + t * (f(k.max) - f(k.min)));
        if (k.step > 0 && Math.abs(v) <= 10 * k.step) v = Math.round(v / k.step) * k.step;
        else if (v !== 0) { const p = Math.pow(10, Math.floor(Math.log10(Math.abs(v))) - 1); v = Math.round(v / p) * p; }
      } else {
        v = k.min + t * (k.max - k.min);
        if (k.step > 0) v = Math.round((v - k.min) / k.step) * k.step + k.min;
      }
      // 기본값 바로 근처면 기본값으로 붙임 (트랙의 ±0.4%)
      if (Math.abs(this.condPos(k, k.def) - pos) <= 4) v = k.def;
      return +WS.clamp(v, k.min, k.max).toPrecision(6);
    },
    updateEstimate() {
      const el = $('labEst');
      if (!el) return;
      let cfg;
      try { cfg = this.config(); } catch (e) { el.textContent = ''; return; }
      const e = this.estimate(cfg);
      const total = cfg.q === 4 ? cfg.N * 2 : cfg.q === 3 ? cfg.N * 2 : cfg.N;
      el.innerHTML = `${WS.icon('info')}<span>세계 ${total}개 · 예상 시간 약 ${esc(mmss(e.ms))} · ${e.workers > 1 ? `계산 작업자 ${e.workers}개가 나눠 계산합니다` : '이 화면에서 직접 계산합니다'} (대략적인 값)</span>`;
    },
    setX(fn) { fn(this.st); this.save(); },
    onSetupClick(e) {
      const b = e.target.closest('button');
      if (!b) return;
      const st = this.st, q = st.q, id = this.modeId(q);
      if (b.dataset.goq) { st.q = +b.dataset.goq; this.save(); this.render(); return; }
      if (b.hasAttribute('data-clearcond')) { delete st.xcond[id]; this.renderSetup(); return; }
      if (b.dataset.rr !== undefined) { if (!b.disabled) { st.iv[id] = Object.assign({}, st.iv[id] || {}, { reroll: b.dataset.rr === '1' }); this.save(); this.renderSetup(); } return; }
      if (b.dataset.stage) { st.qs[q] = { modeId: b.dataset.stage }; this.save(); this.render(); return; }
      if (b.dataset.n) { st.N[id] = +b.dataset.n; this.save(); this.renderSetup(); return; }
      if (b.hasAttribute('data-reroll')) { st.seed = WS.randomSeed(); this.save(); const inp = $('labSetup').querySelector('[data-seed]'); if (inp) inp.value = st.seed; return; }
      if (b.dataset.reset) { const c = Object.assign({}, st.cond[id] || {}); const { X } = this.condCfg(id); const o = {}; X.conditions.forEach((k) => { o[k.key] = k.def; }); c[b.dataset.reset] = o; st.cond[id] = c; this.save(); this.renderSetup(); return; }
      if (b.hasAttribute('data-swap')) { const { A, B } = this.condCfg(id); st.cond[id] = { A: B, B: A }; this.save(); this.renderSetup(); }
    },
    onSetupChange(e) {
      const t = e.target, st = this.st, q = st.q, id = this.modeId(q);
      if (t.dataset.setup !== undefined) {
        const k = this.setupKey(q, id);
        st.setup[k] = Object.assign({}, this.setupOpts(q, id), { [t.dataset.setup]: t.value });
        this.save(); this.renderSetup(); return;
      }
      if (t.hasAttribute('data-horizon')) {
        const opts = this.setupOpts(q, id), H = this.horizonList(id, opts), o = H[+t.value];
        if (o) st.horizon[this.hKey(id, opts)] = o.value;
        this.save(); this.renderSetup(); return;
      }
      if (t.hasAttribute('data-seed')) {
        const v = parseInt(String(t.value).replace(/[^0-9]/g, ''), 10);
        if (v > 0) st.seed = v >>> 0;
        t.value = st.seed; this.save(); return;
      }
      if (t.hasAttribute('data-iv')) { st.iv[id] = Object.assign({}, st.iv[id] || {}, { id: t.value }); this.save(); this.renderSetup(); return; }
      if (t.hasAttribute('data-target')) {
        const c = Object.assign({}, st.iv[id] || {}, { target: t.value });
        const ivId = this.ivCfg(id, this.setupOpts(q, id), X0(id, this.setupOpts(q, id)), this.horizon(id, this.setupOpts(q, id))).id;
        c.tgBy = Object.assign({}, c.tgBy || {}, { [ivId]: t.value });
        st.iv[id] = c;
        this.save(); return;
      }
      if (t.dataset.preset) {
        const side = t.dataset.preset, { X, A, B } = this.condCfg(id);
        const o = {};
        X.conditions.forEach((k) => { o[k.key] = k.def; });
        if (t.value !== 'def' && t.value !== 'custom') Object.assign(o, (X.presets[+t.value] || {}).cond || {});
        if (t.value === 'custom') return;
        st.cond[id] = { A: side === 'A' ? o : A, B: side === 'B' ? o : B };
        this.save(); this.renderSetup(); return;
      }
      if (t.dataset.cond && t.type === 'checkbox') { this.setCond(id, t.dataset.cond, t.checked ? 1 : 0); this.renderSetup(); return; }
      if (t.dataset.cond) { this.renderSetup(); }
    },
    onSetupInput(e) {
      const t = e.target, st = this.st, q = st.q, id = this.modeId(q);
      if (t.hasAttribute('data-at')) {
        const X = Ex(id), opts = this.setupOpts(q, id), x0 = X.span(opts)[0], x1 = this.horizon(id, opts);
        const f = +t.value / 1000;
        let at = niceAt(X.axis, x0, x1, axisAt(X.axis, x0, x1, f));
        at = Math.min(x1, Math.max(at, x0 + (x1 - x0) * 1e-6));
        const c0 = this.ivCfg(id, opts, x0, x1);
        const c = Object.assign({}, st.iv[id] || {});
        c.at = Object.assign({}, c.at || {}, { [c0.key]: at });
        st.iv[id] = c;
        const lab = $('labSetup').querySelector('[data-atv]');
        if (lab) lab.textContent = short(X.xfmt(at));
        const note = $('labSetup').querySelector('[data-avnote]');
        if (note) { const t2 = this.availNote(id, Object.assign({}, c0, { at, auto: false }), x0, x1); note.textContent = t2; note.hidden = !t2; }
        this.save();
        return;
      }
      if (t.dataset.cond && t.type === 'range') {
        const [side, key] = t.dataset.cond.split(':');
        const k = Ex(id).conditions.find((c) => c.key === key);
        if (!k) return;
        const v = this.condVal(k, +t.value);
        this.setCond(id, t.dataset.cond, v);
        const lab = $('labSetup').querySelector(`[data-cv="${side}:${key}"]`);
        if (lab) { lab.textContent = k.fmt ? k.fmt(v) : WS.trimNum(v); lab.classList.toggle('chg', Math.abs(v - k.def) > 1e-9); }
      }
    },
    setCond(id, sk, v) {
      const [side, key] = sk.split(':');
      const { A, B } = this.condCfg(id);
      const c = { A, B };
      c[side] = Object.assign({}, c[side], { [key]: v });
      this.st.cond[id] = c;
      this.save();
    },

    /* ---------- 실행 ---------- */
    async run() {
      if (!LC() || this.running || this.waitProbe) return; // 실험은 한 번에 하나 (다른 실험을 말없이 취소하지 않음)
      let cfg;
      try { cfg = this.config(); } catch (e) { console.error(e); return; }
      // 질문 3: 기본 개입 시점을 아직 찾는 중이면 끝날 때까지 기다렸다가 다시 구성
      if (cfg.q === 3 && cfg.probe && !cfg.probe.done) {
        this.waitProbe = true; this.renderSetup();
        await this.probeReady(cfg.probe);
        this.waitProbe = false;
        if (this.running) { this.renderSetup(); return; }
        try { cfg = this.config(); } catch (e) { console.error(e); this.renderSetup(); return; }
        if (cfg.q !== 3) { this.renderSetup(); return; }
      }
      if (cfg.q === 3 && !cfg.iv) return;
      if (cfg.q === 4 && !Ex(cfg.modeId).conditions.length) return;
      delete cfg.probe;
      const specs = this.specs(cfg);
      const token = {};
      this.running = { q: cfg.q, cfg, token, t0: performance.now(), prog: { done: 0, total: specs.length, frac: 0, workers: 0 }, jobs: specs.length };
      this.render();
      // 좁은 화면에서는 결과 영역이 설정 아래에 있으므로 진행 상황으로 스크롤
      try { if (window.matchMedia('(max-width: 900px)').matches) $('labOut').scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* 무시 */ }
      let res = null;
      try { res = await LC().pool.run(specs, (p) => this.onProgress(token, p)); } catch (e) { console.error(e); res = null; }
      if (!this.running || this.running.token !== token) return; // 다른 실험이 시작되었거나 취소됨
      const elapsed = performance.now() - this.running.t0;
      const calc = this.running.prog;
      this.running = null;
      if (!res) { this.render(); return; }
      this.finish(cfg, res, elapsed, calc);
    },
    // 결과 분석 → 저장 → 표시
    finish(cfg, res, elapsed, calc) {
      let a;
      const M = WS.modes[cfg.modeId];
      try {
        if (cfg.q === 3) a = LC().analyze.intervention(M, res, { at: cfg.iv.at, ivName: cfg.iv.name, reroll: !!cfg.iv.reroll, coupled: !!cfg.iv.coupled, opts: cfg.opts });
        else if (cfg.q === 4) a = LC().analyze.compare(M, res.slice(0, cfg.N), res.slice(cfg.N), { labelA: cfg.labelA, labelB: cfg.labelB, sameCond: !!cfg.sameCond, opts: cfg.opts });
        else a = LC().analyze.ensemble(M, res, { q: cfg.q, opts: cfg.opts });
      } catch (e) {
        console.error(e);
        a = { cards: [{ title: '분석 오류', text: '결과를 정리하다 문제가 생겼습니다: ' + (e.message || e), tone: 'warn' }] };
      }
      // 계산 시간 보정 (기본 기간 세계 하나 기준)
      try {
        const ms = res.filter((r) => r && !r.error).map((r) => (r.base ? r.ms / 2 : r.ms)).filter(fin);
        if (ms.length) {
          const X = Ex(cfg.modeId), H = this.horizonList(cfg.modeId, cfg.opts), def = (H.find((o) => o.def) || { value: cfg.x1 }).value;
          const f = Math.max(0.05, axisFrac(X.axis, cfg.x0, cfg.x1, def));
          const med = ms.sort((x, y) => x - y)[Math.floor(ms.length / 2)];
          this.cal[this.calKey(cfg)] = Math.round(med / f);
          lsSet(CAL, this.cal);
        }
      } catch (e) { /* 무시 */ }
      this.res[cfg.q] = { cfg, a, elapsed, calc, at: Date.now() };
      if ($('lab').hidden) return;
      this.render();
      const out = $('labOut');
      if (out && out.getBoundingClientRect().top < 0) out.scrollIntoView({ block: 'start', behavior: 'smooth' });
    },
    cancel() {
      if (!this.running) return;
      this.running = null;
      LC().pool.cancel();
      this.render();
    },
    onProgress(token, p) {
      if (!this.running || this.running.token !== token) return;
      this.running.prog = p;
      const t = performance.now();
      if (t - this.lastProg < 180 && p.done < p.total) return;
      this.lastProg = t;
      this.paintProgress();
    },
    paintProgress() {
      const R = this.running;
      if (!R || R.q !== this.st.q) { const b = $('labBanner'); if (b && R) b.querySelector('b').textContent = pct(R.prog.frac); return; }
      const p = R.prog;
      const bar = $('labBar'), meta = $('labMeta'), dots = $('labDots');
      if (!bar) return;
      bar.style.width = (p.frac * 100).toFixed(1) + '%';
      const el = performance.now() - R.t0;
      const eta = fin(p.eta) ? mmss(p.eta) : '계산 중';
      const unit = R.q === 3 ? '쌍' : '세계';
      meta.innerHTML = `<span><b>${p.done}</b> / ${p.total} ${unit} 완료</span><span>${p.workers > 0 ? `작업자 <b>${p.workers}</b>개${p.workers > 1 ? ' 동시' : ''} 계산${p.byMain > 0 ? ' · 일부는 이 화면에서' : ''}` : '이 화면에서 계산 중'}</span><span>경과 <b>${mmss(el)}</b></span><span>남은 시간 약 <b>${eta}</b></span>`;
      if (dots) {
        const n = dots.children.length;
        for (let i = 0; i < n; i++) dots.children[i].className = i < p.done ? 'on' : '';
      }
    },

    /* ---------- 결과 영역 ---------- */
    renderOut() {
      resetCharts();
      const out = $('labOut'), q = this.st.q, R = this.running;
      out.innerHTML = '';
      if (R && R.q !== q) {
        const b = document.createElement('div');
        b.className = 'lc-banner'; b.id = 'labBanner';
        b.innerHTML = `<span>질문 ${R.q} 실험이 뒤에서 진행 중입니다 · <b>${pct(R.prog.frac)}</b></span><button type="button" class="btn sm" data-goq="${R.q}">보러 가기</button>`;
        out.appendChild(b);
      }
      if (R && R.q === q) { this.renderProgress(out); return; }
      const res = this.res[q];
      if (!res) { this.renderEmpty(out); return; }
      try {
        if (res.a.kind === 'intervention') this.renderIntervention(out, res);
        else if (res.a.kind === 'compare') this.renderCompare(out, res);
        else if (res.a.kind === 'ensemble') this.renderEnsemble(out, res);
        else this.renderCards(out, res.a.cards || []);
      } catch (e) {
        console.error(e);
        const d = document.createElement('div');
        d.className = 'lc-sec';
        d.innerHTML = `<h3>결과를 그리지 못했습니다</h3><p class="lead">${esc(e.message || e)}</p>`;
        out.appendChild(d);
      }
    },
    renderEmpty(out) {
      const Q = QS[this.st.q - 1];
      const s = document.createElement('section');
      s.className = 'lc-sec lc-empty';
      s.innerHTML = `<div class="ic">${WS.icon(Q.icon)}</div><span class="lc-kicker">질문 ${Q.q} · ${esc(Q.tag)}</span><h3>${esc(Q.title)}</h3><p>${esc(Q.sub)}</p>
        <ol class="lc-steps">${Q.steps.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
        <p class="lf-h">실험 설정을 확인하고 <b style="color:var(--brass-hi)">실험 시작</b>을 누르세요. 결과는 먼저 짧은 답으로, 그다음 그래프로 보여 드립니다.</p>`;
      out.appendChild(s);
    },
    renderProgress(out) {
      const R = this.running, cfg = R.cfg, M = WS.modes[cfg.modeId], X = Ex(cfg.modeId);
      const s = document.createElement('section');
      s.className = 'lc-sec lc-run';
      const n = R.jobs;
      s.innerHTML = `<div class="lc-run-h"><div><span class="lc-kicker">${WS.icon('flask')}실험 중 · 질문 ${cfg.q}</span>
          <h3>${esc(M.name)} · ${esc(startTxt(X, cfg.x0))} → ${esc(short(X.xfmt(cfg.x1)))}</h3></div>
          <button type="button" class="btn" data-cancel>${WS.icon('close')}취소</button></div>
        <div class="lc-prog" role="progressbar" aria-label="실험 진행"><div id="labBar"></div></div>
        <div class="lc-run-meta" id="labMeta">준비 중…</div>
        <div class="lc-dots" id="labDots" aria-hidden="true">${'<i></i>'.repeat(n)}</div>
        <p class="lf-h">세계마다 화면 없이 빠르게 시간을 돌리고 있습니다. 계산이 끝나면 답과 그래프가 여기에 나타납니다.</p>`;
      out.appendChild(s);
      this.paintProgress();
    },
    onOutClick(e) {
      const b = e.target.closest('button,[data-open]');
      if (!b) return;
      if (b.hasAttribute('data-cancel')) { this.cancel(); return; }
      if (b.dataset.goq) { this.st.q = +b.dataset.goq; this.save(); this.render(); return; }
      if (b.dataset.open) { this.rememberSpot(b); this.openWorld(b.dataset.open); return; }
      if (b.dataset.more !== undefined) {
        const t = b.previousElementSibling;
        if (t) t.querySelectorAll('tr.more').forEach((r) => { r.hidden = false; });
        b.remove();
        const res = this.res[this.st.q];
        if (res) res.moreOpen = true; // 다시 그려도 (관측하고 돌아와도) 펼친 채로
      }
    },
    openWorld(code) {
      const res = this.res[this.st.q];
      if (!res) return;
      const { cfg, a } = res;
      const [g, si] = code.split(':');
      const i = +si;
      let r, cond = cfg.cond || null, schedule = null;
      if (g === 'w') r = a.results[i];
      else if (g === 'b') r = a.results[i].base;
      else if (g === 'a') { r = a.results[i].alt; schedule = cfg.schedule; }
      else if (g === 'A') { r = a.resultsA[i]; cond = cfg.condA; }
      else if (g === 'B') { r = a.resultsB[i]; cond = cfg.condB; }
      if (!r) return;
      const opts = LC().worldOpts({ modeId: cfg.modeId, opts: cfg.opts, cond, x1: cfg.x1 });
      const o = { modeId: cfg.modeId, opts, seed: r.seed >>> 0, schedule: schedule ? schedule.map((it) => Object.assign({}, it)) : null };
      if (WS.App && WS.App.openWorld) { this.close(); WS.App.openWorld(o); }
      else console.log('openWorld', o);
    },

    /* ---------- 결과 조각 ---------- */
    sec(out, title, lead, icon) {
      const s = document.createElement('section');
      s.className = 'lc-sec';
      s.innerHTML = `<h3>${icon ? WS.icon(icon) : ''}${title}</h3>${lead ? `<p class="lead">${lead}</p>` : ''}`;
      out.appendChild(s);
      return s;
    },
    head(out, res, extra) {
      const { cfg } = res, M = WS.modes[cfg.modeId], X = Ex(cfg.modeId), Q = QS[cfg.q - 1];
      const setupTxt = (M.setup || []).map((f) => { const o = f.options.find(([v]) => v === cfg.opts[f.id]); return o ? o[1] : ''; }).filter(Boolean).join(' · ');
      const d = document.createElement('div');
      d.className = 'lc-head';
      const unit = cfg.q === 3 ? `쌍둥이 ${cfg.N}쌍` : cfg.q === 4 ? `조건마다 세계 ${cfg.N}개` : `세계 ${cfg.N}개`;
      // 실제로 어디서 계산했는지 그대로 적습니다 (작업자가 멈추면 남은 일은 이 화면에서 계산)
      const c = res.calc || {}, u = cfg.q === 3 ? '쌍은' : '개는';
      const where = c.byMain > 0 && c.byWorker > 0 ? ` (작업자 ${c.peak}개로 시작했지만 작업자가 멈춰 ${c.byMain}${u} 이 화면에서 계산)`
        : c.byMain > 0 ? ' (작업자 없이 이 화면에서 계산)' : c.peak > 0 ? ` (작업자 ${c.peak}개)` : '';
      d.innerHTML = `<div><span class="lc-kicker">${WS.icon(Q.icon)}질문 ${cfg.q} · ${esc(Q.tag)} · 결과</span>
        <h3>${esc(M.name)} · ${esc(startTxt(X, cfg.x0))} → ${esc(short(X.xfmt(cfg.x1)))} · ${unit}</h3>
        <p>${setupTxt ? esc(setupTxt) + ' · ' : ''}${cfg.condLabel ? `시작 조건 ‘${esc(cfg.condLabel)}’ · ` : ''}${extra ? extra + ' · ' : ''}씨앗 ${cfg.seed}부터 · 계산 ${esc(mmss(res.elapsed))}${where}</p></div>`;
      out.appendChild(d);
    },
    renderCards(out, cards) {
      const d = document.createElement('div');
      d.className = 'lc-cards n' + cards.filter((c) => c.tone !== 'main').length; // 답(main)은 한 줄을 다 쓰고, 나머지를 나눕니다
      d.innerHTML = cards.map((c) => `<article class="lc-card ${c.tone || ''}"><div class="t">${c.color ? `<i style="background:${esc(c.color)}"></i>` : ''}${esc(c.title)}</div><p>${esc(c.text)}</p>${c.detail ? `<details class="lc-det"><summary>자세히</summary><p>${esc(c.detail)}</p></details>` : ''}</article>`).join('');
      out.appendChild(d);
    },
    caveat(out) {
      const p = document.createElement('p');
      p.className = 'lc-caveat';
      p.textContent = '모든 결과는 크게 단순화한 모형에서 나온 것이고 예언이 아닙니다. 세계 수가 적으면 작은 차이는 우연일 수 있습니다. p값은 “정말 아무 차이가 없을 때 이만한 차이가 우연히 나올 확률”이며, 0.05보다 작으면 우연으로 보기 어려운 차이로 봅니다.';
      out.appendChild(p);
    },
    outcomeBars(host, rows, ab, labels) {
      const d = document.createElement('div');
      d.className = 'lc-ob';
      if (ab) {
        const lg = document.createElement('div');
        lg.className = 'lc-legend';
        lg.innerHTML = `<span><i class="sq" style="background:${CA}"></i>${esc(labels[0])}</span><span><i class="sq" style="background:${CB}"></i>${esc(labels[1])}</span>`;
        host.appendChild(lg);
      }
      // 많이 나온 결말부터. 한 번도 없었던 결말은 막대 없이 아래에 이름만 적습니다
      const weight = (o) => (ab ? o.nA + o.nB : o.n);
      const live = rows.filter((o) => weight(o) > 0).sort((p, q) => weight(q) - weight(p));
      const none = rows.filter((o) => weight(o) === 0);
      d.innerHTML = live.map((o) => {
        const lab = `<div class="lc-ob-lab"><i style="background:${esc(o.color)}"></i><span>${esc(o.label)}</span>${o.desc ? `<small>${esc(o.desc)}</small>` : ''}</div>`;
        if (!ab) {
          return `<div class="lc-ob-row" title="${esc(o.desc || o.label)}">${lab}<div class="lc-ob-bars"><div class="lc-ob-bar"><b class="${o.n ? '' : 'z'}" style="width:${(o.p * 100).toFixed(1)}%;background:${esc(o.color)}"></b></div></div><div class="lc-ob-v"><span>${pct(o.p)}</span><small>${o.n}개</small></div></div>`;
        }
        const dp = Math.round(o.dp * 100);
        return `<div class="lc-ob-row ab" title="${esc(o.desc || o.label)}">${lab}<div class="lc-ob-bars">
          <div class="lc-ob-bar" aria-label="${esc(labels[0])} ${pct(o.pA)}"><b class="${o.nA ? '' : 'z'}" style="width:${(o.pA * 100).toFixed(1)}%;background:${CA}"></b></div>
          <div class="lc-ob-bar" aria-label="${esc(labels[1])} ${pct(o.pB)}"><b class="${o.nB ? '' : 'z'}" style="width:${(o.pB * 100).toFixed(1)}%;background:${CB}"></b></div></div>
          <div class="lc-ob-v"><span>${pct(o.pA)} → ${pct(o.pB)}</span><small>${dp === 0 ? '같음' : (dp > 0 ? '+' : '') + dp + '%p'}</small></div></div>`;
      }).join('');
      host.appendChild(d);
      if (none.length) host.insertAdjacentHTML('beforeend', `<p class="lf-h">이번 실험에서 한 번도 없었던 결말: ${none.map((o) => `<span title="${esc(o.desc || o.label)}">${esc(o.label)}</span>`).join(', ')}</p>`);
    },
    pBadge(p, tvd, sigOverride) {
      const sig = sigOverride !== undefined ? !!sigOverride : fin(p) && p < 0.05;
      return `<span class="lc-badge${sig ? ' sig' : ''}">${sig ? '뚜렷한 차이' : !(tvd > 0) ? '차이 없음' : '우연일 수 있음'} · 분포 차이 ${pct(tvd)} · ${pfmt(p)}</span>`;
    },
    outcomeBadge(a, sigAll) {
      const o = sigAll ? null : (a.outcomes || []).filter((x) => x.sigO).sort((p, q) => Math.abs(q.dp) - Math.abs(p.dp))[0];
      if (!o) return this.pBadge(a.p, a.tvd, sigAll);
      return `<span class="lc-badge sig">뚜렷한 차이 · 「${esc(o.label)}」 ${pct(o.pA)} → ${pct(o.pB)} · ${pfmt(o.pO)}</span> <span class="lc-badge">결말 전체로는 우연일 수 있음 · 분포 차이 ${pct(a.tvd)} · ${pfmt(a.p)}</span>`;
    },
    tipRows(title, rows) {
      return `<b>${esc(title)}</b>` + rows.map(([c, l, v]) => `<div class="r"><span>${c ? `<i style="background:${esc(c)}"></i>` : ''}${esc(l)}</span><em>${esc(v)}</em></div>`).join('');
    },
    fanChart(host, cfg, m, f, color, extraLines, height) {
      const X = Ex(cfg.modeId);
      const lines = (extraLines || []).slice();
      if (f) lines.push({ ys: f.med, color, w: 2.2, dot: true });
      const bands = f ? [{ lo: f.lo90, hi: f.hi90, color, a: 0.13 }, { lo: f.lo50, hi: f.hi50, color, a: 0.26 }] : [];
      return makeChart(host, {
        xs: f ? f.med.map((_, k) => cfg.xsArr[k]) : cfg.xsArr, axis: X.axis, xfmt: X.xfmt, ylog: m.log, yshift: tickShift(m), yfmt: m.fmt, height: height || 190,
        bands, lines, aria: `${m.label} 변화`,
        tip: (k) => f ? this.tipRows(short(X.xfmt(cfg.xsArr[k])), [[color, '중앙값', fin(f.med[k]) ? m.fmt(f.med[k]) : '—'], [null, '가운데 50%', fin(f.lo50[k]) ? `${m.fmt(f.lo50[k])} ~ ${m.fmt(f.hi50[k])}` : '—'], [null, '90%', fin(f.lo90[k]) ? `${m.fmt(f.lo90[k])} ~ ${m.fmt(f.hi90[k])}` : '—']]) : '',
      });
    },
    metricGrid(host, res, opt) {
      const { cfg, a } = res;
      const X = Ex(cfg.modeId);
      cfg.xsArr = a.xs;
      const g = document.createElement('div');
      g.className = 'lc-grid2';
      host.appendChild(g);
      a.metrics.forEach((m, i) => {
        const box = document.createElement('div');
        box.className = 'lc-mini';
        if (opt && opt.ab) {
          const kk = Math.min(lastFin(m.fanA.med), lastFin(m.fanB.med));
          box.innerHTML = `<h4>${esc(m.label)}<span>${kk >= 0 ? `${esc(m.fmt(m.fanA.med[kk]))} → ${esc(m.fmt(m.fanB.med[kk]))}` : ''}</span></h4>`;
          g.appendChild(box);
          const fA = m.fanA, fB = m.fanB;
          makeChart(box, {
            xs: a.xs, axis: X.axis, xfmt: X.xfmt, ylog: m.log, yshift: tickShift(m), yfmt: m.fmt, height: 190, aria: `${m.label} 비교`,
            bands: [{ lo: fA.lo50, hi: fA.hi50, color: CA, a: 0.22 }, { lo: fB.lo50, hi: fB.hi50, color: CB, a: 0.22 }],
            lines: [{ ys: fA.med, color: CA, w: 2.2, dot: true }, { ys: fB.med, color: CB, w: 2.2, dash: [6, 4], dot: true }],
            vmarks: opt.vmark ? [opt.vmark] : [],
            tip: (k) => this.tipRows(short(X.xfmt(a.xs[k])), [[CA, opt.labels[0], fin(fA.med[k]) ? m.fmt(fA.med[k]) : '—'], [CB, opt.labels[1], fin(fB.med[k]) ? m.fmt(fB.med[k]) : '—']]),
          });
          return;
        }
        const fl = m.final;
        box.innerHTML = `<h4>${esc(m.label)}<span>${fl ? `끝 중앙값 ${esc(m.fmt(fl.med))}` : ''}</span></h4>`;
        g.appendChild(box);
        let extra = [];
        if (this.st.spaghetti) {
          extra = a.results.map((r, wi) => ({ ys: r.series[m.key], color: (a.outcomes.find((o) => o.key === r.outcome) || {}).color || '#929aab', w: 1, a: 0.5 }));
          makeChart(box, {
            xs: a.xs, axis: X.axis, xfmt: X.xfmt, ylog: m.log, yshift: tickShift(m), yfmt: m.fmt, height: 190, lines: extra.concat([{ ys: m.fan.med, color: '#ebe4d3', w: 2, dot: true }]), aria: `${m.label}: 모든 세계`,
            tip: (k) => this.tipRows(short(X.xfmt(a.xs[k])), [['#ebe4d3', '중앙값', fin(m.fan.med[k]) ? m.fmt(m.fan.med[k]) : '—'], [null, '가장 낮은 세계', fmtMin(a.results, m, k)], [null, '가장 높은 세계', fmtMax(a.results, m, k)]]),
          });
        } else this.fanChart(box, cfg, m, m.fan, m.color || CA, null, 190);
      });
    },
    eventsProb(host, res) {
      const { cfg, a } = res, X = Ex(cfg.modeId);
      const evs = a.events.filter((e) => e.pre < 0.5);
      // 선은 10개까지: 넘치면 확실한(100%) 사건보다 세계마다 갈린 사건을 남깁니다 (빠진 것은 아래에 적음)
      const cand = evs.filter((e) => e.p > 0), MAXL = 10;
      const shown = (cand.length > MAXL ? cand.slice().sort((p, q) => ((p.p >= 0.999) - (q.p >= 0.999)) || q.p - p.p).slice(0, MAXL) : cand.slice()).sort((p, q) => q.p - p.p);
      const omitted = cand.filter((e) => !shown.includes(e));
      const never = evs.filter((e) => e.p === 0);
      const pre = a.events.filter((e) => e.pre >= 0.5);
      if (!shown.length) {
        host.insertAdjacentHTML('beforeend', `<p class="lead">이 기간에는 새로 일어난 사건이 없었습니다.${never.length ? ` 일어나지 않은 사건: ${never.map((e) => esc(e.name)).join(', ')}.` : ''}</p>`);
        return;
      }
      const PAL = ['#f1cb86', '#84c6d2', '#96cf88', '#e46a4e', '#b99be0', '#e0a3c4', '#7fb3e8', '#c9c27a', '#e8955a', '#a9b3c4'];
      const lg = document.createElement('div');
      lg.className = 'lc-legend';
      lg.innerHTML = shown.map((e, i) => `<span><i style="background:${PAL[i]}"></i>${esc(e.name)} <b style="color:var(--text);font-weight:600">${pct(e.p)}</b></span>`).join('');
      host.appendChild(lg);
      makeChart(host, {
        xs: a.xs, axis: X.axis, xfmt: X.xfmt, yMin: 0, yMax: 1, yClamp: true, yfmt: (v) => Math.round(v * 100) + '%', height: 220, aria: '사건이 일어났을 확률',
        lines: shown.map((e, i) => ({ ys: e.cum, color: PAL[i], w: 2, dot: true, dash: i >= 4 ? [5, 3] : null })),
        tip: (k) => this.tipRows(`${short(X.xfmt(a.xs[k]))}까지`, shown.map((e, i) => [PAL[i], e.name, pct(e.cum[k])])),
      });
      const notes = [];
      if (omitted.length) notes.push(`선이 너무 많아 뺀 사건${omitted.every((e) => e.p >= 0.999) ? "(모든 세계에서 일어남)" : ""}: ${omitted.map((e) => esc(e.name)).join(', ')}`);
      if (never.length) notes.push(`한 번도 일어나지 않은 사건: ${never.map((e) => esc(e.name)).join(', ')}`);
      if (pre.length) notes.push(`출발할 때 이미 일어나 있던 사건 ${pre.length}개는 뺐습니다.`);
      if (notes.length) host.insertAdjacentHTML('beforeend', `<p class="lf-h">${notes.join('<br>')}</p>`);
    },
    strip(host, res) {
      const { cfg, a } = res, X = Ex(cfg.modeId);
      // 우리 역사 표시(◆)가 있는 사건과 자주 일어난 사건을 먼저 고른 뒤, 일어난 때(중앙값) 순서로 늘어놓음
      const tfx = X.axis === 'log' ? (v) => Math.log10(Math.max(v, 1e-300)) : (v) => v;
      const inSpan = (v) => fin(v) && v >= a.x0 && v <= a.x1;
      const evs = a.events.filter((e) => e.pre < 0.5 && e.p > 0)
        .sort((p, q) => (inSpan(q.real) ? 1 : 0) - (inSpan(p.real) ? 1 : 0) || q.p - p.p).slice(0, 10)
        .sort((p, q) => tfx(p.med) - tfx(q.med));
      if (!evs.length) { host.insertAdjacentHTML('beforeend', '<p class="lead">이 기간에 새로 일어난 사건이 없어 시점을 비교할 수 없습니다.</p>'); return; }
      const colorOf = (i) => (a.outcomes.find((o) => o.key === a.results[i].outcome) || {}).color || CA;
      const rows = evs.map((e) => ({
        label: `${e.name} · ${pct(e.p)}`,
        pts: e.times.map((t, i) => ({ x: t, color: colorOf(i) })).filter((p) => p.x !== null),
        real: e.real,
        tip: this.tipRows(e.name, [[null, '일어난 세계', `${Math.round(e.p * a.N)} / ${a.N}`], [null, '중앙값', e.med !== null ? short(X.xfmt(e.med)) : '—'], [null, '가운데 50%', e.q25 !== null ? `${short(X.xfmt(e.q25))} ~ ${short(X.xfmt(e.q75))}` : '—'], [null, Ex(cfg.modeId).mode.realName || '우리 역사', e.realLabel || '—']]),
      }));
      const lg = document.createElement('div');
      lg.className = 'lc-legend';
      lg.innerHTML = `<span><i class="dot" style="background:${CA}"></i>세계 하나 = 점 하나 (색 = 그 세계의 결말)</span>${rows.some((r) => fin(r.real)) ? `<span><i class="dia"></i>${esc(X.mode.realName || '우리 역사')}</span>` : ''}`;
      host.appendChild(lg);
      makeChart(host, { type: 'strip', xMin: a.x0, xMax: a.x1, axis: X.axis, xfmt: X.xfmt, rows, aria: '사건 시점 분포' });
    },
    stories(host, res) {
      const { a, cfg } = res, X = Ex(cfg.modeId);
      const one = (i, kicker) => {
        const r = a.results[i];
        const o = a.outcomes.find((x) => x.key === r.outcome) || { label: r.outcome, color: '#929aab' };
        const items = r.chronicle || [];
        const pre = commonPrefix(items.map((e) => String(e.time)));
        return `<article class="lc-story"><header><span class="lc-kicker">${esc(kicker)}</span><h4><i style="background:${esc(o.color)}"></i>${esc(o.label)}</h4>
          <span class="meta">씨앗 ${r.seed}${r.early ? ` · ${esc(short(X.xfmt(r.endX)))}에 끝남` : ''}</span></header>
          <ol>${items.length ? items.map((e) => `<li class="${esc(e.kind)}"><time>${esc(short(String(e.time).slice(pre.length)))}</time><span>${esc(e.text)}</span></li>`).join('') : '<li><time></time><span>기록된 큰 사건이 없습니다.</span></li>'}</ol>
          <button type="button" class="btn sm" data-open="w:${i}" style="justify-self:start">${WS.icon('eye')}이 세계 관측하기</button></article>`;
      };
      const d = document.createElement('div');
      d.className = 'lc-stories';
      const fut = cfg.q === 1; // 질문 2(같은 출발점의 역사 반복)는 '미래'가 아니라 '결말'
      d.innerHTML = one(a.medoid, fut ? '가장 흔한 미래 · 대표 세계' : '가장 흔한 결말 · 대표 세계') + (a.rare !== a.medoid ? one(a.rare, a.rareIsOutcome ? (fut ? '가장 드문 미래' : '가장 드문 결말') : '가장 특이한 세계') : '');
      host.appendChild(d);
    },
    keyEvents(a) {
      // 표에 보여 줄 사건 3개: 출발 뒤 일어난 것 중 세계마다 갈린 것 우선
      const tf = Ex(this.res[this.st.q].cfg.modeId).axis === 'log' ? (v) => Math.log10(Math.max(v, 1e-300)) : (v) => v;
      const spread = (e) => (e.q25 !== null && e.q75 !== null ? tf(e.q75) - tf(e.q25) : 0);
      const unc = (e) => Math.round(Math.abs(e.p - 0.5) * 10);
      return a.events.filter((e) => e.pre < 0.5).sort((p, q) => unc(p) - unc(q) || spread(q) - spread(p)).slice(0, 3);
    },
    worldTable(host, res) {
      const { a, cfg } = res, X = Ex(cfg.modeId);
      const ev = this.keyEvents(a);
      const rows = a.results.map((r, i) => {
        const o = a.outcomes.find((x) => x.key === r.outcome) || { label: r.outcome, color: '#929aab' };
        return `<tr${i >= 12 && !res.moreOpen ? ' class="more" hidden' : ''}><td class="seed o1" data-l="씨앗">${r.seed}</td><td class="ev"><span class="oc"><i style="background:${esc(o.color)}"></i>${esc(o.label)}</span></td>
          ${ev.map((e) => `<td class="v${fin(r.reached[e.id]) ? '' : ' mut'}" data-l="${esc(noParen(e.name))}">${fin(r.reached[e.id]) ? esc(short(X.xfmt(r.reached[e.id]))) : '—'}</td>`).join('')}
          <td class="act"><button type="button" class="btn sm" data-open="w:${i}">${WS.icon('eye')}관측하기</button></td></tr>`;
      }).join('');
      const tw = document.createElement('div');
      tw.className = 'lc-tw';
      tw.innerHTML = `<table class="lc-t lc-stack"><thead><tr><th>씨앗</th><th>결말</th>${ev.map((e) => `<th>${esc(e.name)}</th>`).join('')}<th></th></tr></thead><tbody>${rows}</tbody></table>`;
      host.appendChild(tw);
      if (a.results.length > 12 && !res.moreOpen) host.insertAdjacentHTML('beforeend', `<button type="button" class="btn sm lc-more" data-more>모두 보기 (${a.results.length}개)</button>`);
      // data-more 버튼은 바로 앞 형제(표)를 펼칩니다
    },

    renderEnsemble(out, res) {
      const { cfg, a } = res, X = Ex(cfg.modeId), q = cfg.q;
      cfg.xsArr = a.xs;
      this.head(out, res);
      this.renderCards(out, (q === 2 ? a.cardsQ2 : a.cards) || a.cards || []);
      if (!a.outcomes || !a.N) { this.caveat(out); return; } // 계산을 마친 세계가 없음 → 카드만
      const ob = () => { const s = this.sec(out, '결말은 어떻게 갈렸나', `마지막 상태에 따라 ${a.N}개 세계를 나눴습니다.${X.native ? '' : ' (이 단계의 결말 이름은 관측 화면의 종료 문구를 그대로 씁니다)'}`, 'chart'); this.outcomeBars(s, a.outcomes.filter((o) => o.n > 0 || !X.dynamic), false); };
      const disp = () => {
        const s = this.sec(out, '세계들은 모일까, 흩어질까?', '같은 때에 세계 두 개씩 골라 지표들이 얼마나 다른지 잰 값(중앙값)입니다. 0이면 똑같고, 1이면 “의미 있게 다른” 정도입니다. 선이 올라가면 갈라지는 중, 내려가면 다시 모이는 중입니다.', 'branch');
        makeChart(s, {
          xs: a.xs, axis: X.axis, xfmt: X.xfmt, yMin: 0, height: 220, yfmt: (v) => WS.trimNum(v), aria: '세계 사이 차이',
          lines: [{ ys: a.dispersion, color: CB, w: 2.4, dot: true }], hmarks: [{ y: 1, label: '의미 있게 다름' }],
          tip: (k) => this.tipRows(short(X.xfmt(a.xs[k])), [[CB, '세계 사이 차이', fin(a.dispersion[k]) ? a.dispersion[k].toFixed(2) : '—']]),
        });
        const e = a.entropy;
        s.insertAdjacentHTML('beforeend', `<div class="lc-meter"><span>결말 다양성</span><div class="bar" role="img" aria-label="결말 다양성 ${e.toFixed(2)}"><b style="left:${(e * 100).toFixed(1)}%"></b></div><span><b>${e.toFixed(2)}</b> <span class="lf-h" style="display:inline">${e < 0.15 ? '거의 한 결말' : e < 0.5 ? '한쪽으로 쏠림' : e < 0.8 ? '여러 갈래' : '고르게 흩어짐'}</span></span></div>
          <p class="lf-h">결말 다양성: 0 = 모든 세계가 같은 결말, 1 = 가능한 결말에 고르게 흩어짐. 지표마다 “의미 있는 차이”의 크기: ${a.metrics.map((m) => `${esc(m.label)} ${m.log ? `×${WS.trimNum(Math.pow(10, m.scale))}` : esc(m.fmt(+m.scale.toPrecision(2))).replace(/^\+/, '±')}`).join(' · ')}</p>`);
      };
      const fans = () => {
        const s = this.sec(out, '시간에 따른 변화', '가운데 선은 중앙값, 진한 띠는 가운데 50% 세계, 옅은 띠는 90% 세계가 지나간 범위입니다. 그래프 위에 마우스를 올리거나 눌러 값을 보세요.', 'chart');
        const h3 = s.querySelector('h3');
        h3.insertAdjacentHTML('beforeend', `<label class="lc-toggle" style="margin-left:auto"><input type="checkbox" data-spag${this.st.spaghetti ? ' checked' : ''}>모든 세계를 선으로 보기</label>`);
        h3.querySelector('[data-spag]').addEventListener('change', (e) => { this.st.spaghetti = e.target.checked; this.save(); this.renderOut(); });
        if (this.st.spaghetti) s.querySelector('.lead').textContent = '선 하나가 세계 하나입니다. 선의 색은 그 세계의 결말 색(위 결말 막대 참고), 흰 선은 중앙값입니다.';
        this.metricGrid(s, res);
      };
      const evp = () => { const s = this.sec(out, '사건이 일어났을 확률', '그 시점까지 해당 사건을 겪은 세계의 비율입니다.', 'question'); this.eventsProb(s, res); };
      const strip = () => { const s = this.sec(out, '같은 사건, 언제 일어났나', '세계마다 사건이 일어난 시점을 점으로 찍었습니다. 점들이 한곳에 모여 있으면 역사가 비슷하게 반복된다는 뜻입니다.', 'branch'); this.strip(s, res); };
      const st = () => { const s = this.sec(out, q === 1 ? '대표적인 미래 두 가지' : '대표적인 역사 두 가지', '가장 흔한 결말 중 다른 세계들과 가장 닮은 세계, 그리고 가장 드문 결말의 세계입니다. 큰 사건만 추렸습니다.', 'book'); this.stories(s, res); };
      const tb = () => { const s = this.sec(out, '세계 목록', '‘관측하기’를 누르면 그 세계를 처음부터 화면으로 다시 돌려 볼 수 있습니다. 같은 씨앗이라 같은 역사가 펼쳐집니다.', 'eye'); this.worldTable(s, res); };
      if (q === 2) { disp(); ob(); strip(); fans(); evp(); st(); tb(); }
      else { ob(); fans(); evp(); st(); tb(); }
      this.caveat(out);
    },
    renderIntervention(out, res) {
      const { cfg, a } = res, X = Ex(cfg.modeId);
      cfg.xsArr = a.xs;
      const rr = cfg.iv ? (cfg.iv.coupled ? '개입 뒤의 우연: 언제나 함께 바뀜' : cfg.iv.reroll ? '개입 뒤의 우연: 함께 바뀜' : '개입 뒤의 우연: 그대로') : '';
      const ivLbl = cfg.iv ? `${cfg.iv.name} · ${short(X.xfmt(cfg.iv.at))}${cfg.iv.targetLabel ? ' · ' + cfg.iv.targetLabel : ''} · ${rr}` : '';
      this.head(out, res, esc(ivLbl));
      this.renderCards(out, a.cards || []);
      if (!a.D) { this.caveat(out); return; }
      const vm = cfg.iv ? { x: cfg.iv.at, label: '개입 · ' + cfg.iv.name, color: CB } : null;
      const lead = '개입한 세계와 원래 세계의 차이를, 서로 아무 관계 없는 두 세계의 차이로 나눈 값입니다. 0이면 두 세계가 같은 것이고, 1 근처면 완전히 다른 역사가 된 것입니다. '
        + (a.reroll ? '이번 실험에서는 개입 뒤의 우연도 함께 바뀌므로, 세부 역사는 대개 갈라집니다. 그래서 아래 ‘결말 비교’와 ‘지표 비교’(큰 흐름)가 더 중요합니다.'
          : '이번 실험에서는 쌍둥이가 앞으로 겪을 우연도 같으므로, 선이 0에 머물거나 0으로 돌아오면 “같은 운이라면 개입의 흔적이 남지 않는다”는 뜻입니다.');
      let s = this.sec(out, '쌍둥이 세계는 얼마나 갈라졌나', lead, 'butterfly');
      const Dc = a.D.map((v) => (fin(v) ? v : NaN));
      const maxD = Math.max(0, ...Dc.filter(fin));
      const yTop = Math.min(3, Math.max(1.2, maxD * 1.05));
      if (maxD > 3) s.querySelector('.lead').insertAdjacentText('beforeend', ' 개입 직후처럼 원래 세계들끼리의 차이가 아주 작을 때는 값이 매우 커지므로, 3보다 큰 부분은 위쪽에서 잘라 보여 줍니다.');
      makeChart(s, {
        xs: a.xs, axis: X.axis, xfmt: X.xfmt, yMin: 0, yMax: yTop, yClamp: true, height: 230, yfmt: (v) => WS.trimNum(v), aria: '갈라짐 정도',
        lines: [{ ys: Dc, color: CB, w: 2.4, dot: true }], hmarks: [{ y: 1, label: '무관한 두 세계만큼 다름' }], vmarks: vm ? [vm] : [],
        tip: (k) => this.tipRows(short(X.xfmt(a.xs[k])), [[CB, '갈라짐', fin(Dc[k]) ? Dc[k].toFixed(2) : '—'], [null, '쌍둥이 차이', fin(a.num[k]) ? a.num[k].toFixed(2) : '—'], [null, '무관한 세계 차이', fin(a.den[k]) ? a.den[k].toFixed(2) : '—']]),
      });
      s.insertAdjacentHTML('beforeend', `<p class="lf-h">개입이 실제로 적용된 쌍: ${a.applied} / ${a.total}${a.pairs[0] && a.pairs[0].ivMsgs[0] ? ` · 예: “${esc(a.pairs[0].ivMsgs[0])}”` : ''}</p>`);
      if (a.simCurve) {
        s = this.sec(out, '같은 모습으로 남은 정도', '두 쌍둥이 세계가 세부적으로 얼마나 같은 모습인지 보여 줍니다(100% = 완전히 같음). 지표가 비슷해도 세부는 다를 수 있습니다.', 'eye');
        makeChart(s, {
          xs: a.xs, axis: X.axis, xfmt: X.xfmt, yMin: 0, yMax: 1, yClamp: true, height: 200, yfmt: (v) => Math.round(v * 100) + '%', aria: '세부 유사도',
          lines: [{ ys: a.simCurve, color: '#96cf88', w: 2.4, dot: true }], vmarks: vm ? [vm] : [],
          tip: (k) => this.tipRows(short(X.xfmt(a.xs[k])), [['#96cf88', '같은 모습', fin(a.simCurve[k]) ? pct(a.simCurve[k]) : '—']]),
        });
      }
      s = this.sec(out, '결말 비교', `같은 씨앗의 쌍둥이를 놓고, 개입하지 않은 쪽과 개입한 쪽의 결말을 비교합니다. ${this.outcomeBadge(a, !!a.outcomeSig)}`, 'scale');
      this.outcomeBars(s, a.outcomes.filter((o) => o.nA + o.nB > 0 || !X.dynamic), true, ['개입 안 함', '개입함']);
      s = this.sec(out, '사건은 언제, 얼마나 자주', '쌍둥이가 같은 사건을 언제, 얼마나 자주 겪었는지 비교합니다. ‘시점 변화’는 둘 다 그 사건을 겪은 쌍만 짝지어 재고, 우연과 구별되지 않으면 ‘뚜렷한 변화 없음’으로 적습니다.', 'question');
      this.eventTable(s, res, ['개입 안 함', '개입함']);
      s = this.sec(out, '지표 비교', '선은 중앙값, 띠는 가운데 50% 세계입니다. 황동색 = 개입 안 함, 청록색 점선 = 개입함.', 'chart');
      this.metricGrid(s, res, { ab: true, labels: ['개입 안 함', '개입함'], vmark: vm });
      const mp = (a.metrics || []).filter((m) => fin(m.p));
      if (mp.length) s.insertAdjacentHTML('beforeend', `<p class="lf-h">끝 시점에서 쌍둥이끼리 잰 차이의 p값: ${mp.map((m) => `${esc(m.label)} <span style="${m.sig ? 'color:var(--brass-hi)' : ''}">${pfmt(m.p)}</span>`).join(' · ')}. 여러 지표를 함께 보므로 노란 글씨는 그 점을 보정한 뒤에도 뚜렷하고 크기도 의미 있는 차이만 표시합니다.</p>`);
      s = this.sec(out, '쌍둥이 목록', '원래 세계와 개입한 세계를 각각 관측 화면에서 다시 볼 수 있습니다. 개입한 세계는 같은 때에 같은 개입이 자동으로 일어납니다. ‘끝 갈라짐’은 위 그래프와 같은 눈금입니다(0 = 같음, 1 = 무관한 두 세계만큼 다름).', 'eye');
      const rows = a.pairs.map((p, i) => {
        const oa = a.outcomes.find((o) => o.key === p.base) || { label: p.base, color: '#929aab' }, ob = a.outcomes.find((o) => o.key === p.alt) || { label: p.alt, color: '#929aab' };
        return `<tr${i >= 12 && !res.moreOpen ? ' class="more" hidden' : ''}><td class="seed o1" data-l="씨앗">${p.seed}</td><td class="o3" data-l="개입 안 함"><span class="oc"><i style="background:${esc(oa.color)}"></i>${esc(oa.label)}</span></td><td class="o4" data-l="개입함"><span class="oc"><i style="background:${esc(ob.color)}"></i>${esc(ob.label)}</span>${p.base === p.alt ? '' : ' <span class="lc-badge sig">달라짐</span>'}</td>
          <td class="v o2" data-l="끝 갈라짐">${fin(p.dn) ? p.dn.toFixed(2) : '—'}</td>
          <td class="act"><div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn sm" data-open="b:${i}">원래</button><button type="button" class="btn sm" data-open="a:${i}">${WS.icon('butterfly')}개입한 세계</button></div></td></tr>`;
      }).join('');
      s.insertAdjacentHTML('beforeend', `<p class="lf-h">모두 ${a.N}쌍 · 세부까지 똑같이 끝난 쌍 ${a.N - a.nDetail} · 끝에서도 눈에 띄게 다른 쌍(끝 갈라짐 0.15 이상) ${a.nApart} · 결말이 달라진 쌍 ${a.N - a.sameOutcome}</p>
        <div class="lc-tw"><table class="lc-t lc-stack"><thead><tr><th>씨앗</th><th>개입 안 함</th><th>개입함</th><th>끝 갈라짐</th><th>관측하기</th></tr></thead><tbody>${rows}</tbody></table></div>${a.pairs.length > 12 && !res.moreOpen ? `<button type="button" class="btn sm lc-more" data-more>모두 보기 (${a.pairs.length}쌍)</button>` : ''}`);
      this.caveat(out);
    },
    eventTable(host, res, labels) {
      const { cfg, a } = res, X = Ex(cfg.modeId);
      const evs = a.events.filter((e) => e.pre < 0.5 && (e.pA > 0 || e.pB > 0));
      if (!evs.length) { host.insertAdjacentHTML('beforeend', '<p class="lead">출발 뒤 새로 일어난 사건이 없습니다.</p>'); return; }
      const med = (v) => (v === null || !fin(v) ? '—' : short(X.xfmt(v)));
      const sigP = (on) => (on ? ' sig' : '');
      // 우연과 구별되지 않는 시점 차이는 방향과 크기를 적지 않습니다 (값은 마우스를 올리면 보임)
      const timeTxt = (e) => (!fin(e.p) ? '—' : e.shiftText === '거의 같음' ? '같음' : e.sigT ? `${esc(e.shiftText)} <span class="mut">(${pfmt(e.p)})</span>` : '뚜렷한 변화 없음');
      const timeTip = (e) => (fin(e.p) && !e.sigT && e.shiftText !== '거의 같음' ? ` title="${esc(`재어 본 차이 ${e.shiftText}, ${pfmt(e.p)}`)}"` : '');
      const rateTxt = (e) => {
        if (e.pA === e.pB) return '같음';
        const dp = Math.round((e.pB - e.pA) * 100);
        return `${dp > 0 ? '+' : ''}${dp}%p ${e.sigP ? `<span class="mut">(${pfmt(e.pP)})</span>` : '<span class="mut">우연일 수 있음</span>'}`;
      };
      const rateTip = (e) => (e.pA !== e.pB && !e.sigP && fin(e.pP) ? ` title="${esc(pfmt(e.pP))}"` : '');
      // 좁은 화면에서는 줄마다 카드처럼 쌓아(data-l = 칸 이름) 옆으로 밀지 않아도 모두 보이게
      const rows = evs.map((e) => `<tr><td class="ev">${esc(e.name)}</td>
        <td class="v" data-l="${esc(labels[0])}">${pct(e.pA)} · ${esc(med(e.medA))}</td><td class="v" data-l="${esc(labels[1])}">${pct(e.pB)} · ${esc(med(e.medB))}</td>
        <td class="v${sigP(e.sigT)}" data-l="시점 변화"${timeTip(e)}>${timeTxt(e)}</td>
        <td class="v${sigP(e.sigP)}" data-l="일어난 비율 변화"${rateTip(e)}>${rateTxt(e)}</td></tr>`).join('');
      const pairedNote = a.kind === 'intervention' && evs.some((e) => e.sigT) ? ' 시점 변화는 짝지어 잰 값이라 두 칸의 중앙값 차이와 다를 수 있습니다.' : '';
      host.insertAdjacentHTML('beforeend', `<div class="lc-tw"><table class="lc-t lc-stack"><thead><tr><th>사건</th><th><span class="tagab a" style="display:inline-grid;width:auto;padding:0 5px;background:${CA}">${esc(labels[0])}</span></th><th><span class="tagab b" style="display:inline-grid;width:auto;padding:0 5px;background:${CB}">${esc(labels[1])}</span></th><th>시점 변화</th><th>일어난 비율 변화</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="lf-h">${labels[0] ? `${esc(labels[0])} · ${esc(labels[1])} 칸` : '각 칸'}: 일어난 세계 비율 · 일어난 시점의 중앙값. 노란 글씨는 사건 여러 개를 함께 검사한 것을 감안해도 우연으로 보기 어려운 차이입니다.${pairedNote}</p>`);
    },
    renderCompare(out, res) {
      const { cfg, a } = res, X = Ex(cfg.modeId);
      cfg.xsArr = a.xs;
      const labels = [cfg.labelA, cfg.labelB];
      this.head(out, res, `<span style="color:${CA}">A ${esc(cfg.labelA)}</span> vs <span style="color:${CB}">B ${esc(cfg.labelB)}</span>${cfg.sameCond ? ' · 두 조건이 같음' : ''}`);
      this.renderCards(out, a.cards || []);
      if (!a.outcomes) { this.caveat(out); return; }
      // 바뀐 조건 요약
      const diff = X.conditions.filter((k) => Math.abs(cfg.condA[k.key] - cfg.condB[k.key]) > 1e-9);
      let s = this.sec(out, '무엇을 바꿨나', diff.length ? '두 조건에서 다른 값만 보여 줍니다.' : 'A와 B의 조건이 같습니다. 씨앗도 같으므로 두 묶음은 세계 하나하나까지 똑같습니다.', 'scale');
      if (diff.length) {
        s.insertAdjacentHTML('beforeend', `<div class="lc-tw"><table class="lc-t lc-stack"><thead><tr><th>조건</th><th>A · ${esc(cfg.labelA)}</th><th>B · ${esc(cfg.labelB)}</th></tr></thead><tbody>${diff.map((k) => `<tr><td class="ev">${esc(k.label)}${k.desc ? `<div class="lf-h" style="font-weight:400">${esc(k.desc)}</div>` : ''}</td><td class="v" data-l="A · ${esc(cfg.labelA)}">${esc(k.fmt ? k.fmt(cfg.condA[k.key]) : cfg.condA[k.key])}</td><td class="v" data-l="B · ${esc(cfg.labelB)}">${esc(k.fmt ? k.fmt(cfg.condB[k.key]) : cfg.condB[k.key])}</td></tr>`).join('')}</tbody></table></div>`);
      }
      s = this.sec(out, '결말 비교', `A와 B 조건에서 각각 ${cfg.N}개 세계의 결말입니다. ${this.outcomeBadge(a, fin(a.p) && a.p < 0.05)}`, 'chart');
      this.outcomeBars(s, a.outcomes.filter((o) => o.nA + o.nB > 0 || !X.dynamic), true, labels.map((l, i) => (i ? 'B · ' : 'A · ') + l));
      s = this.sec(out, '지표 비교', `선은 중앙값, 띠는 가운데 50% 세계입니다. 황동색 = A, 청록색 점선 = B.`, 'chart');
      this.metricGrid(s, res, { ab: true, labels: ['A · ' + labels[0], 'B · ' + labels[1]] });
      const sig = a.metrics.filter((m) => fin(m.p));
      if (sig.length) s.insertAdjacentHTML('beforeend', `<p class="lf-h">끝 시점 값 차이의 p값: ${sig.map((m) => `${esc(m.label)} <span class="${m.sig ? 'sig' : ''}" style="${m.sig ? 'color:var(--brass-hi)' : ''}">${pfmt(m.p)}</span>`).join(' · ')}. 노란 글씨는 지표 여러 개를 함께 검사한 것을 감안해도 뚜렷하고 크기도 의미 있는 차이입니다.</p>`);
      s = this.sec(out, '사건 비교', '각 조건에서 사건이 일어난 비율과 시점입니다.', 'question');
      this.eventTable(s, res, ['A · ' + labels[0], 'B · ' + labels[1]]);
      s = this.sec(out, '세계 목록', X.chanceCoupled
        ? '같은 씨앗을 A와 B 조건에서 각각 돌렸습니다. 다만 이 모형은 사람 수가 조금만 달라져도 그 뒤의 우연이 모두 달라져서, 같은 줄의 두 세계가 같은 우연을 겪지는 않습니다.'
        : '같은 씨앗을 A와 B 조건에서 각각 돌렸습니다. 같은 줄의 두 세계는 같은 씨앗에서 출발하고 조건만 다릅니다.', 'eye');
      const rows = a.worldsA.map((wa, i) => {
        const wb = a.worldsB[i];
        if (!wb) return '';
        const oa = a.outcomes.find((o) => o.key === wa.outcome) || { label: wa.outcome, color: '#929aab' }, ob = a.outcomes.find((o) => o.key === wb.outcome) || { label: wb.outcome, color: '#929aab' };
        return `<tr${i >= 12 && !res.moreOpen ? ' class="more" hidden' : ''}><td class="seed o1 full" data-l="씨앗">${wa.seed}</td><td class="o3" data-l="A 결말"><span class="oc"><i style="background:${esc(oa.color)}"></i>${esc(oa.label)}</span></td><td class="o4" data-l="B 결말"><span class="oc"><i style="background:${esc(ob.color)}"></i>${esc(ob.label)}</span></td>
          <td class="act"><div style="display:flex;gap:6px"><button type="button" class="btn sm" data-open="A:${i}">A 관측</button><button type="button" class="btn sm" data-open="B:${i}">B 관측</button></div></td></tr>`;
      }).join('');
      s.insertAdjacentHTML('beforeend', `<div class="lc-tw"><table class="lc-t lc-stack"><thead><tr><th>씨앗</th><th>A 결말</th><th>B 결말</th><th>관측하기</th></tr></thead><tbody>${rows}</tbody></table></div>${a.worldsA.length > 12 && !res.moreOpen ? `<button type="button" class="btn sm lc-more" data-more>모두 보기 (${a.worldsA.length}개)</button>` : ''}`);
      this.caveat(out);
    },
  });

  // 연대기 시간 표기의 공통 머리말(예: '빅뱅 후 ')은 지웁니다
  function X0(id, opts) { return Ex(id).span(opts)[0]; }
  function commonPrefix(list) {
    if (list.length < 2) return '';
    let p = list[0];
    for (const s of list) while (p && !s.startsWith(p)) p = p.slice(0, -1);
    const i = p.lastIndexOf(' ');
    return i > 0 ? p.slice(0, i + 1) : '';
  }
  function lastFin(a) { for (let i = a.length - 1; i >= 0; i--) if (fin(a[i])) return i; return -1; }
  function fmtMin(rs, m, k) { let v = Infinity; rs.forEach((r) => { const x = r.series[m.key][k]; if (fin(x) && x < v) v = x; }); return fin(v) ? m.fmt(v) : '—'; }
  function fmtMax(rs, m, k) { let v = -Infinity; rs.forEach((r) => { const x = r.series[m.key][k]; if (fin(x) && x > v) v = x; }); return fin(v) ? m.fmt(v) : '—'; }
})();
