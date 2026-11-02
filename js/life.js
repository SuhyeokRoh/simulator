'use strict';
/* 생명 진화 모드: 표류하는 대륙, 탄소 순환·산소·메탄·빙하 되먹임, 격자 위에서 경쟁·확산·종 분화하는 생물 */
(function () {
  const WS = window.WS;
  const OXY_NEED = [0, 0.002, 0.01, 0.035, 0.09];
  const OV = [1, 0.55, 0.25, 0.1, 0.05];
  const OVL = [0, 1, 2, 3, 4].map((cx) => [0, 1, 2, 3, 4].map((j) => OV[Math.abs(j - cx)]));
  const EARTH_NOW = 4570; // 백만 년
  // exp(-x) 표 (x ≥ 0, 1/128 간격, 선형 보간; 상대 오차 1e-5 미만). 생태 계산의 가장 뜨거운 줄을 빠르게
  const EXP_K = 128, EXP_MAX = 48;
  const EXPT = new Float64Array(EXP_MAX * EXP_K + 2);
  for (let i = 0; i < EXPT.length; i++) EXPT[i] = Math.exp(-i / EXP_K);
  const CX_NAME = ['미생물', '진핵 세포', '다세포 생물', '조직·기관을 갖춘 생물', '척추동물급 동물'];

  // 시작 조건(실험실 Q4). 기본값이면 프리셋과 똑같이 동작
  const cond = (s, k, d) => { const v = s.opts && s.opts.cond ? s.opts.cond[k] : undefined; return typeof v === 'number' && isFinite(v) ? v : d; };
  // 32비트 해시: 종마다 이름·색·생김새를 주 난수 흐름과 무관하게 정한다
  function hash32(a, b) {
    let h = Math.imul((a >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(((b >>> 0) + 0x632be5ab) | 0, 0xc2b2ae35);
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
    return h >>> 0 || 1;
  }
  // 한국어 조사 (a: 받침 있을 때, b: 받침 없을 때). 라틴 문자와 숫자는 읽는 소리로 고른다:
  // m·n·l로 끝나면 받침(-um 움, -on 온, -il 일), 나머지는 모음(-us 우스, -is 이스, -a 아). 숫자는 영·일·삼·육·칠·팔이 받침
  function josa(w, a, b) {
    const ch = String(w).charCodeAt(String(w).length - 1);
    if (ch >= 0xac00 && ch <= 0xd7a3) return w + ((ch - 0xac00) % 28 ? a : b);
    return w + (/[mnl013678]$/i.test(String(w)) ? a : b);
  }
  function fmtPct(v) {
    if (v >= 10) return Math.round(v) + '%';
    if (v >= 1) return v.toFixed(1).replace(/\.0$/, '') + '%';
    if (v >= 0.01) return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + '%';
    if (v >= 1e-4) return Number(v.toPrecision(1)) + '%';
    return '거의 0%';
  }
  // 이산화탄소 표시 전용. 5%가 넘으면 ppm 대신 대기 중 비율로, 모형 값이 대기 전체를 넘어도 '대기의 거의 전부'까지만 말한다
  // (1%를 경계로 삼으면 세계 하나에서 경계를 5~13번 넘나든다. 5%는 대개 태초에 한 번뿐이다)
  function fmtCO2(ppm) {
    if (ppm < 5e4) return `${WS.trimNum(ppm)} ppm`;
    return ppm >= 9e5 ? '대기의 거의 전부' : fmtPct(ppm / 1e4);
  }

  class Life extends WS.SimBase {
    constructor(opts, seed, inherit) {
      super(seed, opts);
      const r = this.rng;
      // 해상도는 lite만 결정 (headless는 화면 작업만 생략)
      this.lite = !!this.opts.lite;
      if (!this.cond) this.cond = Object.assign({}, this.opts.cond || {});
      this.W = this.lite ? 48 : 72;
      this.H = this.lite ? 24 : 36;
      this.NC = this.W * this.H;
      this.maxSp = this.lite ? 48 : 56;
      const kind = inherit ? 'inherit' : opts.planet || 'earth';
      const P = (this.P = { kind });
      if (kind === 'earth') Object.assign(P, { name: '원시 지구', mass: 1, ocean: 0.71, flux: 1, moon: true, giant: true, starLife: 10000, R0: 14 });
      else if (kind === 'inherit') {
        const w = inherit.water;
        Object.assign(P, {
          name: inherit.name, mass: inherit.mass, flux: 1 / Math.pow(0.95 + WS.clamp(inherit.hzPos, -0.6, 2) * 0.72, 2),
          ocean: w < 1e-5 ? 0.08 : w < 5e-5 ? 0.35 : w < 1e-3 ? 0.7 : w < 0.02 ? 0.88 : 0.97,
          moon: inherit.moon, giant: inherit.giant, starLife: (inherit.starLife || 1e10) / 1e6, R0: r.range(7, 25),
        });
      } else Object.assign(P, { name: '이름 없는 행성', mass: r.logRange(0.3, 4), ocean: r.range(0.2, 0.97), flux: r.range(0.78, 1.3), moon: r.chance(0.3), giant: r.chance(0.5), starLife: r.logRange(4000, 40000), R0: r.range(6, 28) });
      P.tect = (P.mass < 0.4 ? 0.5 : P.mass > 5 ? 0.6 : 1) * Math.max(0, cond(this, 'tect', 1));
      // 시작 조건 적용 (난수를 쓰지 않음)
      P.flux *= Math.max(0.05, cond(this, 'flux', 1));
      if (kind === 'earth') P.ocean = WS.clamp(cond(this, 'ocean', P.ocean), 0.02, 0.99);
      if (cond(this, 'moon', 1) < 0.5) P.moon = false;
      if (cond(this, 'giant', 1) < 0.5) P.giant = false;
      const abio = opts.abio || 'earth';
      this.abioRate = (abio === 'earth' ? 1 : abio === 'rare' ? 0.002 : r.logRange(1e-4, 1e3)) * Math.pow(10, WS.clamp(cond(this, 'abio', 0), -8, 8));
      this.abioKind = abio;
      this.impactMul = Math.max(0, cond(this, 'impacts', 1));
      this.mutMul = Math.max(0, cond(this, 'mutation', 1));
      this.until = typeof opts.until === 'number' && isFinite(opts.until) && opts.until > 0 ? opts.until : null;
      this.tRef = 4570 * P.starLife / 10000;
      this.tEnd = Math.min(6200, P.starLife * 0.95);

      this.t = 0;
      this.noise = new WS.Noise(seed);
      const NC = this.NC;
      this.elev = new Float32Array(NC); this.land = new Uint8Array(NC); this.temp = new Float32Array(NC);
      this.ice = new Uint8Array(NC); this.vent = new Float32Array(NC); this.light = new Float32Array(NC); this.lat = new Float32Array(NC);
      this.soup = new Float32Array(NC); this.scorch = new Float32Array(NC); this.area = new Float32Array(NC);
      for (let y = 0; y < this.H; y++) {
        const lat = (0.5 - (y + 0.5) / this.H) * Math.PI;
        for (let x = 0; x < this.W; x++) {
          const c = y * this.W + x;
          this.lat[c] = lat;
          this.light[c] = 0.3 + 0.7 * Math.cos(lat);
          this.area[c] = Math.cos(lat);
        }
      }
      this.areaSum = this.area.reduce((s, v) => s + v, 0);
      this.Tg = 900; this.co2 = 600; this.ch4 = 0; this.o2 = 1e-6; this.ozone = 0; this.R = P.R0 * r.range(0.7, 1.3);
      this.iceFrac = 0; this.landFrac = 0; this.oceanFrac = 0;
      this.tHist = [];
      this.varIdx = 0; this.orbPhase = r.next() * 10;
      this.lipBoost = 0; this.winter = 0; this.darkness = 0; this.mutBoost = 1; this.mutUntil = 0;
      this.species = []; this.all = []; this.spSeq = 0; this.byId = new Map();
      this.extinctions = []; this.lastCat = null; this.lastMassExt = -1e9;
      this.lipPending = 0; this.lipLogT = -1e9; this.lipAlarmed = false;
      this.firsts = {};
      this.biomass = 0;
      this.dt = 3;
      this._evSp = 0;
      // 태양계 보기 전용 기록과 이어받은 행성 목록 (세계의 진행에는 쓰지 않음)
      this.impacts = []; this.impactN = 0; this.bigImpacts = [];
      this.system = (inherit && inherit.system) || null;
      this.terrain(true);
      this.climate();
    }
    timeValue() { return this.t * 1e6; }
    timeLabel() {
      let s = '행성 나이 ' + WS.fmtYears(this.t * 1e6);
      if (this.P.kind === 'earth') {
        const d = EARTH_NOW - this.t;
        s += Math.abs(d) < 0.5 ? ' · 오늘' : ` · 오늘로부터 ${WS.fmtYears(Math.abs(d) * 1e6)} ${d > 0 ? '전' : '후'}`;
      }
      return s;
    }
    // 종에 관한 기록에는 e.sp(종 id)를 붙여 둔다 (그림 토스트용)
    log(text, kind) {
      const e = super.log(text, kind);
      if (e && this._evSp) e.sp = this._evSp;
      return e;
    }
    about(sp, fn) {
      const prev = this._evSp;
      this._evSp = sp ? sp.id : 0;
      try { return fn(); } finally { this._evSp = prev; }
    }
    tect() { return this.P.tect * (0.3 + 0.7 * Math.exp(-this.t / 2500)) * (this.P.mass < 0.4 ? Math.exp(-this.t / 1500) : 1); }

    /* ----- 지형: 구면 노이즈 + 시간에 따라 미끄러지는 대륙 ----- */
    elevAt(lon, lat, tG) {
      const cl = Math.cos(lat);
      const x = cl * Math.cos(lon), y = cl * Math.sin(lon), z = Math.sin(lat);
      const o1 = tG * 0.5, o2 = tG * 0.33;
      const n = this.noise;
      return n.fbm(x * 1.25 + o1, y * 1.25 + 7.1, z * 1.25 - o1 * 0.6, 5) + 0.45 * n.fbm(x * 2.7 - o2 + 3, y * 2.7 + o2, z * 2.7 + 11, 4);
    }
    terrain(first) {
      const tG = this.t / 1000, W = this.W, NC = this.NC;
      for (let c = 0; c < NC; c++) {
        const x = c % W, lon = ((x + 0.5) / W) * Math.PI * 2 - Math.PI;
        this.elev[c] = this.elevAt(lon, this.lat[c], tG);
      }
      this._sorted = null;
      this.seaLevelFromOcean();
      const n = this.noise;
      for (let c = 0; c < NC; c++) {
        const x = c % W, lon = ((x + 0.5) / W) * Math.PI * 2 - Math.PI, lat = this.lat[c];
        const ridge = 1 - Math.abs(n.n3(Math.cos(lat) * Math.cos(lon) * 3 + tG, Math.cos(lat) * Math.sin(lon) * 3, Math.sin(lat) * 3 + 5));
        this.vent[c] = this.land[c] ? 0 : Math.pow(ridge, 4);
      }
      this.terrainT = this.t;
      this.terrainDirty = true;
      if (first) this.hiElevT = -1;
    }
    seaLevelFromOcean() {
      const NC = this.NC;
      const oceanTarget = WS.clamp(this.P.ocean * (this.Tg > 100 ? 0 : 1) - this.iceLandShift(), 0, 0.99);
      if (!this._sorted) this._sorted = Float32Array.from(this.elev).sort();
      const sorted = this._sorted;
      this.sea = oceanTarget <= 0 ? -9 : sorted[Math.min(NC - 1, Math.floor(oceanTarget * NC))];
      this.emax = sorted[NC - 1];
      this.emin = sorted[0];
      let lf = 0;
      for (let c = 0; c < NC; c++) { this.land[c] = this.elev[c] > this.sea ? 1 : 0; if (this.land[c]) lf += this.area[c]; }
      this.landFrac = lf / this.areaSum;
      this.oceanFrac = 1 - this.landFrac;
    }
    iceLandShift() { return this.iceFrac > 0.3 ? (this.iceFrac - 0.3) * 0.08 : 0; }

    /* ----- 기후와 대기 ----- */
    starLum() { return 1 / (1 + 0.4 * (1 - this.t / this.tRef)); }
    climate() {
      const P = this.P, tG = this.t;
      const lum = this.starLum();
      const S = P.flux * lum;
      const alb = 0.29 + 0.42 * this.iceFrac;
      const Te = 255 * Math.pow(Math.max(0.01, (S * (1 - alb)) / 0.71), 0.25);
      const atm = WS.clamp(P.mass / 0.5, 0.15, 1.3);
      const GH = (33 + 4.2 * Math.log2(Math.max(0.02, this.co2)) + 4 * Math.log2(1 + this.ch4)) * atm;
      const magma = 2400 * Math.exp(-tG / 25);
      this.orbPhase += 0.37;
      const orb = Math.sin(this.orbPhase) * (P.moon ? 1.2 : 4) * (1 + Math.max(0, 0.6 - Math.log10(this.co2 + 1) * 0.3));
      const Teq = Te + Math.max(0, GH) - 273 + magma + orb - this.winter;
      this.Tg += (Teq - this.Tg) * 0.5;
      this.winter *= 0.4;
      this.tHist.push(this.Tg);
      if (this.tHist.length > 40) this.tHist.shift();
      const m = this.tHist.reduce((s, v) => s + v, 0) / this.tHist.length;
      const sd = Math.sqrt(this.tHist.reduce((s, v) => s + (v - m) * (v - m), 0) / this.tHist.length);
      this.varIdx = WS.clamp(sd / 2.5, 0, 1.6);
      // 칸별 기온과 얼음
      let ice = 0;
      const span = Math.max(0.05, this.emax - this.sea);
      const S2 = this.s2 || (this.s2 = Float64Array.from(this.lat, (l) => Math.sin(l) ** 2));
      for (let c = 0; c < this.NC; c++) {
        const s2 = S2[c];
        let T = this.Tg + 14 - 42 * s2;
        if (this.land[c]) T -= 26 * Math.max(0, (this.elev[c] - this.sea) / span);
        this.temp[c] = T;
        const ic = this.land[c] ? T < -10 : T < -2;
        this.ice[c] = ic ? 1 : 0;
        if (ic) ice += this.area[c];
      }
      this.iceFrac = ice / this.areaSum;
      // 탄소-규산염 온도 조절
      let landPlants = 0, oceanOxy = 0, landOxy = 0, methano = 0;
      for (const sp of this.species) {
        if (sp.troph !== 0) continue;
        if (sp.land) { landPlants += sp.total; landOxy += sp.total; }
        else if (sp.energy === 'oxy') oceanOxy += sp.total;
        else if (sp.energy === 'chemo' && !sp.aerobic) methano += sp.total;
      }
      this.landPlant = landPlants / Math.max(0.05, this.landFrac);
      const tect = this.tect();
      const V = tect * (1 + this.lipBoost);
      const weather = (this.landFrac * (1 - Math.min(1, this.iceFrac * 1.3)) + 0.04) * 0.48;
      const W = weather * Math.exp((Math.min(this.Tg, 60) - 15) / 13) * Math.pow(Math.max(0.001, this.co2), 0.35) * (1 + 3 * Math.min(1, this.landPlant));
      const B = 0.12 * oceanOxy;
      const net = V - W - B;
      if (this.Tg < 100) this.co2 *= Math.exp(WS.clamp((net / Math.max(V, W + B, 0.01)) * 0.4, -0.35, 0.35));
      if (P.mass < 0.4) this.co2 *= Math.exp(-0.0006 * 1 / P.mass);
      this.co2 = WS.clamp(this.co2, 0.005, 5000);
      this.lipBoost *= 0.6;
      // 산소: 먼저 환원 물질(철, 화산 가스)을 다 산화시켜야 쌓임
      const PO = 0.12 * oceanOxy + 0.45 * landOxy;
      const dt = this.dt;
      if (this.R > 0) {
        this.R -= PO * dt;
        this.o2 = 1e-6 + PO * 0.002;
      } else {
        const Vr = 0.06 * tect;
        this.o2 = Math.max(1e-6, this.o2 + (PO - Vr - 0.35 * this.o2) * dt * 0.5);
        if (this.Tg > 100) this.o2 *= 0.5;
      }
      this.o2 = Math.min(this.o2, 2.5);
      this.ch4 = (methano * 14) / (1 + 400 * this.o2);
      this.ozone = Math.min(1, Math.sqrt(this.o2 / 0.1));
    }

    /* ----- 생물 ----- */
    newSpecies(base, parent, innov) {
      const sp = Object.assign({
        troph: 0, energy: 'chemo', aerobic: false, cx: 0, land: false, landAdapt: 0, topt: 60, ttol: 18, size: 0.05,
        intel: 0, manip: 0, social: 0,
      }, base);
      sp.id = ++this.spSeq;
      sp.parent = parent ? parent.id : 0;
      sp.par = parent || null;
      sp.innov = !!innov;
      sp.born = this.t;
      sp.extinct = null;
      sp.pop = new Float32Array(this.NC);
      sp.occ = null; sp.nocc = 0; sp.occOk = false;
      sp.total = 0; sp.maxTotal = 0;
      // 이름과 색은 종마다 따로 둔 난수로 (주 난수 흐름은 건드리지 않음)
      const lr = new WS.RNG(hash32(this.seed, sp.id));
      sp.name = WS.makeName(lr, 'latin');
      if (!sp.color) sp.color = this.colorFor(sp, parent, lr);
      this.species.push(sp);
      this.all.push(sp);
      this.byId.set(sp.id, sp);
      return sp;
    }
    colorFor(sp, parent, r) {
      // 무리마다 기준 색상을 멀리 떨어뜨려 두고, 계통은 그 둘레에서만 흔들림 (계속 표류하면 남남인 무리끼리 같은 색이 됨)
      let base;
      if (sp.troph === 0) base = sp.energy === 'chemo' ? 28 : sp.energy === 'photo' ? 275 : sp.land ? 105 : sp.cx >= 2 ? 140 : 172;
      else if (sp.troph === 1) base = sp.land ? 58 : 220;
      else base = 350;
      let h;
      if (parent && parent.troph === sp.troph && parent.energy === sp.energy && parent.land === sp.land && isFinite(parent.hue)) h = base + (parent.hue - base) * 0.6 + r.normal() * 9;
      else h = base + r.normal() * 9;
      // 같은 무리라도 이웃 종끼리 구별되도록 명도도 흔듦 (화면 전용)
      sp.hue = h;
      return WS.hsl2rgb(h, 0.5 + r.next() * 0.4, (sp.troph === 0 ? 0.46 : 0.56) + (r.next() - 0.5) * 0.16);
    }
    /* 생김새 유전체: 필요할 때 조상부터 차례로 만든다 (종마다 고정된 국소 난수 → 언제 만들어도 같음) */
    genomeOf(sp) {
      if (!sp) return null;
      if (sp.g !== undefined) return sp.g;
      const C = WS.Creature;
      if (!C || !C.genome || !C.mutate) return null;
      const chain = [];
      for (let q = sp; q && q.g === undefined; q = q.par) chain.push(q);
      for (let i = chain.length - 1; i >= 0; i--) {
        const q = chain[i], lr = new WS.RNG(hash32(this.seed ^ 0x2545f491, q.id));
        try { q.g = q.par && q.par.g ? C.mutate(q.par.g, lr, q.innov ? 2 : 1) : C.genome(lr); } catch (e) { q.g = null; }
      }
      return sp.g;
    }
    traitsOf(sp) {
      return { troph: sp.troph, energy: sp.energy || '', cx: sp.cx, land: !!sp.land, aerobic: !!sp.aerobic, intel: sp.intel, manip: sp.manip, social: sp.social, size: sp.size, sapient: !!sp.sapient };
    }
    portraitKey(sp) { return `L${this.seed}.${sp.id}.${sp.parent}.${Math.round(sp.born * 10)}.${sp.troph}${sp.cx}${sp.land ? 1 : 0}${sp.energy}${sp.sapient ? 1 : 0}`; }
    kindName(sp) {
      const L = sp.land;
      let k;
      if (sp.troph === 0) {
        if (sp.cx === 0) k = sp.energy === 'chemo' ? '화학합성 미생물' : sp.energy === 'photo' ? '광합성 세균' : '남세균';
        else if (sp.cx === 1) k = '단세포 조류';
        else if (sp.cx === 2) k = L ? '이끼류' : '다세포 조류';
        else k = L ? '관다발 식물' : '해조 숲';
      } else if (sp.troph === 1) {
        k = ['포식 세균', '원생동물', '해면·산호류', L ? '육상 절지동물' : '바다 무척추동물', L ? '초식 척추동물' : '어류형 동물'][sp.cx];
      } else {
        k = ['포식 세균', '포식 원생생물', '해파리형 포식자', L ? '육상 포식 절지동물' : '포식 무척추동물', L ? '포식 척추동물' : '포식 어류형 동물'][sp.cx];
      }
      if (sp.sapient) return '지성 종 · ' + k;
      if (sp.intel > 0.6) return '영리한 ' + k;
      return k;
    }
    /* 생태: 종 단위로 훑는 두 번의 패스 (칸별 집계 → 종별 갱신). 칸 안의 계산 순서는 칸 단위로 계산할 때와 같음 */
    ecology() {
      const NC = this.NC, S = this.species, n = S.length;
      if (!n) return;
      // 몸집(복잡도)이 비슷한 생물끼리 주로 경쟁: 미생물과 나무, 플랑크톤과 고래는 같은 자리를 다투지 않음
      let A = this._agg;
      if (!A || A.NC !== NC) {
        A = this._agg = { NC, Pc: new Float64Array(NC), food: new Float64Array(NC), Hh: new Float64Array(NC), X: new Float64Array(NC),
          P5: new Float64Array(NC * 5), H5: new Float64Array(NC * 5), X5: new Float64Array(NC * 5), graze: new Float64Array(NC), hunt: new Float64Array(NC) };
      }
      const { Pc, food, Hh, X, P5, H5, X5, graze, hunt } = A;
      Pc.fill(0); food.fill(0); Hh.fill(0); X.fill(0); P5.fill(0); H5.fill(0); X5.fill(0);
      for (let k = 0; k < n; k++) {
        const s = S[k], p = s.pop, cx = s.cx;
        if (!s.occOk) this.rebuildOcc(s);
        const occ = s.occ, no = s.nocc;
        if (s.troph === 0) {
          const chemo = s.energy === 'chemo';
          for (let i = 0; i < no; i++) { const c = occ[i], v = p[c]; if (v <= 0) continue; food[c] += v; if (chemo) Pc[c] += v; else P5[c * 5 + cx] += v; }
        } else if (s.troph === 1) {
          for (let i = 0; i < no; i++) { const c = occ[i], v = p[c]; if (v <= 0) continue; Hh[c] += v; H5[c * 5 + cx] += v; }
        } else {
          for (let i = 0; i < no; i++) { const c = occ[i], v = p[c]; if (v <= 0) continue; X[c] += v; X5[c * 5 + cx] += v; }
        }
      }
      for (let c = 0; c < NC; c++) {
        const fd = food[c], hh = Hh[c];
        graze[c] = hh > 0 && fd > 1e-6 ? Math.min(0.55, (hh * 0.6) / (fd + 0.03)) : 0;
        hunt[c] = hh > 1e-6 && X[c] > 0 ? Math.min(0.55, (X[c] * 0.6) / (hh + 0.03)) : 0;
      }
      const land = this.land, temp = this.temp, vent = this.vent, light = this.light, ice = this.ice, scorch = this.scorch;
      const O = this.o2, dark1 = 1 - this.darkness;
      for (let k = 0; k < n; k++) {
        const s = S[k], p = s.pop, cx = s.cx, troph = s.troph;
        const L = s.land ? 1 : 0;
        const chemo = troph === 0 && s.energy === 'chemo';
        const photoK = troph === 0 && !chemo ? (s.energy === 'oxy' ? 1.3 : 0.75) : 1;
        const topt = s.topt, ttol = s.ttol, k1 = 1.18 - ttol / 55;
        // 산소 관련 배율 (칸과 무관한 부분)
        let aerF = 1, anChemo = false;
        if (s.aerobic) aerF = troph === 0 && s.energy === 'oxy' ? 1 + Math.min(1, O) * 0.7 : O < 0.0008 ? 0.04 : 1 + Math.min(1, O) * 0.7;
        else if (s.energy === 'chemo') anChemo = true;
        else aerF = Math.exp(-O / 0.06);
        const anChemoE = anChemo ? Math.exp(-O / 0.03) : 0;
        const needF = O < OXY_NEED[cx] ? 0.12 : 1;
        let uvF = 1;
        if (L) { const u = Math.min(1, this.ozone / 0.45); uvF = u * u; }
        const cxF = 1 + 0.12 * cx;
        let c9a = 1, c9b = 1, c9c = 1;
        if (troph > 0) {
          c9a = (1 + 0.9 * s.intel * this.varIdx) * (1 - 0.16 * s.intel);
          if (L) c9b = (1 + 0.25 * s.manip * s.intel) * (1 - 0.05 * s.manip);
          c9c = 1 + 0.12 * s.social;
        }
        const arr = troph === 0 ? P5 : troph === 1 ? H5 : X5;
        const ovRow = OVL[cx];
        const occ = s.occ, no = s.nocc;
        for (let i = 0; i < no; i++) {
          const c = occ[i], v = p[c];
          if (v <= 0) continue;
          // 적합도: 기온, 빛·화학 에너지, 산소, 자외선, 복잡도, 지능
          let f = 0;
          const T = temp[c];
          if (land[c] === L && !(T > 115)) {
            const d = (T - topt) / ttol, x = d * d;
            if (x < EXP_MAX) { const fx = x * EXP_K, i = fx | 0; f = (EXPT[i] + (EXPT[i + 1] - EXPT[i]) * (fx - i)) * k1; }
            if (troph === 0) {
              if (chemo) f *= 0.12 + vent[c] * 1.1;
              else { f *= light[c] * (ice[c] ? 0.06 : 1) * dark1; f *= photoK; }
            }
            if (anChemo) f *= Math.max(anChemoE, 0.4 * vent[c]); else f *= aerF;
            f *= needF;
            if (L) { f *= uvF; if (scorch[c] > 0) f *= 0.3; }
            f *= cxF;
            if (troph > 0) { f *= c9a; if (L) f *= c9b; f *= c9c; }
          }
          let same = 0;
          if (!chemo) { const b = c * 5; for (let j = 0; j < 5; j++) { const a = arr[b + j]; if (a) same += a * ovRow[j]; } }
          let nv;
          if (troph === 0) nv = v + 0.6 * v * (f - (chemo ? Pc[c] : same)) - v * graze[c];
          else if (troph === 1) { const K = 0.35 * food[c] * f; nv = v + (0.5 * v * (K - same)) / (K + 0.01) - v * hunt[c]; }
          else { const K = 0.35 * Hh[c] * f; nv = v + (0.4 * v * (K - same)) / (K + 0.01); }
          p[c] = nv < 1e-5 ? 0 : nv > 2 ? 2 : nv;
        }
      }
    }
    nbrs() {
      // 이웃 칸 표 (동서는 둘러 감기, 남북 끝은 자기 자신)
      if (this._nb && this._nb.length === this.NC * 4) return this._nb;
      const W = this.W, H = this.H, nb = (this._nb = new Int32Array(this.NC * 4));
      for (let c = 0; c < this.NC; c++) {
        const x = c % W, y = (c / W) | 0;
        nb[c * 4] = y * W + ((x + 1) % W); nb[c * 4 + 1] = y * W + ((x - 1 + W) % W); nb[c * 4 + 2] = y > 0 ? c - W : c; nb[c * 4 + 3] = y < H - 1 ? c + W : c;
      }
      return nb;
    }
    /* 종마다 개체가 있는 칸 목록(오름차순)을 들고 다님: 빈 칸을 훑지 않아 빠르고, 계산 순서는 전체를 훑을 때와 같음.
       목록은 "개체가 있는 칸을 모두 포함"하기만 하면 됨 (값이 0이 된 칸이 남아 있어도 무방) */
    rebuildOcc(s) {
      if (!s.occ || s.occ.length !== this.NC) s.occ = new Int32Array(this.NC);
      let n = 0;
      const p = s.pop;
      for (let c = 0; c < this.NC; c++) if (p[c] > 0) s.occ[n++] = c;
      s.nocc = n; s.occOk = true;
    }
    disperse() {
      const NC = this.NC, land = this.land, nb = this.nbrs(), area = this.area;
      const out = this._out || (this._out = new Float32Array(NC)); // 종 사이에서는 항상 0으로 비워 둠
      const mark = this._mark || (this._mark = new Int32Array(NC));
      const tl = this._tl || (this._tl = new Int32Array(NC));
      let gen = this._gen || 0;
      for (const s of this.species) {
        if (!s.occOk) this.rebuildOcc(s);
        const d = s.troph === 0 ? (s.land ? 0.12 : 0.2) : Math.min(0.4, 0.12 + 0.07 * s.cx);
        const p = s.pop, L = s.land ? 1 : 0, occ = s.occ, no = s.nocc;
        gen++;
        let nt = 0;
        for (let i = 0; i < no; i++) {
          const c = occ[i], v = p[c];
          if (mark[c] !== gen) { mark[c] = gen; tl[nt++] = c; }
          if (v <= 0) continue;
          const q = v * d * 0.25;
          out[c] += v * (1 - d);
          const nb0 = nb[c * 4], nb1 = nb[c * 4 + 1], nb2 = nb[c * 4 + 2], nb3 = nb[c * 4 + 3];
          if (land[nb0] === L) { out[nb0] += q; if (mark[nb0] !== gen) { mark[nb0] = gen; tl[nt++] = nb0; } } else out[c] += q;
          if (land[nb1] === L) { out[nb1] += q; if (mark[nb1] !== gen) { mark[nb1] = gen; tl[nt++] = nb1; } } else out[c] += q;
          if (land[nb2] === L) { out[nb2] += q; if (mark[nb2] !== gen) { mark[nb2] = gen; tl[nt++] = nb2; } } else out[c] += q;
          if (land[nb3] === L) { out[nb3] += q; if (mark[nb3] !== gen) { mark[nb3] = gen; tl[nt++] = nb3; } } else out[c] += q;
        }
        // 손댄 칸만 오름차순으로 정리. 서식지가 바뀐 칸(해수면 변화)은 비움
        const touched = tl.subarray(0, nt).sort();
        let tot = 0, nn = 0;
        for (let j = 0; j < nt; j++) {
          const c = touched[j];
          let v = out[c];
          out[c] = 0;
          if (v > 0 && land[c] !== L) v = 0;
          const pv = v < 1e-5 ? 0 : v;
          p[c] = pv;
          tot += v * area[c];
          if (pv > 0) occ[nn++] = c;
        }
        s.nocc = nn;
        s.total = tot / this.areaSum;
        if (s.total > s.maxTotal) s.maxTotal = s.total;
      }
      this._gen = gen;
    }
    pickCell(s) {
      let tot = 0;
      for (let c = 0; c < this.NC; c++) tot += s.pop[c];
      if (tot <= 0) return -1;
      let r = this.rng.next() * tot;
      for (let c = 0; c < this.NC; c++) { r -= s.pop[c]; if (r <= 0) return c; }
      return -1;
    }
    speciate() {
      const r = this.rng, dt = this.dt;
      // 진화의 속도(시작 조건): 새 종이 생길 때 큰 혁신이 일어날 확률과 형질이 한 방향으로 나아가는 폭을 몇 배로.
      // 종이 갈라지는 빈도 자체는 그대로 둠 (빈도를 올리면 개체군이 잘게 쪼개져 오히려 생물이 무너짐)
      const k = this.mutMul, pk = (p) => Math.min(0.9, p * k);
      const cur = this.species.slice();
      for (const s of cur) {
        if (s.total <= 0 || !s.pop) continue;
        const rate = 0.05 * dt * this.mutBoost * (0.3 + 0.7 * Math.min(1, s.total * 8)) * (s.troph > 0 ? 1 + 0.5 * s.cx : 1);
        if (!r.chance(rate)) continue;
        const c = this.pickCell(s);
        if (c < 0) continue;
        const ch = {
          troph: s.troph, energy: s.energy, aerobic: s.aerobic, cx: s.cx, land: s.land, landAdapt: s.landAdapt,
          topt: s.topt + r.normal() * 5, ttol: WS.clamp(s.ttol + r.normal() * 2.5, 4, 40), size: WS.clamp(s.size + r.normal() * 0.05, 0, 1),
          intel: s.intel, manip: s.manip, social: s.social,
        };
        const O = this.o2;
        const notes = [];
        // 큰 혁신들 (드묾)
        if (ch.troph === 0 && ch.energy === 'chemo' && r.chance(pk(0.12))) { ch.energy = 'photo'; notes.push('photo'); }
        else if (ch.troph === 0 && ch.energy === 'photo' && r.chance(pk(0.08))) { ch.energy = 'oxy'; notes.push('oxy'); }
        else if (ch.troph === 0 && ch.cx <= 1 && !ch.land && r.chance(pk(0.04))) { ch.troph = 1; ch.energy = ''; notes.push('consumer'); }
        else if (ch.troph === 1 && r.chance(pk(0.05))) { ch.troph = 2; notes.push('predator'); }
        if (!ch.aerobic && O > 0.002 && r.chance(pk(0.1))) { ch.aerobic = true; notes.push('aerobic'); }
        const canCx = ch.troph > 0 || ch.energy === 'oxy';
        if (!canCx) { /* 화학합성·무산소 광합성 미생물은 단세포로 남음 */ }
        else if (ch.cx === 0 && ch.aerobic && O > 0.003 && r.chance(pk(0.02))) { ch.cx = 1; notes.push('euk'); }
        else if (ch.cx === 1 && O > 0.008 && r.chance(pk(0.02))) { ch.cx = 2; notes.push('multi'); }
        else if (ch.cx === 2 && O > 0.03 && r.chance(pk(0.03))) { ch.cx = 3; notes.push('complex'); }
        else if (ch.cx === 3 && ch.troph > 0 && O > 0.08 && r.chance(pk(0.08))) { ch.cx = 4; notes.push('vert'); }
        // 지성·손재주·사회성: 복잡한 동물에서 무작위로 흔들리고, 선택이 방향을 정함
        if (ch.troph > 0 && ch.cx >= 3) {
          ch.intel = WS.clamp(ch.intel + r.normal() * 0.05 + (ch.cx >= 4 ? 0.02 : 0.006) * k, 0, 0.25 + 0.19 * ch.cx);
          ch.social = WS.clamp(ch.social + r.normal() * 0.05 + 0.004 * k + 0.02 * ch.intel * k, 0, 1);
          if (ch.land && ch.cx >= 4) ch.manip = WS.clamp(ch.manip + r.normal() * 0.05 + 0.01 * k + 0.025 * ch.intel * k, 0, 1);
        }
        // 육상 진출
        let landing = false;
        if (!ch.land && ch.cx >= 2 && (ch.troph === 0 || ch.cx >= 3)) {
          ch.landAdapt = WS.clamp(ch.landAdapt + r.range(0, 0.3) * k, 0, 1);
          const plantsOnLand = this.species.some((q) => q.land && q.troph === 0 && q.total > 0.002);
          if (ch.landAdapt > 0.85 && this.ozone > 0.45 && (ch.troph === 0 || plantsOnLand)) landing = true;
        }
        let cell = c;
        if (landing) {
          const W = this.W, x = c % W, y = (c / W) | 0;
          const nbs = [y * W + ((x + 1) % W), y * W + ((x - 1 + W) % W), y > 0 ? c - W : c, y < this.H - 1 ? c + W : c].filter((q) => this.land[q]);
          if (!nbs.length) landing = false;
          else { cell = r.pick(nbs); ch.land = true; notes.push(ch.troph === 0 ? 'landplant' : 'landanimal'); }
        }
        // 자리가 다 차면 가장 드문 종이 밀려남
        if (this.species.length >= this.maxSp) {
          // 갓 생긴 종은 잠시 보호. 새 종이 쏟아지는 동안(우주선 폭풍)에는 보호 기간도 그만큼 짧게
          // (그러지 않으면 오래 버틴 번성 종만 후보가 되어 밀려나, 생물량이 무너짐)
          const minAge = 25 / Math.max(1, this.mutBoost);
          // 같은 서식지·같은 먹이 단계의 가장 드문 종이 자리를 내줌
          const cand = (pred) => { let b = null; for (const q of this.species) if (q !== s && !q.sapient && this.t - q.born > minAge && pred(q) && (!b || q.total < b.total)) b = q; return b; };
          const w = cand((q) => q.land === ch.land && q.troph === ch.troph) || cand((q) => q.land === ch.land) || cand(() => true);
          // 내줄 자리가 없으면 새 종은 자리를 잡지 못함 (종 수 상한을 지킴)
          if (!w) continue;
          // 밀려난 종은 대멸종 집계(this.extinctions)에 넣지 않음: 자연스러운 교체이지 갑작스러운 죽음이 아님
          w.extinct = this.t; w.pop = null; w.occ = null; w.total = 0; this.species.splice(this.species.indexOf(w), 1);
        }
        const child = this.newSpecies(ch, s, notes.length > 0);
        if (landing) child.pop[cell] = 0.05;
        else { const take = s.pop[c] * 0.3; s.pop[c] -= take; child.pop[c] = take; }
        child.total = 1e-4;
        this.announce(child, notes);
      }
    }
    announce(sp, notes) {
      this.about(sp, () => {
        const kn = this.kindName(sp);
        for (const nt of notes) {
          if (this.firsts[nt]) continue;
          this.firsts[nt] = true;
          const msg = {
            photo: `${sp.name}: 햇빛으로 양분을 만드는 광합성 세균이 나타났습니다.`,
            oxy: `${sp.name}: 물을 쪼개 산소를 내뿜는 광합성(남세균)이 나타났습니다.`,
            consumer: `${sp.name}: 다른 생물을 먹고 사는 생물이 처음 등장했습니다.`,
            predator: `${sp.name}: 포식자를 잡아먹는 포식자가 생겼습니다. 먹이 사슬이 길어집니다.`,
            aerobic: `${sp.name}: 산소로 호흡하는 생물이 나타났습니다.`,
            euk: `${sp.name}: 세포 안에 다른 세포를 품은 진핵생물이 탄생했습니다.`,
            multi: `${sp.name}: 세포들이 모여 한 몸을 이루는 다세포 생물이 나타났습니다.`,
            complex: `${sp.name}: 조직과 기관을 갖춘 복잡한 생물(${kn})이 나타났습니다.`,
            vert: `${sp.name}: 신경계와 골격을 갖춘 큰 동물(${kn})이 등장했습니다.`,
            landplant: `${sp.name}: 식물이 처음으로 바다를 떠나 땅에 뿌리내렸습니다.`,
            landanimal: `${sp.name}: 동물이 땅 위로 올라왔습니다.`,
          }[nt];
          const ms = { oxy: 'oxy', euk: 'euk', multi: 'multi', landplant: 'landplant', landanimal: 'landanimal' }[nt];
          if (ms) this.reach(ms, msg); else if (nt === 'complex' && sp.troph > 0) this.reach('cambrian', msg); else this.log(msg);
        }
        if (sp.troph > 0 && sp.cx >= 3 && !this.reached.cambrian) this.reach('cambrian', `${sp.name}: 조직과 기관을 갖춘 복잡한 동물(${kn})이 나타났습니다.`);
      });
    }
    // 뚜렷한 재해가 없을 때의 대멸종 원인: 최근의 기온 변화·산소 증가·빙하로 짐작
    quietCause() {
      const h = this.tHist, n = h.length;
      let lo = Infinity, hi = -Infinity;
      for (let i = Math.max(0, n - 8); i < n; i++) { if (h[i] < lo) lo = h[i]; if (h[i] > hi) hi = h[i]; }
      if (hi - lo > 5) return `급격한 기후 변화, 기온이 ${Math.round(hi - lo)}°C 오르내림`;
      if (this.reached.goe && this.t - this.reached.goe.v / 1e6 < 80) return '늘어난 산소를 견디지 못한 생물의 쇠퇴';
      if (this.iceFrac > 0.4) return '넓어진 빙하';
      return '먹이와 서식지를 둘러싼 경쟁';
    }
    cullExtinct() {
      const keep = [];
      for (const s of this.species) {
        if ((s.total < 3e-6 && this.t - s.born > 6) || s.total <= 0 || (s.total < 1e-4 && this.t - s.born > 40)) {
          s.extinct = this.t; s.pop = null; s.occ = null;
          this.extinctions.push(this.t);
          if (s.sapient) this.about(s, () => this.log(`${s.name}(지성 종)이 사라졌습니다.`, 'disaster'));
        } else keep.push(s);
      }
      this.species = keep;
      while (this.extinctions.length && this.extinctions[0] < this.t - 8) this.extinctions.shift();
      const died = this.extinctions.length;
      if (died >= 6 && died / (died + keep.length) > 0.33 && this.t - this.lastMassExt > 25) {
        this.lastMassExt = this.t;
        const cat = this.lastCat && this.t - this.lastCat.t < 8 ? this.lastCat : null;
        const cause = cat ? cat.kind : this.quietCause();
        const pct = Math.round((died / (died + keep.length)) * 100);
        // 지구의 '첫 대멸종'(4.45억 년 전)과 견줄 수 있도록, 복잡한 동물이 나타난 뒤의 대멸종만 이정표로 셈
        if (this.reached.cambrian) {
          const txt = `대멸종: 짧은 기간에 종의 ${pct}%가 사라졌습니다 (원인: ${cause}).`;
          this.reach('massext', txt) || this.log(txt, 'disaster');
          if (cat && cat.kind.startsWith('소행성')) this.reach('impactext', `소행성 충돌이 지배적이던 생물들을 쓸어냈습니다. 살아남은 무리가 빈자리를 차지할 것입니다.`);
        } else this.log(`미생물 세계의 대멸종: 짧은 기간에 종의 ${pct}%가 사라졌습니다 (원인: ${cause}).`, 'disaster');
      }
      if (this.reached.life && !keep.length && !this.deadLogged) { this.deadLogged = true; this.log('모든 생명이 사라졌습니다. 행성은 다시 불모지가 되었습니다.', 'disaster'); }
      if (keep.length) this.deadLogged = false;
    }

    /* ----- 생명의 기원 ----- */
    abiogenesis() {
      if (this.Tg > 100 || this.oceanFrac < 0.02) return;
      let sum = 0;
      for (let c = 0; c < this.NC; c++) {
        if (this.land[c] || this.ice[c]) continue;
        const T = this.temp[c];
        if (T < 0 || T > 95) continue;
        sum += (0.15 + this.vent[c]) * (1 + this.soup[c] * 40);
      }
      const p = 1 - Math.exp(-this.abioRate * 6e-6 * sum * this.dt);
      if (!this.rng.chance(p)) return;
      // 가장 그럴듯한 칸에서 시작
      let best = -1, bv = -1;
      for (let k = 0; k < 40; k++) {
        const c = this.rng.int(0, this.NC - 1);
        if (this.land[c] || this.temp[c] < 0 || this.temp[c] > 95) continue;
        const v = (0.15 + this.vent[c]) * (1 + this.soup[c] * 40) * this.rng.next();
        if (v > bv) { bv = v; best = c; }
      }
      // 종 수 상한이 차 있으면 새 생명은 자리를 잡지 못함 (난수는 이미 다 쓴 뒤라 흐름은 같음)
      if (best < 0 || this.species.length >= this.maxSp) return;
      const sp = this.newSpecies({ topt: WS.clamp(this.temp[best], 20, 80), ttol: 20 });
      sp.pop[best] = 0.05;
      sp.total = 0.05 / this.NC;
      const again = this.reached.life;
      this.about(sp, () => {
        if (!again) this.reach('life', `${sp.name}: 뜨거운 열수구 근처에서 스스로 복제하는 첫 생명이 나타났습니다.`);
        else this.log(`${sp.name}: 생명이 다시 한 번 무생물에서 태어났습니다.`, 'milestone');
      });
    }

    /* ----- 재해 ----- */
    impact(D, c) {
      const r = this.rng;
      if (c === undefined) c = r.int(0, this.NC - 1);
      const W = this.W, x0 = c % W, y0 = (c / W) | 0;
      const rad = Math.max(0, Math.round(D / 25));
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const y = y0 + dy;
        if (y < 0 || y >= this.H) continue;
        const cc = y * W + ((x0 + dx + W) % W);
        for (const s of this.species) s.pop[cc] = 0;
        this.scorch[cc] = 3;
      }
      const kill = WS.clamp((D - 6) / 70, 0, 0.97);
      if (kill > 0) {
        for (const s of this.species) {
          const k = Math.min(0.995, kill * (s.troph === 0 ? (s.land ? 1 : 0.8) : 1 + s.size * 0.6 + s.cx * 0.08) * (s.energy === 'chemo' ? 0.2 : 1));
          for (let q = 0; q < this.NC; q++) if (s.pop[q]) s.pop[q] *= 1 - k * r.range(0.6, 1);
        }
        this.winter += D / 3;
        this.darkness = Math.min(0.9, D / 60);
      }
      if (D >= 400) { this.Tg += 300; for (const s of this.species) if (s.energy !== 'chemo') s.pop.fill(0); }
      // 넓은 지역의 생물을 실제로 죽일 만한 충돌만 대멸종의 원인 후보로 기억 (작은 운석은 한두 칸만 태움)
      if (D >= 25) this.lastCat = { t: this.t, kind: `소행성 충돌 (지름 ${Math.round(D)} km)` };
      if (D >= 15 || this.fxAll) {
        const rec = { n: ++this.impactN, t: this.t, D, c, god: !!this.fxAll };
        this.impacts.push(rec);
        if (this.impacts.length > 16) this.impacts.shift();
        // 충돌 장면으로 보여 줄 것: 연대기에 재난으로 적히는 크기이거나 관찰자가 떨어뜨린 것. 작은 것까지 보여 주면 장면이 끊이지 않음
        if (D >= 40 || this.fxAll) { this.bigImpacts.push(rec); if (this.bigImpacts.length > 8) this.bigImpacts.shift(); }
        if (!this.headless) {
          const p = this.cellXY(c);
          this.addFx({ type: 'flash', x: p[0], y: p[1], r: 0.02 + D / 1500, life: 1.6, color: [255, 210, 150] });
          this.addFx({ type: 'ring', x: p[0], y: p[1], r: 0.04 + D / 600, r0: 3, life: 2.2, color: [255, 150, 90] });
        }
      }
      return c;
    }
    cellXY(c) { return [((c % this.W) + 0.5) / this.W, (((c / this.W) | 0) + 0.5) / this.H]; }
    volcano(c, big) {
      this.lipBoost += big ? 2.2 : 1.2;
      this.co2 *= big ? 2.2 : 1.5;
      const W = this.W, x0 = c % W, y0 = (c / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) {
        const y = y0 + dy;
        if (y < 0 || y >= this.H) continue;
        const cc = y * W + ((x0 + dx + W) % W);
        for (const s of this.species) s.pop[cc] *= 0.1;
        this.scorch[cc] = 2;
      }
      if (big) for (const s of this.species) if (!s.land && s.aerobic) s.pop.forEach((v, q) => { if (v) s.pop[q] = v * this.rng.range(0.3, 0.8); });
      this.lastCat = { t: this.t, kind: big ? '초거대 화산 분출과 바다의 산소 고갈' : '화산 분출' };
      if (!this.headless) { const p = this.cellXY(c); this.addFx({ type: 'flash', x: p[0], y: p[1], r: 0.05, life: 2, color: [255, 120, 60] }); }
    }
    // 초거대 화산 분출은 긴 역사에서 수십 번 일어나므로, 전부 재난으로 적으면 이정표가 묻힘.
    // 생명이 생긴 뒤 첫 분출만 재난으로 알리고, 나머지는 10억 년에 한 번 일반 기록으로 합쳐 적음.
    // 대멸종으로 이어진 분출은 대멸종 기록이 원인으로 이름을 밝힘. (기록만 다룰 뿐 난수·세계 상태는 건드리지 않음)
    noteLip() {
      this.lipPending++;
      if (this.reached.life && !this.lipAlarmed) {
        this.lipAlarmed = true; this.lipPending = 0; this.lipLogT = this.t;
        this.log('대륙 하나를 덮는 초거대 화산 분출이 시작되었습니다. 이산화탄소가 치솟습니다.', 'disaster');
      } else if (this.t - this.lipLogT >= 1000) {
        const n = this.lipPending;
        this.log(this.lipLogT < 0 ? '행성에서 초거대 화산이 터져 이산화탄소가 치솟았습니다.' : n > 1 ? `지난 ${WS.fmtYears((this.t - this.lipLogT) * 1e6)} 동안 초거대 화산 분출이 ${n}번 더 있었습니다. 그때마다 이산화탄소가 치솟고 기후가 흔들렸습니다.` : '초거대 화산 분출이 또 일어나 이산화탄소가 치솟았습니다.');
        this.lipPending = 0; this.lipLogT = this.t;
      }
    }
    impactRate() { return 0.04 * (1 + 60 * Math.exp(-this.t / 160)) * (this.P.giant ? 1 : 2.2) * this.impactMul; }
    hazards() {
      const r = this.rng, t = this.t, dt = this.dt;
      const lam = this.impactRate();
      const n = r.poisson(lam * dt);
      for (let k = 0; k < n; k++) {
        const D = 5 * Math.pow(r.next(), -0.5);
        this.impact(D);
        if (D >= 40) this.log(`지름 ${Math.round(D)} km 소행성이 충돌했습니다.`, 'disaster');
      }
      if (r.chance(0.005 * dt * Math.min(1.5, this.tect() * 1.5))) {
        const c = r.int(0, this.NC - 1);
        this.volcano(c, true);
        this.noteLip();
      }
      if (r.chance(0.0004 * dt) && this.reached.life) {
        this.o2 *= 0.9; this.ozone *= 0.3;
        this.lastCat = { t, kind: '감마선 폭발' };
        this.log('가까운 별의 감마선 폭발이 오존층을 벗겨 냈습니다.', 'disaster');
      }
      for (let c = 0; c < this.NC; c++) { if (this.scorch[c] > 0) this.scorch[c] -= dt; this.soup[c] *= 0.85; }
      this.darkness *= 0.3;
      if (this.mutUntil < t) this.mutBoost = 1;
    }

    /* ----- 지성과 문명 ----- */
    sapience() {
      for (const s of this.species) {
        if (s.sapient || !s.land || s.cx < 4 || s.troph === 0) continue;
        if (s.intel >= 0.85 && s.manip >= 0.5 && s.social >= 0.4 && s.total > 0.001) {
          s.sapient = true;
          const prev = this.sapientSp;
          this.sapientSp = s;
          this.sapT = this.t;
          this.about(s, () => {
            if (this.reach('sapient', `${s.name}: 도구를 만들고 서로 말을 주고받는 지성 종이 나타났습니다.`)) return;
            // 두 번째 지성 종: 이제 이 종이 문명에 가장 가까운 후보임을 알림 (조용히 바뀌지 않게)
            this.log(prev && !prev.extinct ? `${s.name}: ${prev.name}에 이어 또 하나의 지성 종이 나타났습니다. 이제 이 종이 문명을 이룰 가장 유력한 후보입니다.` : `${s.name}: 새로운 지성 종이 나타났습니다. 이제 이 종이 문명을 이룰 후보입니다.`, 'milestone');
          });
        }
      }
      const s = this.sapientSp;
      if (s && !s.extinct && !this.reached.civ && this.t - this.sapT >= 0.3 && this.varIdx < 0.9 && this.rng.chance(0.25 * this.dt)) {
        this.about(s, () => {
          this.reach('civ', `${josa(s.name, '이', '가')} 씨앗을 심고 마을을 이루었습니다. 문명이 시작됩니다.`);
          this.end('문명의 탄생', `${this.P.name}에서 ${josa(s.name, '이', '가')} 농경과 정착을 시작했습니다. 이제 이 종의 역사를 따라갈 수 있습니다.`, OUTCOME_LABEL.civ);
        });
      }
    }

    tick() {
      const sap = this.sapientSp;
      // 지성 종이 막 나타났을 때만 시간을 잘게 쪼갬 (사라졌거나 오래 지나면 원래 속도로)
      this.dt = sap && !sap.extinct && !this.reached.civ && this.t - this.sapT < 5 ? 0.1 : this.maxCx() >= 3 ? 1 : this.reached.life ? 2 : 3;
      this.t += this.dt;
      if (this.t - this.terrainT >= (this.lite ? 60 : 30) || (this.Tg < 100 && this.oceanFrac === 0) || (this.Tg > 100 && this.oceanFrac > 0)) this.terrain();
      else if (this.steps % 5 === 0) { this.seaLevelFromOcean(); this.terrainDirty = true; }
      this.climate();
      if (this.Tg < 100 && this.oceanFrac > 0.02) this.reach('ocean', '행성이 식으며 수증기가 비가 되어 내렸습니다. 첫 바다가 생겼습니다.');
      if (this.iceFrac > 0.85) {
        if (!this.inSnowball) { this.inSnowball = true; this.reach('snowball', '얼음이 적도까지 덮었습니다. 눈덩이 행성이 되었습니다.') || this.log('행성이 다시 얼음에 뒤덮였습니다.', 'disaster'); this.lastCat = { t: this.t, kind: '전 지구 빙결' }; }
      } else if (this.inSnowball && this.iceFrac < 0.6) { this.inSnowball = false; this.log('화산이 뿜은 이산화탄소가 쌓여 얼음이 녹기 시작했습니다.'); }
      if (this.R <= 0 && this.o2 > 0.001) this.reach('goe', '산소를 먹어 치우던 철과 화산 가스가 바닥났습니다. 대기에 산소가 쌓입니다 (산소 대폭발).');
      this.hazards();
      if (!this.species.length) this.abiogenesis();
      else if (this.rng.chance(0.02)) this.abiogenesis();
      this.ecology();
      this.disperse();
      this.speciate();
      this.cullExtinct();
      this.sapience();
      this.biomass = this.species.reduce((s, q) => s + q.total, 0);
      this.checkEnd();
    }
    maxCx() { let m = -1; for (const s of this.species) if (s.cx > m) m = s.cx; return m; }
    maxIntel() { let m = 0; for (const s of this.species) if (s.troph > 0 && s.intel > m) m = s.intel; return m; }
    checkEnd() {
      if (this.ended) return;
      if (this.reached.ocean && this.Tg > 100 && this.t > 1500) {
        this.oceanLossT = (this.oceanLossT || 0) + this.dt;
        if (this.oceanLossT > 60) { this.boiled = true; this.end('끓어 버린 바다', '별이 밝아지며 온실 효과가 폭주해 바다가 증발했습니다.', OUTCOME_LABEL.boiled); return; }
      }
      if (this.until !== null && this.timeValue() >= this.until) {
        const today = this.P.kind === 'earth' && Math.abs(this.t - EARTH_NOW) < 3;
        this.end('관측 종료', (today ? '오늘의 지구와 같은 나이에 이르렀습니다. ' : `정해 둔 관측 기간(${WS.fmtYears(this.until)})이 끝났습니다. `) + this.summaryText(), this.summaryOutcome());
        return;
      }
      if (this.t >= this.tEnd) {
        const reason = this.tEnd < 6200 ? '중심별이 수명을 다해 갑니다.' : this.P.starLife > 13000 ? '이 별은 아직 한참 더 타지만, 여기서 관측을 마칩니다.' : '별이 밝아져 이제 생명이 버티기 어려워집니다.';
        this.end('관측 종료', reason + ' ' + this.summaryText(), this.summaryOutcome());
      }
    }
    summaryOutcome() { return OUTCOME_LABEL[classify(this)]; }
    summaryText() {
      const R = this.reached;
      if (!R.life) return '이 행성에서는 끝내 생명이 생기지 않았습니다.';
      return `생명이 나타난 뒤 지금까지 ${this.all.length.toLocaleString('ko-KR')}종이 나타났고 ${this.species.length}종이 살아 있습니다.`;
    }
  }

  /* ---------- 결말 분류 (실험용) ---------- */
  const OUTCOMES = [
    { key: 'nolife', label: '생명이 생기지 않음', color: '#7d8597', desc: '바다는 있었지만 무생물에서 생명이 끝내 태어나지 않았습니다.' },
    { key: 'dead', label: '생명이 생겼다 사라짐', color: '#a0525a', desc: '한때 생명이 있었지만 관측이 끝날 때는 모두 사라졌습니다.' },
    { key: 'boiled', label: '바다가 끓어 버림', color: '#e4573a', desc: '별이 밝아지거나 온실 효과가 폭주해 바다가 증발했습니다.' },
    { key: 'snowball', label: '얼어붙은 행성', color: '#b9d6ea', desc: '관측이 끝날 때 얼음이 적도까지 덮여 있었습니다.' },
    { key: 'microbes', label: '미생물에 머묾', color: '#b58a5a', desc: '생명은 생겼지만 끝까지 단세포 미생물뿐이었습니다.' },
    { key: 'simple', label: '단순한 다세포·진핵생물까지', color: '#5fb3a8', desc: '진핵생물이나 단순한 다세포 생물(다세포 조류, 이끼류)까지 나아갔습니다.' },
    { key: 'complex', label: '복잡한 동식물까지', color: '#7cc46e', desc: '조직과 기관을 갖춘 동물이나 식물(해조 숲, 관다발 식물)까지 나타났습니다.' },
    { key: 'sapient', label: '지성은 생겼으나 문명은 없음', color: '#d8a85b', desc: '도구를 쓰는 지성 종이 나타났지만 아직 농경과 정착에는 이르지 못했습니다.' },
    { key: 'civ', label: '지적 생명이 문명을 이룸', color: '#f1cb86', desc: '지성 종이 농경과 정착을 시작해 문명을 이루었습니다.' },
  ];
  const OUTCOME_LABEL = {};
  OUTCOMES.forEach((o) => { OUTCOME_LABEL[o.key] = o.label; });
  function classify(s) {
    const R = s.reached;
    if (R.civ) return 'civ';
    if (s.boiled || (R.ocean && s.Tg > 100)) return 'boiled';
    if (s.inSnowball) return 'snowball';
    if (R.life && !s.species.length) return 'dead';
    if (R.sapient) return 'sapient';
    // 조직·기관을 갖춘 생물(cx 3: 복잡한 동물, 해조 숲, 관다발 식물)이 한 번이라도 나타났으면 '복잡한 동식물'. cx 지표와 같은 기준
    if (R.landanimal || R.cambrian || (s.firsts && s.firsts.complex)) return 'complex';
    if (R.multi || R.euk) return 'simple';
    if (R.life) return 'microbes';
    return 'nolife';
  }

  /* ======================================================================
     그리기: 화면 전용 상태는 s._vis에 둠 (시뮬레이션 계산에는 쓰지 않음)
     ====================================================================== */
  const TW = 480, TH = 240;
  const smooth = (a, b, x) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
  /* 지도 위치: 해설 카드·범례(app.safe)가 덮는 띠를 피해 가운데에 두되, 지도를 14% 넘게 줄이지는 않음 */
  function mapRect(W, H, safe) {
    const padX = W < 520 ? 8 : 16, top0 = W < 520 ? 40 : 48, bot0 = 14;
    const st = Math.max(top0, safe && isFinite(safe.top) ? safe.top + 6 : 0), sb = Math.max(bot0, safe && isFinite(safe.bottom) ? safe.bottom + 6 : 0);
    const full = Math.min(W - 2 * padX, (H - top0 - bot0) * 2);
    const fit = Math.min(W - 2 * padX, (H - st - sb) * 2);
    const mw = Math.round(Math.max(160, fit, full * 0.86)), mh = Math.round(mw / 2);
    const y0 = WS.clamp(st + (H - st - sb - mh) / 2, Math.min(top0, H - bot0 - mh), Math.max(top0, H - bot0 - mh));
    return { x0: Math.round((W - mw) / 2), y0: Math.round(y0), w: mw, h: mh };
  }
  // pick()은 app을 받지 않으므로 마지막으로 그린 지도 위치를 기억해 둠
  function lastRect(s, W, H) {
    const L = s._vis && s._vis.rect;
    return L && L.W === W && L.H === H ? L.R : mapRect(W, H);
  }
  function visOf(s) {
    if (s._vis) return s._vis;
    const V = (s._vis = { elev: null, elevT: null, job: null, paint: {}, tex: {}, img: {}, spr: null, sprAt: -1, sprTs: 0 });
    V.s2 = new Float32Array(TH);
    for (let y = 0; y < TH; y++) { const lat = (0.5 - (y + 0.5) / TH) * Math.PI; V.s2[y] = Math.sin(lat) ** 2; }
    // 셀 격자 → 텍스처 픽셀 쌍선형 보간 표
    V.bx0 = new Int32Array(TW); V.bx1 = new Int32Array(TW); V.bwx = new Float32Array(TW);
    for (let x = 0; x < TW; x++) {
      const fx = ((x + 0.5) * s.W) / TW - 0.5, x0 = Math.floor(fx);
      V.bwx[x] = fx - x0; V.bx0[x] = (x0 + s.W) % s.W; V.bx1[x] = (x0 + 1 + s.W) % s.W;
    }
    V.by0 = new Int32Array(TH); V.by1 = new Int32Array(TH); V.bwy = new Float32Array(TH);
    for (let y = 0; y < TH; y++) {
      const fy = ((y + 0.5) * s.H) / TH - 0.5, y0 = Math.floor(fy);
      V.bwy[y] = Math.max(0, Math.min(1, fy - y0)); V.by0[y] = Math.max(0, Math.min(s.H - 1, y0)); V.by1[y] = Math.max(0, Math.min(s.H - 1, y0 + 1));
      if (y0 < 0) V.bwy[y] = 0;
    }
    return V;
  }
  /* 고해상도 고도: 대륙이 움직이면 몇 프레임에 나눠 다시 계산 */
  function elevRows(s, V, job, budget) {
    const t0 = performance.now(), tG = job.t / 1000, E = job.buf;
    while (job.y < TH) {
      const y = job.y, lat = (0.5 - (y + 0.5) / TH) * Math.PI;
      for (let x = 0; x < TW; x++) E[y * TW + x] = s.elevAt(((x + 0.5) / TW) * Math.PI * 2 - Math.PI, lat, tG);
      job.y++;
      if (budget && performance.now() - t0 > budget) break;
    }
    if (job.y < TH) return false;
    // 음영(언덕 그늘): 북서쪽에서 빛이 온다고 봄
    const SH = job.shade;
    for (let y = 0; y < TH; y++) {
      const ym = Math.max(0, y - 1), yp = Math.min(TH - 1, y + 1);
      for (let x = 0; x < TW; x++) {
        const xm = (x - 1 + TW) % TW, xp = (x + 1) % TW;
        const g = E[y * TW + xp] - E[y * TW + xm] + E[yp * TW + x] - E[ym * TW + x];
        SH[y * TW + x] = WS.clamp(1 + g * 9, 0.62, 1.4);
      }
    }
    return true;
  }
  function ensureElev(s, V, budget = 2) {
    if (!V.elev) {
      // 첫 프레임: 1/4 해상도로 빨리 만들어 부드럽게 늘려 쓰고, 이후 프레임에서 원래 해상도로 다시 계산
      const F = 4, hw = TW / F, hh = TH / F, tG = s.terrainT / 1000, E = new Float32Array(TW * TH), half = new Float32Array(hw * hh);
      for (let y = 0; y < hh; y++) {
        const lat = (0.5 - (y + 0.5) / hh) * Math.PI;
        for (let x = 0; x < hw; x++) half[y * hw + x] = s.elevAt(((x + 0.5) / hw) * Math.PI * 2 - Math.PI, lat, tG);
      }
      for (let y = 0; y < TH; y++) {
        const fy = Math.max(0, Math.min(hh - 1, (y + 0.5) / F - 0.5)), y0 = Math.floor(fy), y1 = Math.min(hh - 1, y0 + 1), wy = fy - y0;
        for (let x = 0; x < TW; x++) {
          const fx = (x + 0.5) / F - 0.5, xf = Math.floor(fx), wx = fx - xf, x0 = (xf + hw) % hw, x1 = (xf + 1 + hw) % hw;
          E[y * TW + x] = (half[y0 * hw + x0] * (1 - wx) + half[y0 * hw + x1] * wx) * (1 - wy) + (half[y1 * hw + x0] * (1 - wx) + half[y1 * hw + x1] * wx) * wy;
        }
      }
      const job = { t: s.terrainT, y: TH, buf: E, shade: new Float32Array(TW * TH) };
      elevRows(s, V, job, 0);
      V.elev = job.buf; V.shade = job.shade; V.elevT = job.t; V.lowres = true;
      return;
    }
    if (!V.job && (V.elevT !== s.terrainT || V.lowres)) { V.job = { t: s.terrainT, y: 0, buf: V.spare || new Float32Array(TW * TH), shade: V.spareSh || new Float32Array(TW * TH) }; V.lowres = false; }
    if (V.job && elevRows(s, V, V.job, budget)) {
      V.spare = V.elev; V.spareSh = V.shade;
      V.elev = V.job.buf; V.shade = V.job.shade; V.elevT = V.job.t; V.job = null;
      V.force = true;
    }
  }
  /* 칸 단위 생물 분포 요약 (그림용) */
  function lifeFields(s) {
    const NC = s.NC, F = { moss: new Float32Array(NC), forest: new Float32Array(NC), oxy: new Float32Array(NC), photo: new Float32Array(NC), chemo: new Float32Array(NC) };
    for (const q of s.species) {
      if (q.troph !== 0 || !q.pop) continue;
      const p = q.pop, dst = q.land ? (q.cx >= 3 ? F.forest : F.moss) : q.energy === 'chemo' ? F.chemo : q.energy === 'photo' ? F.photo : F.oxy;
      for (let c = 0; c < NC; c++) if (p[c] > 0) dst[c] += p[c];
    }
    F.scorch = Float32Array.from(s.scorch);
    return F;
  }
  // 색 (0..255)
  const COL = {
    shelf: [62, 142, 152], mid: [24, 80, 122], deep: [10, 28, 62], iron: [58, 98, 76], seaIce: [214, 228, 240],
    rockOld: [84, 74, 70], rockLow: [118, 106, 92], rockHigh: [170, 164, 156], sand: [196, 168, 122],
    moss: [124, 138, 74], jungle: [32, 104, 54], temperate: [58, 128, 60], boreal: [40, 90, 74], tundra: [150, 158, 146], snow: [238, 242, 248],
    bloomOxy: [44, 168, 128], bloomPhoto: [140, 86, 172], chemo: [200, 124, 66], lava: [240, 116, 40], crust: [54, 20, 16],
  };
  const TEMP_STOPS = [[40, 60, 160], [80, 160, 210], [230, 230, 200], [240, 150, 60], [190, 40, 30]];
  function tempColor(T, out) {
    let t = WS.clamp((T + 40) / 100, 0, 1) * 4;
    const i = Math.min(3, Math.floor(t)); t -= i;
    const a = TEMP_STOPS[i], b = TEMP_STOPS[i + 1];
    out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t;
  }
  /* 풍경·기온 텍스처 칠하기: 몇 줄씩 나눠서 (한 프레임 예산 안에서) */
  // 뜨거운 행성으로 그릴 때: 바다가 생기기 전까지는 식어 가는 겉껍질이지 맨땅이 아님
  const STEAM_AIR = [196, 170, 150]; // 수증기
  const molten = (s) => s.Tg > 100 || (!s.reached.ocean && s.Tg > 30);
  function paintRows(s, V, P, budget) {
    const t0 = performance.now();
    const d = P.img.data, E = V.elev, SH = V.shade, W = s.W, F = P.F;
    const sea = P.sea, span = P.span, dmax = P.dmax, Tg = P.Tg, view = P.view;
    const tc = [0, 0, 0];
    while (P.y < TH) {
      const y = P.y;
      const T0 = Tg + 14 - 42 * V.s2[y];
      const y0 = V.by0[y] * W, y1 = V.by1[y] * W, wy = V.bwy[y];
      for (let x = 0; x < TW; x++) {
        const i = y * TW + x, e = E[i], sh = SH[i];
        const x0 = V.bx0[x], x1 = V.bx1[x], wx = V.bwx[x];
        const w00 = (1 - wx) * (1 - wy), w10 = wx * (1 - wy), w01 = (1 - wx) * wy, w11 = wx * wy;
        const c00 = y0 + x0, c10 = y0 + x1, c01 = y1 + x0, c11 = y1 + x1;
        const isLand = e > sea;
        const h = isLand ? (e - sea) / span : 0;
        const T = isLand ? T0 - 26 * h : T0;
        let r, g, b;
        if (view === 2) {
          tempColor(T, tc);
          const k = isLand ? 0.85 + (sh - 1) * 0.9 : 0.78;
          r = tc[0] * k; g = tc[1] * k; b = tc[2] * k;
          // 해안선과 0°C 선
          const eR = E[y * TW + ((x + 1) % TW)], eD = E[Math.min(TH - 1, y + 1) * TW + x];
          if ((eR > sea) !== isLand || (eD > sea) !== isLand) { r *= 0.45; g *= 0.45; b *= 0.45; }
          else if (Math.abs(T) < 0.8) { r = r * 0.3 + 240 * 0.7; g = g * 0.3 + 244 * 0.7; b = b * 0.3 + 250 * 0.7; }
        } else if (P.hot) {
          // 녹은 암석 또는 끓는 바다
          // 어두운 겉껍질 사이로 빛나는 균열 (뜨거울수록 더 밝게)
          const heat = WS.clamp((Tg - 100) / 1800, 0, 1);
          const cr = Math.abs(Math.sin(e * 38 + x * 0.013) + 0.6 * Math.sin(e * 91 - y * 0.021));
          const k = Math.max(1 - smooth(0, 0.42 + heat * 0.25, cr), heat * 0.3);
          const kk = k * k * (1 - P.cool);
          r = COL.crust[0] + (COL.lava[0] - COL.crust[0]) * kk; g = COL.crust[1] + (COL.lava[1] - COL.crust[1]) * kk; b = COL.crust[2] + (COL.lava[2] - COL.crust[2]) * kk;
          // 100°C 아래로 식으면 균열이 잦아들고 어두운 바위가 드러남
          if (P.cool > 0) { r += (COL.rockOld[0] - r) * P.cool; g += (COL.rockOld[1] - g) * P.cool; b += (COL.rockOld[2] - b) * P.cool; }
          if (P.ocean && !isLand) { r = r * 0.55 + 70; g = g * 0.55 + 40; b = b * 0.55 + 36; }
          r *= sh; g *= sh; b *= sh;
        } else if (!isLand) {
          // 구로 보면 곧은 해빙 경계가 눈에 띄므로, 겉모습에서는 수심에 따라 경계를 구불구불하게 함
          if (P.wavy ? T + (sea - e - 0.15) * 24 < -2 : T < -2) { P.snow = true; r = COL.seaIce[0]; g = COL.seaIce[1]; b = COL.seaIce[2]; const k = 0.92 + (sh - 1) * 0.3; r *= k; g *= k; b *= k; }
          else {
            const dep = WS.clamp((sea - e) / dmax, 0, 1);
            if (dep < 0.09) { const t = dep / 0.09; r = COL.shelf[0] + (COL.mid[0] - COL.shelf[0]) * t; g = COL.shelf[1] + (COL.mid[1] - COL.shelf[1]) * t; b = COL.shelf[2] + (COL.mid[2] - COL.shelf[2]) * t; }
            else { const t = Math.min(1, (dep - 0.09) / 0.5); r = COL.mid[0] + (COL.deep[0] - COL.mid[0]) * t; g = COL.mid[1] + (COL.deep[1] - COL.mid[1]) * t; b = COL.mid[2] + (COL.deep[2] - COL.mid[2]) * t; }
            // 산소가 없던 바다는 녹슨 철 때문에 탁한 초록빛
            const ir = P.iron;
            if (ir > 0) { r += (COL.iron[0] - r) * ir; g += (COL.iron[1] - g) * ir; b += (COL.iron[2] - b) * ir; }
            // 미생물·조류가 많은 바다는 물빛이 바뀜
            const ox = F.oxy[c00] * w00 + F.oxy[c10] * w10 + F.oxy[c01] * w01 + F.oxy[c11] * w11;
            const ph = F.photo[c00] * w00 + F.photo[c10] * w10 + F.photo[c01] * w01 + F.photo[c11] * w11;
            const ch = F.chemo[c00] * w00 + F.chemo[c10] * w10 + F.chemo[c01] * w01 + F.chemo[c11] * w11;
            const ko = (1 - Math.exp(-ox * 2.2)) * 0.3, kp = (1 - Math.exp(-ph * 2.2)) * 0.3, kc = (1 - Math.exp(-ch * 1.6)) * 0.3;
            if (ko > 0.002) { r += (COL.bloomOxy[0] - r) * ko; g += (COL.bloomOxy[1] - g) * ko; b += (COL.bloomOxy[2] - b) * ko; }
            if (kp > 0.002) { r += (COL.bloomPhoto[0] - r) * kp; g += (COL.bloomPhoto[1] - g) * kp; b += (COL.bloomPhoto[2] - b) * kp; }
            if (kc > 0.002) { r += (COL.chemo[0] - r) * kc; g += (COL.chemo[1] - g) * kc; b += (COL.chemo[2] - b) * kc; }
            const k = 1 + (sh - 1) * 0.22; r *= k; g *= k; b *= k;
          }
        } else if (T < -10) {
          P.snow = true;
          const k = 0.86 + (sh - 1) * 0.8;
          r = COL.snow[0] * k; g = COL.snow[1] * k; b = Math.min(255, COL.snow[2] * k + 6);
        } else {
          // 맨땅: 낮은 곳은 갈색, 높은 곳은 회색, 더운 곳은 모래
          // 바다가 없는 행성은 해수면이 지형 아래에 있어 h가 모두 1에 가까움: 지형의 가장 낮은 곳부터 잼
          const rl = P.young ? COL.rockOld : COL.rockLow, hh = Math.pow(WS.clamp((e - P.base) / P.bspan, 0, 1), 0.8);
          r = rl[0] + (COL.rockHigh[0] - rl[0]) * hh; g = rl[1] + (COL.rockHigh[1] - rl[1]) * hh; b = rl[2] + (COL.rockHigh[2] - rl[2]) * hh;
          const mo = F.moss[c00] * w00 + F.moss[c10] * w10 + F.moss[c01] * w01 + F.moss[c11] * w11;
          const fo = F.forest[c00] * w00 + F.forest[c10] * w10 + F.forest[c01] * w01 + F.forest[c11] * w11;
          const km = 1 - Math.exp(-mo * 4), kf = 1 - Math.exp(-fo * 3.2);
          const ks = smooth(20, 40, T) * (1 - Math.max(km, kf)) * (P.young ? 0.2 : 0.4);
          if (ks > 0.001) { r += (COL.sand[0] - r) * ks; g += (COL.sand[1] - g) * ks; b += (COL.sand[2] - b) * ks; }
          if (km > 0.002) { const k = km * 0.85; r += (COL.moss[0] - r) * k; g += (COL.moss[1] - g) * k; b += (COL.moss[2] - b) * k; }
          if (kf > 0.002) {
            let fr, fg, fb;
            if (T > 24) { fr = COL.jungle[0]; fg = COL.jungle[1]; fb = COL.jungle[2]; }
            else if (T > 6) { const t = (T - 6) / 18; fr = COL.temperate[0] + (COL.jungle[0] - COL.temperate[0]) * t; fg = COL.temperate[1] + (COL.jungle[1] - COL.temperate[1]) * t; fb = COL.temperate[2] + (COL.jungle[2] - COL.temperate[2]) * t; }
            else { const t = WS.clamp((T + 6) / 12, 0, 1); fr = COL.boreal[0] + (COL.temperate[0] - COL.boreal[0]) * t; fg = COL.boreal[1] + (COL.temperate[1] - COL.boreal[1]) * t; fb = COL.boreal[2] + (COL.temperate[2] - COL.boreal[2]) * t; }
            const k = kf * 0.92; r += (fr - r) * k; g += (fg - g) * k; b += (fb - b) * k;
          }
          if (T < -3) { const k = smooth(-3, -10, T) * 0.6; r += (COL.tundra[0] - r) * k; g += (COL.tundra[1] - g) * k; b += (COL.tundra[2] - b) * k; }
          r *= sh; g *= sh; b *= sh;
        }
        if (view !== 2) {
          const sc = F.scorch[c00] * w00 + F.scorch[c10] * w10 + F.scorch[c01] * w01 + F.scorch[c11] * w11;
          if (sc > 0.05) { const k = Math.min(0.75, sc * 0.3); r += (255 - r) * k; g += (112 - g) * k * 0.8; b += (40 - b) * k * 0.6; }
        }
        const k4 = i * 4;
        d[k4] = r; d[k4 + 1] = g; d[k4 + 2] = b; d[k4 + 3] = 255;
      }
      P.y++;
      if (budget && performance.now() - t0 > budget) break;
    }
    return P.y >= TH;
  }
  function paintJob(s, tv, stamp, img) {
    const base = s.emin !== undefined && s.sea < s.emin ? s.emin : s.sea;
    return {
      y: 0, view: tv, stamp, img, F: lifeFields(s), base, bspan: Math.max(0.05, s.emax - base), cool: s.Tg < 100 ? 1 - smooth(30, 100, s.Tg) : 0,
      sea: s.sea, span: Math.max(0.05, s.emax - s.sea), dmax: Math.max(0.05, s.sea - (s.emin !== undefined ? s.emin : s.sea - 0.6)),
      Tg: s.Tg, hot: molten(s), ocean: !!s.reached.ocean, young: s.t < 800, iron: s.reached.ocean ? 0.42 * (1 - Math.min(1, s.o2 / 0.004)) : 0,
    };
  }
  function texFor(s, V, view, nowMs) {
    // view 1(생물 분포)은 풍경 텍스처를 흐리게 깔아 씀
    const tv = view === 2 ? 2 : 0;
    if (!V.tex[tv]) {
      const cv = document.createElement('canvas'); cv.width = TW; cv.height = TH;
      V.tex[tv] = cv; V.img[tv] = cv.getContext('2d').createImageData(TW, TH); V.paintedAt = V.paintedAt || {};
    }
    const B0 = tv === 0 && V.surf;
    if (B0 && B0.ver && B0.ts > (V.tex0Ts || 0)) { V.tex[0].getContext('2d').putImageData(new ImageData(B0.rgba, TW, TH), 0, 0); V.tex0Ts = B0.ts; }
    let P = V.paint[tv];
    const stamp = s.steps + ':' + V.elevT;
    const due = V.paintedAt[tv] === undefined || V.force || (V.paintedAt[tv] !== stamp && nowMs - (V.paintTs || 0) > 120);
    if (!P && due) {
      P = V.paint[tv] = paintJob(s, tv, stamp, V.img[tv]);
      V.force = false;
      // 그을린 자국을 그리는 동안(과 그 뒤 몇 초)은 범례에 설명을 띄움
      if (tv === 0 && P.F.scorch.some((v) => v > 0.05)) V.scorchMs = nowMs;
    }
    if (P) {
      const first = V.paintedAt[tv] === undefined;
      if (paintRows(s, V, P, first ? 7 : 2.5)) {
        V.tex[tv].getContext('2d').putImageData(P.img, 0, 0);
        V.paintedAt[tv] = P.stamp; V.paintTs = nowMs; V.paint[tv] = null;
        if (tv === 0) { V.snow = !!P.snow; V.tex0Ts = nowMs; }
        V.texSea = P.sea;
      }
    }
    return V.tex[tv];
  }
  /* 생물 분포 보기: 칸마다 가장 많은 종 */
  function paintDist(s, V) {
    if (!V.dist) { V.dist = document.createElement('canvas'); V.dist.width = s.W; V.dist.height = s.H; V.dom = new Int32Array(s.NC); }
    const g = V.dist.getContext('2d'), img = g.createImageData(s.W, s.H), d = img.data;
    const S = s.species, n = S.length;
    for (let c = 0; c < s.NC; c++) {
      let best = null, bv = 0, tot = 0;
      for (let k = 0; k < n; k++) { const v = S[k].pop[c]; if (v > 0) { tot += v; if (v > bv) { bv = v; best = S[k]; } } }
      V.dom[c] = best ? best.id : 0;
      const k4 = c * 4;
      if (best) { d[k4] = best.color[0]; d[k4 + 1] = best.color[1]; d[k4 + 2] = best.color[2]; d[k4 + 3] = 255 * Math.min(0.9, 0.4 + tot * 0.7); }
    }
    g.putImageData(img, 0, 0);
    // 서로 다른 종이 차지한 칸 사이 경계선
    const p = new Path2D(), W = s.W, H = s.H;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = y * W + x, a = V.dom[c];
      const r = V.dom[y * W + ((x + 1) % W)];
      if (a !== r) { p.moveTo((x + 1) / W, y / H); p.lineTo((x + 1) / W, (y + 1) / H); }
      if (y < H - 1 && a !== V.dom[c + W]) { p.moveTo(x / W, (y + 1) / H); p.lineTo((x + 1) / W, (y + 1) / H); }
    }
    V.distPath = p;
    V.distAt = s.steps;
  }

  /* ---------- 생물 그림 ---------- */
  function portraitOf(s, sp, size) {
    const C = WS.Creature;
    if (!C || !C.portrait) return null;
    const g = s.genomeOf(sp);
    if (!g) return null;
    try { return C.portrait(g, s.traitsOf(sp), size, s.portraitKey(sp)); } catch (e) { return null; }
  }
  // creature.js가 없을 때 쓰는 아주 단순한 그림
  function fallbackSprite(ctx, sp, x, y, size) {
    const col = WS.rgb(sp.color), dark = WS.rgb(sp.color.map((v) => v * 0.45));
    ctx.save();
    ctx.translate(x, y);
    ctx.lineWidth = Math.max(1, size / 18);
    ctx.strokeStyle = dark; ctx.fillStyle = col;
    if (sp.troph === 0) {
      ctx.beginPath(); ctx.moveTo(0, size * 0.42); ctx.lineTo(0, -size * 0.05); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, -size * 0.12, size * 0.3, size * 0.28, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.ellipse(0, 0, size * 0.4, size * 0.22, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(size * 0.22, -size * 0.05, size * 0.07, 0, 7); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(size * 0.24, -size * 0.05, size * 0.035, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  // 처음 그리는 초상화는 한 프레임에 몇 개까지만 (첫 프레임이 끊기지 않게). 나머지는 다음 프레임에 나타남
  const ptSeen = new Set();
  let ptBudget = Infinity;
  function drawCreature(ctx, s, sp, x, y, size, facing) {
    const q = Math.max(16, Math.round(size / 4) * 4);
    if (WS.Creature) {
      const k = s.portraitKey(sp) + '|' + q;
      if (!ptSeen.has(k)) {
        if (ptBudget <= 0) return;
        ptBudget--;
        if (ptSeen.size > 4000) ptSeen.clear();
        ptSeen.add(k);
      }
    }
    const pc = portraitOf(s, sp, q);
    if (!pc) { fallbackSprite(ctx, sp, x, y, size); return; }
    if (facing < 0) { ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1); ctx.drawImage(pc, -size / 2, -size / 2, size, size); ctx.restore(); }
    else ctx.drawImage(pc, x - size / 2, y - size / 2, size, size);
  }
  const isMacro = (q) => q.cx >= 2;
  const spriteBase = (R) => WS.clamp(R.w / 21, 22, 46);
  /* 지도 위 생물 배치: 가장 번성한 종들을 가장 많이 사는 곳에 (약 1초마다 다시 고름) */
  function placeSprites(s, V, R) {
    const out = { list: [], labels: [], mats: [], lenses: [] };
    const W = s.W, H = s.H, cw = R.w / W, chh = R.h / H;
    const base = spriteBase(R);
    const budget = Math.round(WS.clamp(R.w / 34, 9, 28));
    const byTot = (a, b) => b.total - a.total;
    const macroAll = s.species.filter((q) => isMacro(q) && q.total > 2e-5);
    // 동물을 먼저, 식물은 몇 종만: 사용자가 보고 싶은 것은 다양한 생김새
    // 무리마다 자리를 나눠 줌: 바다 동물, 육지 동물, 바다 식물, 육지 식물 (드물어도 육지 생물은 꼭 보이게)
    const grp = (an, ld, n) => macroAll.filter((q) => (q.troph > 0) === an && !!q.land === ld).sort(byTot).slice(0, n);
    const macro = grp(true, false, 6).concat(grp(true, true, 4), grp(false, true, 3), grp(false, false, 3));
    const wOf = (q) => Math.sqrt(Math.max(q.total, 1e-3)) * (q.troph > 0 ? 2 : 1) * (q.land ? 1.6 : 1);
    const taken = [];
    const free = (x, y, rad) => taken.every((t) => (t.x - x) ** 2 + (t.y - y) ** 2 > (rad + t.r) ** 2 * 0.8);
    const E = V.elev, sea = s.sea;
    const habitatOK = (land, u, v) => {
      if (!E) return true;
      const px = Math.min(TW - 1, Math.max(0, Math.floor(u * TW))), py = Math.min(TH - 1, Math.max(0, Math.floor(v * TH)));
      return (E[py * TW + px] > sea) === land;
    };
    if (macro.length) {
      const wsum = macro.reduce((a, q) => a + wOf(q), 0);
      let left = budget;
      macro.forEach((q, qi) => {
        if (left <= 0) return;
        const want = Math.max(1, Math.min(3, Math.round((budget * wOf(q)) / wsum)));
        const size = base * ([0.8, 0.8, 0.84, 1, 1.12][q.cx] || 1) * (q.sapient ? 1.12 : 1);
        const cells = [];
        let mx = 0;
        for (let c = 0; c < s.NC; c++) if (q.pop[c] > mx) mx = q.pop[c];
        for (let c = 0; c < s.NC; c++) if (q.pop[c] > mx * 0.15) cells.push(c);
        cells.sort((a, b) => q.pop[b] - q.pop[a]);
        let got = 0;
        for (const c of cells) {
          if (got >= want) break;
          const h = hash32(q.id * 7919 + 13, c);
          let u = 0, v = 0, ok = false;
          for (let k = 0; k < 4 && !ok; k++) {
            const j1 = ((hash32(h, k) & 1023) / 1023 - 0.5) * 0.8, j2 = ((hash32(h, k + 9) & 1023) / 1023 - 0.5) * 0.8;
            u = ((c % W) + 0.5 + j1) / W; v = (((c / W) | 0) + 0.5 + j2) / H;
            ok = habitatOK(!!q.land, u, v);
          }
          if (!ok) { u = ((c % W) + 0.5) / W; v = (((c / W) | 0) + 0.5) / H; }
          const x = R.x0 + u * R.w, y = R.y0 + v * R.h;
          if (y < R.y0 + size * 0.4 || y > R.y0 + R.h - size * 0.4 || x < R.x0 + size * 0.55 || x > R.x0 + R.w - size * 0.55) continue;
          if (!free(x, y, size * 0.56)) continue;
          taken.push({ x, y, r: size * 0.56 });
          out.list.push({ sp: q, u, v, size, phase: (h % 628) / 100, facing: h & 2 ? 1 : -1, rank: qi });
          got++;
        }
        left -= got;
      });
      // 그림 아래에 이름표: 상위 몇 종만, 겹치지 않게
      const boxes = [];
      const seen = new Set();
      for (const it of out.list) {
        const label = s.kindName(it.sp);
        if (seen.has(label) || seen.size >= 5) continue;
        seen.add(label);
        const x = R.x0 + it.u * R.w, y = R.y0 + it.v * R.h + it.size * 0.55 + 9;
        const wv = label.length * 11 + 10;
        const bx = { x0: x - wv / 2, x1: x + wv / 2, y0: y - 8, y1: y + 8 };
        if (bx.x0 < R.x0 + 4 || bx.x1 > R.x0 + R.w - 4 || bx.y1 > R.y0 + R.h - 2) continue;
        if (boxes.some((b) => !(bx.x1 < b.x0 || bx.x0 > b.x1 || bx.y1 < b.y0 || bx.y0 > b.y1))) continue;
        boxes.push(bx);
        out.labels.push({ text: label, u: it.u, v: it.v, dy: it.size * 0.55 + 9, sp: it.sp });
      }
    }
    // 미생물 시대: 얕은 바다의 스트로마톨라이트, 열수구의 미생물 막, 현미경 렌즈
    const nMacro = out.list.length;
    if (s.species.length && nMacro < 6) {
      const F = lifeFields(s);
      const cand = [];
      for (let c = 0; c < s.NC; c++) {
        if (s.land[c] || s.ice[c]) continue;
        const x = c % W, y = (c / W) | 0;
        let coast = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const yy = y + dy; if (yy >= 0 && yy < H && s.land[yy * W + ((x + dx + W) % W)]) coast = true; }
        const ph = F.oxy[c] + F.photo[c];
        if (coast && ph > 0.02) cand.push({ c, k: 'strom', v: ph });
        else if (s.vent[c] > 0.25 && F.chemo[c] > 0.02) cand.push({ c, k: 'vent', v: F.chemo[c] * s.vent[c] });
      }
      cand.sort((a, b) => b.v - a.v);
      // 고해상도 지형에서 물속인지, (스트로마톨라이트는) 바닷가 얕은 곳인지 확인
      const pxOf = (u, v) => Math.min(TH - 1, Math.max(0, Math.floor(v * TH))) * TW + (((Math.floor(u * TW) % TW) + TW) % TW);
      const wet = (u, v) => !E || E[pxOf(u, v)] <= sea;
      const nearShore = (u, v) => {
        if (!E) return true;
        for (const [dx, dy] of [[4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, -3], [3, -3], [-3, 3]]) if (E[pxOf(u + dx / TW, v + dy / TH)] > sea) return true;
        return false;
      };
      let nm = 0;
      for (const it of cand) {
        if (nm >= Math.round(budget * 0.9)) break;
        let ok = false, u = 0, v = 0;
        const h = hash32(it.c, 77);
        for (let k = 0; k < 8 && !ok; k++) {
          const hk = hash32(h, k);
          u = ((it.c % W) + 0.5 + ((hk & 255) / 255 - 0.5) * 0.9) / W; v = (((it.c / W) | 0) + 0.5 + (((hk >> 8) & 255) / 255 - 0.5) * 0.9) / H;
          ok = wet(u, v) && (it.k !== 'strom' || nearShore(u, v));
        }
        if (!ok) continue;
        const x = R.x0 + u * R.w, y = R.y0 + v * R.h;
        if (!free(x, y, 6)) continue;
        taken.push({ x, y, r: 6 });
        out.mats.push({ k: it.k, u, v, s: WS.clamp(0.6 + it.v, 0.6, 1.4), h });
        nm++;
      }
      // 렌즈: 가장 번성한 미생물 몇 종을 확대해서 보여 줌
      const micro = [], kinds = new Set();
      for (const q of s.species.filter((x) => !isMacro(x)).sort((a, b) => b.total - a.total)) {
        const k = s.kindName(q);
        if (kinds.has(k)) continue;
        kinds.add(k); micro.push(q);
        if (micro.length >= (nMacro ? 1 : 3)) break;
      }
      const lr = WS.clamp(R.w / 26, 18, 34);
      const placed = [];
      micro.forEach((q) => {
        let best = -1, bv = 0;
        for (let c = 0; c < s.NC; c++) if (q.pop[c] > bv) { bv = q.pop[c]; best = c; }
        if (best < 0) return;
        const u = ((best % W) + 0.5) / W, v = (((best / W) | 0) + 0.5) / H;
        const px = R.x0 + u * R.w, py = R.y0 + v * R.h;
        const tries = [[1.9, -1.7], [-1.9, -1.7], [1.9, 1.7], [-1.9, 1.7], [0, -2.4], [0, 2.4], [2.6, 0], [-2.6, 0]];
        for (const [ox, oy] of tries) {
          const lx = px + ox * lr, ly = py + oy * lr;
          if (lx - lr < R.x0 + 4 || lx + lr > R.x0 + R.w - 4 || ly - lr < R.y0 + 4 || ly + lr + 16 > R.y0 + R.h - 2) continue;
          if (placed.some((p) => (p.x - lx) ** 2 + (p.y - ly) ** 2 < (lr * 2.6) ** 2)) continue;
          placed.push({ x: lx, y: ly });
          out.lenses.push({ sp: q, u, v, ox: ox * lr, oy: oy * lr, r: lr });
          break;
        }
      });
    }
    return out;
  }
  function drawMat(ctx, it, x, y, base, time) {
    if (it.k === 'strom') {
      // 스트로마톨라이트: 층층이 쌓인 둥근 미생물 탑
      const r = base * 0.32 * it.s;
      ctx.fillStyle = 'rgba(196,170,120,.92)';
      ctx.strokeStyle = 'rgba(70,52,34,.85)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x - r, y + r * 0.35); ctx.quadraticCurveTo(x - r, y - r * 0.9, x, y - r * 0.95); ctx.quadraticCurveTo(x + r, y - r * 0.9, x + r, y + r * 0.35); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(70,52,34,.55)';
      for (let k = 1; k <= 2; k++) { const yy = y + r * 0.35 - k * r * 0.42; ctx.beginPath(); ctx.moveTo(x - r * (1 - k * 0.22), yy); ctx.quadraticCurveTo(x, yy - r * 0.25, x + r * (1 - k * 0.22), yy); ctx.stroke(); }
      ctx.fillStyle = 'rgba(70,170,130,.75)';
      ctx.beginPath(); ctx.ellipse(x, y - r * 0.8, r * 0.55, r * 0.18, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      // 열수구의 미생물 막: 반짝이는 주황 점들
      const r = base * 0.2 * it.s;
      for (let k = 0; k < 5; k++) {
        const a = ((it.h >> (k * 3)) & 7) / 7 * Math.PI * 2, rr = r * (0.3 + (((it.h >> (k * 2 + 1)) & 3) / 3) * 0.9);
        const tw = 0.55 + 0.45 * Math.sin(time * 2.2 + k * 1.7 + it.h);
        ctx.fillStyle = `rgba(255,${150 + k * 12},80,${0.45 + tw * 0.45})`;
        ctx.beginPath(); ctx.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, Math.max(1.2, r * 0.22), 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  function haloText(ctx, text, x, y, color) {
    ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(5,7,11,.85)'; ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color || '#ebe4d3';
    ctx.fillText(text, x, y);
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function atmoColor(s) {
    if (s.Tg > 100) return [255, 120, 60];
    if (molten(s)) return STEAM_AIR;
    if (s.inSnowball) return [200, 225, 245];
    if (s.o2 > 0.05) return [120, 180, 255];
    if (s.ch4 > 0.5) return [230, 150, 80];
    return [150, 160, 180];
  }
  // 지도에 '이 종이 사는 곳'으로 칠할 최소 개체 수 (큰 지도와 카드 속 작은 지도가 같은 기준을 씀)
  function habitatThr(s, q) {
    let mx = 0;
    for (let c = 0; c < s.NC; c++) if (q.pop[c] > mx) mx = q.pop[c];
    return Math.max(1e-4, mx * 0.04);
  }
  function render(s, ctx, W, H, time, app) {
    if (s.ended) syncEndArt(s, app);
    const nowMs = performance.now();
    ptBudget = 3;
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, W, H);
    const V = visOf(s);
    const R = mapRect(W, H, app && app.safe);
    V.rect = { W, H, R };
    const view = app ? app.view || 0 : 0;
    ensureElev(s, V);
    const tex = texFor(s, V, view, nowMs);
    // 대기의 빛 (테두리)
    const ac = atmoColor(s);
    ctx.save();
    ctx.shadowColor = WS.rgb(ac, 0.55); ctx.shadowBlur = 18;
    roundRect(ctx, R.x0, R.y0, R.w, R.h, 10);
    ctx.fillStyle = '#0a1a3a'; ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, R.x0, R.y0, R.w, R.h, 10);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tex, R.x0, R.y0, R.w, R.h);
    if (view === 1) {
      ctx.fillStyle = 'rgba(5,7,11,.55)';
      ctx.fillRect(R.x0, R.y0, R.w, R.h);
      if (!V.dist || V.distAt !== s.steps && nowMs - (V.distTs || 0) > 150) { paintDist(s, V); V.distTs = nowMs; }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(V.dist, R.x0, R.y0, R.w, R.h);
      ctx.imageSmoothingEnabled = true;
      ctx.save();
      ctx.translate(R.x0, R.y0); ctx.scale(R.w, R.h);
      ctx.lineWidth = 1.2 / R.w;
      ctx.strokeStyle = 'rgba(5,7,11,.7)';
      ctx.stroke(V.distPath);
      ctx.restore();
    }
    // 경위선
    ctx.strokeStyle = 'rgba(235,228,211,.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 1; k < 6; k++) { const y = Math.round(R.y0 + (R.h * k) / 6) + 0.5; ctx.moveTo(R.x0, y); ctx.lineTo(R.x0 + R.w, y); }
    for (let k = 1; k < 6; k++) { const x = Math.round(R.x0 + (R.w * k) / 6) + 0.5; ctx.moveTo(x, R.y0); ctx.lineTo(x, R.y0 + R.h); }
    ctx.stroke();
    // 생물 그림 (풍경 보기)
    if (view === 0 && !(s.Tg > 100)) {
      if (!V.spr || V.sprW !== R.w || (V.sprAt !== s.steps && nowMs - V.sprTs > 900)) { V.spr = placeSprites(s, V, R); V.sprAt = s.steps; V.sprTs = nowMs; V.sprW = R.w; }
      const SP = V.spr, base = spriteBase(R) * 0.6;
      for (const it of SP.mats) drawMat(ctx, it, R.x0 + it.u * R.w, R.y0 + it.v * R.h, base, time);
      const list = SP.list.filter((it) => it.sp.pop).sort((a, b) => (a.sp.troph === 0) === (b.sp.troph === 0) ? a.v - b.v : a.sp.troph === 0 ? -1 : 1);
      for (const it of list) {
        const sp = it.sp, animal = sp.troph > 0;
        let x = R.x0 + it.u * R.w, y = R.y0 + it.v * R.h;
        if (animal) { y += Math.sin(time * 1.6 + it.phase) * Math.max(1, it.size * 0.06); if (!sp.land) x += Math.sin(time * 0.6 + it.phase) * it.size * 0.08; }
        // 지형 위에서도 잘 보이도록 둥근 받침 + 종 색 테두리
        const tr = it.size * 0.48;
        ctx.fillStyle = sp.land ? 'rgba(12,16,12,.5)' : 'rgba(6,14,26,.5)';
        ctx.beginPath(); ctx.arc(x, y, tr, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = WS.rgb(sp.color, 0.85); ctx.lineWidth = 1.3;
        ctx.stroke();
        drawCreature(ctx, s, sp, x, y, it.size, it.facing);
      }
      if (SP.labels.length) {
        ctx.font = '600 11.5px IBM Plex Sans KR, Malgun Gothic, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const lb of SP.labels) haloText(ctx, lb.text, R.x0 + lb.u * R.w, R.y0 + lb.v * R.h + lb.dy, '#f3ecd9');
      }
      for (const L of SP.lenses) {
        if (!L.sp.pop) continue;
        const px = R.x0 + L.u * R.w, py = R.y0 + L.v * R.h, lx = px + L.ox, ly = py + L.oy;
        ctx.strokeStyle = 'rgba(241,203,134,.7)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.stroke();
        const dx = lx - px, dy = ly - py, dl = Math.hypot(dx, dy) || 1;
        ctx.beginPath(); ctx.moveTo(px + (dx / dl) * 4, py + (dy / dl) * 4); ctx.lineTo(lx - (dx / dl) * L.r, ly - (dy / dl) * L.r); ctx.stroke();
        ctx.save();
        ctx.beginPath(); ctx.arc(lx, ly, L.r, 0, Math.PI * 2);
        const gr = ctx.createRadialGradient(lx - L.r * 0.3, ly - L.r * 0.3, 1, lx, ly, L.r);
        gr.addColorStop(0, '#22344a'); gr.addColorStop(1, '#0a121c');
        ctx.fillStyle = gr; ctx.fill();
        ctx.clip();
        drawCreature(ctx, s, L.sp, lx, ly + Math.sin(time * 1.3 + L.sp.id) * 1.2, L.r * 1.7, 1);
        ctx.restore();
        ctx.strokeStyle = 'rgba(241,203,134,.9)'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(lx, ly, L.r, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(lx, ly, L.r - 3, Math.PI * 1.1, Math.PI * 1.5); ctx.stroke();
        ctx.font = '600 11px IBM Plex Sans KR, Malgun Gothic, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        haloText(ctx, s.kindName(L.sp), lx, ly + L.r + 10, '#f3ecd9');
      }
    }
    // 생물 분포 보기: 상위 종 이름
    if (view === 1 && V.dom) {
      const top = s.species.slice().sort((a, b) => b.total - a.total).slice(0, 6);
      ctx.font = '600 11.5px IBM Plex Sans KR, Malgun Gothic, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const boxes = [];
      for (const q of top) {
        let best = -1, bv = 0;
        for (let c = 0; c < s.NC; c++) if (V.dom[c] === q.id && q.pop[c] > bv) { bv = q.pop[c]; best = c; }
        if (best < 0) continue;
        const x = R.x0 + ((best % s.W) + 0.5) / s.W * R.w, y = R.y0 + (((best / s.W) | 0) + 0.5) / s.H * R.h;
        const label = s.kindName(q), wv = label.length * 11 + 8;
        const bx = { x0: x - wv / 2, x1: x + wv / 2, y0: y - 9, y1: y + 9 };
        if (boxes.some((b) => !(bx.x1 < b.x0 || bx.x0 > b.x1 || bx.y1 < b.y0 || bx.y0 > b.y1))) continue;
        boxes.push(bx);
        haloText(ctx, label, WS.clamp(x, R.x0 + wv / 2, R.x0 + R.w - wv / 2), WS.clamp(y, R.y0 + 10, R.y0 + R.h - 10), WS.rgb(q.color.map((v) => Math.min(255, v * 1.25 + 30))));
      }
    }
    // 도감에서 고른 종의 서식지
    const hl = s._hl ? s.byId.get(s._hl) : null;
    if (hl && hl.pop) {
      const thr = habitatThr(s, hl), cw = R.w / s.W, chh = R.h / s.H;
      const pulse = 0.5 + 0.5 * Math.sin(time * 3);
      const edge = new Path2D(), area = new Path2D();
      for (let c = 0; c < s.NC; c++) {
        if (!(hl.pop[c] > thr)) continue;
        const x = c % s.W, y = (c / s.W) | 0, X = R.x0 + x * cw, Y = R.y0 + y * chh;
        area.rect(X, Y, cw, chh);
        const inn = (q) => hl.pop[q] > thr;
        if (!inn(y * s.W + ((x + 1) % s.W))) { edge.moveTo(X + cw, Y); edge.lineTo(X + cw, Y + chh); }
        if (!inn(y * s.W + ((x - 1 + s.W) % s.W))) { edge.moveTo(X, Y); edge.lineTo(X, Y + chh); }
        if (y === 0 || !inn(c - s.W)) { edge.moveTo(X, Y); edge.lineTo(X + cw, Y); }
        if (y === s.H - 1 || !inn(c + s.W)) { edge.moveTo(X, Y + chh); edge.lineTo(X + cw, Y + chh); }
      }
      ctx.fillStyle = `rgba(241,203,134,${0.14 + 0.1 * pulse})`;
      ctx.fill(area);
      ctx.strokeStyle = `rgba(241,203,134,${0.7 + 0.3 * pulse})`; ctx.lineWidth = 1.6;
      ctx.stroke(edge);
      const txt = `${s.kindName(hl)} · ${hl.name}의 서식지`;
      ctx.font = '600 12px IBM Plex Sans KR, Malgun Gothic, sans-serif';
      const tw = ctx.measureText(txt).width + 20;
      ctx.fillStyle = 'rgba(10,13,19,.88)';
      roundRect(ctx, R.x0 + R.w / 2 - tw / 2, R.y0 + 8, tw, 24, 12); ctx.fill();
      ctx.strokeStyle = 'rgba(241,203,134,.8)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#f1cb86'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, R.x0 + R.w / 2, R.y0 + 20);
    }
    WS.drawFx(ctx, s, (x, y) => [R.x0 + x * R.w, R.y0 + y * R.h, R.w]);
    ctx.restore();
    ptBudget = Infinity;
    // 테두리
    ctx.strokeStyle = WS.rgb(ac, 0.45); ctx.lineWidth = 1.5;
    roundRect(ctx, R.x0 - 0.5, R.y0 - 0.5, R.w + 1, R.h + 1, 10); ctx.stroke();
    if (s.Tg > 100) {
      const msg = s.reached.ocean ? '바다가 끓고 있습니다' : '녹은 암석의 바다 · 아직 물이 고일 수 없습니다';
      ctx.font = '600 15px Gowun Batang, serif';
      const tw = ctx.measureText(msg).width + 28;
      ctx.fillStyle = 'rgba(10,13,19,.78)';
      roundRect(ctx, W / 2 - tw / 2, R.y0 + R.h / 2 - 17, tw, 34, 17); ctx.fill();
      ctx.fillStyle = '#ffd2a8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(msg, W / 2, R.y0 + R.h / 2 + 1);
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  /* ---------- 글로 설명 ---------- */
  function topSpecies(s, pred) { let b = null; for (const q of s.species) if ((!pred || pred(q)) && (!b || q.total > b.total)) b = q; return b; }
  function era(s) {
    const R = s.reached;
    if (s.Tg > 100) return R.ocean ? { name: '끓어오르는 행성', sub: '온실 효과가 폭주해 바다가 증발합니다' } : { name: '마그마 바다', sub: '갓 생긴 행성이 아직 녹아 있습니다' };
    if (s.inSnowball) return { name: '눈덩이 행성', sub: '얼음이 적도까지 덮었습니다. 생명은 열수구와 얼음 틈에서 버팁니다' };
    if (!s.species.length) return R.life ? { name: '불모의 행성', sub: '생명이 사라졌습니다. 다시 태어날 수 있을까요' } : { name: '생명 이전의 바다', sub: '분자들이 부딪히지만 아직 스스로 복제하는 것은 없습니다' };
    if (s.sapientSp && !s.sapientSp.extinct && R.civ) return { name: '문명의 시작', sub: `${josa(s.sapientSp.name, '이', '가')} 농사를 짓고 마을을 이룹니다` };
    if (s.sapientSp && !s.sapientSp.extinct) return { name: '지성의 새벽', sub: `${josa(s.sapientSp.name, '이', '가')} 도구와 언어를 씁니다` };
    const cx = s.maxCx();
    const landA = s.species.some((q) => q.land && q.troph > 0), landP = s.species.some((q) => q.land && q.troph === 0);
    if (landA && cx >= 4) return s.species.some((q) => q.intel > 0.6) ? { name: '영리한 동물들의 시대', sub: '머리를 쓰는 동물들이 변덕스러운 기후를 견딥니다' } : { name: '육상 척추동물의 시대', sub: '큰 동물들이 대륙을 누빕니다' };
    if (landP) return plantCover(s) > 0.15 ? { name: '푸른 대륙', sub: '식물이 땅을 덮고 동물이 뒤따릅니다' } : { name: '땅으로 오르는 생명', sub: '식물이 바닷가부터 조금씩 맨땅에 뿌리내립니다' };
    if (cx >= 3) return { name: '바다 생물의 폭발', sub: '눈, 껍데기, 다리를 가진 동물들이 바다를 채웁니다' };
    if (cx >= 2) return { name: '다세포 생물의 시대', sub: '세포들이 협력해 큰 몸을 이룹니다' };
    if (cx >= 1) return { name: '진핵생물의 시대', sub: '산소를 쓰는 복잡한 세포가 퍼집니다' };
    if (R.goe) return { name: '산소의 시대', sub: '대기에 산소가 쌓였지만 생명은 아직 단세포입니다' };
    if (R.oxy) return { name: '남세균의 바다', sub: '산소가 만들어지지만 철과 화산 가스가 모두 삼킵니다' };
    return { name: '미생물의 바다', sub: '열수구와 얕은 바다에 미생물 막이 깔려 있습니다' };
  }
  // 육지 중 식물이 자리 잡은 칸의 비율
  function plantCover(s) {
    let lc = 0, vc = 0;
    const lp = s.species.filter((q) => q.land && q.troph === 0);
    if (!lp.length) return 0;
    for (let c = 0; c < s.NC; c++) if (s.land[c] && !s.ice[c]) { lc++; let v = 0; for (const q of lp) v += q.pop[c]; if (v > 0.05) vc++; }
    return lc ? vc / lc : 0;
  }
  function narrate(s) {
    const R = s.reached, n = s.species.length;
    if (s.Tg > 100) return R.ocean ? `별빛과 온실 효과가 너무 강해져 바다가 끓고 있습니다. 평균 기온은 ${Math.round(s.Tg)}°C입니다.` : '갓 태어난 행성의 표면이 아직 녹아 있습니다. 식으면 수증기가 비가 되어 바다가 생깁니다.';
    if (s.inSnowball) return `얼음이 행성의 ${Math.round(s.iceFrac * 100)}%를 덮었습니다. 화산이 내뿜는 이산화탄소가 쌓여 얼음을 녹여 주기를 기다립니다.`;
    if (!n) return R.life ? '생명이 모두 사라졌습니다. 바다는 남아 있으니 언젠가 다시 생겨날 수도 있습니다.' : '바다는 생겼지만 아직 생명은 없습니다. 열수구 주변에서 분자들이 우연히 짝을 맞추고 있습니다.';
    const o2p = s.o2 * 21;
    const air = o2p < 0.01 ? '산소는 거의 없습니다' : `대기의 산소는 ${fmtPct(o2p)}입니다(오늘의 지구는 21%)`;
    const cx = s.maxCx();
    let a;
    const sap = s.sapientSp && !s.sapientSp.extinct ? s.sapientSp : null;
    if (sap) a = R.civ ? `${josa(sap.name, '이', '가')} 씨앗을 심고 마을을 이루었습니다. 이 행성에서 문명이 시작되었습니다.` : `${josa(sap.name, '이', '가')} 도구와 말을 쓰기 시작했습니다. 이들이 마을을 이루면 문명이 시작됩니다.`;
    else if (cx >= 3) {
      const la = topSpecies(s, (q) => q.land && q.troph > 0), sa = topSpecies(s, (q) => !q.land && q.troph > 0 && q.cx >= 2), lp = topSpecies(s, (q) => q.land && q.troph === 0);
      if (la && sa) a = `대륙에는 ${josa(s.kindName(la), '이', '가')}, 바다에는 ${josa(s.kindName(sa), '이', '가')} 번성합니다. 모두 ${n}종이 살고 있습니다.`;
      else if (lp && sa) { const cv = plantCover(s); a = `${josa(s.kindName(lp), '이', '가')} ${cv > 0.35 ? '대륙을 푸르게 덮었고' : cv > 0.08 ? `육지의 ${Math.round(cv * 100)}%에 자리 잡았고` : '육지 곳곳에 겨우 뿌리내렸고'}, 바다에는 ${josa(s.kindName(sa), '이', '가')} 삽니다.`; }
      else a = `${josa(s.kindName(topSpecies(s)), '이', '가')} 가장 번성하고, 모두 ${n}종이 살고 있습니다.`;
    } else if (cx >= 2) a = `세포들이 모여 한 몸을 이룬 다세포 생물이 나타났습니다. 모두 ${n}종이 살고 있습니다.`;
    else if (cx >= 1) a = `세포 안에 작은 기관을 품은 진핵생물이 퍼지고 있습니다. 모두 ${n}종이 살고 있습니다.`;
    else if (R.oxy && !R.goe) a = '남세균이 산소를 내뿜지만 바다의 철과 화산 가스가 곧바로 삼켜 버립니다.';
    else if (R.goe) a = `대기에 산소가 쌓이고 있지만 생물은 아직 모두 단세포입니다. 모두 ${n}종이 살고 있습니다.`;
    else a = s.ch4 > 0.5 ? `바다에 미생물 ${n}종이 삽니다. 산소 대신 미생물이 내뿜은 메탄이 행성을 따뜻하게 감싸고 있습니다.` : `열수구와 얕은 바다에 미생물 ${n}종이 삽니다.`;
    let b;
    if (s.t - s.lastMassExt < 15) b = '얼마 전 대멸종이 지나가, 살아남은 생물들이 빈자리를 채우고 있습니다.';
    else if (s.iceFrac > 0.45) b = `빙하기입니다. 얼음이 행성의 ${Math.round(s.iceFrac * 100)}%를 덮었습니다.`;
    else b = `평균 기온 ${Math.round(s.Tg)}°C, ${air}.`;
    return a + ' ' + b;
  }
  function stats(s) {
    const top = topSpecies(s);
    const cx = s.maxCx();
    const co2 = fmtCO2(s.co2 * 280);
    return [
      ['평균 기온', `${Math.round(s.Tg)}°C`, s.Tg > 50 || s.Tg < -10 ? 'warn' : ''],
      ['산소 (대기 중)', s.o2 * 21 < 0.01 ? '거의 없음' : fmtPct(s.o2 * 21), s.o2 > 0.05 ? 'good' : ''],
      // 값이 %일 때는 이름도 바꾼다: 그래야 추세 화살표가 ppm과 %의 숫자를 섞어 비교하지 않는다 (이름이 달라지면 화면이 추세 기록을 새로 시작)
      [co2.endsWith('%') ? '이산화탄소 (대기 중)' : '이산화탄소', co2],
      ['얼음 덮개', `${Math.round(s.iceFrac * 100)}%`, s.iceFrac > 0.6 ? 'warn' : ''],
      ['살아 있는 종', `${s.species.length}종`],
      ['가장 복잡한 생물', cx < 0 ? '—' : CX_NAME[cx]],
      ['가장 번성한 생물', top ? s.kindName(top) : '—'],
      ['바다 / 육지', `${Math.round(s.oceanFrac * 100)} / ${Math.round(s.landFrac * 100)}%`],
    ];
  }
  function legend(s, view) {
    if (view === SPACE_VIEW) return spaceLegend(s);
    if (view === 2) return [{ gradient: TEMP_STOPS.map((c) => WS.rgb(c)), from: '−40°C', to: '60°C' }, { color: '#f0f4fa', label: '0°C 선 (물이 어는 경계)' }];
    if (view === 1) {
      const top = s.species.slice().sort((a, b) => b.total - a.total).slice(0, 6);
      if (!top.length) return [{ color: '#3a4150', label: '아직 생물이 없습니다' }];
      return top.map((q) => ({ color: WS.rgb(q.color), label: `${s.kindName(q)} · ${q.name.split(' ')[0]}` })).concat([{ color: 'rgba(5,7,11,.6)', label: '칸마다 가장 많은 종의 색' }]);
    }
    if (molten(s)) return [{ gradient: [WS.rgb(COL.crust), WS.rgb(COL.lava)], from: '식어 굳은 겉껍질', to: '녹은 암석' }];
    const L = [{ gradient: [WS.rgb(COL.shelf), WS.rgb(COL.mid), WS.rgb(COL.deep)], from: '얕은 바다', to: '깊은 바다' }, { color: WS.rgb(COL.rockLow), label: '맨땅 (바위·모래)' }];
    const has = (f) => s.species.some(f);
    if (has((q) => q.land && q.troph === 0)) L.push({ gradient: [WS.rgb(COL.moss), WS.rgb(COL.temperate), WS.rgb(COL.jungle)], from: '이끼', to: '숲' });
    if (has((q) => !q.land && q.troph === 0 && q.energy === 'oxy')) L.push({ color: WS.rgb(COL.bloomOxy), label: '광합성 생물이 많은 바다' });
    if (has((q) => !q.land && q.energy === 'photo')) L.push({ color: WS.rgb(COL.bloomPhoto), label: '보라색 광합성 세균' });
    if (s.reached.ocean && s.o2 < 0.004) L.push({ color: WS.rgb(COL.iron), label: '철이 녹아 있는 산소 없는 바다' });
    // 지도에 실제로 그려진 것(s._vis.spr)을 기준으로 설명 (화면이 없으면 상태로 짐작)
    const V = s._vis, spr = V && V.spr;
    const vents = spr ? spr.mats.some((m) => m.k === 'vent') : false;
    if (vents || has((q) => !q.land && q.troph === 0 && q.energy === 'chemo' && q.total > 0.004)) L.push({ color: WS.rgb(COL.chemo), label: vents ? '주황빛·반짝임: 열수구 미생물' : '주황빛 바다: 열수구 미생물' });
    // 얼음·눈: 지도에 실제로 하얀 곳이 그려졌을 때만 (화면이 없으면 얼음 칸이 있을 때)
    if (V && V.snow !== undefined ? V.snow : s.iceFrac > 0) L.push({ color: WS.rgb(COL.snow), label: '얼음·눈' });
    if (has(isMacro)) L.push({ color: '#f1cb86', label: '그림: 그곳에 가장 많은 생물' });
    else if (s.species.length && (!spr || spr.mats.some((m) => m.k === 'strom'))) L.push({ color: '#c4aa78', label: '둥근 탑: 미생물이 쌓은 스트로마톨라이트' });
    if (spr && spr.lenses.length) L.push({ color: '#f1cb86', label: '렌즈: 미생물을 확대한 모습' });
    if (V && V.scorchMs && performance.now() - V.scorchMs < 6000) L.push({ color: 'rgb(255,128,56)', label: '불탄 자국: 막 충돌·화산' });
    return L;
  }
  function eventArt(s, e) {
    if (!e || !e.sp || !s.byId) return null;
    const sp = s.byId.get(e.sp);
    if (!sp) return null;
    return portraitOf(s, sp, 64);
  }

  /* ---------- 생물 도감 (기록 패널의 탭) ---------- */
  const DEX_CSS = `
.lx { display: grid; gap: 10px; padding-top: 4px; }
.lx-sum { margin: 0; font-size: 12.5px; color: var(--muted); }
.lx-sum b { color: var(--text); font-weight: 600; }
.lx h4 { margin: 8px 0 0; font-family: var(--f-display); font-size: 16px; font-weight: 700; color: var(--text); }
.lx-note { margin: 0; font-size: 12px; color: var(--muted); }
.lx-phylo { width: 100%; height: 250px; display: block; background: rgba(5,7,11,.4); border: 1px solid var(--line); border-radius: 8px; }
.lx-cards { display: grid; gap: 8px; }
.lx-card { display: grid; grid-template-columns: 78px minmax(0, 1fr); gap: 10px; align-items: start; text-align: left; width: 100%; padding: 8px; border: 1px solid var(--line); border-radius: 10px; background: var(--ink-3); color: var(--text); cursor: pointer; font: inherit; }
.lx-card:hover { border-color: var(--muted); }
.lx-card[aria-pressed="true"] { border-color: var(--brass); box-shadow: inset 0 0 0 1px var(--brass); background: color-mix(in srgb, var(--brass) 9%, var(--ink-3)); }
.lx-pt { width: 78px; height: 78px; border-radius: 8px; display: block; background: radial-gradient(circle at 50% 38%, #1f2b3e, #0b1018 75%); }
.lx-kind { font-size: 11.5px; color: var(--brass-hi); line-height: 1.35; }
.lx-onmap { margin-left: 6px; padding: 0 6px; border-radius: 8px; font-size: 10.5px; color: var(--ink); background: var(--brass-hi); white-space: nowrap; }
.lx-onmap[hidden] { display: none; }
.lx-name { font-family: var(--f-display); font-size: 15px; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
.lx-desc { font-size: 12px; color: var(--text); opacity: .86; margin-top: 3px; line-height: 1.4; }
.lx-meta { font-size: 11.5px; color: var(--muted); margin-top: 3px; line-height: 1.4; }
.lx-bars { display: grid; grid-template-columns: auto minmax(0, 1fr) 26px; gap: 3px 8px; align-items: center; margin-top: 6px; font-size: 11px; color: var(--muted); }
.lx-bars i { display: block; height: 6px; border-radius: 3px; background: var(--ink-2); position: relative; overflow: hidden; }
.lx-bars i b { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; background: var(--cyan); }
.lx-bars span:last-child, .lx-bars .v { font-family: var(--f-mono); text-align: right; color: var(--text); }
.lx-share { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; margin-top: 7px; font-size: 11.5px; color: var(--muted); }
.lx-share i { display: block; height: 6px; border-radius: 3px; background: var(--ink-2); position: relative; overflow: hidden; }
.lx-share i b { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; background: var(--leaf); }
.lx-share span { font-family: var(--f-mono); color: var(--text); }
.lx-empty { padding: 14px; border: 1px dashed var(--line); border-radius: 10px; color: var(--muted); font-size: 13px; }
.lx-card.lead { border-color: color-mix(in srgb, var(--brass) 60%, var(--line)); }
.lx-role { display: inline-block; margin-bottom: 3px; padding: 1px 8px; border-radius: 9px; font-size: 11.5px; font-weight: 600; color: var(--ink); background: var(--brass-hi); }
.lx-role[hidden] { display: none; }
.lx-mini { display: none; grid-column: 1 / -1; gap: 4px; }
.lx-mini canvas { display: block; width: 100%; height: auto; border-radius: 6px; border: 1px solid var(--line); image-rendering: pixelated; }
.lx-mini span { font-size: 11.5px; line-height: 1.4; color: var(--muted); }
@media (max-width: 900px) { .lx-card[aria-pressed="true"] .lx-mini { display: grid; } }
.lx-hero { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 12px; align-items: center; margin: 0; padding: 10px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--brass) 45%, var(--line)); background: color-mix(in srgb, var(--brass) 8%, transparent); }
.lx-hero .lx-pt { width: 96px; height: 96px; }
.lx-hero figcaption { display: grid; gap: 2px; min-width: 0; }
.lx-hero small { font-size: 11.5px; font-weight: 600; color: var(--brass-hi); }
.lx-hero .lx-name { font-size: 17px; }
.lx-hero .lx-desc { margin-top: 0; }
@media (min-width: 560px) and (max-width: 900px) { .lx-cards { grid-template-columns: 1fr 1fr; } }
`;
  function ensureDexStyle() {
    if (document.getElementById('life-dex-style')) return;
    const st = document.createElement('style');
    st.id = 'life-dex-style';
    st.textContent = DEX_CSS;
    document.head.appendChild(st);
  }
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function sizeCv(cv) {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return null;
    const d = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
    const c = cv.getContext('2d');
    c.setTransform(d, 0, 0, d, 0, 0);
    c.clearRect(0, 0, w, h);
    return [c, w, h];
  }
  function feedName(sp) {
    if (sp.troph === 0) return sp.energy === 'chemo' ? '화학합성 (열수구의 화학 에너지)' : sp.energy === 'photo' ? '광합성 (산소를 내지 않음)' : '광합성 (산소를 내뿜음)';
    if (sp.troph === 1) return sp.cx >= 3 ? '풀·조류를 먹거나 걸러 먹음' : '다른 미생물을 먹음';
    return '다른 동물을 사냥함';
  }
  function drawPortraitInto(cv, s, sp) {
    const r = sizeCv(cv);
    if (!r) return false;
    const [c, w, h] = r;
    const pc = portraitOf(s, sp, Math.round(Math.min(w, h)));
    if (pc) c.drawImage(pc, 0, 0, w, h);
    else fallbackSprite(c, sp, w / 2, h / 2, Math.min(w, h) * 0.8);
    return true;
  }
  // 나타난 지 얼마나 됐는지 (도감을 갱신할 때마다 다시 씀)
  function ageText(s, q) { const age = Math.max(0, s.t - q.born); return age < 1 ? '방금 나타남' : `${WS.fmtYears(age * 1e6)} 전에 나타남`; }
  function descOf(s, q) {
    if (!WS.Creature || !WS.Creature.describe) return '';
    try { const g = s.genomeOf(q); return g ? WS.Creature.describe(g, s.traitsOf(q)) : ''; } catch (e) { return ''; }
  }
  // 연대기와 끝 카드가 말하는 주인공: 문명을 세웠거나 문명에 가장 가까운 지성 종
  function leadRole(s, q) { return q === s.sapientSp ? (s.reached.civ ? '문명을 세운 종' : '문명에 가장 가까운 종') : ''; }
  function cardHTML(s, q) {
    const desc = descOf(s, q);
    const meta = [feedName(q), q.aerobic ? '산소로 호흡' : '산소 없이 삶', `좋아하는 기온 ${Math.round(q.topt)}°C`];
    let bars = '';
    if (q.troph > 0 && q.cx >= 3) {
      // 표시는 0–100까지 (모형의 지능 상한은 1.01이라 그대로 곱하면 101이 된다)
      const row = (lb, v, col) => { const p = Math.min(100, Math.round(v * 100)); return `<span>${lb}</span><i><b style="width:${p}%;background:${col}"></b></i><span class="v">${p}</span>`; };
      bars = `<div class="lx-bars">${row('지능', q.intel, 'var(--cyan)')}${row('손재주', q.manip, 'var(--brass)')}${row('사회성', q.social, 'var(--leaf)')}</div>`;
    }
    return `<canvas class="lx-pt" aria-hidden="true"></canvas>
      <div>
        <span class="lx-role" data-role hidden></span>
        <div class="lx-kind">${esc(s.kindName(q))} · ${q.land ? '육지' : '바다'}<span class="lx-onmap" data-onmap hidden>지도에 그려짐</span></div>
        <div class="lx-name">${esc(q.name)}</div>
        ${desc ? `<div class="lx-desc">${esc(desc)}</div>` : ''}
        <div class="lx-meta">${esc(meta.join(' · '))} · <span data-age>${esc(ageText(s, q))}</span></div>
        ${bars}
        <div class="lx-share"><i><b data-share></b></i><span data-pct></span></div>
      </div>
      <div class="lx-mini"><canvas width="${s.W}" height="${s.H}" aria-hidden="true"></canvas><span>노란 곳이 이 종이 사는 곳입니다. 화면 위쪽의 큰 지도에도 같은 곳이 표시됩니다.</span></div>`;
  }
  // 좁은 화면에서는 큰 지도가 도감에서 멀리 떨어져 있어, 고른 카드 안에 작은 서식지 지도를 보여 줌 (넓은 화면에서는 숨겨져 그리지 않음)
  const MINI_HOME = [241, 203, 134], MINI_ICE = [122, 136, 152], MINI_LAND = [66, 80, 60], MINI_SEA = [22, 42, 66];
  function drawMiniMap(b, s, q) {
    const cv = b.querySelector('.lx-mini canvas');
    if (!cv || !cv.clientWidth || !q.pop) return;
    const c = cv.getContext('2d'), img = c.createImageData(s.W, s.H), d = img.data, thr = habitatThr(s, q);
    for (let i = 0; i < s.NC; i++) {
      const col = q.pop[i] > thr ? MINI_HOME : s.ice[i] ? MINI_ICE : s.land[i] ? MINI_LAND : MINI_SEA;
      const k = i * 4;
      d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  }
  // 끝 카드에 주인공 종의 그림을 넣음. 끝 카드는 앱이 만들고 생명 모드는 그 안에 한 칸만 더함 (지도를 그릴 때마다 확인하므로 한 프레임 안에 나타남)
  function syncEndArt(s, app) {
    try {
      const sp = s.sapientSp;
      if (!app || app.sim !== s || !sp || sp.extinct) return;
      const card = document.getElementById('endcard');
      if (!card || card.hidden || card.querySelector('.lx-hero')) return;
      const head = card.querySelector('h3');
      if (!head) return;
      ensureDexStyle();
      const desc = descOf(s, sp);
      const fig = document.createElement('figure');
      fig.className = 'lx-hero';
      fig.innerHTML = `<canvas class="lx-pt" aria-hidden="true"></canvas>
        <figcaption><small>${s.reached.civ ? '이 문명을 세운 종' : '이 세계의 지성 종'}</small><span class="lx-name">${esc(sp.name)}</span><span class="lx-kind">${esc(s.kindName(sp))}</span>${desc ? `<span class="lx-desc">${esc(desc)}</span>` : ''}</figcaption>`;
      head.after(fig);
      drawPortraitInto(fig.querySelector('.lx-pt'), s, sp);
    } catch (e) { /* 그림이 없어도 끝 카드는 그대로 동작 */ }
  }
  function drawPhylo(s, cv) {
    const r = sizeCv(cv);
    if (!r) return;
    const [c, w, h] = r;
    let thr = 0.02;
    let shown = s.all.filter((q) => !q.extinct || q.maxTotal > thr);
    while (shown.length > 120 && thr < 2) { thr *= 1.6; shown = s.all.filter((q) => !q.extinct || q.maxTotal > thr); }
    if (!shown.length) {
      c.fillStyle = '#929aab'; c.font = '12px IBM Plex Sans KR, sans-serif'; c.textAlign = 'center';
      c.fillText('생명이 나타나면 여기에 계통수가 그려집니다', w / 2, h / 2);
      return;
    }
    const set = new Set(shown.map((q) => q.id));
    const anc = (q) => { let p = q.par; while (p && !set.has(p.id)) p = p.par; return p; };
    const kids = new Map(), roots = [], up = new Map();
    for (const q of shown) { const a = anc(q); up.set(q.id, a); if (a) { if (!kids.has(a.id)) kids.set(a.id, []); kids.get(a.id).push(q); } else roots.push(q); }
    const order = [];
    const visit = (q) => { order.push(q); (kids.get(q.id) || []).sort((a, b) => a.born - b.born).forEach(visit); };
    roots.sort((a, b) => a.born - b.born).forEach(visit);
    const t0 = Math.min(...order.map((q) => q.born)), t1 = Math.max(s.t, t0 + 1);
    const padL = 8, padR = 46, padT = 8, padB = 22;
    const X = (t) => padL + ((t - t0) / (t1 - t0)) * (w - padL - padR);
    const rowH = (h - padT - padB) / Math.max(1, order.length);
    const Y = new Map();
    order.forEach((q, i) => Y.set(q.id, padT + (i + 0.5) * rowH));
    // 시간 눈금
    c.font = '10.5px IBM Plex Sans KR, sans-serif'; c.fillStyle = '#929aab'; c.textBaseline = 'middle';
    const spanY = (t1 - t0) * 1e6, step = [2e8, 5e8, 1e9, 2e9].find((v) => spanY / v <= 5) || 2e9;
    c.strokeStyle = 'rgba(146,154,171,.12)'; c.lineWidth = 1;
    for (let v = Math.ceil((t0 * 1e6) / step) * step; v <= t1 * 1e6; v += step) {
      const x = X(v / 1e6);
      c.beginPath(); c.moveTo(x + 0.5, padT); c.lineTo(x + 0.5, h - padB + 2); c.stroke();
      c.textAlign = 'center'; c.fillText(WS.fmtYears(v), WS.clamp(x, 22, w - padR - 10), h - 10);
    }
    order.forEach((q) => {
      const y = Y.get(q.id), x0 = X(q.born), x1 = X(q.extinct === null ? s.t : q.extinct);
      const alive = q.extinct === null;
      c.strokeStyle = WS.rgb(q.color, alive ? 0.95 : 0.35);
      c.lineWidth = alive ? Math.min(2.4, Math.max(1.2, rowH * 0.7)) : 1;
      c.beginPath(); c.moveTo(x0, y); c.lineTo(Math.max(x0 + 1, x1), y); c.stroke();
      const a = up.get(q.id);
      if (a && Y.has(a.id)) { c.lineWidth = 1; c.strokeStyle = 'rgba(146,154,171,.28)'; c.beginPath(); c.moveTo(x0 + 0.5, Y.get(a.id)); c.lineTo(x0 + 0.5, y); c.stroke(); }
    });
    // 지금 선
    const xn = X(s.t);
    c.strokeStyle = 'rgba(241,203,134,.45)'; c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(xn + 0.5, padT); c.lineTo(xn + 0.5, h - padB + 2); c.stroke(); c.setLineDash([]);
    // 번성하는 종의 그림을 오른쪽 끝에 (겹치지 않게 세로로 배치)
    const tips = s.species.filter((q) => Y.has(q.id)).sort((a, b) => (b === s.sapientSp) - (a === s.sapientSp) || b.total - a.total).slice(0, Math.max(1, Math.min(8, Math.floor((h - padT - padB) / 26))));
    const sz = 24, slots = tips.map((q) => ({ q, y: Y.get(q.id) })).sort((a, b) => a.y - b.y);
    for (let i = 0; i < slots.length; i++) slots[i].py = Math.max(padT + sz / 2, i ? slots[i - 1].py + sz + 2 : 0, slots[i].y);
    for (let i = slots.length - 1; i >= 0; i--) slots[i].py = Math.min(slots[i].py, i < slots.length - 1 ? slots[i + 1].py - sz - 2 : h - padB - sz / 2);
    for (const sl of slots) {
      const px = w - padR + 8 + sz / 2;
      c.strokeStyle = WS.rgb(sl.q.color, 0.6); c.lineWidth = 1;
      c.beginPath(); c.moveTo(xn, sl.y); c.lineTo(px - sz / 2 - 2, sl.py); c.stroke();
      c.fillStyle = '#121925'; c.beginPath(); c.arc(px, sl.py, sz / 2 + 1, 0, Math.PI * 2); c.fill();
      c.save(); c.beginPath(); c.arc(px, sl.py, sz / 2, 0, Math.PI * 2); c.clip();
      drawCreature(c, s, sl.q, px, sl.py, sz * 0.95, 1);
      c.restore();
    }
  }
  function renderDex(s, el) {
    ensureDexStyle();
    if (el._lxOwner !== s) {
      el._lxOwner = s; el._init = false; el._lxIds = '';
      el.innerHTML = `<div class="lx">
        <p class="lx-sum" data-sum></p>
        <h4>생물 계통수</h4>
        <canvas class="lx-phylo" aria-label="생물 계통수: 가로축은 시간, 선 하나가 한 종"></canvas>
        <p class="lx-note">가로축은 시간, 선 하나가 한 종입니다. 흐린 선은 멸종한 종, 오른쪽 그림은 지금 가장 번성하는 종입니다(지성 종이 있으면 함께 보여 줍니다).</p>
        <h4>지금 번성하는 생물</h4>
        <p class="lx-note">지성 종을 맨 앞에 두고, 나머지는 생물량이 많은 순서입니다(같은 무리는 3종까지). ‘지도에 그려짐’은 지도에 그림이나 이름표로 나온 생물입니다. 카드를 누르면 그 종이 사는 곳이 지도에 표시되고(좁은 화면에서는 카드 안 작은 지도에도), 다시 누르면 꺼집니다.</p>
        <div class="lx-cards" data-cards></div>
      </div>`;
      el._lxPhyloAt = -1e9; el._lxPhyloSteps = undefined;
      el.querySelector('[data-cards]').addEventListener('click', (ev) => {
        const b = ev.target.closest('.lx-card');
        if (!b) return;
        const id = +b.dataset.id;
        const sim = el._lxOwner;
        sim._hl = sim._hl === id ? 0 : id;
        // 서식지는 지도에 표시되므로 태양계 보기에서 눌렀다면 지도로 돌아감
        if (sim._hl && WS.App && WS.App.sim === sim && WS.App.view === SPACE_VIEW) WS.App.setView(0);
        el.querySelectorAll('.lx-card').forEach((x) => x.setAttribute('aria-pressed', +x.dataset.id === sim._hl ? 'true' : 'false'));
        // 작은 지도가 펼쳐졌으면 바로 그리고, 화면 밖으로 밀려나지 않게 함 (넓은 화면에서는 작은 지도가 숨겨져 아무 일도 없음)
        const q = sim._hl === id ? sim.byId.get(id) : null, mini = b.querySelector('.lx-mini canvas');
        if (q && mini && mini.clientWidth) {
          drawMiniMap(b, sim, q);
          b.scrollIntoView({ block: 'nearest' });
        }
      });
    }
    const sum = el.querySelector('[data-sum]');
    sum.innerHTML = s.species.length ? `지금 살아 있는 종 <b>${s.species.length}종</b> · 지금까지 나타난 종 <b>${s.all.length.toLocaleString('ko-KR')}종</b>` : s.reached.life ? '지금은 살아 있는 생물이 없습니다.' : '아직 생명이 나타나지 않았습니다.';
    const now = performance.now();
    const cv = el.querySelector('.lx-phylo');
    const wantW = cv ? Math.round(cv.clientWidth * Math.min(2, window.devicePixelRatio || 1)) : 0;
    if (cv && wantW && (el._lxPhyloSteps === undefined || cv.width !== wantW || (el._lxPhyloSteps !== s.steps && now - el._lxPhyloAt > 1000))) {
      drawPhylo(s, cv); el._lxPhyloAt = now; el._lxPhyloSteps = s.steps;
    }
    const box = el.querySelector('[data-cards]');
    // 생물량 순이되 같은 무리는 3종까지 (생김새가 다양한 종들을 보여 주려고), 남는 자리는 다시 생물량 순으로
    const sorted = s.species.slice().sort((a, b) => b.total - a.total), per = new Map(), top = [];
    const add = (q) => { const k = s.kindName(q); top.push(q); per.set(k, (per.get(k) || 0) + 1); };
    // 지성 종은 생물량이 적어도 꼭 맨 앞에 (연대기와 끝 카드가 말하는 주인공을 도감에서 찾을 수 있게). 주인공 + 다른 지성 종 3종까지
    const dexRank = (q) => (q === s.sapientSp ? 0 : q.sapient ? 1 : 2);
    sorted.filter((q) => q.sapient).sort((a, b) => dexRank(a) - dexRank(b)).slice(0, 4).forEach(add);
    // 지도에 이름표나 렌즈로 그려진 종도 꼭 넣음 (지도에서 본 생물을 도감에서 찾을 수 있게)
    const spr = s._vis && s._vis.spr, onMap = new Set();
    if (spr) for (const it of spr.labels.concat(spr.lenses)) if (it.sp && it.sp.pop && !it.sp.extinct) onMap.add(it.sp);
    let nMap = 0;
    for (const q of sorted) if (onMap.has(q) && nMap < 6 && !top.includes(q)) { add(q); nMap++; }
    for (const q of sorted) if (top.length < 12 && !top.includes(q) && (per.get(s.kindName(q)) || 0) < 3) add(q);
    for (const q of sorted) if (top.length < 12 && !top.includes(q)) top.push(q);
    top.sort((a, b) => dexRank(a) - dexRank(b) || b.total - a.total);
    const ids = top.map((q) => q.id + (q.sapient ? 's' : '')).join(',');
    if (s._hl && !s.byId.get(s._hl)?.pop) s._hl = 0;
    if (ids !== el._lxIds) {
      el._lxIds = ids;
      if (!top.length) box.innerHTML = `<div class="lx-empty">${s.reached.life ? '살아 있는 생물이 없습니다.' : '생명이 나타나면 이곳에 종마다 카드가 생깁니다.'}</div>`;
      else {
        const old = new Map();
        box.querySelectorAll('.lx-card').forEach((b) => old.set(b.dataset.key, b));
        const frag = document.createDocumentFragment();
        for (const q of top) {
          const key = q.id + (q.sapient ? 's' : '');
          let b = old.get(key);
          if (!b) {
            b = document.createElement('button');
            b.type = 'button'; b.className = 'lx-card'; b.dataset.id = q.id; b.dataset.key = key;
            b.setAttribute('aria-label', `${s.kindName(q)} ${q.name}: 지도에 서식지 표시`);
            b.innerHTML = cardHTML(s, q);
            b._drawn = false;
          }
          b.setAttribute('aria-pressed', s._hl === q.id ? 'true' : 'false');
          frag.appendChild(b);
        }
        box.innerHTML = '';
        box.appendChild(frag);
      }
    }
    const tot = s.species.reduce((a, q) => a + q.total, 0) || 1;
    let fresh = 3;
    box.querySelectorAll('.lx-card').forEach((b) => {
      const q = s.byId.get(+b.dataset.id);
      if (!q) return;
      if (!b._drawn && fresh > 0) { fresh--; b._drawn = drawPortraitInto(b.querySelector('.lx-pt'), s, q); }
      const pct = (q.total / tot) * 100;
      b.querySelector('[data-share]').style.width = Math.min(100, pct).toFixed(1) + '%';
      b.querySelector('[data-pct]').textContent = `생물량의 ${pct < 1 ? pct.toFixed(1) : Math.round(pct)}%`;
      b.setAttribute('aria-pressed', s._hl === q.id ? 'true' : 'false');
      const at = ageText(s, q), ae = b.querySelector('[data-age]');
      if (ae && ae.textContent !== at) ae.textContent = at;
      const om = b.querySelector('[data-onmap]');
      if (om && om.hidden === onMap.has(q)) om.hidden = !onMap.has(q);
      const role = leadRole(s, q), re = b.querySelector('[data-role]');
      if (re && re.textContent !== role) {
        re.textContent = role; re.hidden = !role;
        b.classList.toggle('lead', !!role);
        b.setAttribute('aria-label', `${role ? role + ', ' : ''}${s.kindName(q)} ${q.name}: 지도에 서식지 표시`);
      }
      if (s._hl === q.id) drawMiniMap(b, s, q);
    });
  }

  /* ---------- 태양계 보기: 세계 상태를 읽기만 함 (화면 전용 값은 s._vis.space에 둠) ---------- */
  const SPACE_VIEW = 3;
  const BODY_FACT = {
    mercury: '가장 안쪽 행성입니다. 공기가 거의 없어 낮과 밤의 온도 차가 아주 큽니다.',
    venus: '두꺼운 구름이 온실처럼 열을 가두어 표면이 납도 녹일 만큼 뜨겁습니다.',
    mars: '옅은 공기를 가진 붉은 사막 행성입니다. 옛날에 물이 흐른 흔적이 남아 있습니다.',
    ceres: '소행성대에서 가장 큰 천체입니다. 얼음이 많습니다.',
    jupiter: '가장 큰 행성입니다. 떠도는 소행성을 쓸어 내어 안쪽 행성에 떨어지는 충돌을 줄여 줍니다.',
    europa: '목성의 위성입니다. 두꺼운 얼음 밑에 바다가 있습니다.',
    ganymede: '목성의 위성으로, 위성 가운데 가장 큽니다. 자기장도 있습니다.',
    saturn: '커다란 고리를 두른 가스 행성입니다.',
    titan: '토성의 위성입니다. 두꺼운 대기와 메탄 호수가 있습니다.',
    uranus: '옆으로 누운 채 도는 얼음 거인입니다.',
    neptune: '가장 바깥쪽 행성입니다. 얼음 거인이고 바람이 아주 거셉니다.',
    triton: '해왕성의 위성입니다. 행성이 도는 방향과 거꾸로 돕니다.',
  };
  const STALE_MYR = 150; // 자연 충돌은 이만큼(백만 년) 지나면 장면으로 틀지 않음. 늦게 틀면 자막의 시각과 화면의 행성이 어긋남
  const LOOK_NAME = { gas: '가스로 된 거대 행성', ice: '얼음으로 덮인 행성', ocean: '물이 있는 돌 행성', rocky: '메마른 돌 행성' };
  function spaceOf(s) {
    const V = visOf(s);
    if (V.space) return V.space;
    const P = s.P, sys = WS.systemBodies(s.system, { moon: P.moon, giant: P.giant, homeName: P.kind === 'earth' ? '지구' : P.name });
    const home = sys.bodies.find((b) => b.home);
    const key = s.system ? 'sys:' + s.seed : P.kind === 'earth' && P.moon && P.giant ? 'solar' : `solar:${home.name}:${P.moon ? 1 : 0}${P.giant ? 1 : 0}`;
    return (V.space = {
      key, star: sys.star, bodies: sys.bodies, belt: sys.belt, hidden: sys.hidden || 0, staleAfter: STALE_MYR, clock: s.t, bombard: 0, impacts: [], settlements: [], traffic: 0, interstellar: null, homeEmpty: false, caption: '', emptyNote: null,
      home: { id: home.id, name: home.name, atmosphere: atmoColor(s), surface: () => surfaceOf(s), dust: 0, popText: null },
      glow0: sys.star.glow, seen: 0,
    });
  }
  /* 우주에서 본 행성 겉모습 (행성이 크게 보일 때만 불림). 지도와 같은 색 계산을 쓰되 버퍼를 따로 두어 지도 텍스처 캐시는 읽기만 함.
     지도를 그리는 중이면 그 그림을 복사하고, 태양계 보기에서는 space.before가 프레임마다 조금씩 칠해 둠 (한 번에 칠하면 수십 ms라 장면이 끊김) */
  function surfaceBuf(V) {
    return V.surf || (V.surf = { w: TW, h: TH, rgba: new Uint8ClampedArray(TW * TH * 4), back: new Uint8ClampedArray(TW * TH * 4), lights: null, ver: 0, stamp: null, job: null, ts: -1e9 });
  }
  function surfaceStep(s, V, budget, nowMs) {
    const B = surfaceBuf(V);
    if (!B.job) {
      const stamp = s.steps + ':' + V.elevT;
      if (B.stamp === stamp || nowMs - B.ts < 1000) return false;
      B.job = paintJob(s, 0, stamp, { data: B.back });
      B.job.wavy = true;
      B.job.F.scorch.fill(0); // 불탄 자국은 충돌 장면이 직접 그림 (돌이 닿기 전에 미리 보이면 안 됨)
    }
    if (paintRows(s, V, B.job, budget)) {
      const t = B.rgba; B.rgba = B.back; B.back = t;
      B.stamp = B.job.stamp; B.hot = B.job.hot; B.job = null; B.ts = nowMs; B.ver++;
    }
    return true;
  }
  function surfaceOf(s) {
    const V = visOf(s), B = surfaceBuf(V), nowMs = performance.now();
    if (V.tex0Ts > B.ts) { B.rgba.set(V.img[0].data); B.stamp = null; B.hot = molten(s); B.ts = V.tex0Ts; B.ver++; return B; }
    if (!V.elev) ensureElev(s, V);
    surfaceStep(s, V, B.ver ? 3 : 0, nowMs);
    return B;
  }
  function impactView(s, q) {
    const x = q.c % s.W, y = (q.c / s.W) | 0;
    return { n: q.n, D: q.D, t: q.t, user: !!q.god, lo: ((x + 0.5) / s.W) * 360 - 180, la: 90 - ((y + 0.5) / s.H) * 180, title: `지름 ${Math.round(q.D)} km 소행성`, sub: '행성 나이 ' + WS.fmtYears(q.t * 1e6) };
  }
  function spaceSeq(s) { const b = s.bigImpacts; return b.length ? b[b.length - 1].n : 0; }
  // 앱이 태양계 보기에서는 render 대신 부름: 끝 카드 그림을 유지하고, 충돌 장면에 쓸 지형과 겉모습을 한 프레임 1 ms 안쪽으로 따라오게 함
  function spaceBefore(s, app) {
    if (s.ended) syncEndArt(s, app);
    const V = visOf(s);
    if (!V.elev || !surfaceStep(s, V, 1, performance.now())) ensureElev(s, V, 1);
  }
  // 떨어지는 소행성의 빈도: 초기 대폭격 때 1, 대폭격이 끝나면 거의 0
  const spaceBombard = (s) => WS.clamp((s.impactRate() - 0.04) / 2.4, 0, 1);
  function scene(s) {
    const S = spaceOf(s), seq = spaceSeq(s);
    if (seq !== S.seen) { S.seen = seq; S.impacts = s.bigImpacts.map((q) => impactView(s, q)); }
    // 별은 나이가 들수록 조금씩 밝아짐 (이어받은 행성의 P.flux는 별 밝기가 아니라 궤도 거리에서 온 값)
    S.star.glow = WS.clamp(S.glow0 * s.starLum() * (s.P.kind === 'inherit' ? cond(s, 'flux', 1) : s.P.flux), 0.6, 1.8);
    S.bombard = spaceBombard(s);
    // 칠해 둔 표면은 조금 늦으니 구름과 대기도 그 표면에 맞춥니다: 용암 위에 흰 구름이 뜨지 않게
    const surf = visOf(s).surf, steam = surf && surf.ver ? !!surf.hot : molten(s);
    S.home.steam = steam;
    S.home.atmosphere = steam ? STEAM_AIR : atmoColor(s);
    // 충돌 흙먼지. 충돌 장면이 직접 그리는 몫이 있으니 약하게: 돌이 닿기 전부터 행성이 뿌옇거나 대폭격 때 용암이 가려지면 안 됨
    S.home.dust = WS.clamp(s.winter / 120 + s.darkness * 0.25, 0, 0.5);
    S.caption = s.timeLabel();
    S.clock = s.t;
    return S;
  }
  function homeFacts(s, name) {
    const R = s.reached, sap = s.sapientSp && !s.sapientSp.extinct ? s.sapientSp : null;
    const sea = s.Tg > 100 ? (R.ocean ? '바다가 끓고 있습니다' : '표면이 녹아 있어 아직 바다가 없습니다') : s.inSnowball ? '바다까지 얼음에 덮여 있습니다' : s.oceanFrac > 0.02 ? `바다가 표면의 ${Math.round(s.oceanFrac * 100)}%를 덮고 있습니다` : '바다가 거의 없습니다';
    const n = s.species.length, life = !n ? (R.life ? '생명이 모두 사라졌습니다' : s.ended ? '생명이 태어나지 않았습니다' : '아직 생명이 없습니다') : `생물 ${n}종이 살고 있습니다`;
    return [name, `평균 기온 ${Math.round(s.Tg)}°C`, sea, life].concat(sap ? [`지성 종: ${sap.name}`] : []);
  }
  function spaceInspect(s, id) {
    const S = spaceOf(s), b = S.bodies.find((q) => q.id === id);
    if (id === 'sun' || id === 'star') {
      const st = s.system && s.system.star;
      return [S.star.name, '행성들을 붙잡아 두고 빛과 열을 보내는 별입니다. 나이가 들수록 조금씩 밝아집니다.', st ? `질량: 태양의 ${WS.trimNum(st.mass)}배` : `지금 밝기: 오늘날 태양의 ${Math.round(s.P.flux * s.starLum() * 100)}%`];
    }
    if (!b) return null;
    if (b.home) return homeFacts(s, b.name);
    const lines = [b.name];
    if (b.parent) {
      const pa = S.bodies.find((q) => q.id === b.parent);
      lines.push(id === 'moon' ? `${pa ? pa.name : S.home.name}의 위성입니다. 자전축을 붙잡아 기후가 크게 흔들리지 않게 해 줍니다.` : BODY_FACT[id] || '거대 행성 둘레를 도는 위성입니다.');
      return lines;
    }
    const q = s.system && s.system.planets ? s.system.planets.find((p) => p.name === b.name) : null;
    if (q) {
      lines.push(q.m >= 10 && q.m < 50 ? '얼음 거인' : LOOK_NAME[b.look] || '행성', `질량: 지구의 ${WS.trimNum(q.m)}배`);
      if (q.moons > 0) lines.push(`위성 ${q.moons}개`);
    } else if (BODY_FACT[id]) lines.push(BODY_FACT[id]);
    lines.push(`${S.star.name}까지 거리: 지구와 태양 사이의 ${WS.trimNum(q && q.au > 0 ? q.au : b.a)}배`);
    return lines;
  }
  function spaceLegend(s) {
    const S = spaceOf(s), P = s.P;
    const L = [{ color: WS.rgb(atmoColor(s)), label: `${S.home.name}: 지켜보는 행성` }];
    if (S.belt) L.push({ color: '#a89f8e', label: '작은 점의 띠: 소행성대' });
    if (spaceBombard(s) > 0.03) L.push({ color: '#f1cb86', label: '희미한 빛줄기: 쏟아지는 소행성' });
    L.push({ color: '#ff9a5a', label: '큰 충돌은 가까이 다가가 보여 줍니다' });
    if (!s.system) {
      if (!P.giant) L.push({ color: '#6b7280', label: '목성 같은 거대 가스 행성이 없어 소행성이 2배 넘게 자주 옵니다' });
      if (!P.moon) L.push({ color: '#6b7280', label: '달이 없어 기후가 더 크게 흔들립니다' });
    }
    return L;
  }

  /* ---------- 실험실 연결 ---------- */
  const HORIZONS = [[1e9, '10억 년'], [2e9, '20억 년'], [3e9, '30억 년'], [4.57e9, '45.7억 년 (오늘의 지구 나이)', true], [6.2e9, '62억 년 (먼 미래)']];
  const mulFmt = (v) => '×' + (v >= 10 ? Math.round(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
  const tenFmt = (v) => { const x = Math.pow(10, Math.abs(v)); return x >= 100 ? Math.round(x).toLocaleString('ko-KR') : x.toFixed(1).replace(/\.0$/, ''); };

  WS.registerMode({
    id: 'life',
    name: '생명',
    when: '45억 년 전',
    question: '생명은 또 태어날까? 같은 길로 진화할까?',
    desc: '갓 생긴 행성에서 시작합니다. 바다가 생기고, 생명이 우연히 태어나고, 산소가 쌓이고, 빙하기와 운석이 생명을 시험합니다. 지성을 가진 종이 나타나는지, 나타난다면 언제인지 지켜보세요.',
    setup: [
      { id: 'planet', label: '행성', value: 'earth', options: [['earth', '원시 지구와 같은 조건'], ['random', '무작위 행성']] },
      { id: 'abio', label: '생명 탄생의 어려움', value: 'earth', options: [['earth', '지구 기록만큼 쉬움'], ['unknown', '알 수 없음 (매번 무작위)'], ['rare', '매우 드묾']] },
    ],
    baseRate: 22,
    sampleEvery: 5,
    powerRegenSec: 6,
    views: ['풍경', '생물 분포', '기온', '태양계'],
    create: (opts, seed, inherit) => new Life(opts, seed, inherit),
    step: (s) => s.tick(),
    render,
    space: {
      view: SPACE_VIEW,
      scene,
      inspect: spaceInspect,
      impactSeq: spaceSeq,
      before: spaceBefore,
      site(s, imp, W, H) { const R = lastRect(s, W, H); return imp.lo == null ? null : [R.x0 + ((imp.lo + 180) / 360) * R.w, R.y0 + ((90 - imp.la) / 180) * R.h]; },
    },
    era,
    stats,
    legend,
    narrate,
    eventArt,
    pick(s, x, y, W, H) {
      const R = lastRect(s, W, H);
      const u = (x - R.x0) / R.w, v = (y - R.y0) / R.h;
      if (u < 0 || v < 0 || u >= 1 || v >= 1) return null;
      return { c: Math.floor(v * s.H) * s.W + Math.floor(u * s.W), u, v };
    },
    inspect(s, w) {
      const c = w.c;
      let plant = 0;
      for (const q of s.species) if (q.land && q.troph === 0) plant += q.pop[c];
      const head = s.Tg > 100 ? (s.reached.ocean ? '끓는 바다' : '녹은 암석') : s.land[c] ? (s.ice[c] ? '빙하' : plant > 0.4 ? '육지 · 숲' : plant > 0.03 ? '육지 · 이끼와 풀' : '육지 · 맨땅') : s.ice[c] ? '얼어붙은 바다' : s.vent[c] > 0.3 ? '바다 · 열수구 근처' : '바다';
      const lines = [head, `기온 ${Math.round(s.temp[c])}°C`];
      let tot = 0;
      for (const q of s.species) tot += q.pop[c];
      const here = s.species.filter((q) => q.pop[c] > 0.001).sort((a, b) => b.pop[c] - a.pop[c]).slice(0, 3);
      here.forEach((q) => lines.push(`${s.kindName(q)} · ${q.name} (${Math.round((q.pop[c] / tot) * 100)}%)`));
      if (!here.length && s.reached.life) lines.push('생물 없음');
      return lines;
    },
    sample: (s) => ({ T: s.Tg, o2: Math.max(1e-6, s.o2 * 21), sp: s.species.length, co2: s.co2 * 280 }),
    chart: [
      { key: 'T', label: '기온', color: '#e46a4e', fmt: (v) => Math.round(v) + '°C' },
      { key: 'o2', label: '산소', color: '#84c6d2', log: true, fmt: (v) => (v < 0.01 ? '≈0' : fmtPct(v)) },
      { key: 'sp', label: '종 수', color: '#96cf88', fmt: (v) => String(Math.round(v)) },
      { key: 'co2', label: 'CO₂', color: '#d8a85b', log: true, fmt: fmtCO2 },
    ],
    interventions: [
      {
        id: 'bolt', name: '번개', icon: 'bolt', cost: 1, target: 'point',
        desc: '생명이 생기기 전에는 원시 바다에 에너지를 더해 생명 탄생을 돕습니다. 생명이 생긴 뒤에는 땅 위의 식물과 동물이 사는 곳에 떨어져야 불을 냅니다. 바다나 맨땅에 떨어지면 아무 일도 일어나지 않습니다.',
        apply(s, w) {
          const c = w.c;
          if (!s.species.length) {
            s.addFx({ type: 'bolt', x: w.u, y: w.v, life: 0.7 });
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const y = ((c / s.W) | 0) + dy;
              if (y < 0 || y >= s.H) continue;
              s.soup[y * s.W + (((c % s.W) + dx + s.W) % s.W)] += 1;
            }
            return '번개가 원시 바다의 분자들을 흔들었습니다';
          }
          // 생명이 생긴 뒤: 땅 위 생물이 있는 곳에만 효과 (바다나 맨땅에 떨어진 번개는 아무것도 바꾸지 않음 → false: 개입력 환불, 실험실은 '적용되지 않음')
          let plant = 0, any = false;
          if (s.land[c]) for (const q of s.species) if (q.land && q.pop && q.pop[c] > 0) { any = true; if (q.troph === 0) plant += q.pop[c]; }
          if (!any) return false;
          s.addFx({ type: 'bolt', x: w.u, y: w.v, life: 0.7 });
          for (const q of s.species) if (q.land) q.pop[c] *= 0.3;
          s.scorch[c] = 1;
          return plant > 0.4 ? '번개가 숲에 불을 냈습니다' : '번개가 떨어져 들불이 났습니다';
        },
      },
      {
        id: 'meteor', name: '운석', icon: 'meteor', cost: 4, target: 'point',
        desc: '고른 곳에 소행성이 떨어집니다. 크기는 하늘이 정합니다.',
        apply(s, w) { const D = s.rng.range(8, 70); s.fxAll = true; s.impact(D, w.c); s.fxAll = false; return `지름 ${Math.round(D)} km 소행성을 떨어뜨렸습니다`; },
      },
      {
        id: 'volcano', name: '화산', icon: 'volcano', cost: 3, target: 'point',
        desc: '거대한 화산을 깨웁니다. 이산화탄소가 늘어 행성이 따뜻해지고, 주변 생물은 사라집니다.',
        apply(s, w) { s.volcano(w.c, false); return '거대한 화산이 깨어났습니다'; },
      },
      {
        id: 'cosmic', name: '우주선 폭풍', icon: 'dna', cost: 2, target: 'global',
        desc: '강한 우주선이 쏟아져 한동안 돌연변이가 크게 늘어납니다.',
        available: (s) => s.species.length > 0,
        apply(s) { s.mutBoost = 4; s.mutUntil = s.t + 20; return '우주선이 쏟아져 돌연변이가 늘어납니다 (약 2천만 년)'; },
      },
      {
        id: 'butterfly', name: '나비의 날갯짓', icon: 'butterfly', cost: 1, target: 'global', labOnly: true,
        desc: '세계를 거의 바꾸지 않는 가장 작은 흔들림입니다. 한 종의 한 곳 개체 수를 0.01% 늘립니다(생물이 없으면 이산화탄소를 0.01% 늘립니다). 이 작은 차이가 시간이 지나며 커지는지 봅니다.',
        apply(s) {
          const live = s.species.filter((q) => q.total > 0 && q.pop);
          if (!live.length) { s.co2 *= 1.0001; return '나비의 날갯짓: 대기의 이산화탄소가 0.01% 달라졌습니다'; }
          const sp = live[Math.floor(s.rng.next() * live.length)];
          let c = s.pickCell(sp);
          if (c < 0) c = sp.pop.findIndex((v) => v > 0);
          if (c < 0) { s.co2 *= 1.0001; return '나비의 날갯짓: 대기의 이산화탄소가 0.01% 달라졌습니다'; }
          sp.pop[c] *= 1.0001;
          return `나비의 날갯짓: ${s.kindName(sp)} 한 무리의 개체 수가 0.01% 달라졌습니다`;
        },
      },
    ],
    extra: { label: '생물 도감', render: (s, el) => renderDex(s, el) },
    milestones: [
      { id: 'ocean', name: '첫 바다', real: 1.5e8, realLabel: '44억 년 전' },
      { id: 'life', name: '최초의 생명', real: 7.7e8, realLabel: '약 38억 년 전' },
      { id: 'oxy', name: '산소 광합성 (남세균)', real: 1.67e9, realLabel: '약 29억 년 전' },
      { id: 'goe', name: '산소 대폭발', real: 2.17e9, realLabel: '24억 년 전' },
      { id: 'snowball', name: '눈덩이 행성', real: 2.27e9, realLabel: '23억 년 전' },
      { id: 'euk', name: '진핵생물', real: 2.57e9, realLabel: '약 20억 년 전' },
      { id: 'multi', name: '다세포 생물', real: 3.37e9, realLabel: '약 12억 년 전' },
      { id: 'cambrian', name: '복잡한 동물 (캄브리아기 대폭발)', real: 4.03e9, realLabel: '5.4억 년 전' },
      { id: 'massext', name: '첫 대멸종', real: 4.125e9, realLabel: '4.45억 년 전' },
      { id: 'landplant', name: '육상 식물', real: 4.1e9, realLabel: '4.7억 년 전' },
      { id: 'landanimal', name: '육상 동물', real: 4.15e9, realLabel: '4.2억 년 전' },
      { id: 'impactext', name: '소행성 충돌 대멸종 (공룡 멸종)', real: 4.504e9, realLabel: '6600만 년 전' },
      { id: 'sapient', name: '지적 생명 (호모 사피엔스)', real: 4.5697e9, realLabel: '30만 년 전' },
      { id: 'civ', name: '농경과 문명', real: 4.56999e9, realLabel: '1만 년 전' },
    ],
    realName: '지구',
    compare: { min: 0, max: 6.2e9, ticks: [[1e9, '10억'], [2e9, '20억'], [3e9, '30억'], [4e9, '40억'], [5e9, '50억 년']] },
    experiment: {
      clock: (s) => s.timeValue(),
      axis: 'lin',
      span: () => [0, 4.57e9],
      horizonOptions: () => HORIZONS.map(([value, label, def]) => (def ? { value, label, def: true } : { value, label })),
      setHorizon(opts, x1) { opts.until = x1; },
      xfmt: (x) => (x <= 0 ? '0년' : WS.fmtYears(x)),
      maxSteps: 6000,
      metrics: [
        { key: 'T', label: '평균 기온', get: (s) => s.Tg, log: false, scale: 8, fmt: (v) => Math.round(v) + '°C', color: '#e46a4e' },
        { key: 'o2', label: '대기 중 산소', get: (s) => Math.max(1e-6, s.o2 * 21), log: true, scale: 0.5, fmt: (v) => fmtPct(v), color: '#84c6d2' },
        { key: 'species', label: '살아 있는 종 수', get: (s) => s.species.length + 1, log: true, scale: 0.15, fmt: (v) => Math.max(0, Math.round(v - 1)) + '종', color: '#96cf88' },
        { key: 'cx', label: '가장 복잡한 생물', get: (s) => s.maxCx(), log: false, scale: 0.5, fmt: (v) => (v < -0.5 ? '생명 없음' : CX_NAME[WS.clamp(Math.round(v), 0, 4)]), color: '#d8a85b' },
        { key: 'intel', label: '동물의 최고 지능 (0–100)', get: (s) => s.maxIntel(), log: false, scale: 0.1, fmt: (v) => String(Math.min(100, Math.round(v * 100))), color: '#c39be0' },
      ],
      outcomes: OUTCOMES,
      classify,
      conditions: [
        { key: 'flux', label: '햇빛의 세기', desc: '중심별이 얼마나 밝은지입니다. 밝으면 따뜻해지고 어두우면 추워지지만, 화산과 암석이 이산화탄소를 늘리고 줄여 기온 변화를 꽤 많이 되돌려 놓습니다.', min: 0.8, max: 1.25, step: 0.01, def: 1, kind: 'mult', fmt: mulFmt },
        { key: 'ocean', label: '바다의 넓이', desc: '행성 표면 중 바다의 비율입니다 (지구 71%). 원시 지구 조건에서만 적용됩니다.', min: 0.1, max: 0.97, step: 0.01, def: 0.71, kind: 'abs', fmt: (v) => Math.round(v * 100) + '%' },
        { key: 'moon', label: '큰 달', desc: '큰 달은 자전축을 붙잡아 기후를 안정시킵니다. 없으면 기후가 더 크게 요동칩니다. (무작위 행성에서는 "있음"이면 행성 설정을 따릅니다)', min: 0, max: 1, step: 1, def: 1, kind: 'bool', fmt: (v) => (v >= 0.5 ? '있음' : '없음') },
        { key: 'giant', label: '목성 같은 거대 행성', desc: '바깥의 거대 행성이 소행성을 막아 줍니다. 없으면 충돌이 두 배 넘게 잦아집니다.', min: 0, max: 1, step: 1, def: 1, kind: 'bool', fmt: (v) => (v >= 0.5 ? '있음' : '없음') },
        { key: 'abio', label: '생명 탄생의 쉬움', desc: '무생물에서 생명이 생겨나는 확률을 몇 배로 바꿀지입니다 (0 = 기본).', min: -3, max: 3, step: 0.5, def: 0, kind: 'abs', fmt: (v) => (Math.abs(v) < 1e-9 ? '기본' : v > 0 ? `${tenFmt(v)}배 쉬움` : `${tenFmt(v)}배 어려움`) },
        { key: 'impacts', label: '소행성 충돌 빈도', desc: '소행성이 떨어지는 빈도를 몇 배로 할지입니다.', min: 0.25, max: 4, step: 0.05, def: 1, kind: 'mult', fmt: mulFmt },
        { key: 'mutation', label: '진화의 속도', desc: '새 종이 생겨날 때 큰 변화(광합성, 산소 호흡, 진핵세포, 다세포 몸, 육상 진출, 더 높은 지능)가 일어날 확률을 몇 배로 할지입니다. 빠를수록 다음 단계로 넘어갈 기회가 많아집니다.', min: 0.25, max: 4, step: 0.05, def: 1, kind: 'mult', fmt: mulFmt },
        { key: 'tect', label: '화산·판 구조 활동', desc: '화산이 이산화탄소를 내뿜는 정도입니다. 행성의 온도 조절 장치 역할을 합니다.', min: 0.3, max: 2, step: 0.05, def: 1, kind: 'mult', fmt: mulFmt },
      ],
      presets: [
        { label: '달이 없는 지구', desc: '큰 달이 없어 자전축이 흔들리고 기후가 더 요동칩니다.', cond: { moon: 0 } },
        { label: '더 밝은 태양', desc: '햇빛이 10% 더 강합니다. 더 따뜻한 세상이 되지만, 탄소 순환이 기온을 어느 정도 붙잡아 줍니다.', cond: { flux: 1.1 } },
        { label: '소행성이 잦은 행성', desc: '소행성이 세 배 자주 떨어집니다.', cond: { impacts: 3 } },
        { label: '바다 행성', desc: '육지가 5%뿐인 물의 세계입니다.', cond: { ocean: 0.95 } },
        { label: '생명이 드문 우주', desc: '무생물에서 생명이 생겨나기가 100배 어렵습니다.', cond: { abio: -2 } },
      ],
      schedulable: ['bolt', 'meteor', 'volcano', 'cosmic', 'butterfly'],
      targets: [{ key: 'sea', label: '무작위 바다' }, { key: 'land', label: '무작위 육지' }, { key: 'eq', label: '적도' }, { key: 'pole', label: '극지방' }],
      target(s, key, rng) {
        const ok = key === 'land' ? (c) => s.land[c] === 1 : key === 'eq' ? (c) => Math.abs(s.lat[c]) < 0.27 : key === 'pole' ? (c) => Math.abs(s.lat[c]) > 1.05 : (c) => s.land[c] === 0;
        const cand = [];
        for (let c = 0; c < s.NC; c++) if (ok(c)) cand.push(c);
        if (!cand.length) return null;
        const c = cand[Math.floor(rng.next() * cand.length)];
        const p = s.cellXY(c);
        return { c, u: p[0], v: p[1] };
      },
      // 같은 씨앗 쌍둥이 세계의 미세 유사도: 살아 있는 종(같은 계보 id)의 생물량 비율이 겹치는 정도
      similarity(a, b) {
        const key = (q) => q.id + ':' + q.parent + ':' + q.born;
        let ta = 0, tb = 0;
        for (const q of a.species) ta += q.total;
        for (const q of b.species) tb += q.total;
        if (ta <= 0 && tb <= 0) return 1;
        if (ta <= 0 || tb <= 0) return 0;
        const m = new Map();
        for (const q of a.species) m.set(key(q), q.total / ta);
        let sum = 0;
        for (const q of b.species) { const w = m.get(key(q)); if (w !== undefined) sum += Math.min(w, q.total / tb); }
        return WS.clamp(sum, 0, 1);
      },
      eventIds: ['life', 'goe', 'euk', 'multi', 'cambrian', 'landanimal', 'sapient', 'civ'],
    },
    batch: {
      maxSteps: 7000,
      defaultN: 10,
      key: ['life', 'oxy', 'goe', 'euk', 'multi', 'cambrian', 'landanimal', 'sapient'],
      fmt: (v) => WS.fmtYears(v),
      finish: (s) => { s.end('관측 종료', s.summaryText(), s.summaryOutcome()); },
      desc: '같은 행성 조건으로 씨앗만 바꿔 수십억 년을 여러 번 돌립니다. 생명, 산소, 동물, 지성이 각각 얼마나 자주, 언제 나타나는지 셉니다. (실험용은 격자를 줄여 계산합니다)',
    },
    next(s) {
      if (!s.reached.civ || !s.sapientSp) return null;
      const sp = s.sapientSp;
      let best = -1, bv = 0;
      for (let c = 0; c < s.NC; c++) { const v = sp.pop ? sp.pop[c] : 0; if (v > bv) { bv = v; best = c; } }
      return {
        label: '이 종의 문명사 관측',
        mode: 'civ',
        opts: { start: 'alien' },
        inherit: {
          alien: true, W: s.W, H: s.H, land: Array.from(s.land), temp: Array.from(s.temp), elev: Array.from(s.elev), sea: s.sea,
          plant: Array.from({ length: s.NC }, (_, c) => s.species.reduce((m, q) => m + (q.land && q.troph === 0 && q.pop ? q.pop[c] : 0), 0)),
          start: best, species: sp.name, planet: s.P.name, Tg: s.Tg, co2: s.co2,
          genome: s.genomeOf(sp), traits: s.traitsOf(sp), kind: s.kindName(sp),
          system: s.system || null, moon: s.P.moon, giant: s.P.giant,
        },
      };
    },
  });
})();
