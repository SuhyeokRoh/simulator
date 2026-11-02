'use strict';
/* 창세 관측소 — 실험 엔진: 여러 세계를 화면 없이 돌려 표본을 모으고, 분포·수렴·개입 효과를 계산합니다.
   DOM 없음 (웹 워커와 Node에서도 로드됩니다). 화면은 js/lab.js가 그립니다. */
(function () {
  const G = typeof window !== 'undefined' ? window : self;
  const WS = (G.WS = G.WS || {});
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const fin = Number.isFinite;

  /* =====================================================================
     1. 모드의 experiment 블록 정규화 (없으면 기존 키로 대체값을 만듭니다)
     ===================================================================== */
  const DYN_COLORS = ['#96cf88', '#84c6d2', '#d8a85b', '#b99be0', '#e0a3c4', '#7fb3e8', '#c9c27a', '#e46a4e', '#9aa3b5'];
  const BAD_WORDS = /멸종|붕괴|쇠퇴|크런치|없는|없음|부족|못함|흩어|폭발|재앙|끓/;
  const GOOD_WORDS = /항성 간|다행성|생명이 가능|생명 가능한|지구형|문명을 이룸|초지능 시대/;
  const tidyUnit = (s) => String(s).replace(/(\d) 명/g, '$1명');

  function niceRound(v) {
    const a = Math.abs(v);
    if (!(a > 0)) return v;
    const step = Math.pow(10, Math.floor(Math.log10(a)) - (a >= 1000 && a < 1e4 ? 1 : 0));
    return Math.round(v / step) * step;
  }
  const probeCache = {};
  function probeClock(mode, E, opts) {
    const key = mode.id + '|' + JSON.stringify(opts || {});
    if (key in probeCache) return probeCache[key];
    let x = NaN;
    try {
      const s = mode.create(Object.assign({}, opts, { headless: true, lite: true }), 1, null);
      x = E.clock(s);
    } catch (e) { x = NaN; }
    probeCache[key] = x;
    return x;
  }

  function expOf(mode) {
    if (!mode) return null;
    if (mode._labExp && mode._labExp.src === mode.experiment) return mode._labExp;
    const x = mode.experiment || null;
    const cmp = mode.compare || {};
    const batch = mode.batch || {};
    const E = { src: x, native: !!x, mode };
    E.clock = x && x.clock ? x.clock : (s) => s.timeValue();
    E.axis = x && x.axis ? x.axis : cmp.tf && cmp.min > 0 ? 'log' : 'lin';
    E.xfmt = x && x.xfmt ? x.xfmt : batch.fmt || WS.fmtYears;
    E.span = x && x.span ? x.span : (opts) => {
      let x1 = fin(cmp.max) ? cmp.max : 1, x0 = fin(cmp.min) ? cmp.min : 0;
      const c = probeClock(mode, E, opts);
      if (fin(c) && c < x1) x0 = Math.max(x0, c);
      return [x0, x1];
    };
    E.horizonOptions = x && x.horizonOptions ? x.horizonOptions : (opts) => {
      const [x0, x1] = E.span(opts);
      const fr = E.axis === 'log' ? [0.5, 0.75, 0.9, 1] : [0.07, 0.25, 0.5, 1];
      const out = [];
      fr.forEach((f) => {
        let v = E.axis === 'log' && x0 > 0 ? Math.pow(10, Math.log10(x0) + f * (Math.log10(x1) - Math.log10(x0))) : x0 + f * (x1 - x0);
        if (f < 1) v = niceRound(v);
        if (v > x0 && !out.some((o) => Math.abs(o.value - v) < 1e-9 * Math.abs(v))) out.push({ value: v, label: E.xfmt(v) });
      });
      if (!out.length) out.push({ value: x1, label: E.xfmt(x1) });
      out[Math.min(out.length - 1, E.axis === 'log' ? out.length - 1 : 2)].def = true;
      return out;
    };
    E.setHorizon = x && x.setHorizon ? x.setHorizon : () => {};
    E.maxSteps = (x && x.maxSteps) || batch.maxSteps || 6000;
    if (x && x.metrics && x.metrics.length) {
      E.metrics = x.metrics.map((m) => {
        const o = Object.assign({ fmt: (v) => WS.trimNum(v), color: '#d8a85b', scale: m.log ? 0.2 : 1 }, m);
        const f0 = o.fmt;
        o.fmt = (v) => tidyUnit(f0(v)); // 실험실에서는 '33 명'을 '33명'으로
        return o;
      });
      E.read = (s) => E.metrics.map((m) => { const v = +m.get(s); return fin(v) ? v : NaN; });
    } else {
      E.metrics = (mode.chart || []).map((c) => ({
        key: c.key, label: c.label, log: !!c.log, color: c.color || '#d8a85b',
        fmt: c.fmt || ((v) => WS.trimNum(v)), scale: c.log ? 0.2 : null, // null = 관측 범위의 10% (analyze에서 계산)
      }));
      E.read = (s) => {
        let o = null;
        try { o = mode.sample ? mode.sample(s) : null; } catch (e) { o = null; }
        return E.metrics.map((m) => { const v = o ? +o[m.key] : NaN; return fin(v) ? v : NaN; });
      };
    }
    E.outcomes = x && x.outcomes ? x.outcomes : [];
    E.dynamic = !(x && x.outcomes && x.outcomes.length);
    E.classify = x && x.classify ? x.classify : (s) => {
      if (!s.ended && batch.finish) { try { batch.finish(s); } catch (e) { /* 무시 */ } }
      return s.outcome || '관측 시간 종료';
    };
    E.conditions = (x && x.conditions) || [];
    E.presets = (x && x.presets) || [];
    E.schedulable = x && x.schedulable ? x.schedulable
      : (mode.interventions || []).filter((iv) => iv.target === 'global' || mode.pick).map((iv) => iv.id);
    E.targets = x && x.targets ? x.targets : [{ key: 'random', label: '무작위 위치' }];
    E.target = x && x.target ? x.target : (s, key, rng) => pickTarget(mode, s, rng);
    E.similarity = (x && x.similarity) || null;
    E.eventIds = (x && x.eventIds) || (mode.milestones || []).map((m) => m.id);
    E.milestones = mode.milestones || [];
    // 설정(opts)에 맞는 사건 목록: 모드가 eventIdsFor(opts)를 주면 그것을 씁니다 (예: 문명은 시작 시점마다 다름)
    E.eventIdsOf = (opts) => {
      let ids = null;
      if (x && typeof x.eventIdsFor === 'function') { try { ids = x.eventIdsFor(opts || {}); } catch (e) { ids = null; } }
      if (!Array.isArray(ids) || !ids.length) ids = E.eventIds;
      if (E.milestones.length) { const known = new Set(E.milestones.map((m) => m.id)); const f = ids.filter((id) => known.has(id)); if (f.length) ids = f; }
      return ids.slice();
    };
    // 이 모드의 우연이 세계 상태(예: 정확한 인구 수)에 매 순간 섞이면, 개입 뒤의 우연은 언제나 함께 바뀝니다
    E.chanceCoupled = !!(x && x.chanceCoupled === true);
    E.iv = (id) => (mode.interventions || []).find((iv) => iv.id === id) || null;
    // 세계마다 모드가 따로 주는 요약 (결과의 extra로 들어감, 지표·결말 계산에는 쓰지 않음)
    E.extra = x && typeof x.extra === 'function' ? x.extra : null;
    // 결말 정보 (동적 범주는 결과에서 만들어짐)
    E.outcomeInfo = (key, i) => {
      const o = E.outcomes.find((q) => q.key === key);
      if (o) return o;
      const color = BAD_WORDS.test(key) ? '#e46a4e' : GOOD_WORDS.test(key) ? '#96cf88' : DYN_COLORS[(i || 0) % DYN_COLORS.length];
      return { key, label: key, color, desc: '' };
    };
    mode._labExp = E;
    return E;
  }

  /* experiment.target이 없을 때: 화면 좌표를 무작위로 골라 pick()으로 위치를 만듭니다. 사람이 사는 칸을 우선. */
  function pickTarget(mode, s, rng) {
    if (!mode.pick) return {};
    const W = 1000, H = 600;
    let first = null;
    for (let i = 0; i < 60; i++) {
      let w = null;
      try { w = mode.pick(s, rng.next() * W, rng.next() * H, W, H); } catch (e) { w = null; }
      if (!w) continue;
      if (!first) first = w;
      if (!(s.pop && w.c !== undefined) || s.pop[w.c] > 0) return w;
    }
    return first;
  }

  /* =====================================================================
     2. 개입 예약 (실험실과 관측 화면이 함께 씀)
     ===================================================================== */
  // 32비트 섞개 (murmur3 마무리 단계)
  function fmix32(h) {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }
  /* schedule: [{ id, at, target, reroll }]. reroll=true면 개입이 적용된 직후 그 세계의 주 난수 상태를 결정적으로 섞습니다
     ("개입 뒤의 우연도 함께 바뀜", 나비 효과). 개입한 세계에만 예약이 붙으므로 원래 세계의 주사위는 그대로입니다. */
  function attachSchedule(sim, schedule) {
    sim.schedule = (schedule || []).filter((it) => it && it.id).map((it) => ({ id: it.id, at: +it.at, target: it.target || null, reroll: !!it.reroll, done: false, msg: null }));
    return sim.schedule;
  }
  // 매 step 뒤에 호출: 시계가 at을 지난 항목을 한 번씩 적용 → 이번에 적용된 메시지 배열
  function runSchedule(mode, sim) {
    const S = sim.schedule;
    if (!S || !S.length || sim.ended) return [];
    const E = expOf(mode);
    const x = E.clock(sim);
    if (!fin(x)) return [];
    const out = [];
    for (let idx = 0; idx < S.length; idx++) {
      const it = S[idx];
      if (it.done || !(x >= it.at)) continue;
      it.done = true;
      const iv = E.iv(it.id);
      if (!iv) { it.msg = false; continue; }
      if (!sim.irng) sim.irng = new WS.RNG((sim.seed ^ 0x5bd1e995) >>> 0 || 7);
      let msg = false;
      const tries = iv.target === 'global' ? 1 : 8;
      for (let t = 0; t < tries && msg === false; t++) {
        let w = null;
        if (iv.target !== 'global') {
          const key = it.target || (E.targets[0] && E.targets[0].key);
          try { w = E.target(sim, key, sim.irng); } catch (e) { w = null; }
          if (!w) continue;
        }
        msg = WS.intervene(mode, sim, iv, w);
      }
      it.msg = msg;
      if (msg !== false) {
        out.push(msg);
        if (it.reroll && sim.rng && fin(sim.rng.s)) sim.rng.s = fmix32((sim.rng.s ^ 0x9e3779b9 ^ Math.imul(idx + 1, 0x85ebca6b)) >>> 0) || 1;
      }
    }
    return out;
  }

  /* =====================================================================
     3. 작업 (세계 하나, 또는 같은 씨앗 쌍둥이 한 쌍)
     ===================================================================== */
  function sampleGrid(x0, x1, K, axis) {
    const xs = new Array(K);
    const lg = axis === 'log' && x0 > 0 && x1 > x0;
    const a = lg ? Math.log10(x0) : x0, b = lg ? Math.log10(x1) : x1;
    for (let k = 0; k < K; k++) {
      const t = K === 1 ? 1 : k / (K - 1);
      xs[k] = lg ? Math.pow(10, a + (b - a) * t) : a + (b - a) * t;
    }
    xs[K - 1] = x1;
    return xs;
  }
  // 실험용 opts (headless 포함). 관측 화면에서 다시 열 때는 worldOpts (headless 제외)
  function worldOpts(spec) {
    const mode = WS.modes[spec.modeId];
    const E = expOf(mode);
    const o = Object.assign({}, spec.opts || {});
    delete o.headless;
    if (spec.lite !== false) o.lite = true;
    if (spec.cond && Object.keys(spec.cond).length) o.cond = Object.assign({}, spec.cond);
    if (fin(spec.x1)) E.setHorizon(o, spec.x1);
    return o;
  }

  const KIND_RANK = { end: 4, god: 3, milestone: 2, disaster: 1 };
  /* 연대기 요약 (≤ 40개, 정착지 줄은 따로): 숫자만 다른 같은 종류의 일이 연달아 나오면 하나로 묶고("… 외 비슷한 일 n번"),
     그래도 많으면 끝·개입·이정표를 모두 남기고 재난은 시간에 고르게 골라 남깁니다.
     정착지 줄(soft)은 어느 천체로 갔는지 보여 주는 표현 모형의 기록이라 묶기와 줄 수 계산에서 빼고 그대로 덧붙입니다. 재난 줄을 밀어내지 않습니다. */
  function chronicle(sim) {
    const ev = (sim.events || []).filter((e) => KIND_RANK[e.kind]);
    const soft = ev.filter((e) => e.soft).map((e) => ({ e, key: '', n: 1 }));
    const merged = [];
    for (const e of ev) {
      if (e.soft) continue;
      const key = e.kind + '|' + String(e.text).replace(/[0-9][0-9.,]*/g, '#');
      const last = merged[merged.length - 1];
      if (last && last.key === key && e.kind === 'disaster') { last.n++; continue; }
      merged.push({ e, key, n: 1 });
    }
    let pick = merged;
    if (merged.length > 40) {
      const keep = merged.filter((m) => KIND_RANK[m.e.kind] >= 2);
      const dis = merged.filter((m) => KIND_RANK[m.e.kind] < 2);
      const room = Math.max(0, 40 - keep.length);
      const chosen = [];
      for (let i = 0; i < room && dis.length; i++) chosen.push(dis[Math.floor(((i + 0.5) * dis.length) / room)]);
      pick = keep.slice(-40).concat(chosen).sort((a, b) => a.e.id - b.e.id);
    }
    return pick.concat(soft).sort((a, b) => a.e.id - b.e.id).map(({ e, n }) => ({ time: e.time, v: fin(e.v) ? e.v : null, text: String(e.text).replace(/\s—\s*$/, '') + (n > 1 ? ` (이후 비슷한 일 ${n - 1}번 더)` : ''), kind: e.kind }));
  }

  class Runner {
    constructor(mode, E, opts, seed, xs, cap, schedule) {
      this.mode = mode; this.E = E; this.xs = xs; this.cap = cap;
      this.sim = mode.create(Object.assign({}, opts), seed >>> 0, null);
      if (schedule && schedule.length) attachSchedule(this.sim, schedule);
      this.k = 0;
      const K = xs.length;
      this.series = E.metrics.map(() => new Array(K).fill(NaN));
      this.final = null; this.stopped = false; this.ivMsgs = [];
      this.pre = Object.keys(this.sim.reached || {}); // 시작할 때 이미 일어난 사건
    }
    record(k, vals) { for (let m = 0; m < vals.length; m++) this.series[m][k] = vals[m]; }
    // 표본 targetK까지 진행. 시간 예산을 넘기면 false
    pump(deadline, targetK) {
      const { sim, mode, E, xs } = this;
      while (this.k <= targetK && this.k < xs.length) {
        if (sim.ended || this.stopped) {
          if (!this.final) this.final = fin(E.clock(sim)) ? E.read(sim) : E.metrics.map(() => NaN);
          this.record(this.k++, this.final);
          continue;
        }
        const x = E.clock(sim);
        if (fin(x) && x >= xs[this.k]) { this.record(this.k++, E.read(sim)); continue; }
        if (sim.steps >= this.cap) { this.stopped = true; continue; }
        mode.step(sim);
        sim.steps++;
        if (sim.schedule) { const m = runSchedule(mode, sim); if (m.length) this.ivMsgs.push(...m); }
        if (now() > deadline) return false;
      }
      return true;
    }
    frac() {
      const x = this.E.clock(this.sim), xs = this.xs, K = xs.length;
      if (this.k >= K) return 1;
      let f = this.k / K;
      if (fin(x) && this.k > 0) {
        const a = xs[this.k - 1], b = xs[this.k];
        const t = this.E.axis === 'log' && a > 0 ? Math.log(Math.max(a, x) / a) / Math.log(b / a) : (x - a) / (b - a);
        f += Math.max(0, Math.min(1, t)) / K;
      }
      return Math.min(1, f);
    }
    result(seed, ms) {
      const { sim, E } = this;
      const endX = E.clock(sim);
      const ended = !!sim.ended;
      let outcome;
      try { outcome = E.classify(sim); } catch (e) { outcome = sim.outcome || '알 수 없음'; }
      const reached = {};
      for (const id in sim.reached) { const r = sim.reached[id]; if (r && fin(r.v)) reached[id] = r.v; }
      const series = {};
      E.metrics.forEach((m, i) => { series[m.key] = this.series[i]; });
      // 모드의 요약은 실패해도 결과를 버리지 않습니다. 워커로 넘길 수 있고 세계를 붙잡지 않도록 순수 자료로 복사
      let extra = null;
      if (E.extra) { try { const x = E.extra(sim); if (x) extra = JSON.parse(JSON.stringify(x)); } catch (e) { extra = null; } }
      return {
        seed: seed >>> 0, xs: this.xs, series, reached, outcome: String(outcome), endX: fin(endX) ? endX : null, ended,
        early: ended && fin(endX) && endX < this.xs[this.xs.length - 1] - 1e-9 * Math.abs(this.xs[this.xs.length - 1]),
        capped: this.stopped && !ended, chronicle: chronicle(sim), ivMsgs: this.ivMsgs, steps: sim.steps, ms: Math.round(ms), pre: this.pre,
        godActs: sim.godActs || 0,
        ...(extra ? { extra } : null),
      };
    }
  }

  function makeJob(spec) {
    const mode = WS.modes[spec.modeId];
    if (!mode) throw new Error('unknown mode ' + spec.modeId);
    const E = expOf(mode);
    const span = E.span(spec.opts || {});
    const x0 = fin(spec.x0) ? spec.x0 : span[0];
    const x1 = fin(spec.x1) ? spec.x1 : span[1];
    const K = Math.max(2, spec.samples || 64);
    const xs = sampleGrid(x0, x1, K, E.axis);
    const opts = worldOpts(spec);
    opts.headless = true;
    const cap = Math.max(200, Math.round((spec.maxSteps || E.maxSteps) * 2.5));
    const seed = spec.seed >>> 0;
    const job = { spec, progress: 0, result: null, done: false, ms: 0 };
    let base = null, alt = null, simCurve = null, k = 0;
    const init = () => {
      if (spec.pair) {
        base = new Runner(mode, E, opts, seed, xs, cap, null);
        alt = new Runner(mode, E, opts, seed, xs, cap, spec.pair.schedule || []);
        simCurve = E.similarity ? new Array(K).fill(NaN) : null;
      } else {
        base = new Runner(mode, E, opts, seed, xs, cap, spec.schedule || null);
      }
    };
    job.advance = (msBudget) => {
      if (job.done) return true;
      const t0 = now(), deadline = t0 + (msBudget || 40);
      try {
        if (!base) init();
        if (!spec.pair) {
          const ok = base.pump(deadline, K - 1);
          job.progress = base.frac();
          if (ok) { job.ms += now() - t0; job.result = base.result(seed, job.ms); job.done = true; job.progress = 1; return true; }
        } else {
          while (k < K) {
            if (!base.pump(deadline, k)) break;
            if (!alt.pump(deadline, k)) break;
            if (simCurve) { let v = NaN; try { v = +E.similarity(base.sim, alt.sim); } catch (e) { v = NaN; } simCurve[k] = fin(v) ? v : NaN; }
            k++;
          }
          job.progress = Math.min(1, (base.frac() + alt.frac()) / 2);
          if (k >= K) {
            job.ms += now() - t0;
            const a = base.result(seed, job.ms / 2), b = alt.result(seed, job.ms / 2);
            job.result = { seed, base: a, alt: b, sim: simCurve, ms: Math.round(job.ms) };
            job.done = true; job.progress = 1;
            return true;
          }
        }
      } catch (e) {
        job.ms += now() - t0;
        job.result = { seed, error: String((e && e.message) || e) };
        job.done = true; job.progress = 1;
        return true;
      }
      job.ms += now() - t0;
      return false;
    };
    job.x0 = x0; job.x1 = x1; job.xs = xs;
    return job;
  }
  // 동기 실행 (테스트·워커용)
  function runSync(spec) { const j = makeJob(spec); while (!j.advance(1e9)); return j.result; }

  /* 개입 가능 시점 찾기: 시험 세계 하나를 실험과 같은 조건으로 돌리며, 시점 xs마다 각 개입을 할 수 있는지 기록합니다.
     세계에는 손대지 않습니다 (available()과 target()만 확인, target에는 버리는 난수). spec: { modeId, opts, x1, xs, seed }
     → job.advance(ms) → done; job.avail = { ivId: [bool...] } (xs 순서) */
  function makeProbe(spec) {
    const mode = WS.modes[spec.modeId];
    if (!mode) throw new Error('unknown mode ' + spec.modeId);
    const E = expOf(mode);
    const opts = worldOpts({ modeId: spec.modeId, opts: spec.opts, cond: spec.cond, x1: spec.x1 });
    opts.headless = true;
    const xs = (spec.xs || []).filter(fin).sort((a, b) => a - b);
    const ids = E.schedulable.filter((id) => E.iv(id));
    const avail = {};
    ids.forEach((id) => { avail[id] = new Array(xs.length).fill(false); });
    const cap = Math.max(200, Math.round(E.maxSteps * 2.5));
    const tkey = E.targets[0] ? E.targets[0].key : null;
    let sim = null, k = 0;
    const check = (i) => {
      ids.forEach((id) => {
        const iv = E.iv(id);
        let ok = !sim.ended;
        try { if (ok && iv.available) ok = !!iv.available(sim); } catch (e) { ok = false; }
        if (ok && iv.target !== 'global') { let w = null; try { w = E.target(sim, tkey, new WS.RNG(0x51a7 + i)); } catch (e) { w = null; } ok = !!w; }
        avail[id][i] = ok;
      });
    };
    const job = { done: false, xs, avail, ids };
    job.advance = (ms) => {
      if (job.done) return true;
      const deadline = now() + (ms || 10);
      try {
        if (!sim) sim = mode.create(opts, (spec.seed >>> 0) || 1, null);
        while (k < xs.length && !sim.ended && (sim.steps || 0) < cap) {
          const x = E.clock(sim);
          if (fin(x) && x >= xs[k]) { check(k++); continue; }
          mode.step(sim);
          sim.steps = (sim.steps || 0) + 1;
          if (now() > deadline) return false;
        }
      } catch (e) { /* 실패하면 남은 시점은 '할 수 없음'으로 둡니다 */ }
      job.done = true;
      sim = null; // 시험 세계는 버림
      return true;
    };
    return job;
  }

  /* =====================================================================
     4. 작업자 풀 (Web Worker, 실패하면 메인 스레드 시간 분할)
     ===================================================================== */
  const SCRIPT_RE = /(?:^|\/)(core|creature|earth|universe|stellar|life|civ|labcore)\.js(?:[?#].*)?$/;
  const pool = {
    size: 1, workers: [], mode: 'idle', broken: false, workerUrl: null, scripts: null, _run: null,
    calcSize() {
      const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
      this.size = Math.max(1, Math.min(8, hc - 1));
      return this.size;
    },
    // 페이지가 실제로 읽은 스크립트 경로를 워커에 그대로 넘깁니다 (같은 코드 = 같은 결과)
    discover() {
      if (this.workerUrl) return;
      let url = 'js/labworker.js', scripts = null;
      try {
        if (typeof document !== 'undefined') {
          const list = [...document.querySelectorAll('script[src]')].map((s) => s.src).filter((s) => SCRIPT_RE.test(s));
          const lc = list.find((s) => /labcore\.js/.test(s));
          if (lc) url = lc.replace(/labcore\.js(?:[?#].*)?$/, 'labworker.js');
          if (list.length) scripts = list;
        }
      } catch (e) { /* 무시 */ }
      this.workerUrl = WS.LabCore.workerUrl || url;
      this.scripts = WS.LabCore.workerScripts || scripts;
    },
    canWork() {
      if (this.broken || typeof Worker === 'undefined') return false;
      try { if (typeof location !== 'undefined' && location.protocol === 'file:') return false; } catch (e) { /* 무시 */ }
      return true;
    },
    spawn() {
      this.discover();
      const w = new Worker(this.workerUrl);
      const rec = { w, ready: false, job: null, timer: 0 };
      if (this.scripts) w.postMessage({ type: 'init', scripts: this.scripts });
      return rec;
    },
    killAll() {
      this.workers.forEach((r) => { clearTimeout(r.timer); try { r.w.terminate(); } catch (e) { /* 무시 */ } });
      this.workers = [];
    },
    cancel() {
      const R = this._run;
      if (!R) return;
      R.cancelled = true;
      clearTimeout(R.mainTimer);
      this.killAll(); // 진행 중인 계산을 멈추려면 워커를 끝내야 합니다
      this._run = null;
      this.mode = 'idle';
      R.resolve(null);
    },
    run(specs, onProgress) {
      if (this._run) this.cancel();
      const n = specs.length;
      if (!n) return Promise.resolve([]);
      const R = { cancelled: false, results: new Array(n), done: 0, partial: new Array(n).fill(0), queue: specs.map((_, i) => i), mainQ: [], t0: now(), peak: 0, byMain: 0, byWorker: 0 };
      this._run = R;
      const self_ = this;
      const promise = new Promise((resolve) => { R.resolve = resolve; });
      const report = () => {
        if (!onProgress || R.cancelled) return;
        let f = R.done;
        for (let i = 0; i < n; i++) if (!R.results[i]) f += R.partial[i];
        const frac = n ? f / n : 1, el = now() - R.t0;
        // workers: 지금 살아 있는 작업자 수, peak: 처음에 띄운 수, byMain/byWorker: 이 화면과 작업자가 끝낸 작업 수
        try { onProgress({ done: R.done, total: n, frac, workers: self_.mode === 'worker' ? self_.workers.length : 0, peak: R.peak, byMain: R.byMain, byWorker: R.byWorker, mode: self_.mode, elapsed: el, eta: frac > 0.02 ? el * (1 - frac) / frac : NaN }); } catch (e) { /* 무시 */ }
      };
      const finishOne = (i, res, onMain) => {
        if (R.cancelled || R.results[i]) return;
        R.results[i] = res || { seed: specs[i].seed >>> 0, error: 'no result' };
        R.done++;
        if (onMain) R.byMain++; else R.byWorker++;
        report();
        if (R.done === n) { self_._run = null; self_.mode = 'idle'; R.resolve(R.results); }
      };
      // --- 메인 스레드 시간 분할 ---
      let cur = null, curI = -1;
      const mainTick = () => {
        if (R.cancelled) return;
        const until = now() + 40;
        while (now() < until) {
          if (!cur) {
            if (!R.mainQ.length) { R.mainTimer = 0; return; }
            curI = R.mainQ.shift();
            if (R.results[curI]) { cur = null; continue; }
            try { cur = makeJob(specs[curI]); } catch (e) { finishOne(curI, { seed: specs[curI].seed >>> 0, error: String(e.message || e) }, true); cur = null; continue; }
          }
          if (cur.advance(Math.max(1, until - now()))) { const r = cur.result; cur = null; finishOne(curI, r, true); }
          else R.partial[curI] = cur.progress;
        }
        report();
        if (!R.cancelled && (cur || R.mainQ.length)) R.mainTimer = setTimeout(mainTick, 0);
        else R.mainTimer = 0;
      };
      const toMain = (idx) => {
        R.mainQ.push(...idx);
        if (self_.mode !== 'worker') self_.mode = 'main';
        if (!R.mainTimer) R.mainTimer = setTimeout(mainTick, 0);
      };
      const fallbackAll = () => {
        // 아직 끝나지 않은 모든 작업을 메인 스레드로
        const left = [];
        self_.workers.forEach((r) => { if (r.job !== null && !R.results[r.job]) left.push(r.job); r.job = null; });
        left.push(...R.queue.splice(0));
        self_.killAll();
        self_.broken = true;
        self_.mode = 'main';
        toMain(left);
        report();
      };
      if (!this.canWork()) { this.mode = 'main'; toMain(R.queue.splice(0)); report(); return promise; }
      // --- 워커 ---
      this.calcSize();
      const want = Math.min(this.size, n);
      try { while (this.workers.length < want) this.workers.push(this.spawn()); }
      catch (e) { this.killAll(); this.broken = true; this.mode = 'main'; toMain(R.queue.splice(0)); report(); return promise; }
      this.mode = 'worker';
      R.peak = want;
      const feed = (rec) => {
        if (R.cancelled) return;
        if (!R.queue.length) { rec.job = null; return; }
        const i = R.queue.shift();
        rec.job = i;
        rec.w.postMessage({ type: 'run', id: i, spec: specs[i] });
      };
      this.workers.forEach((rec, wi) => {
        rec.w.onmessage = (ev) => {
          const d = ev.data || {};
          if (R.cancelled || self_._run !== R) return;
          if (!rec.ready) { rec.ready = true; clearTimeout(rec.timer); }
          if (d.type === 'fatal') { fallbackAll(); return; }
          if (d.type === 'progress' && d.id === rec.job) { R.partial[d.id] = d.p; return; }
          if ((d.type === 'result' || d.type === 'error') && d.id === rec.job) {
            const i = rec.job;
            finishOne(i, d.type === 'result' ? d.result : { seed: specs[i].seed >>> 0, error: d.message || 'error' });
            feed(rec);
          }
        };
        rec.w.onerror = (ev) => {
          if (ev && ev.preventDefault) ev.preventDefault();
          if (R.cancelled || self_._run !== R) return;
          if (!rec.ready) { fallbackAll(); return; }
          // 일하던 워커 하나가 죽으면 그 작업만 메인 스레드로
          const i = rec.job;
          rec.job = null;
          try { rec.w.terminate(); } catch (e) { /* 무시 */ }
          self_.workers = self_.workers.filter((r) => r !== rec);
          if (i !== null && !R.results[i]) toMain([i]);
          if (!self_.workers.length) { self_.mode = 'main'; if (R.queue.length) toMain(R.queue.splice(0)); }
          report();
        };
        if (!rec.ready) rec.timer = setTimeout(() => { if (!rec.ready && !R.cancelled && self_._run === R) fallbackAll(); }, 8000);
        feed(rec);
      });
      report();
      return promise;
    },
  };

  /* =====================================================================
     5. 통계
     ===================================================================== */
  const finOnly = (a) => { const o = []; for (const v of a) if (fin(v)) o.push(v); return o; };
  function quantile(a, q) {
    const s = finOnly(a).sort((x, y) => x - y);
    if (!s.length) return NaN;
    const p = (s.length - 1) * Math.min(1, Math.max(0, q)), i = Math.floor(p), f = p - i;
    return i + 1 < s.length ? s[i] + (s[i + 1] - s[i]) * f : s[i];
  }
  const median = (a) => quantile(a, 0.5);
  function mean(a) { const s = finOnly(a); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : NaN; }
  function std(a) { const s = finOnly(a); if (s.length < 2) return 0; const m = mean(s); return Math.sqrt(s.reduce((x, y) => x + (y - m) * (y - m), 0) / (s.length - 1)); }
  const tfOf = (log) => (log ? (v) => (fin(v) ? Math.log10(Math.max(v, 1e-30)) : NaN) : (v) => v);
  const itfOf = (log) => (log ? (u) => Math.pow(10, u) : (u) => u);
  // 여러 세계의 시계열 → 표본마다 분위수 띠 (log=true이면 로그 공간에서 계산)
  function fan(seriesList, log) {
    const K = seriesList.length ? seriesList[0].length : 0, tf = tfOf(log), it = itfOf(log);
    const o = { lo90: [], lo50: [], med: [], hi50: [], hi90: [], n: [] };
    for (let k = 0; k < K; k++) {
      const col = [];
      for (const s of seriesList) { const u = tf(s[k]); if (fin(u)) col.push(u); }
      col.sort((a, b) => a - b);
      const q = (p) => { if (!col.length) return NaN; const x = (col.length - 1) * p, i = Math.floor(x), f = x - i; return it(i + 1 < col.length ? col[i] + (col[i + 1] - col[i]) * f : col[i]); };
      o.lo90.push(q(0.05)); o.lo50.push(q(0.25)); o.med.push(q(0.5)); o.hi50.push(q(0.75)); o.hi90.push(q(0.95)); o.n.push(col.length);
    }
    return o;
  }
  // 정규화 엔트로피 H(counts)/log(범주 수): 0 = 모두 같은 결말, 1 = 고르게 퍼짐
  function entropy(counts, nCats) {
    const v = Array.isArray(counts) ? counts : Object.values(counts);
    const tot = v.reduce((a, b) => a + b, 0);
    const C = Math.max(2, nCats || v.length);
    if (!tot) return 0;
    let h = 0;
    for (const c of v) if (c > 0) { const p = c / tot; h -= p * Math.log(p); }
    return Math.min(1, h / Math.log(C));
  }
  // 전변동 거리 (total variation distance): 두 결말 분포가 다른 정도 0..1
  function tvd(a, b) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    let ta = 0, tb = 0;
    keys.forEach((k) => { ta += a[k] || 0; tb += b[k] || 0; });
    if (!ta || !tb) return 0;
    let s = 0;
    keys.forEach((k) => { s += Math.abs((a[k] || 0) / ta - (b[k] || 0) / tb); });
    return s / 2;
  }
  const countBy = (arr) => { const o = {}; for (const k of arr) o[k] = (o[k] || 0) + 1; return o; };
  /* 순열 검정. stat(A, B) → 클수록 다름. paired=true면 쌍 안에서만 자리를 바꿉니다(쌍둥이 비교). 결정적 난수(seed) 사용.
     순차 몬테카를로 규칙(Besag & Clifford 1991): 순열 통계가 관측 통계 이상인 경우가 h번 나오면 그 자리(L번째 순열)에서 멈추고
     p = h / L, 끝까지(n번) 가면 p = (1 + #{순열 통계 ≥ 관측 통계}) / (1 + n). p가 분명히 큰 검정은 수십 번 만에 끝납니다. */
  const PERM_N = 2000, PERM_H = 40, EPS = 1e-12;
  // 검정용 빠른 난수: WS.RNG와 같은 mulberry32를 지역 함수로 (반복문 안에서 전역 조회를 피함)
  const imul = Math.imul, mfloor = Math.floor, mabs = Math.abs, NEG_INF = -Infinity;
  function prng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { let t = (s = (s + 0x6d2b79f5) >>> 0); t = imul(t ^ (t >>> 15), t | 1); t ^= t + imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function seqP(n, h, trial) {
    let ge = 0;
    for (let t = 1; t <= n; t++) if (trial()) { ge++; if (ge >= h) return ge / t; }
    return (ge + 1) / (n + 1);
  }
  function permTest(a, b, stat, opts) {
    opts = opts || {};
    const n = opts.n || PERM_N, h = opts.h || PERM_H, rnd = prng(opts.seed || 0x2545f491), paired = !!opts.paired;
    const obs = stat(a, b);
    if (!fin(obs)) return { obs, p: NaN };
    const A = a.slice(), B = b.slice();
    const pool_ = paired ? null : a.concat(b);
    const p = seqP(n, h, () => {
      if (paired) {
        for (let i = 0; i < a.length; i++) { if (rnd() < 0.5) { A[i] = b[i]; B[i] = a[i]; } else { A[i] = a[i]; B[i] = b[i]; } }
      } else {
        for (let i = pool_.length - 1; i > 0; i--) { const j = mfloor(rnd() * (i + 1)); const x = pool_[i]; pool_[i] = pool_[j]; pool_[j] = x; }
        for (let i = 0; i < a.length; i++) A[i] = pool_[i];
        for (let i = 0; i < b.length; i++) B[i] = pool_[a.length + i];
      }
      return stat(A, B) >= obs - EPS;
    });
    return { obs, p };
  }
  /* ---- 같은 규칙을 쓰는 빠른 전용 검정 (실험실 분석이 화면을 멈추지 않도록) ---- */
  // 버퍼 a[0..n-1]의 k번째 작은 값 (제자리 quickselect; 끝나면 a[0..k-1] ≤ a[k] ≤ a[k+1..])
  function selectK(a, n, k) {
    let lo = 0, hi = n - 1;
    while (hi > lo) {
      const pv = a[(lo + hi) >> 1];
      let i = lo, j = hi;
      while (i <= j) {
        while (a[i] < pv) i++;
        while (a[j] > pv) j--;
        if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
      }
      if (k <= j) hi = j; else if (k >= i) lo = i; else break;
    }
    return a[k];
  }
  // 중앙값 (짝수 개면 가운데 두 값의 평균 = quantile(·,0.5)와 같음). 버퍼 순서를 바꿉니다.
  function medBuf(a, n) {
    if (n <= 0) return NaN;
    const m = n >> 1, hi = selectK(a, n, m);
    if (n & 1) return hi;
    let lo = NEG_INF;
    for (let i = 0; i < m; i++) if (a[i] > lo) lo = a[i];
    return (lo + hi) / 2;
  }
  function shuffle(arr, rnd) { for (let i = arr.length - 1; i > 0; i--) { const j = mfloor(rnd() * (i + 1)); const x = arr[i]; arr[i] = arr[j]; arr[j] = x; } }
  // 결말 분포의 전변동 거리 (범주 → 정수로 바꿔 셈). paired=true면 쌍 안에서 자리 바꾸기.
  function permTVD(la, lb, opts) {
    opts = opts || {};
    const na = la.length, nb = lb.length;
    if (!na || !nb) return { obs: 0, p: NaN };
    const keys = [...new Set(la.concat(lb))], id = new Map(keys.map((k, i) => [k, i])), C = keys.length;
    const A = Int32Array.from(la, (k) => id.get(k)), B = Int32Array.from(lb, (k) => id.get(k));
    const ca = new Float64Array(C), cb = new Float64Array(C);
    const dist = () => { let s = 0; for (let c = 0; c < C; c++) s += mabs(ca[c] / na - cb[c] / nb); return s / 2; };
    for (let i = 0; i < na; i++) ca[A[i]]++;
    for (let i = 0; i < nb; i++) cb[B[i]]++;
    const obs = dist();
    if (obs < EPS) return { obs: 0, p: 1 };
    const rnd = prng(opts.seed || 0x51ed270b), n = opts.n || PERM_N, h = opts.h || PERM_H;
    let p;
    if (opts.paired && na === nb) {
      const disc = [];
      for (let i = 0; i < na; i++) if (A[i] !== B[i]) disc.push(i);
      const a0 = Float64Array.from(ca), b0 = Float64Array.from(cb);
      p = seqP(n, h, () => {
        ca.set(a0); cb.set(b0);
        for (const i of disc) if (rnd() < 0.5) { ca[A[i]]--; ca[B[i]]++; cb[B[i]]--; cb[A[i]]++; }
        return dist() >= obs - EPS;
      });
    } else {
      const P = new Int32Array(na + nb); P.set(A); P.set(B, na);
      const tot = new Float64Array(C);
      for (let i = 0; i < P.length; i++) tot[P[i]]++;
      p = seqP(n, h, () => {
        shuffle(P, rnd);
        ca.fill(0);
        for (let i = 0; i < na; i++) ca[P[i]]++;
        for (let c = 0; c < C; c++) cb[c] = tot[c] - ca[c];
        return dist() >= obs - EPS;
      });
    }
    return { obs, p };
  }
  /* 시점 · 지표 차이의 검정은 순위로 합니다. 중앙값 차이를 통계로 쓰면, 두 묶음이 각각 한 값에 몰려 있을 때(동률)
     자리를 섞어도 중앙값 차이가 거의 그대로 나와서 차이가 아무리 커도 p가 작아지지 않습니다.
     화면에 보여 주는 크기는 그대로 중앙값의 차이입니다. dir: 순위로 본 방향(B가 크면 +1) */
  // 오름차순 평균 순위 (1부터, 같은 값은 같은 평균 순위)
  function midRanks(v) {
    const n = v.length, idx = new Array(n), r = new Float64Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    idx.sort((x, y) => v[x] - v[y]);
    for (let i = 0; i < n;) {
      let j = i + 1;
      while (j < n && v[idx[j]] === v[idx[i]]) j++;
      const m = (i + 1 + j) / 2;
      for (let t = i; t < j; t++) r[idx[t]] = m;
      i = j;
    }
    return r;
  }
  // 짝 없는 비교: 평균 순위의 차이로 자리 섞기 검정 (윌콕슨 순위합과 같음). obs = |중앙값(B) − 중앙값(A)|
  function permMedDiff(xa, xb, opts) {
    opts = opts || {};
    const a = Float64Array.from(finOnly(xa)), b = Float64Array.from(finOnly(xb)), na = a.length, nb = b.length;
    if (na < 2 || nb < 2) return { obs: NaN, p: NaN };
    const obs = mabs(medBuf(Float64Array.from(b), nb) - medBuf(Float64Array.from(a), na));
    const P = new Float64Array(na + nb); P.set(a); P.set(b, na);
    const R = midRanks(P);
    let tot = 0, s0 = 0;
    for (let i = 0; i < R.length; i++) { tot += R[i]; if (i < na) s0 += R[i]; }
    const diff = (sa) => (tot - sa) / nb - sa / na, d0 = diff(s0), TOL = 1e-9;
    if (mabs(d0) < TOL) return { obs, p: 1, dir: 0 };
    const rnd = prng(opts.seed || 0x7a3b12);
    const p = seqP(opts.n || PERM_N, opts.h || PERM_H, () => {
      shuffle(R, rnd);
      let sa = 0;
      for (let i = 0; i < na; i++) sa += R[i];
      return mabs(diff(sa)) >= mabs(d0) - TOL;
    });
    return { obs, p, dir: d0 > 0 ? 1 : -1 };
  }
  // 쌍 비교: 부호 있는 순위로 부호 뒤집기 검정 (윌콕슨 부호순위와 같음, 차이가 0인 쌍은 뺌). obs = |중앙값(d)|
  function permSignMed(xd, opts) {
    opts = opts || {};
    const d = Float64Array.from(finOnly(xd)), n = d.length;
    if (n < 2) return { obs: NaN, p: NaN };
    const obs = mabs(medBuf(Float64Array.from(d), n));
    const nz = [];
    for (let i = 0; i < n; i++) if (mabs(d[i]) > EPS) nz.push(d[i]);
    if (!nz.length) return { obs, p: 1, dir: 0 };
    const R = midRanks(nz.map(mabs)), m = nz.length, TOL = 1e-9;
    let w0 = 0;
    for (let i = 0; i < m; i++) w0 += nz[i] > 0 ? R[i] : -R[i];
    if (mabs(w0) < TOL) return { obs, p: 1, dir: 0 };
    const rnd = prng(opts.seed || 0x7a3b11);
    const p = seqP(opts.n || PERM_N, opts.h || PERM_H, () => {
      let w = 0;
      for (let i = 0; i < m; i++) w += rnd() < 0.5 ? R[i] : -R[i];
      return mabs(w) >= mabs(w0) - TOL;
    });
    return { obs, p, dir: w0 > 0 ? 1 : -1 };
  }
  // 0/1 비율 차이 |평균(B) − 평균(A)|. paired=true면 서로 다른 쌍만 부호를 뒤집음.
  function permRate(ia, ib, paired, opts) {
    opts = opts || {};
    const na = ia.length, nb = ib.length;
    if (!na || !nb) return { obs: NaN, p: NaN };
    const sa = ia.reduce((s, v) => s + v, 0), sb = ib.reduce((s, v) => s + v, 0);
    const obs = mabs(sb / nb - sa / na);
    if (obs < EPS) return { obs: 0, p: 1 };
    const rnd = prng(opts.seed || 0x7a3b13), n = opts.n || PERM_N, h = opts.h || PERM_H;
    let p;
    if (paired && na === nb) {
      let m = 0;
      for (let i = 0; i < na; i++) if (ia[i] !== ib[i]) m++;
      p = seqP(n, h, () => { let s = 0; for (let i = 0; i < m; i++) s += rnd() < 0.5 ? 1 : -1; return mabs(s) / na >= obs - EPS; });
    } else {
      const P = new Uint8Array(na + nb);
      for (let i = 0; i < sa + sb; i++) P[i] = 1;
      p = seqP(n, h, () => { shuffle(P, rnd); let s = 0; for (let i = 0; i < na; i++) s += P[i]; return mabs((sa + sb - s) / nb - s / na) >= obs - EPS; });
    }
    return { obs, p };
  }
  // 여러 검정을 함께 볼 때의 홀름 보정: 유의한 검정 표시 (같은 순서의 불리언 배열)
  function holm(ps, alpha) {
    const o = ps.map((p, i) => [p, i]).filter(([p]) => fin(p)).sort((x, y) => x[0] - y[0]);
    const sig = ps.map(() => false);
    for (let j = 0; j < o.length; j++) { if (o[j][0] <= alpha / (o.length - j)) sig[o[j][1]] = true; else break; }
    return sig;
  }
  /* 결말을 하나씩 따로 검정합니다 (이 결말이면 1, 아니면 0). 전체 분포 검정은 결말 하나만 크게 움직인 변화를 놓치기 쉽습니다.
     paired=true면 쌍 안에서 자리를 바꿉니다 (맥네마 검정과 같음). 비율이 다른 결말만 검사하고, 그 안에서 홀름 보정.
     rows[i]에 pO(보정 전 p)와 sigO(보정 뒤에도 뚜렷하고 2%p 이상)를 적습니다. */
  function outcomeTests(rows, la, lb, paired, seed) {
    const ps = [], at = [];
    rows.forEach((o, i) => {
      o.pO = NaN; o.sigO = false;
      if (mabs(o.dp) < EPS) return;
      const ia = la.map((k) => (k === o.key ? 1 : 0)), ib = lb.map((k) => (k === o.key ? 1 : 0));
      o.pO = permRate(ia, ib, paired, { seed: seed + i }).p;
      ps.push(o.pO); at.push(i);
    });
    const hs = holm(ps, 0.05);
    at.forEach((i, j) => { rows[i].sigO = hs[j] && mabs(rows[i].dp) >= 0.02; });
  }
  // 거리 dist(i,j)의 합이 가장 작은 원소 (대표 세계)
  function medoid(idx, dist) {
    let best = -1, bs = Infinity;
    for (const i of idx) {
      let s = 0;
      for (const j of idx) if (i !== j) { const d = dist(i, j); s += fin(d) ? d : 0; }
      if (s < bs) { bs = s; best = i; }
    }
    return best;
  }
  /* 세계 A, B의 표본 k에서의 절대 거리:
     u = log ? log10(max(v,1e-30)) : v,   dAbs = sqrt( mean_m ((uA−uB)/scale_m)² )  (두 값이 모두 유한한 지표만)
     U[m][k]는 미리 변환된 값. */
  function pairDist(UA, UB, k, scales) {
    let s = 0, n = 0;
    for (let m = 0; m < scales.length; m++) {
      const a = UA[m][k], b = UB[m][k];
      if (!fin(a) || !fin(b)) continue;
      const d = (a - b) / scales[m];
      s += d * d; n++;
    }
    return n ? Math.sqrt(s / n) : NaN;
  }

  /* =====================================================================
     6. 분석 + 한국어 판정
     ===================================================================== */
  const pct = (p) => (fin(p) ? Math.round(p * 100) + '%' : '—');
  const pfmt = (p) => (!fin(p) ? '—' : p < 0.001 ? 'p<0.001' : 'p=' + (p < 0.01 ? p.toFixed(3) : p.toFixed(2)));
  const okRes = (rs) => (rs || []).filter((r) => r && !r.error && r.series);

  function prep(E, groups) {
    // 모든 결과를 변환(U)하고 지표별 scale을 정합니다. scale이 없으면 관측 범위의 10%.
    const M = E.metrics.length;
    const all = [].concat(...groups);
    const tfs = E.metrics.map((m) => tfOf(m.log));
    all.forEach((r) => { if (!r._U) r._U = E.metrics.map((m, i) => (r.series[m.key] || []).map(tfs[i])); });
    const scales = E.metrics.map((m, i) => {
      if (fin(m.scale) && m.scale > 0) return m.scale;
      if (m.log) return 0.2;
      let lo = Infinity, hi = -Infinity;
      all.forEach((r) => r._U[i].forEach((u) => { if (fin(u)) { if (u < lo) lo = u; if (u > hi) hi = u; } }));
      const span = hi - lo;
      return fin(span) && span > 0 ? span * 0.1 : 1;
    });
    return { M, scales };
  }
  function outcomeTable(E, lists) {
    // lists: [[outcomeKey...], ...] → 범주 목록(계약 순서, 동적이면 빈도순)과 그룹별 개수
    const counts = lists.map(countBy);
    let keys;
    if (!E.dynamic) {
      keys = E.outcomes.map((o) => o.key);
      counts.forEach((c) => Object.keys(c).forEach((k) => { if (!keys.includes(k)) keys.push(k); }));
    } else {
      const tot = {};
      counts.forEach((c) => Object.entries(c).forEach(([k, v]) => { tot[k] = (tot[k] || 0) + v; }));
      keys = Object.keys(tot).sort((a, b) => tot[b] - tot[a]);
    }
    const rows = keys.map((k, i) => {
      const info = E.outcomeInfo(k, i);
      return { key: k, label: info.label, color: info.color, desc: info.desc || '', n: counts.map((c) => c[k] || 0), p: counts.map((c, g) => (lists[g].length ? (c[k] || 0) / lists[g].length : 0)) };
    });
    return { rows, counts, nCats: E.dynamic ? Math.max(2, keys.length) : Math.max(2, E.outcomes.length) };
  }
  function eventInfo(E, id) {
    const ms = E.milestones.find((m) => m.id === id);
    return { id, name: ms ? ms.name : id, real: ms && fin(ms.real) ? ms.real : null, realLabel: ms ? ms.realLabel : '' };
  }
  const tfX = (E) => (E.axis === 'log' ? (x) => Math.log10(Math.max(x, 1e-300)) : (x) => x);
  // 사건별: 일어난 비율, 시점 분포, 누적 확률 곡선
  function eventStats(E, rs, xs, ids) {
    const x0 = xs[0];
    return (ids || E.eventIds).map((id) => {
      const info = eventInfo(E, id);
      const times = rs.map((r) => (fin(r.reached[id]) ? r.reached[id] : null));
      const hit = times.filter((t) => t !== null);
      const before = rs.filter((r) => (r.pre ? r.pre.includes(id) : fin(r.reached[id]) && r.reached[id] <= x0)).length;
      const cum = xs.map((x) => (rs.length ? times.filter((t) => t !== null && t <= x).length / rs.length : NaN));
      const tf = tfX(E), itf = E.axis === 'log' ? (u) => Math.pow(10, u) : (u) => u;
      const tu = hit.map(tf);
      return Object.assign(info, {
        times, nHit: hit.length, p: rs.length ? hit.length / rs.length : 0, pre: rs.length ? before / rs.length : 0,
        med: hit.length ? itf(median(tu)) : null, q25: hit.length ? itf(quantile(tu, 0.25)) : null, q75: hit.length ? itf(quantile(tu, 0.75)) : null, cum,
      });
    });
  }
  function trajDist(rA, rB, scales, K) {
    let s = 0, n = 0;
    for (let k = 0; k < K; k++) { const d = pairDist(rA._U, rB._U, k, scales); if (fin(d)) { s += d; n++; } }
    return n ? s / n : NaN;
  }
  const lastFinite = (a) => { for (let i = a.length - 1; i >= 0; i--) if (fin(a[i])) return i; return -1; };
  /* 곡선의 의미 있는 꼭짓점 (지그재그): 마지막 꼭짓점에서 max(0.3, mul×값) 이상 되돌아가면 방향이 바뀐 것으로 봅니다.
     pts = [[값, 표본 번호], ...] → [{t:'start'}, {t:'peak'|'trough'}..., {t:'end', dir}] */
  function zigzag(pts, mul) {
    const thr = (v) => Math.max(0.3, mul * Math.abs(v));
    const piv = [{ v: pts[0][0], k: pts[0][1], t: 'start' }];
    let dir = 0, ext = pts[0];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (dir === 0) {
        if (p[0] - piv[0].v >= thr(piv[0].v)) { dir = 1; ext = p; }
        else if (piv[0].v - p[0] >= thr(piv[0].v)) { dir = -1; ext = p; }
      } else if (dir > 0) {
        if (p[0] >= ext[0]) ext = p;
        else if (ext[0] - p[0] >= thr(ext[0])) { piv.push({ v: ext[0], k: ext[1], t: 'peak' }); dir = -1; ext = p; }
      } else if (p[0] <= ext[0]) ext = p;
      else if (p[0] - ext[0] >= thr(ext[0])) { piv.push({ v: ext[0], k: ext[1], t: 'trough' }); dir = 1; ext = p; }
    }
    const L = pts[pts.length - 1];
    piv.push({ v: L[0], k: L[1], t: 'end', dir });
    return piv;
  }
  /* 세계 표본을 복원 추출로 다시 뽑아 퍼짐 곡선의 오르내림이 우연이 아닌지 봅니다.
     pairs: 곡선을 계산한 세계 쌍, valueAt(i, j, k): 표본 k에서 쌍 (i, j)의 거리.
     → above(k1, k2): 재표본 중 k1의 값이 k2의 값보다 큰 비율 (0..1). 필요한 표본만 계산합니다. */
  function curveBoot(N, pairs, valueAt) {
    const B = 80, rnd = prng(0x3779b1d5), W = [];
    for (let b = 0; b < B; b++) { const w = new Uint16Array(N); for (let i = 0; i < N; i++) w[mfloor(rnd() * N)]++; W.push(w); }
    const cache = new Map();
    const medsAt = (k) => {
      if (cache.has(k)) return cache.get(k);
      const rows = [];
      for (const [i, j] of pairs) { const v = valueAt(i, j, k); if (fin(v)) rows.push([v, i, j]); }
      rows.sort((x, y) => x[0] - y[0]);
      const m = new Float64Array(B);
      for (let b = 0; b < B; b++) {
        const w = W[b];
        let tot = 0, c = 0, val = NaN;
        for (const r of rows) tot += w[r[1]] * w[r[2]];
        if (tot) for (const r of rows) { c += w[r[1]] * w[r[2]]; if (c * 2 >= tot) { val = r[0]; break; } }
        m[b] = val;
      }
      cache.set(k, m);
      return m;
    };
    return (k1, k2) => {
      const a = medsAt(k1), b = medsAt(k2);
      let n = 0, gt = 0;
      for (let i = 0; i < B; i++) { if (!fin(a[i]) || !fin(b[i])) continue; n++; if (a[i] > b[i]) gt++; else if (a[i] === b[i]) gt += 0.5; }
      return n ? gt / n : 0.5;
    };
  }
  /* 재표본에서도 방향이 유지되는 구간만 남깁니다: 믿기 어려운 구간 중 가장 작은 것부터 지우고, 꼭짓점이 아니게 된 점을 정리합니다.
     above가 없으면(세계가 너무 적음) 시작과 끝만 남깁니다. → { piv, dropped } */
  function robustPivots(piv, above, CONF) {
    const dirOf = (list) => { const a = list[list.length - 2], b = list[list.length - 1], th = Math.max(0.3, 0.35 * Math.abs(a.v)); return b.v - a.v >= th ? 1 : a.v - b.v >= th ? -1 : 0; };
    const retype = (list) => {
      for (let i = 1; i < list.length - 1;) {
        const d1 = list[i].v - list[i - 1].v, d2 = list[i + 1].v - list[i].v;
        if (d1 * d2 >= 0) { list.splice(i, 1); i = Math.max(1, i - 1); continue; } // 한 방향으로 지나가는 점
        list[i] = Object.assign({}, list[i], { t: d1 > 0 ? 'peak' : 'trough' });
        i++;
      }
      return list;
    };
    const n0 = piv.length;
    let list = piv.slice();
    if (!above) list = [piv[0], piv[n0 - 1]];
    else {
      for (;;) {
        let worst = -1, wa = Infinity;
        for (let i = 0; i + 1 < list.length; i++) {
          const a = list[i], b = list[i + 1];
          const conf = b.v > a.v ? above(b.k, a.k) : above(a.k, b.k);
          if (conf < CONF) { const amp = Math.abs(b.v - a.v); if (amp < wa) { wa = amp; worst = i; } }
        }
        if (worst < 0 || list.length <= 2) break;
        if (worst === 0) list.splice(1, 1);
        else if (worst === list.length - 2) list.splice(list.length - 2, 1);
        else list.splice(worst, 2);
        retype(list);
      }
    }
    const endP = list[list.length - 1];
    if (list.length !== n0) list[list.length - 1] = Object.assign({}, endP, { dir: dirOf(list) });
    return { piv: list, dropped: n0 - list.length };
  }
  // 실제 시간으로 마지막 frac 구간이 시작되는 표본 번호 (표본은 최소 minN개). 로그 축에서 표본 번호로 자르면
  // '끝'이 아주 긴 기간이 되어 그래프 오른쪽 끝과 어긋납니다 (선형 축에서는 표본 번호로 자른 것과 같음).
  function tailStart(xs, frac, minN) {
    const K = xs.length, x1 = xs[K - 1], cut = x1 - frac * (x1 - xs[0]);
    let k = K - 1;
    while (k > 0 && xs[k - 1] >= cut) k--;
    return Math.max(0, Math.min(k, K - minN));
  }
  const fmtShift = (E, d) => {
    if (!fin(d)) return '—';
    if (E.axis === 'log') { const f = Math.pow(10, Math.abs(d)); return (f < 1.005 ? '거의 같음' : `${WS.trimNum(f)}배 ${d > 0 ? '늦게' : '빨리'}`); }
    const a = Math.abs(d);
    return a < 1e-9 ? '거의 같음' : `${WS.fmtYears(a)} ${d > 0 ? '늦게' : '빨리'}`;
  };
  const durFmt = (E, a, b) => `${E.xfmt(a).replace(/^서기\s*/, '')}~${E.xfmt(b).replace(/^서기\s*/, '')}`;

  /* ---------- Q1·Q2: 같은 조건의 여러 세계 ---------- */
  function ensemble(mode, results, ctx) {
    ctx = ctx || {};
    const E = expOf(mode);
    const rs = okRes(results);
    const N = rs.length;
    const out = { kind: 'ensemble', N, failed: (results || []).length - N };
    if (!N) { out.cards = [{ title: '결과 없음', text: '계산을 마친 세계가 없습니다.', tone: 'warn' }]; out.cardsQ2 = out.cards; return out; }
    const xs = rs[0].xs, K = xs.length, x0 = xs[0], x1 = xs[K - 1];
    out.xs = xs; out.x0 = x0; out.x1 = x1;
    const { scales } = prep(E, [rs]);
    out.scales = scales;
    out.metrics = E.metrics.map((m, i) => {
      const f = fan(rs.map((r) => r.series[m.key]), m.log);
      const kk = lastFinite(f.med);
      return { key: m.key, label: m.label, log: !!m.log, color: m.color, fmt: m.fmt, scale: scales[i], fan: f, lastK: kk,
        final: kk >= 0 ? { med: f.med[kk], lo90: f.lo90[kk], hi90: f.hi90[kk], lo50: f.lo50[kk], hi50: f.hi50[kk] } : null };
    });
    // 결말
    const ot = outcomeTable(E, [rs.map((r) => r.outcome)]);
    out.outcomes = ot.rows.map((r) => ({ key: r.key, label: r.label, color: r.color, desc: r.desc, n: r.n[0], p: r.p[0] }));
    out.observed = out.outcomes.filter((o) => o.n > 0).length;
    out.entropy = entropy(ot.counts[0], ot.nCats);
    // Q2 퍼짐: 표본 k에서 세계 쌍 dAbs의 중앙값 (쌍이 많으면 결정적 난수로 400쌍)
    const pairs = [];
    if (N * (N - 1) / 2 <= 400) { for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) pairs.push([i, j]); }
    else { const r = new WS.RNG(0x9e3779b1); while (pairs.length < 400) { const i = Math.floor(r.next() * N), j = Math.floor(r.next() * N); if (i !== j) pairs.push([i, j]); } }
    out.dispersion = xs.map((_, k) => median(pairs.map(([i, j]) => pairDist(rs[i]._U, rs[j]._U, k, scales))));
    // 사건 (설정에 맞는 목록)
    out.events = eventStats(E, rs, xs, E.eventIdsOf(ctx.opts));
    // 대표 세계: 가장 흔한 결말 안에서 궤적 거리 합이 가장 작은 세계 / 가장 드문 결말에서 가장 동떨어진 세계
    const D = new Map();
    const dist = (i, j) => { const key = i < j ? i * 100000 + j : j * 100000 + i; if (!D.has(key)) D.set(key, trajDist(rs[i], rs[j], scales, K)); return D.get(key); };
    const top = out.outcomes.filter((o) => o.n > 0).sort((a, b) => b.n - a.n);
    const topIdx = rs.map((r, i) => i).filter((i) => rs[i].outcome === top[0].key);
    out.medoid = medoid(topIdx, dist);
    const rareKey = top[top.length - 1].key;
    const all = rs.map((_, i) => i);
    let rareIdx = top.length > 1 ? all.filter((i) => rs[i].outcome === rareKey) : all.filter((i) => i !== out.medoid);
    let far = -1, fd = -1;
    rareIdx.forEach((i) => { let s = 0; all.forEach((j) => { if (j !== i) { const d = dist(i, j); s += fin(d) ? d : 0; } }); if (s > fd) { fd = s; far = i; } });
    out.rare = far >= 0 ? far : out.medoid;
    out.rareIsOutcome = top.length > 1;
    out.worlds = rs.map((r, i) => ({ i, seed: r.seed, outcome: r.outcome, reached: r.reached, ended: r.ended, early: r.early, endX: r.endX }));
    out.results = rs;
    const above = N >= 5 ? curveBoot(N, pairs, (i, j, k) => pairDist(rs[i]._U, rs[j]._U, k, scales)) : null;
    Object.assign(out, verdictEnsemble(E, out, ctx, above));
    const settle = settleStats(rs);
    if (settle) out.settle = settle;
    return out;
  }

  /* 사람들은 어디로 갔나: 세계마다 모드가 준 요약 r.extra = { first, list: [{ id, name, pop, since, lost }], star, homeEmpty }를 모읍니다.
     leavers = 사람들이 고향 행성을 떠난 세계 수. reached = 그 천체에 정착지가 생긴 적 있는 세계 수 (뒤에 사라졌어도 포함, 사라진 수는 lost에 따로)
     share = reached / 모든 세계, firstShare = 그곳이 첫 정착지였던 세계 / 떠난 세계
     medianSince, medianPop = 그곳에 정착지가 생긴 세계들의 중앙값 (사라진 곳의 마지막 인구는 0명). 요약이 있는 결과가 없으면 null */
  function settleStats(rs) {
    const all = rs.map((r) => r.extra).filter((x) => x && Array.isArray(x.list));
    if (!all.length) return null;
    const gone = (d) => d.lost !== false && d.lost != null;
    const by = new Map(), stars = new Map();
    let leavers = 0, homeEmpty = 0, allLost = 0;
    for (const x of all) {
      if (x.homeEmpty) homeEmpty++;
      if (x.star && x.star.target) stars.set(x.star.target, (stars.get(x.star.target) || 0) + 1);
      if (!x.list.length && !x.star) continue;
      leavers++;
      if (!x.list.length) continue;
      if (x.list.every(gone)) allLost++;
      const fid = x.first && x.first.id ? x.first.id : x.first;
      const first = x.list.find((d) => d.id === fid || d.name === fid) || x.list.reduce((b, d) => (d.since < b.since ? d : b));
      for (const d of x.list) {
        if (!by.has(d.id)) by.set(d.id, { id: d.id, name: d.name, reached: 0, lost: 0, firstN: 0, since: [], pop: [] });
        const o = by.get(d.id);
        o.reached++;
        if (gone(d)) o.lost++;
        if (d === first) o.firstN++;
        o.since.push(d.since);
        o.pop.push(gone(d) ? 0 : d.pop);
      }
    }
    const N = rs.length;
    const dest = [...by.values()].map((o) => ({
      id: o.id, name: o.name, reached: o.reached, share: o.reached / N, medianSince: median(o.since), medianPop: median(o.pop),
      firstShare: leavers ? o.firstN / leavers : 0, lost: o.lost,
    })).sort((p, q) => q.reached - p.reached || q.firstShare - p.firstShare || p.medianSince - q.medianSince);
    const star = [...stars].map(([target, n]) => ({ target, n })).sort((p, q) => q.n - p.n);
    return { leavers, N, dest, homeEmpty, allLost, star };
  }

  // 세계 n개(또는 쌍 n개)로 대략 알아볼 수 있는 결말 비율 차이, %p (두 비율 비교, 검정력 80%, 비율 50% 가정, 5 단위)
  const detectable = (n) => Math.min(100, Math.max(5, Math.round((280 * Math.sqrt(0.5 / Math.max(1, n))) / 5) * 5));
  // n번 모두 일어나지 않았을 때, 95% 신뢰로 배제할 수 없는 확률의 상한
  const missRate = (n) => 1 - Math.pow(0.05, 1 / Math.max(1, n));
  const shortLabel = (s) => String(s).replace(/\s*\(.*\)\s*$/, '');
  const listCap = (names, cap) => names.slice(0, cap).join(', ') + (names.length > cap ? ` 외 ${names.length - cap}개` : '');

  function verdictEnsemble(E, a, ctx, above) {
    const N = a.N, xl = E.xfmt(a.x1).replace(/^서기\s*/, ''), xl0 = E.xfmt(a.x0).replace(/^서기\s*/, '');
    const top = a.outcomes.filter((o) => o.n > 0).sort((p, q) => q.n - p.n);
    const t0 = top[0], t1 = top[1];
    const cards = [], cards2 = [];
    // 결말
    let oc = t0.n === N ? `${N}개 세계 모두 「${t0.label}」에 이르렀습니다.` : `${N}개 세계 중 ${t0.n}개(${pct(t0.p)})가 「${t0.label}」에 이르렀습니다.`;
    if (t1) oc += t1.n === t0.n ? ` 「${t1.label}」도 ${t1.n}개(${pct(t1.p)})로 똑같이 많았습니다.` : ` 그다음은 「${t1.label}」(${pct(t1.p)})입니다.`;
    cards.push({ title: '가장 흔한 미래', text: oc, tone: 'main', color: t0.color });
    // 핵심 지표: 첫 지표, 단 세계마다 거의 같으면 가장 많이 갈린 지표 (값이 있는 세계가 2개 이상인 지표 우선)
    const spread = (m) => { if (!m.final) return -1; const tf = tfOf(m.log); return (tf(m.final.hi90) - tf(m.final.lo90)) / m.scale; };
    const nOf = (m) => (m.final ? m.fan.n[m.lastK] || 0 : 0);
    const cand = a.metrics.filter((m) => nOf(m) >= 2);
    let m0 = cand[0] || a.metrics.find((m) => m.final);
    if (m0 && cand.length && spread(m0) < 0.5) { const alt = cand.slice().sort((p, q) => spread(q) - spread(p))[0]; if (alt && spread(alt) >= 0.5) m0 = alt; }
    if (m0) {
      const f = m0.final, nn = nOf(m0);
      let txt;
      if (nn < 2) txt = `값이 있는 세계가 ${nn}개뿐이라 세계끼리 비교할 수 없습니다${nn ? ` (그 세계: ${m0.fmt(f.med)})` : ''}.`;
      else {
        const who = nn < N ? `값이 있는 ${nn}개 세계` : '모든 세계';
        txt = spread(m0) < 0.3 ? `${who}에서 거의 같았습니다 (중앙값 ${m0.fmt(f.med)}).`
          : `중앙값 ${m0.fmt(f.med)}. ${nn < 10 ? `${nn < N ? `값이 있는 ${nn}개 세계는` : '세계들은'} 대체로` : nn < N ? `값이 있는 ${nn}개 세계의 90%가` : '세계 10개 중 9개가'} ${m0.fmt(f.lo90)} ~ ${m0.fmt(f.hi90)} 사이에 있었습니다.`;
        if (nn < N) txt += ` 나머지 ${N - nn}개 세계는 이 값이 없었습니다(아직 시작되지 않았거나 끝남).`;
      }
      cards.push({ title: `${xl}의 ${m0.label}`, text: txt, tone: 'info', color: m0.color });
    }
    // 사건 확률 (시작 전에 이미 일어난 사건 제외). 세계마다 갈린 사건을 앞세우고, 거의 늘 일어난 일과 한 번도 없었던 일은 따로 묶습니다
    const evs = a.events.filter((e) => e.pre < 0.5).sort((p, q) => q.p - p.p);
    if (evs.length) {
      const sure = evs.filter((e) => e.p >= 0.95), split = evs.filter((e) => e.p > 0 && e.p < 0.95), none = evs.filter((e) => e.p === 0);
      const parts = [];
      if (split.length) parts.push(split.slice(0, 5).map((e) => `${e.name} ${pct(e.p)}`).join(' · ') + (split.length > 5 ? ` 외 ${split.length - 5}개` : '') + '.');
      if (sure.length) parts.push(`${sure.every((e) => e.p >= 0.999) ? '모든 세계에서' : '거의 모든 세계에서'} 일어남: ${listCap(sure.map((e) => e.name), 4)}.`);
      if (none.length) parts.push(`${N}개 세계에서 한 번도 없었던 일: ${listCap(none.map((e) => e.name), 3)}.`);
      cards.push({ title: `${xl}까지 일어난 일`, text: parts.join(' '), tone: 'info' });
    }
    // 정해진 미래인가?
    const missPct = pct(missRate(N));
    let fate;
    if (top.length === 1) {
      fate = N >= 100 ? `${N}개 세계 모두 같은 결말에 이르렀습니다. 이 조건에서 큰 결말은 거의 정해져 있는 것으로 보입니다. ${missPct}보다 드문 결말은 있을 수 있습니다.`
        : `${N}개 세계 모두 같은 결말에 이르렀습니다. 한쪽으로 강하게 쏠리는 것으로 보이지만, ‘정해져 있다’고 하기엔 이릅니다. 세계가 ${N}개뿐이면 약 ${missPct}까지 되는 결말도 안 나올 수 있습니다.`;
    } else {
      if (t0.p >= 0.8) fate = `결말은 ${top.length}가지로 갈렸지만 대부분 한 방향으로 모였습니다. 큰 흐름은 꽤 정해져 있고, 일부만 갈립니다.`;
      else if (t0.p >= 0.5) fate = `결말이 ${top.length}가지로 갈렸습니다. 한 결말이 우세하지만 미래가 하나로 정해져 있지는 않습니다.`;
      else fate = `결말이 ${top.length}가지로 넓게 갈렸습니다. 같은 출발점에서도 미래는 우연에 크게 좌우됩니다.`;
      if (N < 20) fate += ` 세계가 ${N}개뿐이라 비율은 실험마다 꽤 달라질 수 있습니다.`;
    }
    cards.push({ title: '미래는 정해져 있을까?', text: fate + ' (단순화한 모형의 결과입니다)', tone: 'soft' });

    // Q2: 수렴/발산 — 퍼짐 곡선을 '의미 있는 오르내림'의 꼭짓점(지그재그)으로 나눠, 모양 그대로 이야기합니다
    const d = a.dispersion;
    const fk = d.map((v, i) => [v, i]).filter(([v]) => fin(v));
    let q2End = NaN, q2Peak = 0;
    if (fk.length >= 2) {
      const peak = fk.reduce((m, x) => (x[0] > m[0] ? x : m), fk[0]);
      const last = fk[fk.length - 1];
      const late = fk[Math.floor((fk.length - 1) * 0.75)];
      // '무렵'에 붙는 시점은 표본 시각을 그대로 쓰지 않고 구간 폭에 맞춰 둥글게 (기원전 5991년 → 기원전 6000년)
      const stepX = E.axis === 'log' ? 0 : Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, Math.abs(a.x1 - a.x0) / 50))));
      const at = (i) => { let x = a.xs[i]; if (stepX && fin(x)) x = Math.round(x / stepX) * stepX; return E.xfmt(x).replace(/^서기\s*/, ''); };
      const lv = (v) => (v < 0.3 ? '거의 같음' : v < 1 ? '조금 다름' : v < 2.5 ? '뚜렷하게 다름' : '아주 다름');
      const f1 = (v) => v.toFixed(v < 10 ? 1 : 0);
      const start = fk.find(([v]) => v >= 0.3);
      // '끝에서도 커지는 중'과 꼭짓점은 세계를 다시 뽑아도 유지될 때만 말합니다 (세계가 적으면 곡선의 오르내림은 대부분 우연)
      const CONF = N < 40 ? 0.95 : 0.9;
      const growing = last[0] >= 1.25 * Math.max(0.05, late[0]) && !!above && above(last[1], late[1]) >= CONF;
      let piv0 = zigzag(fk, 0.35);
      for (const mul of [0.5, 0.7]) if (piv0.length > 5) piv0 = zigzag(fk, mul);
      const rb = robustPivots(piv0, above, CONF);
      const piv = rb.piv;
      const inner = piv.slice(1, -1), endP = piv[piv.length - 1];
      const tk0 = tailStart(a.xs, 0.2, 3), tailPts = fk.filter(([, k]) => k >= tk0), tailV = median((tailPts.length >= 3 ? tailPts : fk.slice(-3)).map(([v]) => v));
      let txt, title;
      if (peak[0] < 0.3) { title = '수렴: 거의 같은 길'; txt = `${N}개 세계가 처음부터 끝까지 거의 같은 상태를 지났습니다(최대 차이 ${peak[0].toFixed(2)}). 우연이 큰 차이를 만들지 못했습니다.`; }
      else if (piv.length > 5) {
        // 오르내림이 너무 잦으면 꼭짓점을 다 늘어놓지 않고 요약
        const pks = inner.filter((p) => p.t === 'peak'), trs = inner.filter((p) => p.t === 'trough');
        const hiP = pks.reduce((m, p) => (p.v > m.v ? p : m), pks[0]), loT = trs.reduce((m, p) => (p.v < m.v ? p : m), trs[0]);
        title = '갈라졌다 모였다를 되풀이함';
        const endTop = last[0] >= hiP.v;
        txt = `세계들 사이의 차이가 ${pks.length}번 크게 오르내렸습니다. ${endTop ? '' : `가장 크게 갈라진 때는 ${at(hiP.k)} 무렵(${f1(hiP.v)}), `}가장 가까웠던 때는 ${at(loT.k)} 무렵(${f1(loT.v)})이고, ${endTop ? `차이는 끝에서 가장 커서 ${xl}에는` : `${xl}에는`} '${lv(last[0])}' 수준(${f1(last[0])})입니다.`;
      } else if (!inner.length && endP.dir < 0) {
        title = '처음엔 달랐다가 점점 모임';
        txt = `처음에는 세계들이 '${lv(piv[0].v)}' 수준(${f1(piv[0].v)})으로 달랐지만, 갈수록 가까워져 ${xl}에는 ${f1(last[0])}이 되었습니다.`;
      } else if (!inner.length) {
        if (growing) { title = '발산: 갈수록 달라짐'; txt = `${start ? at(start[1]) + ' 무렵부터 ' : ''}세계들이 갈라지기 시작해 끝까지 계속 멀어졌습니다. ${xl}에는 '${lv(last[0])}' 수준(${f1(last[0])})이고 아직 커지는 중입니다.`; }
        else {
          // 끝 한 점 대신 마지막 구간의 중앙값으로 수준을 말합니다 (끝 값 하나는 흔들림이 큼)
          // '더 커지지 않음'의 시점: 그 뒤의 곡선이 이 값보다 10% 넘게 오르지 않는 첫 표본
          const sat = fk.find(([v], i) => v >= 0.8 * tailV && fk.slice(i + 1).every(([w]) => w <= 1.1 * v));
          title = '어느 정도 갈라진 뒤 유지';
          const sudden = start && sat && sat[1] - start[1] <= 1;
          const stay = rb.dropped > 0 ? '큰 흐름으로는 차이가 더 벌어지지 않고' : '차이가 더 커지지 않고';
          // 꼭짓점이 끝 수준보다 눈에 띄게 높았으면 '머물렀다' 대신 오른 뒤 줄어든 모양을 그대로 말합니다
          const fell = peak[0] >= 1.25 * Math.max(0.05, tailV);
          // 꼭짓점의 60% 아래로 내려왔으면 '조금 줄어 안정'이 아니라 다시 가까워진 것입니다
          const fellFar = tailV < 0.6 * peak[0];
          if (fellFar) title = '갈라졌다가 다시 가까워짐';
          txt = fell ? `${start && start[1] < peak[1] ? `${at(start[1])} 무렵부터 세계들이 갈라져 ` : '세계들은 '}${at(peak[1])} 무렵 가장 크게 달랐고(${f1(peak[0])}), 그 뒤로는 차이가 ${fellFar ? `크게 줄어 '${lv(tailV)}' 수준(${f1(tailV)})까지 내려왔습니다. 세계들이 다시 가까워진 셈입니다.` : `조금 줄어 '${lv(tailV)}' 수준(${f1(tailV)})에 머물렀습니다. 서로 다른 상태로 흩어진 채 안정된 셈입니다.`}`
            : sudden ? `${at(start[1])} 무렵 세계들이 한꺼번에 갈라졌고, 그 뒤로는 ${stay} '${lv(tailV)}' 수준(${f1(tailV)})에 머물렀습니다. 서로 다른 상태로 흩어진 채 안정된 셈입니다.`
            : `${start ? at(start[1]) + ' 무렵부터 ' : ''}세계들이 갈라졌고, ${sat ? at(sat[1]) + ' 무렵부터는 ' : ''}${stay} '${lv(tailV)}' 수준(${f1(tailV)})에 머물렀습니다. 서로 다른 상태로 흩어진 채 안정된 셈입니다.`;
        }
      } else if (inner.length === 1 && inner[0].t === 'peak') {
        const pk = inner[0];
        if (last[0] < 0.5) { title = '갈라졌다가 다시 모임'; txt = `${at(pk.k)} 무렵 세계들이 가장 크게 갈라졌다가(${f1(pk.v)}), ${xl}에는 거의 같은 상태로 다시 모였습니다(${f1(last[0])}). 우연이 만든 차이가 시간이 지나며 지워졌습니다.`; }
        else { title = '갈라졌다가 조금씩 다시 모이는 중'; txt = `${at(pk.k)} 무렵 세계들이 가장 크게 갈라졌고(${f1(pk.v)}), 그 뒤로는 차이가 줄어 ${xl}에는 ${f1(last[0])}까지 내려왔습니다. 아직 '${lv(last[0])}' 수준이지만 세계들이 서로 가까워지는 중입니다.`; }
      } else {
        // 여러 단계: 꼭짓점을 차례로
        const parts = [];
        if (piv[0].v >= 0.3) parts.push(`처음에는 '${lv(piv[0].v)}' 수준(${f1(piv[0].v)})이었고`);
        inner.forEach((p, j) => parts.push(p.t === 'peak' ? `${at(p.k)} 무렵 ${j ? '다시 ' : ''}${p.v >= 1 ? '크게 ' : ''}갈라졌다가(${f1(p.v)})` : `${at(p.k)} 무렵 ${j ? '다시 ' : ''}가까워졌고(${f1(p.v)})`));
        const lastT = inner[inner.length - 1].t;
        const tail = lastT === 'trough'
          ? `그 뒤 다시 갈라져 ${xl}에는 '${lv(last[0])}' 수준(${f1(last[0])})이 되었습니다${growing ? '. 끝에서도 아직 커지는 중입니다' : ''}.`
          : `그 뒤 다시 모여 ${xl}에는 ${f1(last[0])}까지 내려왔습니다.`;
        txt = parts.join(', ') + ', ' + tail;
        title = lastT === 'trough' ? (inner.length === 2 && inner[0].t === 'peak' ? '갈라졌다 모였다 다시 갈라짐' : '모였다 흩어졌다를 되풀이함') : '여러 번 갈라졌다 다시 모임';
      }
      const noise = N < 40 ? ` 세계가 ${N}개뿐이라 곡선의 작은 오르내림은 우연일 수 있어${rb.dropped > 0 ? ' 큰 모양만 적었습니다' : ' 믿을 만한 모양만 적었습니다'}. 세계 수를 늘리면 더 분명해집니다.`
        : rb.dropped > 0 ? ' 세계를 다시 뽑으면 사라지는 작은 오르내림은 뺐습니다.' : '';
      cards2.push({ title, text: txt + noise, tone: 'info', detail: '차이 1 = 의미 있게 다른 정도. 그래프는 ‘세계들은 모일까, 흩어질까?’에 있습니다.' });
      q2End = growing ? last[0] : tailV; q2Peak = peak[0];
    }
    // Q2의 답: 질문('다시 돌려도 같은 역사가 될까?')에 한 문장으로. 세부 역사의 차이와 결말의 쏠림을 함께 봅니다
    {
      const v = q2End, one = top.length === 1, most = one || t0.p >= 0.8;
      const hist = !fin(v) ? '' : v < 0.3 ? (q2Peak >= 0.3 ? '세계들이 한때 갈라졌다가 끝에는 거의 같은 상태로 모였고, ' : '세계들이 거의 같은 길을 지났고, ')
        : v < 1 ? '역사가 조금씩 달라지고, ' : v < 2.5 ? '역사가 뚜렷하게 달라지고, ' : '역사가 아주 다르게 펼쳐지고, ';
      const endW = one ? `결말은 이번 ${N}개 모두 「${t0.label}」 쪽이었습니다`
        : t0.p >= 0.8 ? `결말은 대부분 「${t0.label}」 쪽으로 모였습니다(${pct(t0.p)})`
        : t0.p >= 0.5 ? `결말은 ${top.length}가지로 갈리는데 「${t0.label}」 결말이 ${pct(t0.p)}로 가장 많았습니다`
        : `결말도 ${top.length}가지로 넓게 갈리는데 가장 많은 「${t0.label}」 결말도 ${pct(t0.p)}에 그쳤습니다`;
      const same = fin(v) && v < 0.3;
      const atitle = same ? (most ? (one && N < 20 ? '답: 이번에는 거의 같은 역사가 되었습니다' : '답: 네, 거의 같은 역사가 됩니다') : '답: 길은 비슷해도 결말은 갈립니다')
        : most ? (fin(v) && v >= 1 ? '답: 역사는 달라도 결말은 모입니다' : '답: 똑같지는 않지만 비슷한 곳으로 모입니다')
        : t0.p >= 0.5 ? (fin(v) && v >= 1 ? '답: 같은 역사가 되지 않고 결말도 갈립니다' : '답: 똑같이 되풀이되지는 않고 결말도 갈립니다')
        : '답: 아니요, 결말까지 넓게 갈립니다';
      const smallN = N < 20 ? ` 세계가 ${N}개뿐이라 실험마다 달라질 수 있습니다.` : '';
      cards2.unshift({ title: atitle, text: `같은 출발점에서 ${N}번 다시 돌리면 ${hist}${endW}.${smallN}`, tone: 'main', color: t0.color, detail: fin(v) ? `끝 무렵 세계 사이 차이 ${v.toFixed(v < 10 ? 1 : 0)} (0 = 같음, 1 = 의미 있게 다름)` : null });
    }
    // 결말 다양성
    let et, ed = null;
    if (top.length === 1) et = N >= 100 ? `${N}개 세계가 모두 「${t0.label}」 결말에 이르렀습니다. 결말이 하나로 모였습니다.`
      : `${N}개 세계가 모두 「${t0.label}」 결말에 이르렀습니다. 이번에는 결말이 하나로 모였지만, 세계가 ${N}개뿐이면 약 ${missPct}까지 되는 결말도 안 나올 수 있습니다.`;
    else {
      et = `결말이 ${top.length}가지로 나뉘었습니다. 가장 흔한 결말은 「${t0.label}」 ${pct(t0.p)}입니다.`;
      if (N < 20) et += ` 세계가 ${N}개뿐이라 비율은 실험마다 꽤 달라질 수 있습니다.`;
      ed = `결말 다양성 ${a.entropy.toFixed(2)} (0 = 모두 같음, 1 = 고르게 흩어짐)`;
    }
    cards2.push({ title: '결말은 얼마나 모일까?', text: et, tone: 'info', color: t0.color, detail: ed });
    // 사건 시점의 폭
    const happened = a.events.filter((e) => e.pre < 0.5 && e.p > 0);
    if (happened.length) {
      const always = happened.filter((e) => e.p >= 0.999);
      let tt = '', e;
      if (always.length) {
        // 가장 시점이 들쭉날쭉한 '항상 일어난' 사건
        const tf = tfX(E), w = (q) => tf(q.q75) - tf(q.q25);
        e = always.slice().sort((p, q) => w(q) - w(p))[0];
        const tight = w(e) <= 0.01 * Math.abs(tf(a.x1) - tf(a.x0));
        tt = tight ? `「${e.name}」 사건은 모든 세계에서 거의 같은 시점(${E.xfmt(e.med).replace(/^서기\s*/, '')})에 일어났습니다.`
          : `「${e.name}」 사건은 모든 세계에서 일어났지만 시점은 달랐습니다. 가운데 절반의 세계가 ${durFmt(E, e.q25, e.q75)} 사이에 겪었습니다.`;
      } else {
        e = happened.slice().sort((p, q) => q.p - p.p)[0];
        tt = `「${e.name}」 사건은 ${pct(e.p)}의 세계에서 일어났습니다(${e.nHit === 1 ? '그 세계에서는 ' : '중앙값 '}${E.xfmt(e.med).replace(/^서기\s*/, '')}).`;
      }
      // 대비할 드문 사건: 위 사건과 다르고, 그보다 뚜렷하게 드문 것
      const rare = happened.filter((q) => q !== e && q.p < 0.5 && q.p < e.p - 0.1).sort((p, q) => p.p - q.p);
      if (rare.length) tt += ` 반면 「${rare[0].name}」 사건은 ${pct(rare[0].p)}의 세계에서만 일어났습니다.`;
      cards2.push({ title: '같은 사건, 다른 시점', text: tt, tone: 'soft' });
    }
    if (a.failed > 0) { const w = { title: '일부 세계 실패', text: `${a.failed}개 세계는 계산 중 오류가 나서 빠졌습니다.`, tone: 'warn' }; cards.push(w); cards2.push(w); }
    return { cards, cardsQ2: cards2, span: `${xl0} → ${xl}` };
  }

  /* ---------- Q3: 쌍둥이 세계 (한쪽에만 개입) ----------
     ctx: { at, ivName, reroll: 개입 뒤 우연도 바뀜(나비 효과), coupled: 모드의 우연이 상태에 섞여 늘 바뀜, opts } */
  const APART = 0.15; // 끝 갈라짐이 이 값 이상이면 '눈에 띄게 다른 쌍'으로 셉니다 (아래 '차이가 작음' 기준과 같음)
  function intervention(mode, pairResults, ctx) {
    ctx = ctx || {};
    const E = expOf(mode);
    const all = (pairResults || []).filter((p) => p && !p.error && p.base && p.alt && p.base.series && p.alt.series);
    const coupled = !!(ctx.coupled || E.chanceCoupled);
    const out = { kind: 'intervention', N: all.length, total: all.length, failed: (pairResults || []).length - all.length, at: ctx.at, coupled, reroll: !!ctx.reroll || coupled };
    if (!all.length) { out.cards = [{ title: '결과 없음', text: '계산을 마친 쌍이 없습니다.', tone: 'warn' }]; return out; }
    // 개입이 실제로 적용된 쌍만 비교 (적용되지 않은 쌍은 둘이 똑같아서 효과를 흐리게 만듦)
    const hit = all.filter((p) => p.alt.ivMsgs && p.alt.ivMsgs.length);
    out.applied = hit.length;
    if (!hit.length) {
      out.cards = [{ title: '개입이 적용되지 않았습니다', text: `${all.length}쌍 모두 개입(${ctx.ivName || '개입'})을 적용할 수 없었습니다. 그 시점에는 이 개입이 가능하지 않거나 고른 곳에 대상이 없었습니다. 시점이나 장소를 바꿔 다시 해 보세요.`, tone: 'warn' }];
      return out;
    }
    const ps = hit;
    const N = ps.length;
    out.N = N; out.skipped = all.length - N;
    const allBase = all.map((p) => p.base);
    const base = ps.map((p) => p.base), alt = ps.map((p) => p.alt);
    const xs = base[0].xs, K = xs.length;
    out.xs = xs; out.x0 = xs[0]; out.x1 = xs[K - 1];
    const { scales } = prep(E, [allBase, alt]);
    out.scales = scales;
    /* 갈라짐 비율 D(k) = median_i dAbs(base_i, alt_i, k) / median_i dAbs(base_i, base_{i+1}, k)
       0 = 쌍둥이가 같음(개입의 흔적 없음), ≈1 = 서로 무관한 두 세계만큼 다름 (분모는 모든 원래 세계로 계산) */
    const NB = allBase.length;
    out.num = xs.map((_, k) => median(ps.map((p) => pairDist(p.base._U, p.alt._U, k, scales))));
    out.den = xs.map((_, k) => (NB < 2 ? NaN : median(allBase.map((b, i) => pairDist(b._U, allBase[(i + 1) % NB]._U, k, scales)))));
    out.D = xs.map((_, k) => { const a = out.num[k], b = out.den[k]; return fin(a) && fin(b) && b > 1e-9 ? a / b : fin(a) && a < 1e-12 && fin(b) ? 0 : NaN; });
    out.simCurve = ps[0].sim ? xs.map((_, k) => median(ps.map((p) => (p.sim ? p.sim[k] : NaN)))) : null;
    // 결말 (쌍 안에서 자리 바꾸기 순열 검정)
    const ob = base.map((r) => r.outcome), oa = alt.map((r) => r.outcome);
    const ot = outcomeTable(E, [ob, oa]);
    out.outcomes = ot.rows.map((r) => ({ key: r.key, label: r.label, color: r.color, desc: r.desc, nA: r.n[0], nB: r.n[1], pA: r.p[0], pB: r.p[1], dp: r.p[1] - r.p[0] }));
    const tv = permTVD(ob, oa, { paired: true, seed: 0x51ed270b });
    out.tvd = tv.obs; out.p = tv.p;
    outcomeTests(out.outcomes, ob, oa, true, 0x2f1c7a55);
    out.sameOutcome = ps.filter((p) => p.base.outcome === p.alt.outcome).length;
    // 서로 무관한 두 세계라면 결말이 달랐을 확률 (원래 세계들의 결말 분포로 추정)
    const nb = allBase.length, cb = countBy(allBase.map((r) => r.outcome));
    out.unrelDiff = nb >= 2 ? Math.max(0, (1 - Object.values(cb).reduce((s, c) => s + (c / nb) * (c / nb), 0)) * (nb / (nb - 1))) : NaN;
    // 사건 시점 변화
    out.events = milestoneShift(E, base, alt, true, E.eventIdsOf(ctx.opts));
    // 지표: 둘 다 값이 있는 마지막 표본에서 중앙값, 쌍별 차이(변환 단위 / scale)의 중앙값과 부호 뒤집기 검정
    out.metrics = E.metrics.map((m, i) => {
      const fA = fan(base.map((r) => r.series[m.key]), m.log), fB = fan(alt.map((r) => r.series[m.key]), m.log);
      const kk = Math.min(lastFinite(fA.med), lastFinite(fB.med));
      let eff = NaN, p = NaN, dir = 0;
      if (kk >= 0) {
        const dd = [];
        for (let j = 0; j < N; j++) { const u = alt[j]._U[i][kk], v = base[j]._U[i][kk]; if (fin(u) && fin(v)) dd.push(u - v); }
        if (dd.length >= 2) { const t = permSignMed(dd, { seed: 0x1f83d9ab + i }); eff = median(dd) / scales[i]; p = t.p; dir = t.dir; }
      }
      const tfm = tfOf(m.log);
      return { key: m.key, label: m.label, log: !!m.log, color: m.color, fmt: m.fmt, fanA: fA, fanB: fB, k: kk,
        medA: kk >= 0 ? fA.med[kk] : NaN, medB: kk >= 0 ? fB.med[kk] : NaN, eff, p, dir,
        gap: kk >= 0 ? Math.abs(tfm(fB.med[kk]) - tfm(fA.med[kk])) / scales[i] : NaN }; // 표에 보이는 두 중앙값의 간격 (의미 있는 차이 단위)
    });
    // '큰 흐름'은 결말 + 지표 여러 검정을 함께 보므로 홀름 보정, 지표는 의미 있는 크기(scale의 1/4 이상)도 요구
    const sig = holm([out.p].concat(out.metrics.map((m) => m.p)), 0.05);
    out.outcomeSig = sig[0] && out.tvd >= 0.05;
    out.metrics.forEach((m, i) => { m.sig = sig[i + 1] && Math.abs(m.eff) >= 0.25 && m.dir * m.eff > 0; }); // 순위와 중앙값이 같은 방향일 때만
    // 쌍마다 끝 시점 차이: 원래 거리(d)와, 위 '갈라짐'과 같은 눈금(무관한 두 세계의 차이 = 1)으로 나눈 값(dn)
    const kEnd = lastFinite(out.num) >= 0 ? lastFinite(out.num) : K - 1, denEnd = out.den && fin(out.den[kEnd]) && out.den[kEnd] > 0 ? out.den[kEnd] : NaN;
    out.pairs = ps.map((p, i) => { const d = pairDist(p.base._U, p.alt._U, kEnd, scales); return { i, seed: p.seed, base: p.base.outcome, alt: p.alt.outcome, ivMsgs: p.alt.ivMsgs || [], d, dn: fin(d) && fin(denEnd) ? d / denEnd : NaN }; });
    // 쌍별로 센 값: 중앙값 하나로는 '대부분 같고 일부만 크게 다름'을 놓칩니다
    out.nApart = out.pairs.filter((q) => fin(q.dn) && q.dn >= APART).length; // 끝에서도 눈에 띄게 다른 쌍
    out.nDetail = ps.filter((p, i) => { // 끝에서 세부까지 똑같지는 않은 쌍
      const q = out.pairs[i], ks = p.sim ? lastFinite(p.sim) : -1;
      return p.base.outcome !== p.alt.outcome || (fin(q.d) && q.d > 1e-9) || (ks >= 0 && p.sim[ks] < 1 - 1e-9);
    }).length;
    out.results = ps;
    Object.assign(out, verdictIntervention(E, out, ctx));
    return out;
  }
  function milestoneShift(E, A, B, paired, ids) {
    const tf = tfX(E), itf = E.axis === 'log' ? (u) => Math.pow(10, u) : (u) => u;
    const x0 = A[0].xs[0];
    const rows = (ids || E.eventIds).map((id, ei) => {
      const info = eventInfo(E, id);
      const ta = A.map((r) => (fin(r.reached[id]) ? tf(r.reached[id]) : null));
      const tb = B.map((r) => (fin(r.reached[id]) ? tf(r.reached[id]) : null));
      const ha = ta.filter((t) => t !== null), hb = tb.filter((t) => t !== null);
      const pre = A.filter((r) => (r.pre ? r.pre.includes(id) : fin(r.reached[id]) && r.reached[id] <= x0)).length / Math.max(1, A.length);
      const row = Object.assign(info, { pA: ha.length / Math.max(1, A.length), pB: hb.length / Math.max(1, B.length), medA: ha.length ? itf(median(ha)) : null, medB: hb.length ? itf(median(hb)) : null, shift: NaN, p: NaN, pP: 1, pre });
      if (ha.length || hb.length) { // 어느 세계도 겪지 않은 사건은 검정하지 않음
        if (paired) {
          // 쌍별 시점 차이의 부호를 무작위로 뒤집는 순열 검정 (부호 있는 순위)
          const d = [];
          ta.forEach((t, i) => { if (t !== null && tb[i] !== null) d.push(tb[i] - t); });
          // 시점 변화는 짝이 2쌍 이상일 때만 말함 (1쌍짜리 차이는 우연과 구별할 길이 없음)
          if (d.length >= 2) { const t = permSignMed(d, { seed: 0x7a3b11 + ei }); row.shift = median(d); row.p = t.p; row.dirT = t.dir; }
        } else if (ha.length >= 2 && hb.length >= 2) {
          const t = permMedDiff(ha, hb, { seed: 0x7a3b12 + ei });
          row.shift = median(hb) - median(ha);
          row.p = t.p; row.dirT = t.dir;
        }
        // 일어난 비율 차이 검정
        if (row.pA !== row.pB) {
          const ia = A.map((r) => (fin(r.reached[id]) ? 1 : 0)), ib = B.map((r) => (fin(r.reached[id]) ? 1 : 0));
          row.pP = permRate(ia, ib, paired, { seed: 0x7a3b13 + ei }).p;
        }
      }
      row.shiftText = fmtShift(E, row.shift);
      return row;
    });
    // 사건 여러 개를 한꺼번에 검사하므로, '뚜렷함'은 Holm 보정 뒤에도 남는 것만 (실제로 검사한 것만 셈)
    const ps = [], at = [];
    rows.forEach((r, i) => { if (fin(r.p)) { ps.push(r.p); at.push([i, 'sigT']); } if (r.pA !== r.pB && fin(r.pP)) { ps.push(r.pP); at.push([i, 'sigP']); } });
    const hs = holm(ps, 0.05);
    rows.forEach((r) => { r.sigT = false; r.sigP = false; });
    at.forEach(([i, k], j) => { rows[i][k] = hs[j]; });
    // 순위로는 달라도 중앙값이 그대로이거나 반대 방향이면 '언제로 옮겨 갔다'고 말할 수 없습니다
    rows.forEach((r) => { if (r.sigT && (r.shiftText === '거의 같음' || !(r.dirT * r.shift > 0))) r.sigT = false; });
    return rows;
  }
  function verdictIntervention(E, a, ctx) {
    const cards = [];
    const iv = ctx.ivName || '개입';
    const K = a.xs.length;
    let ki = a.xs.findIndex((x) => x >= (fin(ctx.at) ? ctx.at : a.x0));
    if (ki < 0) ki = K - 1;
    const post = (arr) => (arr || []).slice(ki).filter(fin);
    // 개입 이후, 실제 시간으로 마지막 20% 구간의 D 중앙값
    const tail = a.D.slice(Math.min(K - 1, Math.max(ki + 1, tailStart(a.xs, 0.2, 3)))).filter(fin);
    const Dend = tail.length ? median(tail) : NaN;
    const numMax = Math.max(0, ...post(a.num)), peakD = Math.max(0, ...post(a.D));
    const simMin = a.simCurve ? Math.min(1, ...post(a.simCurve)) : 1;
    // 처음부터 차이가 생기지 않음 (갈라졌다가 돌아온 것과 구별)
    const never = numMax < 1e-6 && simMin >= 1 - 1e-9;
    const wasApart = numMax >= 0.3 || peakD >= 0.5;
    a.Dend = Dend; a.never = never; a.peakD = peakD; a.numMax = numMax;
    const RR = a.reroll;
    const N = a.N, changed = N - a.sameOutcome;
    // 한 세계의 미래가 바뀐 비율: '정해져 있었나?'의 핵심 사실
    const unrelTxt = fin(a.unrelDiff) && a.unrelDiff > 0 ? ` 서로 무관한 세계끼리라면 약 ${pct(a.unrelDiff)}가 달랐을 것입니다.` : '';
    const endTxt = changed ? `${N}쌍 중 ${changed}쌍(${pct(changed / N)})은 결말까지 달라졌습니다.${unrelTxt}` : `${N}쌍 모두 결말은 같았습니다.`;
    const nApart = a.nApart || 0, nDetail = a.nDetail || 0;
    // 중앙값은 작아도 일부 쌍이 끝까지 다르거나 결말이 바뀌었다면 '돌아왔다'거나 '작다'고 말하지 않습니다
    const mixed = !never && fin(Dend) && Dend < APART && (changed / N > 0.1 || nApart / N > 0.2);
    const notSame = nDetail ? ` 다만 세부까지 똑같아지지는 않은 쌍이 ${nDetail}쌍입니다.` : '';
    // 구체적인 역사
    let ht, htitle, hk, hd = fin(Dend) ? `끝 무렵 갈라짐 ${Dend.toFixed(2)} (0 = 같음, 1 = 서로 무관한 세계)` : null;
    if (never) {
      hk = 'never'; htitle = '구체적인 역사: 차이가 전혀 생기지 않음'; hd = null;
      ht = RR ? `개입(${iv})을 하고 그 뒤의 우연까지 바꿨는데도 두 세계는 끝까지 똑같았습니다. 이 기간에는 우연이 결과를 바꾸지 못합니다.`
        : `같은 주사위를 쓰면, 이 모형에서는 이 정도 개입(${iv})이 전혀 커지지 않았습니다. 쌍둥이는 처음부터 끝까지 똑같았습니다. 흔들림을 ‘흡수’한 것이 아니라 차이가 애초에 자라지 않은 것입니다.`;
    } else if (!fin(Dend)) { hk = 'na'; htitle = '구체적인 역사: 판단 보류'; ht = '비교할 수 있는 지표가 부족합니다.'; }
    else if (mixed) {
      hk = 'mixed'; htitle = '구체적인 역사: 쌍마다 다름';
      const more = [];
      if (nApart) more.push(`${nApart}쌍(${pct(nApart / N)})은 눈에 띄게 달랐${changed ? '고' : '습니다'}`);
      if (changed) more.push(`${changed}쌍(${pct(changed / N)})은 결말까지 달라졌습니다`);
      ht = `가운데 쌍만 보면 차이가 작지만, 쌍마다 차이가 컸습니다. ${nDetail === N ? `${N}쌍 모두` : `${N}쌍 중 ${nDetail}쌍은`} 끝에서도 세부가 달랐습니다. 그중 ${more.join(', ')}.${changed ? unrelTxt : ' 결말은 모두 같았습니다.'}`;
      hd += ` · 가장 클 때 ${Math.min(peakD, 9.99).toFixed(2)} · 눈에 띄게 다름 = 끝 갈라짐 ${APART} 이상`;
    } else if (Dend < APART && wasApart) {
      hk = 'returned'; htitle = '구체적인 역사: 갈라졌다가 원래 길로 돌아옴';
      ht = `개입 뒤 쌍둥이가 한때 갈라졌지만, 끝에는 대부분 원래 세계와 거의 같은 상태로 돌아왔습니다.${RR ? ' 그 뒤의 우연까지 바뀌었는데도 같은 곳으로 돌아왔습니다.' : ''} ${endTxt}${notSame}`;
      hd += ` · 가장 클 때 ${Math.min(peakD, 9.99).toFixed(2)}`;
    } else if (Dend < APART) {
      hk = 'small'; htitle = '구체적인 역사: 차이가 작은 채로 남음';
      ht = `개입(${iv})이 만든 차이가 크게 자라지 않았습니다. ${endTxt}${notSame}`;
    } else if (Dend < 0.4) {
      hk = 'trace'; htitle = '구체적인 역사: 흔적이 남음';
      // 결말이 바뀐 쌍이 많으면 '꽤 비슷'이라고 하지 않습니다
      ht = changed / N >= 0.25 ? `지표로 재면 개입한 세계는 원래 세계에 가까운 편입니다(서로 무관한 두 세계 차이의 ${pct(Dend)}쯤). 그래도 결말까지 바뀐 쌍이 적지 않습니다. ${endTxt}`
        : `개입한 세계와 원래 세계는 꽤 비슷하지만 흔적이 남았습니다. ${endTxt}`;
    } else if (Dend < 0.6) {
      hk = 'apart'; htitle = '구체적인 역사: 꽤 달라짐';
      ht = `개입한 세계와 원래 세계가 꽤 달라졌습니다. 서로 무관한 두 세계 차이의 절반쯤 됩니다. ${endTxt}`;
    } else {
      const full = Dend >= 0.85;
      hk = 'split'; htitle = full ? '구체적인 역사: 완전히 갈라짐' : '구체적인 역사: 크게 갈라짐';
      ht = (RR ? `개입 뒤 쌍둥이 세계가 서로 무관한 두 세계${full ? '만큼' : '에 가까울 만큼'} 달라졌습니다. 개입 뒤의 우연도 함께 바뀌었으므로 세부 역사가 갈라지는 것은 자연스러운 일입니다.`
        : `같은 주사위를 썼는데도 개입(${iv}) 하나로 역사가 다른 길로 갈라졌습니다. 이 세계는 스스로 작은 차이를 키웁니다. 나비 효과입니다.`) + ' ' + endTxt;
    }
    a.historyKind = hk;
    const hCard = { title: htitle, text: ht, tone: 'main', detail: hd };
    // 큰 흐름 (결말 분포 + 끝 시점 지표 중앙값 + 일어난 비율이 달라진 사건)
    const few = N < 3;
    const chg = a.metrics.filter((m) => m.sig).sort((p, q) => Math.abs(q.eff) - Math.abs(p.eff));
    const evChg = a.events.filter((e) => e.pre < 0.5 && e.sigP && Math.abs(e.pB - e.pA) >= 0.1).sort((p, q) => Math.abs(q.pB - q.pA) - Math.abs(p.pB - p.pA));
    // 결말을 하나씩 본 쌍 검정: 뚜렷한 것은 '큰 흐름'으로, 달라 보이지만 뚜렷하지 않은 것은 따로 부드럽게
    const ocChg = a.outcomes.filter((o) => o.sigO).sort((p, q) => Math.abs(q.dp) - Math.abs(p.dp));
    const ocLook = a.outcomes.filter((o) => !o.sigO && fin(o.pO) && o.pO < 0.2).sort((p, q) => p.pO - q.pO);
    const ocTxt = (o) => `「${o.label}」 결말 ${o.nA}쌍 → ${o.nB}쌍(${pct(o.pA)} → ${pct(o.pB)})`;
    const bigChanged = !few && !never && (a.outcomeSig || ocChg.length > 0 || chg.length > 0 || evChg.length > 0);
    a.bigChanged = bigChanged;
    const big = a.outcomes.slice().sort((p, q) => Math.abs(q.dp) - Math.abs(p.dp))[0];
    const mde = detectable(N);
    // 근거가 아주 강하지 않은데 쌍이 많지 않으면 단정하지 않습니다 (2,000쌍으로 늘리면 사라지는 경우가 실제로 있었음)
    const bigPs = [a.outcomeSig ? a.p : NaN, ...ocChg.map((o) => o.pO), ...chg.map((m) => m.p), ...evChg.map((e) => e.pP)].filter(fin);
    const weakBig = bigChanged && N < 500 && bigPs.length > 0 && Math.min(...bigPs) >= 0.001;
    let ft, ftitle, fd = null;
    if (few) { ftitle = '큰 흐름: 판단 보류'; ft = `개입이 적용된 쌍이 ${N}쌍뿐이라 결말 분포를 비교할 수 없습니다. 쌍의 수를 늘려 보세요.`; }
    else if (never) { ftitle = '큰 흐름: 그대로'; ft = `두 세계가 똑같았으므로 결말과 지표도 모두 같았습니다(${N}쌍 모두 같은 결말).`; }
    else if (!bigChanged) {
      // 찾지 못한 것 ≠ 없는 것: 달라 보인 값과 이 수로 알아볼 수 있는 크기를 함께 말합니다
      ftitle = '큰 흐름: 뚜렷한 변화는 찾지 못함';
      ft = '결말 비율과 끝 시점 지표에서 우연과 구별되는 차이를 찾지 못했습니다.';
      const looks = a.metrics.filter((m) => !m.sig && fin(m.gap) && m.gap >= 0.5 && m.fmt(m.medA) !== m.fmt(m.medB)).sort((p, q) => q.gap - p.gap).slice(0, 2)
        .map((m) => `${shortLabel(m.label)} ${m.fmt(m.medA)} → ${m.fmt(m.medB)}`);
      const evLook = a.events.filter((e) => e.pre < 0.5 && !e.sigP && Math.abs(e.pB - e.pA) >= 0.15).sort((p, q) => Math.abs(q.pB - q.pA) - Math.abs(p.pB - p.pA))[0];
      if (evLook) looks.push(`「${evLook.name}」 ${pct(evLook.pA)} → ${pct(evLook.pB)}`);
      if (looks.length) ft += ` 달라 보이는 값도 있었습니다(${looks.join(', ')}). 이 수로는 우연과 구별되지 않습니다.`;
      ft += ` ${N}쌍으로는 결말 비율이 대략 ${mde}%p(예: 30% → ${Math.min(100, 30 + mde)}%) 넘게 달라져야 알아볼 수 있어서, 더 작은 변화는 있어도 놓칠 수 있습니다. 쌍 수를 늘리면 더 분명해집니다.`;
      fd = `결말 분포 차이 ${pct(a.tvd)}, ${pfmt(a.p)}`;
    } else {
      ftitle = weakBig ? '큰 흐름: 바뀐 듯함 (확인 필요)' : '큰 흐름: 바뀜';
      const bits = [], pv = [];
      if (a.outcomeSig) { bits.push(`결말 분포가 달라졌습니다. 「${big.label}」 ${pct(big.pA)} → ${pct(big.pB)}`); pv.push(`결말 분포 ${pfmt(a.p)}`); }
      ocChg.filter((o) => !(a.outcomeSig && o.key === big.key)).slice(0, 2).forEach((o) => { bits.push(ocTxt(o)); pv.push(`${shortLabel(o.label)} ${pfmt(o.pO)}`); });
      chg.slice(0, 2).forEach((m) => { bits.push(`${shortLabel(m.label)} 중앙값 ${m.fmt(m.medA)} → ${m.fmt(m.medB)}`); pv.push(`${shortLabel(m.label)} ${pfmt(m.p)}`); });
      evChg.slice(0, 2).forEach((e) => { bits.push(`「${e.name}」 ${pct(e.pA)} → ${pct(e.pB)}`); pv.push(`${e.name} ${pfmt(e.pP)}`); });
      ft = bits.join('. ') + '.';
      if (!a.outcomeSig) {
        ft += ocChg.length ? ' 결말 전체의 분포로 보면 우연과 구별되지 않았지만, 이 결말만 따로 보면 결말 여러 개를 함께 살핀 것을 감안해도 우연으로 보기 어렵습니다.' : ' 결말 분포 자체는 우연과 구별되지 않았습니다.';
        pv.push(`결말 분포 ${pfmt(a.p)}`);
      }
      fd = pv.join(' · ');
    }
    const fCard = { title: ftitle, text: ft, tone: bigChanged ? 'warn' : 'info', detail: fd };
    // 종합: 맨 앞에 놓는 답. 세계 하나의 미래와 결말의 확률을 나눠서 말합니다
    const oddsTxt = '결말의 확률까지 바뀌었다는 증거는 찾지 못했지만, 이 수로 단정할 수는 없습니다.';
    const missP = pct(missRate(N));
    const oneTxt = !changed ? `이번 ${N}쌍에서는 결말이 하나도 바뀌지 않았습니다. 쉽게 바뀌지 않는 것으로 보이지만, ${N}쌍으로는 약 ${missP}까지 되는 변화도 안 보일 수 있습니다.`
      : changed / N < 0.1 ? `결말은 대체로 그대로였지만 완전히 정해져 있지는 않았습니다. ${N}쌍 중 ${changed}쌍(${pct(changed / N)})의 결말이 바뀌었습니다. ${oddsTxt}`
      : `세계 하나의 결말은 정해져 있지 않았습니다. ${N}쌍 중 ${changed}쌍(${pct(changed / N)})의 결말이 바뀌었습니다. ${oddsTxt}`;
    const fewNote = N < 20 ? ` 다만 ${N}쌍뿐인 결과입니다.` : ` (${N}쌍 결과)`;
    const fewNote2 = N < 20 ? ` ${N}쌍뿐인 결과라는 점도 감안해 주세요.` : ''; // 앞 문장에 이미 '다만'이 있을 때
    let sum = null;
    if (few || hk === 'na') sum = null;
    else if (never) sum = RR ? `개입 뒤의 우연까지 바꿨는데도 ${N}쌍 모두 아무 차이가 없었습니다. 이 기간에는 결과가 거의 정해져 있는 것으로 보입니다.${fewNote}`
      : '같은 주사위라면 이 개입은 아무것도 바꾸지 못했습니다. 다만 세계가 흔들림을 흡수해서가 아니라, 이 모형에서 이렇게 작은 개입이 커질 길이 없었기 때문입니다. ‘개입 뒤의 우연 · 함께 바뀜’으로 다시 해 보면 실제 세상처럼 우연까지 바뀔 때를 볼 수 있습니다.';
    else if (bigChanged) {
      const what = [];
      if (a.outcomeSig) what.push('결말의 확률');
      else if (ocChg.length) what.push(`「${ocChg[0].label}」 결말의 확률`);
      else if (evChg.length) what.push(`「${evChg[0].name}」의 확률`);
      if (chg.length) what.push(shortLabel(chg[0].label));
      else if ((a.outcomeSig || ocChg.length) && evChg.length) what.push(`「${evChg[0].name}」의 확률`);
      sum = `아니요. ${weakBig ? `개입(${iv}) 뒤 ${what.join(' · ')}까지 달라진 것으로 나타났습니다.` : `개입(${iv})이 ${what.join(' · ')}까지 바꿨습니다.`}${changed ? ` ${N}쌍 중 ${changed}쌍(${pct(changed / N)})은 결말도 달랐습니다.` : ''} 이 개입 앞에서 미래는 정해져 있지 않았습니다.${weakBig ? ' 다만 아무 차이가 없어도 이런 결과가 20번에 1번쯤은 우연히 나오니, 쌍 수를 늘려 다시 확인해 보세요.' : ''}`;
    } else if (hk === 'mixed') {
      const who = RR ? '' : '같은 주사위를 썼는데도 ';
      const facts = nApart && changed ? `${who}${N}쌍 중 ${nApart}쌍은 끝에서도 눈에 띄게 달랐고, ${changed}쌍(${pct(changed / N)})은 결말까지 바뀌었습니다.`
        : changed ? `${who}${N}쌍 중 ${changed}쌍(${pct(changed / N)})은 결말까지 바뀌었습니다.`
        : `${who}${N}쌍 중 ${nApart}쌍은 끝에서도 눈에 띄게 달랐습니다. 결말은 하나도 바뀌지 않았습니다.`;
      sum = `세부까지 정해져 있지는 않았습니다. ${facts} ${changed ? oddsTxt : `${N}쌍으로는 약 ${missP}까지 되는 결말 변화도 안 보일 수 있습니다.`}`;
    } else if (hk === 'split') sum = `세부 역사는 ${Dend >= 0.85 ? '완전히' : '크게'} 갈라졌습니다. ${oneTxt}`;
    else if (hk === 'returned') sum = (RR ? '우연까지 바뀌었는데도 세계가 대부분 원래 상태로 돌아왔습니다. 이 기간의 미래는 강하게 한곳으로 끌려가는 것으로 보입니다.' : '잠시 갈라졌던 세계가 대부분 원래 상태로 돌아왔습니다. 이 세계는 작은 흔들림을 스스로 흡수하는 편으로 보입니다.') + (changed ? ` 다만 ${N}쌍 중 ${changed}쌍은 결말이 달랐습니다.${fewNote2}` : fewNote);
    else if (hk === 'small') sum = `개입이 만든 차이는 작은 채로 남았고 큰 흐름의 변화도 찾지 못했습니다. 이 정도 개입으로는 미래가 크게 바뀌지 않는 것으로 보입니다.${changed ? ` 다만 ${N}쌍 중 ${changed}쌍은 결말이 달랐습니다.${fewNote2}` : fewNote}`;
    else sum = `세부 역사에 ${hk === 'apart' ? '꽤 큰 ' : ''}흔적이 남았습니다. ${oneTxt}`;
    // 개입 뒤로 지켜본 시간이 전체의 10%도 안 되면, 결론이 그 짧은 시간만 본 것임을 밝힙니다
    const afterX = a.x1 - (fin(ctx.at) ? ctx.at : a.x0), afterFr = afterX / Math.max(1e-300, a.x1 - a.x0);
    const shortTxt = afterFr < 0.1 ? ` 이 결론은 개입 뒤 ${WS.fmtYears(afterX)}(전체 기간의 ${afterFr < 0.01 ? '1% 미만' : pct(afterFr)})만 지켜본 결과입니다. 더 오래 지켜보면 달라질 수 있으니, 더 일찍 개입하거나 더 먼 때까지 지켜보며 확인해 보세요.` : '';
    if (sum) { hCard.tone = 'info'; cards.push({ title: '미래는 정해져 있었나?', text: sum + shortTxt, tone: 'main' }); }
    else if (shortTxt) hCard.text += shortTxt;
    cards.push(hCard, fCard);
    if (!few && !never && ocLook.length) {
      cards.push({ title: '달라 보이지만 우연일 수 있음', text: `${ocLook.slice(0, 3).map(ocTxt).join(' · ')}. 달라 보이지만 결말 여러 개를 함께 살핀 것을 감안하면 우연과 구별되지 않습니다. 쌍 수를 늘리면 더 분명해집니다.`, tone: 'soft', detail: `${ocLook.slice(0, 3).map((o) => `${shortLabel(o.label)} ${pfmt(o.pO)}`).join(' · ')} (여러 결말을 함께 보기 전의 p값입니다)` });
    }
    // 가정 (개입 뒤의 우연)
    if (a.coupled) cards.push({ title: '가정 · 개입 뒤의 우연: 언제나 함께 바뀜', text: '이 모형에서는 사람 수가 조금만 달라져도 그 뒤에 일어날 우연이 모두 달라집니다. 그래서 개입이 세계를 조금이라도 바꾸면 그 뒤의 우연도 함께 바뀝니다. 실제 세상의 나비 효과와 비슷합니다.', tone: 'soft' });
    else if (RR) cards.push({ title: '가정 · 개입 뒤의 우연: 함께 바뀜 (나비 효과)', text: '개입한 세계는 개입 직후부터 앞으로 겪을 우연(주사위)도 원래 세계와 달라집니다. 실제 세상처럼 작은 차이가 그 뒤의 모든 우연을 바꾼다고 본 것입니다.', tone: 'soft' });
    else cards.push({ title: '가정 · 개입 뒤의 우연: 그대로 (같은 주사위)', text: '두 세계는 개입 뒤에도 같은 우연을 겪습니다. 그래서 둘의 차이는 오직 세계 스스로의 움직임이 개입을 키우거나 지운 결과입니다.', tone: 'soft' });
    const sh = a.events.filter((e) => e.pre < 0.5 && e.sigT);
    if (sh.length && !never) cards.push({ title: '시점이 바뀐 사건', text: sh.slice(0, 3).map((e) => `「${e.name}」 ${e.shiftText}`).join(' · ') + '.', tone: 'info', detail: sh.slice(0, 3).map((e) => `${e.name} ${pfmt(e.p)}`).join(' · ') });
    if (a.skipped > 0) cards.push({ title: '일부 쌍에만 적용됨', text: `개입은 ${a.total}쌍 중 ${a.applied}쌍에만 적용되었습니다(나머지는 그때 조건이 맞지 않음). 위 결과는 적용된 쌍만 비교한 것입니다.`, tone: 'warn' });
    if (a.failed > 0) cards.push({ title: '일부 쌍 실패', text: `${a.failed}쌍은 계산 중 오류가 나서 빠졌습니다.`, tone: 'warn' });
    return { cards };
  }

  /* ---------- Q4: 두 조건 A/B ---------- */
  function compare(mode, resA, resB, ctx) {
    ctx = ctx || {};
    const E = expOf(mode);
    const A = okRes(resA), B = okRes(resB);
    const out = { kind: 'compare', NA: A.length, NB: B.length, failed: (resA || []).length + (resB || []).length - A.length - B.length };
    if (!A.length || !B.length) { out.cards = [{ title: '결과 없음', text: '두 조건 모두 계산을 마친 세계가 있어야 비교할 수 있습니다.', tone: 'warn' }]; return out; }
    const xs = A[0].xs, K = xs.length;
    out.xs = xs; out.x0 = xs[0]; out.x1 = xs[K - 1];
    const { scales } = prep(E, [A, B]);
    out.scales = scales;
    const oA = A.map((r) => r.outcome), oB = B.map((r) => r.outcome);
    const ot = outcomeTable(E, [oA, oB]);
    out.outcomes = ot.rows.map((r) => ({ key: r.key, label: r.label, color: r.color, desc: r.desc, nA: r.n[0], nB: r.n[1], pA: r.p[0], pB: r.p[1], dp: r.p[1] - r.p[0] }));
    const tv = permTVD(oA, oB, { seed: 0x3c6ef372 });
    out.tvd = tv.obs; out.p = tv.p;
    outcomeTests(out.outcomes, oA, oB, false, 0x2f1c7a55);
    out.metrics = E.metrics.map((m, i) => {
      const fA = fan(A.map((r) => r.series[m.key]), m.log), fB = fan(B.map((r) => r.series[m.key]), m.log);
      const kk = Math.min(lastFinite(fA.med), lastFinite(fB.med));
      let p = NaN, eff = NaN, dir = 0;
      if (kk >= 0) {
        const ua = A.map((r) => r._U[i][kk]).filter(fin), ub = B.map((r) => r._U[i][kk]).filter(fin);
        if (ua.length >= 2 && ub.length >= 2) {
          const t = permMedDiff(ua, ub, { seed: 0x1f83d9ab + i });
          eff = (median(ub) - median(ua)) / scales[i];
          p = t.p; dir = t.dir;
        }
      }
      return { key: m.key, label: m.label, log: !!m.log, color: m.color, fmt: m.fmt, fanA: fA, fanB: fB, k: kk,
        medA: kk >= 0 ? fA.med[kk] : NaN, medB: kk >= 0 ? fB.med[kk] : NaN, eff, p, dir };
    });
    // 지표 여러 개 중 가장 작은 p를 고르면 우연한 '뚜렷함'이 잦아지므로 Holm 보정 + 최소 효과 크기(0.25)
    const msig = holm(out.metrics.map((m) => m.p), 0.05);
    out.metrics.forEach((m, i) => { m.sig = !!msig[i] && Math.abs(m.eff) >= 0.25 && m.dir * m.eff > 0; }); // 순위와 중앙값이 같은 방향일 때만
    out.events = milestoneShift(E, A, B, false, E.eventIdsOf(ctx.opts));
    out.worldsA = A.map((r, i) => ({ i, seed: r.seed, outcome: r.outcome, reached: r.reached }));
    out.worldsB = B.map((r, i) => ({ i, seed: r.seed, outcome: r.outcome, reached: r.reached }));
    out.resultsA = A; out.resultsB = B;
    Object.assign(out, verdictCompare(E, out, ctx));
    return out;
  }
  function verdictCompare(E, a, ctx) {
    const cards = [];
    const la = ctx.labelA || 'A', lb = ctx.labelB || 'B', nw = Math.min(a.NA, a.NB);
    const big = a.outcomes.slice().sort((p, q) => Math.abs(q.dp) - Math.abs(p.dp))[0];
    const topA = a.outcomes.slice().sort((p, q) => q.nA - p.nA)[0], topB = a.outcomes.slice().sort((p, q) => q.nB - p.nB)[0];
    // 두 조건이 같으면 같은 씨앗의 두 묶음이 세계 하나하나까지 똑같으므로 비교할 것이 없습니다 (세계 수를 늘려도 그대로)
    if (ctx.sameCond && a.tvd < EPS) {
      cards.push({ title: 'A와 B의 조건이 같습니다', text: `두 묶음 모두 같은 조건(${la})이고 씨앗도 같아서, 세계 하나하나까지 똑같이 나옵니다. 세계 수를 늘려도 달라지지 않습니다. 조건에 따른 차이를 보려면 A나 B의 조건을 바꿔 보세요.`, tone: 'main' });
      cards.push({ title: '가장 흔한 결말', text: `「${topA.label}」 ${pct(topA.pA)}`, tone: 'info' });
      if (a.failed > 0) cards.push({ title: '일부 세계 실패', text: `${a.failed}개 세계는 계산 중 오류가 나서 빠졌습니다.`, tone: 'warn' });
      return { cards };
    }
    const ocChg = a.outcomes.filter((o) => o.sigO).sort((p, q) => Math.abs(q.dp) - Math.abs(p.dp));
    // 가장 뚜렷한 차이: 결말 · 사건 · 지표 가운데 검정을 통과한 것만, 크기순으로 맨 앞에 모읍니다 (0에서 시작한 비율로 부풀리지 않도록 의미 있는 차이 단위로 견줌)
    const items = [];
    if (a.p < 0.05) items.push({ score: a.tvd * 4, text: `「${big.label}」 결말 ${pct(big.pA)} → ${pct(big.pB)}`, det: `결말 분포 ${pfmt(a.p)}` });
    ocChg.filter((o) => !(a.p < 0.05 && o.key === big.key)).forEach((o) => items.push({ score: Math.abs(o.dp) * 4, text: `「${o.label}」 결말 ${pct(o.pA)} → ${pct(o.pB)}`, det: `${shortLabel(o.label)} 결말 ${pfmt(o.pO)}` }));
    a.events.filter((e) => e.pre < 0.5).forEach((e) => {
      if (e.sigP && Math.abs(e.pB - e.pA) >= 0.1) items.push({ score: Math.abs(e.pB - e.pA) * 4, text: `「${e.name}」 ${pct(e.pA)} → ${pct(e.pB)}`, det: `${e.name} ${pfmt(e.pP)}` });
      else if (e.sigT) items.push({ score: 1, text: `「${e.name}」 ${e.shiftText}`, det: `${e.name} ${pfmt(e.p)}` });
    });
    a.metrics.filter((m) => m.sig).forEach((m) => items.push({ score: Math.abs(m.eff), text: `${shortLabel(m.label)} ${m.fmt(m.medA)} → ${m.fmt(m.medB)}`, det: `${shortLabel(m.label)} ${pfmt(m.p)}` }));
    items.sort((p, q) => q.score - p.score);
    const lead = items.slice(0, 3), rest = items.slice(3);
    const mde = detectable(nw);
    if (lead.length) cards.push({ title: '가장 뚜렷한 차이', text: `‘${la}’에 비해 ‘${lb}’에서는 이렇게 달라졌습니다: ${lead.map((x) => x.text).join(' · ')}.`, tone: 'main', detail: lead.map((x) => x.det).join(' · ') });
    else cards.push({ title: '뚜렷한 차이는 찾지 못함', text: `결말 · 지표 · 사건 어디에서도 우연과 구별되는 차이를 찾지 못했습니다. 차이가 없다는 뜻은 아닙니다. 조건마다 ${nw}개 세계로는 비율이 대략 ${mde}%p(예: 30% → ${Math.min(100, 30 + mde)}%) 넘게 달라져야 알아볼 수 있습니다. 세계 수를 늘리면 더 분명해집니다.`, tone: 'main' });
    // 결말
    let t, title;
    if (a.p < 0.05) { title = '결말이 달라졌습니다'; t = `「${big.label}」 결말의 비율이 ${pct(big.pA)} → ${pct(big.pB)}로 바뀌었습니다.`; }
    else if (ocChg.length) {
      const o = ocChg[0];
      title = '결말 하나가 뚜렷하게 달라졌습니다';
      t = `「${o.label}」 결말이 ${nw}개 중 ${o.nA}개 → ${o.nB}개(${pct(o.pA)} → ${pct(o.pB)})로 바뀌었습니다. 결말 전체의 분포로 보면 아직 확실하지 않지만, 이 결말만 따로 보면 결말 여러 개를 함께 살핀 것을 감안해도 우연으로 보기 어렵습니다.`;
    } else if (a.tvd >= 0.1 && a.p < 0.2) {
      title = '결말 차이가 있어 보이지만 아직 확실하지 않음';
      t = `결말 비율이 ${pct(a.tvd)}쯤 달랐습니다. 정말 아무 차이가 없을 때 이만한 차이가 우연히 나올 확률은 약 ${pct(a.p)}입니다. 차이가 있어 보이지만 우연을 아직 배제할 수는 없습니다. 세계 수를 늘리면 더 분명해집니다.`;
    } else if (a.tvd >= 0.1) { title = '결말 차이는 뚜렷하지 않음'; t = `결말 비율이 ${pct(a.tvd)}쯤 달랐지만, 조건마다 ${nw}개 세계라면 우연으로도 흔히 생기는 크기입니다. 세계 수를 늘리면 더 분명해집니다.`; }
    else { title = '결말은 비슷했습니다'; t = `이번 실험에서 결말 비율은 거의 같았습니다. 조건마다 ${nw}개 세계로는 작은 차이는 놓칠 수 있습니다.`; }
    cards.push({ title, text: t, tone: 'info', detail: `결말 분포 차이 ${pct(a.tvd)}, ${pfmt(a.p)}` });
    cards.push({ title: '가장 흔한 결말', text: `${la}: 「${topA.label}」 ${pct(topA.pA)} · ${lb}: 「${topB.label}」 ${pct(topB.pB)}`, tone: 'info' });
    // 그 밖의 뚜렷한 차이
    if (rest.length) cards.push({ title: '그 밖에 뚜렷한 차이', text: rest.slice(0, 3).map((x) => x.text).join(' · ') + '.', tone: 'soft', detail: rest.slice(0, 3).map((x) => x.det).join(' · ') });
    // 달라 보였지만 우연과 구별되지 않은 값: 지표와 사건을 함께 보고 p가 작은 것부터 (0에서 시작한 비율로 부풀려진 값이 앞서지 않게)
    const looks = [];
    a.metrics.filter((q) => !q.sig && fin(q.eff) && fin(q.p) && q.p < 0.2 && Math.abs(q.eff) >= 0.25 && q.fmt(q.medA) !== q.fmt(q.medB)).forEach((q) => looks.push({ p: q.p, text: `${E.xfmt(a.xs[q.k]).replace(/^서기\s*/, '')}의 ${shortLabel(q.label)} ${q.fmt(q.medA)} → ${q.fmt(q.medB)}`, det: `${shortLabel(q.label)} ${pfmt(q.p)}` }));
    a.events.filter((e) => e.pre < 0.5 && !e.sigP && fin(e.pP) && e.pP < 0.2 && Math.abs(e.pB - e.pA) >= 0.1 && !ocChg.some((o) => shortLabel(o.label) === shortLabel(e.name))).forEach((e) => looks.push({ p: e.pP, text: `「${e.name}」 ${pct(e.pA)} → ${pct(e.pB)}`, det: `${e.name} ${pfmt(e.pP)}` }));
    a.outcomes.filter((o) => !o.sigO && fin(o.pO) && o.pO < 0.2 && Math.abs(o.dp) >= 0.1).forEach((o) => looks.push({ p: o.pO, text: `「${o.label}」 결말 ${pct(o.pA)} → ${pct(o.pB)}`, det: `${shortLabel(o.label)} 결말 ${pfmt(o.pO)}` }));
    looks.sort((p, q) => p.p - q.p);
    if (looks.length) cards.push({ title: '우연일 수도 있는 차이', text: `달라 보이지만 여러 값을 함께 살핀 것을 감안하면 우연일 수도 있습니다: ${looks.slice(0, 2).map((x) => x.text).join(' · ')}.`, tone: 'soft', detail: looks.slice(0, 2).map((x) => x.det).join(' · ') + ' (여러 값을 함께 보기 전의 p값입니다)' });
    if (a.failed > 0) cards.push({ title: '일부 세계 실패', text: `${a.failed}개 세계는 계산 중 오류가 나서 빠졌습니다.`, tone: 'warn' });
    return { cards };
  }

  WS.LabCore = {
    exp: expOf,
    attachSchedule, runSchedule,
    makeJob, runSync, worldOpts, sampleGrid, makeProbe,
    pool,
    workerUrl: null, workerScripts: null,
    stats: { quantile, median, mean, std, fan, entropy, tvd, permTest, permTVD, permMedDiff, permSignMed, permRate, holm, medBuf, medoid, pairDist, countBy, zigzag },
    analyze: { ensemble, intervention, compare },
    fmt: { pct, p: pfmt },
  };
})();
