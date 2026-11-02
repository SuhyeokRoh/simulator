'use strict';
/* 항성계 형성 모드: 분자운 붕괴(격자 중력+압력) → 원시별(싱크) → 원반 속 행성 배아 충돌·성장 */
(function () {
  const WS = window.WS;
  const Math = window.Math; // 지역 바인딩: 워커·Node vm에서 전역 조회가 느려 뜨거운 고리가 몇 배 빨라짐
  const TAU2 = 4 * Math.PI * Math.PI;
  const ME_SUN = 332946; // 태양 질량 / 지구 질량
  const NG = 64, P = 128;
  const ZOOM_STEPS = 45; // 확대 연출 단계 (헤드리스여도 같게: 궤적이 같아야 함)
  const TT_END = 800; // 관측 기본 끝 (원반 시간 단위, 약 3.8억 년)
  const HZ = '생명 가능 지대';
  // 결말 이름은 여기 한 곳에만 둠: 결말 카드 제목, 해설 제목, 실험실 분류 이름이 모두 같은 말을 쓰게
  const OUT = {
    nostar: '별이 되지 못함', supernova: '별이 일찍 폭발함', binary: '쌍성계', empty: '행성이 자라지 못함', rocky: '작은 행성뿐',
    giants: '거대 행성은 있지만 살 만한 행성은 없음', dry: '메마른 지구형 행성', wet: '물 있는 지구형 행성', earthmoon: '물과 큰 달을 가진 지구형 행성',
  };
  // 행성 이름 글자: b, c, … z 다음은 aa, ab, …
  const letterAt = (n) => (n < 25 ? String.fromCharCode(98 + n) : String.fromCharCode(97 + Math.floor((n - 25) / 26) % 26) + String.fromCharCode(97 + ((n - 25) % 26)));
  // 실험실 조건: 프리셋 값에 곱하는 배수. 모두 기본값이면 프리셋과 똑같이 움직임.
  const cond = (s, k, d) => { const v = s.opts && s.opts.cond ? s.opts.cond[k] : undefined; return typeof v === 'number' && isFinite(v) ? v : d; };

  /* 고립 경계 중력 커널 (FFT, 한 번만 계산) */
  let KC = null;
  function kernel() {
    if (KC) return KC;
    const kx = new Float64Array(P * P), ky = new Float64Array(P * P), zx = new Float64Array(P * P), zy = new Float64Array(P * P);
    const eps2 = 1.2 * 1.2;
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
      const dx = i < P / 2 ? i : i - P, dy = j < P / 2 ? j : j - P;
      const r2 = dx * dx + dy * dy + eps2;
      const f = -NG * NG / (r2 * Math.sqrt(r2)); // 물리 단위 (상자=1, G=1)
      kx[j * P + i] = f * dx;
      ky[j * P + i] = f * dy;
    }
    WS.fft2(kx, zx, P, false);
    WS.fft2(ky, zy, P, false);
    const re = new Float64Array(P * P), im = new Float64Array(P * P);
    for (let i = 0; i < P * P; i++) { re[i] = kx[i] - zy[i]; im[i] = zx[i] + ky[i]; }
    KC = { re, im };
    return KC;
  }

  class Stellar extends WS.SimBase {
    constructor(opts, seed, inherit) {
      opts = opts || {};
      super(seed, opts);
      this.lite = !!this.opts.lite;
      const r = this.rng;
      const kind = inherit ? 'inherit' : opts.cloud || 'solar';
      if (kind === 'solar') { this.Mc = 3.2; this.J = 1.3; this.beta = 0.05; this.Z = 1; }
      else { this.Mc = r.logRange(0.15, 50); this.J = r.logRange(0.6, 3); this.beta = r.range(0.01, 0.18); this.Z = r.logRange(0.1, 3); }
      this.Gk = 1;
      if (inherit) { this.Z = inherit.Z; this.Gk = inherit.G || 1; this.J *= Math.sqrt(this.Gk); }
      // 조건: 구름 질량(무거울수록 중력이 압력을 더 이김), 중원소, 회전, 난류, 원반 질량
      const cm = cond(this, 'mass', 1);
      this.Mc *= cm; this.J *= Math.sqrt(cm);
      this.Z *= cond(this, 'metal', 1);
      this.beta *= cond(this, 'spin', 1);
      this.turbK = cond(this, 'turb', 1);
      this.diskK = cond(this, 'disk', 1);
      const u = Number(opts.until);
      this.until = u > 0 && isFinite(u) ? u : 0; // 0 = 관측 기본 끝 (TT_END)
      this.inherit = inherit;
      this.sysName = 'WS-' + (1000 + (seed % 9000));
      this.phase = 'cloud';
      this.tc = 0; this.tLimit = 1.25;
      this.age = 0;
      this.sinks = [];
      this.noise = new WS.Noise(seed);
      this.accreted = 0;
      this.hzKey = null; this.hzId = null; this.hzWet = false; this.hzWobble = false; this.hzSaid = new Set(); // 해설 문장용 (noteHz)
      this.initCloud();
    }
    timeValue() { return this.age; }
    timeLabel() { return '붕괴 시작 후 ' + WS.fmtYears(this.age); }

    initCloud() {
      const N = (this.N = this.lite ? 700 : 1800);
      const r = this.rng, R = 0.27;
      this.px = new Float32Array(N); this.py = new Float32Array(N); this.vx = new Float32Array(N); this.vy = new Float32Array(N);
      this.alive = new Uint8Array(N).fill(1);
      this.m = 1 / N;
      const om = Math.sqrt((this.beta * 3) / (R * R * R));
      this.cs2 = 0.4 / this.J;
      const turb = Math.sqrt(this.cs2) * 0.6;
      // 난류: 가스를 휘젓는 동시에 서로 부딪히는 흐름이 빽빽한 덩어리(밀도 씨앗)를 만듦. 강할수록 덩어리가 뚜렷해져 여러 별로 쪼개지기 쉬움
      const tk = this.turbK, clump = 1.4 * Math.sqrt(tk), stir = 0.25 * Math.sqrt(tk), fine = 1.4 * Math.max(0, Math.sqrt(tk) - 1);
      let n = 0;
      while (n < N) {
        const rr = R * Math.sqrt(r.next()), th = r.next() * Math.PI * 2;
        const x = 0.5 + rr * Math.cos(th), y = 0.5 + rr * Math.sin(th);
        let f = this.noise.fbm(x * 6, y * 6, 3.3, 3) * clump;
        if (fine) f += this.noise.fbm(x * 15, y * 15, 5.7, 2) * fine; // 난류가 강하면 작은 덩어리가 더 생김
        if (r.next() > 0.45 + f) continue;
        this.px[n] = x; this.py[n] = y;
        const e = 0.01;
        const psi = (a, b) => this.noise.fbm(a * 4, b * 4, 9.1, 2);
        const tx = (psi(x, y + e) - psi(x, y - e)) / (2 * e), ty = -(psi(x + e, y) - psi(x - e, y)) / (2 * e);
        this.vx[n] = -(y - 0.5) * om + tx * turb * stir;
        this.vy[n] = (x - 0.5) * om + ty * turb * stir;
        n++;
      }
      this.rho = new Float64Array(NG * NG);
      this.re = new Float64Array(P * P); this.im = new Float64Array(P * P);
      this.ax = new Float32Array(N); this.ay = new Float32Array(N);
      this.lr = new Float32Array(NG * NG);
      this.rho0 = 1 / (Math.PI * R * R * NG * NG);
      this.peak = 1;
      kernel();
      this.cloudForces();
    }

    deposit() {
      const rho = this.rho;
      rho.fill(0);
      const m = this.m;
      for (let n = 0; n < this.N; n++) {
        if (!this.alive[n]) continue;
        const gx = Math.floor(this.px[n] * NG), gy = Math.floor(this.py[n] * NG);
        if (gx < 0 || gy < 0 || gx >= NG || gy >= NG) continue;
        rho[gy * NG + gx] += m;
      }
      for (const s of this.sinks) {
        const gx = Math.floor(s.x * NG), gy = Math.floor(s.y * NG);
        if (gx >= 0 && gy >= 0 && gx < NG && gy < NG) rho[gy * NG + gx] += s.m;
      }
    }
    cloudForces() {
      this.deposit();
      const re = this.re, im = this.im, rho = this.rho, K = KC;
      re.fill(0); im.fill(0);
      for (let y = 0; y < NG; y++) for (let x = 0; x < NG; x++) re[y * P + x] = rho[y * NG + x];
      WS.fft2(re, im, P, false);
      for (let i = 0; i < P * P; i++) {
        const a = re[i], b = im[i];
        re[i] = a * K.re[i] - b * K.im[i];
        im[i] = a * K.im[i] + b * K.re[i];
      }
      WS.fft2(re, im, P, true);
      // 압력: -cs² ∇ln ρ (조밀하면 단단해짐)
      const lr = this.lr;
      const floor = this.rho0 * 0.4;
      let peak = 0;
      for (let i = 0; i < NG * NG; i++) { lr[i] = Math.log(rho[i] + floor); if (rho[i] > peak) peak = rho[i]; }
      this.peak = peak / this.rho0;
      const stiff = this.rho0 * 200;
      const G = this.Gk;
      // 격자 칸마다 힘을 한 번 계산해 두고 입자는 그 칸 값을 씀
      const fxg = (this.fxg = this.fxg || new Float32Array(NG * NG)), fyg = (this.fyg = this.fyg || new Float32Array(NG * NG));
      for (let gy = 0; gy < NG; gy++) for (let gx = 0; gx < NG; gx++) {
        const c = gy * NG + gx, i = gy * P + gx;
        const xl = gx > 0 ? lr[c - 1] : lr[c], xr = gx < NG - 1 ? lr[c + 1] : lr[c];
        const yl = gy > 0 ? lr[c - NG] : lr[c], yr = gy < NG - 1 ? lr[c + NG] : lr[c];
        const cs2 = this.cs2 * (1 + Math.sqrt(rho[c] / stiff));
        fxg[c] = re[i] * G - cs2 * (xr - xl) * NG * 0.5;
        fyg[c] = im[i] * G - cs2 * (yr - yl) * NG * 0.5;
      }
      for (let n = 0; n < this.N; n++) {
        if (!this.alive[n]) continue;
        const gx = Math.min(NG - 1, Math.max(0, Math.floor(this.px[n] * NG))), gy = Math.min(NG - 1, Math.max(0, Math.floor(this.py[n] * NG)));
        this.ax[n] = fxg[gy * NG + gx];
        this.ay[n] = fyg[gy * NG + gx];
      }
      for (const s of this.sinks) {
        const gx = Math.min(NG - 1, Math.max(0, Math.floor(s.x * NG))), gy = Math.min(NG - 1, Math.max(0, Math.floor(s.y * NG)));
        s.ax = re[gy * P + gx] * G; s.ay = im[gy * P + gx] * G;
      }
    }

    cloudStep() {
      const dt = 0.0015;
      const N = this.N;
      for (let n = 0; n < N; n++) {
        if (!this.alive[n]) continue;
        this.vx[n] = (this.vx[n] + this.ax[n] * dt) * 0.9985;
        this.vy[n] = (this.vy[n] + this.ay[n] * dt) * 0.9985;
        this.px[n] += this.vx[n] * dt;
        this.py[n] += this.vy[n] * dt;
        if (this.px[n] < 0.01 || this.px[n] > 0.99 || this.py[n] < 0.01 || this.py[n] > 0.99) this.alive[n] = 0;
      }
      for (const s of this.sinks) { s.vx += s.ax * dt; s.vy += s.ay * dt; s.x += s.vx * dt; s.y += s.vy * dt; }
      this.tc += dt;
      this.age = this.tc * 7e5;
      this.cloudForces();
      if (this.peak > (this.lite ? 14 : 6)) this.reach('collapse', '분자운 중심이 자기 중력으로 무너지기 시작했습니다.');
      if (this.steps % 3 === 0) this.makeSinks();
      this.accrete();
      // 단계 종료 판정
      if (this.sinks.length) {
        if (!this.tFirst) this.tFirst = this.tc;
        if (this.accreted > 0.55 || this.tc > this.tFirst + 0.4) this.toZoom();
      } else if (this.tc > this.tLimit) {
        this.end(OUT.nostar, '구름이 자기 중력을 이기지 못하고 흩어졌습니다. 별이 태어나지 않았습니다.', OUT.nostar);
      }
    }
    makeSinks() {
      const th = this.rho0 * 45;
      for (let y = 1; y < NG - 1; y++) for (let x = 1; x < NG - 1; x++) {
        const i = y * NG + x, v = this.rho[i];
        if (v < th) continue;
        if (v < this.rho[i - 1] || v < this.rho[i + 1] || v < this.rho[i - NG] || v < this.rho[i + NG]) continue;
        const cx = (x + 0.5) / NG, cy = (y + 0.5) / NG;
        if (this.sinks.some((s) => Math.hypot(s.x - cx, s.y - cy) < 3.5 / NG)) continue;
        if (this.sinks.length >= 12) return;
        // 칸 안 입자들의 평균 속도
        let svx = 0, svy = 0, c = 0;
        for (let n = 0; n < this.N; n++) {
          if (!this.alive[n]) continue;
          if (Math.floor(this.px[n] * NG) === x && Math.floor(this.py[n] * NG) === y) { svx += this.vx[n]; svy += this.vy[n]; c++; }
        }
        this.sinks.push({ x: cx, y: cy, vx: c ? svx / c : 0, vy: c ? svy / c : 0, m: 0, ax: 0, ay: 0, born: this.age });
        if (this.sinks.length === 1) this.reach('protostar', '가장 빽빽한 곳에서 원시별이 태어났습니다.');
        else this.log(`${this.sinks.length}번째 원시별이 생겼습니다. 이 구름은 여러 별로 쪼개지고 있습니다.`);
      }
    }
    accrete() {
      const ra = 1.6 / NG, ra2 = ra * ra, m = this.m;
      for (const s of this.sinks) {
        for (let n = 0; n < this.N; n++) {
          if (!this.alive[n]) continue;
          const dx = this.px[n] - s.x, dy = this.py[n] - s.y;
          if (dx * dx + dy * dy < ra2) {
            const M = s.m + m;
            s.vx = (s.vx * s.m + this.vx[n] * m) / M;
            s.vy = (s.vy * s.m + this.vy[n] * m) / M;
            s.m = M;
            this.alive[n] = 0;
            this.accreted += m;
          }
        }
      }
      // 너무 가까운 원시별은 합쳐짐 (일부는 가까운 쌍성이 됨)
      for (let i = 0; i < this.sinks.length; i++) for (let j = i + 1; j < this.sinks.length; j++) {
        const a = this.sinks[i], b = this.sinks[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) < 1.8 / NG) {
          const big = a.m >= b.m ? a : b, small = big === a ? b : a;
          const M = a.m + b.m || 1e-9;
          if (small.m > 0.05 * big.m && this.rng.chance(0.45)) {
            big.close = { q: small.m / M, sep: this.rng.logRange(0.05, 300) };
            this.log('두 원시별이 서로를 붙잡아 가까운 쌍성이 되었습니다.');
          }
          big.x = (a.x * a.m + b.x * b.m) / M; big.y = (a.y * a.m + b.y * b.m) / M;
          big.vx = (a.vx * a.m + b.vx * b.m) / M; big.vy = (a.vy * a.m + b.vy * b.m) / M;
          big.m = M;
          this.sinks.splice(this.sinks.indexOf(small), 1);
          j--;
        }
      }
    }

    toZoom() {
      this.phase = 'zoom';
      this.zoomStep = 0;
      const sorted = this.sinks.slice().sort((a, b) => b.m - a.m);
      this.primary = sorted[0];
      // 빠르게 도는 핵은 둘레의 원반이 쪼개져 가까운 쌍성이 되기 쉬움 (회전이 태양을 낳은 구름의 1.6배를 넘을 때부터)
      if (!this.primary.close && this.beta > 0.08 && this.rng.chance(Math.min(0.6, (this.beta - 0.08) * 4))) {
        this.primary.close = { q: this.rng.range(0.2, 0.45), sep: this.rng.logRange(0.1, 60) };
        this.log('빠르게 돌던 원시별의 원반이 둘로 쪼개져 가까운 쌍성이 되었습니다.');
      }
      const eff = 0.6;
      let M = this.primary.m * this.Mc * eff;
      this.binary = null;
      if (this.primary.close) {
        const q = this.primary.close.q;
        this.binary = { m: M * q, sep: this.primary.close.sep };
        M = M * (1 - q);
      }
      this.Mstar = WS.clamp(M, 0.01, 80);
      this.wide = sorted.slice(1).filter((s) => s.m * this.Mc * eff > 0.02).map((s) => ({ m: s.m * this.Mc * eff, sep: Math.hypot(s.x - this.primary.x, s.y - this.primary.y) * 36000 }));
      const d = `중심별 질량 태양의 ${WS.trimNum(this.Mstar)}배`;
      this.log(d + (this.binary ? `, 가까운 동반성(${WS.trimNum(this.binary.m)}배, ${WS.trimNum(this.binary.sep)} AU)` : '') + (this.wide.length ? `, 멀리 떨어진 별 ${this.wide.length}개` : '') + '.');
    }

    /* ---------- 원반 단계 (정규화 단위: 길이 √L AU, 시간 그 거리의 공전 주기) ---------- */
    initDisk() {
      this.phase = 'disk';
      const r = this.rng, M = this.Mstar;
      this.L = Math.max(1e-5, M < 0.43 ? 0.23 * Math.pow(M, 2.3) : M < 2 ? Math.pow(M, 4) : 1.4 * Math.pow(M, 3.5));
      this.D = Math.sqrt(this.L);
      this.PD = Math.sqrt(Math.pow(this.D, 3) / M);
      this.frost = 2.7; this.hzIn = 0.95; this.hzOut = 1.67;
      this.life = 1e10 * Math.pow(M, -2.5) * Math.pow(this.Gk, -2.5);
      this.tIgn = 3e7 * Math.pow(M, -2.5);
      this.ageDisk0 = this.age;
      this.tt = 0;
      this.dsteps = 0;
      this.Mme = M * ME_SUN;
      const cap = this.lite ? 150 : 260;
      this.cap = cap + 40;
      const B = this.cap;
      this.bx = new Float64Array(B); this.by = new Float64Array(B); this.bvx = new Float64Array(B); this.bvy = new Float64Array(B);
      this.bax = new Float64Array(B); this.bay = new Float64Array(B);
      this.bm = new Float64Array(B); this.bw = new Float64Array(B); this.bmoon = new Uint8Array(B); this.bid = new Int32Array(B);
      // 계산용 작업 공간 (매 단계 새로 만들지 않음)
      this.mX = new Float64Array(32); this.mY = new Float64Array(32); this.mK = new Float64Array(32); this.mI = new Int32Array(32);
      this.cRR = new Float64Array(B); this.cRC = new Float64Array(B); this.cDead = new Uint8Array(B); this.cOrd = new Int32Array(B); this.cPairs = [];
      this.nB = 0; this.nextId = 1;
      this.pLetter = new Map(); // 천체 id → 이름 글자 (한 번 붙으면 바뀌지 않음, 궤도 계산에는 쓰이지 않음)
      this.hnr = []; // 방금 스치고 지나간 쌍 [id, id, 기한, 이번에 겹침]
      this.diskRel = WS.clamp(r.logRange(0.4, 2.2) * Math.sqrt(this.beta / 0.05), 0.2, 4) * this.diskK;
      let rIn = 0.42, rOut = 13;
      if (this.binary) {
        const sN = this.binary.sep / this.D;
        if (sN < 1.5) rIn = Math.max(rIn, sN * 3);
        else rOut = Math.min(rOut, sN / 3);
        if (rOut < rIn * 1.5) { rOut = rIn * 1.5; }
      }
      this.rIn = rIn; this.rOut = rOut;
      const solids = 50 * this.Z * this.diskRel * Math.pow(M, 0.8);
      this.solids0 = solids;
      // 배아 위치: Σ ∝ r^-1.5, 설선 밖은 얼음까지 더해 4배 (개수 2배 × 질량 2배)
      const pts = [];
      const amax = Math.sqrt(rOut) * 2;
      while (pts.length < cap) {
        const a = rIn * Math.pow(rOut / rIn, r.next());
        if (r.next() * amax > Math.sqrt(a) * (a > this.frost ? 2 : 1)) continue;
        pts.push(a);
      }
      const wts = pts.map((a) => (a > this.frost ? 2 : 1) * Math.exp(r.normal() * 0.5));
      const wsum = wts.reduce((s, v) => s + v, 0);
      pts.forEach((a, i) => {
        const m = (solids * wts[i]) / wsum;
        const wat = a > this.frost ? r.range(0.2, 0.45) : a > this.frost * 0.75 ? r.logRange(1e-3, 3e-2) : r.logRange(1e-6, 1e-4);
        this.addBody(a, r.next() * Math.PI * 2, m, wat, r.range(0, 0.03));
      });
      if (this.binary) {
        this.compIdx = -1;
        this.comp = { m: this.binary.m * ME_SUN, a: this.binary.sep / this.D, th: r.next() * Math.PI * 2 };
      }
      this.tGas = r.range(70, 150) * Math.pow(this.diskRel, 0.3);
      this.gasLeft = 1;
      this.gasBudget = 320 * this.diskRel * Math.pow(M, 0.8);
      this.mig = r.chance(0.15) ? r.range(0.06, 0.18) : r.range(0.001, 0.005);
      this.fc = 1.2;
      this.boost = 30;
      this.kp = 0.06 * Math.pow(this.Z, 0.7) * Math.sqrt(this.diskRel) * r.range(0.5, 1.5);
      this.pebbles = solids * 0.6;
      this.massive = [];
      this.updateMassive();
      this.computeAcc();
      this.reach('disk', '원시별 주위로 가스와 먼지의 원반이 펼쳐졌습니다. 그 안에서 행성 배아들이 자랍니다.');
      if (this.Mstar < 0.08) this.log('중심 천체가 너무 가벼워 수소 핵융합을 시작하지 못할 것입니다 (갈색 왜성).', 'disaster');
    }
    addBody(a, th, m, w, e) {
      if (this.nB >= this.cap) return -1;
      const i = this.nB++;
      this.bx[i] = a * Math.cos(th); this.by[i] = a * Math.sin(th);
      const v = (Math.PI * 2) / Math.sqrt(a) * (1 + (e || 0) * (this.rng.next() - 0.5));
      this.bvx[i] = -Math.sin(th) * v; this.bvy[i] = Math.cos(th) * v;
      this.bm[i] = m; this.bw[i] = w; this.bmoon[i] = 0; this.bid[i] = this.nextId++;
      return i;
    }
    removeBody(i) {
      const j = --this.nB;
      if (i !== j) {
        this.bx[i] = this.bx[j]; this.by[i] = this.by[j]; this.bvx[i] = this.bvx[j]; this.bvy[i] = this.bvy[j];
        this.bax[i] = this.bax[j]; this.bay[i] = this.bay[j];
        this.bm[i] = this.bm[j]; this.bw[i] = this.bw[j]; this.bmoon[i] = this.bmoon[j]; this.bid[i] = this.bid[j];
      }
      this.massiveDirty = true;
    }
    updateMassive() {
      const idx = [];
      for (let i = 0; i < this.nB; i++) if (this.bm[i] >= 0.05) idx.push(i);
      idx.sort((a, b) => this.bm[b] - this.bm[a]);
      this.massive = idx.slice(0, this.lite ? 16 : 28);
      // 시간 압축: 행성끼리의 중력을 키워 수천만 년의 궤도 교란을 수백 바퀴 안에 일으킴 (거대 행성은 덜 키움)
      this.meff = this.massive.map((i) => this.bm[i] * this.boost / (1 + this.bm[i] / 15));
      this.massiveDirty = false;
    }
    compPos() {
      const c = this.comp;
      const th = c.th + (Math.PI * 2 * this.tt) / Math.pow(c.a, 1.5);
      return [c.a * Math.cos(th), c.a * Math.sin(th)];
    }
    computeAcc() {
      const n = this.nB, bx = this.bx, by = this.by, ax = this.bax, ay = this.bay;
      const k = TAU2 / this.Mme, eps2 = 0.004 * 0.004;
      // 무거운 천체를 작은 연속 배열로 모아 둠 (안쪽 고리가 빨라짐)
      const mass = this.massive, meff = this.meff, MX = this.mX, MY = this.mY, MK = this.mK, MI = this.mI;
      let nm = 0;
      for (let q = 0; q < mass.length; q++) {
        const j = mass[q];
        if (j >= n) continue;
        MX[nm] = bx[j]; MY[nm] = by[j]; MK[nm] = k * meff[q]; MI[nm] = j; nm++;
      }
      let cx = 0, cy = 0, cg = 0;
      if (this.comp) { [cx, cy] = this.compPos(); cg = TAU2 * this.comp.m / this.Mme; }
      for (let i = 0; i < n; i++) {
        const x = bx[i], y = by[i];
        const r2 = x * x + y * y + 1e-6;
        const inv = TAU2 / (r2 * Math.sqrt(r2));
        let fx = -x * inv, fy = -y * inv;
        for (let q = 0; q < nm; q++) {
          if (MI[q] === i) continue;
          const dx = MX[q] - x, dy = MY[q] - y;
          const d2 = dx * dx + dy * dy + eps2;
          const f = MK[q] / (d2 * Math.sqrt(d2));
          fx += dx * f; fy += dy * f;
        }
        if (cg) {
          const dx = cx - x, dy = cy - y, d2 = dx * dx + dy * dy + 0.01;
          const f = cg / (d2 * Math.sqrt(d2));
          fx += dx * f; fy += dy * f;
        }
        ax[i] = fx; ay[i] = fy;
      }
      // 방금 스치고 지나간 쌍은 떨어질 때까지 서로 끌어당기지 않음: 스칠 때 꺾이는 것은 충돌 계산(hitAndRun)이 이미 넣었고,
      // 부풀린 중력권 안의 가까운 통과를 또 계산하면 두 번 꺾이게 됨
      const hn = this.hnr;
      if (hn && hn.length) {
        const id = this.bid;
        for (const c of hn) {
          let ia = -1, ib = -1;
          for (let i = 0; i < n && (ia < 0 || ib < 0); i++) { if (id[i] === c[0]) ia = i; else if (id[i] === c[1]) ib = i; }
          if (ia < 0 || ib < 0) continue;
          for (let q = 0; q < nm; q++) {
            const src = MI[q], dst = src === ia ? ib : src === ib ? ia : -1;
            if (dst < 0) continue;
            const dx = MX[q] - bx[dst], dy = MY[q] - by[dst], d2 = dx * dx + dy * dy + eps2, f = MK[q] / (d2 * Math.sqrt(d2));
            ax[dst] -= dx * f; ay[dst] -= dy * f;
          }
        }
      }
    }
    substep(dt) {
      const n = this.nB, bx = this.bx, by = this.by, vx = this.bvx, vy = this.bvy, ax = this.bax, ay = this.bay;
      for (let i = 0; i < n; i++) { vx[i] += ax[i] * dt * 0.5; vy[i] += ay[i] * dt * 0.5; bx[i] += vx[i] * dt; by[i] += vy[i] * dt; }
      this.tt += dt;
      this.computeAcc();
      for (let i = 0; i < n; i++) { vx[i] += ax[i] * dt * 0.5; vy[i] += ay[i] * dt * 0.5; }
    }
    gasEffects(dt) {
      if (this.gasLeft <= 0) return;
      const g = this.gasLeft, n = this.nB;
      for (let i = 0; i < n; i++) {
        const x = this.bx[i], y = this.by[i], r = Math.hypot(x, y) || 1e-3;
        const vc = (Math.PI * 2) / Math.sqrt(r);
        const tx = -y / r, ty = x / r;
        const k = Math.min(1, (0.8 * g * dt) / (0.4 + Math.cbrt(this.bm[i])));
        this.bvx[i] += (tx * vc - this.bvx[i]) * k;
        this.bvy[i] += (ty * vc - this.bvy[i]) * k;
        const m = this.bm[i];
        // 조약돌 강착: 가스에 실려 흘러드는 얼음 알갱이를 큰 배아가 쓸어 담음
        if (m >= 0.3 && m < 6 && r > this.frost * 0.8 && this.pebbles > 0) {
          const dm = Math.min(this.pebbles, this.kp * Math.pow(m, 2 / 3) * g * dt);
          this.bm[i] += dm; this.pebbles -= dm;
          this.bw[i] = (this.bw[i] * m + 0.35 * dm) / (m + dm);
        }
        if (m >= 6) {
          // 가스 끌어모으기 (설선 근처·바깥에서 잘 됨)
          if (this.gasBudget > 0 && r > this.frost * 0.55) {
            const dm = Math.min(this.gasBudget, m * 0.11 * g * dt);
            this.bm[i] += dm; this.gasBudget -= dm;
            this.bw[i] = (this.bw[i] * m) / (m + dm);
          }
          // 원반과의 상호작용으로 안쪽으로 이동
          const s = 1 - this.mig * g * dt;
          this.bx[i] *= s; this.by[i] *= s;
          this.bvx[i] /= Math.sqrt(s); this.bvy[i] /= Math.sqrt(s);
        }
      }
    }
    collide() {
      const n = this.nB;
      if (n < 2) return;
      const ord = this.cOrd, rr = this.cRR, rc = this.cRC, dead = this.cDead, pairs = this.cPairs;
      for (let i = 0; i < n; i++) ord[i] = i;
      let rcMax = 0;
      const M3 = 3 * this.Mme;
      for (let i = 0; i < n; i++) {
        const r = Math.hypot(this.bx[i], this.by[i]);
        rr[i] = r;
        rc[i] = this.fc * r * Math.cbrt(this.bm[i] * this.boost / M3) + 0.002;
        if (rc[i] > rcMax) rcMax = rc[i];
      }
      for (let i = 1; i < n; i++) { const v = ord[i]; let j = i - 1; while (j >= 0 && rr[ord[j]] > rr[v]) { ord[j + 1] = ord[j]; j--; } ord[j + 1] = v; }
      dead.fill(0, 0, n);
      pairs.length = 0;
      for (let a = 0; a < n; a++) {
        const i = ord[a];
        for (let b = a + 1; b < n; b++) {
          const j = ord[b];
          if (rr[j] - rr[i] > rc[i] + rcMax) break;
          const dx = this.bx[i] - this.bx[j], dy = this.by[i] - this.by[j];
          const lim = rc[i] + rc[j];
          if (dx * dx + dy * dy < lim * lim && !(this.hnr.length && this.cooling(i, j))) pairs.push(i, j);
        }
      }
      for (let p = 0; p < pairs.length; p += 2) {
        const i = pairs[p], j = pairs[p + 1];
        if (dead[i] || dead[j]) continue;
        if (this.impact(i, j, rr[i])) dead[this.bm[i] === 0 ? i : j] = 1;
      }
      // 스치고 지나간 쌍: 이번에 다시 겹쳐 있지 않으면(떨어졌으면) 또는 오래 붙어 있었으면 다음 만남은 새 충돌로 봄
      if (this.hnr.length) this.hnr = this.hnr.filter((c) => { const keep = c[3] === 1 && this.tt < c[2]; c[3] = 0; return keep; });
      // 죽은 것 제거 (뒤에서부터)
      for (let i = n - 1; i >= 0; i--) if (this.bm[i] === 0) this.removeBody(i);
    }
    // 방금 스치고 지나간 쌍이면 true (서로 떨어질 때까지는 다시 부딪힌 것으로 치지 않음)
    cooling(i, j) {
      const a = this.bid[i], b = this.bid[j];
      for (const c of this.hnr) if ((c[0] === a && c[1] === b) || (c[0] === b && c[1] === a)) { if (this.tt < c[2]) { c[3] = 1; return true; } return false; }
      return false;
    }
    /* 거대 충돌의 결과: 합쳐짐 · 스치고 지나감(hit-and-run) · 부서지며 일부만 붙음.
       실제로는 부딪히는 각도와 속도가 결과를 가릅니다 (Kokubo & Genda 2010의 합체 한계 속도).
       충돌 각도: 두 천체가 서로의 중력권(모형이 계산하는 크기, 행성 지름의 수백 배)에 들어올 때의 비껴 맞는 정도를
       실제 행성 크기까지 확대한 값입니다. 그래서 다가오는 길이 행성 크기의 몇백분의 1만 달라도 맞는 자리가 바뀝니다.
       평면 모형이 풀지 못하는 몫(궤도 기울기에 따른 위아래 어긋남과 속도)은 주 난수로 뽑습니다.
       그래서 아주 작은 차이나 다른 주사위가 충돌 결과를 바꾸고, 스치고 지나간 천체는 다른 쪽으로 튕겨 나가
       그 차이가 다음 만남에서 다시 커집니다 (실제 행성 형성의 혼돈과 같은 원리).
       → true면 합쳐져 하나가 사라짐, false면 둘 다 남음 */
    impact(i, j, rad) {
      const t = this.bm[i] >= this.bm[j] ? i : j, p = t === i ? j : i;
      const mt = this.bm[t], mp = this.bm[p];
      if (mp < 0.02 || mp < 0.03 * mt) { this.merge(i, j, -1); return true; } // 작은 조각은 그냥 달라붙음
      const r = this.rng;
      const ct = Math.cbrt(mt), cp = Math.cbrt(mp);
      // 모형이 푼 비껴 맞는 정도 β (중력권 크기 lim 기준, 부호 = 도는 방향) → 실제 크기로 확대 (지구 반지름 = 4.26e-5 AU)
      const dx = this.bx[i] - this.bx[j], dy = this.by[i] - this.by[j], dvx = this.bvx[i] - this.bvx[j], dvy = this.bvy[i] - this.bvy[j];
      const dv = Math.hypot(dvx, dvy) || 1e-12, lim = this.cRC[i] + this.cRC[j];
      const beta = (dx * dvy - dy * dvx) / (dv * lim);
      const amp = (lim * this.D) / (4.26e-5 * (ct + cp));
      const f = r.next() + Math.abs(beta) * amp;
      const b = Math.sqrt(f - Math.floor(f)); // 충돌 각도의 sin (충돌 단면적 위에 고르게: 45°가 가장 흔함)
      // 상호 탈출 속도 (지구 밀도, 실제 질량)와 다가오는 상대 속도의 비. 평면 모형이 놓치는 몫(기울기·마지막 가속)을 더함
      const vkm = 29.8 * Math.sqrt(this.Mstar / this.D) / (Math.PI * 2); // 모형 속도 1 = km/s
      const vesc = 11.2 * Math.sqrt((mt + mp) / (ct + cp));
      const xs = dv * vkm / vesc, xz = 0.6 * r.normal();
      const u = Math.sqrt(1 + xs * xs + xz * xz); // 충돌 속도 / 탈출 속도
      const G = (mt - mp) / (mt + mp), Th = Math.pow(1 - b, 2.5);
      const vcr = 2.43 * G * Th - 0.0408 * G + 1.86 * Th + 1.08; // 이보다 느리면 합쳐짐
      const bcrit = ct / (ct + cp); // 이보다 비스듬하면 작은 쪽의 중심이 큰 쪽을 비껴감
      if (u < vcr) { this.merge(i, j, b); return true; }
      if (b > bcrit) {
        // 스쳐 가며 꺾이는 각: 행성 크기의 b배 거리로 스치는 쌍곡선 궤도 (빠르고 비스듬할수록 덜 꺾임)
        const eh = 1 + 2 * b * (u * u - 1);
        this.hitAndRun(t, p, u / vcr, rad, (beta >= 0 ? 2 : -2) * Math.asin(Math.min(1, 1 / eh)));
        return false;
      }
      // 빠른 정면 충돌: 합쳐지지만 작은 쪽의 일부가 파편으로 흩어짐
      const lost = mp * Math.min(0.5, 0.25 * (u / vcr - 1) + 0.05);
      this.bm[p] -= lost;
      const keep = this.debris(p, lost, rad);
      this.bm[p] += keep;
      this.merge(i, j, b);
      return true;
    }
    hitAndRun(t, p, over, rad, phi) {
      const mt = this.bm[t], mp = this.bm[p], M = mt + mp;
      // 서로의 중력에 꺾여 다른 쪽으로 튕겨 나가며 조금 느려짐 (운동량은 그대로): 상대 속도를 phi만큼 돌리고 5% 줄임
      // → 다시 붙잡혀 나중에 합쳐지기도 함
      const cx = (this.bvx[t] * mt + this.bvx[p] * mp) / M, cy = (this.bvy[t] * mt + this.bvy[p] * mp) / M;
      const c = Math.cos(phi) * 0.95, s = Math.sin(phi) * 0.95;
      for (const k of [t, p]) {
        const ux = this.bvx[k] - cx, uy = this.bvy[k] - cy;
        this.bvx[k] = cx + ux * c - uy * s; this.bvy[k] = cy + ux * s + uy * c;
      }
      // 스쳐 간 쪽은 겉껍질 일부를 잃음: 절반은 큰 쪽에 붙고 나머지는 파편
      const lost = mp * Math.min(0.35, 0.06 + 0.3 * (over - 1));
      this.bm[p] -= lost;
      const toT = lost * 0.5 + this.debris(p, lost * 0.5, rad);
      this.bw[t] = (this.bw[t] * mt + this.bw[p] * toT) / (mt + toT);
      this.bm[t] += toT;
      this.hnr.push([this.bid[t], this.bid[p], this.tt + 1.5, 1]);
      this.massiveDirty = true;
      // 기록: 같은 쌍이 곧바로 다시 스치면 한 번만 (기록은 계산에 쓰이지 않음)
      const L = this.hnrLog, a = this.bid[t], b = this.bid[p];
      const same = L && ((L[0] === a && L[1] === b) || (L[0] === b && L[1] === a)) && this.tt - L[2] < 20;
      if (mt >= 0.5 && mp >= 0.2 && !same) {
        this.hnrLog = [a, b, this.tt];
        this.log(`지구 질량 ${WS.trimNum(Math.round(mt * 10) / 10)}배와 ${WS.trimNum(Math.round(mp * 10) / 10)}배 원시 행성이 비스듬히 부딪혔다가 다시 떨어져 나갔습니다 (스치고 지나간 충돌).`);
      }
      this.addFx({ type: 'flash', x: this.bx[p], y: this.by[p], r: 0.03, life: 0.7, color: [255, 220, 170] });
    }
    // 천체 src 곁에 질량 m의 파편 하나를 흩뿌림. 자리가 없거나 너무 작으면 뿌리지 못한 질량을 돌려줌
    debris(src, m, rad) {
      if (m < 0.004) return m;
      const th = this.rng.next() * Math.PI * 2;
      const k = this.addBody(1, 0, m, this.bw[src], 0);
      if (k < 0) return m;
      const M3 = 3 * this.Mme;
      const rc = (q) => this.fc * rad * Math.cbrt(q * this.boost / M3) + 0.002;
      const d = 1.3 * (rc(this.bm[src]) + rc(m)), c = Math.cos(th), s = Math.sin(th);
      const vk = 29.8 * Math.sqrt(this.Mstar / this.D) / (Math.PI * 2);
      const kick = (0.1 * 11.2 * Math.cbrt(Math.max(this.bm[src], m))) / vk; // 탈출 속도의 일부로 튀어 나감 (대부분은 곧 다시 붙음)
      this.bx[k] = this.bx[src] + c * d; this.by[k] = this.by[src] + s * d;
      this.bvx[k] = this.bvx[src] + c * kick; this.bvy[k] = this.bvy[src] + s * kick;
      this.bmoon[k] = 0;
      this.massiveDirty = true;
      return 0;
    }
    merge(i, j, b) {
      const m1 = this.bm[i], m2 = this.bm[j];
      const big = m1 >= m2 ? i : j, sm = big === i ? j : i;
      const M = m1 + m2, mb = this.bm[big], ms = this.bm[sm];
      const ratio = ms / mb;
      this.bx[big] = (this.bx[i] * m1 + this.bx[j] * m2) / M;
      this.by[big] = (this.by[i] * m1 + this.by[j] * m2) / M;
      this.bvx[big] = (this.bvx[i] * m1 + this.bvx[j] * m2) / M;
      this.bvy[big] = (this.bvy[i] * m1 + this.bvy[j] * m2) / M;
      this.bw[big] = (this.bw[i] * m1 + this.bw[j] * m2) / M;
      this.bmoon[big] = Math.min(9, this.bmoon[big] + this.bmoon[sm]);
      this.bm[big] = M;
      this.bm[sm] = 0;
      // 이름 있는 행성이 아직 이름 없는 천체와 합쳐지면 이름을 이어받음
      if (this.pLetter.has(this.bid[sm]) && !this.pLetter.has(this.bid[big])) this.pLetter.set(this.bid[big], this.pLetter.get(this.bid[sm]));
      // b < 0: 작은 조각이 달라붙은 것 (큰 위성을 만들지 못함)
      if (b >= 0 && mb >= 0.3 && ratio > 0.04 && ratio < 0.35 && mb < 15 && this.gasLeft < 0.3) {
        // 큰 위성은 비스듬한(약 42~56°) 충돌에서 튕겨 나간 파편이 모여 생김 (달을 만든 충돌은 약 45°였다고 봄)
        if (b >= 0.67 && b <= 0.83) {
          this.bmoon[big] = Math.min(9, this.bmoon[big] + 1);
          if (M < 6 && this.bw[big] < 0.05) this.reach('moon', '화성만 한 천체가 원시 행성에 비스듬히 부딪혀, 튕겨 나간 파편이 커다란 위성이 되었습니다.');
          else this.log('거대 충돌로 행성 하나가 위성을 얻었습니다.');
        } else if (mb >= 0.5 && b < 0.5) this.log(`질량 ${WS.trimNum(mb)}배 지구 원시 행성에 정면에 가까운 거대한 충돌이 일어났습니다.`);
        this.addFx({ type: 'flash', x: this.bx[big], y: this.by[big], r: 0.04, life: 0.9, color: [255, 200, 140] });
      }
      if (M >= 50 && !this.reached.giant) this.reach('giant', `원시 행성이 주변 가스를 빨아들여 가스 거인이 되었습니다 (지구의 ${Math.round(M)}배).`);
      this.massiveDirty = true;
    }
    cleanup() {
      for (let i = this.nB - 1; i >= 0; i--) {
        const r = Math.hypot(this.bx[i], this.by[i]);
        if (r > 45) {
          if (this.bm[i] >= 1) this.log(`지구 질량 ${WS.trimNum(this.bm[i])}배 행성이 중력에 튕겨 항성계 밖으로 날아갔습니다.`, 'disaster');
          this.removeBody(i);
        } else if (r < 0.07) {
          if (this.bm[i] >= 1) this.log(`지구 질량 ${WS.trimNum(this.bm[i])}배 행성이 중심별로 떨어졌습니다.`, 'disaster');
          this.removeBody(i);
        }
      }
    }
    diskStep() {
      const sub = 8, dt = 0.005;
      for (let s = 0; s < sub; s++) {
        this.substep(dt);
        this.gasEffects(dt);
        if (s % 2 === 1) this.collide();
        if (this.massiveDirty || s === 0) this.updateMassive();
      }
      this.cleanup();
      this.dsteps++;
      // 가스 소멸
      if (this.gasLeft > 0) {
        this.gasLeft = this.tt < this.tGas ? 1 - Math.pow(this.tt / this.tGas, 2) : 0;
        if (this.gasLeft <= 0) { this.gasLeft = 0; this.reach('gasgone', '젊은 별의 바람이 원반의 가스를 날려 보냈습니다. 이제 행성들은 더 자라지 않습니다.'); }
      }
      this.age = this.ageDisk0 + 600 * this.tt * this.tt;
      for (let i = 0; i < this.nB; i++) if (this.bm[i] >= 50) { this.reach('giant', `원시 행성이 주변 가스를 빨아들여 가스 거인이 되었습니다 (지구의 ${Math.round(this.bm[i])}배).`); break; }
      if (this.Mstar >= 0.08 && this.age >= this.tIgn) this.reach('ignite', `중심별이 수소 핵융합을 시작했습니다. 이 별의 예상 수명은 ${WS.fmtYears(this.life)}입니다.`);
      if (this.dsteps % 25 === 0) this.survey();
      if (this.age > this.life) {
        this.blewUp = true;
        this.survey();
        this.end(OUT.supernova, `무거운 별은 ${WS.fmtYears(this.life)} 만에 연료를 다 쓰고 초신성으로 폭발했습니다. 행성들도 함께 사라졌습니다.`, OUT.supernova);
        return;
      }
      if (this.until ? this.age >= this.until : this.tt >= TT_END) this.finish();
    }
    orbit(i) {
      const x = this.bx[i], y = this.by[i], vx = this.bvx[i], vy = this.bvy[i];
      const r = Math.hypot(x, y), v2 = vx * vx + vy * vy;
      const E = v2 / 2 - TAU2 / r;
      const a = E < 0 ? -TAU2 / (2 * E) : Infinity;
      const h = x * vy - y * vx;
      const e = Math.sqrt(Math.max(0, 1 + (2 * E * h * h) / (TAU2 * TAU2)));
      return { a, e, r };
    }
    planets() {
      const out = [];
      for (let i = 0; i < this.nB; i++) {
        const m = this.bm[i];
        if (m < 0.08) continue;
        const o = this.orbit(i);
        const a = isFinite(o.a) ? o.a : o.r;
        const w = this.bw[i];
        const zone = a < this.hzIn ? '뜨거움' : a <= this.hzOut ? HZ : '차가움';
        const kind = kindOf(m, w, zone === HZ);
        out.push({ i, id: this.bid[i], m, a, aAU: a * this.D, e: o.e, w, moons: this.bmoon[i], type: KIND[kind].label, kind, zone });
      }
      out.sort((p, q) => p.a - q.a);
      out.forEach((p) => this.applyName(p));
      return out;
    }
    applyName(p) {
      const l = this.pLetter.get(p.id);
      p.letter = l || '';
      p.name = l ? this.sysName + ' ' + l : '이름 없는 작은 천체';
    }
    /* 이름 글자는 실제 외계 행성처럼 처음 확인한 순서로 붙이고 다시 바꾸지 않음 (ps는 별에서 가까운 순).
       자라는 동안에는 천체가 너무 많고 금방 합쳐지므로, 궤도가 자리 잡은 뒤부터 붙임 */
    nameNew(ps, minM) {
      for (const p of ps) {
        if (p.m >= minM && !this.pLetter.has(p.id)) this.pLetter.set(p.id, letterAt(this.pLetter.size));
        this.applyName(p);
      }
    }
    settled() { return this.phase === 'disk' && this.gasLeft <= 0 && this.tt > this.tGas + 60; }
    hzRocky(ps) { return ps.filter((p) => p.zone === HZ && p.m >= 0.4 && p.m <= 5 && p.w <= 0.08); }
    habScore(p) {
      if (p.m < 0.1 || p.m > 10 || p.w > 0.08) return 0;
      const zoneS = p.zone === HZ ? 1 : p.a < this.hzIn ? Math.max(0, 1 - (this.hzIn - p.a) * 2) * 0.3 : Math.max(0, 1 - (p.a - this.hzOut)) * 0.3;
      const massS = p.m < 0.3 ? 0.4 : p.m > 5 ? 0.5 : 1;
      const waterS = p.w < 2e-5 ? 0.3 : p.w > 0.03 ? 0.6 : 1;
      const lifeS = this.life > 4e9 ? 1 : this.life > 1e9 ? 0.5 : 0.1;
      return zoneS * massS * waterS * lifeS * (p.e < 0.3 ? 1 : 0.5) * (p.moons ? 1.1 : 1);
    }
    survey() {
      const ps = this.planets();
      this.plist = ps;
      if (this.settled()) this.nameNew(ps, 0.3);
      if (!this.settled() || this.blewUp) return;
      this.noteHz(ps);
      for (const p of this.hzRocky(ps)) {
        this.reach('hzplanet', `${p.name}: 생명 가능 지대에 지구 질량 ${WS.trimNum(p.m)}배의 암석 행성이 자리 잡았습니다.`);
        if (p.w >= 5e-5) this.reach('water', `${p.name}에는 눈선 너머에서 날아온 천체들이 실어 온 물이 있습니다 (질량의 ${(p.w * 100).toPrecision(2)}%).`);
      }
    }
    /* 해설 문장용 기록: 조사 때마다 지금 할 말을 정함 (화면을 보든 안 보든 같고, 세계의 진행에는 쓰이지 않음).
       판정은 결말 카드와 같음. 행성이 지대 경계를 오가면 순간 판정이 수십 번 뒤집히므로,
       말하던 행성이 지대에 남아 있으면 그대로 말하고, 이미 했던 말로 되돌아가면 그 뒤로는 '넘나든다'고만 말함 */
    noteHz(ps) {
      const hz = this.hzRocky(ps), wet = hz.filter((p) => p.w >= 5e-5), pool = wet.length ? wet : hz;
      const p = pool.find((q) => q.id === this.hzId) || pool.slice().sort((a, b) => this.habScore(b) - this.habScore(a))[0];
      const key = p ? p.id + (wet.length ? '+물' : '') : '없음';
      if (key === this.hzKey) return;
      if (this.hzSaid.has(key)) this.hzWobble = true;
      this.hzSaid.add(key);
      this.hzKey = key; this.hzId = p ? p.id : null; this.hzWet = wet.length > 0;
    }
    /* 관측 끝(기본 약 3.8억 년, 실험실은 정한 시점)에 도달했을 때의 결말 */
    finish() {
      this.survey();
      const ps = this.plist || [];
      if (this.settled()) this.nameNew(ps, 0.1); // 마지막 조사: 남은 작은 행성까지 이름을 붙임
      const key = classify(this);
      const named = ps.filter((p) => p.m >= 0.1);
      const giants = named.filter((p) => p.m >= 10).length, rocky = named.filter((p) => p.m < 10 && p.w <= 0.08).length, icy = named.length - giants - rocky;
      const sum = `행성 ${named.length}개 (거대 행성 ${giants}, 암석 행성 ${rocky}${icy ? `, 얼음 행성 ${icy}` : ''}).`;
      const age = WS.fmtYears(this.age);
      const byHab = (a, b) => this.habScore(b) - this.habScore(a);
      const hzAll = this.hzRocky(ps).sort(byHab);
      const hz = (key === 'earthmoon' ? hzAll.find((p) => p.w >= 5e-5 && p.moons > 0) : key === 'wet' ? hzAll.find((p) => p.w >= 5e-5) : null) || hzAll[0];
      /* 생명 단계로 내려갈 행성(next): 결말 문구가 말하는 바로 그 행성. 생명 가능 지대 밖의 행성은 권하지 않음.
         알맞은 행성이 없을 때만, 지대 안의 너무 작거나 큰 암석 행성을 '시험해 보기'로 권함 */
      const hasHz = key === 'earthmoon' || key === 'wet' || key === 'dry';
      const edge = this.settled() && key !== 'nostar' && !hasHz ? ps.filter((p) => p.zone === HZ && p.m >= 0.1 && p.m <= 10 && p.w <= 0.08).sort(byHab)[0] || null : null;
      this.best = hasHz ? hz : edge;
      const nextNote = edge ? ` 다만 ${edge.m < 1 ? '작은' : '큰'} 행성 ${edge.name}(지구의 ${fmtM(edge.m)}배)가 그 안에 있어, 생명을 시험해 볼 수는 있습니다.`
        : ' 그래서 이 항성계는 생명 단계로 이어지지 않습니다. 「새 세계」로 다른 구름을 시도해 보세요.';
      if (key === 'nostar') { this.end(OUT.nostar, `중심 천체가 별이 되기엔 너무 가벼워 갈색 왜성이 되었습니다. 어두운 갈색 왜성 주위를 천체 ${ps.length}개가 돕니다.`, OUT.nostar); return; }
      if (key === 'earthmoon') { this.end(OUT.earthmoon, sum + ` 생명 가능 지대의 ${hz.name}에는 물이 있고, 거대 충돌로 생긴 큰 위성도 있습니다.`, OUT.earthmoon); return; }
      if (key === 'wet') { this.end(OUT.wet, sum + ` 생명 가능 지대의 ${hz.name}에는 물이 있습니다.`, OUT.wet); return; }
      if (key === 'dry') { this.end(OUT.dry, sum + ` 생명 가능 지대의 ${hz.name}에는 물이 거의 없습니다.`, OUT.dry); return; }
      if (!this.settled()) { this.end('아직 자라는 중인 항성계', `${age} 시점: ${sum} 원반 속 천체들이 아직 부딪히며 자라는 중이라, 어떤 행성이 남을지는 정해지지 않았습니다.`, '형성 중인 항성계'); return; }
      if (key === 'binary') this.end(OUT.binary, sum + ' 가까운 동반성의 중력이 원반을 흔들어, 생명 가능 지대에 알맞은 행성이 자리 잡지 못했습니다.' + nextNote, OUT.binary);
      else if (key === 'giants') this.end(OUT.giants, sum + ' 거대 행성은 있지만 생명 가능 지대에 알맞은 크기의 암석 행성은 없습니다.' + nextNote, OUT.giants);
      else if (key === 'empty') this.end(OUT.empty, '원반의 재료가 모자라 행성이 자라지 못했습니다. 그래서 이 항성계는 생명 단계로 이어지지 않습니다. 「새 세계」로 다른 구름을 시도해 보세요.', OUT.empty);
      else this.end(OUT.rocky, sum + ' 거대 행성이 없고, 생명 가능 지대에 알맞은 크기의 암석 행성도 없습니다.' + nextNote, OUT.rocky);
    }
    finishEarly() {
      const age = WS.fmtYears(this.age);
      if (!this.sinks.length) this.end('아직 별이 없는 구름', `${age} 동안 구름은 아직 별을 만들지 못했습니다.`, '별이 생기지 않음 (아직)');
      else this.end('막 태어난 원시별', `${age} 시점: 원시별이 태어났지만 행성을 만들 원반은 아직 자리 잡기 전입니다.`, '형성 중인 항성계');
    }
  }

  /* 행성 종류 */
  const KIND = {
    gas: { label: '가스 거인', col: [226, 178, 120] },
    ice: { label: '얼음 거인', col: [140, 192, 232] },
    bigrock: { label: '거대 암석 행성', col: [190, 160, 130] },
    water: { label: '물의 행성', col: [74, 134, 216] },
    icy: { label: '얼음 천체', col: [170, 196, 224] },
    super: { label: '슈퍼지구', col: [176, 150, 118] },
    earth: { label: '물 있는 지구형 행성', col: [78, 140, 214] },
    rock: { label: '지구형 행성', col: [172, 132, 102] },
    small: { label: '작은 암석 행성', col: [150, 128, 112] },
    embryo: { label: '행성 배아', col: [150, 135, 120] },
  };
  function kindOf(m, w, hz) {
    if (m >= 50) return 'gas';
    if (m >= 10) return w > 0.1 ? 'ice' : 'bigrock';
    if (w > 0.08) return m >= 2 ? 'water' : 'icy';
    if (m >= 2) return 'super';
    if (m >= 0.3) return hz && w >= 5e-5 ? 'earth' : 'rock';
    if (m >= 0.08) return 'small';
    return 'embryo';
  }

  /* ---------- 결과 분류 (실험실) ---------- */
  function classify(s) {
    if (s.phase !== 'disk') {
      if (!s.sinks.length) return 'nostar';
      const p = s.primary || s.sinks.reduce((a, b) => (b.m > a.m ? b : a));
      return p.close ? 'binary' : 'rocky';
    }
    if (s.Mstar < 0.08) return 'nostar';
    if (s.blewUp) return 'supernova';
    const ps = s.planets();
    if (s.settled()) {
      const hz = s.hzRocky(ps), wet = hz.filter((p) => p.w >= 5e-5);
      if (wet.length) return wet.some((p) => p.moons > 0) ? 'earthmoon' : 'wet';
      if (hz.length) return 'dry';
    }
    if (s.binary) return 'binary';
    if (ps.some((p) => p.m >= 10)) return 'giants';
    return s.settled() && !ps.some((p) => p.m >= 0.1) ? 'empty' : 'rocky';
  }
  function hzCount(s, wet) {
    let c = 0;
    for (let i = 0; i < s.nB; i++) {
      const m = s.bm[i], w = s.bw[i];
      if (m < 0.4 || m > 5 || w > 0.08 || (wet && w < 5e-5)) continue; // hzRocky와 같은 기준 (결과 분류와 어긋나지 않게)
      const o = s.orbit(i), a = isFinite(o.a) ? o.a : o.r;
      if (a >= s.hzIn && a <= s.hzOut) c++;
    }
    return c;
  }
  // 원반 단계 전용 지표: 원반 전이면 아직 값 없음, 별이 안 생기고 끝났거나 초신성이면 '없음'
  const diskMetric = (f, none) => (s) => (s.phase === 'disk' ? (s.blewUp ? none : f(s)) : s.ended ? none : NaN);
  function maxMass(s) { let m = 0; for (let i = 0; i < s.nB; i++) if (s.bm[i] > m) m = s.bm[i]; return m; }
  // 같은 씨앗 쌍둥이의 닮음: 원반이면 거리별 질량 분포(로그 칸 16개, √질량 가중)의 겹침, 구름이면 밀도 격자의 겹침
  function radial(s) {
    const B = 16, h = new Float64Array(B), l0 = Math.log10(0.3), l1 = Math.log10(60);
    let tot = 0;
    for (let i = 0; i < s.nB; i++) {
      const r = Math.hypot(s.bx[i], s.by[i]);
      const k = WS.clamp(Math.floor(((Math.log10(Math.max(r, 0.3)) - l0) / (l1 - l0)) * B), 0, B - 1);
      const w = Math.sqrt(s.bm[i]);
      h[k] += w; tot += w;
    }
    if (tot > 0) for (let k = 0; k < B; k++) h[k] /= tot;
    return h;
  }
  function overlap(a, b) {
    let sa = 0, sb = 0, o = 0;
    for (let i = 0; i < a.length; i++) { sa += a[i]; sb += b[i]; }
    if (!sa && !sb) return 1;
    if (!sa || !sb) return 0;
    for (let i = 0; i < a.length; i++) o += Math.min(a[i] / sa, b[i] / sb);
    return o;
  }

  function step(s) {
    if (s.phase === 'cloud') s.cloudStep();
    else if (s.phase === 'zoom') {
      s.zoomStep++;
      if (s.zoomStep >= ZOOM_STEPS) s.initDisk();
    } else if (s.phase === 'disk') s.diskStep();
    if (!s.ended && s.until && s.phase !== 'disk' && s.age >= s.until) s.finishEarly();
  }

  /* ---------- 그리기 도우미 ---------- */
  const F_BODY = "'IBM Plex Sans KR', 'Malgun Gothic', sans-serif";
  const F_MONO = "'IBM Plex Mono', Consolas, monospace";
  const C_TEXT = '#ebe4d3', C_MUTED = '#a3abbb', C_BRASS = '#f1cb86', C_LEAF = '#96cf88', C_CYAN = '#84c6d2';
  function txt(ctx, s, x, y, o) {
    o = o || {};
    ctx.font = (o.weight ? o.weight + ' ' : '') + (o.size || 12) + 'px ' + (o.font || F_BODY);
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.base || 'alphabetic';
    if (o.halo !== false) { ctx.lineJoin = 'round'; ctx.lineWidth = o.haloW || 3.5; ctx.strokeStyle = o.haloC || 'rgba(5,7,11,.85)'; ctx.strokeText(s, x, y); }
    ctx.fillStyle = o.color || C_TEXT;
    ctx.fillText(s, x, y);
  }
  function wrap(ctx, s, maxW) {
    const words = s.split(' '), lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  // 줄 나누기: max 줄을 넘으면 끝 문장부터 빼고, 한 문장도 안 들어가면 말줄임표 (문장 중간에서 말없이 끊기지 않게)
  function fitLines(ctx, t, maxW, max) {
    const lines = wrap(ctx, t, maxW);
    if (lines.length <= max) return lines;
    const ends = [];
    for (let i = 0; i < t.length - 1; i++) if ('.!?'.includes(t[i]) && t[i + 1] === ' ') ends.push(i + 1);
    for (let k = ends.length - 1; k >= 0; k--) { const l = wrap(ctx, t.slice(0, ends[k]), maxW); if (l.length <= max) return l; }
    const out = lines.slice(0, max);
    let last = out[max - 1];
    while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    out[max - 1] = last + '…';
    return out;
  }
  /* 가운데 정렬 설명문: 문자열 또는 [{ t, size, color, max }] 여러 단락을 어두운 띠 하나 위에.
     spot = capSpot(...)의 { cx, w, y, bottom }. 배치(capLayout)를 먼저 해 두면 이름표가 그 자리를 피할 수 있음 */
  function capLayout(ctx, parts, spot) {
    if (typeof parts === 'string') parts = [{ t: parts }];
    const narrow = spot.w < 420;
    const groups = parts.map((p, gi) => {
      const size = p.size || 12.5;
      ctx.font = size + 'px ' + F_BODY;
      return fitLines(ctx, p.t, spot.w, (p.max || 3) + (narrow && gi === 0 ? 1 : 0)).map((l) => ({ l, size, color: p.color || C_MUTED, w: ctx.measureText(l).width }));
    });
    const height = (gs) => gs.reduce((a, g) => a + g.reduce((b, r) => b + r.size * 1.45, 0), 0);
    let y = spot.y;
    // 아래 공간이 모자라면 덧붙인 단락부터 뺌, 그래도 넘치면 위로 올림
    while (groups.length > 1 && groups[0].length && y - groups[0][0].size + height(groups) > spot.bottom) groups.pop();
    const rows = [].concat(...groups);
    if (!rows.length) return null;
    const h = height(groups), w = Math.max(...rows.map((r) => r.w)) + 24;
    if (y - rows[0].size + h > spot.bottom) y = spot.bottom - h + rows[0].size;
    return { rows, cx: spot.cx, y, box: [spot.cx - w / 2, y - rows[0].size - 5, w, h + 6] };
  }
  function capDraw(ctx, L) {
    if (!L) return;
    ctx.fillStyle = 'rgba(5,7,11,.72)';
    rrect(ctx, L.box[0], L.box[1], L.box[2], L.box[3], 7); ctx.fill();
    let yy = L.y;
    for (const r of L.rows) { txt(ctx, r.l, L.cx, yy, { align: 'center', size: r.size, color: r.color, halo: false }); yy += r.size * 1.45; }
  }
  function caption(ctx, parts, spot) { const L = capLayout(ctx, parts, spot); capDraw(ctx, L); return L; }
  // 이름표: 대상 (x,y) 둘레 후보 자리 중 다른 이름표·가장자리와 겹치지 않는 곳에, 어두운 바탕과 지시선으로
  function placeTag(ctx, placed, x, y, r, lines, box, o) {
    o = o || {};
    ctx.font = '600 12px ' + F_BODY;
    const w0 = ctx.measureText(lines[0]).width;
    ctx.font = '11.5px ' + F_BODY;
    const ic = o.icon ? 15 : 0;
    const w = Math.max(w0, ...lines.slice(1).map((l) => ctx.measureText(l).width)) + 12 + ic, h = 15 * lines.length + 6;
    const g = r + 9;
    const cand = o.prefer === 'below' ? [[-w / 2, g + 2], [g, g], [-g - w, g], [g, -g - h], [-g - w, -g - h], [-w / 2, -g - h - 2]]
      : [[g, -g - h], [-g - w, -g - h], [g, g], [-g - w, g], [-w / 2, -g - h - 4], [-w / 2, g + 4]];
    const far = g + 26;
    cand.push([far, -far - h], [-far - w, -far - h], [far, far], [-far - w, far], [-w / 2, far + 6], [-w / 2, -far - h - 6]);
    if (box[2] - box[0] < w + 8) return false;
    for (const [dx, dy] of cand) {
      // 가장자리를 넘으면 가로로만 밀어 넣음 (대상 점을 가리지 않는 한)
      const rx = Math.min(box[2] - 4 - w, Math.max(box[0] + 4, x + dx)), ry = y + dy;
      if (ry < box[1] + 4 || ry + h > box[3] - 4) continue;
      if (x > rx - r - 2 && x < rx + w + r + 2 && y > ry - r - 2 && y < ry + h + r + 2) continue;
      if (placed.some((p) => rx < p[0] + p[2] && rx + w > p[0] && ry < p[1] + p[3] && ry + h > p[1])) continue;
      placed.push([rx, ry, w, h]);
      const ax = Math.min(rx + w, Math.max(rx, x)), ay = dy < 0 ? ry + h : ry;
      const ang = Math.atan2(ay - y, ax - x);
      ctx.strokeStyle = o.line || 'rgba(241,203,134,.55)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(ang) * (r + 2), y + Math.sin(ang) * (r + 2)); ctx.lineTo(ax, ay); ctx.stroke();
      ctx.fillStyle = 'rgba(8,10,16,.82)';
      rrect(ctx, rx, ry, w, h, 5); ctx.fill();
      ctx.strokeStyle = o.line || 'rgba(241,203,134,.3)';
      ctx.stroke();
      let tx = rx + 6;
      if (o.icon) { o.icon(ctx, rx + 11, ry + 10.5, 5); tx += ic; }
      lines.forEach((l, i) => txt(ctx, l, tx, ry + 15 + i * 15, i === 0 ? { weight: 600, color: o.color || C_BRASS, halo: false } : { size: 11.5, color: C_TEXT, halo: false }));
      return true;
    }
    return false;
  }
  /* 셸의 안내층(해설 카드·보기 전환·범례·알림)이 캔버스를 덮는 자리를 실제 화면에서 잼 (캔버스 좌표, 0.25초마다).
     셸이 없는 시험 화면에서는 예전의 고정 자리(왼쪽 위 340×118, 왼쪽 아래 290×132)를 씀 */
  let hudC = null;
  function hud(ctx, W, H) {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (hudC && hudC.cv === ctx.canvas && hudC.W === W && hudC.H === H && now - hudC.t < 250) return hudC;
    const h = { t: now, cv: ctx.canvas, W, H, dom: false, nar: null, views: null, legend: null, toasts: null };
    try {
      const cv = ctx.canvas, doc = cv && cv.ownerDocument;
      if (doc && doc.getElementById('legendBox') && cv.getBoundingClientRect) {
        h.dom = true;
        const cr = cv.getBoundingClientRect(), k = cr.width ? W / cr.width : 1;
        const rect = (id) => {
          const el = doc.getElementById(id);
          if (!el || el.hidden || !el.offsetParent) return null;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2 || r.bottom <= cr.top || r.top >= cr.bottom || r.right <= cr.left || r.left >= cr.right) return null;
          return [(r.left - cr.left) * k, (r.top - cr.top) * k, r.width * k, r.height * k];
        };
        h.nar = rect('narrator'); h.views = rect('views'); h.legend = rect('legendBox'); h.toasts = rect('toasts');
      }
    } catch (e) { h.dom = false; }
    return (hudC = h);
  }
  // 이름표가 피할 자리 (알림은 잠깐 떴다 사라지므로 이름표는 피하지 않음; 설명문만 피함)
  function reserved(h, W, H) {
    if (!h.dom) return [[0, 0, Math.min(340, W * 0.45), 118], [0, H - 132, Math.min(290, W * 0.42), 132]];
    return [h.nar, h.views, h.legend].filter(Boolean).map((r) => [r[0] - 6, r[1] - 6, r[2] + 12, r[3] + 12]);
  }
  // 설명문 자리: 범례 오른쪽 빈 곳 (모자라면 범례 위로), 알림이 떠 있으면 그 위로. y = 바라는 첫 줄 위치
  function capSpot(h, W, H, y, wMax) {
    let left = 12, right = W - 12, bottom = H - 6;
    if (!h.dom) { if (W >= 640) left = Math.min(300, W * 0.32); }
    else if (h.legend) {
      const L = h.legend, lr = L[0] + L[2] + 12;
      if (right - lr >= Math.min(320, W * 0.45)) left = lr; else bottom = Math.min(bottom, L[1] - 8);
    }
    const T = h.toasts;
    if (T && T[0] < right && T[0] + T[2] > left) bottom = Math.min(bottom, T[1] - 6);
    return { cx: (left + right) / 2, w: Math.min(wMax || 1e9, right - left), y, bottom };
  }
  const hits = (a, b) => a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
  function niceLen(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
    return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
  }
  const fmtAU = (au) => (au >= 100 ? Math.round(au).toLocaleString('ko-KR') : au >= 10 ? WS.trimNum(Math.round(au * 10) / 10) : au >= 1 ? WS.trimNum(Math.round(au * 100) / 100) : WS.trimNum(au)) + ' AU';
  // 유효 숫자 두 자리: 아주 작은 값도 0으로 뭉개지지 않게 (0.0014, 0.11, 1.5, 31)
  const sig2 = (v) => {
    if (!(v > 0)) return '0';
    if (v >= 100) return Math.round(v).toLocaleString('ko-KR');
    return String(parseFloat(v.toFixed(Math.max(0, 1 - Math.floor(Math.log10(v))))));
  };
  const fmtM = (m) => (m >= 10 ? Math.round(m).toLocaleString('ko-KR') : m < 0.1 ? sig2(m) : WS.trimNum(Math.round(m * 100) / 100));
  // 구름의 중력과 압력: 숫자(모형 내부 값) 대신 말로
  const gravWord = (J) => (J >= 1.5 ? '중력이 훨씬 셈' : J >= 1.1 ? '중력이 조금 셈' : J >= 0.9 ? '거의 비슷함' : J >= 0.7 ? '압력이 조금 셈' : '압력이 훨씬 셈');
  // 행성 그림: 종류별 색, 거인의 띠·고리, 지구형의 바다·땅, 그늘
  function drawPlanet(ctx, x, y, r, kind, seed) {
    const K = KIND[kind] || KIND.rock, c = K.col;
    if (r < 2.4) { ctx.fillStyle = WS.rgb(WS.mix(c, [40, 44, 60], 0.3), 0.8); ctx.beginPath(); ctx.arc(x, y, Math.max(1, r), 0, Math.PI * 2); ctx.fill(); return; }
    if (kind === 'ice' || (kind === 'gas' && seed % 3 === 0)) {
      ctx.strokeStyle = kind === 'ice' ? 'rgba(200,230,250,.55)' : 'rgba(240,215,170,.6)';
      ctx.lineWidth = Math.max(1, r * 0.18);
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.75, r * 0.5, -0.35, Math.PI * 0.92, Math.PI * 2.08); ctx.stroke();
    }
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = WS.rgb(c); ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    if (kind === 'gas') {
      for (let k = -2; k <= 2; k++) { ctx.fillStyle = k % 2 ? 'rgba(150,95,55,.45)' : 'rgba(255,235,200,.35)'; ctx.fillRect(x - r, y + k * r * 0.38 - r * 0.1, 2 * r, r * 0.2); }
    } else if (kind === 'ice') {
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x - r, y - r * 0.15, 2 * r, r * 0.3);
    } else if (kind === 'earth' || kind === 'water') {
      ctx.fillStyle = kind === 'earth' ? 'rgba(110,170,90,.9)' : 'rgba(150,200,240,.5)';
      const q = (seed * 2654435761) >>> 0;
      for (let k = 0; k < 3; k++) { const a = ((q >> (k * 5)) & 31) / 31 * 6.28, d = r * 0.45; ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (kind === 'earth' ? 0.38 : 0.2), 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(x - r, y - r, 2 * r, r * 0.22);
    } else if (r > 4) {
      ctx.fillStyle = 'rgba(70,50,40,.35)';
      const q = (seed * 2246822519) >>> 0;
      for (let k = 0; k < 3; k++) { const a = ((q >> (k * 6)) & 63) / 63 * 6.28, d = r * 0.5; ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.18, 0, Math.PI * 2); ctx.fill(); }
    }
    const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r * 1.05);
    g.addColorStop(0, 'rgba(255,255,255,.28)'); g.addColorStop(0.55, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.5)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    ctx.restore();
  }
  function starColor(M) {
    if (M < 0.08) return [150, 70, 60];
    if (M < 0.5) return [255, 150, 100];
    if (M < 0.9) return [255, 205, 140];
    if (M < 1.5) return [255, 240, 210];
    if (M < 4) return [215, 230, 255];
    return [170, 195, 255];
  }
  function starKind(s) {
    const M = s.Mstar;
    if (M < 0.08) return '갈색 왜성 (빛나지 못한 별)';
    if (!s.reached.ignite) return '원시별 · 아직 핵융합 전';
    if (M < 0.5) return '붉은 왜성 · 작고 오래 삶';
    if (M < 0.9) return '주황색 별';
    if (M < 1.5) return '노란 별 · 태양과 비슷';
    if (M < 4) return '흰 별 · 밝고 수명이 짧음';
    return '푸른 거성 · 곧 폭발';
  }
  function glowStar(ctx, x, y, r, c, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
    g.addColorStop(0, WS.rgb(c, a)); g.addColorStop(0.2, WS.rgb(c, 0.6 * a)); g.addColorStop(1, WS.rgb(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r * 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = WS.rgb(WS.mix(c, [255, 255, 255], 0.5), a);
    ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, Math.PI * 2); ctx.fill();
  }

  /* ---------- 그리기 ---------- */
  function cloudView(W, H) {
    const S = Math.max(120, Math.min(W - 32, H - 92));
    return { S, x0: (W - S) / 2, y0: Math.max(40, (H - 52 - S) / 2) };
  }
  function diskView(s, W, H) {
    const top = 40, bottom = 58;
    const R = Math.max(70, Math.min(W / 2 - 20, (H - top - bottom) / 2));
    const cx = W / 2, cy = top + Math.max(R, (H - top - bottom) / 2);
    const rMax = Math.max(s.frost * 1.4, s.rOut * 1.15); // 원반 크기에 맞춰 (작은 쌍성 원반도 잘 보이게)
    const map = (r) => R * Math.pow(Math.min(r, rMax * 3) / rMax, 0.55);
    return { cx, cy, R, rMax, map };
  }
  const CLOUD_STOPS = [[90, 30, 40], [170, 60, 50], [240, 140, 80], [255, 220, 160]];
  const NEB_STOPS = [[0, 0, 0], [40, 12, 24], [96, 30, 44], [170, 66, 52], [236, 140, 84], [255, 222, 170]];
  // 성운 빛: 밀도 격자를 한 번 흐려 색을 입힌 64×64 그림 (단계마다 한 번만 다시 만듦)
  function nebula(s) {
    let c = s._neb;
    if (c && c._step === s.steps) return c;
    if (!c) { c = s._neb = document.createElement('canvas'); c.width = c.height = NG; }
    const g = c.getContext('2d'), img = g.createImageData(NG, NG), d = img.data, rho = s.rho;
    for (let y = 0; y < NG; y++) for (let x = 0; x < NG; x++) {
      let v = 4 * rho[y * NG + x], wsum = 4;
      if (x > 0) { v += rho[y * NG + x - 1]; wsum++; }
      if (x < NG - 1) { v += rho[y * NG + x + 1]; wsum++; }
      if (y > 0) { v += rho[(y - 1) * NG + x]; wsum++; }
      if (y < NG - 1) { v += rho[(y + 1) * NG + x]; wsum++; }
      const t = Math.log10(1 + (2 * v) / wsum / s.rho0) / 2.2;
      const col = WS.ramp(NEB_STOPS, t), i = (y * NG + x) * 4;
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    c._step = s.steps;
    return c;
  }
  // 배경 별 (고정된 해시 위치, 화면 전용)
  function starfield(ctx, W, H) {
    for (let i = 0; i < 160; i++) {
      const h = Math.imul(i + 1, 2654435761) >>> 0, h2 = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
      const x = (h / 4294967296) * W, y = (h2 / 4294967296) * H, b = 0.15 + ((h2 >>> 7) % 100) / 260;
      ctx.fillStyle = `rgba(220,226,255,${b})`;
      ctx.fillRect(x, y, i % 7 ? 1 : 1.6, i % 7 ? 1 : 1.6);
    }
  }
  function dustOf(s) {
    if (s._dust) return s._dust;
    const r = new WS.RNG((s.seed ^ 0x2545f491) >>> 0 || 3), d = []; // 화면 전용 난수 (시뮬레이션 난수와 분리)
    for (let i = 0; i < 700; i++) d.push([s.rIn * Math.pow((s.rOut * 1.3) / s.rIn, r.next()), r.next() * Math.PI * 2, r.next()]);
    return (s._dust = d);
  }

  function render(s, ctx, W, H, time, app) {
    const view = app && app.view ? app.view : 0;
    s._view = view;
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, W, H);
    if (s.phase === 'cloud' || s.phase === 'zoom') renderCloud(s, ctx, W, H, view);
    else if (view === 1) renderOrrery(s, ctx, W, H);
    else renderDisk(s, ctx, W, H, time);
  }

  function renderCloud(s, ctx, W, H, view) {
    const { S, x0, y0 } = cloudView(W, H);
    let zx = 0.5, zy = 0.5, z = 1;
    if (s.phase === 'zoom') { const p = WS.smooth(0, 1, s.zoomStep / ZOOM_STEPS); z = 1 + p * 14; zx = WS.lerp(0.5, s.primary.x, p); zy = WS.lerp(0.5, s.primary.y, p); }
    const tx = (x) => x0 + S / 2 + (x - zx) * S * z, ty = (y) => y0 + S / 2 + (y - zy) * S * z;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    starfield(ctx, W, H);
    // 구름의 밀도를 부드러운 성운 빛으로 (화면 전용)
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(nebula(s), tx(0), ty(0), S * z, S * z);
    const ps = Math.max(1.2, S / 420) * Math.sqrt(z);
    // 밀도 4단계로 묶어 칠하기 (fillStyle 전환을 줄임)
    for (let band = 0; band < 4; band++) {
      ctx.fillStyle = WS.rgb(WS.ramp(CLOUD_STOPS, (band + 0.5) / 4), 0.55);
      for (let n = 0; n < s.N; n++) {
        if (!s.alive[n]) continue;
        const gi = Math.min(NG - 1, Math.max(0, Math.floor(s.py[n] * NG))) * NG + Math.min(NG - 1, Math.max(0, Math.floor(s.px[n] * NG)));
        const t = Math.log10(1 + s.rho[gi] / s.rho0) / 2;
        if (Math.min(3, Math.floor(t * 4)) !== band) continue;
        ctx.fillRect(tx(s.px[n]), ty(s.py[n]), ps, ps);
      }
    }
    const sinks = s.sinks.slice().sort((a, b) => b.m - a.m);
    for (const k of sinks) {
      const M = k.m * s.Mc * 0.6;
      const r = 3 + Math.cbrt(M + 0.01) * 5 * Math.sqrt(z);
      const x = tx(k.x), y = ty(k.y);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
      const c = starColor(Math.max(0.1, M));
      g.addColorStop(0, WS.rgb(c, 0.95)); g.addColorStop(0.25, WS.rgb(c, 0.5)); g.addColorStop(1, WS.rgb(c, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r * 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    WS.drawFx(ctx, s, (x, y) => [tx(x), ty(y), S * z]);
    ctx.restore();
    // 설명문과 축척 막대 자리를 먼저 잡고, 이름표는 그 자리와 셸의 안내층을 피함
    const hb = hud(ctx, W, H);
    const what = s.phase === 'zoom' ? '가장 무거운 원시별 쪽으로 확대합니다. 곧 그 주위에 가스와 먼지의 원반이 펼쳐집니다.'
      : s.ended ? '구름이 흩어졌습니다. 중력이 가스의 압력과 회전을 이기지 못하면 별은 태어나지 않습니다.'
        : s.sinks.length ? '밝은 빛무리가 원시별입니다. 주변 가스를 삼키며 자라고, 서로 가까우면 합쳐지거나 쌍성이 됩니다.'
          : '분자운을 위에서 본 모습입니다. 밝을수록 가스가 빽빽하고, 가장 빽빽한 곳이 스스로의 중력으로 무너지면 별이 태어납니다.';
    const cap = capLayout(ctx, [{ t: what, max: 2 }, { t: (view === 1 ? '행성 배치도는 원반이 생긴 뒤에 볼 수 있습니다 · ' : s.phase === 'zoom' ? `${Math.round(z)}배로 확대하는 중 · ` : '화면 한 변 약 3만 6천 AU · ') + '1 AU = 태양과 지구 사이 거리', max: 2, size: 11.5, color: '#8a93a5' }], capSpot(hb, W, H, y0 + S + 20, Math.max(S, 300)));
    const placed = reserved(hb, W, H), box = [0, 34, W, y0 + S + 4];
    if (cap) placed.push(cap.box);
    if (s.phase === 'cloud') {
      // 축척 막대 (화면 한 변 ≈ 3만 6천 AU): 상자 오른쪽 아래, 가려지면 오른쪽 위
      const ell = niceLen(36000 * 0.2), bl = (ell / 36000) * S, sx1 = x0 + S - 14, sx0 = sx1 - bl;
      const sRect = (yy) => [sx0 - 4, yy - 20, bl + 8, 24];
      let sy = y0 + S - 14;
      if (placed.some((p) => hits(p, sRect(sy)))) sy = y0 + 30;
      if (!placed.some((p) => hits(p, sRect(sy)))) {
        placed.push(sRect(sy));
        ctx.strokeStyle = C_TEXT; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(sx0, sy - 4); ctx.lineTo(sx0, sy); ctx.lineTo(sx1, sy); ctx.lineTo(sx1, sy - 4); ctx.stroke();
        txt(ctx, WS.fmtCount(ell) + ' AU', (sx0 + sx1) / 2, sy - 7, { align: 'center', size: 11.5 });
      }
      sinks.slice(0, 4).forEach((k, i) => {
        const M = k.m * s.Mc * 0.6;
        if (M < 0.02) return;
        placeTag(ctx, placed, tx(k.x), ty(k.y), 6, [i === 0 ? '가장 무거운 원시별' : '원시별', `태양 질량의 ${sig2(M)}배${k.close ? ' · 쌍성' : ''}`], box);
      });
      if (!sinks.length && s.peak > 3) {
        let bi = 0;
        for (let i = 0; i < NG * NG; i++) if (s.rho[i] > s.rho[bi]) bi = i;
        const x = tx(((bi % NG) + 0.5) / NG), y = ty((((bi / NG) | 0) + 0.5) / NG);
        ctx.strokeStyle = 'rgba(255,220,160,.7)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        placeTag(ctx, placed, x, y, 14, [s.reached.collapse ? '무너지는 중심' : '가장 빽빽한 곳'], box, { color: '#ffd9a8' }); // 수치는 오른쪽 카드 한 곳에서만 보여 줌
      }
    } else if (s.primary) {
      const M = s.Mstar;
      placeTag(ctx, placed, tx(s.primary.x), ty(s.primary.y), 10 + 12 * WS.smooth(0, 1, s.zoomStep / ZOOM_STEPS), ['새로 태어난 별', `태양 질량의 ${sig2(M)}배${s.binary ? ' · 가까운 동반성 있음' : ''}`], box, { prefer: 'below' });
    }
    capDraw(ctx, cap);
  }

  function currentPlanets(s) {
    const byId = new Map();
    (s.plist || []).forEach((p) => byId.set(p.id, p));
    const out = [];
    for (let i = 0; i < s.nB; i++) {
      const m = s.bm[i];
      const known = byId.get(s.bid[i]);
      out.push({ i, m, id: s.bid[i], w: s.bw[i], moons: s.bmoon[i], letter: s.pLetter.get(s.bid[i]) || '', p: known });
    }
    return out;
  }
  function tagLines(s, b) {
    const o = s.orbit(b.i), a = isFinite(o.a) ? o.a : o.r, hz = a >= s.hzIn && a <= s.hzOut;
    const kind = kindOf(b.m, b.w, hz);
    const head = (b.letter ? b.letter + ' · ' : '') + KIND[kind].label;
    let sub = `지구의 ${fmtM(b.m)}배 · ${fmtAU(a * s.D)}`;
    if (kind !== 'gas' && kind !== 'ice' && b.w >= 5e-5 && b.w <= 0.08) sub += ' · 물 있음';
    if (b.moons) sub += ' · 위성 ' + b.moons;
    return { kind, lines: [head, sub], hz, a };
  }

  function renderDisk(s, ctx, W, H, time) {
    const V = diskView(s, W, H);
    const { cx, cy, map, R } = V;
    const pos = (x, y) => { const r = Math.hypot(x, y), th = Math.atan2(y, x), rp = map(r); return [cx + Math.cos(th) * rp, cy + Math.sin(th) * rp]; };
    // 가스 원반 + 먼지 (먼지는 화면 전용 난수)
    if (s.gasLeft > 0 && !s.blewUp) {
      const R0 = map(s.rOut * 1.3);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R0);
      g.addColorStop(0, `rgba(255,200,140,${0.28 * s.gasLeft})`);
      g.addColorStop(0.5, `rgba(170,110,90,${0.16 * s.gasLeft})`);
      g.addColorStop(1, 'rgba(60,50,80,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, R0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,220,180,${0.35 * s.gasLeft})`;
      for (const d of dustOf(s)) {
        const th = d[1] + (Math.PI * 2 * s.tt) / Math.pow(d[0], 1.5);
        const rp = map(d[0]);
        ctx.fillRect(cx + Math.cos(th) * rp, cy + Math.sin(th) * rp, 1.2, 1.2);
      }
    }
    // 생명 가능 지대, 눈선
    const rIn = map(s.hzIn), rOut = map(s.hzOut), rF = map(s.frost);
    ctx.fillStyle = 'rgba(150,207,136,.13)';
    ctx.beginPath(); ctx.arc(cx, cy, rOut, 0, Math.PI * 2); ctx.arc(cx, cy, rIn, 0, Math.PI * 2, true); ctx.fill();
    ctx.strokeStyle = 'rgba(150,207,136,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, rOut, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, rIn, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(132,198,210,.55)';
    ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.arc(cx, cy, rF, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    // 설명문 자리를 먼저 잡고, 눈금 글자·영역 이름·이름표는 그 자리와 셸의 안내층을 피함
    const D = s.D, rMinN = s.rIn * 0.9, hb = hud(ctx, W, H);
    const what = s.blewUp ? '무거운 별은 빨리 타 버립니다. 폭발이 행성들을 날려 보냈고, 흩어진 원소는 다음 세대 별의 재료가 됩니다.'
      : s.gasLeft > 0 ? '위에서 본 원반입니다. 노란 안개가 가스이고, 점들은 서로 부딪히며 자라는 행성의 씨앗입니다. 눈선 바깥에서는 얼음까지 뭉쳐 거대 행성이 잘 자랍니다.'
        : '가스가 사라졌습니다. 남은 천체들이 서로 끌어당기고 부딪히며 궤도를 정리합니다. 초록 띠 안의 암석 행성은 물이 액체로 있을 수 있습니다.';
    const cap = capLayout(ctx, [{ t: what, max: 2 }, { t: `거리는 보기 좋게 압축했습니다 · 원은 행성의 궤도 · 이 별의 생명 가능 지대 ${fmtAU(s.hzIn * D)}–${fmtAU(s.hzOut * D)}`, max: 2, size: 11.5, color: '#8a93a5' }], capSpot(hb, W, H, cy + R + 22 > H - 30 ? H - 36 : cy + R + 22, 640));
    const placed = reserved(hb, W, H), box = [0, 34, W, H - 50];
    if (cap) placed.push(cap.box);
    // 거리 눈금 (왼쪽 수평선)
    ctx.strokeStyle = 'rgba(146,154,171,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - map(rMinN), cy); ctx.lineTo(cx - Math.min(R, map(V.rMax)), cy); ctx.stroke();
    const tickAU = [300, 100, 30, 10, 3, 1, 0.3, 0.1, 0.03, 0.01].filter((au) => au / D >= rMinN && au / D <= V.rMax);
    for (const au of tickAU) {
      const x = cx - map(au / D);
      ctx.beginPath(); ctx.moveTo(x, cy - 3); ctx.lineTo(x, cy + 3); ctx.stroke();
    }
    // 행성 궤도
    const bodies = currentPlanets(s);
    ctx.strokeStyle = 'rgba(235,228,211,.10)';
    // 궤도 원은 큰 천체 몇 개만 (작은 배아까지 그리면 화면이 레코드판처럼 복잡해짐)
    if (!s.blewUp) bodies.filter((b) => b.m >= 0.3).sort((a, b) => b.m - a.m).slice(0, s.gasLeft > 0 ? 6 : 12).forEach((b) => { const r = map(Math.hypot(s.bx[b.i], s.by[b.i])); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); });
    // 별
    const sc = starColor(s.Mstar);
    const sr = 5 + Math.cbrt(s.Mstar) * 5;
    if (s.blewUp) {
      const g = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R * 0.6);
      g.addColorStop(0, 'rgba(255,190,140,0)'); g.addColorStop(0.7, 'rgba(255,140,110,.35)'); g.addColorStop(1, 'rgba(120,150,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 0.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e8eeff'; ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
    } else glowStar(ctx, cx, cy, sr, sc, s.reached.ignite ? 1 : s.Mstar < 0.08 ? 0.45 : 0.65);
    let compXY = null;
    if (s.comp && !s.blewUp) {
      const [px, py] = s.compPos();
      compXY = pos(px, py);
      glowStar(ctx, compXY[0], compXY[1], 3 + Math.cbrt(s.binary.m) * 4, starColor(s.binary.m), 0.9);
    }
    // 천체
    if (!s.blewUp) for (const b of bodies) {
      const [x, y] = pos(s.bx[b.i], s.by[b.i]);
      const m = b.m, sz = Math.max(1.2, Math.min(14, 1.3 + Math.cbrt(m) * 2.6));
      const r = Math.hypot(s.bx[b.i], s.by[b.i]);
      drawPlanet(ctx, x, y, m < 0.3 ? Math.min(sz, 2) : sz, kindOf(m, b.w, r >= s.hzIn && r <= s.hzOut), b.id); // 작은 배아는 흐린 점으로
      if (b.moons && sz > 2) { ctx.fillStyle = 'rgba(230,230,230,.9)'; ctx.beginPath(); ctx.arc(x + sz + 2.5, y - sz * 0.4, 1.5, 0, Math.PI * 2); ctx.fill(); }
    }
    WS.drawFx(ctx, s, (x, y) => { const p = pos(x, y); return [p[0], p[1], R / 6]; });

    /* 이름표: 별, 영역, 주요 행성 */
    // 영역 이름 (위쪽 호 위, 가려지면 아래쪽 호 아래)
    const zoneTag = (r, text, col) => {
      ctx.font = '600 12px ' + F_BODY;
      const w = ctx.measureText(text).width;
      for (const y of [cy - r - 6, cy + r + 16]) {
        const zr = [cx - w / 2 - 4, y - 13, w + 8, 17];
        if (y < 40 || y > H - 8 || placed.some((p) => hits(p, zr))) continue;
        placed.push(zr);
        txt(ctx, text, cx, y, { align: 'center', weight: 600, color: col });
        return;
      }
    };
    zoneTag(rOut, '생명 가능 지대', C_LEAF);
    if (rF - rOut > 16) zoneTag(rF, '눈선 (얼음이 생기는 경계)', C_CYAN);
    if (s.blewUp) placeTag(ctx, placed, cx, cy, 10, ['초신성 잔해', '중심별이 폭발했습니다'], box, { prefer: 'below', color: '#ffb59a' });
    else placeTag(ctx, placed, cx, cy, sr * 1.2, ['중심별 · 태양 질량의 ' + sig2(s.Mstar) + '배', starKind(s)], box, { prefer: 'below' });
    if (compXY) placeTag(ctx, placed, compXY[0], compXY[1], 8, ['동반성', `태양 질량의 ${sig2(s.binary.m)}배`], box);
    if (!s.blewUp) {
      const pick = bodies.filter((b) => b.m >= 0.3).map((b) => Object.assign(b, tagLines(s, b)));
      pick.sort((a, b) => (b.hz && b.m < 10 ? 1e4 : 0) + b.m - ((a.hz && a.m < 10 ? 1e4 : 0) + a.m));
      const maxTags = W < 600 ? 3 : s.gasLeft > 0.3 ? 4 : 7;
      let k = 0;
      for (const b of pick) {
        if (k >= maxTags) break;
        const [x, y] = pos(s.bx[b.i], s.by[b.i]);
        const sz = Math.max(1.2, Math.min(14, 1.3 + Math.cbrt(b.m) * 2.6));
        if (placeTag(ctx, placed, x, y, sz, b.lines, box, { color: b.hz && b.m < 10 ? C_LEAF : C_BRASS, icon: (c, ix, iy, ir) => drawPlanet(c, ix, iy, ir, b.kind, b.id) })) k++;
      }
    }
    // 거리 눈금 글자: 가장 덜 중요하므로 맨 나중에, 이름표·행성·별빛과 겹치지 않는 자리에만 (좁게 모인 항성계에서는 안쪽 눈금 글자를 뺌)
    const dots = s.blewUp ? [] : bodies.filter((b) => b.m >= 0.3).map((b) => { const [x, y] = pos(s.bx[b.i], s.by[b.i]), q = Math.max(1.2, Math.min(14, 1.3 + Math.cbrt(b.m) * 2.6)) + 2; return [x - q, y - q, 2 * q, 2 * q]; });
    const glow = sr * 1.6;
    let lastX = -1e9;
    for (const au of tickAU) {
      const x = cx - map(au / D), lr = [x - 26, cy + 5, 52, 14];
      if (x - lastX < 54 || x + 26 > cx - glow) continue;
      if (placed.some((p) => hits(p, lr)) || dots.some((p) => hits(p, lr))) continue;
      lastX = x;
      txt(ctx, au + ' AU', x, cy + 15, { align: 'center', size: 10.5, font: F_MONO, color: '#8a93a5' });
    }
    capDraw(ctx, cap);
  }

  /* 행성 배치도: 별에서의 거리(로그)를 가로축으로 한 줄로 늘어놓음 */
  function renderOrrery(s, ctx, W, H) {
    const left = Math.max(56, Math.min(110, W * 0.12)), right = 24, top = 44;
    // 띠의 아래 끝(yB): 범례 위, 그리고 설명문(알림은 빼고 잰 자리) 위로. 눈금 글자가 yB+18에 옴
    const hb = hud(ctx, W, H), capParts = [{ t: '행성 배치도: 별에서 가까운 순서로 늘어놓았습니다. 동그라미 크기는 질량, 가로 막대는 궤도가 별에 가장 가까울 때와 멀 때의 범위입니다.', max: 2 }, { t: '거리는 로그 눈금 (오른쪽으로 갈수록 몇 배씩 멀어짐) · 1 AU = 태양과 지구 사이 거리', max: 2, size: 11.5, color: '#8a93a5' }];
    let yB = H - 78;
    if (hb.legend) yB = Math.min(yB, hb.legend[1] - 26);
    const cap0 = capLayout(ctx, capParts, capSpot(Object.assign({}, hb, { toasts: null }), W, H, yB + 46, 680));
    if (cap0 && cap0.box[1] < yB + 24) yB = cap0.box[1] - 24;
    yB = Math.max(top + 160, yB);
    const cap = capLayout(ctx, capParts, capSpot(hb, W, H, yB + 46, 680));
    const yA = top + (yB - top) * 0.5;
    const blocked = reserved(hb, W, H);
    if (cap) blocked.push(cap.box);
    const bodies = currentPlanets(s).map((b) => { const o = s.orbit(b.i); return Object.assign(b, { a: isFinite(o.a) ? o.a : o.r, e: Math.min(0.95, o.e) }); });
    let aMax = Math.max(s.rOut * 1.25, s.frost * 2);
    for (const b of bodies) if (b.m >= 0.1) aMax = Math.max(aMax, b.a * (1 + b.e) * 1.1);
    aMax = Math.min(aMax, 60);
    const aMin = Math.max(0.05, s.rIn * 0.6);
    const lx = (a) => left + (Math.log(Math.max(a, aMin * 0.5) / aMin) / Math.log(aMax / aMin)) * (W - left - right);
    // 영역 배경
    const xIn = lx(s.hzIn), xOut = lx(s.hzOut), xF = lx(s.frost);
    ctx.fillStyle = 'rgba(228,106,78,.07)'; ctx.fillRect(left, top, Math.max(0, xIn - left), yB - top);
    ctx.fillStyle = 'rgba(150,207,136,.15)'; ctx.fillRect(xIn, top, xOut - xIn, yB - top);
    ctx.fillStyle = 'rgba(132,198,210,.06)'; ctx.fillRect(xF, top, W - right - xF, yB - top);
    ctx.strokeStyle = 'rgba(132,198,210,.6)'; ctx.setLineDash([4, 5]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(xF, top); ctx.lineTo(xF, yB); ctx.stroke(); ctx.setLineDash([]);
    // 영역 이름: 중요한 것부터, 서로·안내층과 겹치면 옆으로 비키거나 뺌
    const zoneLab = (text, xs, o) => {
      ctx.font = (o.weight ? o.weight + ' ' : '') + o.size + 'px ' + F_BODY;
      const w = ctx.measureText(text).width;
      for (const x of xs) {
        const x0 = o.align === 'center' ? x - w / 2 : x, r = [x0 - 3, yB - 21, w + 6, 17];
        if (x0 < 4 || x0 + w > W - 4 || blocked.some((p) => hits(p, r))) continue;
        blocked.push(r);
        txt(ctx, text, o.align === 'center' ? x : x0, yB - 8, o);
        return r;
      }
      return null;
    };
    zoneLab('생명 가능 지대', [(xIn + xOut) / 2], { align: 'center', size: 12, weight: 600, color: C_LEAF });
    const nr = zoneLab('눈선 →', [xF + 4], { size: 11.5, color: C_CYAN });
    zoneLab('뜨거움', [(left + xIn) / 2, xIn - 30], { align: 'center', size: 11.5, color: '#e9a08c' });
    ctx.font = '11.5px ' + F_BODY;
    const wIce = ctx.measureText('얼음이 생기는 바깥').width, xIce = Math.min(W - right - wIce / 2 - 4, (xF + W - right) / 2 + 20);
    zoneLab('얼음이 생기는 바깥', [xIce, nr ? nr[0] + nr[2] + 10 + wIce / 2 : xIce], { align: 'center', size: 11.5, color: '#9cc7d6' });
    // 별 (왼쪽 가장자리)
    const sc = starColor(s.Mstar);
    if (s.blewUp) txt(ctx, '초신성 잔해', left - 8, yA + 4, { align: 'right', size: 12, color: '#ffb59a' });
    else {
      const sr = 10 + Math.cbrt(s.Mstar) * 8;
      glowStar(ctx, left - sr - 8, yA, sr, sc, s.reached.ignite ? 1 : 0.65);
    }
    // 축과 눈금
    ctx.strokeStyle = 'rgba(146,154,171,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(left, yA); ctx.lineTo(W - right, yA); ctx.stroke();
    let lastT = -1e9;
    [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].forEach((au) => {
      const an = au / s.D;
      if (an < aMin || an > aMax) return;
      const x = lx(an), major = /^(0\.0?1|1|10|100)$/.test(String(au));
      ctx.strokeStyle = 'rgba(146,154,171,' + (major ? '.5' : '.25') + ')';
      ctx.beginPath(); ctx.moveTo(x, yB); ctx.lineTo(x, yB + (major ? 6 : 3)); ctx.stroke();
      if ((major || W > 700) && x - lastT > 44) { lastT = x; txt(ctx, au + ' AU', x, yB + 18, { align: 'center', size: 10.5, font: F_MONO, color: major ? '#a3abbb' : '#6f788a', halo: false }); }
    });
    if (s.blewUp) {
      caption(ctx, [{ t: '중심별이 초신성으로 폭발해 행성들이 사라졌습니다.', size: 14, color: C_TEXT }], { cx: W / 2, w: W - 40, y: yA - 20, bottom: H - 6 });
    } else {
      // 작은 천체: 축 위아래로 흩뿌린 점 (id로 고정된 위치)
      ctx.fillStyle = 'rgba(170,150,130,.55)';
      for (const b of bodies) if (b.m < 0.1) {
        const j = (((b.id * 2654435761) >>> 0) / 4294967296 - 0.5) * 26;
        ctx.fillRect(lx(b.a) - 0.75, yA + j - 0.75, 1.5, 1.5);
      }
      // 행성: 궤도 범위 막대 + 그림
      const planets = bodies.filter((b) => b.m >= 0.1);
      const rad = (m) => WS.clamp(2.5 + Math.cbrt(m) * 3.2, 2.5, 26);
      for (const b of planets) {
        const x0 = lx(b.a * (1 - b.e)), x1 = lx(b.a * (1 + b.e));
        ctx.strokeStyle = 'rgba(235,228,211,.22)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x0, yA); ctx.lineTo(x1, yA); ctx.stroke();
      }
      const orr = [];
      for (const b of planets) {
        const x = lx(b.a), r = rad(b.m), hz = b.a >= s.hzIn && b.a <= s.hzOut;
        b.kind = kindOf(b.m, b.w, hz); b.hz = hz; b.x = x; b.r = r;
        drawPlanet(ctx, x, yA, r, b.kind, b.id);
        for (let k = 0; k < Math.min(3, b.moons); k++) { ctx.fillStyle = 'rgba(225,225,225,.9)'; ctx.beginPath(); ctx.arc(x + r + 4 + k * 4, yA - r * 0.6, 1.6, 0, Math.PI * 2); ctx.fill(); }
        orr.push({ i: b.i, x, y: yA, r });
      }
      s._orr = orr;
      // 이름표: 위아래 줄에 겹치지 않게 (중요한 행성부터)
      const hzRock = (b) => b.hz && b.m < 10 && b.w <= 0.08;
      // 순서: 생명 가능 지대의 행성급 암석 행성 → 거대 행성 → 나머지 (무거운 순)
      const score = (b) => (hzRock(b) && b.m >= 0.3 ? 1e4 : 0) + (b.m >= 10 ? 5e3 : 0) + b.m;
      const order = planets.filter((b) => b.m >= 0.2 || hzRock(b)).sort((a, b) => score(b) - score(a)).slice(0, W < 600 ? 5 : 10);
      const tags = []; // 이미 놓은 이름표 (실제 자리로 겹침을 봄: 큰 행성은 이름표를 더 띄우므로 줄 번호만으로는 모자람)
      ctx.font = '600 12px ' + F_BODY;
      for (const b of order) {
        const head = (b.letter ? b.letter + ' · ' : '') + KIND[b.kind].label;
        let sub = `지구의 ${fmtM(b.m)}배`;
        if (b.kind !== 'gas' && b.kind !== 'ice' && b.w >= 5e-5 && b.w <= 0.08) sub += ' · 물 ' + (b.w * 100).toPrecision(2) + '%';
        else if (b.w > 0.08) sub += ' · 얼음/물 많음';
        ctx.font = '600 12px ' + F_BODY;
        const w = Math.max(ctx.measureText(head).width, (ctx.font = '11.5px ' + F_BODY, ctx.measureText(sub).width)) + 6;
        const x0 = WS.clamp(b.x - w / 2, 4, W - w - 4);
        let done = false;
        for (let k = 0; k < 3 && !done; k++) for (const side of ['up', 'dn']) {
          const base = side === 'up' ? yA - 34 - k * 36 : yA + 30 + k * 36;
          const lift = side === 'up' ? Math.min(0, -(b.r - 8)) : Math.max(0, b.r - 8);
          const ty = base + lift, tr = [x0, ty - 13, w, 34], trp = [x0 - 6, ty - 15, w + 12, 36];
          if (ty - 13 < 36 || ty + 21 > yB - 22 || blocked.some((p) => hits(p, tr)) || tags.some((p) => hits(p, trp))) continue;
          // 지시선이 다른 이름표를 가로지르지 않게
          const ly0 = side === 'up' ? ty + 21 : yA + b.r + 2, ly1 = side === 'up' ? yA - b.r - 2 : ty - 13;
          if (tags.some((p) => b.x > p[0] && b.x < p[0] + p[2] && p[1] < ly1 && p[1] + p[3] > ly0)) continue;
          tags.push(tr);
          ctx.strokeStyle = 'rgba(241,203,134,.35)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(b.x, side === 'up' ? yA - b.r - 2 : yA + b.r + 2); ctx.lineTo(b.x, side === 'up' ? ty + 20 : ty - 12); ctx.stroke();
          txt(ctx, head, x0 + 3, ty, { weight: 600, color: b.hz && b.m < 10 ? C_LEAF : C_BRASS });
          txt(ctx, sub, x0 + 3, ty + 15, { size: 11.5 });
          done = true;
          break;
        }
      }
    }
    capDraw(ctx, cap);
  }

  function era(s) {
    if (s.ended && s.endTitle) return { name: s.endTitle, sub: s.endText || '' };
    if (s.phase === 'cloud') {
      if (!s.sinks.length) return s.reached.collapse ? { name: '중력 붕괴', sub: '구름 중심이 무너지며 뜨거워집니다' } : { name: '분자운', sub: '차갑고 어두운 가스 구름. 스스로 무너질지는 아직 모릅니다' }; // 이정표는 한 번 찍히면 그대로라 시기가 뒤로 가지 않음
      return { name: '원시별의 탄생', sub: `원시별 ${s.sinks.length}개가 주변 가스를 삼키고 있습니다` };
    }
    if (s.phase === 'zoom') return { name: '원시별 확대', sub: '가장 무거운 원시별로 다가갑니다' };
    if (s.gasLeft > 0) return { name: '원시행성 원반', sub: '먼지가 뭉친 배아들이 부딪히며 자랍니다' };
    if (s.nB > 25) return { name: '거대 충돌의 시대', sub: '남은 원시 행성들이 부딪혀 합쳐지거나 스치고 지나가며 궤도를 정리합니다' };
    return { name: '자리 잡은 항성계', sub: '행성들의 궤도가 안정되어 갑니다' };
  }

  function narrate(s) {
    if (s.ended && s.endText) return s.endText; // 관측이 끝나면 결말 요약
    if (s.phase === 'cloud') {
      if (s.ended) return '구름이 자기 중력을 이기지 못하고 흩어졌습니다. 이번에는 별이 태어나지 않았습니다.';
      if (!s.sinks.length) return s.reached.collapse ? '구름 중심이 자기 중력으로 무너지고 있습니다. 밝게 빛나는 곳일수록 가스가 빽빽합니다.' : '차가운 가스 구름이 천천히 소용돌이칩니다. 스스로의 중력으로 무너질지는 아직 모릅니다.';
      return s.sinks.length > 1 ? `원시별 ${s.sinks.length}개가 주변 가스를 삼키며 자라고 있습니다.` : '원시별이 주변 가스를 삼키며 자라고 있습니다.';
    }
    if (s.phase === 'zoom') return `가장 무거운 원시별(태양 질량의 ${sig2(s.Mstar)}배)로 다가갑니다.${s.binary ? ' 바로 곁에 동반성이 붙어 있는 쌍성입니다.' : ''}`;
    if (s.blewUp) return `중심별이 ${WS.fmtYears(s.life)} 만에 연료를 다 쓰고 초신성으로 폭발했습니다. 행성들도 함께 사라졌습니다.`;
    const ps = s.plist || [];
    if (s.gasLeft > 0) return `원반에 가스가 아직 ${s.gasLeft > 0.66 ? '많이' : s.gasLeft > 0.33 ? '꽤' : '조금'} 남았습니다. 그 안에서 천체들이 부딪히며 자라고 있습니다.`;
    // 생명 가능 지대 문장은 조사 때 정해 둔 값(noteHz)만 읽음: 결말 카드와 같은 판정이고, 경계를 오가는 행성 때문에 뒤집히지 않음
    let b;
    if (s.Mstar < 0.08) b = '중심 천체가 별이 되기엔 너무 가벼워, 행성을 오래 데워 줄 빛이 없습니다.';
    else if (s.hzKey === null) b = '어떤 행성이 생명 가능 지대에 남을지는 아직 정해지지 않았습니다.';
    else if (s.hzWobble) b = '생명 가능 지대의 경계를 넘나든 행성이 있어, 끝까지 어떤 행성이 남을지는 아직 모릅니다.';
    else if (s.hzId === null) b = '지금은 생명 가능 지대에 알맞은 암석 행성이 없습니다.';
    else {
      const p = ps.find((q) => q.id === s.hzId);
      b = `지금은 생명 가능 지대에 암석 행성${p && p.letter ? `(${p.letter})` : ''}이 있고, ${s.hzWet ? '물도 있습니다.' : '물은 거의 없습니다.'}`;
    }
    return `가스가 사라지고 남은 행성들이 궤도를 정리하는 중입니다. ${b}`;
  }

  function legend(s, view) {
    if (s.phase !== 'disk') return [{ gradient: CLOUD_STOPS.map((c) => WS.rgb(c)), from: '옅은 가스', to: '빽빽한 가스' }, { color: WS.rgb(starColor(1)), label: '원시별' }];
    if (s.blewUp) return [{ color: '#ffb59a', label: '초신성 잔해 (폭발한 중심별)' }, { color: 'rgba(150,207,136,.7)', label: '생명 가능 지대였던 곳' }, { color: C_CYAN, label: '눈선' }];
    const out = [{ color: WS.rgb(starColor(s.Mstar)), label: s.Mstar < 0.08 ? '갈색 왜성' : '중심별' }];
    if (s.comp) out.push({ color: WS.rgb(starColor(s.binary.m)), label: '동반성' });
    out.push(
      { color: WS.rgb(KIND.gas.col), label: '가스 거인' },
      { color: WS.rgb(KIND.ice.col), label: '얼음 거인 · 얼음 천체' },
      { color: WS.rgb(KIND.rock.col), label: '암석 행성' },
      { color: WS.rgb(KIND.earth.col), label: '물 있는 행성' },
      { color: 'rgba(150,207,136,.7)', label: '생명 가능 지대 (액체 물이 가능)' },
      { color: C_CYAN, label: '눈선: 바깥은 얼음이 생김' },
    );
    if (view === 1) out.push({ color: 'rgba(235,228,211,.5)', label: '막대: 궤도의 가장 가까운~먼 거리' });
    else if (s.gasLeft > 0) out.push({ color: 'rgba(255,200,140,.7)', label: '가스와 먼지 원반' });
    return out;
  }

  function stats(s) {
    if (s.phase !== 'disk') {
      const st = s.sinks.slice().sort((a, b) => b.m - a.m);
      return [
        ['구름 무게', '태양의 ' + sig2(s.Mc) + '배'],
        ['중력과 압력', gravWord(s.J)],
        ['가장 빽빽한 곳', '평균의 ' + sig2(s.peak) + '배'],
        ['원시별', s.sinks.length + '개'],
        ['가장 큰 원시별', st.length ? '태양의 ' + sig2(st[0].m * s.Mc * 0.6) + '배' : '아직 없음'],
        ['행성 재료(먼지)', '태양의 ' + sig2(s.Z) + '배'],
      ];
    }
    const ps = s.plist || [];
    const hzN = s.hzRocky(ps).length;
    return [
      ['중심별 무게', '태양의 ' + sig2(s.Mstar) + '배' + (s.binary ? ' (쌍성)' : ''), s.Mstar < 0.08 ? 'warn' : ''],
      ['중심별 밝기', '태양의 ' + sig2(s.L) + '배'],
      ['남은 가스', (s.gasLeft * 100).toFixed(0) + '%'],
      ['남은 천체', s.nB + '개'],
      ['그중 행성', ps.filter((p) => p.m >= 0.1).length + '개'],
      ['가장 큰 행성', s.nB ? '지구의 ' + fmtM(maxMass(s)) + '배' : '없음'],
      ['생명 가능 지대', hzN ? '알맞은 행성 ' + hzN + '개' : '알맞은 행성 없음', hzN ? 'good' : ''],
      s.Mstar < 0.08 ? ['별의 수명', '핵융합 못 함', 'warn'] : ['별의 수명', WS.fmtYears(s.life), s.life < 2e9 ? 'warn' : ''],
    ];
  }

  const mult = (v) => '×' + WS.trimNum(v);
  WS.registerMode({
    id: 'stellar',
    name: '항성계',
    when: '46억 년 전',
    question: '태양계 같은 항성계는 또 생길까?',
    desc: '차가운 분자운에서 시작합니다. 구름이 무너져 별이 되는지, 여러 별로 쪼개지는지, 원반 속 배아들이 부딪혀 어떤 행성들이 남는지 지켜봅니다. 생명 가능 지대에 암석 행성이 남으면 그 행성으로 내려가 생명을 지켜볼 수 있습니다.',
    setup: [{ id: 'cloud', label: '분자운', value: 'solar', options: [['solar', '태양을 낳은 구름과 비슷하게'], ['random', '무작위 구름']] }],
    views: ['원반', '행성 배치도'],
    baseRate: 40,
    sampleEvery: 6,
    powerRegenSec: 6,
    create: (opts, seed, inherit) => new Stellar(opts, seed, inherit),
    step,
    render,
    era,
    stats,
    narrate,
    legend,
    pick(s, x, y, W, H) {
      if (s.phase === 'disk') return { sx: x, sy: y, V: diskView(s, W, H), view: s._view || 0, x: 0.5, y: 0.5 };
      const { S, x0, y0 } = cloudView(W, H);
      const u = (x - x0) / S, v = (y - y0) / S;
      if (u < 0 || v < 0 || u > 1 || v > 1) return null;
      return { x: u, y: v };
    },
    inspect(s, w) {
      if (s.phase !== 'disk' || s.blewUp || !w.V) return null;
      let best = -1, bd = 14;
      if (w.view === 1) {
        for (const o of s._orr || []) { const d = Math.hypot(o.x - w.sx, o.y - w.sy) - o.r; if (d < bd && o.i < s.nB) { bd = d; best = o.i; } }
      } else {
        const { cx, cy, map } = w.V;
        for (let i = 0; i < s.nB; i++) {
          const r = Math.hypot(s.bx[i], s.by[i]), th = Math.atan2(s.by[i], s.bx[i]), rp = map(r);
          const d = Math.hypot(cx + Math.cos(th) * rp - w.sx, cy + Math.sin(th) * rp - w.sy);
          if (d < bd) { bd = d; best = i; }
        }
      }
      if (best < 0) return null;
      const o = s.orbit(best), a = isFinite(o.a) ? o.a : o.r;
      const letter = s.pLetter.get(s.bid[best]);
      const kind = kindOf(s.bm[best], s.bw[best], a >= s.hzIn && a <= s.hzOut);
      const zone = a < s.hzIn ? '너무 뜨거운 안쪽' : a <= s.hzOut ? '생명 가능 지대' : a < s.frost ? '조금 차가운 곳' : '눈선 바깥 (얼음 영역)';
      return [letter ? `${s.sysName} ${letter} · ${KIND[kind].label}` : s.bm[best] < 0.08 ? '행성 배아 (아직 작음)' : KIND[kind].label, `질량: 지구의 ${fmtM(s.bm[best])}배`, `거리: ${fmtAU(a * s.D)} · ${zone}`, `궤도 찌그러짐(이심률) ${o.e.toFixed(2)}`, `물: 질량의 ${(s.bw[best] * 100).toPrecision(2)}%`, s.bmoon[best] ? `위성 ${s.bmoon[best]}개` : '위성 없음'];
    },
    sample: (s) => ({ n: s.phase === 'disk' ? s.nB : s.sinks.length, gas: s.phase === 'disk' ? s.gasLeft * 100 : 100, big: s.phase === 'disk' && s.nB ? maxMass(s) : 0, peak: s.phase === 'disk' ? undefined : s.peak }),
    chart: [
      { key: 'n', label: '천체 수', color: '#84c6d2', fmt: (v) => String(v) },
      { key: 'big', label: '가장 큰 천체', color: '#f1cb86', log: true, min: 0.1, fmt: (v) => '지구 ' + fmtM(v) + '배' },
      { key: 'gas', label: '남은 가스', color: '#e46a4e', fmt: (v) => v.toFixed(0) + '%' },
    ],
    interventions: [
      {
        id: 'wave', name: '초신성 충격파', icon: 'wave', cost: 3, target: 'point',
        desc: '근처 별의 폭발 충격파가 구름을 한쪽에서 밀어붙입니다. 태양계도 이렇게 태어났다는 가설이 있습니다.',
        available: (s) => s.phase === 'cloud',
        apply(s, w) {
          for (let n = 0; n < s.N; n++) {
            if (!s.alive[n]) continue;
            const dx = s.px[n] - w.x, dy = s.py[n] - w.y, d = Math.hypot(dx, dy) + 0.02;
            const k = 1.6 * Math.exp(-d / 0.3);
            s.vx[n] += (dx / d) * k; s.vy[n] += (dy / d) * k;
          }
          s.tLimit = s.tc + 0.6;
          s.addFx({ type: 'ring', x: w.x, y: w.y, r: 0.6, r0: 4, life: 1.6, color: [255, 200, 150] });
          s.addFx({ type: 'flash', x: w.x, y: w.y, r: 0.08, life: 1, color: [255, 240, 220] });
          return '근처에서 별이 폭발해 충격파가 구름을 덮쳤습니다';
        },
      },
      {
        id: 'star', name: '스쳐 가는 별', icon: 'star', cost: 3, target: 'global',
        desc: '다른 별이 가까이 스쳐 지나갑니다. 구름을 휘젓거나 바깥 천체들의 궤도를 흔듭니다.',
        available: (s) => s.phase === 'cloud' || s.phase === 'disk',
        apply(s) {
          if (s.phase === 'cloud') {
            for (let n = 0; n < s.N; n++) { const dx = s.px[n] - 0.5, dy = s.py[n] - 0.5; s.vx[n] += -dy * 1.2 + dx * 0.4; s.vy[n] += dx * 1.2 + dy * 0.4; }
            return '지나가는 별이 구름을 비틀었습니다';
          }
          let c = 0;
          for (let i = 0; i < s.nB; i++) {
            const r = Math.hypot(s.bx[i], s.by[i]);
            if (r < 3) continue;
            const k = (0.12 * Math.PI * 2) / Math.sqrt(r) * Math.min(1, r / 10);
            s.bvx[i] += s.rng.normal() * k; s.bvy[i] += s.rng.normal() * k; c++;
          }
          return `지나가는 별의 중력이 바깥 천체 ${c}개의 궤도를 흔들었습니다`;
        },
      },
      {
        id: 'comet', name: '혜성 소나기', icon: 'comet', cost: 2, target: 'global',
        desc: '바깥쪽 얼음 천체들을 안쪽으로 떨어뜨립니다. 안쪽 행성에 물을 실어다 줄 수 있습니다.',
        available: (s) => s.phase === 'disk',
        apply(s) {
          let c = 0;
          for (let k = 0; k < 14; k++) {
            const a = s.rng.range(8, 14), th = s.rng.next() * Math.PI * 2;
            const i = s.addBody(a, th, s.rng.range(0.01, 0.06), s.rng.range(0.3, 0.5), 0);
            if (i < 0) break;
            const peri = s.rng.range(0.6, 2.2);
            const vap = Math.sqrt((TAU2 * 2 * peri) / (a * (a + peri)));
            s.bvx[i] = -Math.sin(th) * vap; s.bvy[i] = Math.cos(th) * vap;
            c++;
          }
          s.massiveDirty = true;
          return c ? `얼음 천체 ${c}개가 안쪽으로 쏟아집니다` : false;
        },
      },
      {
        id: 'wind', name: '항성풍 폭발', icon: 'sun', cost: 2, target: 'global',
        desc: '젊은 별이 강한 바람을 뿜어 원반의 가스를 일찍 날려 버립니다. 가스 거인이 자랄 시간이 줄어듭니다.',
        available: (s) => s.phase === 'disk' && s.gasLeft > 0.05,
        apply(s) { s.tGas = Math.min(s.tGas, s.tt + 6); return '별의 폭풍이 원반 가스를 몰아냅니다'; },
      },
      {
        id: 'butterfly', name: '나비의 날갯짓', icon: 'butterfly', cost: 1, target: 'global', labOnly: true,
        desc: '상상할 수 있는 가장 작은 변화입니다. 가스 입자나 행성 배아 하나를 1천만분의 1만큼 옮깁니다. 구름 단계에서는 이 차이가 구름의 큰 움직임에 묻히고, 옮긴 입자가 원시별에 삼켜지면 그대로 사라지기도 합니다. 원반 단계(약 10만 년 뒤부터)에 하면 원시 행성들이 서로 끌어당기고 부딪히는 동안 차이가 점점 커집니다. 맞는 각도가 조금만 달라도 둘이 합쳐질지, 비스듬히 스치고 지나갈지가 바뀌기 때문입니다. 그래서 작은 행성들의 수·크기·자리는 대개 달라지고, 가끔은 생명 가능 지대에 알맞은 행성이 남는지까지 바뀝니다. 다만 그때 이미 자란 거대 행성과 중심별은 거의 그대로입니다.',
        available: (s) => s.phase !== 'disk' || s.nB > 0,
        apply(s) {
          if (s.phase === 'cloud') {
            let n = Math.floor(s.rng.next() * s.N), c = 0;
            while (!s.alive[n] && c++ < s.N) n = (n + 1) % s.N;
            s.px[n] += 1e-7;
            return '가스 입자 하나를 1천만분의 1만큼 옮겼습니다';
          }
          if (s.phase === 'zoom') { s.Mstar *= 1 + 1e-7; return '새로 태어난 별의 질량을 1천만분의 1만큼 바꿨습니다'; }
          const i = Math.floor(s.rng.next() * s.nB);
          s.bx[i] += 1e-7;
          return '원반 속 천체 하나를 1천만분의 1만큼 옮겼습니다';
        },
      },
    ],
    extra: {
      label: '행성 목록',
      render(s, el) {
        const ps = (s.plist || []).filter((p) => p.m >= 0.1);
        if (s.phase !== 'disk' || !ps.length) { el.innerHTML = '<p class="note">원반 단계에서 행성급 천체가 생기면 여기에 나타납니다.</p>'; return; }
        if (s.blewUp) { el.innerHTML = '<p class="note">중심별이 초신성으로 폭발해 행성들이 사라졌습니다.</p>'; return; }
        const named = ps.some((p) => p.letter);
        el.innerHTML = (named ? '<p class="note" style="margin:4px 0 8px">별에서 가까운 순서입니다. 이름의 글자는 처음 확인한 순서로 붙이고 바꾸지 않으므로, 합쳐져 사라진 행성의 글자는 비어 있을 수 있습니다.</p>' : '<p class="note" style="margin:4px 0 8px">행성들의 궤도가 자리 잡으면 이름이 붙습니다.</p>') + '<div class="extra-list">' + ps.map((p) => {
          const col = p.zone === HZ && p.m < 10 && p.w <= 0.08 ? '#96cf88' : WS.rgb(KIND[p.kind].col);
          const water = p.w < 5e-5 ? '물 거의 없음' : p.w > 0.08 ? '얼음·물이 많음' : '물 ' + (p.w * 100).toPrecision(2) + '%';
          return `<div class="sp"><span class="sw" style="background:${col}"></span><div><div class="nm">${p.letter ? p.name + ' · ' : ''}${p.type}</div><div class="tr">${fmtAU(p.aAU)} · ${p.zone} · ${water}${p.moons ? ' · 위성 ' + p.moons : ''}</div></div><div class="bm">지구의 ${fmtM(p.m)}배</div></div>`;
        }).join('') + '</div>';
      },
    },
    milestones: [
      { id: 'collapse', name: '분자운 붕괴 시작', real: 1e4, realLabel: '46억 년 전' },
      { id: 'protostar', name: '원시별 탄생', real: 1e5, realLabel: '약 10만 년' },
      { id: 'disk', name: '원시행성 원반', real: 2e5, realLabel: '약 20만 년' },
      { id: 'giant', name: '가스 거인 탄생 (목성)', real: 3e6, realLabel: '약 300만 년' },
      { id: 'gasgone', name: '원반 가스 소멸', real: 7e6, realLabel: '약 500만~1000만 년' },
      { id: 'ignite', name: '수소 핵융합 점화', real: 4e7, realLabel: '약 4천만 년' },
      { id: 'moon', name: '거대 충돌로 큰 위성 탄생 (달)', real: 7e7, realLabel: '약 5천만~1억 년' },
      { id: 'hzplanet', name: '생명 가능 지대의 암석 행성', real: 1e8, realLabel: '약 1억 년' },
      { id: 'water', name: '물을 가진 지구형 행성', real: 1.1e8, realLabel: '약 1억 년' },
    ],
    realName: '태양계',
    compare: { min: 1e3, max: 1e9, tf: (v) => Math.log10(Math.max(1e3, v)), ticks: [[1e4, '1만'], [1e5, '10만'], [1e6, '100만'], [1e7, '1천만'], [1e8, '1억 년']] },
    batch: {
      maxSteps: 18000,
      key: ['protostar', 'giant', 'ignite', 'moon', 'water'],
      fmt: WS.fmtYears,
      finish: (s) => { if (s.phase === 'disk') s.finish(); else s.end('미완', '시간 안에 끝나지 않았습니다.', '관측 시간 종료'); },
      desc: '같은 조건의 분자운을 씨앗만 바꿔 여러 번 무너뜨립니다. 태양계처럼 목성, 달, 물 있는 지구가 함께 생기는 경우가 얼마나 되는지 셉니다. (실험용은 천체 수를 줄여 계산합니다)',
    },
    experiment: {
      clock: (s) => s.timeValue(),
      axis: 'log',
      span: (opts) => { const u = Number(opts && opts.until); return [1e4, u > 0 && isFinite(u) ? u : 3.84e8]; },
      horizonOptions: () => [
        { value: 1e6, label: '100만 년 (원반 시기)' },
        { value: 1e7, label: '1000만 년 (가스가 사라질 무렵)' },
        { value: 1e8, label: '1억 년' },
        { value: 2.3e8, label: '2.3억 년 (행성이 자리 잡음)', def: true },
      ],
      setHorizon: (opts, x1) => { opts.until = x1; },
      xfmt: (x) => (isFinite(x) ? WS.fmtYears(x) : '—'),
      maxSteps: 18000,
      metrics: [
        { key: 'bodies', label: '원반 속 천체 수', get: diskMetric((s) => Math.max(0.5, s.nB), 0.5), log: true, scale: 0.15, fmt: (v) => (v < 1 ? '0개' : Math.round(v) + '개'), color: '#84c6d2' },
        { key: 'maxm', label: '가장 큰 행성 (지구=1)', get: diskMetric((s) => Math.max(0.01, maxMass(s)), 0.01), log: true, scale: 0.2, fmt: (v) => (v <= 0.01 ? '없음' : fmtM(v) + '배'), color: '#f1cb86' },
        { key: 'gas', label: '원반에 남은 가스', get: (s) => (s.phase === 'disk' ? (s.blewUp ? 0 : s.gasLeft * 100) : s.ended ? 0 : 100), log: false, scale: 10, fmt: (v) => Math.round(v) + '%', color: '#e46a4e' },
        { key: 'hz', label: '생명 가능 지대의 암석 행성', get: diskMetric((s) => hzCount(s, false), 0), log: false, scale: 0.5, fmt: (v) => WS.trimNum(v) + '개', color: '#96cf88' },
        { key: 'wet', label: '그중 물이 있는 행성', get: diskMetric((s) => hzCount(s, true), 0), log: false, scale: 0.5, fmt: (v) => WS.trimNum(v) + '개', color: '#4a86d8' },
      ],
      outcomes: [
        { key: 'nostar', label: OUT.nostar, color: '#5d6678', desc: '구름이 흩어졌거나, 중심 천체가 너무 가벼워 핵융합을 못 하는 갈색 왜성이 되었습니다.' },
        { key: 'supernova', label: OUT.supernova, color: '#e46a4e', desc: '중심별이 너무 무거워 짧은 일생을 마치고 초신성으로 폭발했습니다. 행성도 함께 사라졌습니다.' },
        { key: 'binary', label: OUT.binary, color: '#b48ad0', desc: '가까운 동반성이 원반을 흔들어 생명 가능 지대에 알맞은 행성이 자리 잡지 못했습니다.' },
        { key: 'empty', label: OUT.empty, color: '#6a7283', desc: '원반의 재료가 모자라 행성급 천체가 하나도 자라지 못했습니다.' },
        { key: 'rocky', label: OUT.rocky, color: '#aa8264', desc: '거대 행성이 없고, 생명 가능 지대에 알맞은 크기의 행성도 없습니다 (아직 자라는 중인 원반 포함).' },
        { key: 'giants', label: OUT.giants, color: '#e2b278', desc: '가스·얼음 거인은 생겼지만 생명 가능 지대에 알맞은 크기의 암석 행성은 없습니다.' },
        { key: 'dry', label: OUT.dry, color: '#d8c27a', desc: '생명 가능 지대에 지구만 한 암석 행성이 있지만 물이 거의 없습니다.' },
        { key: 'wet', label: OUT.wet, color: '#84c6d2', desc: '생명 가능 지대의 암석 행성에 바깥에서 날아온 물이 있습니다.' },
        { key: 'earthmoon', label: OUT.earthmoon, color: '#96cf88', desc: '물 있는 지구형 행성이 거대 충돌로 큰 위성까지 얻었습니다. 지구와 달을 닮은 쌍입니다.' },
      ],
      classify,
      conditions: [
        { key: 'mass', label: '분자운의 질량', desc: '무거우면 중력이 압력을 더 이겨 잘 무너지고, 더 크고 수명이 짧은 별이 생깁니다. 가벼우면 갈색 왜성이 될 수 있습니다.', min: 0.25, max: 4, step: 0.05, def: 1, fmt: mult, kind: 'mult' },
        { key: 'metal', label: '행성 재료(먼지)의 양', desc: '행성을 만드는 고체 재료입니다. 적으면 행성이 작게 자랍니다.', min: 0.1, max: 3, step: 0.05, def: 1, fmt: mult, kind: 'mult' },
        { key: 'spin', label: '구름의 회전', desc: '빠르게 돌면 원반이 커져 거대 행성이 잘 자라고, 원시별 둘레의 원반이 둘로 쪼개져 가까운 쌍성이 되기 쉽습니다. 너무 빠르면 원심력 때문에 구름이 잘 무너지지 않습니다.', min: 0.2, max: 4, step: 0.05, def: 1, fmt: mult, kind: 'mult' },
        { key: 'turb', label: '구름 속 소용돌이(난류)', desc: '가스를 휘저어 구름 속에 빽빽한 덩어리를 만듭니다. 없으면 구름이 한 덩어리로 고르게 무너지고, 강하면 덩어리가 많아져 멀리 떨어진 동반성이 생기기 쉽습니다.', min: 0, max: 4, step: 0.05, def: 1, fmt: mult, kind: 'mult' },
        { key: 'disk', label: '원반의 질량', desc: '원반이 무거우면 거대 행성이 잘 자라고, 가벼우면 작은 행성만 남습니다.', min: 0.25, max: 4, step: 0.05, def: 1, fmt: mult, kind: 'mult' },
      ],
      presets: [
        { label: '무거운 분자운', desc: '구름이 3배 무겁습니다. 더 큰 별과 짧은 수명.', cond: { mass: 3 } },
        { label: '가벼운 분자운', desc: '구름이 30% 무게입니다. 작고 어두운 붉은 왜성이 생기고 행성 재료도 줄어듭니다.', cond: { mass: 0.3 } },
        { label: '먼지가 적은 구름', desc: '행성 재료(먼지)가 20%. 초기 우주의 구름처럼 재료가 부족합니다.', cond: { metal: 0.2 } },
        { label: '빠르게 도는 구름', desc: '회전 3배, 소용돌이 2배. 원반이 커져 거대 행성이 잘 자라고, 가까운 쌍성이 생기기도 합니다.', cond: { spin: 3, turb: 2 } },
        { label: '무거운 원반', desc: '원반 질량 2.5배. 거대 행성이 자라기 좋습니다.', cond: { disk: 2.5 } },
      ],
      schedulable: ['wave', 'star', 'comet', 'wind', 'butterfly'],
      targets: [{ key: 'center', label: '중심' }, { key: 'random', label: '무작위' }],
      target(s, key, rng) {
        if (s.phase !== 'cloud' || key === 'center') return { x: 0.5, y: 0.5 };
        const th = rng.next() * Math.PI * 2, r = 0.05 + 0.3 * rng.next();
        return { x: 0.5 + r * Math.cos(th), y: 0.5 + r * Math.sin(th) };
      },
      similarity(a, b) {
        if (a.phase === 'disk' && b.phase === 'disk') {
          if (a.blewUp || b.blewUp) return a.blewUp && b.blewUp ? 1 : 0;
          return overlap(radial(a), radial(b));
        }
        if (a.phase === 'cloud' && b.phase === 'cloud') return overlap(a.rho, b.rho);
        if (a.phase === 'zoom' && b.phase === 'zoom') return Math.min(a.Mstar, b.Mstar) / Math.max(a.Mstar, b.Mstar);
        return 0;
      },
      eventIds: ['giant', 'gasgone', 'moon', 'hzplanet', 'water'],
    },
    next(s) {
      if (!s.ended || !s.best || s.blewUp || s.Mstar < 0.08) return null; // 갈색 왜성 둘레에는 생명을 데울 별빛이 없음
      const p = s.best; // 결말 문구가 말한 생명 가능 지대 안의 행성 (finish)
      const small = p.m < 0.4, big = p.m > 5, dry = p.w < 5e-5;
      return {
        label: small || big ? `${small ? '작은' : '큰'} 행성 ${p.name}에서 생명 시험해 보기` : dry ? `메마른 행성 ${p.name}에서 생명 시험해 보기` : `${p.name}에서 생명 관측`,
        mode: 'life',
        opts: { planet: 'inherit', abio: 'unknown' },
        inherit: {
          name: p.name, mass: p.m, water: p.w, hzPos: (p.a - s.hzIn) / (s.hzOut - s.hzIn), starMass: s.Mstar, starLife: s.life,
          moon: p.moons > 0, giant: (s.plist || []).some((q) => q.m >= 50 && q.a > p.a), ecc: p.e,
          system: { star: { mass: s.Mstar }, home: p.name, planets: (s.plist || []).map((q) => ({ name: q.name, a: q.a, au: q.aAU, m: q.m, w: q.w, e: q.e, moons: q.moons })) },
        },
      };
    },
  });
})();
