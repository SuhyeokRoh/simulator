'use strict';
/* 우주 탄생 모드: 거짓 진공 → 급팽창 → 핵합성 → 재결합 → 입자-격자 중력으로 구조 형성 */
(function () {
  const WS = window.WS;
  const Math = window.Math; // 지역 바인딩: 워커·Node vm에서 전역 조회가 느려 뜨거운 고리가 몇 배 빨라짐
  const YR = 3.156e7;
  const H0 = 0.0716; // 1/십억 년 (70 km/s/Mpc)
  const OL0 = 0.69;
  const T_NOW = 1.38e10, T_END = 1e11; // 오늘의 우주 나이, 관측 기본 끝 (년)
  /* 어느 가스가 언제 별이 되는지는 계산 격자보다 훨씬 작은 규모의 난류가 정합니다. 모형이 풀지 못하는 그 몫을,
     주 난수에 입자의 정확한 자리를 크게 확대한 값을 더해 대신합니다 (고른 난수에 무엇을 더해도 고른 난수이므로 확률은 그대로).
     그래서 입자 자리가 아주 조금만 달라도 곧 어떤 별이 태어나는지가 갈리고, 물질의 큰 구조와 별의 전체 양은 거의 그대로입니다.
     (실제 우주 시뮬레이션의 나비 효과도 이런 모습입니다: Genel 외 2019) */
  const SUBGRID = 1e10;
  // 실험실 조건: 프리셋 값에 곱하는 배수. 모두 기본값이면 프리셋과 똑같이 움직임.
  const cond = (s, k, d) => { const v = s.opts && s.opts.cond ? s.opts.cond[k] : undefined; return typeof v === 'number' && isFinite(v) ? v : d; };

  function constantsFor(kind, r) {
    if (kind === 'ours') return { G: 1, lam: 1, om: 0.31, Q: 1, strong: 1, alpha: 1, vac: 3 };
    if (kind === 'near') return { G: r.logRange(0.7, 1.4), lam: r.logRange(0.3, 3), om: 0.31 * r.logRange(0.6, 1.7), Q: r.logRange(0.5, 2), strong: r.range(0.93, 1.07), alpha: r.range(0.85, 1.15), vac: r.logRange(0.5, 3) };
    return {
      G: r.logRange(0.25, 4.5),
      lam: r.chance(0.15) ? -r.range(0.2, 4) : r.logRange(0.05, 120),
      om: 0.31 * r.logRange(0.15, 8),
      Q: r.logRange(0.08, 40),
      strong: r.range(0.72, 1.28),
      alpha: r.logRange(0.4, 2.6),
      vac: r.logRange(0.03, 4),
    };
  }

  /* 중력 커널 (격자 크기별로 한 번만 계산): 가우스 완화 1/k² 와 파수 */
  const GREEN = {};
  function green(NG) {
    if (GREEN[NG]) return GREEN[NG];
    const n2 = NG * NG, f = new Float64Array(n2), KX = new Float64Array(n2), KY = new Float64Array(n2);
    const rs = 0.9 / NG, rs2 = rs * rs;
    for (let y = 0; y < NG; y++) {
      const ky = 2 * Math.PI * (y <= NG / 2 ? y : y - NG);
      for (let x = 0; x < NG; x++) {
        const kx = 2 * Math.PI * (x <= NG / 2 ? x : x - NG);
        const k2 = kx * kx + ky * ky, i = y * NG + x;
        KX[i] = kx; KY[i] = ky;
        f[i] = k2 === 0 ? 0 : Math.exp(-k2 * rs2) / k2;
      }
    }
    return (GREEN[NG] = { f, KX, KY });
  }

  class Universe extends WS.SimBase {
    constructor(opts, seed) {
      opts = opts || {};
      super(seed, opts);
      this.lite = !!this.opts.lite;
      const k = (this.k = constantsFor(opts.preset || 'ours', this.rng));
      k.G *= cond(this, 'G', 1); k.lam *= cond(this, 'lam', 1); k.om *= cond(this, 'om', 1); k.Q *= cond(this, 'Q', 1);
      k.strong *= cond(this, 'strong', 1); k.alpha *= cond(this, 'alpha', 1); k.vac *= cond(this, 'vac', 1);
      this.fGas = WS.clamp(0.25 * cond(this, 'baryon', 1), 0.02, 0.9); // 보통 물질(가스) 비율
      const u = Number(opts.until);
      this.until = u > 0 && isFinite(u) ? u : T_END;
      this.phase = 'vacuum';
      this.pstep = 0;
      this.boost = 0;
      this.fluct = 0;
      this.t = 0; // 빅뱅 후 경과 (년)
      this.NG = this.lite ? 64 : 128;
      this.side = this.lite ? 32 : 64;
      this.N = this.side * this.side;
      this.CG = this.lite ? 16 : 32; // 은하 판정 격자 (칸당 평균 가스 입자 1개가 되게)
      this.starUnit = 1e9 * 4096 / this.N; // 입자 하나가 대표하는 별의 수
      this.noise = new WS.Noise(seed);
      this.stars = 0; this.dark = 0; this.galaxies = 0; this.biggest = 0; this.cands = 0; this.sn = 0; this.zMean = 0;
      this.galList = [];
      this.a = 0; this.adot = 0; this.aMax = 0;
      this.bhs = [];
      this.xH = 0.75;
      // 결과를 좌우하는 파생 조건
      this.deutOK = k.strong >= 0.85;
      this.diproton = k.strong > 1.15;
      this.chemOK = k.alpha > 0.6 && k.alpha < 1.6 && k.strong >= 0.85 && k.strong <= 1.15;
      this.coolF = Math.exp(-Math.pow(Math.log(k.alpha), 2) / 0.6);
    }
    timeValue() { return this.phase === 'vacuum' ? NaN : this.t; }
    timeLabel() {
      if (this.phase === 'vacuum') return '시간 이전';
      if (this.t * YR < 3600 * 24 * 365) return '빅뱅 후 ' + WS.fmtSeconds(this.t * YR);
      return '빅뱅 후 ' + WS.fmtYears(this.t);
    }

    /* ----- 빅뱅 순간 ----- */
    bang() {
      this.phase = 'inflation';
      this.pstep = 0;
      this.t = 1e-36 / YR;
      this.reached.bang = { v: 1e-6, label: '0초' };
      this.log('거짓 진공이 무너지며 급팽창이 시작되었습니다. 빅뱅!', 'milestone');
      this.initField();
      // 핵합성 결과
      const k = this.k;
      if (this.diproton) this.xH = 0.75 * Math.exp(-(k.strong - 1.15) * 25);
      else if (!this.deutOK) this.xH = 0.999;
      else this.xH = 0.75 + (1 - k.strong) * 0.4;
      this.xH = WS.clamp(this.xH, 0.001, 0.999);
    }

    initField() {
      const NG = this.NG, n2 = NG * NG, r = this.rng;
      const re = new Float64Array(n2), im = new Float64Array(n2);
      const kcut = NG * 0.22;
      for (let y = 0; y < NG; y++) {
        const ky = y <= NG / 2 ? y : y - NG;
        for (let x = 0; x < NG; x++) {
          const kx = x <= NG / 2 ? x : x - NG;
          const kk = Math.sqrt(kx * kx + ky * ky);
          if (kk === 0) continue;
          const amp = Math.pow(kk, -0.75) * Math.exp(-(kk * kk) / (kcut * kcut));
          re[y * NG + x] = amp * r.normal();
          im[y * NG + x] = amp * r.normal();
        }
      }
      WS.fft2(re, im, NG, true);
      let s2 = 0;
      for (let i = 0; i < n2; i++) { im[i] = 0; s2 += re[i] * re[i]; }
      const rms = Math.sqrt(s2 / n2) || 1;
      const d0 = 0.11 * this.k.Q;
      for (let i = 0; i < n2; i++) re[i] *= d0 / rms;
      this.cmb = new Float32Array(n2);
      for (let i = 0; i < n2; i++) this.cmb[i] = re[i] / d0;
      WS.fft2(re, im, NG, false); // 에르미트 대칭 δ_k
      // 젤도비치 변위 ψ_k = i k δ_k / k²
      const fr = new Float64Array(n2), fi = new Float64Array(n2);
      for (let y = 0; y < NG; y++) {
        const ky = 2 * Math.PI * (y <= NG / 2 ? y : y - NG);
        for (let x = 0; x < NG; x++) {
          const kx = 2 * Math.PI * (x <= NG / 2 ? x : x - NG);
          const k2 = kx * kx + ky * ky, i = y * NG + x;
          if (k2 === 0) continue;
          const dr = re[i] / k2, di = im[i] / k2;
          const gxr = -kx * di, gxi = kx * dr, gyr = -ky * di, gyi = ky * dr;
          fr[i] = gxr - gyi;
          fi[i] = gxi + gyr;
        }
      }
      WS.fft2(fr, fi, NG, true);
      this.psiX = fr; this.psiY = fi;
      // 빅뱅 전에 예약된 나비의 날갯짓: 입자 하나의 초기 변위를 아주 조금 바꿈
      if (this.nudgeN !== undefined) { this.psiX[this.psiCell(this.nudgeN)] += 1e-7; this.nudgeN = undefined; }
    }
    psiCell(n) {
      const side = this.side, NG = this.NG, i = n % side, j = (n / side) | 0;
      return (Math.floor(((j + 0.5) / side) * NG) % NG) * NG + (Math.floor(((i + 0.5) / side) * NG) % NG);
    }

    /* ----- 입자 배치 (암흑 시대 시작) ----- */
    initParticles() {
      const N = this.N, side = this.side, NG = this.NG, r = this.rng;
      this.px = new Float64Array(N); this.py = new Float64Array(N); // 64비트: 아주 작은 차이(나비 효과)도 반올림에 지워지지 않게
      this.vx = new Float64Array(N); this.vy = new Float64Array(N);
      this.type = new Uint8Array(N); this.birth = new Float32Array(N); this.life = new Float32Array(N); this.Z = new Float32Array(N);
      this.a = 0.02;
      // 급팽창이 공간을 평평하게 만든다고 보고 곡률은 0: 우주 상수가 크면 일찍 가속 팽창(흩어짐), 음수면 결국 수축
      const om = this.k.om, ol = OL0 * this.k.lam;
      const H = H0 * Math.sqrt(Math.max(1e-9, om / Math.pow(this.a, 3) + ol));
      this.adot = this.a * H;
      for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
        const n = j * side + i;
        const qx = (i + 0.5) / side, qy = (j + 0.5) / side;
        const gx = Math.floor(qx * NG) % NG, gy = Math.floor(qy * NG) % NG;
        const sx = this.psiX[gy * NG + gx], sy = this.psiY[gy * NG + gx];
        this.px[n] = (qx + sx + 1) % 1;
        this.py[n] = (qy + sy + 1) % 1;
        this.vx[n] = H * sx;
        this.vy[n] = H * sy;
        this.type[n] = r.chance(this.fGas) ? 1 : 0; // 0 암흑 물질, 1 가스, 2 별, 3 잔해
      }
      const n2 = NG * NG;
      this.re = new Float64Array(n2); this.im = new Float64Array(n2);
      this.dens = new Float32Array(n2);
      this.gx = new Float64Array(N); this.gy = new Float64Array(N);
      this.MZ = this.lite ? 16 : 32;
      this.zgrid = new Float32Array(this.MZ * this.MZ);
      this.zgrid2 = new Float32Array(this.MZ * this.MZ);
      this.starGrid = new Uint16Array(this.CG * this.CG);
      this.t = 0.05e9;
      this.aMax = this.a;
      this.computeGravity();
    }

    computeGravity() {
      const NG = this.NG, n2 = NG * NG, N = this.N, re = this.re, im = this.im, px = this.px, py = this.py;
      re.fill(0); im.fill(0);
      const dep = (x, y, m) => {
        const fx = x * NG - 0.5, fy = y * NG - 0.5;
        const i0 = Math.floor(fx), j0 = Math.floor(fy);
        const ax = fx - i0, ay = fy - j0;
        const ii = i0 < 0 ? i0 + NG : i0, jj = j0 < 0 ? j0 + NG : j0;
        const i1 = i0 + 1 >= NG ? i0 + 1 - NG : i0 + 1, j1 = j0 + 1 >= NG ? j0 + 1 - NG : j0 + 1;
        re[jj * NG + ii] += m * (1 - ax) * (1 - ay);
        re[jj * NG + i1] += m * ax * (1 - ay);
        re[j1 * NG + ii] += m * (1 - ax) * ay;
        re[j1 * NG + i1] += m * ax * ay;
      };
      let mtot = N;
      for (let n = 0; n < N; n++) dep(px[n], py[n], 1);
      for (const b of this.bhs) { dep(b.x, b.y, b.m); mtot += b.m; }
      const mpp = n2 / mtot, dens = this.dens;
      for (let i = 0; i < n2; i++) { re[i] *= mpp; dens[i] = re[i]; re[i] -= 1; }
      WS.fft2(re, im, NG, false);
      const { f: GF, KX, KY } = green(NG);
      re[0] = 0; im[0] = 0;
      for (let i = 1; i < n2; i++) {
        const f = GF[i], kx = KX[i], ky = KY[i];
        const dr = re[i] * f, di = im[i] * f;
        re[i] = -kx * di - ky * dr;
        im[i] = kx * dr + -ky * di;
      }
      WS.fft2(re, im, NG, true);
      const gx = this.gx, gy = this.gy;
      for (let n = 0; n < N; n++) {
        const fx = px[n] * NG - 0.5, fy = py[n] * NG - 0.5;
        const i0 = Math.floor(fx), j0 = Math.floor(fy);
        const ax = fx - i0, ay = fy - j0;
        const ii = i0 < 0 ? i0 + NG : i0, jj = j0 < 0 ? j0 + NG : j0;
        const i1 = i0 + 1 >= NG ? i0 + 1 - NG : i0 + 1, j1 = j0 + 1 >= NG ? j0 + 1 - NG : j0 + 1;
        const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
        const a = jj * NG + ii, b = jj * NG + i1, c = j1 * NG + ii, d = j1 * NG + i1;
        gx[n] = re[a] * w00 + re[b] * w10 + re[c] * w01 + re[d] * w11;
        gy[n] = im[a] * w00 + im[b] * w10 + im[c] * w01 + im[d] * w11;
      }
    }

    cosmoStep() {
      const k = this.k, om = k.om, ol = OL0 * k.lam;
      const H = this.adot / this.a;
      const tGyr = this.t / 1e9;
      const cap = 0.03 * Math.max(1, tGyr / 13.8);
      const dt = Math.min(0.012 / Math.max(1e-6, Math.abs(H)), cap);
      const C = 1.5 * om * H0 * H0 * k.G;
      const N = this.N, vx = this.vx, vy = this.vy, gx = this.gx, gy = this.gy, px = this.px, py = this.py;
      const kick = (h) => {
        const damp = Math.exp(-2 * H * h), acc = (C / Math.pow(this.a, 3)) * h;
        for (let n = 0; n < N; n++) {
          vx[n] = vx[n] * damp + gx[n] * acc;
          vy[n] = vy[n] * damp + gy[n] * acc;
        }
      };
      kick(dt / 2);
      for (let n = 0; n < N; n++) {
        let x = px[n] + vx[n] * dt, y = py[n] + vy[n] * dt;
        x -= Math.floor(x); y -= Math.floor(y);
        px[n] = x; py[n] = y;
      }
      // 스케일 인자: ä = a·H0²(ΩΛ − Ωm/(2a³)), 반-킥/이동/반-킥
      const acc = (a) => a * H0 * H0 * (ol - om / (2 * Math.pow(a, 3)));
      this.adot += 0.5 * acc(this.a) * dt;
      this.a = Math.max(0.005, this.a + this.adot * dt);
      this.adot += 0.5 * acc(this.a) * dt;
      if (this.a > this.aMax) this.aMax = this.a;
      // 시계는 관측 끝 시각을 넘지 않음. 마지막 걸음의 물리(걸음 길이, 별의 나이)는 넘친 시각 그대로 계산
      const tRaw = this.t + dt * 1e9;
      this.t = Math.min(tRaw, this.until);
      this.computeGravity();
      kick(dt / 2);
      this.stellar(dt, tRaw / 1e9);
      this.checkCosmos();
    }

    /* ----- 별 탄생·죽음·중원소 ----- */
    stellar(dt, tG) {
      const k = this.k, NG = this.NG, N = this.N, r = this.rng, MZ = this.MZ;
      const rhoTh = 7;
      const fuel = Math.min(1, this.xH / 0.6);
      const rate = 3 * this.coolF * fuel;
      const lifeF = Math.pow(k.G, -2.5) * Math.pow(k.alpha, -1) * (this.diproton ? Math.max(0.02, this.xH / 0.75) : 1);
      const snLife = 0.1 * Math.max(1, Math.pow(k.G, -2.5));
      let born = 0;
      for (let n = 0; n < N; n++) {
        const ty = this.type[n];
        if (ty === 1) {
          const gi = Math.floor(this.py[n] * NG) * NG + Math.floor(this.px[n] * NG);
          const rho = this.dens[gi];
          let u = 2;
          if (rho > rhoTh) { u = r.next() + (this.px[n] + this.py[n]) * SUBGRID; u -= Math.floor(u); }
          if (u < 1 - Math.exp(-rate * dt * Math.sqrt(rho / rhoTh))) {
            const zi = Math.floor(this.py[n] * MZ) * MZ + Math.floor(this.px[n] * MZ);
            this.birth[n] = tG;
            this.Z[n] = this.zgrid[zi];
            if (!this.deutOK) { this.type[n] = 3; this.dark++; continue; }
            this.type[n] = 2;
            const u = r.next();
            const tier = u < 0.22 ? 0.012 : u < 0.4 ? 1.2 : u < 0.78 ? 10 : 120;
            this.life[n] = tier * lifeF * r.range(0.7, 1.4);
            this.stars++;
            born++;
          }
        } else if (ty === 2 && tG - this.birth[n] > this.life[n]) {
          this.type[n] = 3;
          this.stars--;
          if (this.life[n] < snLife) {
            this.sn++;
            this.enrich(this.px[n], this.py[n], 0.22);
            // 화면 효과는 주 난수를 쓰지 않음 (헤드리스와 궤적이 같아야 함)
            if (!this.headless && Math.random() < 0.5) this.addFx({ type: 'flash', x: this.px[n], y: this.py[n], r: 0.025, life: 0.8, color: [255, 220, 170] });
          } else this.enrich(this.px[n], this.py[n], 0.05);
        }
      }
      if (born && !this.reached.firststar) {
        this.reach('firststar', '최초의 별이 빛나기 시작했습니다. 우주의 암흑 시대가 끝납니다.');
      }
      if (!this.deutOK && this.dark > 20 && !this.warnedDark) {
        this.warnedDark = true;
        this.log('가스 구름이 뭉쳤지만 중수소가 안정하지 않아 핵융합이 시작되지 않습니다. 빛나지 않는 덩어리만 생깁니다.', 'disaster');
      }
      // 중원소 확산
      if (this.steps % 4 === 0) {
        const z = this.zgrid, z2 = this.zgrid2;
        for (let y = 0; y < MZ; y++) for (let x = 0; x < MZ; x++) {
          const i = y * MZ + x;
          const s = z[y * MZ + (x + 1) % MZ] + z[y * MZ + (x - 1 + MZ) % MZ] + z[((y + 1) % MZ) * MZ + x] + z[((y - 1 + MZ) % MZ) * MZ + x];
          z2[i] = z[i] * 0.98 + s * 0.005;
        }
        this.zgrid = z2; this.zgrid2 = z;
      }
    }
    enrich(x, y, amt) {
      const MZ = this.MZ, zi = Math.floor(y * MZ) * MZ + Math.floor(x * MZ);
      this.zgrid[zi] += amt;
    }
    zAvg() {
      if (!this.zgrid) return 0;
      let s = 0;
      for (let i = 0; i < this.zgrid.length; i++) s += this.zgrid[i];
      return s / this.zgrid.length;
    }

    checkCosmos() {
      const k = this.k, om = k.om, ol = OL0 * k.lam;
      if (this.steps % 6 === 0) this.census();
      if (this.galaxies > 0 && this.biggest >= 10) this.reach('galaxy', '별들이 모여 첫 은하를 이루었습니다.');
      if (this.cands > 0) this.reach('metal', '무거운 원소를 품은 오래 사는 별이 생겼습니다. 행성과 생명의 재료가 갖춰졌습니다.');
      if (ol > 0 && this.adot > 0 && ol > om / Math.pow(this.a, 3)) this.reach('dark', '암흑 에너지가 물질을 압도해 팽창이 가속되기 시작합니다.');
      if (this.adot < 0 && !this.warnedCrunch) {
        this.warnedCrunch = true;
        this.log('팽창이 멈추고 우주가 수축하기 시작했습니다.', 'disaster');
      }
      if (this.adot < 0 && this.a < 0.03) {
        this.end('대함몰 (빅 크런치)', '중력이 팽창을 이겨 우주 전체가 다시 한 점으로 무너졌습니다.', '빅 크런치로 종말');
        return;
      }
      if (this.a > 60 && this.galaxies === 0 && this.stars === 0 && !this.reached.firststar) {
        const [title, text] = this.noStarReason();
        this.end(title, text + ' 우주는 이미 너무 넓게 퍼져, 앞으로도 별은 생기지 않습니다.', '별이 없는 우주');
        return;
      }
      if (this.t >= this.until) this.finishByAge();
    }
    /* 별이 하나도 생기지 않은 까닭: 실제로 일어난 일(뭉쳤지만 타지 못함)을 먼저, 아니면 뭉치지 못하게 한 조건들 */
    noStarReason() {
      const k = this.k;
      if (!this.deutOK && this.dark > 0) return ['빛나지 않는 덩어리의 우주', '가스는 뭉쳤지만 핵력이 약해 핵융합이 일어나지 않았습니다. 별이 하나도 빛나지 않습니다.'];
      const why = [];
      if (k.Q < 0.6) why.push('처음 요동이 너무 작음');
      if ((k.G * k.om) / 0.31 < 0.6) why.push('중력이 너무 약함');
      if (k.lam > 5) why.push('팽창이 너무 빠름');
      if (this.fGas < 0.08) why.push('별이 될 가스가 너무 적음');
      if (!this.deutOK) why.push('핵력이 약해 핵융합이 불가능함');
      return ['텅 빈 우주', '물질이 별이 될 만큼 뭉치지 못했습니다.' + (why.length ? ` 까닭: ${why.join(', ')}.` : ' 팽창을 이기고 뭉칠 만큼 요동과 중력이 크지 않았습니다.')];
    }
    /* 관측 끝(기본 1000억 년, 실험실은 정한 시점)에 도달했을 때의 결말 */
    finishByAge() {
      if (this.t > this.until) this.t = this.until;
      const age = WS.fmtYears(this.t), early = this.t < 1.2e10;
      if (this.phase === 'cosmos' && this.adot < 0) {
        this.end('수축하는 우주', `${age} 시점에 우주는 이미 수축하고 있습니다. 결국 모든 것이 한 점으로 무너지는 빅 크런치로 끝날 것입니다.`, '빅 크런치로 가는 중');
      } else if (!this.reached.firststar) {
        if (early && (this.deutOK || !this.dark)) this.end('아직 어두운 우주', `${age}이 지났지만 아직 별이 하나도 태어나지 않았습니다.`, '별이 없는 우주 (아직)');
        else { const [title, text] = this.noStarReason(); this.end(title, text, '별이 없는 우주'); }
      } else if (this.cands > 0) {
        this.end('생명이 가능한 우주', `${age} 동안 ${this.galaxies ? '은하와 ' : ''}무거운 원소가 쌓였고, 그 원소를 품고 오래 사는 별이 지금도 빛납니다. 그 둘레 어딘가에 행성이 있을 수 있습니다.`, '생명 가능한 우주');
      } else if (this.reached.metal) {
        this.end('별이 다 타 버린 우주', `한때 무거운 원소를 품고 오래 사는 별이 있었지만, ${age} 시점에는 그런 별이 남아 있지 않습니다.${this.k.G > 1.6 ? ' 중력이 세서 별들이 너무 빨리 타 버렸습니다.' : ''}`, '생명의 별이 다 타 버림');
      } else if (!this.reached.metal) {
        if (!this.chemOK) this.end('생명이 깃들기 어려운 우주', '별은 빛났지만 원자와 화학의 규칙이 복잡한 분자를 허락하지 않습니다.', '별은 있으나 생명 재료 부족');
        else if (early) this.end('아직 재료를 모으는 우주', `${age} 시점: 별과 은하는 생겼지만 무거운 원소를 품고 오래 사는 별은 아직 없습니다. 시간이 더 필요합니다.`, '별은 있으나 생명 재료 부족 (아직)');
        else this.end('생명이 깃들기 어려운 우주', '별은 생겼지만 무거운 원소를 품고 오래 사는 별이 나타나지 않았습니다.', '별은 있으나 생명 재료 부족');
      }
    }
    census() {
      const G = this.CG, grid = this.starGrid;
      grid.fill(0);
      let zs = 0, zn = 0, cands = 0, best = null;
      for (let n = 0; n < this.N; n++) {
        if (this.type[n] !== 2) continue;
        grid[Math.floor(this.py[n] * G) * G + Math.floor(this.px[n] * G)]++;
        zs += this.Z[n]; zn++;
        if (this.chemOK && this.Z[n] >= 0.5 && this.life[n] >= 4) {
          cands++;
          if (!best || this.Z[n] > best.Z) best = { Z: this.Z[n], x: this.px[n], y: this.py[n], life: this.life[n], n };
        }
      }
      this.zMean = zn ? zs / zn : 0;
      this.cands = cands;
      if (best) this.best = best;
      // 은하 = 별이 모인 칸의 연결 덩어리 (위치는 주기 경계를 고려한 원형 평균)
      const seen = new Uint8Array(G * G);
      let gal = 0, big = 0;
      const list = [];
      const TP = 2 * Math.PI / G;
      for (let i = 0; i < G * G; i++) {
        if (seen[i] || grid[i] < 3) continue;
        let cnt = 0, cells = 0, sx = 0, cx = 0, sy = 0, cy = 0;
        const st = [i];
        seen[i] = 1;
        while (st.length) {
          const c = st.pop();
          const w = grid[c], gx = c % G, gy = (c / G) | 0;
          cnt += w; cells++;
          sx += w * Math.sin((gx + 0.5) * TP); cx += w * Math.cos((gx + 0.5) * TP);
          sy += w * Math.sin((gy + 0.5) * TP); cy += w * Math.cos((gy + 0.5) * TP);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const j = ((gy + dy + G) % G) * G + ((gx + dx + G) % G);
            if (!seen[j] && grid[j] >= 3) { seen[j] = 1; st.push(j); }
          }
        }
        if (cnt >= 8) {
          gal++; big = Math.max(big, cnt);
          const ang = (s, c) => { const a = Math.atan2(s, c) / (2 * Math.PI); return a < 0 ? a + 1 : a; };
          list.push({ x: ang(sx, cx), y: ang(sy, cy), n: cnt, r: Math.sqrt(cells / Math.PI) / G });
        }
      }
      list.sort((p, q) => q.n - p.n);
      this.galaxies = gal;
      this.biggest = big;
      this.galList = list.slice(0, 6);
    }

    H() { return this.a ? this.adot / this.a : 0; }
  }

  /* ----- 단계 진행 ----- */
  function step(s) {
    s.pstep++;
    if (s.phase === 'vacuum') {
      s.fluct = s.fluct * 0.9 + s.rng.next() * 0.1 + (s.boost > 0 ? 0.08 : 0);
      const p = 0.004 * s.k.vac * (s.boost > 0 ? 8 : 1);
      if (s.boost > 0) s.boost--;
      if (s.rng.chance(p)) s.bang();
      else if (s.pstep > 600) s.end('영원한 진공', '이 진공은 안정적이었습니다. 요동이 일었지만 급팽창으로 번지지 않아 우주가 태어나지 않았습니다.', '빅뱅이 일어나지 않음');
      return;
    }
    if (s.phase === 'inflation') {
      s.t = Math.pow(10, -36 + (s.pstep / 40) * 4) / YR;
      if (s.pstep >= 40) { s.phase = 'plasma'; s.pstep = 0; }
    } else if (s.phase === 'plasma') {
      // 10⁻⁶초 → 38만 년 (로그 시간)
      const lt = -6 + (s.pstep / 110) * (Math.log10(3.8e5 * YR) + 6);
      s.t = Math.pow(10, lt) / YR;
      if (s.t * YR >= 180 && !s.reached.bbn) {
        const he = (1 - s.xH) * 100;
        let txt = `원자핵 합성: 수소 ${(s.xH * 100).toFixed(0)}%, 헬륨 ${he.toFixed(0)}%.`;
        if (s.diproton) txt += ' 핵력이 강해 수소 대부분이 첫 몇 분 만에 타 버렸습니다.';
        else if (!s.deutOK) txt += ' 핵력이 약해 중수소가 버티지 못합니다. 무거운 원소로 가는 길이 막혔습니다.';
        s.reach('bbn', txt);
      }
      if (s.pstep >= 110) { s.phase = 'recomb'; s.pstep = 0; s.reach('recomb', '전자와 원자핵이 결합해 원자가 되고, 우주가 투명해졌습니다. 이 빛이 우주 배경 복사입니다.'); }
    } else if (s.phase === 'recomb') {
      s.t = 3.8e5 * Math.pow(5e7 / 3.8e5, s.pstep / 70);
      if (s.pstep >= 70) { s.phase = 'cosmos'; s.pstep = 0; s.initParticles(); }
    } else if (s.phase === 'cosmos') { s.cosmoStep(); return; }
    if (!s.ended && s.t >= s.until) s.finishByAge();
  }

  /* ----- 결과 분류 (실험실) ----- */
  // 생명이 가능한 우주 = 그 시점에 무거운 원소를 품고 오래 사는 별이 빛나고 있음 (한때 있었던 것만으로는 아님)
  function classify(s) {
    if (s.phase === 'vacuum') return 'nobang';
    if (s.phase === 'cosmos' && s.adot < 0) return 'crunch';
    if (!s.reached.firststar) return 'dilute';
    if (s.cands > 0) return 'fertile';
    return s.reached.metal ? 'burnt' : 'nometal';
  }

  /* ----- 그리기 도우미 ----- */
  const F_BODY = "'IBM Plex Sans KR', 'Malgun Gothic', sans-serif";
  const F_MONO = "'IBM Plex Mono', Consolas, monospace";
  const F_DISP = "'Gowun Batang', Batang, serif";
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
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
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
  // 아주 크거나 작은 수는 10의 거듭제곱으로 ('7×10²⁴', '10⁻²⁴')
  function sci(v) {
    if (!(v > 0) || !isFinite(v)) return String(v);
    let e = Math.floor(Math.log10(v)), m = Number((v / Math.pow(10, e)).toPrecision(2));
    if (m >= 10) { m = 1; e++; }
    return (m === 1 ? '' : WS.trimNum(m) + '×') + '10' + WS.sup(e);
  }
  const lyLabel = (ly) => (ly >= 1e16 ? '약 ' + sci(ly) : WS.fmtCount(ly)) + ' 광년';
  const fmtA = (a) => (a < 0.1 ? a.toFixed(3) : a < 1e5 ? WS.trimNum(a) : sci(a));
  const fmtK = (T) => (T > 1e5 || T < 0.01 ? sci(T) : WS.trimNum(T)) + ' K';
  // 재결합 시기 배경 온도: 38만 년 3,000 K에서 우주 구조 단계 시작(크기 인자 0.02, 2.725/0.02 K)까지 로그로 이어짐
  const T_RECOMB = 3000, T_COSMO = 2.725 / 0.02;
  const recombT = (t) => T_RECOMB * Math.pow(T_COSMO / T_RECOMB, WS.clamp(Math.log(t / 3.8e5) / Math.log(5e7 / 3.8e5), 0, 1));

  /* ----- 그리기 ----- */
  function plate(W, H) {
    const S = Math.max(120, Math.min(W - 32, H - 92));
    return { S, x0: (W - S) / 2, y0: Math.max(40, (H - 52 - S) / 2) };
  }
  let vacImg = null;
  function renderVacuum(s, ctx, W, H, time) {
    const gw = 96, gh = 54;
    if (!vacImg) { vacImg = document.createElement('canvas'); vacImg.width = gw; vacImg.height = gh; }
    const g = vacImg.getContext('2d'), img = g.createImageData(gw, gh);
    const amp = 0.4 + s.fluct * 1.6;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const v = s.noise.fbm(x * 0.07, y * 0.07, time * 0.35, 3) * amp;
      const sp = Math.max(0, s.noise.n3(x * 0.25, y * 0.25, time * 1.7) - 0.45) * 5 * s.fluct;
      const i = (y * gw + x) * 4;
      img.data[i] = 18 + Math.max(0, v) * 90 + sp * 200;
      img.data[i + 1] = 10 + Math.max(0, v) * 40 + sp * 160;
      img.data[i + 2] = 40 + (v + 0.5) * 90 + sp * 255;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(vacImg, 0, 0, W, H);
    // 가운데 설명 카드
    const cw = Math.min(W - 32, 520), cx = W / 2;
    ctx.font = '13px ' + F_BODY;
    const body = wrap(ctx, s.ended ? '진공은 끝내 무너지지 않았습니다. 이 세계에서는 시간도 공간도 시작되지 않았습니다.' : '공간이 아직 "들뜬" 상태로 요동칩니다. 어느 순간 한 점이 무너지면 급팽창, 곧 빅뱅이 시작됩니다. 언제 일어날지는 우연에 달려 있습니다.', cw - 36);
    const ch = 64 + body.length * 19 + 46, cy = Math.max(48, H * 0.42 - ch / 2);
    ctx.fillStyle = 'rgba(5,7,11,.72)';
    rrect(ctx, cx - cw / 2, cy, cw, ch, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(216,168,91,.35)'; ctx.lineWidth = 1; ctx.stroke();
    txt(ctx, '시간 이전 · 거짓 진공', cx, cy + 34, { align: 'center', size: 21, font: F_DISP, weight: 700, halo: false });
    body.forEach((l, i) => txt(ctx, l, cx, cy + 60 + i * 19, { align: 'center', size: 13, color: C_MUTED, halo: false }));
    // 기다림 막대 + 확률
    const by = cy + 60 + body.length * 19 + 8, bw = cw - 80, bx = cx - bw / 2;
    ctx.fillStyle = 'rgba(146,154,171,.18)'; ctx.fillRect(bx, by, bw, 6);
    ctx.fillStyle = s.boost > 0 ? C_BRASS : 'rgba(180,150,255,.85)'; ctx.fillRect(bx, by, bw * Math.min(1, s.pstep / 600), 6);
    const p = 0.004 * s.k.vac * (s.boost > 0 ? 8 : 1);
    txt(ctx, `요동 ${s.pstep} / 600 · 지금 이 순간 빅뱅 확률 ${(p * 100).toFixed(p < 0.01 ? 2 : 1)}%${s.boost > 0 ? ' (관찰자의 요동으로 8배)' : ''}`, cx, by + 24, { align: 'center', size: 12, font: F_MONO, color: C_MUTED, halo: false });
  }

  function cmbCanvas(s) {
    if (s._cmbC) return s._cmbC;
    const NG = s.NG;
    const c = document.createElement('canvas');
    c.width = c.height = NG;
    const g = c.getContext('2d'), img = g.createImageData(NG, NG);
    for (let i = 0; i < NG * NG; i++) {
      const col = WS.ramp(CMB_STOPS, 0.5 + s.cmb[i] * 0.22);
      img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return (s._cmbC = c);
  }
  const CMB_STOPS = [[18, 30, 110], [50, 110, 200], [225, 225, 215], [235, 130, 55], [160, 35, 25]];
  const PLASMA_STOPS = [[255, 255, 250], [255, 230, 160], [255, 160, 70], [200, 70, 40], [110, 30, 30]];
  const DENS_STOPS = [[3, 5, 14], [16, 22, 64], [52, 48, 140], [108, 112, 214], [178, 206, 255], [255, 250, 240]];
  const WEB_STOPS = [[3, 5, 10], [6, 8, 20], [18, 16, 48], [44, 36, 96], [86, 78, 160], [140, 136, 210]];
  const METAL_STOPS = [[6, 6, 12], [44, 16, 64], [118, 32, 104], [214, 92, 62], [250, 186, 90], [255, 246, 214]];
  const COL = { dm: 'rgba(92,104,190,0.5)', gas: 'rgba(112,162,236,0.62)', rem: 'rgba(152,98,172,0.45)', young: 'rgba(205,224,255,.95)', mid: 'rgba(255,236,190,.92)', old: 'rgba(255,168,118,.88)' };

  // 16×16로 뭉갠 뒤 가장 높은/낮은 칸 (주기 경계, 3×3 평활)
  function extremes(src, n, out) {
    const B = 16, f = n / B, g = new Float32Array(B * B);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) g[((y / f) | 0) * B + ((x / f) | 0)] += src[y * n + x];
    let hi = -Infinity, lo = Infinity, hiI = 0, loI = 0;
    for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
      let v = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) v += g[((y + dy + B) % B) * B + ((x + dx + B) % B)];
      if (v > hi) { hi = v; hiI = y * B + x; }
      if (v < lo) { lo = v; loI = y * B + x; }
    }
    out = out || {};
    out.hx = ((hiI % B) + 0.5) / B; out.hy = (((hiI / B) | 0) + 0.5) / B;
    out.lx = ((loI % B) + 0.5) / B; out.ly = (((loI / B) | 0) + 0.5) / B;
    out.hv = hi / (9 * f * f); out.lv = lo / (9 * f * f);
    return out;
  }

  function render(s, ctx, W, H, time, app) {
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, W, H);
    if (s.phase === 'vacuum') { renderVacuum(s, ctx, W, H, time); return; }
    const { S, x0, y0 } = plate(W, H);
    const hb = hud(ctx, W, H), spot = capSpot(hb, W, H, y0 + S + 20, Math.max(S, 300));
    if (s.phase === 'inflation') {
      const p = s.pstep / 40;
      const z = Math.exp(-7 + p * 7) * S;
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = Math.min(1, 0.3 + p);
      ctx.drawImage(cmbCanvas(s), W / 2 - z / 2, y0 + S / 2 - z / 2, z, z);
      ctx.globalAlpha = 1;
      const g = ctx.createRadialGradient(W / 2, y0 + S / 2, 0, W / 2, y0 + S / 2, Math.max(W, H));
      g.addColorStop(0, `rgba(255,255,255,${1 - p * 0.7})`);
      g.addColorStop(0.3 + p * 0.5, `rgba(255,240,220,${0.5 * (1 - p)})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      const sz = Math.pow(10, p * 26);
      txt(ctx, `공간이 ${sz < 1e4 ? Math.round(sz).toLocaleString('ko-KR') : '10' + WS.sup(Math.round(p * 26))}배로 부풀었습니다`, W / 2, y0 + S / 2 + Math.max(30, z / 2 + 26), { align: 'center', size: 15, weight: 600, color: '#2a1a08', haloC: 'rgba(255,250,240,.75)' });
      caption(ctx, [{ t: '급팽창: 원자보다 작은 점이 눈 깜짝할 새보다 훨씬 짧은 순간에 10²⁶배 이상 부풀어 오릅니다. 그 속의 양자 요동이 그대로 늘어나 훗날 은하의 씨앗이 됩니다.', max: 2 }], spot);
      return;
    }
    if (s.phase === 'plasma') {
      const p = s.pstep / 110;
      const col = WS.ramp(PLASMA_STOPS, p);
      ctx.fillStyle = WS.rgb(col);
      ctx.fillRect(x0, y0, S, S);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,255,255,${0.25 * (1 - p)})`;
      for (let i = 0; i < 900; i++) {
        const x = s.noise.n3(i * 0.37, time * 2.3, 1) * 0.5 + 0.5, y = s.noise.n3(i * 0.53, time * 2.1, 5) * 0.5 + 0.5;
        ctx.fillRect(x0 + ((x * 3) % 1) * S, y0 + ((y * 3) % 1) * S, 2, 2);
      }
      ctx.globalCompositeOperation = 'source-over';
      plasmaParticles(s, ctx, x0, y0, S, time);
      infoCard(s, ctx, W / 2, y0 + S / 2);
      frame(ctx, x0, y0, S);
      caption(ctx, [{ t: s.reached.bbn ? '원자핵이 만들어졌지만 아직 너무 뜨거워 전자가 붙지 못합니다. 빛이 입자에 계속 부딪혀 우주는 안개처럼 불투명합니다.' : '빅뱅 직후의 우주: 쿼크·전자·빛이 뒤섞인 뜨거운 수프입니다. 식어 가면서 양성자와 중성자가 생깁니다.', max: 2 }], spot);
      return;
    }
    if (s.phase === 'recomb') {
      const p = s.pstep / 70;
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 1 - WS.smooth(0.55, 1, p);
      ctx.drawImage(cmbCanvas(s), x0, y0, S, S);
      ctx.globalAlpha = 1;
      frame(ctx, x0, y0, S);
      const cap = capLayout(ctx, [{ t: '우주 배경 복사: 원자가 생기며 풀려난 빛의 지도입니다. 붉을수록 아주 조금(10만분의 1 정도) 더 빽빽합니다. 이 얼룩이 은하의 씨앗입니다.', max: 2 }], spot);
      if (p < 0.75) {
        const e = s._cmbX || (s._cmbX = extremes(s.cmb, s.NG));
        const placed = reserved(hb, W, H), box = [x0, y0, x0 + S, y0 + S];
        if (cap) placed.push(cap.box);
        ctx.strokeStyle = 'rgba(255,240,220,.9)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x0 + e.hx * S, y0 + e.hy * S, S / 18, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(x0 + e.lx * S, y0 + e.ly * S, S / 18, 0, Math.PI * 2); ctx.stroke();
        placeTag(ctx, placed, x0 + e.hx * S, y0 + e.hy * S, S / 18, ['가장 빽빽한 씨앗', '훗날 은하가 모이는 곳'], box, { color: '#ffd2a8' });
        placeTag(ctx, placed, x0 + e.lx * S, y0 + e.ly * S, S / 18, ['가장 옅은 곳', '훗날 텅 빈 공간(보이드)'], box, { color: '#b9d2ff' });
      }
      capDraw(ctx, cap);
      return;
    }
    renderCosmos(s, ctx, W, H, x0, y0, S, app && app.view ? app.view : 0, hb, spot);
  }
  function tempOf(s) {
    const sec = Math.max(1e-40, s.t * YR);
    return 1e10 / Math.sqrt(sec);
  }
  function fmtTemp(T) {
    if (T >= 1e16) return '10' + WS.sup(Math.round(Math.log10(T))) + '도';
    const r = Number(T.toPrecision(2));
    if (r >= 1e12) return '약 ' + WS.trimNum(r / 1e12) + '조 도';
    if (r >= 1e8) return '약 ' + WS.trimNum(r / 1e8) + '억 도';
    if (r >= 1e4) return '약 ' + Math.round(r / 1e4) + '만 도';
    return '약 ' + Math.round(r) + '도';
  }
  // 플라스마 속 입자 (화면 전용, 노이즈로 흔들림): 핵합성 전엔 양성자·중성자, 뒤엔 수소·헬륨 원자핵, 그리고 전자
  const P_COL = { p: '#ef8f6c', n: '#d6cfc4', H: '#84c6d2', He: '#f1cb86', e: '#a9d6ff' };
  function plasmaParticles(s, ctx, x0, y0, S, time) {
    const nP = 260, bb = !!s.reached.bbn, r0 = Math.max(1.6, S / 260);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(40,10,5,.45)';
    for (let i = 0; i < nP; i++) {
      // 고르게 흩은 자리(R2 수열) + 노이즈로 조금씩 떨림
      const x = x0 + (((i * 0.7548776662 + 0.5 + s.noise.n3(i * 0.71, time * 0.8, 2) * 0.03) % 1) + 1) % 1 * S;
      const y = y0 + (((i * 0.5698402910 + 0.5 + s.noise.n3(i * 0.93, time * 0.8, 7) * 0.03) % 1) + 1) % 1 * S;
      const f = i / nP;
      let col, r;
      if (f >= 0.7) { col = P_COL.e; r = r0 * 0.55; }
      else if (bb) { const he = f / 0.7 > s.xH; col = he ? P_COL.He : P_COL.H; r = he ? r0 * 1.5 : r0; }
      else { const n = f / 0.7 > 0.78; col = n ? P_COL.n : P_COL.p; r = r0; }
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      if (f < 0.7) ctx.stroke();
    }
  }
  function infoCard(s, ctx, cx, cy) {
    const T = tempOf(s), w = 236, h = s.reached.bbn ? 98 : 64;
    ctx.fillStyle = 'rgba(5,7,11,.72)';
    rrect(ctx, cx - w / 2, cy - h / 2, w, h, 10); ctx.fill();
    txt(ctx, '온도', cx, cy - h / 2 + 20, { align: 'center', size: 11.5, color: C_MUTED, halo: false });
    txt(ctx, fmtTemp(T), cx, cy - h / 2 + 46, { align: 'center', size: 22, font: F_DISP, weight: 700, color: '#ffd9a8', halo: false });
    if (s.reached.bbn) {
      const bx = cx - 90, by = cy + h / 2 - 30, bw = 180;
      ctx.fillStyle = C_CYAN; ctx.fillRect(bx, by, bw * s.xH, 8);
      ctx.fillStyle = '#d8a85b'; ctx.fillRect(bx + bw * s.xH, by, bw * (1 - s.xH), 8);
      txt(ctx, `수소 ${(s.xH * 100).toFixed(0)}% · 헬륨 ${((1 - s.xH) * 100).toFixed(0)}%`, cx, by + 22, { align: 'center', size: 12, halo: false });
    }
  }
  function frame(ctx, x0, y0, S) {
    ctx.strokeStyle = 'rgba(216,168,91,.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 - 0.5, y0 - 0.5, S + 1, S + 1);
  }

  function glowCanvas(s) {
    const c = s._glow || (s._glow = document.createElement('canvas'));
    if (c.width !== 64) c.width = c.height = 64;
    const g = c.getContext('2d'), img = g.createImageData(64, 64), d = img.data;
    const tG = s.t / 1e9;
    for (let n = 0; n < s.N; n++) {
      if (s.type[n] !== 2) continue;
      const i = (Math.floor(s.py[n] * 64) * 64 + Math.floor(s.px[n] * 64)) * 4;
      const young = tG - s.birth[n] < 0.5;
      d[i] = Math.min(255, d[i] + 70);
      d[i + 1] = Math.min(255, d[i + 1] + (young ? 60 : 50));
      d[i + 2] = Math.min(255, d[i + 2] + (young ? 80 : 30));
      d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  function fieldCanvas(s, key, src, n, stops, tf) {
    const k = '_f' + key;
    let c = s[k];
    if (c && c._step === s.steps) return c;
    if (!c) { c = s[k] = document.createElement('canvas'); c.width = c.height = n; }
    const g = c.getContext('2d'), img = g.createImageData(n, n), d = img.data;
    for (let i = 0; i < n * n; i++) {
      const col = WS.ramp(stops, tf(src[i]));
      d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    c._step = s.steps;
    return c;
  }
  /* 부드럽게 한 밀도 (64×64, CIC + [1,2,1] 흐림 세 번, 평균 1): 밀도 지도·이름표·마우스 정보·'가장 밀집한 곳' 표적에 씀.
     입자 상태만 읽으므로 결정적이며 시뮬레이션 진행에는 영향이 없음 */
  const SD = 64;
  function smoothDens(s) {
    if (s._sd && s._sdStep === s.steps) return s._sd;
    const G = SD, g = s._sd || new Float32Array(G * G), t = s._sdT || new Float32Array(G * G);
    g.fill(0);
    for (let n = 0; n < s.N; n++) {
      const fx = s.px[n] * G - 0.5, fy = s.py[n] * G - 0.5, i0 = Math.floor(fx), j0 = Math.floor(fy), ax = fx - i0, ay = fy - j0;
      const ii = (i0 + G) % G, jj = (j0 + G) % G, i1 = (i0 + 1 + G) % G, j1 = (j0 + 1 + G) % G;
      g[jj * G + ii] += (1 - ax) * (1 - ay); g[jj * G + i1] += ax * (1 - ay); g[j1 * G + ii] += (1 - ax) * ay; g[j1 * G + i1] += ax * ay;
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) t[y * G + x] = (g[y * G + ((x + G - 1) % G)] + 2 * g[y * G + x] + g[y * G + ((x + 1) % G)]) / 4;
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) g[y * G + x] = (t[((y + G - 1) % G) * G + x] + 2 * t[y * G + x] + t[((y + 1) % G) * G + x]) / 4;
    }
    const k = (G * G) / s.N;
    for (let i = 0; i < G * G; i++) g[i] *= k;
    s._sd = g; s._sdT = t; s._sdStep = s.steps;
    return g;
  }
  const JIT = {};
  function jitter(N) {
    if (JIT[N]) return JIT[N];
    const r = new WS.RNG(0x51ed27 + N), a = new Float32Array(2 * N); // 화면 전용 난수
    for (let i = 0; i < 2 * N; i++) a[i] = r.next() - 0.5;
    return (JIT[N] = a);
  }
  const densT = (v) => (Math.log10(v + 0.03) + 0.9) / 2.3;
  const metalT = (z) => Math.log10(1 + z * 100) / 2.15;

  function renderCosmos(s, ctx, W, H, x0, y0, S, view, hb, spot) {
    const N = s.N, tG = s.t / 1e9;
    const toX = (x) => x0 + x * S, toY = (y) => y0 + y * S;
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, S, S); ctx.clip();
    const crunch = s.adot < 0 ? WS.clamp(1 - s.a / Math.max(0.05, s.aMax), 0, 1) : 0;
    ctx.fillStyle = crunch ? `rgb(${(5 + crunch * 90) | 0},${(7 + crunch * 20) | 0},11)` : '#03050a';
    ctx.fillRect(x0, y0, S, S);
    const ps = Math.max(1.2, (S / 520) * Math.sqrt(4096 / N) * 0.8); // 입자가 적은 간이 해상도에선 점을 조금 크게
    ctx.imageSmoothingEnabled = true;
    if (view === 1) {
      ctx.drawImage(fieldCanvas(s, 'd', smoothDens(s), SD, DENS_STOPS, densT), x0, y0, S, S);
    } else if (view === 2) {
      ctx.drawImage(fieldCanvas(s, 'z', s.zgrid, s.MZ, METAL_STOPS, metalT), x0, y0, S, S);
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      for (let n = 0; n < N; n++) if (s.type[n] === 2) ctx.fillRect(toX(s.px[n]) - 0.5, toY(s.py[n]) - 0.5, ps + 0.5, ps + 0.5);
    } else {
      // 희미한 우주 거대 구조 그물 (부드럽게 한 밀도): 별이 생기기 전에도 중력이 모으는 모습이 보이게
      ctx.globalAlpha = 0.6;
      ctx.drawImage(fieldCanvas(s, 'w', smoothDens(s), SD, WEB_STOPS, densT), x0, y0, S, S);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'lighter';
      // 화면에서만 입자마다 살짝 비켜 그려 빈 공간에 남은 처음 격자 무늬를 지움 (상태는 그대로)
      const J = jitter(N), js = (S / s.side) * 0.7;
      const dots = (ty, col) => {
        ctx.fillStyle = col;
        for (let n = 0; n < N; n++) if (s.type[n] === ty) ctx.fillRect(toX(s.px[n]) + J[2 * n] * js, toY(s.py[n]) + J[2 * n + 1] * js, ps, ps);
      };
      dots(0, COL.dm); dots(1, COL.gas); dots(3, COL.rem);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(glowCanvas(s), x0, y0, S, S);
      ctx.globalAlpha = 1;
      const sz = ps + 1;
      for (let pass = 0; pass < 3; pass++) {
        ctx.fillStyle = pass === 0 ? COL.young : pass === 1 ? COL.mid : COL.old;
        for (let n = 0; n < N; n++) {
          if (s.type[n] !== 2) continue;
          const age = tG - s.birth[n], c = age < 0.3 ? 0 : age < 3 ? 1 : 2;
          if (c === pass) ctx.fillRect(toX(s.px[n]) - 0.5, toY(s.py[n]) - 0.5, sz, sz);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    for (const b of s.bhs) {
      const bx = toX(b.x), by = toY(b.y);
      ctx.strokeStyle = 'rgba(241,203,134,.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(bx, by, 10, 4, -0.4, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(bx, by, 4, 0, Math.PI * 2); ctx.fill();
    }
    WS.drawFx(ctx, s, (x, y) => [toX(x), toY(y), S]);
    ctx.restore();
    frame(ctx, x0, y0, S);

    /* 설명문과 축척 막대 자리를 먼저 잡고, 이름표(은하, 생명 후보 별, 블랙홀, 밀도/원소 극값)는 그 자리를 피함 */
    const boxLy = 4.5e9 * s.a;
    const what = view === 1 ? '물질 밀도 지도: 밝을수록 물질(대부분 암흑 물질)이 많이 모였습니다. 그물처럼 이어진 끈이 우주 거대 구조입니다.'
      : view === 2 ? '무거운 원소 지도: 별이 죽으며 뿌린 탄소·산소·철입니다. 행성과 생명의 재료가 됩니다. 흰 점은 빛나는 별입니다.'
        : !s.reached.firststar ? '암흑 시대: 보랏빛 점은 암흑 물질, 푸른 점은 가스입니다. 중력이 이들을 끈과 덩어리로 모으고 있습니다.'
          : '점 하나가 별 수십억 개를 대표합니다. 밝게 뭉친 곳이 은하이고, 푸른 별은 젊고 붉은 별은 늙었습니다.';
    const cap = capLayout(ctx, [{ t: what, max: 2 }, { t: `우주의 한 조각을 위에서 본 모습 · 지금 한 변 약 ${lyLabel(niceRound(boxLy))} (팽창을 따라 커짐)`, max: 2, size: 11.5, color: '#8a93a5' }], spot);
    const placed = reserved(hb, W, H), box = [x0, y0, x0 + S, y0 + S], big = S >= 300;
    if (cap) placed.push(cap.box);
    // 축척 막대: 팽창과 함께 커지는 상자의 실제 크기 (상자 오른쪽 위, 가려지면 오른쪽 아래)
    const ell = niceLen(boxLy * 0.2), bl = (ell / boxLy) * S, sLab = lyLabel(ell);
    ctx.font = '11.5px ' + F_BODY;
    const sw = Math.max(bl, ctx.measureText(sLab).width) + 8, sx1 = x0 + S - 14, sx0 = sx1 - bl;
    let sy = y0 + 30;
    const sRect = (yy) => [(sx0 + sx1) / 2 - sw / 2, yy - 20, sw, 24];
    if (placed.some((p) => hits(p, sRect(sy)))) sy = y0 + S - 16;
    if (!placed.some((p) => hits(p, sRect(sy)))) {
      placed.push(sRect(sy));
      ctx.strokeStyle = C_TEXT; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx0, sy - 4); ctx.lineTo(sx0, sy); ctx.lineTo(sx1, sy); ctx.lineTo(sx1, sy - 4); ctx.stroke();
      txt(ctx, sLab, (sx0 + sx1) / 2, sy - 7, { align: 'center', size: 11.5 });
    }
    // 생명 재료를 갖춘 별 (다음 단계로 이어질 후보): 가장 중요하므로 먼저 자리를 잡음
    if (s.best && s.reached.metal && s.type[s.best.n] === 2) {
      const bx = toX(s.px[s.best.n]), by = toY(s.py[s.best.n]);
      ctx.strokeStyle = C_LEAF; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(bx, by, 7, 0, Math.PI * 2); ctx.stroke();
      placeTag(ctx, placed, bx, by, 7, ['생명 재료를 갖춘 별', `무거운 원소 태양의 ${Math.round(s.best.Z * 100)}% · 다음 단계 후보`], box, { color: C_LEAF, line: 'rgba(150,207,136,.6)' });
    }
    if (view === 0) {
      const gl = s.galList.slice(0, big ? 4 : 2).map((g) => ({ g, x: toX(g.x), y: toY(g.y), r: Math.max(9, g.r * S * 1.25 + 4) }));
      ctx.strokeStyle = 'rgba(241,203,134,.6)';
      ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      for (const c of gl) { ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.stroke(); placed.push([c.x - c.r, c.y - c.r, 2 * c.r, 2 * c.r]); }
      ctx.setLineDash([]);
      gl.forEach((c, i) => placeTag(ctx, placed, c.x, c.y, c.r, [i === 0 ? '가장 큰 은하' : '은하', `별 약 ${WS.fmtCount(c.g.n * s.starUnit)}개`], box));
    } else if (view === 1) {
      const e = s._dX && s._dXs === s.steps ? s._dX : (s._dX = extremes(smoothDens(s), SD, s._dX));
      s._dXs = s.steps;
      ctx.strokeStyle = 'rgba(255,250,240,.8)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(toX(e.hx), toY(e.hy), S / 20, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(toX(e.lx), toY(e.ly), S / 20, 0, Math.PI * 2); ctx.stroke();
      placeTag(ctx, placed, toX(e.hx), toY(e.hy), S / 20, ['물질이 가장 많이 모인 곳', `평균의 ${WS.trimNum(e.hv)}배 · 은하단이 자라는 곳`], box, { color: '#fff3dc' });
      placeTag(ctx, placed, toX(e.lx), toY(e.ly), S / 20, ['보이드 (텅 빈 거품)', `평균의 ${WS.trimNum(e.lv)}배`], box, { color: '#b9c8ff' });
    } else if (view === 2 && s.zgrid) {
      let hi = 0, hiI = 0;
      for (let i = 0; i < s.zgrid.length; i++) if (s.zgrid[i] > hi) { hi = s.zgrid[i]; hiI = i; }
      if (hi > 0.02) {
        const hx = toX(((hiI % s.MZ) + 0.5) / s.MZ), hy = toY((((hiI / s.MZ) | 0) + 0.5) / s.MZ);
        ctx.strokeStyle = 'rgba(255,240,210,.8)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(hx, hy, S / s.MZ * 0.75, 0, Math.PI * 2); ctx.stroke();
        placeTag(ctx, placed, hx, hy, S / s.MZ * 0.75, ['무거운 원소가 가장 많은 곳', `태양의 ${WS.trimNum(hi * 100)}%`], box, { color: '#ffd9a0' });
      }
    }
    s.bhs.forEach((b) => placeTag(ctx, placed, toX(b.x), toY(b.y), 10, ['원시 블랙홀', '주변 물질을 끌어당깁니다'], box));
    capDraw(ctx, cap);
  }
  const niceRound = (v) => { const p = Math.pow(10, Math.floor(Math.log10(v)) - 1); return Math.round(v / p) * p; };

  function era(s) {
    if (s.phase === 'vacuum') return { name: '시간 이전', sub: '거짓 진공 속의 양자 요동. 급팽창이 일어날지는 정해져 있지 않습니다.' };
    if (s.phase === 'inflation') return { name: '급팽창', sub: '찰나의 순간 공간이 10²⁶배 이상 부풀어 오릅니다.' };
    if (s.phase === 'plasma') {
      const sec = s.t * YR;
      if (sec < 1e-5) return { name: '쿼크-글루온 플라스마', sub: '양성자도 생기기 전, 뜨거운 입자 수프' };
      if (sec < 1) return { name: '강입자 시대', sub: '쿼크가 묶여 양성자와 중성자가 됩니다' };
      if (sec < 180) return { name: '경입자 시대', sub: '전자와 중성미자가 우주를 채웁니다' };
      if (sec < 1200) return { name: '원자핵 합성', sub: '첫 몇 분, 수소와 헬륨의 비율이 정해집니다' };
      return { name: '광자 시대', sub: '빛이 물질에 갇혀 우주는 아직 불투명합니다' };
    }
    if (s.phase === 'recomb') return { name: '재결합', sub: '원자가 생기고 빛이 풀려납니다' };
    const tG = s.t / 1e9;
    if (s.adot < 0) return { name: '수축하는 우주', sub: '팽창이 멈추고 모든 것이 다시 모여듭니다' };
    if (!s.reached.firststar) return { name: '암흑 시대', sub: '아직 빛나는 것이 없습니다. 중력이 물질을 조금씩 모읍니다' };
    if (tG > 50) return { name: '별들의 황혼', sub: '새 별은 드물어지고 오래 사는 붉은 별만 남습니다' };
    if (s.reached.dark) return { name: '가속 팽창 시대', sub: '암흑 에너지가 은하들을 서로 멀어지게 합니다' };
    if (!s.reached.galaxy) return { name: '최초의 별', sub: '거대한 첫 별들이 빠르게 타고 폭발합니다' };
    return { name: '은하의 시대', sub: '은하가 자라고 합쳐지며 무거운 원소가 쌓입니다' };
  }

  function narrate(s) {
    if (s.ended && s.endText) return s.endText; // 관측이 끝나면 결말 요약
    if (s.phase === 'vacuum') {
      if (s.ended) return '진공은 끝내 무너지지 않았습니다. 이 세계에서는 시간도 공간도 시작되지 않았습니다.';
      const p = 0.004 * s.k.vac * (s.boost > 0 ? 8 : 1);
      return `아직 시간이 시작되지 않았습니다. 거짓 진공이 요동치며, 매 순간 약 ${(p * 100).toFixed(p < 0.01 ? 2 : 1)}% 확률로 빅뱅이 일어날 수 있습니다.`;
    }
    if (s.phase === 'inflation') return '급팽창 중입니다. 아주 작은 점이 한순간에 부풀며, 그 속의 양자 요동이 훗날 은하의 씨앗으로 늘어납니다.';
    if (s.phase === 'plasma') {
      if (!s.reached.bbn) return `우주는 ${fmtTemp(tempOf(s))}의 뜨거운 입자 수프입니다. 아직 원자핵도 거의 없습니다.`;
      return `첫 몇 분 동안 수소 ${(s.xH * 100).toFixed(0)}%, 헬륨 ${((1 - s.xH) * 100).toFixed(0)}%가 만들어졌습니다. 빛이 입자에 갇혀 우주는 아직 불투명합니다.`;
    }
    if (s.phase === 'recomb') return '우주가 식어 원자가 생기면서 빛이 풀려났습니다. 이 빛의 얼룩이 훗날 은하가 자랄 씨앗입니다.';
    if (s.ended && s.adot < 0 && s.a < 0.03) return '우주 전체가 다시 한 점으로 무너졌습니다. 빅 크런치입니다.';
    if (s.adot < 0) return `팽창이 멈추고 우주가 수축하고 있습니다. 크기는 가장 컸을 때의 ${Math.round((100 * s.a) / Math.max(1e-9, s.aMax))}%로 줄었습니다.`;
    if (!s.reached.firststar) {
      if (!s.deutOK && s.dark > 0) return '가스가 뭉쳤지만 핵력이 약해 핵융합이 일어나지 않습니다. 빛나지 않는 덩어리만 늘어 갑니다.';
      return `암흑 시대입니다. 중력이 물질을 끈과 덩어리로 모으고 있지만 아직 빛나는 별은 없습니다.`;
    }
    const st = s.stars ? `이 구역에서 별 약 ${WS.fmtCount(s.stars * s.starUnit)}개가 빛나고 은하 ${s.galaxies}개가 보입니다.` : '지금 빛나는 별은 거의 없습니다.';
    let b;
    if (s.reached.metal) b = s.cands ? '무거운 원소를 품고 오래 사는 별이 있어, 행성과 생명의 재료가 갖춰졌습니다.' : '생명의 재료를 품은 별이 한때 있었지만 지금은 드뭅니다.';
    else if (!s.chemOK) b = '하지만 이 우주의 화학 법칙으로는 복잡한 분자가 생기기 어렵습니다.';
    else b = `우주의 무거운 원소는 아직 태양의 ${WS.trimNum(Math.max(0.1, s.zAvg() * 100))}% 수준입니다.`;
    return st + ' ' + b;
  }

  function legend(s, view) {
    if (s.phase === 'vacuum') return [{ gradient: ['#120a28', '#5a3aa0', '#ffe0ff'], from: '잔잔함', to: '크게 요동' }];
    if (s.phase === 'inflation') return [{ color: '#fff4e0', label: '급팽창의 섬광' }, { gradient: CMB_STOPS.map((c) => WS.rgb(c)), from: '옅은 곳', to: '빽빽한 곳' }];
    if (s.phase === 'plasma') {
      const g = { gradient: PLASMA_STOPS.map((c) => WS.rgb(c)), from: '아주 뜨거움', to: '식어 감' };
      return s.reached.bbn
        ? [g, { color: P_COL.H, label: '수소 원자핵 (양성자)' }, { color: P_COL.He, label: '헬륨 원자핵' }, { color: P_COL.e, label: '전자' }]
        : [g, { color: P_COL.p, label: '양성자' }, { color: P_COL.n, label: '중성자' }, { color: P_COL.e, label: '전자' }];
    }
    if (s.phase === 'recomb') return [{ gradient: CMB_STOPS.map((c) => WS.rgb(c)), from: '조금 옅음', to: '조금 빽빽함' }];
    const extra = [];
    if (s.bhs.length) extra.push({ color: C_BRASS, label: '원시 블랙홀' });
    if (s.reached.metal) extra.push({ color: C_LEAF, label: '생명 재료를 갖춘 별 (초록 고리)' });
    if (view === 1) return [{ gradient: DENS_STOPS.map((c) => WS.rgb(c)), from: '텅 빔', to: '빽빽함' }].concat(extra);
    if (view === 2) return [{ gradient: METAL_STOPS.map((c) => WS.rgb(c)), from: '무거운 원소 없음', to: '태양 수준 이상' }, { color: '#ffffff', label: '빛나는 별' }].concat(extra);
    return [
      { color: 'rgb(110,122,214)', label: '암흑 물질' },
      { color: 'rgb(120,170,240)', label: '가스 (보통 물질)' },
      { color: 'rgb(205,224,255)', label: '젊은 별' },
      { color: 'rgb(255,236,190)', label: '중년의 별' },
      { color: 'rgb(255,168,118)', label: '늙은 별' },
      { color: 'rgb(170,110,190)', label: '타 버린 별의 잔해' },
      { color: C_BRASS, label: '점선 원: 은하' },
    ].concat(extra);
  }

  function stats(s) {
    const k = s.k;
    if (s.phase === 'vacuum') return [['요동 횟수', String(s.pstep)], ['요동 세기', (s.fluct * 100).toFixed(0)], ['진공 불안정도', WS.trimNum(k.vac / 3) + '배'], ['결과', s.ended ? '빅뱅 없음' : '미정', s.ended ? 'warn' : '']];
    const H = s.phase === 'cosmos' ? s.H() / H0 : null; // 오늘의 팽창 속도(약 70 km/s/Mpc)를 1로
    const T = s.phase === 'cosmos' ? 2.725 / s.a : s.phase === 'recomb' ? recombT(s.t) : tempOf(s);
    return [
      ['우주 나이', s.phase === 'cosmos' ? WS.fmtYears(s.t) : WS.fmtSeconds(s.t * YR)],
      ['배경 온도', T > 1e5 ? '10' + WS.sup(Math.round(Math.log10(T))) + ' K' : fmtK(T)],
      ['우주의 크기', s.phase === 'cosmos' ? '오늘의 ' + fmtA(s.a) + '배' : '—'],
      ['팽창 속도', H === null ? '—' : H < 0 ? '수축하는 중' : '오늘의 ' + WS.trimNum(H) + '배', H !== null && H < 0 ? 'warn' : ''],
      ['빛나는 별', s.phase === 'cosmos' ? WS.fmtCount(s.stars * s.starUnit) + '개' : '—'],
      ['이 구역의 은하', s.galaxies + '개'],
      ['별 속 무거운 원소', s.stars ? '태양의 ' + (s.zMean * 100).toFixed(0) + '%' : '—'],
      ['생명 후보 별', s.cands ? WS.fmtCount(s.cands * s.starUnit * 0.1) + '개' : '0', s.cands ? 'good' : ''],
    ];
  }

  const constLabels = [
    ['G', '중력의 세기', '강하면 구조가 빨리 생기지만 별이 짧게 삽니다'],
    ['lam', '암흑 에너지(우주 상수)', '크면 물질이 뭉치기 전에 흩어지고, 음수면 결국 수축합니다'],
    ['om', '물질 밀도', '많으면 중력이 세져 구조가 빨리 자라고, 적으면 잘 뭉치지 않습니다'],
    ['Q', '초기 요동 세기', '작으면 구조가 안 생기고, 크면 모두 거대한 덩어리가 됩니다'],
    ['strong', '강한 핵력', '약하면 중수소가 불안정, 강하면 수소가 처음 몇 분에 타 버립니다'],
    ['alpha', '전자기력', '화학 결합과 가스 냉각을 좌우합니다'],
    ['vac', '진공 불안정도', '빅뱅(급팽창)이 촉발될 가능성'],
  ];

  const xfmt = (x) => (!isFinite(x) ? '빅뱅 전' : x >= 1 ? WS.fmtYears(x) : WS.fmtSeconds(x * YR));
  const mult = (v) => '×' + WS.trimNum(v);
  // 같은 씨앗 쌍둥이 우주의 닮음: 거친 격자(16×16)에서 물질 분포·별 분포의 상관 (0..1)
  function coarse(s, onlyStars) {
    const B = 16, g = new Float64Array(B * B);
    for (let n = 0; n < s.N; n++) {
      if (onlyStars && s.type[n] !== 2) continue;
      g[Math.min(B - 1, (s.py[n] * B) | 0) * B + Math.min(B - 1, (s.px[n] * B) | 0)]++;
    }
    return g;
  }
  function corr(a, b) {
    const n = a.length;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
    if (saa === 0 && sbb === 0) return 1;
    if (saa === 0 || sbb === 0) return 0;
    return sab / Math.sqrt(saa * sbb);
  }

  WS.registerMode({
    id: 'universe',
    name: '우주',
    when: '138억 년 전',
    question: '빅뱅은 일어날까? 별과 은하는 생길까?',
    desc: '거짓 진공에서 시작합니다. 급팽창이 일어나면 수소와 헬륨이 생기고, 중력이 물질을 모아 별과 은하를 만들지 지켜봅니다. 물리 상수를 무작위로 뽑으면 대부분의 우주가 어떻게 되는지 볼 수 있습니다. 계산을 위해 우주 전체가 아니라 작은 한 구역만 봅니다. 은하 수도 그 구역 안의 큰 덩어리 수입니다.',
    setup: [{ id: 'preset', label: '물리 상수', value: 'ours', options: [['ours', '우리 우주와 같게'], ['near', '우리 우주와 조금 다르게'], ['random', '완전히 무작위로']] }],
    views: ['별과 은하', '물질 밀도', '무거운 원소'],
    baseRate: 30,
    sampleEvery: 6,
    powerRegenSec: 5,
    create: (opts, seed) => new Universe(opts, seed),
    step,
    render,
    era,
    stats,
    narrate,
    legend,
    pick(s, x, y, W, H) {
      if (s.phase === 'vacuum') return { x: x / W, y: y / H };
      const { S, x0, y0 } = plate(W, H);
      const u = (x - x0) / S, v = (y - y0) / S;
      if (u < 0 || v < 0 || u > 1 || v > 1) return null;
      return { x: u, y: v };
    },
    inspect(s, w) {
      if (s.phase !== 'cosmos') return null;
      const MZ = s.MZ;
      const z = s.zgrid[Math.min(MZ - 1, Math.floor(w.y * MZ)) * MZ + Math.min(MZ - 1, Math.floor(w.x * MZ))];
      const d = smoothDens(s)[Math.min(SD - 1, Math.floor(w.y * SD)) * SD + Math.min(SD - 1, Math.floor(w.x * SD))];
      let st = 0;
      for (let n = 0; n < s.N; n++) {
        if (s.type[n] !== 2) continue;
        let dx = s.px[n] - w.x, dy = s.py[n] - w.y;
        dx -= Math.round(dx); dy -= Math.round(dy);
        if (dx * dx + dy * dy < 0.0016) st++;
      }
      return [d > 6 ? '물질이 뭉친 곳' : d < 0.4 ? '텅 빈 공간 (보이드)' : '이 영역', `물질 밀도: 우주 평균의 ${WS.trimNum(d)}배`, `무거운 원소: 태양의 ${WS.trimNum(z * 100)}%`, `근처의 빛나는 별: 약 ${WS.fmtCount(st * s.starUnit)}개`];
    },
    sample: (s) => ({ a: s.a || 0, stars: s.stars * s.starUnit, gal: s.galaxies, z: s.zMean * 100 }),
    chart: [
      { key: 'a', label: '우주의 크기', color: '#84c6d2', fmt: (v) => '오늘의 ' + (v < 0.1 ? v.toFixed(2) : fmtA(v)) + '배' },
      { key: 'stars', label: '빛나는 별', color: '#f1cb86', fmt: (v) => WS.fmtCount(v) },
      { key: 'gal', label: '이 구역의 은하', color: '#e46a4e', fmt: (v) => v + '개' },
      { key: 'z', label: '별 속 무거운 원소', color: '#96cf88', fmt: (v) => v.toFixed(0) + '%' },
    ],
    interventions: [
      {
        id: 'ripple', name: '양자 요동', icon: 'ripple', cost: 2, target: 'point',
        desc: '진공에서는 급팽창을 부추기고, 팽창하는 우주에서는 한 지점에 물질을 조금 더 모읍니다.',
        available: (s) => s.phase === 'vacuum' || s.phase === 'cosmos',
        apply(s, w) {
          if (s.phase === 'vacuum') { s.boost = 30; s.fluct = Math.min(1, s.fluct + 0.5); return '진공을 흔들어 요동을 키웠습니다'; }
          let moved = 0;
          for (let n = 0; n < s.N; n++) {
            let dx = s.px[n] - w.x, dy = s.py[n] - w.y;
            dx -= Math.round(dx); dy -= Math.round(dy);
            const d = Math.hypot(dx, dy);
            if (d < 0.07) { s.px[n] = (s.px[n] - dx * 0.35 + 1) % 1; s.py[n] = (s.py[n] - dy * 0.35 + 1) % 1; moved++; }
          }
          s.addFx({ type: 'ring', x: w.x, y: w.y, r: 0.07, r0: 30, life: 1.2, color: [132, 198, 210] });
          return `한 지점의 물질을 끌어모았습니다 (입자 ${moved}개)`;
        },
      },
      {
        id: 'hole', name: '원시 블랙홀', icon: 'hole', cost: 4, target: 'point',
        desc: '무거운 원시 블랙홀을 하나 심습니다. 주변 물질을 끌어당깁니다.',
        available: (s) => s.phase === 'cosmos' && s.bhs.length < 5,
        apply(s, w) { s.bhs.push({ x: w.x, y: w.y, m: 60 * s.N / 4096 }); return '원시 블랙홀이 생겨났습니다'; },
      },
      {
        id: 'nova', name: '초신성 촉발', icon: 'nova', cost: 2, target: 'point',
        desc: '근처의 별들을 일찍 폭발시켜 무거운 원소를 흩뿌립니다.',
        available: (s) => s.phase === 'cosmos' && s.stars > 0,
        apply(s, w) {
          let c = 0;
          for (let n = 0; n < s.N && c < 8; n++) {
            if (s.type[n] !== 2) continue;
            let dx = s.px[n] - w.x, dy = s.py[n] - w.y;
            dx -= Math.round(dx); dy -= Math.round(dy);
            if (Math.hypot(dx, dy) < 0.05) { s.type[n] = 3; s.stars--; s.sn++; s.enrich(s.px[n], s.py[n], 0.07); c++; s.addFx({ type: 'flash', x: s.px[n], y: s.py[n], r: 0.03, life: 1, color: [255, 220, 170] }); }
          }
          if (!c) return false;
          return `별 ${c}개를 초신성으로 터뜨렸습니다`;
        },
      },
      {
        id: 'butterfly', name: '나비의 날갯짓', icon: 'butterfly', cost: 1, target: 'global', labOnly: true,
        desc: '상상할 수 있는 가장 작은 변화입니다. 물질 입자 하나를 관측 구역 크기의 1천만분의 1만큼 옮깁니다 (빅뱅 전이라면 그 입자가 태어날 자리를 바꿔 둡니다). 이 모형의 중력은 물질을 부드럽게 끌어모으므로 이 차이는 거의 자라지 않고, 물질의 큰 구조(끈과 덩어리의 자리)도 그대로입니다. 하지만 어느 가스가 언제 별이 되는지는 모형이 그리지 못할 만큼 작은 소용돌이가 정하므로, 어떤 별이 태어나고 은하가 몇 개로 보이는지 같은 세부는 달라집니다.',
        apply(s) {
          const n = Math.floor(s.rng.next() * s.N);
          if (s.phase === 'cosmos') { s.px[n] = (s.px[n] + 1e-7) % 1; return '물질 입자 하나를 1천만분의 1만큼 옮겼습니다'; }
          if (s.psiX) { s.psiX[s.psiCell(n)] += 1e-7; return '초기 요동의 한 점을 1천만분의 1만큼 바꿨습니다'; }
          s.nudgeN = n;
          return '빅뱅 뒤 입자 하나의 자리가 1천만분의 1만큼 달라지도록 해 두었습니다';
        },
      },
    ],
    extra: {
      label: '물리 상수',
      render(s, el) {
        const k = s.k;
        const fmt = (key) => (key === 'om' ? WS.trimNum(k.om / 0.31) : WS.trimNum(k[key] / (key === 'vac' ? 3 : 1)));
        el.innerHTML = '<p class="note" style="margin:4px 0 8px">우리 우주를 1로 둔 상대값입니다.</p><div class="extra-list">' +
          constLabels.map(([key, name, tip]) => `<div class="sp" style="grid-template-columns:minmax(0,1fr) auto"><div><div class="nm">${name}</div><div class="tr">${tip}</div></div><div class="bm">× ${fmt(key)}</div></div>`).join('') +
          `<div class="sp" style="grid-template-columns:minmax(0,1fr) auto"><div><div class="nm">보통 물질(가스) 비율</div><div class="tr">별이 될 수 있는 물질의 몫. 나머지는 암흑 물질입니다</div></div><div class="bm">× ${WS.trimNum(s.fGas / 0.25)}</div></div></div>`;
      },
    },
    milestones: [
      { id: 'bang', name: '빅뱅 (급팽창)', real: 1e-6, realLabel: '0초' },
      { id: 'bbn', name: '수소·헬륨 원자핵 합성', real: 180 / YR, realLabel: '3분' },
      { id: 'recomb', name: '원자 형성 · 우주 배경 복사', real: 3.8e5, realLabel: '38만 년' },
      { id: 'firststar', name: '최초의 별', real: 1.8e8, realLabel: '약 1.8억 년' },
      { id: 'galaxy', name: '최초의 은하', real: 4e8, realLabel: '약 4억 년' },
      { id: 'metal', name: '무거운 원소를 품은 오래 사는 별', real: 2e9, realLabel: '약 20억 년' },
      { id: 'dark', name: '암흑 에너지 우세 (가속 팽창)', real: 9.8e9, realLabel: '약 98억 년' },
    ],
    realName: '우리 우주',
    compare: { min: 1e-6, max: 1e11, tf: (v) => Math.log10(Math.max(1e-6, v)), ticks: [[1e-4, '1시간'], [1, '1년'], [1e4, '1만 년'], [1e8, '1억 년'], [1e10, '100억 년']] },
    batch: {
      maxSteps: 3200,
      key: ['bang', 'firststar', 'galaxy', 'metal'],
      fmt: (v) => (v <= 1.01e-6 ? '0초' : v * YR < 3.156e7 ? WS.fmtSeconds(v * YR) : WS.fmtYears(v)),
      finish: (s) => { if (s.phase !== 'vacuum') s.finishByAge(); },
      desc: '같은 설정으로 씨앗만 바꾼 우주를 여러 번, 화면 없이 빠르게 돌립니다. "완전히 무작위로"를 고르면 물리 상수가 조금만 달라져도 별과 생명의 재료가 얼마나 드물어지는지 볼 수 있습니다.',
    },
    experiment: {
      clock: (s) => s.timeValue(),
      axis: 'log',
      span: (opts) => { const u = Number(opts && opts.until); return [1e6, u > 0 && isFinite(u) ? u : T_END]; },
      horizonOptions: () => [
        { value: 1e9, label: '10억 년 (첫 은하들)' },
        { value: 5e9, label: '50억 년' },
        { value: T_NOW, label: '138억 년 (오늘)', def: true },
        { value: T_END, label: '1000억 년 (먼 미래)' },
      ],
      setHorizon: (opts, x1) => { opts.until = x1; },
      xfmt,
      maxSteps: 4000,
      metrics: [
        { key: 'a', label: '우주의 크기 (오늘=1)', get: (s) => (s.phase === 'cosmos' ? s.a : NaN), log: true, scale: 0.1, fmt: fmtA, color: '#84c6d2' },
        { key: 'stars', label: '별이 된 보통 물질', get: (s) => (s.phase === 'cosmos' ? Math.max(0.1, (100 * s.stars) / (s.N * s.fGas)) : NaN), log: true, scale: 0.2, fmt: (v) => (v <= 0.1 ? '0%' : WS.trimNum(v) + '%'), color: '#f1cb86' },
        { key: 'gal', label: '관측 구역 안 은하 수', get: (s) => (s.phase === 'cosmos' ? Math.max(0.5, s.galaxies) : NaN), log: true, scale: 0.2, fmt: (v) => (v < 1 ? '0개' : Math.round(v) + '개'), color: '#e46a4e' },
        { key: 'z', label: '우주의 무거운 원소 (태양=100%)', get: (s) => (s.phase === 'cosmos' ? Math.max(0.1, s.zAvg() * 100) : NaN), log: true, scale: 0.2, fmt: (v) => (v <= 0.1 ? '0%' : WS.trimNum(v) + '%'), color: '#96cf88' },
      ],
      outcomes: [
        { key: 'nobang', label: '빅뱅 없음', color: '#5d6678', desc: '거짓 진공이 끝내 무너지지 않아 우주가 시작되지 않았습니다.' },
        { key: 'crunch', label: '빅 크런치', color: '#e46a4e', desc: '중력이 팽창을 이겨 우주가 다시 수축했습니다 (또는 수축하는 중입니다).' },
        { key: 'dilute', label: '별이 없는 우주', color: '#7a6fb0', desc: '팽창이 너무 빠르거나 요동이 너무 작아, 또는 핵융합이 불가능해 별이 하나도 빛나지 않았습니다.' },
        { key: 'nometal', label: '별은 있으나 재료 부족', color: '#d8a85b', desc: '별은 빛나지만, 무거운 원소를 품고 오래 사는 별(행성과 생명의 재료)은 아직 없습니다.' },
        { key: 'burnt', label: '생명의 별이 다 타 버림', color: '#a8775a', desc: '한때 무거운 원소를 품고 오래 사는 별이 있었지만, 별들이 빨리 타 버려 지금은 남아 있지 않습니다 (중력이 세면 별의 수명이 짧아집니다).' },
        { key: 'fertile', label: '생명이 가능한 우주', color: '#96cf88', desc: '무거운 원소를 품고 수십억 년 이상 사는 별이 지금도 빛나고 있어, 그 둘레에 행성과 생명이 생길 수 있습니다.' },
      ],
      classify,
      conditions: [
        { key: 'G', label: '중력의 세기', desc: '강하면 물질이 빨리 뭉치지만 별이 짧게 삽니다.', min: 0.25, max: 4, step: 0.05, def: 1, fmt: mult, kind: 'mult' },
        { key: 'lam', label: '암흑 에너지 (우주 상수)', desc: '크면 물질이 뭉치기 전에 흩어집니다. 음수면 끌어당기는 힘이 되어 결국 수축합니다.', min: -3, max: 200, step: 0.5, def: 1, fmt: (v) => (v < 0 ? `×${WS.trimNum(v)} (끌어당김)` : v === 0 ? '없음' : mult(v)), kind: 'mult' },
        { key: 'om', label: '물질의 양', desc: '많으면 중력이 세져 구조가 빨리 자라고, 적으면 물질이 잘 뭉치지 않습니다.', min: 0.2, max: 5, step: 0.05, def: 1, fmt: mult, kind: 'mult' },
        { key: 'Q', label: '처음 요동의 세기', desc: '작으면 구조가 생기지 않고, 크면 물질이 거대한 덩어리로 뭉칩니다.', min: 0.05, max: 20, step: 0.05, def: 1, fmt: mult, kind: 'mult' },
        { key: 'baryon', label: '보통 물질(가스)의 비율', desc: '별이 될 수 있는 물질의 몫입니다. 나머지는 빛나지 않는 암흑 물질입니다.', min: 0.2, max: 3, step: 0.05, def: 1, fmt: mult, kind: 'mult' },
        { key: 'strong', label: '강한 핵력', desc: '조금만 약해도 중수소가 무너져 별이 타지 못하고, 강하면 수소가 처음 몇 분 만에 타 버립니다.', min: 0.8, max: 1.2, step: 0.01, def: 1, fmt: mult, kind: 'mult' },
        { key: 'alpha', label: '전자기력의 세기', desc: '가스가 식는 속도와 화학 결합을 좌우합니다.', min: 0.4, max: 2.6, step: 0.02, def: 1, fmt: mult, kind: 'mult' },
        { key: 'vac', label: '진공 불안정도', desc: '낮으면 빅뱅이 일어나지 않을 수도 있습니다.', min: 0.03, max: 5, step: 0.01, def: 1, fmt: mult, kind: 'mult' },
      ],
      presets: [
        { label: '중력이 조금 센 우주', desc: '중력이 1.5배. 구조는 빨리 생기지만 별의 수명이 짧아집니다.', cond: { G: 1.5 } },
        { label: '요동이 작은 우주', desc: '처음의 밀도 요동이 지금의 30%. 물질이 뭉치기 어렵습니다.', cond: { Q: 0.3 } },
        { label: '암흑 에너지가 큰 우주', desc: '우주 상수가 100배. 은하가 다 자라기 전에 팽창이 가속되어 물질이 흩어집니다.', cond: { lam: 100 } },
        { label: '다시 무너지는 우주', desc: '우주 상수가 음수(-2배)라 서로 끌어당깁니다. 팽창이 멈추고 다시 수축합니다.', cond: { lam: -2 } },
        { label: '핵력이 조금 약한 우주', desc: '강한 핵력이 83%. 중수소가 버티지 못합니다.', cond: { strong: 0.83 } },
      ],
      schedulable: ['ripple', 'hole', 'nova', 'butterfly'],
      targets: [{ key: 'dense', label: '가장 밀집한 곳' }, { key: 'random', label: '무작위' }],
      target(s, key, rng) {
        if (key === 'random') return { x: rng.next(), y: rng.next() };
        if (s.phase === 'cosmos') {
          const e = extremes(smoothDens(s), SD);
          return { x: e.hx, y: e.hy };
        }
        if (s.cmb) { const e = extremes(s.cmb, s.NG); return { x: e.hx, y: e.hy }; }
        return { x: 0.5, y: 0.5 };
      },
      similarity(a, b) {
        if (a.phase !== 'cosmos' || b.phase !== 'cosmos') {
          if (a.phase === b.phase) return a.psiX && b.psiX ? WS.clamp(corr(a.psiX, b.psiX), 0, 1) : 1;
          return 0;
        }
        const m = WS.clamp(corr(coarse(a), coarse(b)), 0, 1);
        if (!a.stars && !b.stars) return m;
        return 0.5 * m + 0.5 * WS.clamp(corr(coarse(a, true), coarse(b, true)), 0, 1);
      },
      eventIds: ['firststar', 'galaxy', 'metal', 'dark'],
    },
    next(s) {
      // 지금 빛나는 '생명 재료를 갖춘 별'이 있을 때만 (빅 크런치·다 타 버린 우주에서는 내려갈 별이 없음)
      if (classify(s) !== 'fertile' || !s.best || s.type[s.best.n] !== 2) return null;
      return {
        label: '이 우주의 한 항성계로',
        mode: 'stellar',
        opts: { cloud: 'inherit' },
        inherit: { G: s.k.G, alpha: s.k.alpha, Z: Math.max(0.2, Math.min(2, s.best.Z)), age: s.t, from: 'universe' },
      };
    },
  });
})();
