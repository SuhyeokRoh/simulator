'use strict';
/* 창세 관측소 — 화면 제어: 질문 중심 로비, 관측 화면(해설·범례·타임라인·개입·기록), 실험실 연결 */
(function () {
  const WS = window.WS;
  const $ = (id) => document.getElementById(id);
  const ORDER = ['universe', 'stellar', 'life', 'civ'];
  const SPEEDS = [[0.25, '느리게'], [1, '보통'], [4, '빠르게'], [16, '매우 빠르게'], [64, '최고']];
  const KIND = { milestone: '이정표', disaster: '재난', god: '나의 개입', end: '관측 종료', info: '알림' };
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cssColor = (c) => (typeof c === 'string' && /^[#\w\s(),.%+-]+$/.test(c) ? c : 'transparent');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 */ } },
  };
  // 다른 파일(모드·실험실)이 아직 바뀌는 중일 수 있어, 선택적 기능은 실패해도 화면이 멈추지 않게 감쌉니다.
  const warned = {};
  const safe = (name, fn, d) => {
    try { const v = fn(); return v === undefined ? d : v; } catch (e) {
      if (!warned[name]) { warned[name] = 1; console.warn('[창세 관측소] ' + name + ' 실패', e); }
      return d;
    }
  };
  const fin = (v) => typeof v === 'number' && isFinite(v);
  /* 범례 글자 폭(px)을 화면 배치 없이 잽니다. 범례는 두 칸으로 놓되, 반 칸(글자 약 112px)에 안 들어가는 항목은 한 줄을 통째로 씁니다. */
  const LEGEND_HALF = 112;
  let measureCtx = null;
  const textWidth = (s, px) => {
    try {
      if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
      measureCtx.font = `${px}px ${getComputedStyle(document.body).fontFamily}`;
      return measureCtx.measureText(String(s)).width;
    } catch (e) { return String(s).length * px; }
  };
  /* 휴대폰 배치 경계와, 마우스가 없는 화면인지 */
  const PHONE_W = 640;
  const isTouch = () => !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
  /* 휴대폰에서 캔버스 높이를 모드의 그림 배치에 맞춥니다 (검은 띠 없이 지도만큼만).
     h: 캔버스 폭 W에서 그림이 꽉 차는 높이, under: 위쪽 빈 띠를 보기 전환 줄 밑으로 겹칠 높이,
     min: 화면이 낮을 때 줄일 수 있는 최소 높이(둥근 그림 모드만), zoom: "크게" 버튼을 눌렀을 때 폭 배율(옆으로 밀어 봄). */
  const MAP_FIT = {
    civ: { h: (W) => { const p = W < 520 ? 6 : 12; return (W - 2 * p) / 2.11 + 2 * p; }, zoom: 2 },
    life: { h: (W) => (W < 520 ? (W - 16) / 2 + 54 : (W - 32) / 2 + 62), under: (W) => (W < 520 ? 34 : 42), zoom: 2 },
    stellar: { h: (W) => W + 60, under: () => 34, min: 300 },
    universe: { h: (W) => W + 60, under: () => 34, min: 300 },
  };
  /* 해설·안내에서 숫자만 바뀌었는지 가려내는 틀 */
  const narTemplate = (t) => String(t).replace(/[+\-−]?\d[\d.,]*/g, '#');
  const copyOpts = (o) => { const r = Object.assign({}, o || {}); delete r.headless; if (r.cond) r.cond = Object.assign({}, r.cond); return r; };

  /* 화면에 쓰는 아이콘 (core.js에 없을 때만 보충) */
  const MORE_ICONS = {
    question: '<circle cx="12" cy="12" r="9.5"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.4c-.7.3-1 .8-1 1.5v.7"/><path d="M12 16.9v.2"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    chevron: '<path d="M6 9.5l6 6 6-6"/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>',
    chart: '<path d="M4 4v16h16"/><path d="M7.5 15l3.5-4.5 3 2.5 5-6.5"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
    globe: '<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c3 3 3 16 0 19M12 2.5c-3 3-3 16 0 19"/>',
  };
  Object.keys(MORE_ICONS).forEach((k) => { if (!WS.icons[k]) WS.icons[k] = MORE_ICONS[k]; });

  /* "12.5억" "+2.3°C" "1,234 ppm" 같은 표시 문자열에서 숫자를 꺼냅니다 (추세 화살표용). */
  function numOf(str) {
    const m = String(str).replace(/,/g, '').replace(/−/g, '-').match(/([+-]?\d+(?:\.\d+)?)\s*(조|억|만)?/);
    if (!m) return NaN;
    return parseFloat(m[1]) * (m[2] ? { 조: 1e12, 억: 1e8, 만: 1e4 }[m[2]] : 1);
  }
  function fmtDur(y) {
    if (!fin(y) || y <= 0) return '';
    if (y < 0.95) return WS.fmtSeconds(y * 3.156e7);
    return WS.fmtYears(y);
  }

  /* ---------- 로비 그림: 질문 카드의 작은 도식 (SVG) ---------- */
  const r1 = (v) => Math.round(v * 10) / 10;
  function smoothPath(pts) {
    let d = `M${r1(pts[0][0])},${r1(pts[0][1])}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      d += `C${r1(p1[0] + (p2[0] - p0[0]) / 6)},${r1(p1[1] + (p2[1] - p0[1]) / 6)} ${r1(p2[0] - (p3[0] - p1[0]) / 6)},${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${r1(p2[0])},${r1(p2[1])}`;
    }
    return d;
  }
  function qArt(q) {
    const W = 240, H = 96, r = new WS.RNG(4242 + q * 97);
    const line = (pts, col, w, op, dash) => `<path d="${smoothPath(pts)}" style="fill:none;stroke:${col};stroke-width:${w};stroke-opacity:${op};stroke-linecap:round${dash ? ';stroke-dasharray:' + dash : ''}"/>`;
    const dot = (x, y, rad, col, op) => `<circle cx="${r1(x)}" cy="${r1(y)}" r="${rad}" style="fill:${col};fill-opacity:${op === undefined ? 1 : op}"/>`;
    const txt = (x, y, s, col, anchor, size) => `<text x="${r1(x)}" y="${r1(y)}" style="fill:${col};font:500 ${size || 10}px var(--f-body);text-anchor:${anchor || 'start'}">${s}</text>`;
    const walk = (xa, ya, xb, yb, n, jit, env) => {
      const pts = [];
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const e = env ? env(t) : 1;
        pts.push([xa + (xb - xa) * t, ya + (yb - ya) * t + (k && k < n ? (r.next() - 0.5) * jit * e : 0)]);
      }
      return pts;
    };
    let s = `<line x1="12" y1="${H - 7}" x2="${W - 46}" y2="${H - 7}" style="stroke:var(--line);stroke-width:1"/>`;
    s += txt(W - 10, H - 3.5, '시간 →', 'var(--muted)', 'end', 9);
    if (q === 1) {
      const x0 = 18, y0 = 44, xs = 74, xe = W - 46;
      const ends = [[11, 'var(--leaf)'], [21, 'var(--leaf)'], [31, 'var(--cyan)'], [41, 'var(--cyan)'], [51, 'var(--brass)'], [61, 'var(--brass)'], [72, 'var(--ember)']];
      ends.forEach(([ye, col]) => {
        const pts = [[xs, y0]];
        for (let k = 1; k <= 6; k++) { const t = k / 6; pts.push([xs + t * (xe - xs), y0 + (ye - y0) * (1 - (1 - t) * (1 - t)) + (k < 6 ? (r.next() - 0.5) * 7 * t : 0)]); }
        s += line(pts, col, 1.6, 0.8) + dot(xe, ye, 3, col);
      });
      s += line(walk(x0, y0, xs, y0, 5, 3), 'var(--text)', 2.2, 0.9);
      s += dot(x0, y0, 3.6, 'var(--brass-hi)') + txt(x0 - 4, y0 - 10, '2026년', 'var(--brass-hi)', 'start', 10.5);
      s += txt(xe + 7, 16, '번영', 'var(--leaf)', 'start', 10.5) + txt(xe + 7, 76, '붕괴', 'var(--ember)', 'start', 10.5);
    } else if (q === 2) {
      const x0 = 18, y0 = 46, xe = W - 34;
      for (let i = 0; i < 12; i++) {
        const u = (i / 11) * 2 - 1;
        const target = u < 0.2 ? 30 + r.next() * 7 : 64 + r.next() * 8;
        const pts = [];
        for (let k = 0; k <= 12; k++) {
          const t = k / 12;
          const bump = 30 * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (u + (r.next() - 0.5) * 0.25);
          pts.push([x0 + (xe - x0) * t, y0 + (target - y0) * Math.pow(t, 1.6) + bump * (1 - t * 0.85) + (k && k < 12 ? (r.next() - 0.5) * 3 : 0)]);
        }
        s += line(pts, i % 4 === 0 ? 'var(--brass)' : 'var(--cyan)', 1.3, 0.6);
      }
      s += dot(x0, y0, 3.6, 'var(--brass-hi)');
      s += `<path d="M${xe + 8},24 h5 v52 h-5" style="fill:none;stroke:var(--muted);stroke-width:1"/>` + txt(xe + 17, 55, '?', 'var(--text)', 'start', 15);
    } else if (q === 3) {
      const x0 = 18, y0 = 50, xi = 86, xe = W - 26;
      const base = walk(x0, y0, xe, y0 - 6, 14, 7);
      const ii = base.findIndex((p) => p[0] >= xi);
      const alt = base.map((p, k) => {
        if (k <= ii) return p.slice();
        const t = (p[0] - xi) / (xe - xi);
        return [p[0], p[1] + 26 * Math.sin(Math.PI * Math.min(1, t * 1.25)) * (1 - 0.25 * t) + (r.next() - 0.5) * 4];
      });
      s += line(alt.slice(0, ii + 1), 'var(--cyan)', 2.4, 0.9) + line(alt.slice(ii), 'var(--cyan)', 1.8, 0.85);
      s += line(base, 'var(--brass)', 1.8, 0.95);
      const sx = base[ii][0], sy = base[ii][1];
      s += `<path d="M${r1(sx)},${r1(sy - 9)}v18M${r1(sx - 9)},${r1(sy)}h18M${r1(sx - 6)},${r1(sy - 6)}l12,12M${r1(sx + 6)},${r1(sy - 6)}l-12,12" style="stroke:var(--brass-hi);stroke-width:1.3;stroke-linecap:round"/>`;
      s += txt(sx, sy - 14, '개입', 'var(--brass-hi)', 'middle', 10.5);
      s += dot(x0, y0, 3.6, 'var(--text)') + dot(xe, base[base.length - 1][1], 3, 'var(--brass)') + dot(xe, alt[alt.length - 1][1], 3, 'var(--cyan)');
      s += txt(xe - 4, base[base.length - 1][1] - 9, '그대로', 'var(--brass)', 'end', 10) + txt(xe - 4, alt[alt.length - 1][1] + 15, '개입함', 'var(--cyan)', 'end', 10);
    } else {
      const xe = W - 30;
      [[30, 'var(--brass)', 'A', [10, 18, 26, 36]], [72, 'var(--cyan)', 'B', [52, 62, 70, 80]]].forEach(([y0, col, lab, ends]) => {
        ends.forEach((ye) => { s += line(walk(30, y0, xe, ye, 9, 8, (t) => Math.sin(Math.PI * t)), col, 1.5, 0.75) + dot(xe, ye, 2.6, col); });
        s += dot(30, y0, 4, col) + txt(20, y0 + 4.5, lab, col, 'end', 13);
      });
    }
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-hidden="true">${s}</svg>`;
  }

  /* ---------- 로비 그림: 단계별 캔버스 일러스트 ---------- */
  function artSetup(host) {
    const cv = host.querySelector('canvas');
    const w = host.clientWidth, h = host.clientHeight;
    if (!cv || !w || !h) return null;
    const d = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(w * d); cv.height = Math.round(h * d);
    const c = cv.getContext('2d');
    c.setTransform(d, 0, 0, d, 0, 0);
    return [c, w, h];
  }
  function glow(c, x, y, R, stops) {
    const g = c.createRadialGradient(x, y, 0, x, y, R);
    stops.forEach(([o, col]) => g.addColorStop(o, col));
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.fill();
  }
  function artUniverse(c, w, h) {
    const bg = c.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#0c1224'); bg.addColorStop(1, '#05070b');
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    const N = new WS.Noise(7), r = new WS.RNG(21), n = Math.round((w * h) / 8);
    for (let i = 0; i < n; i++) {
      const x = r.next() * w, y = r.next() * h;
      const v = N.fbm(x / 64, y / 64, 0.5, 3);
      const ridge = 1 - Math.min(1, Math.abs(v) * 5.5), p = ridge * ridge * ridge;
      if (r.next() > p * 0.9 + 0.015) continue;
      c.fillStyle = r.next() < 0.22 ? `rgba(241,203,134,${0.2 + 0.6 * p})` : `rgba(168,205,235,${0.14 + 0.55 * p})`;
      const sz = p > 0.75 && r.next() < 0.25 ? 1.7 : 1.05;
      c.fillRect(x, y, sz, sz);
    }
    [[0.7, 0.42, h * 0.22, 0.5], [0.3, 0.64, h * 0.14, 1.7], [0.9, 0.2, h * 0.09, 2.5]].forEach(([fx, fy, R, rot]) => {
      const gx = fx * w, gy = fy * h;
      c.save(); c.translate(gx, gy); c.rotate(rot); c.scale(1, 0.48);
      glow(c, 0, 0, R * 1.3, [[0, 'rgba(255,238,205,.95)'], [0.18, 'rgba(241,203,134,.45)'], [1, 'rgba(241,203,134,0)']]);
      for (let arm = 0; arm < 2; arm++) for (let j = 0; j < 90; j++) {
        const t = j / 90, a = arm * Math.PI + t * 4.4, rr = R * (0.12 + t * 1.05);
        c.fillStyle = `rgba(196,220,255,${0.65 * (1 - t)})`;
        c.fillRect(rr * Math.cos(a) + (r.next() - 0.5) * 3, rr * Math.sin(a) + (r.next() - 0.5) * 3, 1.3, 1.3);
      }
      c.restore();
    });
  }
  function artStellar(c, w, h) {
    c.fillStyle = '#06080e'; c.fillRect(0, 0, w, h);
    const r = new WS.RNG(5);
    for (let i = 0; i < 140; i++) { c.fillStyle = `rgba(220,225,240,${0.15 + r.next() * 0.4})`; c.fillRect(r.next() * w, r.next() * h, 1, 1); }
    const sx = w * 0.15, sy = h * 0.52, sq = 0.24, D = w * 0.95;
    const ring = (rad, style, lw, dash) => { c.save(); c.strokeStyle = style; c.lineWidth = lw; if (dash) c.setLineDash(dash); c.beginPath(); c.ellipse(sx, sy, rad, rad * sq, -0.06, 0, Math.PI * 2); c.stroke(); c.restore(); };
    c.save(); c.beginPath(); c.ellipse(sx, sy, D * 0.235, D * 0.235 * sq, -0.06, 0, Math.PI * 2); c.ellipse(sx, sy, D * 0.16, D * 0.16 * sq, -0.06, 0, Math.PI * 2, true);
    c.fillStyle = 'rgba(150,207,136,.13)'; c.fill(); c.restore();
    for (let i = 0; i < 1600; i++) {
      const rr = D * Math.exp(Math.log(0.06) + r.next() * Math.log(1 / 0.06) * 0.98), a = r.next() * Math.PI * 2;
      const x = sx + Math.cos(a) * rr, y = sy + Math.sin(a) * rr * sq + (r.next() - 0.5) * 3;
      const far = rr > D * 0.34;
      c.fillStyle = far ? `rgba(150,200,220,${0.35 * (1 - rr / D) + 0.05})` : `rgba(235,190,120,${0.45 * (1 - rr / D) + 0.06})`;
      c.fillRect(x, y, 1.1, 1.1);
    }
    [0.1, 0.19, 0.3, 0.5, 0.72].forEach((k) => ring(D * k, 'rgba(236,229,212,.13)', 1));
    ring(D * 0.34, 'rgba(132,198,210,.5)', 1, [3, 4]);
    glow(c, sx, sy, h * 0.75, [[0, 'rgba(255,240,205,.95)'], [0.08, 'rgba(255,214,140,.75)'], [0.3, 'rgba(241,170,90,.18)'], [1, 'rgba(241,170,90,0)']]);
    c.fillStyle = '#fff6df'; c.beginPath(); c.arc(sx, sy, h * 0.07, 0, Math.PI * 2); c.fill();
    const planet = (k, ang, rad, col, bands) => {
      const x = sx + Math.cos(ang) * D * k, y = sy + Math.sin(ang) * D * k * sq;
      const g = c.createRadialGradient(x - rad * 0.4, y - rad * 0.4, rad * 0.1, x, y, rad);
      g.addColorStop(0, col[0]); g.addColorStop(1, col[1]);
      c.fillStyle = g; c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.fill();
      if (bands) { c.save(); c.clip(); c.strokeStyle = 'rgba(120,70,30,.35)'; c.lineWidth = rad * 0.18; for (let b = -2; b <= 2; b++) { c.beginPath(); c.moveTo(x - rad, y + b * rad * 0.36); c.lineTo(x + rad, y + b * rad * 0.36 + 1); c.stroke(); } c.restore(); }
    };
    planet(0.1, 0.9, 2.2, ['#d7b49a', '#7c5a44']);
    planet(0.19, -0.6, 3.4, ['#b9e0ff', '#2d6b9a']);
    planet(0.3, 0.35, 2.6, ['#e0a37c', '#80452d']);
    planet(0.5, -0.25, h * 0.085, ['#f6d7a6', '#a8703c'], true);
    planet(0.72, 0.12, h * 0.06, ['#cdeef3', '#4f8ea0']);
  }
  const LIFE_CAST = [
    { k: 11, x: 0.09, y: 0.7, s: 0.62, f: 1, t: { troph: 0, energy: 'photo', cx: 3, land: false, aerobic: true, intel: 0, manip: 0, social: 0, size: 0.7, sapient: false } },
    { k: 23, x: 0.25, y: 0.5, s: 0.46, f: 1, t: { troph: 1, energy: 'oxy', cx: 4, land: false, aerobic: true, intel: 0.2, manip: 0, social: 0.5, size: 0.5, sapient: false } },
    { k: 37, x: 0.42, y: 0.28, s: 0.4, f: -1, t: { troph: 2, energy: 'oxy', cx: 3, land: false, aerobic: true, intel: 0.35, manip: 0.3, social: 0, size: 0.45, sapient: false } },
    { k: 41, x: 0.46, y: 0.8, s: 0.3, f: 1, t: { troph: 1, energy: 'oxy', cx: 3, land: false, aerobic: true, intel: 0.05, manip: 0.1, social: 0, size: 0.3, sapient: false } },
    { k: 53, x: 0.9, y: 0.42, s: 0.74, f: 1, t: { troph: 0, energy: 'photo', cx: 3, land: true, aerobic: true, intel: 0, manip: 0, social: 0, size: 0.85, sapient: false } },
    { k: 67, x: 0.75, y: 0.64, s: 0.46, f: -1, t: { troph: 1, energy: 'oxy', cx: 4, land: true, aerobic: true, intel: 0.25, manip: 0.1, social: 0.6, size: 0.6, sapient: false } },
  ];
  function artLife(c, w, h) {
    const sea = c.createLinearGradient(0, 0, 0, h);
    sea.addColorStop(0, '#13505e'); sea.addColorStop(0.55, '#0b3240'); sea.addColorStop(1, '#061820');
    c.fillStyle = sea; c.fillRect(0, 0, w, h);
    c.save(); c.globalAlpha = 0.07; c.fillStyle = '#d9f4f2';
    for (let i = 0; i < 4; i++) { const x = w * (0.08 + i * 0.13); c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 26, 0); c.lineTo(x - 30, h); c.lineTo(x - 52, h); c.fill(); }
    c.restore();
    c.beginPath(); c.moveTo(w * 0.6, 0); c.bezierCurveTo(w * 0.55, h * 0.35, w * 0.68, h * 0.62, w * 0.62, h); c.lineTo(w, h); c.lineTo(w, 0); c.closePath();
    const land = c.createLinearGradient(w * 0.6, 0, w, h);
    land.addColorStop(0, '#3a4a2b'); land.addColorStop(1, '#1f2a18');
    c.fillStyle = land; c.fill();
    c.strokeStyle = 'rgba(214,240,236,.4)'; c.lineWidth = 1.5; c.stroke();
    const r = new WS.RNG(9);
    for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(150,207,136,${0.08 + r.next() * 0.18})`; c.beginPath(); c.arc(w * (0.66 + r.next() * 0.34), h * r.next(), 2 + r.next() * 5, 0, Math.PI * 2); c.fill(); }
    let drew = 0;
    if (WS.Creature && typeof WS.Creature.draw === 'function' && typeof WS.Creature.genome === 'function') {
      LIFE_CAST.forEach((a) => {
        safe('Creature.draw', () => {
          const g = WS.Creature.genome(new WS.RNG(1000 + a.k));
          WS.Creature.draw(c, g, a.t, a.x * w, a.y * h, a.s * h, { t: 0, facing: a.f, outline: true });
          drew++;
        });
      });
    }
    if (!drew) {
      // 생물 그림 모듈이 없을 때: 세포와 스트로마톨라이트
      for (let i = 0; i < 9; i++) {
        const x = w * (0.05 + r.next() * 0.48), y = h * (0.15 + r.next() * 0.7), R = 5 + r.next() * 9;
        c.fillStyle = 'rgba(150,207,136,.28)'; c.strokeStyle = 'rgba(190,235,200,.7)'; c.lineWidth = 1.2;
        c.beginPath(); c.ellipse(x, y, R * 1.3, R, r.next() * 3, 0, Math.PI * 2); c.fill(); c.stroke();
        c.fillStyle = 'rgba(241,203,134,.7)'; c.beginPath(); c.arc(x + R * 0.2, y, R * 0.32, 0, Math.PI * 2); c.fill();
      }
      for (let i = 0; i < 4; i++) {
        const x = w * (0.12 + i * 0.11), y = h;
        c.fillStyle = 'rgba(120,110,80,.85)'; c.beginPath(); c.ellipse(x, y, 16 + i * 3, 14 + (i % 2) * 6, 0, Math.PI, 0); c.fill();
      }
    }
  }
  let earthCache = null;
  const CITIES = [[116, 39.9, 1], [121.5, 31.2, 1], [113.3, 23.1, 0.9], [77.2, 28.6, 1], [72.9, 19, 0.9], [88.4, 22.6, 0.8], [139.7, 35.7, 1], [127, 37.5, 0.8], [-74, 40.7, 1],
    [-118.2, 34, 0.8], [-87.6, 41.9, 0.6], [-99.1, 19.4, 0.85], [-46.6, -23.5, 0.85], [-58.4, -34.6, 0.55], [-0.1, 51.5, 0.8], [2.3, 48.9, 0.7], [13.4, 52.5, 0.5],
    [37.6, 55.8, 0.65], [31.2, 30, 0.8], [3.4, 6.5, 0.75], [28, -26.2, 0.5], [106.8, -6.2, 0.8], [100.5, 13.8, 0.6], [67, 24.9, 0.7], [51.4, 35.7, 0.6], [29, 41, 0.65],
    [151.2, -33.9, 0.5], [-79.4, 43.7, 0.4], [36.8, -1.3, 0.45], [-77, -12, 0.5], [90.4, 23.8, 0.85], [120.9, 14.6, 0.75], [44.4, 33.3, 0.5]];
  function artCiv(c, w, h) {
    const bg = c.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0b1826'); bg.addColorStop(1, '#060c15');
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    if (!earthCache && WS.Earth && typeof WS.Earth.build === 'function') earthCache = safe('Earth.build', () => WS.Earth.build(), null);
    const E = earthCache;
    const dpp = 360 / w, latTop = 12 + (h * dpp) / 2 + 6;
    const X = (lo) => ((lo + 180) / 360) * w, Y = (la) => (latTop - la) / dpp;
    if (E && E.land && E.W && E.lat && E.lon) {
      const cell = w / E.W, rad = Math.max(0.8, cell * 0.36);
      for (let i = 0; i < E.land.length; i++) {
        if (!E.land[i]) continue;
        const y = Y(E.lat[i]);
        if (y < -2 || y > h + 2) continue;
        const t = E.temp ? E.temp[i] : 15, f = E.fert ? E.fert[i] : 0.5;
        c.fillStyle = t < -4 ? 'rgba(170,190,205,.55)' : f > 0.45 ? 'rgba(120,160,100,.75)' : f > 0.15 ? 'rgba(150,150,105,.65)' : 'rgba(170,145,100,.55)';
        c.beginPath(); c.arc(X(E.lon[i]), y, rad, 0, Math.PI * 2); c.fill();
      }
    } else {
      c.strokeStyle = 'rgba(132,198,210,.18)'; c.lineWidth = 1;
      for (let lo = -150; lo <= 180; lo += 30) { c.beginPath(); c.moveTo(X(lo), 0); c.lineTo(X(lo), h); c.stroke(); }
      for (let la = -60; la <= 60; la += 30) { c.beginPath(); c.moveTo(0, Y(la)); c.lineTo(w, Y(la)); c.stroke(); }
    }
    const arcs = [[0, 6], [8, 14], [6, 3], [14, 18], [1, 21], [12, 8], [3, 22]];
    c.lineWidth = 1;
    arcs.forEach(([a, b]) => {
      const A = CITIES[a], B = CITIES[b];
      const ax = X(A[0]), ay = Y(A[1]), bx = X(B[0]), by = Y(B[1]);
      if (Math.abs(ax - bx) > w * 0.55) return;
      c.strokeStyle = 'rgba(241,203,134,.32)';
      c.beginPath(); c.moveTo(ax, ay); c.quadraticCurveTo((ax + bx) / 2, Math.min(ay, by) - Math.abs(ax - bx) * 0.22, bx, by); c.stroke();
    });
    CITIES.forEach(([lo, la, s]) => {
      const x = X(lo), y = Y(la);
      if (y < 0 || y > h) return;
      glow(c, x, y, 3 + s * 7, [[0, 'rgba(255,226,170,.95)'], [0.25, 'rgba(255,190,110,.55)'], [1, 'rgba(255,170,90,0)']]);
    });
  }
  const ART = { universe: artUniverse, stellar: artStellar, life: artLife, civ: artCiv };

  /* ---------- 첫 방문 안내 ---------- */
  const GUIDE = [
    { target: 'viewport', title: '이 화면이 바로 이 세계입니다',
      text: (touch, narrow, canZoom) => `${narrow ? '해설 카드가 지금 무슨 일이 일어나는지 쉬운 말로 알려 주고, 범례를 펼치면 색깔의 뜻을 볼 수 있습니다.' : '왼쪽 위 해설 카드가 지금 무슨 일이 일어나는지 쉬운 말로 알려 주고, 왼쪽 아래 범례가 색깔의 뜻을 알려 줍니다.'} ${touch ? '지도를 누르면' : '지도 위에 마우스를 올리면'} 그곳의 자세한 정보가 보입니다.${narrow && canZoom ? ' "크게" 버튼을 누르면 지도를 키워 옆으로 밀어 볼 수 있습니다.' : ''}` },
    { target: 'transport', title: '시간은 저절로 흐릅니다',
      text: (touch) => `재생 버튼으로 멈추거나 이어 가고, 속도 버튼으로 빠르기를 고르세요. 막대는 관측 기간이고, 그 위의 점은 이 세계에서 일어난 큰 사건입니다.${touch ? '' : ' 스페이스바로 멈추고, 숫자 1~5로 속도를 바꿀 수 있습니다.'}` },
    { target: 'controls', title: '가끔, 간접적으로만 개입할 수 있습니다',
      text: (touch) => `개입력이 차오르면 번개·풍년·운석 같은 사건을 일으킬 수 있습니다. 위치가 필요한 개입은 버튼을 누른 뒤 지도에서 장소를 ${touch ? '누르세요' : '클릭하세요'}. 그 일을 어떻게 받아들일지는 이 세계가 정하고, 모든 개입은 연대기에 남습니다.` },
  ];

  const App = (WS.App = {
    sim: null, mode: null, modeId: null, opts: null, inherit: null, labCtx: null,
    paused: false, speed: 1, power: 5, powerMax: 10, selected: null,
    acc: 0, lastTs: 0, uiTimer: 0, uiTick: 0, lastEventId: 0, view: 0, tab: 'log',
    seed: WS.randomSeed(), W: 0, H: 0, dpr: 1, endShown: false,
    guideOpen: false, guideStep: 0, guideSeen: false, safe: { top: 0, bottom: 0 }, mapZoom: false, sparksFolded: false,

    init() {
      this.canvas = $('view');
      this.ctx = this.canvas.getContext('2d');
      this.observeEl = $('observe');
      const css = getComputedStyle(document.documentElement);
      const tok = (k, d) => (css.getPropertyValue(k) || '').trim() || d;
      this.col = { text: tok('--text', '#ece5d4'), muted: tok('--muted', '#9ba3b4'), faint: tok('--faint', '#687186'), line: tok('--line', '#263042'),
        brass: tok('--brass', '#d8a85b'), brassHi: tok('--brass-hi', '#f1cb86'), cyan: tok('--cyan', '#84c6d2'), ember: tok('--ember', '#e46a4e'), leaf: tok('--leaf', '#96cf88'),
        mono: tok('--f-mono', 'monospace'), body: tok('--f-body', 'sans-serif') };
      this.dpr = Math.min(2, window.devicePixelRatio || 1);

      this.buildLobby();
      $('seedInput').value = this.seed;
      $('seedInput').addEventListener('change', () => {
        const v = parseInt($('seedInput').value, 10);
        if (v > 0) this.seed = v >>> 0;
        $('seedInput').value = this.seed;
      });
      $('seedRoll').innerHTML = WS.icon('reroll');
      $('seedRoll').addEventListener('click', () => { this.seed = WS.randomSeed(); $('seedInput').value = this.seed; });

      // 머리줄
      // 좁은 화면에서는 짧은 이름(.lbl-s)을 씁니다 (전체 이름은 aria-label에 있음)
      $('btnRestart').innerHTML = WS.icon('reroll') + '<span class="lbl">처음부터 다시</span><span class="lbl-s">다시</span>';
      $('btnNew').innerHTML = WS.icon('seed') + '<span class="lbl">새 세계</span><span class="lbl-s">새 세계</span>';
      $('btnLabHere').innerHTML = WS.icon('flask') + '<span class="lbl">이 조건으로 실험</span><span class="lbl-s">실험</span>';
      $('btnHelp').innerHTML = WS.icon('question');
      $('btnLobby').innerHTML = WS.icon('back') + '<span class="lbl">로비</span><span class="lbl-s">로비</span>';
      $('btnRestart').setAttribute('aria-label', '같은 씨앗으로 처음부터 다시');
      $('btnNew').setAttribute('aria-label', '새 세계');
      $('btnLabHere').setAttribute('aria-label', '이 조건으로 실험');
      $('btnLobby').setAttribute('aria-label', '로비로 돌아가기');
      $('btnRestart').addEventListener('click', () => this.startMode(this.modeId, this.opts, this.inherit, this.labCtx));
      $('btnNew').addEventListener('click', () => { this.seed = WS.randomSeed(); $('seedInput').value = this.seed; this.startMode(this.modeId, this.opts, this.inherit, null); });
      $('btnLabHere').addEventListener('click', () => this.labFromHere());
      $('btnHelp').addEventListener('click', () => this.openGuide(0));
      $('btnLobby').addEventListener('click', () => this.toLobby());

      // 재생줄
      const sp = $('speeds');
      SPEEDS.forEach(([s, label], i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.dataset.s = s;
        b.title = `${label} (${s < 1 ? '¼' : s}배 · 키보드 ${i + 1})`;
        b.addEventListener('click', () => { this.speed = s; this.paused = false; this.syncTime(); });
        sp.appendChild(b);
      });
      $('btnPlay').addEventListener('click', () => {
        if (this.sim && this.sim.ended) { $('btnRestart').click(); return; } // 끝난 세계: 재생 버튼은 "처음부터 다시 보기"
        this.paused = !this.paused;
        this.syncTime();
      });
      const tl = $('timeline');
      tl.addEventListener('mousemove', (e) => this.onTimelineMove(e));
      tl.addEventListener('mouseleave', () => { $('tltip').hidden = true; });

      // 개입줄
      const acts = $('acts');
      acts.addEventListener('mouseover', (e) => { const b = e.target.closest('.act'); if (b) this.showActTip(b); });
      acts.addEventListener('mouseout', (e) => { const b = e.target.closest('.act'); if (b && !b.contains(e.relatedTarget)) this.hideActTip(); });
      acts.addEventListener('focusin', (e) => { const b = e.target.closest('.act'); if (b) this.showActTip(b); });
      acts.addEventListener('focusout', () => this.hideActTip());

      // 패널
      document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { this.setTab(b.dataset.tab); this.revealTabs(false); }));
      $('sparkToggle').insertAdjacentHTML('beforeend', WS.icon('chevron'));
      $('sparkToggle').addEventListener('click', () => {
        this.foldSparks(!this.sparksFolded);
        store.set('ws.sparks.folded', this.sparksFolded);
      });
      this.foldSparks(store.get('ws.sparks.folded', window.innerHeight < 900));
      $('logFilter').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        $('log').dataset.filter = b.dataset.f;
        [...$('logFilter').children].forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
        this.syncLogEmpty();
      });

      // 해설·범례
      $('narFold').innerHTML = WS.icon('chevron');
      $('narFold').addEventListener('click', () => this.foldNarrator(!$('narrator').classList.contains('folded')));
      $('narMore').addEventListener('click', () => this.expandNarration(!$('narrator').classList.contains('open')));
      $('narration').addEventListener('click', () => { if (!$('narMore').hidden) $('narMore').click(); });
      $('legendToggle').insertAdjacentHTML('beforeend', WS.icon('chevron'));
      $('legendToggle').addEventListener('click', () => {
        const f = !$('legendBox').classList.contains('folded');
        this.foldLegend(f);
        store.set('ws.legend.folded', f);
      });
      this.foldLegend(store.get('ws.legend.folded', window.innerWidth < 560));

      // 지도
      const cv = this.canvas;
      cv.addEventListener('click', (e) => this.onClick(e));
      cv.addEventListener('mousemove', (e) => this.onMove(e));
      cv.addEventListener('mouseleave', () => { $('tooltip').hidden = true; });
      // 탭 키로 버튼에 온 경우(키보드 사용자)와 마우스로 누른 뒤 포커스가 남은 경우를 구별합니다 (스페이스바 처리용).
      window.addEventListener('pointerdown', () => { this.kbNav = false; }, true);
      window.addEventListener('keydown', (e) => { if (e.key === 'Tab') this.kbNav = true; this.onKey(e); });
      // 일부 브라우저는 스페이스바를 뗄 때 버튼을 누르므로, 우리가 쓴 스페이스바는 keyup도 막습니다.
      window.addEventListener('keyup', (e) => { if (e.code === 'Space' && this.spaceEaten) { this.spaceEaten = false; e.preventDefault(); } });
      const ro =new ResizeObserver(() => { this.resize(); if (this.sim) { this.drawTimeline(); if (this.guideOpen) this.placeGuide(); } });
      ro.observe($('viewport'));
      ro.observe(this.canvas);
      let lastW = window.innerWidth;
      window.addEventListener('resize', () => {
        // 휴대폰은 주소창이 접힐 때도 resize가 오므로, 폭이 바뀔 때만 지도 크기를 다시 맞춥니다.
        if (window.innerWidth !== lastW) { lastW = window.innerWidth; if (this.sim) this.fitPhone(); }
        if (this.guideOpen) this.placeGuide();
      });
      window.addEventListener('scroll', () => { if (this.guideOpen) this.placeGuide(); }, { passive: true });

      // 안내
      $('guidePrev').addEventListener('click', () => this.guideGo(this.guideStep - 1));
      $('guideNext').addEventListener('click', () => (this.guideStep >= GUIDE.length - 1 ? this.closeGuide(true) : this.guideGo(this.guideStep + 1)));
      $('guideDots').innerHTML = GUIDE.map(() => '<i></i>').join('');

      // 어느 화면이 보이는지에 따라 머리줄을 맞춥니다 (실험실이 직접 화면을 바꿔도 따라감)
      const mo = new MutationObserver(() => this.syncScreen());
      ['lobby', 'observe', 'lab'].forEach((id) => mo.observe($(id), { attributes: true, attributeFilter: ['hidden'] }));
      this.syncScreen();

      this.frame = this.frame.bind(this);
      requestAnimationFrame(this.frame);
    },

    /* ---------- 로비 ---------- */
    buildLobby() {
      document.querySelectorAll('.qcard').forEach((card) => {
        const q = +card.dataset.q;
        card.querySelector('.qart').innerHTML = qArt(q);
        const go = card.querySelector('.go');
        go.insertAdjacentHTML('beforeend', WS.icon('arrow'));
        go.setAttribute('aria-label', card.querySelector('h3').textContent + ' — 실험 설계하기');
        card.addEventListener('click', () => this.openLab({ q }));
      });
      [['howSeed', 'seed'], ['howAct', 'bolt'], ['howModel', 'flask']].forEach(([id, ic]) => $(id).insertAdjacentHTML('afterbegin', WS.icon(ic)));
      $('heroLab').addEventListener('click', () => this.openLab({ q: 1 }));
      const civ = WS.modes.civ;
      const has2026 = civ && (civ.setup || []).some((f) => f.id === 'start' && f.options.some(([v]) => v === 'ad2026'));
      $('heroWatch').hidden = !has2026;
      $('heroWatch').addEventListener('click', () => this.startMode('civ', { start: 'ad2026' }, null, null));

      const box = $('stages');
      box.innerHTML = '';
      const ids = ORDER.filter((id) => WS.modes[id]);
      ids.forEach((id, i) => {
        const m = WS.modes[id];
        const art = document.createElement('article');
        art.className = 'stage-card';
        const fields = (m.setup || []).map((f) => {
          const opts = f.options.map(([v, l]) => `<option value="${esc(v)}"${v === f.value ? ' selected' : ''}>${esc(l)}</option>`).join('');
          return `<label for="f-${id}-${f.id}">${esc(f.label)}<select id="f-${id}-${f.id}">${opts}</select></label>`;
        }).join('');
        const nxt = ids[i + 1] ? WS.modes[ids[i + 1]].name : null;
        art.innerHTML = `
          <div class="stage-art"><canvas aria-hidden="true"></canvas><span class="when">${esc(m.when)}</span>
            <span class="chain">${i + 1}단계${nxt ? ` · 다음은 ${esc(nxt)}` : ' · 마지막'}</span></div>
          <div class="sc-head"><span class="nm">${esc(m.name)}</span><h3>${esc(m.question)}</h3></div>
          <p>${esc(m.desc)}</p>
          ${fields ? `<div class="fields">${fields}</div>` : '<div></div>'}
          <div class="sc-actions">
            <button class="btn primary" type="button" data-start>${WS.icon('play')}관측 시작</button>
            <button class="btn ghost" type="button" data-lab title="같은 조건의 세계를 여러 번 돌려 비교합니다">${WS.icon('flask')}여러 번 돌려 보기</button>
          </div>`;
        art.querySelector('[data-start]').addEventListener('click', () => this.startMode(id, this.readOpts(id), null, null));
        art.querySelector('[data-lab]').addEventListener('click', () => this.openLab({ q: 2, modeId: id, opts: this.readOpts(id) }));
        art.dataset.mode = id;
        box.appendChild(art);
      });
      // 그림은 레이아웃이 잡힌 뒤 그립니다 (지구 지도는 계산이 조금 걸려 맨 나중에)
      let artW = 0, artTimer = 0;
      const paint = () => {
        const cards = [...box.children];
        const w = cards.length ? cards[0].clientWidth : 0;
        if (!w || Math.abs(w - artW) < 8) return;
        artW = w;
        cards.forEach((card, k) => setTimeout(() => {
          const r = artSetup(card.querySelector('.stage-art'));
          const fn = ART[card.dataset.mode];
          if (r && fn) safe('art.' + card.dataset.mode, () => fn(r[0], r[1], r[2]));
        }, 30 + k * 40));
      };
      new ResizeObserver(() => { clearTimeout(artTimer); artTimer = setTimeout(paint, 120); }).observe(box);
    },
    readOpts(id) {
      const m = WS.modes[id], o = {};
      (m.setup || []).forEach((f) => { const s = $(`f-${id}-${f.id}`); o[f.id] = s ? s.value : f.value; });
      return o;
    },
    notice(msg) {
      const n = $('lobbyNote');
      n.textContent = msg;
      n.hidden = !msg;
    },
    toLobby() {
      this.sim = null;
      this.labCtx = null;
      this.select(null);
      this.closeGuide(false);
      this.hideActTip();
      $('observe').hidden = true;
      $('lab').hidden = true;
      $('lobby').hidden = false;
      $('seedInput').value = this.seed;
      this.syncScreen();
    },
    syncScreen() {
      const scr = !$('lab').hidden ? 'lab' : !$('observe').hidden ? 'observe' : 'lobby';
      $('app').dataset.screen = scr;
      $('crumbs').hidden = scr !== 'observe' || !this.sim;
      if (scr !== 'observe') {
        this.hideActTip();
        if (this.guideOpen) this.closeGuide(false);
      }
    },

    /* ---------- 실험실 연결 ---------- */
    openLab(preset) {
      const Lab = WS.Lab;
      if (!Lab || typeof Lab.open !== 'function') {
        this.notice('실험실을 아직 불러오지 못했습니다. 잠시 뒤 페이지를 새로 고쳐 다시 시도해 주세요.');
        if (!$('observe').hidden) this.toast({ kind: 'info', time: '', text: '실험실을 불러오지 못했습니다.' });
        return false;
      }
      this.notice('');
      this.select(null);
      this.hideActTip();
      if (this.guideOpen) this.closeGuide(false);
      if (this.sim) { this.paused = true; this.syncTime(); }
      const ok = safe('Lab.open', () => { if (preset) Lab.open(preset); else if (typeof Lab.resume === 'function') Lab.resume(); else Lab.open(); return true; }, false);
      if (!ok) { this.notice('실험실을 여는 중 문제가 생겼습니다. 페이지를 새로 고쳐 주세요.'); return false; }
      $('lobby').hidden = true;
      $('observe').hidden = true;
      $('lab').hidden = false;
      this.syncScreen();
      window.scrollTo(0, 0);
      return true;
    },
    labFromHere() {
      // 이어받은 세계(앞 단계의 결과)는 실험실에서 그대로 재현할 수 없어 기본 조건으로 엽니다.
      const preset = { q: 2, modeId: this.modeId };
      if (!this.inherit) preset.opts = copyOpts(this.opts);
      this.openLab(preset);
    },
    /* 실험실의 "관측하기": 같은 씨앗·조건(lite/cond/until 포함)으로 세계를 열고, 예약된 개입을 붙입니다. */
    openWorld(spec) {
      spec = spec || {};
      const id = spec.modeId;
      if (!WS.modes[id]) return false;
      if (fin(+spec.seed)) this.seed = (+spec.seed) >>> 0;
      const schedule = Array.isArray(spec.schedule) && spec.schedule.length ? spec.schedule.map((x) => Object.assign({}, x)) : null;
      this.startMode(id, copyOpts(spec.opts), null, { schedule, seed: this.seed });
      return true;
    },

    /* ---------- 시작 ---------- */
    startMode(id, opts, inherit, lab) {
      const m = WS.modes[id];
      if (!m) return;
      this.mode = m; this.modeId = id; this.opts = copyOpts(opts); this.inherit = inherit || null;
      this.labCtx = lab || null;
      this.sim = m.create(Object.assign({}, this.opts), this.seed, inherit || null);
      if (!this.sim.godActs) this.sim.godActs = 0;
      this.sim.sampleStride = m.sampleEvery || 10;
      if (this.labCtx && this.labCtx.schedule && WS.LabCore && typeof WS.LabCore.attachSchedule === 'function') {
        safe('LabCore.attachSchedule', () => WS.LabCore.attachSchedule(this.sim, this.labCtx.schedule.map((x) => Object.assign({}, x))));
      }
      this.paused = false; this.acc = 0; this.selected = null; this.lastEventId = 0; this.view = 0; this.endShown = false;
      this.speed = 1;
      this.power = Math.max(this.power, 4);
      this.godMarks = []; this.statHist = []; this.statSig = ''; this.sparkSig = ''; this.legendSig = ''; this.narText = null; this.narTpl = null; this.narFadeAt = 0; this.eraName = null; this.eraTimeText = null;
      this.rateRef = null; this.rateText = ''; this.lastDisasterToast = 0; this.uiTick = 0;
      this.expandNarration(false);
      this.sample();
      $('lobby').hidden = true;
      $('lab').hidden = true;
      $('observe').hidden = false;
      $('seedTag').textContent = '씨앗 ' + this.seed;
      $('modeTag').textContent = m.name + (inherit ? ' · 이어받은 세계' : '');
      $('btnLabHere').title = inherit ? '이어받은 세계는 실험실에서 기본 조건으로 다시 돌립니다' : '이 조건으로 세계를 여러 번 돌려 비교합니다';
      $('log').innerHTML = '';
      $('toasts').innerHTML = '';
      $('endcard').hidden = true;
      $('hint').hidden = true;
      $('tooltip').hidden = true;
      $('tltip').hidden = true;
      this.renderLabBar();
      this.buildActs();
      this.buildViews();
      const ex = $('extraTabBtn');
      ex.hidden = !m.extra;
      if (m.extra) ex.textContent = m.extra.label;
      $('tab-extra').innerHTML = '';
      $('tab-extra')._init = false;
      // 새 세계는 패널 맨 위에서 시작합니다. 비교표는 아직 비어 있으므로 연대기로 돌아갑니다.
      if ((this.tab === 'extra' && !m.extra) || this.tab === 'compare') this.tab = 'log';
      $('panel').scrollTop = 0;
      this.setTab(this.tab);
      this.syncTime();
      this.syncScreen();
      this.fitPhone();
      if ($('viewWrap').scrollLeft) $('viewWrap').scrollLeft = 0;
      this.resize();
      this.updateUI();
      // 좁은 화면은 창 전체가 스크롤되므로, 로비·실험실에서 내려가 있던 자리를 그대로 두면 지도가 화면 밖에 있습니다.
      // 실험실로 돌아갈 때의 자리는 실험실이 버튼 위치를 기준으로 되찾으므로 여기서 맨 위로 올려도 괜찮습니다.
      window.scrollTo(0, 0);
      if (!this.guideSeen && !store.get('ws.guide.never', false)) {
        this.guideSeen = true;
        setTimeout(() => { if (this.sim && !$('observe').hidden) this.openGuide(0); }, 450);
      }
    },
    renderLabBar() {
      const bar = $('labBar'), L = this.labCtx;
      bar.hidden = !L;
      if (!L) { bar.innerHTML = ''; return; }
      const m = this.mode, ex = m.experiment || {};
      const parts = [`씨앗 ${esc(this.seed)}`];
      if (L.schedule) {
        const items = L.schedule.map((it) => {
          const iv = (m.interventions || []).find((v) => v.id === it.id);
          const tg = (ex.targets || []).find((t) => t.key === it.target);
          const when = this.fmtX(it.at);
          return `${esc(iv ? iv.name : it.id)}${when ? ' · ' + esc(when) : ''}${tg ? ' · ' + esc(tg.label) : ''}`;
        });
        parts.push('예약된 개입: ' + items.join(', '));
      }
      bar.innerHTML = `${WS.icon('flask')}<b>실험실에서 연 세계</b><span>${parts.join(' · ')}</span><button class="btn" type="button" id="btnBackLab">${WS.icon('back')}실험실로 돌아가기</button>`;
      $('btnBackLab').addEventListener('click', () => this.openLab(null));
    },
    buildActs() {
      const box = $('acts');
      box.innerHTML = '';
      (this.mode.interventions || []).filter((iv) => !iv.labOnly).forEach((iv) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'act';
        b.setAttribute('aria-label', `${iv.name}, 개입력 ${iv.cost}. ${iv.desc || ''}`);
        b.innerHTML = WS.icon(iv.icon) + `<span>${esc(iv.name)}</span><span class="cost" aria-hidden="true">${'<i></i>'.repeat(Math.min(10, iv.cost || 0))}</span>`;
        b.addEventListener('click', () => { if (this.actState(iv).ok) { this.hideActTip(); this.useAct(iv); } else this.showActTip(b); });
        b._iv = iv;
        box.appendChild(b);
      });
      const pips = $('pips');
      pips.innerHTML = '';
      for (let i = 0; i < this.powerMax; i++) pips.appendChild(Object.assign(document.createElement('span'), { className: 'pip' }));
    },
    buildViews() {
      const v = $('views');
      v.innerHTML = '';
      const views = this.mode.views || [];
      v.hidden = views.length < 2;
      if (views.length < 2) return;
      v.insertAdjacentHTML('beforeend', '<span class="vl">지도</span>');
      views.forEach((name, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = name;
        b.dataset.i = i;
        b.setAttribute('aria-pressed', i === this.view ? 'true' : 'false');
        b.addEventListener('click', () => this.setView(i));
        v.appendChild(b);
      });
      const fit = MAP_FIT[this.modeId];
      if (fit && fit.zoom) {
        const z = document.createElement('button');
        z.type = 'button';
        z.dataset.zoom = '1';
        z.addEventListener('click', () => this.toggleZoom());
        v.appendChild(z);
        this.syncZoomBtn();
      }
    },
    syncZoomBtn() {
      const z = $('views').querySelector('[data-zoom]');
      if (!z) return;
      z.textContent = this.mapZoom ? '작게' : '크게';
      z.setAttribute('aria-pressed', this.mapZoom ? 'true' : 'false');
      z.setAttribute('aria-label', this.mapZoom ? '지도 전체 보기' : '지도 크게 보기 (옆으로 밀어 봅니다)');
    },
    toggleZoom() {
      this.mapZoom = !this.mapZoom;
      this.syncZoomBtn();
      this.fitPhone();
      this.resize();
      const wrap = $('viewWrap');
      wrap.scrollLeft = this.mapZoom ? (wrap.scrollWidth - wrap.clientWidth) / 2 : 0;
      if (this.mapZoom) this.toast({ kind: 'info', time: '', text: '지도를 옆으로 밀면 다른 곳을 볼 수 있습니다.' });
    },
    /* 휴대폰: 캔버스를 그림 크기만큼만 잡아, 재생줄과 개입 버튼이 첫 화면에 들어오게 합니다. 그 밖의 화면에서는 CSS 그대로 둡니다. */
    fitPhone() {
      const vp = $('viewport');
      const f = window.innerWidth <= PHONE_W ? MAP_FIT[this.modeId] : null;
      if (!f) { ['--view-w', '--view-h', '--view-under'].forEach((k) => vp.style.removeProperty(k)); return; }
      const W0 = vp.clientWidth || window.innerWidth;
      const W = this.mapZoom && f.zoom ? Math.round(W0 * f.zoom) : W0;
      let h = f.h(W);
      // 둥근 그림(우주·항성계)은 낮은 화면에서 줄여 재생줄 아래 개입 버튼까지 보이게 합니다 (머리줄·해설·보기·범례·재생줄 약 350px + 개입줄 일부 80px).
      if (f.min) h = WS.clamp(h, f.min, Math.max(f.min, window.innerHeight - 430));
      vp.style.setProperty('--view-w', W === W0 ? '100%' : W + 'px');
      vp.style.setProperty('--view-h', Math.round(h) + 'px');
      vp.style.setProperty('--view-under', (f.under ? f.under(W) : 0) + 'px');
    },
    setView(i) {
      this.view = i;
      [...$('views').querySelectorAll('button[data-i]')].forEach((c) => c.setAttribute('aria-pressed', +c.dataset.i === i ? 'true' : 'false'));
      this.renderLegend(true);
    },
    syncTime() {
      const ended = !!(this.sim && this.sim.ended);
      const pb = $('btnPlay');
      pb.innerHTML = WS.icon(ended ? 'reroll' : this.paused ? 'play' : 'pause');
      pb.setAttribute('aria-label', ended ? '같은 씨앗으로 처음부터 다시 보기' : this.paused ? '재생' : '일시정지');
      pb.title = ended ? '같은 씨앗으로 처음부터 다시 보기' : this.paused ? '재생' : '일시정지';
      [...$('speeds').children].forEach((b) => b.setAttribute('aria-pressed', !ended && !this.paused && +b.dataset.s === this.speed ? 'true' : 'false'));
      $('rate').textContent = ended ? '관측 끝' : this.paused ? '멈춤' : this.rateText || '';
    },
    setTab(t) {
      this.tab = t;
      document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false'));
      ['log', 'compare', 'extra'].forEach((k) => { $('tab-' + k).hidden = k !== t; });
      this.updateUI();
    },
    /* 탭 줄을 패널 맨 위로 올립니다. force가 아니면 탭 줄이 이미 위쪽에 있을 때는 움직이지 않습니다.
       넓은 화면은 패널이, 좁은 화면(패널이 페이지와 함께 흐름)은 페이지가 스크롤됩니다. */
    revealTabs(force) {
      const panel = $('panel'), tabs = panel.querySelector('.tabs');
      const pr = panel.getBoundingClientRect();
      if (getComputedStyle(panel).overflowY === 'visible') {
        const top = tabs.getBoundingClientRect().top;
        if (force || top > window.innerHeight * 0.45) window.scrollBy(0, top - 4);
        return;
      }
      const sec = tabs.previousElementSibling;
      const gap = sec.getBoundingClientRect().bottom - pr.top; // 탭 줄이 sticky여도 흔들리지 않는 기준
      if (force || gap > pr.height * 0.35) panel.scrollTop += gap;
    },
    foldSparks(f) {
      this.sparksFolded = !!f;
      $('sparks').hidden = this.sparksFolded;
      const t = $('sparkToggle');
      t.setAttribute('aria-expanded', f ? 'false' : 'true');
      t.classList.toggle('folded', this.sparksFolded);
      $('sparkNote').textContent = f ? '눌러서 그래프 펼치기' : '관측 시작부터 지금까지';
      if (!f && this.sim) this.renderSparks();
    },
    foldNarrator(f) {
      $('narrator').classList.toggle('folded', f);
      $('narFold').setAttribute('aria-expanded', f ? 'false' : 'true');
      $('narFold').setAttribute('aria-label', f ? '해설 펼치기' : '해설 접기');
    },
    expandNarration(f) {
      $('narrator').classList.toggle('open', !!f);
      $('narMore').setAttribute('aria-expanded', f ? 'true' : 'false');
      this.syncNarMore();
    },
    /* 해설이 제한 줄 수에 걸려 잘릴 때만 "더 보기"를 보입니다 (펼쳐 둔 동안에는 "접기"). */
    syncNarMore() {
      const nar = $('narrator'), p = $('narration'), b = $('narMore');
      const open = nar.classList.contains('open');
      const cut = !open && p.scrollHeight > p.clientHeight + 1;
      nar.classList.toggle('cut', cut);
      b.hidden = !(cut || (open && p.textContent));
      const label = open ? '접기' : '더 보기';
      if (b.textContent !== label) b.textContent = label;
    },
    foldLegend(f) {
      $('legendBox').classList.toggle('folded', !!f);
      $('legendToggle').setAttribute('aria-expanded', f ? 'false' : 'true');
    },

    /* ---------- 개입 ---------- */
    actState(iv) {
      const sim = this.sim;
      if (!sim) return { ok: false, why: '' };
      if (sim.ended) return { ok: false, why: '관측이 끝난 세계에는 개입할 수 없습니다.' };
      if (iv.available && !safe('available.' + iv.id, () => iv.available(sim), true)) return { ok: false, why: '지금 이 시기에는 쓸 수 없는 개입입니다.' };
      if (this.power < iv.cost) return { ok: false, why: `개입력이 부족합니다. ${iv.cost}칸이 필요하고 지금은 ${Math.floor(this.power * 10) / 10}칸입니다.` };
      return { ok: true, why: '' };
    },
    useAct(iv) {
      const st = this.actState(iv);
      if (!st.ok) return;
      if (iv.target === 'global') { this.applyAct(iv, null); return; }
      this.select(this.selected === iv ? null : iv);
    },
    select(iv) {
      this.selected = iv;
      [...$('acts').children].forEach((b) => b.setAttribute('aria-pressed', b._iv === iv ? 'true' : 'false'));
      this.canvas.classList.toggle('aiming', !!iv);
      const h = $('hint');
      h.hidden = !iv;
      if (iv) {
        const touch = isTouch();
        h.innerHTML = `<span>${esc(iv.name)}: 지도에서 위치를 ${touch ? '누르세요' : '클릭하세요'}</span><button type="button">${touch ? '취소' : '취소 (Esc)'}</button>`;
        h.querySelector('button').addEventListener('click', () => this.select(null));
        // 좁은 화면에서 안내는 지도 맨 위에 뜹니다. 개입 버튼을 누르려고 내려와 있었다면 안내와 지도가 보이게 올립니다.
        const top = h.getBoundingClientRect().top;
        if (top < 8) window.scrollBy(0, top - 8);
      }
    },
    applyAct(iv, w) {
      const sim = this.sim;
      if (!sim) return;
      const x = this.clock();
      let msg;
      if (typeof WS.intervene === 'function') {
        msg = WS.intervene(this.mode, sim, iv, w);
      } else {
        msg = iv.apply(sim, w);
        if (msg !== false) {
          sim.godActs = (sim.godActs || 0) + 1;
          sim.log('관찰자의 개입 · ' + (msg || iv.name), 'god');
        }
      }
      if (msg === false) {
        this.toast({ kind: 'info', time: iv.name, text: iv.target === 'global' ? '지금은 이 개입이 효과를 내지 못합니다.' : '이곳에는 효과가 없습니다. 다른 곳을 골라 보세요.' });
        return;
      }
      this.power -= iv.cost;
      if (fin(x)) this.godMarks.push({ x, name: iv.name });
      this.select(null);
      this.updateUI();
    },
    showActTip(b) {
      const iv = b && b._iv;
      if (!iv) return;
      const tip = $('acttip');
      const st = this.actState(iv);
      const how = iv.target === 'global' ? '누르면 세계 전체에 바로 일어납니다.' : '누른 뒤 지도에서 장소를 고릅니다.';
      tip.innerHTML = `<div class="h">${esc(iv.name)}<span>개입력 ${esc(iv.cost)}</span></div><p>${esc(iv.desc || '')}</p><span class="ahow">${how}</span>${st.why ? `<span class="why">${esc(st.why)}</span>` : ''}`;
      tip.hidden = false;
      const r = b.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
      const left = WS.clamp(r.left + r.width / 2 - tw / 2, 8, window.innerWidth - tw - 8);
      const top = r.top - th - 8 < 8 ? r.bottom + 8 : r.top - th - 8;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
      this.tipBtn = b;
    },
    hideActTip() { $('acttip').hidden = true; this.tipBtn = null; },
    canvasXY(e) {
      const r = this.canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    },
    onClick(e) {
      if (!this.sim) return;
      const [x, y] = this.canvasXY(e);
      const w = this.mode.pick ? safe('pick', () => this.mode.pick(this.sim, x, y, this.W, this.H), null) : null;
      if (this.selected) {
        if (w) this.applyAct(this.selected, w);
        return;
      }
      if (this.mode.onClick && w) { safe('onClick', () => this.mode.onClick(this.sim, w)); this.updateUI(); }
      this.onMove(e);
    },
    onMove(e) {
      const tt = $('tooltip');
      if (!this.sim || !this.mode.inspect) { tt.hidden = true; return; }
      const [x, y] = this.canvasXY(e);
      const w = this.mode.pick ? safe('pick', () => this.mode.pick(this.sim, x, y, this.W, this.H), null) : null;
      const lines = w ? safe('inspect', () => this.mode.inspect(this.sim, w), null) : null;
      if (!lines || !lines.length) { tt.hidden = true; return; }
      tt.innerHTML = lines.map((l, i) => (i === 0 ? `<b>${esc(l)}</b>` : esc(l))).join('<br>');
      tt.hidden = false;
      const tw = tt.offsetWidth, th = tt.offsetHeight;
      // 툴팁은 .vp-in 기준으로 놓입니다. 좁은 화면에서는 캔버스가 아래로 밀려 있고, 크게 보기에서는 옆으로 밀려 있어 화면 좌표로 잽니다.
      const vr = $('vpIn').getBoundingClientRect(), cr = this.canvas.getBoundingClientRect();
      const visL = Math.max(cr.left, vr.left) - vr.left + 6, visR = Math.min(cr.right, vr.right) - vr.left - tw - 6;
      const visT = cr.top - vr.top + 6, visB = cr.bottom - vr.top - th - 6;
      tt.style.left = Math.max(visL, Math.min(visR, e.clientX - vr.left + 14)) + 'px';
      tt.style.top = Math.max(visT, Math.min(visB, e.clientY - vr.top + 14)) + 'px';
      // 터치 화면에는 "마우스가 떠남"이 없으므로 잠시 뒤 닫습니다.
      clearTimeout(this.ttTimer);
      if (isTouch()) this.ttTimer = setTimeout(() => { tt.hidden = true; }, 4000);
    },
    onKey(e) {
      if (!this.sim || this.observeEl.hidden) return;
      const t = e.target, tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
      if (this.guideOpen) {
        if (e.key === 'Escape') this.closeGuide(true);
        else if (e.key === 'ArrowRight') this.guideGo(this.guideStep + 1);
        else if (e.key === 'ArrowLeft') this.guideGo(this.guideStep - 1);
        return;
      }
      if (e.code === 'Space') {
        // 스페이스바는 언제나 재생/멈춤입니다. 마우스로 누른 속도·개입 버튼에 포커스가 남아 있어도 그 버튼을 다시 누르지 않습니다.
        // 키보드(탭)로 버튼에 온 사람에게만 그 버튼을 누르는 원래 동작을 남깁니다.
        const role = (t && t.getAttribute && t.getAttribute('role')) || '';
        const ctl = tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY' || /^(button|tab|link|checkbox|switch|menuitem)$/.test(role);
        if (ctl && this.kbNav && t.id !== 'btnPlay') return;
        e.preventDefault();
        this.spaceEaten = true;
        if (e.repeat || this.sim.ended) return;
        this.paused = !this.paused;
        this.syncTime();
      }
      else if (e.key === 'Escape') { if (this.selected) this.select(null); else if (!$('endcard').hidden) $('endcard').hidden = true; }
      else if (/^[1-5]$/.test(e.key)) { this.speed = SPEEDS[+e.key - 1][0]; this.paused = false; this.syncTime(); }
      else if (e.key === '?') this.openGuide(0);
    },

    /* ---------- 루프 ---------- */
    resize() {
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      if (!w || !h) return;
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.W = w; this.H = h;
      this.canvas.width = Math.round(w * this.dpr);
      this.canvas.height = Math.round(h * this.dpr);
    },
    frame(ts) {
      requestAnimationFrame(this.frame);
      const dt = Math.min(0.1, this.lastTs ? (ts - this.lastTs) / 1000 : 0.016);
      this.lastTs = ts;
      const sim = this.sim, m = this.mode;
      if (!sim || this.observeEl.hidden) return;
      if (!this.paused && !sim.ended && !this.guideOpen) {
        this.acc += dt * (m.baseRate || 30) * this.speed;
        const t0 = performance.now();
        const LC = sim.schedule && WS.LabCore && typeof WS.LabCore.runSchedule === 'function' ? WS.LabCore : null;
        while (this.acc >= 1) {
          m.step(sim);
          sim.steps++;
          this.acc -= 1;
          if (LC) safe('LabCore.runSchedule', () => LC.runSchedule(m, sim));
          if (sim.steps % sim.sampleStride === 0) this.sample();
          if (sim.ended || performance.now() - t0 > 30) break;
        }
        if (this.acc > 2) this.acc = 2;
        this.power = Math.min(this.powerMax, this.power + dt / (m.powerRegenSec || 7));
        this.trackRate(ts);
      } else this.rateRef = null;
      for (const f of sim.fx) f.life -= dt;
      if (sim.fx.length) sim.fx = sim.fx.filter((f) => f.life > 0);
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      m.render(sim, ctx, this.W, this.H, ts / 1000, this);
      this.uiTimer -= dt;
      if (this.uiTimer <= 0) { this.uiTimer = 0.25; this.updateUI(); }
    },
    trackRate(ts) {
      const x = this.clock();
      if (!fin(x)) { this.rateRef = null; return; }
      if (!this.rateRef) { this.rateRef = { ts, x }; return; }
      const el = (ts - this.rateRef.ts) / 1000;
      if (el < 1) return;
      const per = (x - this.rateRef.x) / el;
      this.rateText = per > 0 ? `1초에 약 ${fmtDur(per)}` : '';
      $('rate').textContent = this.rateText;
      this.rateRef = { ts, x };
    },
    sample() {
      const sim = this.sim;
      const s = safe('sample', () => this.mode.sample(sim), null);
      if (!s) return;
      s._t = sim.timeValue();
      sim.history.push(s);
      if (sim.history.length > 600) {
        sim.history = sim.history.filter((_, i) => i % 2 === 0);
        sim.sampleStride *= 2;
        this.statHist = [];
      }
    },
    clock() {
      const ex = this.mode && this.mode.experiment;
      if (ex && typeof ex.clock === 'function') return safe('experiment.clock', () => ex.clock(this.sim), NaN);
      return this.sim ? this.sim.timeValue() : NaN;
    },
    fmtX(x) {
      if (!fin(x)) return '';
      const m = this.mode, ex = m && m.experiment;
      if (ex && typeof ex.xfmt === 'function') return safe('experiment.xfmt', () => ex.xfmt(x), '');
      if (m && m.batch && typeof m.batch.fmt === 'function') return safe('batch.fmt', () => m.batch.fmt(x), '');
      return WS.fmtYears(x);
    },
    /* 이 세계가 실제로 끝나는 시점 (문명 endYear, 관측 기간 until, 생명 tEnd[백만 년]). 모르면 NaN. */
    worldEnd() {
      const s = this.sim;
      if (!s) return NaN;
      if (fin(s.endYear)) return s.endYear;
      if (fin(s.until) && s.until > 0) return s.until;
      if (fin(s.tEnd)) return s.tEnd * 1e6;
      return NaN;
    },
    /* 마지막 걸음이 관측 끝을 조금 넘어도(예: 1,000억 년 → 1,001억 년) 끝난 세계의 표시 글자는 정해진 끝 시점으로 적습니다. */
    capTime(str) {
      const sim = this.sim;
      str = String(str === undefined || str === null ? '' : str);
      if (!sim || !sim.ended) return str;
      const e = this.worldEnd(), c = this.clock();
      if (!fin(e) || !fin(c) || c <= e || c - e > 0.03 * Math.abs(e)) return str;
      const a = this.fmtX(c), b = this.fmtX(e);
      return a && b && a !== b ? str.split(a).join(b) : str;
    },
    /* 관측 창: experiment.span(opts) ~ 세계가 끝나는 시점(모르면 opts.until 또는 가장 먼 지평선). 시계가 끝을 한참 넘어가면 늘립니다. */
    axisInfo() {
      const m = this.mode, ex = m.experiment;
      const clock = this.clock();
      let x0 = NaN, x1 = NaN, tf = null;
      if (ex && typeof ex.span === 'function') {
        const sp = safe('experiment.span', () => ex.span(this.opts), null);
        if (sp) { x0 = +sp[0]; x1 = +sp[1]; }
        const u = this.opts && +this.opts.until;
        if (fin(u) && u > x0) x1 = u;
        else if (typeof ex.horizonOptions === 'function') {
          const hs = safe('experiment.horizonOptions', () => ex.horizonOptions(this.opts), []) || [];
          hs.forEach((h) => { const v = +h.value; if (fin(v) && !(v <= x1)) x1 = v; });
        }
        const end = this.worldEnd();
        if (fin(end) && end > x0) x1 = end;
        if (ex.axis === 'log') {
          if (!(x0 > 0)) x0 = fin(x1) && x1 > 0 ? x1 * 1e-6 : 1;
          const lo = x0;
          tf = (v) => Math.log10(Math.max(lo, v));
        }
      }
      if (!(fin(x0) && fin(x1) && x1 > x0) && m.compare) {
        const c = m.compare;
        const first = this.sim.history.length ? this.sim.history[0]._t : NaN;
        x0 = fin(first) && first > c.min ? first : c.min;
        x1 = c.max;
        tf = c.tf || null;
      }
      if (!(fin(x0) && fin(x1) && x1 > x0)) { x0 = 0; x1 = 1; }
      tf = tf || ((v) => v);
      const t0 = tf(x0);
      let t1 = tf(x1);
      // 마지막 걸음이 끝을 살짝 넘는 정도(3% 이내)로는 눈금을 바꾸지 않습니다.
      if (fin(clock) && clock > x1 && tf(clock) > t1 + 0.03 * (t1 - t0)) { x1 = clock; t1 = tf(clock); }
      return { x0, x1, tf, t0, t1: t1 > t0 ? t1 : t0 + 1, clock };
    },

    /* ---------- 화면 갱신 ---------- */
    updateUI() {
      const sim = this.sim, m = this.mode;
      if (!sim) return;
      this.uiTick++;
      const era = safe('era', () => m.era(sim), { name: '', sub: '' }) || { name: '', sub: '' };
      this.setEraTime(this.capTime(safe('timeLabel', () => sim.timeLabel(), '')));
      if (era.name !== this.eraName) { this.eraName = era.name; $('eraName').textContent = era.name; this.updateNarration(era, true); }
      else if (this.uiTick % 4 === 0) this.updateNarration(era, false);
      this.syncNarMore();
      // 범례는 시기·보기에 따라 바뀌므로 (멈춰 있어도) 갱신할 때마다 맞춥니다. 내용이 같으면 다시 그리지 않습니다.
      this.renderLegend(false);
      this.measureSafe();
      this.renderStats();
      this.renderSparks();
      this.pushLog();
      this.drawTimeline();
      if (this.tab === 'compare') this.drawCompare();
      if (this.tab === 'extra' && m.extra) safe('extra.render', () => m.extra.render(sim, $('tab-extra'), this));
      this.updatePower();
      if (this.selected && !this.actState(this.selected).ok) this.select(null);
      if (this.tipBtn && !$('acttip').hidden) this.showActTip(this.tipBtn);
      const nx = m.next ? safe('next', () => m.next(sim), null) : null;
      const nb = $('btnNext');
      nb.hidden = !nx;
      if (nx) {
        const label = '다음 단계: ' + nx.label;
        if (nb.dataset.label !== label) { nb.dataset.label = label; nb.innerHTML = `<span>${esc(label)}</span>` + WS.icon('arrow'); }
        nb.onclick = () => { this.seed = (this.seed * 7 + 13) >>> 0; this.startMode(nx.mode, nx.opts || {}, nx.inherit || null, null); };
      }
      if (sim.ended && !this.endShown) { this.showEnd(); this.syncTime(); }
    },
    /* 모드가 지도를 그릴 때 참고할 수 있는 여백(선택): 캔버스 위·아래 가장자리를 해설 카드·범례가 덮는 높이(CSS px).
       좁은 화면에서는 안내층이 캔버스 밖에 있으므로 0입니다. render(sim, ctx, W, H, t, app)에서 app.safe로 읽습니다. */
    measureSafe() {
      const cr = this.canvas.getBoundingClientRect();
      const cover = (el, edge) => {
        if (!el || el.hidden || !el.offsetParent) return 0;
        const r = el.getBoundingClientRect();
        if (r.bottom <= cr.top || r.top >= cr.bottom || r.right <= cr.left || r.left >= cr.right) return 0;
        return edge === 'top' ? Math.max(0, r.bottom - cr.top) : Math.max(0, cr.bottom - r.top);
      };
      this.safe = {
        top: Math.round(Math.max(cover($('narrator'), 'top'), cover($('views'), 'top'))),
        bottom: Math.round(cover($('legendBox'), 'bottom')),
      };
    },
    /* 해설 카드의 시각: '행성 나이 30.8억 년 · 오늘로부터 14.9억 년 전'처럼 긴 표기는 앞부분(주 시각)과 뒷부분(보조 설명)으로 나눠,
       한 줄에 다 들어가지 않으면 보조 설명이 통째로 다음 줄로 내려가게 합니다 ('전' 한 글자만 남는 줄바꿈 방지). */
    setEraTime(label) {
      label = String(label || '');
      if (label === this.eraTimeText) return;
      this.eraTimeText = label;
      const el = $('eraTime');
      if (el.children.length !== 2) el.innerHTML = '<b></b><span></span>';
      const parts = label.split(' · ');
      const main = parts.shift() || '', rest = parts.join(' · ');
      if (el.firstChild.textContent !== main) el.firstChild.textContent = main;
      if (el.lastChild.textContent !== rest) el.lastChild.textContent = rest;
      el.lastChild.hidden = !rest;
    },
    /* 알림용 짧은 시각: 긴 표기의 앞부분(해설 카드의 주 시각과 같은 꼴, 예: '행성 나이 30.8억 년')을 쓰고,
       그래도 길면 모드의 짧은 표기(experiment.xfmt, 예: '30.8억 년')로 바꿉니다. 전체 표기는 알림에 마우스를 올리면 보입니다. */
    shortTime(e) {
      if (!e) return '';
      const head = String(e.time || '').split(' · ')[0];
      if (head.length <= 16) return head;
      const sim = this.sim;
      if (sim && fin(e.v)) {
        const c = this.clock(), tv = safe('timeValue', () => sim.timeValue(), NaN);
        if (c === tv) { const s = this.fmtX(e.v); if (s) return s; }
      }
      return head;
    },
    updateNarration(era, force) {
      const m = this.mode;
      const said = m.narrate ? safe('narrate', () => m.narrate(this.sim), '') : '';
      const text = said || era.sub || '';
      if (text === this.narText) return;
      const p = $('narration');
      const first = this.narText === null;
      const tpl = narTemplate(text), now = performance.now();
      // 숫자만 바뀌었거나 방금 페이드했다면 글자만 바꿉니다 (매초 흐려져 읽기 어렵지 않게). 시기가 바뀌면(force) 항상 페이드합니다.
      const quiet = !force && (tpl === this.narTpl || now - this.narFadeAt < 2500);
      this.narText = text;
      this.narTpl = tpl;
      p.setAttribute('aria-live', quiet ? 'off' : 'polite'); // 숫자가 바뀔 때마다 화면 읽기 프로그램이 다시 읽지 않게
      if (first || force === 'now') { p.textContent = text; return; }
      if (quiet) { if (!p.classList.contains('fading')) p.textContent = text; return; }
      this.narFadeAt = now;
      p.classList.add('fading');
      clearTimeout(this.narTimer);
      this.narTimer = setTimeout(() => { p.textContent = this.narText; p.classList.remove('fading'); }, 220);
    },
    renderLegend(force) {
      const m = this.mode, box = $('legendBox');
      const items = m.legend ? safe('legend', () => m.legend(this.sim, this.view), null) : null;
      if (!Array.isArray(items) || !items.length) { box.hidden = true; this.legendSig = ''; return; }
      const sig = JSON.stringify(items) + '|' + this.view;
      if (!force && sig === this.legendSig) return;
      this.legendSig = sig;
      box.hidden = false;
      const views = m.views || [];
      $('legendView').textContent = views.length > 1 && views[this.view] ? ' · ' + views[this.view] : '';
      $('mapLegend').innerHTML = items.map((it) => {
        if (it && Array.isArray(it.gradient)) {
          return `<div class="lg-grad">${it.label ? `<span class="gl">${esc(it.label)}</span>` : ''}<i style="background:linear-gradient(90deg,${it.gradient.map(cssColor).join(',')})"></i><span>${esc(it.from)}</span><span>${esc(it.to)}</span></div>`;
        }
        const label = it && it.label;
        const wide = textWidth(label, 12) > LEGEND_HALF;
        return `<div class="lg-item${wide ? ' wide' : ''}"><i style="background:${cssColor(it && it.color)}"></i><span>${esc(label)}</span></div>`;
      }).join('');
    },
    renderStats() {
      const rows = safe('stats', () => this.mode.stats(this.sim), []) || [];
      const box = $('stats');
      const sig = rows.map((r) => r[0]).join('|');
      if (sig !== this.statSig) {
        this.statSig = sig;
        this.statHist = [];
        box.innerHTML = rows.map(() => '<div class="stat"><dt><span></span><span class="trend"></span></dt><dd></dd></div>').join('');
      }
      const hl = this.sim.history.length;
      const nums = rows.map((r) => numOf(r[1]));
      const H = this.statHist;
      if (!H.length || H[H.length - 1].n !== hl) { H.push({ n: hl, v: nums }); if (H.length > 80) H.shift(); }
      let ref = null;
      for (let i = H.length - 1; i >= 0; i--) if (H[i].n <= hl - 10) { ref = H[i]; break; }
      rows.forEach(([k, v, c], i) => {
        const card = box.children[i];
        if (!card) return;
        const lab = card.firstChild.firstChild, tr = card.firstChild.lastChild, dd = card.lastChild;
        if (lab.textContent !== k) { lab.textContent = k; lab.title = k; }
        const vs = String(v);
        if (dd.textContent !== vs) { dd.textContent = vs; dd.title = vs; }
        const cls = c || '';
        if (dd.className !== cls) dd.className = cls;
        card.classList.toggle('text', !fin(nums[i]));
        let t = '', tc = 'trend', aria = '';
        if (ref && fin(nums[i]) && fin(ref.v[i])) {
          const a = ref.v[i], b = nums[i];
          if (Math.abs(b - a) > 0.002 * Math.max(Math.abs(a), Math.abs(b), 1e-12)) {
            const up = b > a;
            t = up ? '▲' : '▼'; tc += up ? ' up' : ' down'; aria = up ? '최근 증가' : '최근 감소';
          }
        }
        if (tr.textContent !== t) { tr.textContent = t; tr.className = tc; if (aria) tr.setAttribute('aria-label', aria); else tr.removeAttribute('aria-label'); }
      });
    },
    renderSparks() {
      const series = this.mode.chart || [];
      const box = $('sparks');
      const sig = this.modeId + ':' + series.map((s) => s.key).join(',');
      if (sig !== this.sparkSig) {
        this.sparkSig = sig;
        box.innerHTML = series.map((s) => `<div class="spark" style="--c:${cssColor(s.color)}"><div class="sl"><span>${esc(s.label)}</span><b>—</b></div><canvas aria-hidden="true"></canvas></div>`).join('');
        box.parentElement.hidden = !series.length;
      }
      if (this.sparksFolded) return;
      const hist = this.sim.history;
      // 기록은 몇 걸음에 한 번만 남으므로, 숫자와 그래프 끝점은 지금 값으로 맞춥니다 ("지금 이 세계" 카드와 같은 수). 표시 전용이며 기록에는 넣지 않습니다.
      const now = safe('sample', () => this.mode.sample(this.sim), null);
      series.forEach((s, i) => {
        const row = box.children[i];
        if (!row) return;
        let last = now && fin(now[s.key]) ? now[s.key] : undefined;
        const cur = last;
        if (last === undefined) for (let k = hist.length - 1; k >= 0; k--) { const v = hist[k][s.key]; if (v !== undefined && fin(v)) { last = v; break; } }
        const txt = last === undefined ? '—' : safe('chart.fmt', () => (s.fmt ? s.fmt(last) : WS.trimNum(last)), String(last));
        const b = row.querySelector('b');
        if (b.textContent !== txt) b.textContent = txt;
        this.drawSpark(row.querySelector('canvas'), hist, s, cur);
      });
    },
    drawSpark(cv, hist, s, cur) {
      const r = this.sizeCanvas(cv);
      if (!r) return;
      const [c, w, h] = r;
      const tf = s.log ? (v) => Math.log10(Math.max(1e-12, v)) : (v) => v;
      let lo = Infinity, hi = -Infinity;
      const pts = [];
      hist.forEach((p, i) => {
        const v = p[s.key];
        if (v === undefined || !fin(v)) return;
        const t = tf(v);
        if (t < lo) lo = t;
        if (t > hi) hi = t;
        pts.push([i, t]);
      });
      if (cur !== undefined) {
        const t = tf(cur);
        if (t < lo) lo = t;
        if (t > hi) hi = t;
        pts.push([hist.length, t]);
      }
      c.strokeStyle = 'rgba(155,163,180,.14)';
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(0, h - 0.5); c.lineTo(w, h - 0.5); c.stroke();
      if (pts.length < 2) return;
      if (s.min !== undefined) lo = Math.min(lo, tf(s.min));
      if (hi - lo < 1e-9) { hi += 0.5; lo -= 0.5; }
      const n = Math.max(1, cur !== undefined ? hist.length : hist.length - 1);
      const X = (i) => 1 + (i / n) * (w - 6), Y = (t) => h - 3 - ((t - lo) / (hi - lo)) * (h - 8);
      const col = cssColor(s.color);
      c.beginPath();
      pts.forEach(([i, t], k) => (k ? c.lineTo(X(i), Y(t)) : c.moveTo(X(i), Y(t))));
      c.save();
      c.lineTo(X(pts[pts.length - 1][0]), h); c.lineTo(X(pts[0][0]), h); c.closePath();
      c.globalAlpha = 0.16; c.fillStyle = col; c.fill();
      c.restore();
      c.beginPath();
      pts.forEach(([i, t], k) => (k ? c.lineTo(X(i), Y(t)) : c.moveTo(X(i), Y(t))));
      c.strokeStyle = col; c.lineWidth = 1.6; c.lineJoin = 'round'; c.stroke();
      const [li, lt] = pts[pts.length - 1];
      c.fillStyle = col; c.beginPath(); c.arc(X(li), Y(lt), 2.6, 0, Math.PI * 2); c.fill();
    },
    pushLog() {
      const sim = this.sim;
      const newEv = sim.events.filter((e) => e.id > this.lastEventId);
      if (!newEv.length) { this.syncLogEmpty(); return; }
      const log = $('log');
      const frag = document.createDocumentFragment();
      const toastable = [];
      newEv.forEach((e) => {
        const li = document.createElement('li');
        li.className = e.kind;
        li.innerHTML = `<span class="t">${esc(this.capTime(e.time))}</span><span class="x">${esc(this.capTime(e.text))}</span>`;
        if (e.kind === 'milestone' || e.kind === 'disaster' || e.kind === 'god') { const a = this.artFor(e, 34); if (a) li.appendChild(a); }
        frag.prepend(li);
        if (e.kind === 'milestone' || e.kind === 'god' || e.kind === 'disaster') toastable.push(e);
      });
      log.prepend(frag);
      while (log.children.length > 250) log.lastChild.remove();
      this.lastEventId = newEv[newEv.length - 1].id;
      toastable.slice(-this.toastMax()).forEach((e) => this.toast(e));
      this.syncLogEmpty();
    },
    syncLogEmpty() {
      const log = $('log'), f = log.dataset.filter;
      const any = f === 'all' ? log.children.length > 0 : !!log.querySelector(f === 'milestone' ? 'li.milestone, li.end' : f === 'disaster' ? 'li.disaster, li.end' : 'li.god');
      $('logEmpty').hidden = any;
      if (!any) $('logEmpty').textContent = f === 'god' ? '아직 개입하지 않았습니다. 아래 개입 버튼으로 세계를 슬쩍 건드려 보세요.' : '아직 기록된 일이 없습니다. 시간이 흐르면 큰 사건이 여기에 쌓입니다.';
    },
    /* 모드가 주는 그림(예: 생물 초상)을 작은 캔버스에 옮겨 그립니다. 같은 캐시 캔버스를 여러 곳에 붙이지 않기 위해 복사합니다. */
    artFor(e, size) {
      const m = this.mode;
      if (!m.eventArt) return null;
      const src = safe('eventArt', () => m.eventArt(this.sim, e), null);
      if (!src || !src.width) return null;
      const cv = document.createElement('canvas');
      const d = this.dpr || 1;
      cv.width = Math.round(size * d); cv.height = Math.round(size * d);
      const c = cv.getContext('2d');
      const k = Math.min(cv.width / src.width, cv.height / src.height);
      const dw = src.width * k, dh = src.height * k;
      safe('eventArt.draw', () => c.drawImage(src, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh));
      cv.setAttribute('aria-hidden', 'true');
      return cv;
    },
    /* 알림은 지도를 가리므로 많아야 2개, 휴대폰 배치(무대 폭 640px 이하)는 1개만 띄웁니다. 빠짐없는 기록은 연대기에 있습니다. */
    toastMax() {
      const vp = $('viewport');
      return vp && vp.clientWidth <= 640 ? 1 : 2;
    },
    /* 알림이 떠 있는 시간(ms): 시간이 빠르게 흐를수록 짧게 (옛일이 오래 남지 않게). 내 개입과 안내는 읽을 시간을 줍니다. */
    toastLife(e) {
      if (e.kind === 'end') return 9000;
      const base = this.speed <= 0.25 ? 5000 : this.speed <= 1 ? 4000 : this.speed <= 4 ? 3000 : this.speed <= 16 ? 2400 : 2000;
      return e.kind === 'god' || e.kind === 'info' ? Math.max(base, 4000) : base;
    },
    toast(e) {
      if (e.kind === 'disaster') {
        const now = performance.now();
        if (now - this.lastDisasterToast < 4000) return;
        this.lastDisasterToast = now;
      }
      const t = document.createElement('div');
      t.className = 'toast glass ' + (e.kind || 'info');
      const art = e.kind !== 'info' && e.kind !== 'end' ? this.artFor(e, 36) : null;
      if (art) t.appendChild(art);
      const body = document.createElement('div');
      body.className = 'tb';
      const when = e.kind === 'info' ? String(e.time || '') : this.shortTime(e);
      body.innerHTML = `<span class="tk">${esc(KIND[e.kind] || '기록')}${when ? ' · ' + esc(when) : ''}</span><span class="tx">${esc(e.text)}</span>`;
      if (e.time && when !== e.time) body.title = e.time;
      t.appendChild(body);
      const box = $('toasts');
      box.appendChild(t);
      const max = this.toastMax();
      while (box.children.length > max) box.firstChild.remove();
      const life = this.toastLife(e);
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 420); }, life);
    },
    updatePower() {
      const pips = $('pips').children;
      for (let i = 0; i < pips.length; i++) {
        const f = WS.clamp(this.power - i, 0, 1);
        const cls = 'pip' + (f >= 1 ? ' on' : f > 0 ? ' part' : '');
        if (pips[i].className !== cls) pips[i].className = cls;
        pips[i].style.setProperty('--p', Math.round(f * 100) + '%');
      }
      $('pnum').textContent = `${Math.floor(this.power)} / ${this.powerMax}`;
      [...$('acts').children].forEach((b) => {
        const st = this.actState(b._iv);
        b.setAttribute('aria-disabled', st.ok ? 'false' : 'true');
      });
    },

    /* ---------- 타임라인 ---------- */
    drawTimeline() {
      const r = this.sizeCanvas($('timeline'));
      if (!r || !this.sim) return;
      const [c, w, h] = r;
      const A = this.axisInfo(), col = this.col, m = this.mode, sim = this.sim;
      const L = 8, R = w - 8, ty = 24;
      const X = (v) => L + WS.clamp((A.tf(v) - A.t0) / (A.t1 - A.t0), 0, 1) * (R - L);
      const ticks = [];
      c.lineCap = 'round';
      c.lineWidth = 4;
      c.strokeStyle = 'rgba(236,229,212,.09)';
      c.beginPath(); c.moveTo(L, ty); c.lineTo(R, ty); c.stroke();
      const xn = fin(A.clock) ? X(A.clock) : L;
      if (xn > L) {
        const g = c.createLinearGradient(L, 0, xn, 0);
        g.addColorStop(0, 'rgba(216,168,91,.35)'); g.addColorStop(1, col.brass);
        c.strokeStyle = g;
        c.beginPath(); c.moveTo(L, ty); c.lineTo(xn, ty); c.stroke();
      }
      // 실제 역사의 시점 (아래쪽 옅은 눈금)
      const ms = m.milestones || [];
      c.lineCap = 'butt';
      ms.forEach((mm) => {
        if (mm.real === undefined || mm.real === null || !fin(+mm.real)) return;
        if (mm.real < A.x0 || mm.real > A.x1) return;
        const x = X(mm.real);
        c.fillStyle = 'rgba(155,163,180,.45)';
        c.fillRect(Math.round(x) - 0.5, ty + 5, 1, 5);
        ticks.push({ x, y: ty + 8, pri: 1, html: `<b>${esc(mm.name)}</b><br>${esc(m.realName || '우리 역사')}: ${esc(mm.realLabel || '')}<br>이번 세계: ${sim.reached[mm.id] ? esc(sim.reached[mm.id].label) : sim.ended ? '일어나지 않음' : '아직'}` });
      });
      // 예약된 개입(실험실)과 내가 한 개입
      const sched = Array.isArray(sim.schedule) ? sim.schedule : this.labCtx && this.labCtx.schedule ? this.labCtx.schedule : [];
      sched.forEach((it) => {
        if (!fin(+it.at)) return;
        const x = X(+it.at), iv = (m.interventions || []).find((v) => v.id === it.id);
        c.strokeStyle = col.cyan; c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(x - 4, ty - 12); c.lineTo(x + 4, ty - 12); c.lineTo(x, ty - 6); c.closePath(); c.stroke();
        ticks.push({ x, y: ty - 9, pri: 0, html: `<b>예약된 개입 · ${esc(iv ? iv.name : it.id)}</b><br>${esc(this.fmtX(+it.at))}${it.done ? ' · 실행됨' : ''}` });
      });
      (this.godMarks || []).forEach((g) => {
        const x = X(g.x);
        c.fillStyle = col.cyan;
        c.beginPath(); c.moveTo(x - 4, ty - 12); c.lineTo(x + 4, ty - 12); c.lineTo(x, ty - 6); c.closePath(); c.fill();
        ticks.push({ x, y: ty - 9, pri: 0, html: `<b>나의 개입 · ${esc(g.name)}</b><br>${esc(this.fmtX(g.x))}` });
      });
      // 이 세계에서 일어난 이정표
      ms.forEach((mm) => {
        const rr = sim.reached[mm.id];
        if (!rr || !fin(rr.v)) return;
        const x = X(rr.v);
        c.fillStyle = col.brassHi;
        c.strokeStyle = '#0b0e14'; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(x, ty - 4.5); c.lineTo(x + 4.5, ty); c.lineTo(x, ty + 4.5); c.lineTo(x - 4.5, ty); c.closePath(); c.stroke(); c.fill();
        ticks.push({ x, y: ty, pri: 0, html: `<b>${esc(mm.name)}</b><br>이번 세계: ${esc(rr.label)}${mm.realLabel ? `<br>${esc(m.realName || '우리 역사')}: ${esc(mm.realLabel)}` : ''}` });
      });
      // 지금 위치
      c.fillStyle = col.text;
      c.beginPath(); c.arc(xn, ty, 5.5, 0, Math.PI * 2); c.fill();
      c.fillStyle = col.brass;
      c.beginPath(); c.arc(xn, ty, 3, 0, Math.PI * 2); c.fill();
      // 글자: 위 = 지금, 아래 = 시작·끝
      c.font = `10.5px ${col.mono}`;
      c.textBaseline = 'alphabetic';
      c.fillStyle = col.muted;
      c.textAlign = 'left'; c.fillText(this.fmtX(A.x0), L - 2, h - 2);
      c.textAlign = 'right'; c.fillText(this.fmtX(A.x1), R + 2, h - 2);
      const nowLabel = fin(A.clock) ? this.capTime(sim.timeLabel()) : '아직 시작 전';
      c.font = `11px ${col.mono}`;
      const tw = c.measureText(nowLabel).width;
      c.fillStyle = col.brassHi;
      c.textAlign = 'left';
      c.fillText(nowLabel, WS.clamp(xn - tw / 2, 0, Math.max(0, w - tw)), 10);
      this.tlTicks = ticks;
    },
    onTimelineMove(e) {
      const tip = $('tltip');
      const ticks = this.tlTicks || [];
      const r = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let best = null, bd = 9;
      ticks.forEach((t) => { const d = Math.abs(t.x - x) + Math.abs(t.y - y) * 0.25 + t.pri * 2; if (d < bd) { bd = d; best = t; } });
      if (!best) { tip.hidden = true; return; }
      tip.innerHTML = best.html;
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = WS.clamp(best.x, tw / 2, Math.max(tw / 2, r.width - tw / 2)) + 'px';
    },

    showEnd() {
      this.endShown = true;
      const sim = this.sim, m = this.mode, ex = m.experiment;
      const card = $('endcard');
      const nx = m.next ? safe('next', () => m.next(sim), null) : null;
      let oc = '', title = sim.endTitle || '관측 종료';
      if (ex && typeof ex.classify === 'function' && Array.isArray(ex.outcomes)) {
        const key = safe('experiment.classify', () => ex.classify(sim), null);
        const o = ex.outcomes.find((x) => x.key === key);
        if (o) {
          // 평범하게 끝난 세계는 제목이 "관측 종료"뿐이라 바로 위 작은 제목과 겹치므로, 이 세계의 결말을 제목으로 씁니다.
          if (title === '관측 종료') title = o.label;
          const body = (o.label !== title ? `<b>${esc(o.label)}</b>` : '') + (o.desc ? `<span>${esc(o.desc)}</span>` : '');
          if (body) oc = `<div class="oc" style="--c:${cssColor(o.color)}"><small>이 세계의 결말</small>${body}</div>`;
        }
      }
      card.innerHTML = `<span class="kicker">관측 종료 · ${esc(this.capTime(sim.timeLabel()))}</span>
        <h3 id="endTitle">${esc(title)}</h3>${sim.endText ? `<p>${esc(this.capTime(sim.endText))}</p>` : ''}${oc}
        <p>관찰자 개입 ${sim.godActs || 0}회 · 일어난 이정표 ${Object.keys(sim.reached).length}개</p>
        <div class="row">
          ${nx ? `<button class="btn primary" type="button" data-a="next">${esc(nx.label)}</button>` : ''}
          <button class="btn${nx ? '' : ' primary'}" type="button" data-a="lab">${WS.icon('flask')}같은 조건으로 여러 번 돌려 보기</button>
          <button class="btn" type="button" data-a="new">${WS.icon('seed')}새 세계</button>
          <button class="btn" type="button" data-a="cmp">우리 역사와 비교</button>
          <button class="btn ghost" type="button" data-a="close">닫기</button>
        </div>`;
      card.hidden = false;
      card.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        const a = b.dataset.a;
        card.hidden = true;
        if (a === 'next') $('btnNext').click();
        else if (a === 'new') $('btnNew').click();
        else if (a === 'lab') this.labFromHere();
        else if (a === 'cmp') { this.setTab('compare'); this.revealTabs(true); }
      }));
    },

    sizeCanvas(cv) {
      const w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return null;
      const d = this.dpr || 1;
      if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
      const c = cv.getContext('2d');
      c.setTransform(d, 0, 0, d, 0, 0);
      c.clearRect(0, 0, w, h);
      return [c, w, h];
    },
    drawCompare() {
      const m = this.mode, sim = this.sim, cmp = m.compare, col = this.col;
      const ms = m.milestones || [];
      // " · "로 이어진 긴 시각은 조각째로 줄을 바꿉니다 (좁은 칸에서도 "행성 나이 …"와 "오늘로부터 …"가 한 줄씩 읽히게).
      const whenCell = (s) => esc(s).split(' · ').map((x) => `<span>${x}</span>`).join(' · ');
      const rows = ms.map((mm, i) => {
        const r = sim.reached[mm.id];
        const simTxt = r ? r.label : sim.ended ? '일어나지 않음' : '아직';
        return `<tr><td class="n">${i + 1}</td><td>${esc(mm.name)}</td><td class="v">${whenCell(mm.realLabel)}</td><td class="v ${r ? 'hit' : 'miss'}">${whenCell(simTxt)}</td></tr>`;
      }).join('');
      $('cmp').innerHTML = `<thead><tr><th></th><th>사건</th><th>${esc(m.realName || '우리 역사')}</th><th>이번 세계</th></tr></thead><tbody>${rows}</tbody>`;
      const r = this.sizeCanvas($('tl'));
      if (!r || !cmp) return;
      const [c, w, h] = r;
      const tf = cmp.tf || ((v) => v);
      const a = tf(cmp.min), b = tf(cmp.max);
      const pos = (v) => 10 + WS.clamp((tf(v) - a) / (b - a), 0, 1) * (w - 20);
      const y1 = 30, y2 = h - 30;
      c.font = `11px ${col.body}`;
      c.fillStyle = col.muted;
      c.textBaseline = 'middle';
      c.fillText(m.realName || '우리 역사', 10, 10);
      c.fillText('이번 세계', 10, h - 9);
      c.strokeStyle = 'rgba(155,163,180,.35)';
      c.lineWidth = 1;
      [y1, y2].forEach((y) => { c.beginPath(); c.moveTo(10, y + 0.5); c.lineTo(w - 10, y + 0.5); c.stroke(); });
      if (cmp.ticks) {
        c.fillStyle = col.faint;
        c.textAlign = 'center';
        cmp.ticks.forEach(([v, l]) => { const x = pos(v); c.fillRect(x, y1 + 3, 1, 4); c.fillText(l, x, (y1 + y2) / 2); });
        c.textAlign = 'left';
      }
      const now = sim.timeValue();
      if (fin(now)) { c.fillStyle = 'rgba(132,198,210,.6)'; c.fillRect(pos(now), y2 - 8, 1.5, 16); }
      ms.forEach((mm, i) => {
        const xr = mm.real !== undefined && mm.real !== null ? pos(mm.real) : null;
        const rr = sim.reached[mm.id];
        const xs = rr ? pos(rr.v) : null;
        if (xr !== null && xs !== null) {
          c.strokeStyle = 'rgba(216,168,91,.35)';
          c.beginPath(); c.moveTo(xr, y1); c.lineTo(xs, y2); c.stroke();
        }
        c.textAlign = 'center';
        if (xr !== null) { c.fillStyle = col.text; c.beginPath(); c.arc(xr, y1, 3, 0, 7); c.fill(); c.fillStyle = col.muted; c.fillText(String(i + 1), xr, y1 - 9 - (i % 2) * 9); }
        if (xs !== null) { c.fillStyle = col.brassHi; c.beginPath(); c.arc(xs, y2, 3.5, 0, 7); c.fill(); c.fillStyle = col.brass; c.fillText(String(i + 1), xs, y2 + 10 + (i % 2) * 9 > h - 2 ? y2 - 10 : y2 + 10); }
        c.textAlign = 'left';
      });
    },

    /* ---------- 첫 방문 안내 ---------- */
    openGuide(i) {
      if (!this.sim || this.observeEl.hidden) return;
      this.guideOpen = true;
      this.select(null);
      this.hideActTip();
      $('guideNever').checked = !!store.get('ws.guide.never', false);
      $('guide').hidden = false;
      this.guideGo(i || 0);
      $('guideNext').focus({ preventScroll: true });
    },
    guideGo(i) {
      if (!this.guideOpen) return;
      this.guideStep = WS.clamp(i, 0, GUIDE.length - 1);
      const g = GUIDE[this.guideStep];
      $('guideStep').textContent = `안내 ${this.guideStep + 1} / ${GUIDE.length}`;
      $('guideTitle').textContent = g.title;
      const vp = $('viewport'), fit = MAP_FIT[this.modeId];
      const narrow = window.innerWidth <= PHONE_W || (!!vp && vp.clientWidth <= PHONE_W);
      $('guideText').textContent = g.text(isTouch(), narrow, !!(fit && fit.zoom));
      $('guidePrev').hidden = this.guideStep === 0;
      $('guideNext').textContent = this.guideStep === GUIDE.length - 1 ? '관측 시작' : '다음';
      [...$('guideDots').children].forEach((d, k) => d.classList.toggle('on', k === this.guideStep));
      const t = $(g.target);
      if (t && window.innerWidth <= 900) t.scrollIntoView({ block: 'center' });
      this.placeGuide();
    },
    placeGuide() {
      if (!this.guideOpen) return;
      const t = $(GUIDE[this.guideStep].target);
      const spot = $('guideSpot'), card = $('guideCard');
      if (!t) return;
      const r = t.getBoundingClientRect(), pad = 4;
      const vw = window.innerWidth, vh = window.innerHeight;
      const sl = Math.max(2, r.left - pad), st = Math.max(2, r.top - pad);
      const sw = Math.min(vw - 2, r.right + pad) - sl, sh = Math.min(vh - 2, r.bottom + pad) - st;
      Object.assign(spot.style, { left: sl + 'px', top: st + 'px', width: Math.max(0, sw) + 'px', height: Math.max(0, sh) + 'px' });
      const cw = card.offsetWidth, ch = card.offsetHeight, gap = 14;
      let top;
      if (st - gap - ch >= 8) top = st - gap - ch;
      else if (st + sh + gap + ch <= vh - 8) top = st + sh + gap;
      else top = WS.clamp(st + sh / 2 - ch / 2, 8, Math.max(8, vh - ch - 8));
      const left = WS.clamp(sl + sw / 2 - cw / 2, 16, Math.max(16, vw - cw - 16));
      card.style.left = left + 'px';
      card.style.top = top + 'px';
    },
    closeGuide(save) {
      if (!this.guideOpen) { $('guide').hidden = true; return; }
      this.guideOpen = false;
      $('guide').hidden = true;
      if (save) store.set('ws.guide.never', !!$('guideNever').checked);
      if (window.innerWidth <= 900 && !$('observe').hidden) window.scrollTo(0, 0); // 안내가 내려 둔 화면을 지도 쪽으로 되돌립니다.
    },
  });

  let booted = false;
  const boot = () => { if (!booted) { booted = true; App.init(); } };
  window.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})();
