'use strict';
/* 창세 관측소 — 생물 생김새 생성기: 유전체 → 몸 설계 → 2D 벡터 그림
   외부 에셋 대신 절차적으로 그린다. 진화가 만드는 끝없는 형질 조합을 표현하고, 자식이 부모를 닮게 하기 위해서다.
   genome/mutate/plan/describe 는 DOM 없이 동작한다(웹 워커·Node). draw/portrait 만 캔버스를 쓴다. */
(function () {
  const WS = (window.WS = window.WS || {});
  const PI = Math.PI, TAU = PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const fr = (v) => ((v % 1) + 1) % 1;
  const tri = (v) => 1 - Math.abs(2 * fr(v) - 1); // 색상환처럼 0과 1이 이어진 유전자를 구간에 매핑할 때 (경계에서 연속)
  const refl = (v) => { v = ((v % 2) + 2) % 2; return v > 1 ? 2 - v : v; };
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  /* ================= 유전체 ================= */
  // 연속 유전자 (0..1). hue·flower 는 색상환이라 0과 1이 이어진다.
  const CONT = ['hue', 'sat', 'lit', 'acc', 'patS', 'patA', 'len', 'wid', 'head', 'eyeS', 'limbL', 'bend', 'tail', 'fin', 'spike',
    'ant', 'neck', 'wing', 'round', 'flag', 'branch', 'bloom', 'flower'];
  const WRAP = { hue: 1, flower: 1 };
  // 정수 유전자: [이름, 최소, 최대, 세대당 변이 확률]
  //  pat 무늬(없음·점·줄·띠·고리점), eyeN 눈 유형(홀짝 = 거미 눈 6·8개, 맨 끝 두 값만 셋째 눈·네 눈),
  //  limb 팔다리 변형(4로 나눈 나머지 0 = 개구리, 맨 끝 값만 다리·팔 한 쌍 더), horn 뿔(없음·뿔·볏·등가시),
  //  armor 겉(맨살·비늘·골판·털·깃털·껍데기), mouth 입(거름·턱·부리·촉수·주둥이), seg 마디 수, leaf 잎 모양, form 같은 설계 안의 갈래
  //  eyeN·limb 은 범위를 넓게 잡아 '외계인 같은' 특징이 정말 드물게(각각 약 2%) 나오게 한다
  const INTS = [['pat', 0, 4, 0.035], ['eyeN', 1, 96, 0.02], ['limb', 0, 47, 0.025], ['horn', 0, 3, 0.03], ['armor', 0, 5, 0.03],
    ['mouth', 0, 4, 0.03], ['seg', 3, 12, 0.12], ['leaf', 0, 3, 0.03], ['form', 0, 11, 0.015]];
  const EYE3 = 95, EYE4 = 96, LIMB_EXTRA = 47;

  function genome(rng) {
    const g = {};
    for (const k of CONT) g[k] = r4(rng.next());
    for (const [k, a, b] of INTS) g[k] = rng.int(a, b);
    return g;
  }
  // 자식 유전체: 대부분 조금씩 흔들리고, 가끔 크게 뛴다. amount 2 = 큰 혁신(더 많이 바뀜)
  function mutate(g, rng, amount) {
    const m = Math.max(0, num(amount, 1));
    g = g || {};
    const c = {};
    for (const k of CONT) {
      let v = num(g[k], rng.next());
      v += rng.normal() * 0.03 * m;
      if (rng.chance(0.05 * m)) v += rng.normal() * 0.2;
      c[k] = r4(WRAP[k] ? fr(v) : refl(v));
    }
    for (const [k, a, b, p] of INTS) {
      let v = Math.round(num(g[k], rng.int(a, b)));
      if (rng.chance(p * m)) v = rng.chance(0.75) ? v + (rng.chance(0.5) ? 1 : -1) : rng.int(a, b);
      c[k] = clamp(v, a, b);
    }
    return c;
  }

  /* ================= 몸 설계 ================= */
  const PLANS = {
    chemo: { label: '화학합성 미생물', forms: ['공 모양 세균', '막대 모양 세균', '나선 모양 세균', '쉼표 모양 세균'] },
    photo: { label: '광합성 세균', forms: ['공 모양 세균', '막대 모양 세균', '나선 모양 세균', '쉼표 모양 세균'] },
    cyano: { label: '남세균', forms: ['구슬 사슬', '스트로마톨라이트 언덕', '젤리 덩어리 군체'] },
    bact: { label: '포식 세균', forms: ['먹이에 달라붙는 세균', '무리 지어 사냥하는 세균'] },
    alga: { label: '단세포 조류', forms: ['편모 두 개의 녹조', '유리 껍데기 규조', '공 모양 군체'] },
    protozoa: { label: '원생동물', forms: ['아메바', '짚신벌레형', '나팔벌레형'] },
    protopred: { label: '포식 원생생물', forms: ['태양충', '주둥이 섬모충', '뿔 달린 와편모충'] },
    seaweed: { label: '다세포 조류', forms: ['넓은 잎 해초', '부채꼴 홍조', '포도알 해초'] },
    moss: { label: '이끼류', forms: ['방석 이끼', '우산이끼', '바위 지의류'] },
    sponge: { label: '해면·산호류', forms: ['항아리 해면', '가지 산호', '관 해면 무리', '말미잘'] },
    jelly: { label: '해파리형 포식자', forms: ['해파리', '빗해파리', '고깔해파리'] },
    kelp: { label: '해조 숲', forms: ['거대 켈프', '공기주머니 켈프', '야자 모양 해조'] },
    plant: { label: '관다발 식물', forms: ['고사리', '활엽수', '침엽수·야자', '꽃 피는 풀'] },
    invert: { label: '바다 무척추동물', forms: ['삼엽충형', '가재형', '고둥형', '갯지렁이형'] },
    bug: { label: '육상 절지동물', forms: ['딱정벌레형', '노래기형', '날개 곤충', '쥐며느리형'] },
    seahunter: { label: '포식 무척추동물', forms: ['오징어형', '바다전갈형', '아노말로카리스형'] },
    arachnid: { label: '육상 포식 절지동물', forms: ['전갈형', '거미형', '지네형'] },
    fish: { label: '어류형 동물', forms: ['날렵한 물고기', '납작하고 높은 물고기', '뱀장어형', '갑옷 물고기'] },
    shark: { label: '포식 어류형 동물', forms: ['상어형', '갑주어형', '목 긴 바다 파충류형'] },
    grazer: { label: '초식 척추동물', forms: ['양서류형', '파충류형', '포유류형', '목 긴 초식동물'] },
    hunter: { label: '포식 척추동물', forms: ['네발 사냥꾼', '두 발 사냥꾼', '악어형', '맹금형'] },
    sapient: { label: '지성 종', forms: ['지성 종'] },
  };
  const T = (troph, cx, land, energy, ex) => Object.assign({ troph, cx, land, energy: energy || '', aerobic: cx > 0, intel: 0, manip: 0, social: 0, size: 0.1 + cx * 0.12, sapient: false }, ex || {});
  const SAMPLE = {
    chemo: T(0, 0, false, 'chemo'), photo: T(0, 0, false, 'photo'), cyano: T(0, 0, false, 'oxy'), bact: T(1, 0, false),
    alga: T(0, 1, false, 'oxy'), protozoa: T(1, 1, false), protopred: T(2, 1, false),
    seaweed: T(0, 2, false, 'oxy'), moss: T(0, 2, true, 'oxy'), sponge: T(1, 2, false), jelly: T(2, 2, false),
    kelp: T(0, 3, false, 'oxy'), plant: T(0, 3, true, 'oxy', { size: 0.4 }), invert: T(1, 3, false), bug: T(1, 3, true),
    seahunter: T(2, 3, false), arachnid: T(2, 3, true), fish: T(1, 4, false), shark: T(2, 4, false),
    // 예시 초식·포식 척추동물은 뭍에 오른 지 오래된 종(손재주 0.3) → 모든 갈래가 나온다 (갓 오른 종은 양서류·악어형 쪽)
    grazer: T(1, 4, true, '', { intel: 0.3, manip: 0.3, size: 0.5 }), hunter: T(2, 4, true, '', { intel: 0.45, manip: 0.3, size: 0.45 }),
    sapient: T(2, 4, true, '', { intel: 0.9, manip: 0.7, social: 0.65, sapient: true, size: 0.45 }),
  };
  for (const k in PLANS) PLANS[k].traits = SAMPLE[k];

  // traits → 몸 설계 키. traits = { troph, energy, cx, land, aerobic, intel, manip, social, size, sapient }
  function plan(tr) {
    tr = tr || {};
    if (tr.sapient) return 'sapient';
    const cx = clamp(Math.round(num(tr.cx, 0)), 0, 4), troph = clamp(Math.round(num(tr.troph, 0)), 0, 2), land = !!tr.land;
    if (troph === 0) {
      if (cx === 0) return tr.energy === 'photo' ? 'photo' : tr.energy === 'oxy' ? 'cyano' : 'chemo';
      if (cx === 1) return 'alga';
      if (cx === 2) return land ? 'moss' : 'seaweed';
      return land ? 'plant' : 'kelp';
    }
    if (cx === 0) return 'bact';
    if (cx === 1) return troph === 1 ? 'protozoa' : 'protopred';
    if (cx === 2) return troph === 1 ? 'sponge' : 'jelly';
    if (cx === 3) return troph === 1 ? (land ? 'bug' : 'invert') : (land ? 'arachnid' : 'seahunter');
    return troph === 1 ? (land ? 'grazer' : 'fish') : (land ? 'hunter' : 'shark');
  }
  /* 갈래(형태) 고르기
     form 유전자(0..11)는 '계통의 원형'이다. 몸 설계가 바뀌는 순간(뭍에 오름·척추가 생김·포식자가 됨)에도 같은 값이 이어지므로,
     설계마다 이어받을 때 그럴듯한 갈래로 짝을 지어 둔다. 바다 무척추 [삼엽충·가재·고둥·갯지렁이]를 기준으로
       → 육상 절지 [쥐며느리·날개 곤충·딱정벌레·노래기], 물고기 [갑옷·날렵한·높은·뱀장어],
       → 네발 초식 [파충류·포유류·목 긴·양서류], 네발 포식 [두 발·네발·맹금·악어] … 처럼 닮은 쪽으로 이어진다.
     표에 없는 설계는 form % 갈래 수. */
  const ARCH = {
    bug: [3, 2, 0, 1, 3, 2, 0, 1, 3, 2, 0, 1],
    seahunter: [1, 2, 0, 2, 1, 1, 0, 2, 1, 2, 0, 2],
    arachnid: [0, 1, 1, 2, 0, 1, 0, 2, 0, 1, 1, 2],
    fish: [3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2],
    shark: [1, 0, 0, 2, 1, 0, 2, 2, 1, 0, 0, 2],
    grazer: [1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0],
    hunter: [1, 0, 3, 2, 1, 0, 3, 2, 3, 0, 1, 2],
  };
  // 갓 뭍에 오른 척추동물은 양서류(포식자는 악어형)부터. 손재주(manip)는 뭍에서만 자라므로 '뭍에서 보낸 시간'의 눈금이 된다.
  // 계통마다 다른 시점에 제 갈래로 넘어가도록 원형마다 문턱을 다르게 둔다(LEAN_U). 11/12 계통은 양서류로 시작한다.
  const LEAN_U = [0.208, 0.625, 0.042, 0.458, 0.875, 0.292, 0.708, 0.125, 0.542, 0.958, 0.375, 0.792];
  const LEAN_MANIP = 0.08; // 처음 뭍에 오른 종(손재주 0)은 거의 양서류·악어형, 뭍에서 두세 번 갈라진 뒤(손재주 ~0.05–0.1)에는 원형대로 다양해진다
  const archOf = (g) => ((Math.round(num(g.form, 0)) % 12) + 12) % 12;
  // noLean: 지성 종의 조상 모습처럼 '오래된' 계통으로 볼 때
  function formFor(g, pk, tr, noLean) {
    const n = PLANS[pk].forms.length, f = archOf(g), A = ARCH[pk];
    let k = A ? A[f] : f % n;
    if (!noLean && (pk === 'grazer' || pk === 'hunter') && tr && !tr.sapient) {
      const lean = 0.92 * clamp(1 - num(tr.manip, 1) / LEAN_MANIP, 0, 1);
      if (LEAN_U[f] < lean) k = pk === 'grazer' ? 0 : 2;
    }
    return k;
  }
  // 지성 종의 조상 설계: 포식자(troph 2)면 네발 포식, 아니면 네발 초식
  const ancPlan = (tr) => (clamp(Math.round(num(tr && tr.troph, 2)), 0, 2) === 2 ? 'hunter' : 'grazer');
  // 큰 갈림길(개구리냐 도롱뇽이냐 등)은 드물게 바뀌는 정수 유전자로 정한다 — 연속 유전자의 문턱을 쓰면 세대마다 깜박인다
  const isFrog = (g) => g.limb % 4 === 0;
  const extraLimbs = (g) => g.limb === LIMB_EXTRA;
  const bit0 = (g) => (g.leaf & 1) === 1;
  const bit1 = (g) => (g.leaf & 2) === 2;
  const caudalType = (g) => [0, 1, 2, 1][g.leaf & 3];
  // 척추동물 눈: 대개 2개, 아주 드물게 셋째 눈(정수리 눈)이나 네 눈
  const eyeCount = (g) => (g.eyeN === EYE3 ? 3 : g.eyeN === EYE4 ? 4 : 2);

  /* ================= 색 ================= */
  const hsl = (h, s, l, a) => 'hsla(' + fr(h / 360) * 360 + ',' + clamp(s, 0, 1) * 100 + '%,' + clamp(l, 0, 1) * 100 + '%,' + (a == null ? 1 : a) + ')';
  const css = (c, dl, ds, a) => hsl(c[0], c[1] + (ds || 0), c[2] + (dl || 0), a);
  function hslRgb(h, s, l) {
    h = fr(h / 360);
    const f = (n) => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    return [f(0), f(8), f(4)];
  }
  const IRIS = [[38, 0.85, 0.55], [52, 0.8, 0.52], [10, 0.75, 0.48], [95, 0.55, 0.45], [200, 0.55, 0.5], [26, 0.55, 0.36]];

  // 몸 설계마다 그럴듯한 색 범위로 매핑 (같은 유전자 → 같은 집안 색)
  function baseColor(g, pk) {
    const tr0 = tri(g.hue);
    let h = g.hue * 360, s = 0.2 + 0.6 * Math.pow(g.sat, 1.15), l = 0.36 + 0.24 * g.lit;
    switch (pk) {
      case 'chemo': h = 14 + tr0 * 36; s = 0.5 + 0.35 * g.sat; l = 0.5 + 0.1 * g.lit; break;
      case 'photo': h = 282 + tr0 * 56; s = 0.42 + 0.35 * g.sat; l = 0.5 + 0.1 * g.lit; break;
      case 'cyano': h = 150 + tr0 * 40; s = 0.42 + 0.3 * g.sat; l = 0.4 + 0.1 * g.lit; break;
      case 'bact': h = 48 + tr0 * 60; s = 0.45 + 0.35 * g.sat; l = 0.5 + 0.1 * g.lit; break;
      case 'alga': h = 88 + tr0 * 52; s = 0.45 + 0.3 * g.sat; l = 0.42 + 0.1 * g.lit; break;
      case 'protozoa': case 'protopred': s = 0.3 + 0.35 * g.sat; l = 0.6 + 0.12 * g.lit; break;
      case 'seaweed': h = tr0 < 0.55 ? 78 + (tr0 / 0.55) * 70 : 340 + ((tr0 - 0.55) / 0.45) * 45; s = 0.42 + 0.3 * g.sat; l = 0.38 + 0.12 * g.lit; break;
      case 'moss': h = 72 + tr0 * 52; s = 0.45 + 0.3 * g.sat; l = 0.34 + 0.12 * g.lit; break;
      case 'kelp': h = 30 + tr0 * 48; s = 0.45 + 0.3 * g.sat; l = 0.32 + 0.12 * g.lit; break;
      case 'plant': h = 80 + tr0 * 66; s = 0.38 + 0.3 * g.sat; l = 0.32 + 0.12 * g.lit; break;
      case 'sponge': s = 0.5 + 0.35 * g.sat; l = 0.5 + 0.12 * g.lit; break;
      case 'jelly': s = 0.55 + 0.35 * g.sat; l = 0.6 + 0.1 * g.lit; break;
      case 'shark': s *= 0.42; l = 0.42 + 0.18 * g.lit; break;
      case 'grazer': case 'hunter': case 'sapient': s = 0.16 + 0.5 * Math.pow(g.sat, 1.4) + (g.sat > 0.88 ? 0.18 : 0); l = 0.36 + 0.22 * g.lit; break;
    }
    return [h, s, l];
  }
  function setColors(P, c) {
    const g = P.g, h = c[0], s = c[1], l = c[2];
    P.c = c;
    P.fill = css(c);
    P.line = hsl(h, s * 0.7, l * 0.3, 0.95);
    P.light = css(c, 0.14);
    P.dark = css(c, -0.12);
    P.far = hsl(h, s * 0.85, l * 0.78);
    P.belly = hsl(h, s * 0.45, Math.min(0.9, l + 0.26));
    const ah = P.pk === 'plant' || P.pk === 'moss' ? g.flower * 360 : h + (g.acc - 0.5) * 320;
    const al = clamp(l + (g.acc > 0.5 ? 0.17 : -0.17), 0.12, 0.86);
    P.a = [ah, clamp(s + 0.12, 0, 1), al];
    P.acc = css(P.a);
    P.accLine = hsl(ah, P.a[1] * 0.75, al * 0.35, 0.95);
    P.patCol = css(P.a, 0, 0, 0.4 + 0.55 * g.patA);
    const ir = IRIS[Math.min(5, Math.floor(g.acc * 6))];
    P.iris = hsl(ir[0], ir[1], ir[2]);
  }
  function prep(g, tr, pk) {
    const P = {
      g, tr, pk, form: formFor(g, pk, tr),
      sz: clamp(num(tr.size, 0.4), 0, 1), intel: clamp(num(tr.intel, 0), 0, 1), manip: clamp(num(tr.manip, 0), 0, 1), social: clamp(num(tr.social, 0), 0, 1),
      salt: (Math.floor(num(g.hue, 0) * 9973) * 31 + Math.floor(num(g.patS, 0) * 7919) * 17 + Math.floor(num(g.len, 0) * 6271)) | 0,
    };
    setColors(P, baseColor(g, pk));
    return P;
  }
  // 그림과 같은 규칙으로 고른 '대표 색' (지도·범례용) → [r,g,b]
  function color(g, tr) {
    g = full(g); tr = tr || {};
    const pk = plan(tr);
    let c = baseColor(g, pk);
    if (pk === 'grazer' || pk === 'hunter' || pk === 'sapient') c = furTone(g, c, coverOf(g, pk, tr));
    return hslRgb(c[0], c[1], c[2]);
  }
  // 털은 흙빛 쪽으로 (아주 진한 유전자만 화려한 털)
  function furTone(g, c, cover) {
    if (cover !== 'fur' || g.sat > 0.86) return c;
    const t0 = tri(g.hue);
    return t0 > 0.85 ? [215, 0.1, c[2]] : [16 + t0 * 30, 0.22 + 0.42 * g.sat, 0.3 + 0.28 * g.lit];
  }

  /* ================= 그리기 기반 ================= */
  // R: 현재 그리기 상태. px = 모형 1단위가 몇 화면 픽셀인지, lw = 윤곽선 두께(모형 단위), lod 0 작게 · 1 중간 · 2 크게
  const R = { px: 1, lw: 0.02, lwPx: 1.2, lod: 2, t: 0, outline: true };
  const PX = (n) => n / R.px;
  function fit(ctx, x0, y0, x1, y1, m) {
    m = m || 0.92;
    const s = Math.min((2 * m) / Math.max(1e-3, x1 - x0), (2 * m) / Math.max(1e-3, y1 - y0));
    ctx.scale(s, s);
    ctx.translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    R.px *= s;
    R.lw = R.lwPx / R.px;
  }
  function BB() { return [1e9, 1e9, -1e9, -1e9]; }
  function bbAdd(b, x, y, r) { r = r || 0; if (x - r < b[0]) b[0] = x - r; if (y - r < b[1]) b[1] = y - r; if (x + r > b[2]) b[2] = x + r; if (y + r > b[3]) b[3] = y + r; }
  function bbPts(b, pts, r) { for (const p of pts) bbAdd(b, p[0], p[1], r); }

  // 정수 해시 → 0..1 (무늬 위치 같은 시각 전용 값. 시뮬레이션 난수는 쓰지 않는다)
  function hr(i, s) {
    let h = Math.imul((i + 1) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((s | 0) + 0x632be5ab, 0xc2b2ae35);
    h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2d); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  // Catmull-Rom 곡선을 베지어로: 점들을 부드럽게 잇는다
  function smooth(p, pts, closed) {
    const n = pts.length;
    if (n < 2) return p;
    p.moveTo(pts[0][0], pts[0][1]);
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const p0 = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[closed ? (i + 2) % n : Math.min(n - 1, i + 2)];
      p.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
    }
    if (closed) p.closePath();
    return p;
  }
  const spath = (pts, open) => smooth(new Path2D(), pts, !open);
  function lpath(pts, closed) {
    const p = new Path2D();
    p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
    if (closed) p.closePath();
    return p;
  }
  function ell(x, y, rx, ry, rot) { const p = new Path2D(); p.ellipse(x, y, Math.max(1e-4, rx), Math.max(1e-4, ry), rot || 0, 0, TAU); return p; }
  const circ = (x, y, r) => ell(x, y, r, r);
  // 둥근 막대(캡슐)
  function capsule(cx, cy, len, w, ang) {
    const p = new Path2D(), c = Math.cos(ang), s = Math.sin(ang), h = Math.max(0, len / 2 - w);
    p.arc(cx + c * h, cy + s * h, w, ang - PI / 2, ang + PI / 2);
    p.arc(cx - c * h, cy - s * h, w, ang + PI / 2, ang + PI * 1.5);
    p.closePath();
    return p;
  }

  // 축(spine) + 위/아래 폭 → 몸 윤곽 점들 (시계 방향: 윗선 꼬리→머리, 아랫선 머리→꼬리)
  function tube(S, capA, capB) {
    const pts = S.pts, n = pts.length, top = [], bot = [];
    const tan = (i) => {
      const a = pts[i > 0 ? i - 1 : 0], b = pts[i < n - 1 ? i + 1 : n - 1];
      const tx = b[0] - a[0], ty = b[1] - a[1], d = Math.hypot(tx, ty) || 1;
      return [tx / d, ty / d];
    };
    for (let i = 0; i < n; i++) {
      const [tx, ty] = tan(i);
      top.push([pts[i][0] + ty * S.wt[i], pts[i][1] - tx * S.wt[i]]);
      bot.push([pts[i][0] - ty * S.wb[i], pts[i][1] + tx * S.wb[i]]);
    }
    const out = top;
    if (capB) { const [tx, ty] = tan(n - 1), w = (S.wt[n - 1] + S.wb[n - 1]) / 2, p = pts[n - 1]; out.push([p[0] + tx * w * capB, p[1] + ty * w * capB + (S.wb[n - 1] - S.wt[n - 1]) / 2]); }
    for (let i = n - 1; i >= 0; i--) out.push(bot[i]);
    if (capA) { const [tx, ty] = tan(0), w = (S.wt[0] + S.wb[0]) / 2, p = pts[0]; out.push([p[0] - tx * w * capA, p[1] - ty * w * capA]); }
    return out;
  }
  // 닫힌 Catmull-Rom 곡선을 촘촘히 샘플링 (털·깃털 가장자리용)
  function dens(pts, k) {
    const n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      for (let j = 0; j < k; j++) {
        const t = j / k, t2 = t * t, t3 = t2 * t;
        out.push([
          0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
        ]);
      }
    }
    return out;
  }
  // 바깥쪽으로 번갈아 튀어나온 털 뭉치 (시계 방향 윤곽 기준)
  function fuzz(pts, amp, salt) {
    const n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      if (i % 2) {
        const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1, k = amp * (0.55 + 0.9 * hr(i, salt));
        out.push([p[0] + (dy / d) * k, p[1] - (dx / d) * k]);
      } else out.push(p);
    }
    return out;
  }

  // 축을 따라 위치 s(길이)의 점·법선·폭
  function spineOf(pts, wt, wb) {
    const L = [0];
    for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, wt, wb, L, len: L[L.length - 1] || 1e-6 };
  }
  function spineAt(S, s) {
    const L = S.L, n = L.length;
    let i = 1;
    while (i < n - 1 && L[i] < s) i++;
    const a = S.pts[i - 1], b = S.pts[i], seg = L[i] - L[i - 1] || 1e-6, u = clamp((s - L[i - 1]) / seg, 0, 1);
    const tx = (b[0] - a[0]) / seg, ty = (b[1] - a[1]) / seg;
    return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), ty, -tx, lerp(S.wt[i - 1], S.wt[i], u), lerp(S.wb[i - 1], S.wb[i], u), tx, ty];
  }

  // 몸 한 덩어리 칠하기: 바탕 → 무늬(몸 안으로 잘라서) → 위는 밝고 아래는 어두운 음영 → 윤곽선
  function skin(ctx, p, fill, line, y0, y1, pat, k) {
    ctx.fillStyle = fill;
    ctx.fill(p);
    if (pat) { ctx.save(); ctx.clip(p); pat(ctx); ctx.restore(); }
    if (y1 > y0) {
      k = k == null ? 1 : k;
      const gr = ctx.createLinearGradient(0, y0, 0, y1);
      gr.addColorStop(0, 'rgba(255,255,255,' + 0.3 * k + ')');
      gr.addColorStop(0.42, 'rgba(255,255,255,0)');
      gr.addColorStop(0.6, 'rgba(0,0,0,0)');
      gr.addColorStop(1, 'rgba(0,0,0,' + 0.32 * k + ')');
      ctx.fillStyle = gr;
      ctx.fill(p);
    }
    if (R.outline && line) { ctx.lineWidth = R.lw; ctx.strokeStyle = line; ctx.stroke(p); }
  }
  // 둥근 덩어리(위에서 본 몸, 세포): 왼쪽 위 하이라이트 + 가장자리 어둡게
  function skinR(ctx, p, fill, line, cx, cy, r, pat, k) {
    ctx.fillStyle = fill;
    ctx.fill(p);
    if (pat) { ctx.save(); ctx.clip(p); pat(ctx); ctx.restore(); }
    k = k == null ? 1 : k;
    const gr = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r * 1.15);
    gr.addColorStop(0, 'rgba(255,255,255,' + 0.38 * k + ')');
    gr.addColorStop(0.45, 'rgba(255,255,255,0)');
    gr.addColorStop(0.75, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(0,0,0,' + 0.35 * k + ')');
    ctx.fillStyle = gr;
    ctx.fill(p);
    if (R.outline && line) { ctx.lineWidth = R.lw; ctx.strokeStyle = line; ctx.stroke(p); }
  }
  function outline(ctx, p, line, w) { if (!R.outline) return; ctx.lineWidth = R.lw * (w || 1); ctx.strokeStyle = line; ctx.stroke(p); }
  function strokeP(ctx, p, col, wPx) { ctx.lineWidth = Math.max(PX(0.7), wPx); ctx.strokeStyle = col; ctx.stroke(p); }
  // 다리·더듬이 같은 가는 부속지: 진한 윤곽선 위에 몸색 선을 겹쳐 그린다
  function limb(ctx, pts, w, fill, line, curved) {
    const p = curved ? spath(pts, true) : lpath(pts);
    if (R.outline) { ctx.lineWidth = w + 2 * R.lw; ctx.strokeStyle = line; ctx.stroke(p); }
    ctx.lineWidth = w; ctx.strokeStyle = fill; ctx.stroke(p);
  }
  function dot(ctx, x, y, r, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, Math.max(1e-4, r), 0, TAU); ctx.fill(); }
  function shadow(ctx, x, y, rx, ry) {
    const gr = ctx.createRadialGradient(x, y, 0, x, y, rx);
    gr.addColorStop(0, 'rgba(0,0,0,.32)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(x, y); ctx.scale(1, ry / rx); ctx.translate(-x, -y);
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(x, y, rx, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function glow(ctx, x, y, r, col, a) {
    const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, col.replace(/[\d.]+\)$/, a + ')'));
    gr.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  // 눈: 흰자 · 홍채 · 동공 · 반짝임. 아주 작으면 반짝이는 점 하나로
  function eye(ctx, x, y, r, P, kind) {
    const rp = r * R.px;
    if (rp < 1.4) { dot(ctx, x, y, Math.max(r, PX(0.75)), '#0c0c12'); return; }
    if (kind === 'bead' || rp < 2.6) {
      dot(ctx, x, y, r, '#101016');
      if (rp > 1.8) dot(ctx, x - r * 0.32, y - r * 0.34, r * 0.32, 'rgba(255,255,255,.9)');
      return;
    }
    if (kind === 'compound') {
      const p = circ(x, y, r);
      ctx.fillStyle = '#16141c'; ctx.fill(p);
      const gr = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, 0, x, y, r);
      gr.addColorStop(0, 'rgba(160,200,255,.55)'); gr.addColorStop(0.5, 'rgba(90,110,160,.15)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr; ctx.fill(p);
      if (rp > 5) {
        ctx.strokeStyle = 'rgba(200,220,255,.18)'; ctx.lineWidth = PX(0.6);
        ctx.beginPath();
        for (let i = -2; i <= 2; i++) { ctx.moveTo(x + i * r * 0.36, y - r); ctx.lineTo(x + i * r * 0.36, y + r); ctx.moveTo(x - r, y + i * r * 0.36); ctx.lineTo(x + r, y + i * r * 0.36); }
        ctx.save(); ctx.clip(p); ctx.stroke(); ctx.restore();
      }
      dot(ctx, x - r * 0.35, y - r * 0.38, r * 0.26, 'rgba(255,255,255,.85)');
      return;
    }
    const p = circ(x, y, r);
    ctx.fillStyle = '#f3efe4'; ctx.fill(p);
    dot(ctx, x + r * 0.12, y, r * 0.7, P.iris);
    if (kind === 'slit') { ctx.fillStyle = '#0b0b10'; ctx.fill(ell(x + r * 0.12, y, r * 0.16, r * 0.6)); }
    else if (kind === 'bar') { ctx.fillStyle = '#0b0b10'; ctx.fill(ell(x + r * 0.12, y, r * 0.5, r * 0.2)); }
    else dot(ctx, x + r * 0.16, y, r * 0.4, '#0b0b10');
    dot(ctx, x - r * 0.18, y - r * 0.32, r * 0.25, 'rgba(255,255,255,.95)');
    if (R.outline) { ctx.lineWidth = R.lw * 0.85; ctx.strokeStyle = P.line; ctx.stroke(p); }
  }
  // 편모·섬모 같은 물결선
  function wavy(x, y, ang, L, amp, waves, ph) {
    const p = new Path2D(), n = 16, c = Math.cos(ang), s = Math.sin(ang);
    for (let i = 0; i <= n; i++) {
      const u = i / n, off = Math.sin(u * TAU * waves - R.t * 9 + ph) * amp * Math.min(1, u * 4);
      const px = x + c * u * L - s * off, py = y + s * u * L + c * off;
      if (i) p.lineTo(px, py); else p.moveTo(px, py);
    }
    return p;
  }

  // 무늬: 축을 따라 (줄무늬는 축에 수직, 점무늬는 몸 폭 안에)
  function spinePat(ctx, S, P, a, b, k) {
    const g = P.g, type = g.pat;
    if (!type) return;
    k = k || 1;
    const s0 = S.len * a, s1 = S.len * b, span = s1 - s0;
    ctx.fillStyle = P.patCol;
    if (type === 1 || type === 4) {
      const n = Math.round(((R.lod ? 8 : 5) + g.patS * (R.lod ? 16 : 6)) * k);
      if (type === 4) { ctx.strokeStyle = P.patCol; ctx.lineCap = 'round'; }
      for (let i = 0; i < n; i++) {
        const q = spineAt(S, lerp(s0, s1, hr(i, P.salt))), v = hr(i, P.salt + 7) * 2 - 1;
        const w = v > 0 ? q[4] : q[5], x = q[0] + q[2] * v * w * 0.8, y = q[1] + q[3] * v * w * 0.8;
        const r = Math.max(q[4], q[5]) * (0.15 + 0.14 * hr(i, P.salt + 3)) * (1.35 - 0.7 * g.patS);
        if (type === 1) dot(ctx, x, y, r, P.patCol);
        else {
          ctx.lineWidth = r * 0.5;
          ctx.beginPath();
          for (let j = 0; j < 4; j++) { const a0 = j * 1.57 + 0.3; ctx.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r); ctx.arc(x, y, r, a0, a0 + 1); }
          ctx.stroke();
        }
      }
    } else if (type === 2) {
      const n = Math.round((4 + g.patS * 9) * k);
      for (let i = 0; i < n; i++) {
        const q = spineAt(S, lerp(s0, s1, (i + 0.5) / n)), hw = (span / n) * 0.2 * (0.8 + 0.5 * hr(i, P.salt));
        const ux = q[2], uy = q[3], tx = q[6], ty = q[7], top = q[4] * 1.3, bot = q[5] * (0.15 + 0.5 * hr(i, P.salt + 1));
        ctx.beginPath();
        ctx.moveTo(q[0] + ux * top - tx * hw, q[1] + uy * top - ty * hw);
        ctx.lineTo(q[0] + ux * top + tx * hw, q[1] + uy * top + ty * hw);
        ctx.lineTo(q[0] - ux * bot + tx * hw * 0.25, q[1] - uy * bot + ty * hw * 0.25);
        ctx.lineTo(q[0] - ux * bot - tx * hw * 0.25, q[1] - uy * bot - ty * hw * 0.25);
        ctx.fill();
      }
    } else if (type === 3) {
      const n = 2 + Math.round(g.patS * 3);
      for (let i = 0; i < n; i++) {
        const q = spineAt(S, lerp(s0, s1, (i + 0.5) / n)), hw = (span / n) * 0.22, ux = q[2], uy = q[3], tx = q[6], ty = q[7], top = q[4] * 1.4, bot = q[5] * 1.4;
        ctx.beginPath();
        ctx.moveTo(q[0] + ux * top - tx * hw, q[1] + uy * top - ty * hw);
        ctx.lineTo(q[0] + ux * top + tx * hw, q[1] + uy * top + ty * hw);
        ctx.lineTo(q[0] - ux * bot + tx * hw, q[1] - uy * bot + ty * hw);
        ctx.lineTo(q[0] - ux * bot - tx * hw, q[1] - uy * bot - ty * hw);
        ctx.fill();
      }
    }
  }
  // 무늬: 사각 영역 (위에서 본 몸, 껍데기 등)
  function boxPat(ctx, x0, y0, x1, y1, P, k, rs) {
    const g = P.g, type = g.pat, w = x1 - x0, h = y1 - y0;
    rs = rs || 1;
    if (!type) return;
    k = k || 1;
    ctx.fillStyle = P.patCol;
    if (type === 1 || type === 4) {
      const n = Math.round(((R.lod ? 7 : 4) + g.patS * (R.lod ? 14 : 5)) * k);
      if (type === 4) ctx.strokeStyle = P.patCol;
      for (let i = 0; i < n; i++) {
        const x = x0 + w * (0.08 + 0.84 * hr(i, P.salt)), y = y0 + h * (0.1 + 0.8 * hr(i, P.salt + 5)), r = Math.min(w, h) * (0.07 + 0.06 * hr(i, P.salt + 9)) * (1.4 - 0.7 * g.patS) * rs;
        if (type === 1) dot(ctx, x, y, r, P.patCol);
        else { ctx.lineWidth = r * 0.5; ctx.beginPath(); for (let j = 0; j < 4; j++) { const a0 = j * 1.57 + 0.3; ctx.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r); ctx.arc(x, y, r, a0, a0 + 1); } ctx.stroke(); }
      }
    } else if (type === 2) {
      const n = Math.round((4 + g.patS * 8) * k), sw = (w / n) * 0.36;
      for (let i = 0; i < n; i++) { const x = x0 + (w * (i + 0.5)) / n; ctx.fillRect(x - sw / 2, y0, sw, h); }
    } else if (type === 3) {
      const n = 2 + Math.round(g.patS * 2), sw = (w / n) * 0.42;
      for (let i = 0; i < n; i++) { const x = x0 + (w * (i + 0.5)) / n; ctx.fillRect(x - sw / 2, y0, sw, h); }
    }
  }
  // 아랫배를 밝게 (반대 음영: 대부분의 동물이 그렇다)
  function bellyShade(ctx, p, P, y0, y1, a) {
    ctx.save();
    ctx.clip(p);
    const gr = ctx.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, P.belly.replace(/[\d.]+\)$/, '0)'));
    gr.addColorStop(1, P.belly.replace(/[\d.]+\)$/, (a || 0.75) + ')'));
    ctx.fillStyle = gr;
    ctx.fillRect(-9, y0, 18, y1 - y0 + 9);
    ctx.restore();
  }

  /* ================= 미생물 (원핵생물) ================= */
  function halo(ctx, x, y, rx, ry, col, a) {
    ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx);
    glow(ctx, 0, 0, rx, col, a);
    ctx.restore();
  }
  // 세포 속: DNA 뭉치(구불선)와 알갱이. 광합성 세균은 막 주름, 화학합성 세균은 황 알갱이
  function proInner(ctx, p, P, x, y, len, w, ang, i) {
    if (!R.lod) return;
    ctx.save(); ctx.clip(p);
    const c = Math.cos(ang), s = Math.sin(ang), at = (u, v) => [x + c * u - s * v, y + s * u + c * v];
    if (P.pk === 'photo') {
      ctx.strokeStyle = css(P.c, -0.18, 0, 0.45); ctx.lineWidth = Math.max(PX(0.8), w * 0.09);
      ctx.beginPath();
      for (const v of [-0.55, 0.55]) { const a = at(-len * 0.38, v * w), b = at(len * 0.38, v * w); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      ctx.stroke();
    }
    const q = new Path2D(), n = 9, L = len * 0.5;
    for (let k = 0; k <= n; k++) { const pt = at((k / n - 0.5) * L, Math.sin(k * 1.9 + i) * w * 0.25); if (k) q.lineTo(pt[0], pt[1]); else q.moveTo(pt[0], pt[1]); }
    strokeP(ctx, q, css(P.c, -0.22, 0, 0.5), Math.max(PX(0.9), w * 0.12));
    for (let k = 0; k < 3; k++) {
      const pt = at((hr(k + i * 7, P.salt) - 0.5) * len * 0.62, (hr(k + i * 7, P.salt + 2) - 0.5) * w * 0.9);
      const r = w * (0.12 + 0.08 * hr(k, P.salt + 4));
      if (P.pk === 'chemo') { dot(ctx, pt[0], pt[1], r, 'rgba(250,236,150,.85)'); dot(ctx, pt[0] - r * 0.3, pt[1] - r * 0.3, r * 0.35, 'rgba(255,255,255,.8)'); }
      else dot(ctx, pt[0], pt[1], r * 0.8, css(P.c, -0.2, 0, 0.45));
    }
    ctx.restore();
  }
  function flagW(w) { return Math.max(PX(0.8), w * 0.13); }
  function rod(ctx, x, y, len, w, ang, P, i, flag) {
    const g = P.g, c = Math.cos(ang), s = Math.sin(ang);
    if (flag && g.flag > 0.3) {
      if (g.flag > 0.72 && R.lod) {
        for (let k = 0; k < 6; k++) {
          const u = (k / 5 - 0.5) * len * 0.75, side = k % 2 ? 1 : -1;
          strokeP(ctx, wavy(x + c * u - s * w * side * 0.9, y + s * u + c * w * side * 0.9, ang + PI - side * 0.9, len * 0.5, w * 0.22, 1.6, k), P.line, flagW(w));
        }
      } else strokeP(ctx, wavy(x - (c * len) / 2, y - (s * len) / 2, ang + PI, len * (0.8 + 0.6 * g.flag), w * 0.35, 2.2, i), P.line, flagW(w));
    }
    const p = capsule(x, y, len, w, ang);
    skinR(ctx, p, P.fill, P.line, x, y, len * 0.55);
    proInner(ctx, p, P, x, y, len, w, ang, i);
  }
  function coccus(ctx, x, y, r, P, i) {
    const p = circ(x, y, r);
    skinR(ctx, p, P.fill, P.line, x, y, r);
    proInner(ctx, p, P, x, y, r * 1.5, r * 0.75, i * 0.9, i);
    if (R.lod && i % 3 === 1) { // 막 분열 중인 세포: 가운데 칸막이
      const a = i * 0.9 + PI / 2, q = new Path2D();
      q.moveTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92); q.lineTo(x - Math.cos(a) * r * 0.92, y - Math.sin(a) * r * 0.92);
      strokeP(ctx, q, css(P.c, -0.2, 0, 0.5), R.lw * 0.8);
    }
  }
  function spiro(ctx, x, y, L, w, ang, P, i) {
    const n = 18, pts = [], A = 0.11 + 0.06 * P.g.round, lam = 0.4, c = Math.cos(ang), s = Math.sin(ang);
    for (let k = 0; k < n; k++) { const u = (k / (n - 1) - 0.5) * L, off = Math.sin((u / lam) * TAU + R.t * 3 + i) * A; pts.push([x + c * u - s * off, y + s * u + c * off]); }
    if (P.g.flag > 0.3) for (const e of [0, n - 1]) {
      const a = pts[e], b = pts[e ? e - 1 : 1], d = Math.atan2(a[1] - b[1], a[0] - b[0]);
      for (let k = -1; k <= 1; k += R.lod ? 1 : 2) strokeP(ctx, wavy(a[0], a[1], d + k * 0.35, L * 0.28, w * 0.25, 1.5, k + e), P.line, flagW(w));
    }
    // 나선은 굵은 선으로 그린다 (윤곽 다각형으로 만들면 굽은 곳에서 꼬인다)
    const p = spath(pts, true);
    if (R.outline) { ctx.lineWidth = 2 * w + 2 * R.lw; ctx.strokeStyle = P.line; ctx.stroke(p); }
    ctx.lineWidth = 2 * w; ctx.strokeStyle = P.fill; ctx.stroke(p);
    ctx.lineWidth = w * 0.55; ctx.strokeStyle = css(P.c, 0.16, 0, 0.55); ctx.stroke(spath(pts.map(([px, py]) => [px - w * 0.1, py - w * 0.42]), true));
    if (R.lod) for (let k = 2; k < n - 2; k += 3) dot(ctx, pts[k][0], pts[k][1] + w * 0.2, w * 0.25, css(P.c, -0.2, 0, 0.45));
  }
  function commaGeo(x, y, L, w, ang) {
    const n = 9, rho = L * 0.8, span = L / rho, pts = [], c = Math.cos(ang), s = Math.sin(ang), wt = [];
    for (let k = 0; k < n; k++) {
      const a = -PI / 2 + (k / (n - 1) - 0.5) * span, u = Math.cos(a) * rho, v = Math.sin(a) * rho + rho;
      pts.push([x + c * u - s * v, y + s * u + c * v]);
      wt.push(w * (0.75 + 0.25 * Math.sin((PI * k) / (n - 1))));
    }
    return { pts, wt, n };
  }
  // 그리기 전에 미생물 한 마리가 차지할 범위 (편모 포함) — 상자 밖으로 삐져나가지 않게 fit 에 쓴다
  function rodBB(b, x, y, len, w, ang, g, flag) {
    const c = Math.cos(ang), s = Math.sin(ang);
    bbAdd(b, x + (c * len) / 2, y + (s * len) / 2, w); bbAdd(b, x - (c * len) / 2, y - (s * len) / 2, w);
    if (!flag || g.flag <= 0.3) return;
    if (g.flag > 0.72 && R.lod) for (let k = 0; k < 6; k++) {
      const u = (k / 5 - 0.5) * len * 0.75, side = k % 2 ? 1 : -1, a = ang + PI - side * 0.9;
      bbAdd(b, x + c * u - s * w * side * 0.9 + Math.cos(a) * len * 0.5, y + s * u + c * w * side * 0.9 + Math.sin(a) * len * 0.5, w * 0.3);
    } else { const Lf = len * (0.8 + 0.6 * g.flag); bbAdd(b, x - (c * len) / 2 - c * Lf, y - (s * len) / 2 - s * Lf, w * 0.4); }
  }
  function spiroBB(b, x, y, L, w, ang, g) {
    const c = Math.cos(ang), s = Math.sin(ang), A = 0.11 + 0.06 * g.round, e = L / 2 + (g.flag > 0.3 ? L * 0.28 : 0);
    const r = A + w + (g.flag > 0.3 ? L * 0.1 : 0);
    bbAdd(b, x + c * e, y + s * e, r); bbAdd(b, x - c * e, y - s * e, r);
  }
  function commaBB(b, x, y, L, w, ang, flag) {
    const G = commaGeo(x, y, L, w, ang);
    for (const p of G.pts) bbAdd(b, p[0], p[1], w * 1.05);
    if (flag !== false) { const a = G.pts[G.n - 1], q = G.pts[G.n - 2], d = Math.atan2(a[1] - q[1], a[0] - q[0]); bbAdd(b, a[0] + Math.cos(d) * L * 1.1, a[1] + Math.sin(d) * L * 1.1, w * 0.45); }
  }
  function comma(ctx, x, y, L, w, ang, P, i, flag) {
    const { pts, wt, n } = commaGeo(x, y, L, w, ang);
    if (flag !== false) { const a = pts[n - 1], b = pts[n - 2]; strokeP(ctx, wavy(a[0], a[1], Math.atan2(a[1] - b[1], a[0] - b[0]), L * 1.1, w * 0.4, 2, i), P.line, flagW(w)); }
    const p = spath(tube({ pts, wt, wb: wt }, 0.9, 0.9));
    skinR(ctx, p, P.fill, P.line, x, y, L * 0.55);
    proInner(ctx, p, P, (pts[3][0] + pts[5][0]) / 2, (pts[3][1] + pts[5][1]) / 2, L * 0.7, w, ang, i);
  }
  function drawProk(ctx, P) {
    const g = P.g, form = P.form, b = BB();
    halo(ctx, 0, 0.04, 0.98, 0.8, P.light, 0.16);
    const W = 0.16 + 0.08 * g.wid;
    if (form === 0) {
      const n = 3 + (g.seg % 3), r = 0.27 + 0.07 * g.wid;
      const pos = [[0.04, 0.02], [-0.5, 0.2], [0.48, 0.3], [-0.14, -0.5], [0.44, -0.4]];
      for (let i = 0; i < n; i++) bbAdd(b, pos[i][0], pos[i][1], r * (i ? 0.9 - 0.04 * i : 1) + 0.02);
      fit(ctx, b[0], b[1], b[2], b[3]);
      for (let i = n - 1; i >= 0; i--) coccus(ctx, pos[i][0], pos[i][1], r * (i ? 0.9 - 0.04 * i : 1), P, i);
    } else if (form === 1) {
      const L = 0.85 + 0.45 * g.len;
      const rods = [[-0.32, 0.45, L * 0.7, W * 0.9, 0.35, 2, true], [0.46, -0.48, L * 0.55, W * 0.85, -0.25, 1, false], [0.02, 0, L, W, -0.18, 0, true]];
      for (const q of rods) rodBB(b, q[0], q[1], q[2], q[3], q[4], g, q[6]);
      fit(ctx, b[0], b[1], b[2], b[3]);
      for (const q of rods) rod(ctx, q[0], q[1], q[2], q[3], q[4], P, q[5], q[6]);
    } else if (form === 2) {
      spiroBB(b, -0.08, 0.38, 1.2, W * 0.7, 0.18, g); spiroBB(b, 0.04, -0.18, 1.55, W * 0.75, -0.12, g);
      fit(ctx, b[0], b[1], b[2], b[3]);
      spiro(ctx, -0.08, 0.38, 1.2, W * 0.7, 0.18, P, 1);
      spiro(ctx, 0.04, -0.18, 1.55, W * 0.75, -0.12, P, 0);
    } else {
      commaBB(b, -0.35, 0.3, 0.8, W * 0.95, 0.5); commaBB(b, 0.12, -0.32, 1.05, W, -0.25);
      fit(ctx, b[0], b[1], b[2], b[3]);
      comma(ctx, -0.35, 0.3, 0.8, W * 0.95, 0.5, P, 1);
      comma(ctx, 0.12, -0.32, 1.05, W, -0.25, P, 0);
    }
  }
  // 포식 세균: 먹잇감(창백한 세포)에 달라붙거나 무리 지어 에워싼다
  function drawBact(ctx, P) {
    const W = 0.13 + 0.05 * P.g.wid, prey = { ...P, fill: 'hsla(95,16%,74%,1)', line: 'hsla(95,22%,26%,.95)', c: [95, 0.16, 0.74], pk: 'chemo0' };
    halo(ctx, 0, 0.05, 0.98, 0.8, P.light, 0.12);
    const b = BB();
    if (P.form === 0) {
      rodBB(b, -0.14, 0.18, 1.3, 0.3, -0.12, P.g, false);
      commaBB(b, -0.12, -0.42, 0.55, W, 1.4, false); commaBB(b, 0.62, -0.4, 0.55, W, -0.6); commaBB(b, 0.55, 0.62, 0.48, W * 0.9, 0.5);
      fit(ctx, b[0], b[1], b[2], b[3]);
      rod(ctx, -0.14, 0.18, 1.3, 0.3, -0.12, prey, 5, false);
      comma(ctx, -0.12, -0.42, 0.55, W, 1.4, P, 0, false);
      comma(ctx, 0.62, -0.4, 0.55, W, -0.6, P, 1);
      comma(ctx, 0.55, 0.62, 0.48, W * 0.9, 0.5, P, 2);
    } else {
      bbAdd(b, 0, 0.02, 0.3);
      for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + 0.3, d = 0.6 + 0.08 * hr(k, P.salt), x = Math.cos(a) * d, y = Math.sin(a) * d * 0.9; rodBB(b, x, y, 0.42, W * 0.85, a + PI, P.g, false); if (R.lod) bbAdd(b, x + Math.cos(a) * 0.4, y + Math.sin(a) * 0.36, W * 0.4); }
      fit(ctx, b[0], b[1], b[2], b[3]);
      coccus(ctx, 0, 0.02, 0.3, prey, 0);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU + 0.3, d = 0.6 + 0.08 * hr(k, P.salt), x = Math.cos(a) * d, y = Math.sin(a) * d * 0.9;
        if (R.lod) strokeP(ctx, lpath([[x + Math.cos(a) * 0.12, y + Math.sin(a) * 0.12], [x + Math.cos(a) * 0.4, y + Math.sin(a) * 0.36]]), css(P.c, 0.1, 0, 0.3), W * 0.8);
        rod(ctx, x, y, 0.42, W * 0.85, a + PI, P, k, false);
      }
    }
  }
  // 남세균: 구슬 사슬 · 스트로마톨라이트 · 젤리 군체
  function drawCyano(ctx, P) {
    const g = P.g;
    if (P.form === 0) {
      halo(ctx, 0, 0, 0.98, 0.7, P.light, 0.14);
      const chain = (f, n, r, dim, hk) => {
        const pts = [];
        for (let i = 0; i < n; i++) pts.push(f(i / (n - 1)));
        const wt = pts.map(() => r * 1.32);
        const sh = spath(tube({ pts, wt, wb: wt }, 0.9, 0.9));
        ctx.fillStyle = css(P.c, 0.2, 0, 0.18); ctx.fill(sh);
        outline(ctx, sh, css(P.c, -0.1, 0, 0.35), 0.8);
        for (let i = 0; i < n; i++) {
          const het = i === hk || i === hk + 6;
          const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
          const p = ell(pts[i][0], pts[i][1], r * (het ? 1.12 : 1.02), r * (het ? 1.1 : 0.94), ang);
          skinR(ctx, p, het ? 'hsla(52,55%,78%,1)' : dim ? P.dark : P.fill, P.line, pts[i][0], pts[i][1], r);
          if (het && R.lod) outline(ctx, p, P.line, 1.8);
        }
      };
      const n = R.lod ? 9 + (g.seg % 5) : 6, r = 1.75 / (n * 1.9), sway = Math.sin(R.t * 0.8) * 0.06;
      chain((u) => [-0.7 + 1.4 * u, 0.45 + 0.16 * Math.sin(u * PI * 1.3 + 2 + sway)], Math.max(5, n - 4), r * 0.9, true, 99);
      chain((u) => [-0.86 + 1.72 * u, -0.08 + 0.28 * Math.sin(u * PI * 1.4 + 0.5 + sway)], n, r, false, 2 + (g.seg % 3));
    } else if (P.form === 1) {
      const top = -0.12 - 0.3 * g.round;
      const dome = [[-0.95, 0.86], [-0.82, 0.32], [-0.48, top + 0.12], [0, top], [0.48, top + 0.1], [0.84, 0.34], [0.95, 0.86]];
      const p = new Path2D(); smooth(p, dome, false); p.closePath();
      ctx.fillStyle = 'hsla(32,30%,52%,1)'; ctx.fill(p);
      ctx.save(); ctx.clip(p);
      for (let k = 1; k < 9; k++) { // 켜켜이 쌓인 퇴적층
        const f = 1 - k * 0.1, q = new Path2D();
        smooth(q, dome.map(([x, y]) => [x * (0.6 + 0.4 * f), 0.86 - (0.86 - y) * f]), true);
        ctx.strokeStyle = k % 2 ? 'hsla(30,28%,38%,.55)' : 'hsla(38,35%,66%,.5)'; ctx.lineWidth = 0.045; ctx.stroke(q);
      }
      const gr = ctx.createLinearGradient(-0.9, top, 0.9, 0.86);
      gr.addColorStop(0, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(0,0,0,.35)');
      ctx.fillStyle = gr; ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
      const mat = new Path2D(); smooth(mat, dome.slice(1, 6), false);
      strokeP(ctx, mat, P.fill, 0.1);
      const MS = spineOf(dome.slice(1, 6), [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]);
      if (R.lod) for (let k = 0; k < 26; k++) { // 미생물 매트의 가는 실
        const u = 0.04 + 0.92 * (k / 25), q = spineAt(MS, u * MS.len);
        strokeP(ctx, lpath([[q[0], q[1]], [q[0] + q[2] * 0.09, q[1] + q[3] * 0.09]]), P.light, PX(1.1));
      }
      outline(ctx, p, 'hsla(30,30%,20%,.9)');
      for (let k = 0; k < 6; k++) { // 산소 거품
        const ph = fr(R.t * 0.12 + hr(k, P.salt)), r = 0.025 + 0.03 * hr(k, P.salt + 2), x = -0.55 + 1.1 * hr(k, P.salt + 1) + Math.sin(ph * 6 + k) * 0.03;
        const y = lerp(top - 0.06 - r, -0.9 + r, ph), fade = 1 - ph * ph * ph;
        const b = circ(x, y, r);
        ctx.fillStyle = 'rgba(220,245,255,' + (0.25 * fade).toFixed(3) + ')'; ctx.fill(b);
        strokeP(ctx, b, 'rgba(220,245,255,' + (0.75 * fade).toFixed(3) + ')', PX(1));
      }
    } else {
      const p = circ(0, 0, 0.84);
      ctx.fillStyle = css(P.c, 0.22, 0, 0.2); ctx.fill(p);
      ctx.fillStyle = css(P.c, 0.25, 0, 0.12); ctx.fill(circ(0.02, 0.02, 0.7));
      const n = R.lod ? 9 : 6;
      for (let k = 0; k < n; k++) {
        const a = hr(k, P.salt) * TAU, d = Math.sqrt(hr(k, P.salt + 1)) * 0.55, x = Math.cos(a) * d, y = Math.sin(a) * d, ang = hr(k, P.salt + 2) * PI, r = 0.1 + 0.03 * g.wid;
        ctx.fillStyle = css(P.c, 0.25, 0, 0.18); ctx.fill(ell(x, y, r * 2.3, r * 1.4, ang));
        for (const sd of [-1, 1]) { const cx = x + Math.cos(ang) * r * 0.95 * sd, cy = y + Math.sin(ang) * r * 0.95 * sd; skinR(ctx, circ(cx, cy, r), P.fill, P.line, cx, cy, r); }
      }
      const gr = ctx.createRadialGradient(-0.3, -0.35, 0.05, 0, 0, 0.9);
      gr.addColorStop(0, 'rgba(255,255,255,.3)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr; ctx.fill(p);
      outline(ctx, p, css(P.c, -0.05, 0, 0.6));
    }
  }

  /* ================= 진핵 세포 ================= */
  function cellSkin(ctx, p, P, cx, cy, r, alpha) {
    ctx.fillStyle = css(P.c, 0.06, -0.05, alpha || 0.72); ctx.fill(p);
    sheen(ctx, p, cx, cy, r);
  }
  function sheen(ctx, p, cx, cy, r) {
    const gr = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r * 1.1);
    gr.addColorStop(0, 'rgba(255,255,255,.35)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(0.8, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.25)');
    ctx.fillStyle = gr; ctx.fill(p);
  }
  function granules(ctx, P, n, x, y, rx, ry, col) {
    if (!R.lod) return;
    for (let k = 0; k < n; k++) {
      const a = hr(k, P.salt + 11) * TAU, d = Math.sqrt(hr(k, P.salt + 12));
      dot(ctx, x + Math.cos(a) * d * rx, y + Math.sin(a) * d * ry, 0.012 + 0.012 * hr(k, P.salt + 13), col);
    }
  }
  function nucleus(ctx, P, x, y, r) {
    const p = circ(x, y, r);
    ctx.fillStyle = css(P.c, -0.12, 0.05, 0.55); ctx.fill(p);
    outline(ctx, p, css(P.c, -0.3, 0, 0.7), 0.8);
    if (R.lod) dot(ctx, x + r * 0.15, y - r * 0.1, r * 0.35, css(P.c, -0.3, 0, 0.75));
  }
  function vacuole(ctx, x, y, r, star) {
    const p = circ(x, y, r);
    ctx.fillStyle = 'rgba(235,250,255,.4)'; ctx.fill(p);
    strokeP(ctx, p, 'rgba(235,250,255,.75)', PX(0.9));
    if (star && R.lod > 1) {
      const q = new Path2D();
      for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; q.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); q.lineTo(x + Math.cos(a) * r * 2.4, y + Math.sin(a) * r * 2.4); }
      strokeP(ctx, q, 'rgba(235,250,255,.5)', PX(1));
    }
  }
  function drawAlga(ctx, P) {
    const g = P.g, t = R.t;
    if (P.form === 0) { // 클라미도모나스형
      const rx = 0.48 + 0.1 * g.len, ry = 0.4 + 0.08 * g.wid, cx = -0.18, fx = cx + rx * 0.97, sw = Math.sin(t * 6) * 0.25;
      for (const sd of [-1, 1]) {
        const a = sw * sd, pts = [[fx, -0.03 * sd], [fx + 0.22, -0.2 * sd], [fx + 0.2 + 0.1 * Math.sin(a), -(0.55 + 0.1 * a) * sd], [fx - 0.05, -0.78 * sd], [fx - 0.3, -0.85 * sd]];
        strokeP(ctx, spath(pts, true), P.line, Math.max(PX(0.9), 0.022));
      }
      const p = ell(cx, 0, rx, ry);
      ctx.fillStyle = css(P.c, 0.3, -0.15, 0.85); ctx.fill(p);
      ctx.save(); ctx.clip(p);
      ctx.fillStyle = P.fill; ctx.fill(ell(cx - rx * 0.2, 0, rx * 0.95, ry * 0.98));
      ctx.fillStyle = css(P.c, 0.3, -0.15, 1); ctx.fill(ell(cx + rx * 0.28, 0, rx * 0.5, ry * 0.52));
      if (R.lod) {
        const py = circ(cx - rx * 0.45, 0, 0.09);
        ctx.fillStyle = css(P.c, 0.18, 0, 1); ctx.fill(py); outline(ctx, py, P.line, 0.7);
        nucleus(ctx, P, cx + rx * 0.22, 0, 0.11);
        vacuole(ctx, cx + rx * 0.72, -0.07, 0.035); vacuole(ctx, cx + rx * 0.72, 0.07, 0.035);
      }
      ctx.restore();
      dot(ctx, cx + rx * 0.38, -ry * 0.72, Math.max(0.05, PX(1.2)), 'hsla(8,85%,52%,1)');
      sheen(ctx, p, cx, 0, rx);
      outline(ctx, ell(cx, 0, rx + 0.025, ry + 0.025), css(P.c, 0.25, -0.2, 0.55), 1.2);
      outline(ctx, p, P.line);
    } else if (P.form === 1) { // 규조류: 유리 껍데기
      const gold = { ...P, c: [40 + tri(g.hue) * 16, 0.5, 0.55] };
      const fill = css(gold.c), line = hsl(gold.c[0], 0.5, 0.2, 0.95);
      if (!bit0(g)) {
        const p = circ(0, 0, 0.82);
        skinR(ctx, p, fill, line, 0, 0, 0.82);
        ctx.save(); ctx.clip(p);
        for (let k = 0; k < 4; k++) dot(ctx, Math.cos(k * 1.7 + 0.5) * 0.4, Math.sin(k * 1.7 + 0.5) * 0.4, 0.15, 'hsla(28,55%,32%,.35)');
        if (R.lod) {
          const q = new Path2D(), n = R.lod > 1 ? 40 : 24;
          for (let k = 0; k < n; k++) { const a = (k / n) * TAU; q.moveTo(Math.cos(a) * 0.17, Math.sin(a) * 0.17); q.lineTo(Math.cos(a) * 0.7, Math.sin(a) * 0.7); }
          strokeP(ctx, q, 'hsla(40,40%,90%,.45)', PX(1));
          if (R.lod > 1) for (const rr of [0.3, 0.45, 0.6]) for (let k = 0; k < 36; k++) { const a = (k / 36) * TAU + rr; dot(ctx, Math.cos(a) * rr, Math.sin(a) * rr, 0.012, 'hsla(40,30%,22%,.45)'); }
        }
        ctx.restore();
        outline(ctx, circ(0, 0, 0.72), 'hsla(40,40%,90%,.5)', 1);
        outline(ctx, circ(0, 0, 0.15), line, 0.8);
      } else {
        const pts = [[-0.96, 0], [-0.62, -0.21], [0, -0.28], [0.62, -0.21], [0.96, 0], [0.62, 0.21], [0, 0.28], [-0.62, 0.21]];
        const p = spath(pts);
        skinR(ctx, p, fill, line, 0, 0, 0.9);
        ctx.save(); ctx.clip(p);
        ctx.fillStyle = 'hsla(28,55%,32%,.3)'; ctx.fill(ell(-0.3, -0.12, 0.45, 0.08)); ctx.fill(ell(0.3, 0.12, 0.45, 0.08));
        if (R.lod) {
          const q = new Path2D();
          for (let k = -14; k <= 14; k++) { const x = k * 0.06; if (Math.abs(x) < 0.06) continue; q.moveTo(x, -0.3); q.lineTo(x, -0.04); q.moveTo(x, 0.04); q.lineTo(x, 0.3); }
          strokeP(ctx, q, 'hsla(40,40%,90%,.4)', PX(1));
        }
        ctx.restore();
        strokeP(ctx, lpath([[-0.8, 0], [0.8, 0]]), line, R.lw * 0.9);
        dot(ctx, 0, 0, 0.05, line);
      }
    } else { // 볼복스: 수백 개 세포가 모인 공
      const R0 = 0.86, p = circ(0, 0, R0);
      ctx.fillStyle = css(P.c, 0.2, -0.1, 0.16); ctx.fill(p);
      const rot = t * 0.3;
      for (let k = 0; k < 4; k++) {
        const a = hr(k, P.salt) * TAU + rot * 0.5, d = 0.18 + 0.28 * hr(k, P.salt + 1), r = 0.13 + 0.08 * hr(k, P.salt + 2), x = Math.cos(a) * d, y = Math.sin(a) * d;
        const q = circ(x, y, r);
        skinR(ctx, q, P.dark, P.line, x, y, r);
        if (R.lod) for (let j = 0; j < 7; j++) dot(ctx, x + Math.cos(j + a) * r * 0.6, y + Math.sin(j + a) * r * 0.6, r * 0.13, css(P.c, 0.15));
      }
      const N = R.lod > 1 ? 90 : R.lod ? 48 : 20, ga = PI * (3 - Math.sqrt(5));
      for (let i = 0; i < N; i++) {
        const z = 1 - (2 * (i + 0.5)) / N, rr = Math.sqrt(1 - z * z), a = i * ga + rot, x = Math.cos(a) * rr, y = z, zz = Math.sin(a) * rr;
        if (zz < -0.15) continue;
        dot(ctx, x * R0 * 0.97, y * R0 * 0.97, (R.lod ? 0.028 : 0.05) * (0.7 + 0.3 * zz), zz > 0.2 ? P.fill : css(P.c, -0.05, 0, 0.6));
      }
      const gr = ctx.createRadialGradient(-0.3, -0.35, 0.05, 0, 0, 0.95);
      gr.addColorStop(0, 'rgba(255,255,255,.28)'); gr.addColorStop(0.55, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,.2)');
      ctx.fillStyle = gr; ctx.fill(p);
      outline(ctx, p, css(P.c, -0.1, 0, 0.7));
    }
  }
  function drawProtozoa(ctx, P) {
    const g = P.g, t = R.t;
    if (P.form === 0) { // 아메바: 위족을 뻗는 덩어리
      const n = 13, pts = [], inn = [], b = BB();
      for (let i = 0; i < n; i++) { const a = (i / n) * TAU, k = hr(i, P.salt), r = 0.57 + 0.1 * k + (k > 0.6 ? 0.22 + 0.2 * g.limbL : 0); bbAdd(b, Math.cos(a) * r * (1 + 0.12 * g.len), Math.sin(a) * r * 0.86, 0.04); }
      fit(ctx, b[0], b[1], b[2], b[3], 0.9);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU, k = hr(i, P.salt);
        let r = 0.52 + 0.1 * k + 0.05 * Math.sin(t * 1.3 + i * 1.7);
        if (k > 0.6) r += 0.22 + 0.2 * g.limbL;
        pts.push([Math.cos(a) * r * (1 + 0.12 * g.len), Math.sin(a) * r * 0.86]);
        inn.push([Math.cos(a) * r * 0.72 * (1 + 0.12 * g.len), Math.sin(a) * r * 0.62]);
      }
      const p = spath(pts);
      cellSkin(ctx, p, P, 0, 0, 0.8, 0.5);
      ctx.fillStyle = css(P.c, -0.04, 0, 0.45); ctx.fill(spath(inn));
      granules(ctx, P, R.lod > 1 ? 40 : 18, 0, 0, 0.5, 0.42, css(P.c, -0.25, 0, 0.5));
      if (R.lod) {
        nucleus(ctx, P, 0.12, -0.06, 0.15);
        vacuole(ctx, -0.32, 0.12, 0.08, true);
        for (let k = 0; k < 3; k++) { const x = -0.1 + 0.3 * hr(k, P.salt + 20), y = 0.2 - 0.3 * hr(k, P.salt + 21); dot(ctx, x, y, 0.06, 'rgba(235,250,255,.35)'); dot(ctx, x, y, 0.03, 'hsla(100,40%,40%,.7)'); }
      }
      outline(ctx, p, P.line);
    } else if (P.form === 1) { // 짚신벌레형
      const sx = 0.9 + 0.12 * g.len, sy = 0.85 + 0.25 * g.wid;
      const pts = [[0.9, 0], [0.74, -0.24], [0.3, -0.35], [-0.3, -0.33], [-0.78, -0.2], [-0.94, 0.02], [-0.78, 0.22], [-0.3, 0.32], [0.08, 0.27], [0.3, 0.13], [0.5, 0.2], [0.78, 0.17]].map(([x, y]) => [x * sx, y * sy]);
      if (R.lod) {
        const d = dens(pts, R.lod > 1 ? 5 : 3), q = new Path2D();
        for (let i = 0; i < d.length; i++) {
          const a = d[(i - 1 + d.length) % d.length], b = d[(i + 1) % d.length], dx = b[0] - a[0], dy = b[1] - a[1], dd = Math.hypot(dx, dy) || 1;
          const nx = dy / dd, ny = -dx / dd, w = Math.sin(t * 12 - i * 0.6) * 0.5;
          q.moveTo(d[i][0], d[i][1]); q.lineTo(d[i][0] + (nx - (dx / dd) * w) * 0.07, d[i][1] + (ny - (dy / dd) * w) * 0.07);
        }
        strokeP(ctx, q, css(P.c, 0.18, 0, 0.8), PX(1.1));
      }
      const p = spath(pts);
      cellSkin(ctx, p, P, 0, 0, 0.9, 0.62);
      granules(ctx, P, R.lod > 1 ? 30 : 14, -0.05, 0, 0.6, 0.22, css(P.c, -0.25, 0, 0.45));
      if (R.lod) {
        const mn = ell(-0.08 * sx, -0.02, 0.24 * sx, 0.12 * sy, 0.1);
        ctx.fillStyle = css(P.c, -0.15, 0.05, 0.55); ctx.fill(mn); outline(ctx, mn, css(P.c, -0.3, 0, 0.6), 0.7);
        dot(ctx, 0.14 * sx, -0.08, 0.04, css(P.c, -0.3, 0, 0.8));
        vacuole(ctx, 0.5 * sx, -0.14, 0.06, true); vacuole(ctx, -0.55 * sx, -0.1, 0.06, true);
        strokeP(ctx, spath([[0.62 * sx, 0.16], [0.42 * sx, 0.12], [0.18 * sx, 0.1]], true), P.line, R.lw);
        for (let k = 0; k < 3; k++) dot(ctx, (-0.4 + 0.25 * k) * sx, 0.12, 0.045, 'hsla(95,40%,45%,.6)');
      }
      outline(ctx, p, P.line);
    } else { // 나팔벌레형
      const pts = [[-0.92, 0.55], [-0.6, 0.42], [-0.2, 0.2], [0.2, 0], [0.5, -0.12]], wt = [0.04, 0.08, 0.17, 0.3, 0.42 + 0.08 * g.wid];
      const S = spineOf(pts, wt, wt), p = spath(tube(S, 0.8, 0.2));
      cellSkin(ctx, p, P, 0, 0, 0.9, 0.8);
      ctx.save(); ctx.clip(p);
      if (R.lod) for (let k = -3; k <= 3; k++) {
        const q = new Path2D();
        for (let i = 0; i <= 12; i++) { const a = spineAt(S, (S.len * i) / 12), v = (k / 3.6) * a[4]; const x = a[0] + a[2] * v, y = a[1] + a[3] * v; if (i) q.lineTo(x, y); else q.moveTo(x, y); }
        strokeP(ctx, q, css(P.c, -0.2, 0.1, 0.45), PX(R.lod > 1 ? 1.4 : 1));
      }
      ctx.restore();
      outline(ctx, p, P.line);
      const e = pts[4], ang = Math.atan2(pts[4][1] - pts[3][1], pts[4][0] - pts[3][0]) + PI / 2, rr = wt[4];
      const disc = ell(e[0], e[1], 0.1, rr, ang - PI / 2);
      ctx.fillStyle = css(P.c, 0.15); ctx.fill(disc); outline(ctx, disc, P.line);
      if (R.lod) {
        const q = new Path2D();
        for (let k = 0; k < 22; k++) {
          const a = (k / 22) * TAU, ex = e[0] + Math.cos(a) * 0.1 * Math.cos(ang - PI / 2) - Math.sin(a) * rr * Math.sin(ang - PI / 2), ey = e[1] + Math.cos(a) * 0.1 * Math.sin(ang - PI / 2) + Math.sin(a) * rr * Math.cos(ang - PI / 2);
          const w = Math.sin(t * 10 + k) * 0.03;
          q.moveTo(ex, ey); q.lineTo(ex + Math.cos(ang - PI / 2) * 0.09 + w, ey + Math.sin(ang - PI / 2) * 0.09 + w);
        }
        strokeP(ctx, q, P.line, PX(1));
        for (let k = 0; k < 7; k++) { const a = spineAt(S, S.len * (0.25 + k * 0.08)); dot(ctx, a[0] + a[2] * 0.05, a[1] + a[3] * 0.05, 0.035, css(P.c, -0.25, 0, 0.7)); }
      }
    }
  }
  function drawProtoPred(ctx, P) {
    const g = P.g, t = R.t;
    if (P.form === 0) { // 태양충: 가시 같은 위족을 사방으로
      const N = R.lod > 1 ? 38 : R.lod ? 26 : 16, q = new Path2D();
      for (let k = 0; k < N; k++) {
        const a = (k / N) * TAU + hr(k, P.salt) * 0.08, L = 0.82 + 0.12 * hr(k, P.salt + 1) + 0.04 * Math.sin(t * 2 + k);
        q.moveTo(Math.cos(a) * 0.3, Math.sin(a) * 0.3); q.lineTo(Math.cos(a) * L, Math.sin(a) * L);
      }
      strokeP(ctx, q, css(P.c, -0.25, 0, 0.85), Math.max(PX(0.9), 0.014));
      if (R.lod > 1) for (let k = 0; k < N; k += 2) { const a = (k / N) * TAU, d = 0.5 + 0.3 * hr(k, P.salt + 5); dot(ctx, Math.cos(a) * d, Math.sin(a) * d, 0.016, css(P.c, -0.1)); }
      const p = circ(0, 0, 0.38);
      skinR(ctx, p, P.fill, P.line, 0, 0, 0.38);
      if (R.lod) {
        for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU, d = 0.29; dot(ctx, Math.cos(a) * d, Math.sin(a) * d, 0.06, css(P.c, 0.18, 0, 0.6)); }
        nucleus(ctx, P, 0, 0, 0.12);
      }
      const prey = circ(0.62, -0.55, 0.07);
      skinR(ctx, prey, 'hsla(110,40%,55%,1)', 'hsla(110,40%,22%,.9)', 0.62, -0.55, 0.07);
    } else if (P.form === 1) { // 주둥이 섬모충 (디디니움)
      const rx = 0.52 + 0.08 * g.len, ry = 0.46 + 0.06 * g.wid, cx = -0.15;
      const pts = [[cx - rx, 0], [cx - rx * 0.9, -ry * 0.68], [cx - rx * 0.4, -ry], [cx + rx * 0.4, -ry * 0.98], [cx + rx * 0.88, -ry * 0.6], [cx + rx, -0.12], [cx + rx + 0.22, -0.045], [cx + rx + 0.29, 0], [cx + rx + 0.22, 0.045], [cx + rx, 0.12], [cx + rx * 0.88, ry * 0.6], [cx + rx * 0.4, ry * 0.98], [cx - rx * 0.4, ry], [cx - rx * 0.9, ry * 0.68]];
      const p = spath(pts);
      cellSkin(ctx, p, P, cx, 0, rx, 0.78);
      for (const gx of [cx + rx * 0.45, cx - rx * 0.35]) {
        const k = Math.sqrt(Math.max(0, 1 - ((gx - cx) / rx) ** 2)) * ry * 1.02;
        strokeP(ctx, lpath([[gx, -k], [gx, k]]), css(P.c, -0.25, 0, 0.7), Math.max(PX(1), 0.03));
        if (R.lod) {
          const q = new Path2D();
          for (let j = 0; j < 14; j++) { const y = -k + (2 * k * j) / 13, w = Math.sin(t * 12 + j) * 0.03; q.moveTo(gx, y); q.lineTo(gx - 0.09, y + w); }
          strokeP(ctx, q, P.line, PX(0.9));
        }
      }
      granules(ctx, P, 20, cx, 0, rx * 0.6, ry * 0.6, css(P.c, -0.25, 0, 0.5));
      if (R.lod) { const mn = ell(cx - 0.05, 0.02, 0.24, 0.09, -0.5); ctx.fillStyle = css(P.c, -0.18, 0.05, 0.55); ctx.fill(mn); outline(ctx, mn, css(P.c, -0.3, 0, 0.6), 0.7); }
      outline(ctx, p, P.line);
    } else { // 뿔 달린 와편모충
      const L = 0.85 + 0.12 * g.len, pts = [[L, -0.1], [0.36, -0.15], [0.2, -0.3], [0.02, -0.36], [-0.16, -0.3], [-0.52 - 0.15 * g.spike, -0.68], [-0.26, -0.12], [-0.9, 0.44], [-0.22, 0.24], [0.04, 0.32], [0.22, 0.24], [0.36, 0.05]];
      const p = lpath(pts, true);
      skinR(ctx, p, P.fill, P.line, 0, 0, 0.6);
      if (R.lod) {
        ctx.save(); ctx.clip(p);
        const q = new Path2D();
        for (let k = 0; k < 7; k++) { const a = hr(k, P.salt) * TAU, x = -0.2 + 0.5 * hr(k, P.salt + 1), y = -0.2 + 0.4 * hr(k, P.salt + 2); q.moveTo(x, y); q.lineTo(x + Math.cos(a) * 0.3, y + Math.sin(a) * 0.3); }
        strokeP(ctx, q, css(P.c, 0.2, 0, 0.45), PX(1));
        ctx.restore();
      }
      const gp = spath([[0.18, -0.24], [0.08, 0], [0.18, 0.24]], true);
      strokeP(ctx, gp, P.line, Math.max(PX(1.5), 0.04));
      strokeP(ctx, wavy(0.16, -0.22, PI / 2 + 0.25, 0.5, 0.03, 4, 0), css(P.c, 0.25, 0, 0.9), PX(1));
      strokeP(ctx, wavy(0.08, 0.1, PI * 0.82, 0.8, 0.05, 2, 1), P.line, Math.max(PX(0.9), 0.016));
    }
  }

  /* ================= 식물·해조·고착 동물 ================= */
  // 잎 하나: 기부(x,y)에서 각도 a로 길이 L, 폭 w. kind 0 둥근 · 1 끝이 뾰족 · 2 가늘고 긴 · 3 갈라진
  function leafPts(x, y, a, L, w, kind, ruffle) {
    const c = Math.cos(a), s = Math.sin(a), n = 7, top = [], bot = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      let ww = kind === 2 ? Math.sin(PI * Math.pow(u, 0.6)) * 0.55 : kind === 0 ? Math.sin(PI * Math.pow(u, 0.75)) : Math.sin(PI * Math.pow(u, 0.9)) * (1 - 0.35 * u);
      if (kind === 3) ww *= 0.75 + 0.35 * Math.abs(Math.sin(u * PI * 3));
      if (ruffle) ww *= 1 + ruffle * Math.sin(u * 23 + a * 5);
      ww *= w;
      const px = x + c * u * L, py = y + s * u * L;
      top.push([px + s * ww, py - c * ww]);
      bot.push([px - s * ww, py + c * ww]);
    }
    return top.concat(bot.reverse().slice(1, -1));
  }
  function drawLeaf(ctx, P, x, y, a, L, w, kind, fill, ruffle) {
    const p = spath(leafPts(x, y, a, L, w, kind, ruffle));
    ctx.fillStyle = fill || P.fill; ctx.fill(p);
    if (R.lod && L * R.px > 9) {
      const gr = ctx.createLinearGradient(x, y, x + Math.cos(a) * L, y + Math.sin(a) * L);
      gr.addColorStop(0, 'rgba(0,0,0,.18)'); gr.addColorStop(1, 'rgba(255,255,255,.14)');
      ctx.fillStyle = gr; ctx.fill(p);
      if (L * R.px > 16) strokeP(ctx, lpath([[x, y], [x + Math.cos(a) * L * 0.85, y + Math.sin(a) * L * 0.85]]), 'rgba(255,255,255,.22)', PX(0.9));
    }
    outline(ctx, p, P.line, 0.8);
  }
  // 작은 그림용 잎 덩어리: 축을 따라 가운데가 넓고 끝이 가는 한 장 (잎 수십 장을 그리는 대신)
  function frondBlob(ctx, P, pts, w0, fill) {
    const n = pts.length, wt = pts.map((_, i) => w0 * Math.sin(PI * Math.min(0.9, (i + 0.7) / (n + 0.4))));
    const p = spath(tube({ pts, wt, wb: wt }, 0.3, 0.9));
    ctx.fillStyle = fill; ctx.fill(p); outline(ctx, p, P.line, 0.8);
  }
  function ground(ctx, x, y, w, col) {
    shadow(ctx, x, y + 0.02, w, w * 0.16);
    if (col) { const p = ell(x, y + 0.03, w * 0.75, w * 0.1); ctx.fillStyle = col; ctx.fill(p); }
  }
  function seabed(ctx, x, y, w) {
    const p = spath([[x - w, y + 0.06], [x - w * 0.6, y - 0.05], [x, y - 0.09], [x + w * 0.6, y - 0.04], [x + w, y + 0.06], [x, y + 0.1]]);
    skin(ctx, p, 'hsla(28,14%,40%,1)', 'hsla(28,20%,16%,.9)', y - 0.1, y + 0.1);
  }
  function holdfast(ctx, P, x, y) {
    const q = new Path2D();
    for (let k = 0; k < 7; k++) { const a = PI * (0.15 + (0.7 * k) / 6); q.moveTo(x, y - 0.04); q.quadraticCurveTo(x + Math.cos(a) * 0.06, y, x + Math.cos(a) * 0.13, y + 0.05 - Math.sin(a) * 0.02); }
    strokeP(ctx, q, P.dark, Math.max(PX(1), 0.025));
  }
  function drawSeaweed(ctx, P) {
    const g = P.g, t = R.t, sway = (k) => Math.sin(t * 1.1 + k * 1.3) * 0.08;
    seabed(ctx, 0, 0.88, 0.55);
    if (P.form === 0) { // 넓은 잎 해초
      const n = 3 + (g.seg % 3);
      for (let i = 0; i < n; i++) {
        const u = n > 1 ? i / (n - 1) - 0.5 : 0, a = -PI / 2 + u * (1.1 + 0.4 * g.branch) + sway(i), L = 1.18 + 0.38 * hr(i, P.salt) - Math.abs(u) * 0.3;
        drawLeaf(ctx, P, u * 0.12, 0.84, a, L, 0.16 + 0.12 * g.wid, 0, i % 2 ? P.dark : css(P.c, 0, 0, 0.92), 0.12);
      }
    } else if (P.form === 1) { // 부채꼴로 갈라지는 홍조
      const depth = R.lod > 1 ? 5 : 4, spread = 0.32 + 0.22 * g.branch;
      const br = (x, y, a, L, w, d) => {
        const ex = x + Math.cos(a) * L, ey = y + Math.sin(a) * L;
        limb(ctx, [[x, y], [(x + ex) / 2 + Math.cos(a + 1.5) * L * 0.06, (y + ey) / 2 + Math.sin(a + 1.5) * L * 0.06], [ex, ey]], w, P.fill, P.line, true);
        if (d > 0) { br(ex, ey, a - spread + sway(d) * 0.5, L * 0.78, w * 0.75, d - 1); br(ex, ey, a + spread + sway(d + 2) * 0.5, L * 0.78, w * 0.75, d - 1); }
        else dot(ctx, ex, ey, w * 0.7, P.light);
      };
      br(0, 0.84, -PI / 2, 0.42, 0.075, depth);
    } else { // 포도알 해초
      strokeP(ctx, spath([[-0.85, 0.8], [-0.4, 0.74], [0.1, 0.8], [0.5, 0.74], [0.88, 0.8]], true), P.dark, 0.05);
      const n = 3 + (g.seg % 2);
      for (let i = 0; i < n; i++) {
        const x0 = -0.62 + (1.24 * i) / (n - 1), h = 0.9 + 0.5 * hr(i, P.salt), sw = sway(i);
        strokeP(ctx, lpath([[x0, 0.78], [x0 + sw, 0.78 - h]]), P.dark, 0.03);
        const bp = R.lod ? null : new Path2D(); // 작은 그림: 알갱이를 한 번에 칠한다
        for (let j = 0; j < 9; j++) {
          const yy = 0.7 - (h * j) / 9, xx = x0 + (sw * j) / 9;
          for (const sd of [-1, 1]) { const bx = xx + sd * 0.07, by = yy - 0.02 * sd, r = 0.055 - j * 0.002; if (bp) { bp.moveTo(bx + r, by); bp.arc(bx, by, r, 0, TAU); } else skinR(ctx, circ(bx, by, r), P.fill, P.line, bx, by, r); }
        }
        if (bp) { ctx.fillStyle = P.fill; ctx.fill(bp); outline(ctx, bp, P.line, 0.8); }
      }
    }
  }
  function drawMoss(ctx, P) {
    const g = P.g, t = R.t;
    if (P.form === 0) { // 방석 이끼 + 포자체
      ground(ctx, 0, 0.82, 0.9);
      const n = 2 + Math.floor(g.bloom * 6), cap = hsl(18 + 30 * tri(g.flower), 0.55, 0.42);
      for (let i = 0; i < n; i++) {
        const x = -0.5 + (1 * (i + 0.5)) / n + (hr(i, P.salt) - 0.5) * 0.12, top = -0.35 - 0.45 * hr(i, P.salt + 1), sw = Math.sin(t + i) * 0.03;
        strokeP(ctx, spath([[x, 0.3], [x + 0.03 + sw / 2, (0.3 + top) / 2], [x + sw, top]], true), 'hsla(28,50%,40%,1)', Math.max(PX(1), 0.018));
        const c = ell(x + sw, top - 0.05, 0.035, 0.075, 0.5);
        skinR(ctx, c, cap, P.line, x + sw, top - 0.05, 0.07);
      }
      const dome = [[-0.9, 0.82], [-0.82, 0.48], [-0.5, 0.2], [0, 0.1], [0.5, 0.2], [0.82, 0.46], [0.9, 0.82]];
      const p = new Path2D(); smooth(p, dome, false); p.closePath();
      skin(ctx, p, P.fill, P.line, 0.1, 0.82, (c) => {
        if (!R.lod) return;
        const q = new Path2D(), N = R.lod > 1 ? 70 : 34;
        for (let k = 0; k < N; k++) {
          const x = -0.85 + 1.7 * hr(k, P.salt), y = 0.15 + 0.65 * hr(k, P.salt + 1), r = 0.035;
          for (let j = 0; j < 5; j++) { const a = (j / 5) * TAU + k; q.moveTo(x, y); q.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
        }
        strokeP(c, q, P.light, PX(1));
      });
    } else if (P.form === 1) { // 우산이끼
      ground(ctx, 0, 0.8, 0.9);
      for (let i = 0; i < 6; i++) {
        const a = PI + (i / 5) * PI * 0.9 + 0.15;
        const lobe = spath(leafPts(0, 0.76, a, 0.75 + 0.15 * hr(i, P.salt), 0.2, 3, 0));
        skin(ctx, lobe, i % 2 ? P.dark : P.fill, P.line, 0.5, 0.85);
      }
      const n = 2 + (g.seg % 2);
      for (let i = 0; i < n; i++) {
        const x = -0.35 + (0.7 * i) / Math.max(1, n - 1), top = -0.25 - 0.3 * hr(i, P.salt + 2), sw = Math.sin(t + i) * 0.02;
        strokeP(ctx, lpath([[x, 0.7], [x + sw, top]]), P.dark, Math.max(PX(1), 0.03));
        const um = new Path2D(), rays = 7 + (g.seg % 3);
        for (let k = 0; k <= rays; k++) { const a = PI + (k / rays) * PI, rr = 0.2; um.lineTo(x + sw + Math.cos(a) * rr, top + 0.03 + Math.sin(a) * rr * 0.45); }
        um.closePath();
        skin(ctx, um, P.fill, P.line, top - 0.1, top + 0.05);
      }
    } else { // 바위 지의류
      ground(ctx, 0, 0.84, 0.95);
      const rock = new Path2D(); smooth(rock, [[-0.9, 0.84], [-0.84, 0.3], [-0.45, -0.1], [0.1, -0.22], [0.6, -0.05], [0.88, 0.35], [0.9, 0.84]], false); rock.closePath();
      skin(ctx, rock, 'hsla(220,6%,52%,1)', 'hsla(220,10%,18%,.9)', -0.22, 0.84);
      const lich = css(P.a, 0.05, -0.1);
      for (let i = 0; i < 4; i++) {
        const x = -0.5 + 0.35 * i + 0.1 * hr(i, P.salt), y = 0.05 + 0.4 * hr(i, P.salt + 1), r = 0.17 + 0.1 * hr(i, P.salt + 2), pts = [];
        for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU; pts.push([x + Math.cos(a) * r * (k % 2 ? 1 : 0.82), y + Math.sin(a) * r * 0.75 * (k % 2 ? 1 : 0.82)]); }
        const p = spath(pts);
        skin(ctx, p, i % 2 ? lich : P.fill, P.line, y - r, y + r);
        if (R.lod) for (let k = 0; k < 3; k++) { const cx = x + (hr(k + i * 3, P.salt) - 0.5) * r, cy = y + (hr(k + i * 3, P.salt + 5) - 0.5) * r * 0.6; dot(ctx, cx, cy, 0.03, 'hsla(25,50%,30%,.9)'); dot(ctx, cx, cy, 0.016, 'hsla(25,60%,55%,1)'); }
      }
    }
  }
  function drawSponge(ctx, P) {
    const g = P.g, t = R.t;
    seabed(ctx, 0, 0.88, 0.7);
    const pores = (x0, y0, x1, y1, n) => { if (!R.lod) return; for (let k = 0; k < n; k++) dot(ctx, x0 + (x1 - x0) * hr(k, P.salt + 3), y0 + (y1 - y0) * hr(k, P.salt + 4), 0.018, css(P.c, -0.28, 0, 0.6)); };
    if (P.form === 0 || P.form === 2) { // 항아리 해면 · 관 해면 무리
      const tubes = P.form === 0 ? [[0, 1, 0.42 + 0.14 * g.wid], [-0.48, 0.55, 0.2]] : [[-0.42, 0.7, 0.16], [0.42, 0.62, 0.15], [0.1, 1, 0.18], [-0.12, 0.45, 0.13]];
      tubes.sort((a, b) => a[1] - b[1]);
      for (const [x, hk, w] of tubes.reverse()) {
        const top = 0.84 - 1.65 * hk, bw = w * (P.form === 0 ? 0.45 : 0.8);
        const pts = [[x - bw, 0.86], [x - w * 0.95, (top + 0.86) / 2], [x - w, top], [x + w, top], [x + w * 0.95, (top + 0.86) / 2], [x + bw, 0.86]];
        const p = new Path2D(); smooth(p, pts, false); p.closePath();
        skin(ctx, p, P.fill, P.line, top, 0.86, (c) => { boxPat(c, x - w, top, x + w, 0.86, P); pores(x - w, top + 0.05, x + w, 0.84, 30); });
        const o = ell(x, top, w * 0.92, w * 0.28);
        ctx.fillStyle = css(P.c, -0.3); ctx.fill(o);
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill(ell(x, top + w * 0.06, w * 0.7, w * 0.17));
        outline(ctx, o, P.line);
      }
    } else if (P.form === 1) { // 가지 산호
      const spread = 0.35 + 0.25 * g.branch, depth = 3;
      const br = (x, y, a, L, w, d) => {
        const ex = x + Math.cos(a) * L, ey = y + Math.sin(a) * L;
        limb(ctx, [[x, y], [ex, ey]], w, P.fill, P.line);
        if (d > 0) { br(ex, ey, a - spread * (0.7 + 0.5 * hr(d, P.salt)), L * 0.8, w * 0.8, d - 1); br(ex, ey, a + spread * (0.7 + 0.5 * hr(d + 5, P.salt)), L * 0.8, w * 0.8, d - 1); }
        else { skinR(ctx, circ(ex, ey, w * 0.62), P.light, P.line, ex, ey, w * 0.6); if (R.lod > 1) dot(ctx, ex, ey, w * 0.18, 'rgba(255,255,255,.8)'); }
      };
      br(0, 0.84, -PI / 2, 0.42, 0.11, depth);
      if (R.lod > 1) for (let k = 0; k < 30; k++) dot(ctx, -0.6 + 1.2 * hr(k, P.salt), -0.6 + 1.3 * hr(k, P.salt + 1), 0.012, 'rgba(255,255,255,0)');
    } else { // 말미잘
      const top = -0.05 - 0.15 * g.len, w = 0.24 + 0.1 * g.wid, N = R.lod > 1 ? 22 : R.lod ? 16 : 10;
      for (let k = 0; k < N; k++) {
        const u = k / (N - 1) - 0.5, a = -PI / 2 + u * 2.6 + Math.sin(t * 1.4 + k) * 0.12, L = 0.45 + 0.25 * g.limbL * (1 - Math.abs(u));
        const x0 = u * w * 1.5, pts = [[x0, top], [x0 + Math.cos(a) * L * 0.5, top + Math.sin(a) * L * 0.5 + 0.03], [x0 + Math.cos(a + 0.25) * L, top + Math.sin(a + 0.25) * L]];
        limb(ctx, pts, 0.05 * (1.2 - Math.abs(u)), k % 2 ? P.acc : P.light, P.accLine, true);
      }
      const col = spath([[-w * 1.15, 0.86], [-w, 0.4], [-w * 1.1, top + 0.05], [w * 1.1, top + 0.05], [w, 0.4], [w * 1.15, 0.86]]);
      skin(ctx, col, P.fill, P.line, top, 0.86, (c) => boxPat(c, -w * 1.2, top, w * 1.2, 0.86, P));
      const disc = ell(0, top + 0.02, w * 1.12, w * 0.32);
      skin(ctx, disc, P.acc, P.accLine, top - 0.1, top + 0.1);
      dot(ctx, 0, top + 0.03, w * 0.22, css(P.a, -0.25));
    }
  }
  function drawJelly(ctx, P) {
    const g = P.g, t = R.t, pulse = 1 + 0.06 * Math.sin(t * 3);
    glow(ctx, 0, -0.2, 1, P.light, 0.16);
    if (P.form === 0) { // 해파리
      const B = (0.5 + 0.14 * g.wid) * pulse, H = (0.42 + 0.18 * g.round) / pulse, cy = -0.32, by = cy + H * 0.55;
      const nT = 8 + g.seg, q = new Path2D();
      for (let k = 0; k < nT; k++) {
        const x0 = -B * 0.92 + (1.84 * B * k) / (nT - 1);
        q.moveTo(x0, by);
        for (let j = 1; j <= 8; j++) q.lineTo(x0 + Math.sin(t * 2 + j * 0.9 + k) * 0.05 * j * 0.3, by + (j / 8) * (0.95 - by) * (0.75 + 0.25 * hr(k, P.salt)));
      }
      strokeP(ctx, q, css(P.c, 0.1, 0, 0.6), Math.max(PX(0.8), 0.012));
      for (let k = 0; k < 4; k++) {
        const x0 = (k - 1.5) * B * 0.18, pts = [];
        for (let j = 0; j <= 6; j++) pts.push([x0 + Math.sin(t * 1.6 + j + k * 2) * 0.06 + (k - 1.5) * j * 0.02, by - 0.05 + j * 0.11]);
        const wt = pts.map((_, j) => 0.05 * (1 - j / 8)), S = { pts, wt, wb: wt };
        const p = spath(tube(S, 0.5, 0.8));
        ctx.fillStyle = css(P.a, 0.05, 0, 0.7); ctx.fill(p); outline(ctx, p, P.accLine, 0.7);
      }
      const bell = new Path2D();
      bell.moveTo(-B, by);
      bell.bezierCurveTo(-B * 1.05, cy - H * 0.9, B * 1.05, cy - H * 0.9, B, by);
      const lap = 8;
      for (let k = lap - 1; k >= 0; k--) { const x1 = -B + (2 * B * k) / lap; bell.quadraticCurveTo(-B + (2 * B * (k + 0.5)) / lap, by + 0.07, x1, by); }
      bell.closePath();
      ctx.fillStyle = css(P.c, 0, 0, 0.55); ctx.fill(bell);
      ctx.save(); ctx.clip(bell);
      const gr = ctx.createRadialGradient(-B * 0.3, cy - H * 0.3, 0.02, 0, cy, B * 1.2);
      gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(0.5, 'rgba(255,255,255,.05)'); gr.addColorStop(1, css(P.c, -0.2, 0, 0.5));
      ctx.fillStyle = gr; ctx.fillRect(-1, -1, 2, 2);
      if (R.lod) for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + 0.4; strokeP(ctx, circ(Math.cos(a) * B * 0.32, cy + 0.05 + Math.sin(a) * H * 0.15, B * 0.13), P.acc, B * 0.06); }
      ctx.restore();
      outline(ctx, bell, css(P.c, -0.2, 0, 0.9));
      if (R.lod) for (let k = 0; k <= lap; k += 2) dot(ctx, -B + (2 * B * k) / lap, by + 0.01, 0.02, 'rgba(255,255,230,.9)');
    } else if (P.form === 1) { // 빗해파리: 무지갯빛 빗판 줄
      const rx = 0.42 + 0.1 * g.wid, ry = 0.62 + 0.1 * g.len;
      for (const sd of [-1, 1]) {
        const pts = [];
        for (let j = 0; j <= 8; j++) pts.push([sd * (rx * 0.5 + j * 0.03) + Math.sin(t * 1.5 + j) * 0.04, 0.1 + j * 0.11]);
        strokeP(ctx, spath(pts, true), css(P.c, 0.1, 0, 0.7), Math.max(PX(0.9), 0.014));
        if (R.lod > 1) for (let j = 1; j < 8; j++) strokeP(ctx, lpath([pts[j], [pts[j][0] + sd * 0.08, pts[j][1] + 0.05]]), css(P.c, 0.1, 0, 0.5), PX(0.8));
      }
      const p = ell(0, -0.12, rx, ry);
      ctx.fillStyle = css(P.c, 0.05, -0.1, 0.35); ctx.fill(p);
      for (let k = 0; k < 8; k++) {
        const f = Math.cos((k / 8) * PI + 0.2);
        for (let j = 0; j < (R.lod ? 10 : 5); j++) {
          const a = -PI / 2 + 0.3 + (j / 9) * (PI - 0.6), x = Math.cos(a) * f * rx * 0.96, y = -0.12 + Math.sin(a) * ry * 0.96;
          dot(ctx, x, y, R.lod ? 0.022 : 0.035, hsl(t * 120 + j * 40 + k * 25, 0.85, 0.65, 0.95));
        }
      }
      const gr = ctx.createRadialGradient(-rx * 0.3, -0.45, 0.02, 0, -0.12, ry);
      gr.addColorStop(0, 'rgba(255,255,255,.45)'); gr.addColorStop(0.6, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr; ctx.fill(p);
      outline(ctx, p, css(P.c, -0.15, 0, 0.75));
      dot(ctx, 0, -0.12 - ry * 0.9, 0.03, P.acc);
    } else { // 고깔해파리: 공기 주머니 + 촉수
      const q = new Path2D(), N = 10;
      for (let k = 0; k < N; k++) {
        const x0 = -0.4 + (0.85 * k) / (N - 1), L = 0.95 - 0.3 * hr(k, P.salt);
        q.moveTo(x0, -0.35);
        for (let j = 1; j <= 7; j++) q.lineTo(x0 + Math.sin(t * 1.8 + j + k) * 0.03 * j * 0.4, -0.35 + (j / 7) * (L + 0.3));
      }
      strokeP(ctx, q, css(P.a, 0, 0, 0.75), Math.max(PX(0.8), 0.013));
      for (let k = 0; k < 7; k++) { const x = -0.35 + 0.12 * k, y = -0.28 + 0.06 * hr(k, P.salt); skinR(ctx, ell(x, y, 0.06, 0.08), css(P.a, 0.08), P.accLine, x, y, 0.08); }
      const fl = spath([[-0.72, -0.42], [-0.55, -0.62], [0, -0.66], [0.55, -0.6], [0.78, -0.45], [0.55, -0.3], [0, -0.28], [-0.5, -0.3]]);
      ctx.fillStyle = css(P.c, 0, 0, 0.75); ctx.fill(fl);
      const crest = spath([[-0.45, -0.6], [-0.3, -0.92], [0, -0.82], [0.25, -0.95], [0.48, -0.6]]);
      ctx.fillStyle = css(P.a, 0.05, 0, 0.75); ctx.fill(crest); outline(ctx, crest, P.accLine, 0.8);
      ctx.save(); ctx.clip(fl);
      const gr = ctx.createLinearGradient(0, -0.68, 0, -0.28);
      gr.addColorStop(0, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(0,0,0,.2)');
      ctx.fillStyle = gr; ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
      outline(ctx, fl, css(P.c, -0.25, 0, 0.9));
    }
  }
  function drawKelp(ctx, P) {
    const g = P.g, t = R.t;
    seabed(ctx, 0, 0.9, 0.45);
    if (P.form === 0) { // 거대 켈프
      const n = 2 + (g.seg % 2);
      for (let s = 0; s < n; s++) {
        const x0 = (s - (n - 1) / 2) * 0.16, pts = [];
        for (let j = 0; j <= 8; j++) { const u = j / 8; pts.push([x0 + Math.sin(u * 3 + s * 2 + t * 0.9) * 0.1 * u + (s - (n - 1) / 2) * 0.35 * u, 0.86 - u * (1.5 - 0.15 * s)]); }
        strokeP(ctx, spath(pts, true), P.dark, Math.max(PX(1), 0.022));
        const S = spineOf(pts, pts.map(() => 0), pts.map(() => 0));
        const nb = R.lod ? 9 : 6;
        for (let k = 1; k <= nb; k++) {
          const q = spineAt(S, (S.len * k) / (nb + 0.5)), sd = k % 2 ? 1 : -1, a = -PI / 2 + sd * (0.75 + 0.15 * Math.sin(t + k)), L = 0.32 + 0.12 * g.len;
          drawLeaf(ctx, P, q[0], q[1], a, L, 0.06 + 0.03 * g.wid, 2, k % 3 ? P.fill : P.light, R.lod > 1 ? 0.12 : 0);
          if (R.lod) skinR(ctx, circ(q[0] + Math.cos(a) * 0.02, q[1] + Math.sin(a) * 0.02, 0.028), P.light, P.line, q[0], q[1], 0.03);
        }
      }
      holdfast(ctx, P, 0, 0.88);
    } else if (P.form === 1) { // 공기주머니 켈프
      const bx = 0.05 + Math.sin(t * 0.9) * 0.04, by = -0.3;
      strokeP(ctx, spath([[0, 0.86], [-0.08, 0.4], [0.06, -0.05], [bx, by]], true), P.dark, Math.max(PX(1), 0.03));
      const nb = 6 + (g.seg % 4);
      for (let k = 0; k < nb; k++) {
        const pts = [], a = -0.9 + (1.4 * k) / (nb - 1);
        for (let j = 0; j <= 6; j++) pts.push([bx + j * 0.125 * Math.cos(a * 0.6 - 0.2), by + j * 0.125 * Math.sin(a * 0.6 - 0.2) + Math.sin(t * 1.5 + j + k) * 0.02 * j]);
        const wt = pts.map((_, j) => 0.035 * Math.sin(PI * Math.min(0.95, 0.15 + j / 7))), S = { pts, wt, wb: wt };
        const p = spath(tube(S, 0.6, 0.8));
        ctx.fillStyle = k % 2 ? P.fill : P.light; ctx.fill(p); outline(ctx, p, P.line, 0.7);
      }
      skinR(ctx, circ(bx, by, 0.11 + 0.04 * g.round), P.fill, P.line, bx, by, 0.13);
      holdfast(ctx, P, 0, 0.88);
    } else { // 야자 모양 해조
      const pts = [[0, 0.86], [0.03, 0.4], [-0.02, 0], [0.04, -0.3]], wt = [0.07, 0.055, 0.045, 0.04];
      const p = spath(tube({ pts, wt, wb: wt }, 0.3, 0.6));
      skin(ctx, p, P.dark, P.line, -0.3, 0.86);
      const nb = 10 + (g.seg % 5);
      for (let k = 0; k < nb; k++) {
        const u = k / (nb - 1) - 0.5, a = -PI / 2 + u * 3 + Math.sin(t + k) * 0.08;
        const ex = 0.04 + Math.cos(a) * 0.5, ey = -0.3 + Math.sin(a) * 0.35, pts2 = [[0.04, -0.3], [(0.04 + ex) / 2, (ey - 0.3) / 2 - 0.12], [ex + u * 0.2, ey + 0.35]];
        const S = spineOf(pts2, [0.012, 0.045, 0.01], [0.012, 0.045, 0.01]);
        const q = spath(tube(S, 0.5, 0.7));
        ctx.fillStyle = k % 2 ? P.fill : P.light; ctx.fill(q); outline(ctx, q, P.line, 0.7);
      }
    }
  }
  function drawPlant(ctx, P) {
    const g = P.g, t = R.t, sway = (k) => Math.sin(t * 0.9 + k) * 0.04;
    const trunkC = 'hsla(26,32%,30%,1)', trunkL = 'hsla(26,35%,12%,.95)', flower = P.acc;
    if (P.form !== 0) ground(ctx, 0, 0.9, 0.75, 'hsla(28,28%,24%,.9)');
    if (P.form === 0) { // 고사리
      const n = 5 + (g.seg % 4);
      const frondPts = (k, sw) => {
        const u = n > 1 ? k / (n - 1) - 0.5 : 0, a = -PI / 2 + u * (2.2 + 0.4 * g.branch) + sw, L = 1.25 + 0.25 * hr(k, P.salt) - 0.3 * Math.abs(u);
        const c = Math.cos(a), s = Math.sin(a), bend = 0.35 * Math.sign(u || 0.01);
        const pts = []; for (let j = 0; j <= 6; j++) { const v = j / 6; pts.push([c * v * L + bend * v * v * 0.35, 0.86 + s * v * L + v * v * 0.35]); }
        return pts;
      };
      // 활짝 펼친 잎이 상자 안에 들어오도록 실제 범위에 맞춘다 (흔들림 없는 모양 기준 → 움직여도 크기가 일정)
      const b = BB(); bbAdd(b, -0.62, 0.9, 0.14); bbAdd(b, 0.62, 0.9, 0.14);
      for (let k = 0; k < n; k++) for (const p of frondPts(k, 0)) bbAdd(b, p[0], p[1], 0.2);
      fit(ctx, b[0], b[1], b[2], b[3], 0.94);
      ground(ctx, 0, 0.9, 0.75, 'hsla(28,28%,24%,.9)');
      const frond = (k, back) => {
        const pts = frondPts(k, sway(k));
        if (!R.lod) { frondBlob(ctx, P, pts, 0.15, back ? P.dark : P.fill); return; } // 지도 크기: 작은 잎 수십 장 대신 한 덩어리
        strokeP(ctx, spath(pts, true), back ? P.line : P.dark, Math.max(PX(1), 0.02));
        const S = spineOf(pts, pts.map(() => 0), pts.map(() => 0)), np = R.lod > 1 ? 14 : 9;
        for (let j = 1; j < np; j++) {
          const q = spineAt(S, (S.len * j) / np), ll = 0.2 * (1 - j / np) + 0.04;
          for (const sd of [-1, 1]) drawLeaf(ctx, P, q[0], q[1], Math.atan2(q[7], q[6]) + sd * 1.15, ll, ll * 0.32, 1, back ? P.dark : P.fill);
        }
      };
      for (let k = 0; k < n; k += 2) frond(k, true);
      for (let k = 1; k < n; k += 2) frond(k, false);
      if (R.lod) { const q = new Path2D(); q.arc(0.04, 0.62, 0.06, 0, PI * 1.6); q.arc(0.06, 0.6, 0.03, PI * 1.6, PI * 3.2); strokeP(ctx, q, P.fill, 0.025); strokeP(ctx, lpath([[0.1, 0.62], [0.08, 0.86]]), P.fill, 0.025); }
    } else if (P.form === 1 || (P.form === 2 && g.leaf % 2 === 0)) {
      const conifer = P.form === 2, H = 0.6 + 0.25 * P.sz;
      const tw = conifer ? 0.06 : 0.08 + 0.03 * g.wid, top = 0.9 - (conifer ? 1.75 : 1.2) * H;
      const tr = spath(tube({ pts: [[0, 0.9], [0.02, 0.5], [-0.02, 0.2], [0, top + 0.2]], wt: [tw * 1.3, tw, tw * 0.8, tw * 0.5], wb: [tw * 1.3, tw, tw * 0.8, tw * 0.5] }, 0.2, 0.5));
      skin(ctx, tr, trunkC, trunkL, -0.5, 0.9);
      if (conifer) { // 침엽수: 층층이 쌓인 삼각 가지
        const tiers = 4 + (g.seg % 3), dk = { ...P, fill: hsl(P.c[0] + 15, P.c[1] * 0.8, P.c[2] * 0.85) };
        for (let i = 0; i < tiers; i++) {
          const u = i / (tiers - 1), y = 0.62 - u * (0.62 - top), w = 0.62 * (1 - u * 0.75) * (0.85 + 0.3 * g.wid), h = 0.42 * (1 - u * 0.4);
          const pts = [[0, y - h]], z = 6;
          for (let k = 0; k <= z; k++) { const x = w - (2 * w * k) / z; pts.push([x, y + (k % 2 ? -0.04 : 0.02) + Math.abs(x) * 0.08]); }
          const p = lpath(pts, true);
          skin(ctx, p, i % 2 ? dk.fill : P.fill, P.line, y - h, y);
        }
        if (g.bloom > 0.5 && R.lod) for (let k = 0; k < 5; k++) { const x = (hr(k, P.salt) - 0.5) * 0.7, y = top + 0.2 + 0.8 * hr(k, P.salt + 1); skinR(ctx, ell(x, y, 0.025, 0.04), 'hsla(25,45%,35%,1)', trunkL, x, y, 0.04); }
      } else { // 활엽수: 뭉게뭉게 수관
        const nb = 1 + Math.floor(g.branch * 3);
        for (let k = 0; k < nb; k++) { const sd = k % 2 ? 1 : -1, y = 0.25 - 0.1 * k; limb(ctx, [[0, y], [sd * (0.18 + 0.08 * k), y - 0.2], [sd * (0.3 + 0.05 * k), y - 0.32]], 0.04, trunkC, trunkL, true); }
        const cy = top + 0.05, blobs = [];
        const n = 7 + (g.seg % 3);
        for (let k = 0; k < n; k++) { const a = (k / n) * TAU + 0.3, d = 0.28 + 0.06 * hr(k, P.salt); blobs.push([Math.cos(a) * d * (1 + 0.3 * g.wid), cy + Math.sin(a) * d * 0.7, 0.24 + 0.08 * hr(k, P.salt + 1)]); }
        blobs.push([0, cy - 0.05, 0.34]);
        blobs.sort((a, b) => a[1] - b[1]);
        for (const [x, y, r] of blobs) skinR(ctx, circ(x, y + sway(x * 3), r), y < cy ? P.light : P.fill, P.line, x, y, r);
        if (R.lod > 1) for (let k = 0; k < 26; k++) { const x = (hr(k, P.salt + 7) - 0.5) * 1.1, y = cy + (hr(k, P.salt + 8) - 0.5) * 0.7; dot(ctx, x, y, 0.018, 'rgba(255,255,255,.18)'); }
        if (g.bloom > 0.4) { const nf = Math.round(4 + g.bloom * 14) * (R.lod ? 1 : 0.5); for (let k = 0; k < nf; k++) { const x = (hr(k, P.salt + 2) - 0.5) * 1.0, y = cy + (hr(k, P.salt + 3) - 0.5) * 0.62, r = R.lod ? 0.035 : 0.06; skinR(ctx, circ(x, y, r), flower, P.accLine, x, y, r); } }
      }
    } else if (P.form === 2) { // 야자
      const pts = [[0, 0.9], [0.06, 0.4], [0.15, -0.05], [0.24, -0.35]], wt = [0.07, 0.06, 0.055, 0.05];
      const tr = spath(tube({ pts, wt, wb: wt }, 0.2, 0.5));
      skin(ctx, tr, trunkC, trunkL, -0.4, 0.9, (c) => { if (!R.lod) return; const S = spineOf(pts, wt, wt); for (let k = 1; k < 14; k++) { const q = spineAt(S, (S.len * k) / 14); strokeP(c, lpath([[q[0] + q[2] * 0.08, q[1] + q[3] * 0.08], [q[0] - q[2] * 0.08, q[1] - q[3] * 0.08]]), 'rgba(0,0,0,.3)', PX(1)); } });
      const n = 7 + (g.seg % 3), cx = 0.24, cy = -0.36;
      if (g.bloom > 0.5) for (let k = 0; k < 3; k++) skinR(ctx, circ(cx - 0.05 + k * 0.05, cy + 0.06, 0.05), 'hsla(30,40%,30%,1)', trunkL, cx, cy, 0.05);
      for (let k = 0; k < n; k++) {
        const a = -PI / 2 + (k / (n - 1) - 0.5) * 3.6 + sway(k), L = 0.6 + 0.1 * hr(k, P.salt);
        const pts2 = []; for (let j = 0; j <= 5; j++) { const v = j / 5; pts2.push([cx + Math.cos(a) * v * L, cy + Math.sin(a) * v * L + v * v * 0.3]); }
        if (!R.lod) { frondBlob(ctx, P, pts2, 0.11, k % 2 ? P.fill : P.light); continue; } // 지도 크기: 깃털 잎 한 덩어리
        strokeP(ctx, spath(pts2, true), P.dark, Math.max(PX(1), 0.018));
        const S = spineOf(pts2, pts2.map(() => 0), pts2.map(() => 0)), np = R.lod > 1 ? 12 : 7;
        for (let j = 1; j < np; j++) { const q = spineAt(S, (S.len * j) / np); for (const sd of [-1, 1]) drawLeaf(ctx, P, q[0], q[1], Math.atan2(q[7], q[6]) + sd * 0.9 + 0.35, 0.17, 0.035, 2, k % 2 ? P.fill : P.light); }
      }
    } else { // 꽃 피는 풀
      const n = 3 + (g.seg % 3), lk = g.leaf;
      const stems = [];
      for (let k = 0; k < n; k++) {
        const u = n > 1 ? k / (n - 1) - 0.5 : 0, h = 0.95 + 0.6 * hr(k, P.salt) * (0.5 + P.sz), tx = u * (0.8 + 0.4 * g.branch) + sway(k);
        const pts = [[u * 0.1, 0.88], [u * 0.3, 0.88 - h * 0.45], [tx, 0.88 - h]];
        stems.push(pts);
        strokeP(ctx, spath(pts, true), P.dark, Math.max(PX(1), 0.024));
        const S = spineOf(pts, [0, 0, 0], [0, 0, 0]);
        for (let j = 1; j <= 3; j++) {
          const q = spineAt(S, S.len * (0.15 + 0.22 * j)), sd = (j + k) % 2 ? 1 : -1, ll = (0.3 - 0.04 * j) * (lk === 2 ? 1.3 : 1);
          drawLeaf(ctx, P, q[0], q[1], Math.atan2(q[7], q[6]) + sd * 1.0, ll, ll * (lk === 2 ? 0.18 : lk === 0 ? 0.42 : 0.32), lk, (j + k) % 2 ? P.fill : P.light);
        }
      }
      const petals = 4 + (g.seg % 5), fr2 = 0.1 + 0.08 * g.bloom;
      stems.forEach((pts, k) => {
        const [x, y] = pts[2];
        if (g.bloom < 0.2 && k % 2) { skinR(ctx, ell(x, y, 0.035, 0.055), P.fill, P.line, x, y, 0.05); return; }
        if (!R.lod) { // 작은 그림: 꽃잎을 한 덩어리로
          const fp = new Path2D();
          for (let j = 0; j < petals; j++) { const a = (j / petals) * TAU + k, ex = x + Math.cos(a) * fr2 * 0.6, ey = y + Math.sin(a) * fr2 * 0.6; fp.moveTo(ex + Math.cos(a) * fr2 * 0.62, ey + Math.sin(a) * fr2 * 0.62); fp.ellipse(ex, ey, fr2 * 0.62, fr2 * 0.32, a, 0, TAU); }
          ctx.fillStyle = flower; ctx.fill(fp); outline(ctx, fp, P.accLine, 0.6); dot(ctx, x, y, fr2 * 0.32, hsl(48, 0.85, 0.55));
          return;
        }
        for (let j = 0; j < petals; j++) {
          const a = (j / petals) * TAU + k, p = ell(x + Math.cos(a) * fr2 * 0.6, y + Math.sin(a) * fr2 * 0.6, fr2 * 0.62, fr2 * 0.32, a);
          skin(ctx, p, flower, P.accLine, y - fr2, y + fr2, null, 0.6);
        }
        const cdisc = circ(x, y, fr2 * 0.32);
        skinR(ctx, cdisc, hsl(48, 0.85, 0.55), 'hsla(30,60%,20%,.9)', x, y, fr2 * 0.3);
      });
    }
  }

  /* ================= 절지동물·연체동물·환형동물 (대개 위에서 본 모습, 머리는 오른쪽) ================= */
  // 다리 하나: (x, y)에서 바깥쪽(sd: -1 위 / +1 아래)으로. th = 앞쪽으로 기운 각도, segs = [[길이, 꺾임]...]
  function bugLeg(ctx, x, y, sd, th, segs, w, P, ph) {
    const pts = [[x, y]];
    let a = th + Math.sin(R.t * 8 + ph) * 0.12, px = x, py = y;
    for (const [L, bend] of segs) {
      px += Math.sin(a) * L; py += sd * Math.cos(a) * L;
      pts.push([px, py]);
      a += bend;
    }
    limb(ctx, pts, w, P.dark, P.line);
    return pts[pts.length - 1];
  }
  function antenna(ctx, x, y, sd, a, L, w, P, club, wave) {
    const pts = [];
    for (let j = 0; j <= 5; j++) { const u = j / 5, aa = a + u * 0.5 + Math.sin(R.t * 2 + j) * (wave || 0.02); pts.push([x + Math.cos(aa) * L * u, y + sd * Math.sin(aa) * L * u]); }
    limb(ctx, pts, w, P.dark, P.line, true);
    if (club) { const e = pts[5]; skinR(ctx, ell(e[0], e[1], w * 2.8, w * 1.9, Math.atan2(e[1] - pts[4][1], e[0] - pts[4][0])), P.dark, P.line, e[0], e[1], w * 2.5); }
  }
  // 더듬이 한 쌍(위·아래 대칭)의 끝 범위: antenna(ctx, x, ±y0, sd, a, L) 와 같은 곡선
  function antBB(b, x, y0, a, L, r) {
    for (let j = 0; j <= 5; j += 5) { const u = j / 5, aa = a + u * 0.5; for (const sd of [-1, 1]) bbAdd(b, x + Math.cos(aa) * L * u, sd * (y0 + Math.sin(aa) * L * u), r); }
  }
  function gloss(ctx, x, y, rx, ry, rot, a) { ctx.fillStyle = 'rgba(255,255,255,' + (a || 0.35) + ')'; ctx.fill(ell(x, y, rx, ry, rot)); }

  function drawBeetle(ctx, P) {
    const g = P.g, W = 0.32 + 0.2 * g.wid, LL = 0.8 + 0.5 * g.limbL, stag = g.mouth === 1 && g.spike > 0.5, rhino = g.horn === 1;
    const AL = 0.3 + 0.45 * g.ant, club = g.ant < 0.4;
    const b = BB(); bbAdd(b, -0.95, -W - 0.4 * LL, 0); bbAdd(b, 0.95 + (stag ? 0.25 : rhino ? 0.15 : 0), W + 0.4 * LL, 0);
    antBB(b, 0.8, W * 0.22, -0.55, AL, club ? 0.07 : 0.03);
    fit(ctx, b[0], b[1], b[2], b[3]);
    // 다리 세 쌍: 앞·가운데 다리는 앞가슴 옆에서, 뒷다리는 겉날개 가장자리 가까이에서 바깥·뒤로 뻗어 날개 밖으로 드러난다
    const legs = [[0.46, 0.75, 0.45, [[0.2, 0.45], [0.24, 0.4], [0.12, 0]]], [0.25, 0.05, 0.6, [[0.2, 0.03], [0.24, 0.4], [0.12, 0]]], [0.08, -0.3, 0.72, [[0.24, -0.45], [0.26, -0.3], [0.13, 0]]]];
    legs.forEach(([x, th, yb, sg], i) => { for (const sd of [-1, 1]) bugLeg(ctx, x, sd * W * yb, sd, th, sg.map(([l, bd]) => [l * LL, bd]), 0.045, P, i * PI + (sd > 0 ? PI : 0)); });
    for (const sd of [-1, 1]) antenna(ctx, 0.8, sd * W * 0.22, sd, -0.55, AL, 0.022, P, club);
    if (stag) for (const sd of [-1, 1]) { const m = spath([[0.74, sd * 0.06], [0.95, sd * 0.2], [1.12, sd * 0.12], [1.18, sd * 0.02], [1.08, sd * 0.06], [0.98, sd * 0.1], [0.82, sd * 0.03]]); skin(ctx, m, P.dark, P.line, -0.2, 0.2); }
    const head = ell(0.68, 0, 0.15, W * 0.42);
    skinR(ctx, head, P.dark, P.line, 0.68, 0, 0.15);
    if (rhino) { const h = spath([[0.7, -0.05], [0.95, -0.04], [1.08, -0.08], [1.06, 0], [1.08, 0.08], [0.95, 0.04], [0.7, 0.05]]); skin(ctx, h, P.dark, P.line, -0.1, 0.1); }
    for (const sd of [-1, 1]) eye(ctx, 0.74, sd * W * 0.32, 0.05, P, 'compound');
    const pro = spath([[0.28, -W * 0.82], [0.5, -W * 0.7], [0.6, -W * 0.45], [0.62, 0], [0.6, W * 0.45], [0.5, W * 0.7], [0.28, W * 0.82], [0.24, 0]]);
    skinR(ctx, pro, P.fill, P.line, 0.44, 0, W * 0.8, null, 0.8);
    const ely = spath([[0.27, -W * 0.86], [0.05, -W], [-0.45, -W * 0.98], [-0.82, -W * 0.55], [-0.94, 0], [-0.82, W * 0.55], [-0.45, W * 0.98], [0.05, W], [0.27, W * 0.86], [0.29, 0]]);
    const metal = g.sat > 0.72;
    skinR(ctx, ely, P.fill, P.line, -0.3, 0, 0.75, (c) => {
      if (metal) { const gr = c.createLinearGradient(-0.9, -W, 0.3, W); gr.addColorStop(0, css(P.a, 0, 0, 0.55)); gr.addColorStop(0.5, 'rgba(0,0,0,0)'); gr.addColorStop(1, css(P.a, 0.1, 0, 0.45)); c.fillStyle = gr; c.fillRect(-1, -1, 2, 2); }
      boxPat(c, -0.92, -W, 0.28, W, P);
      if (R.lod > 1) { c.strokeStyle = 'rgba(0,0,0,.18)'; c.lineWidth = PX(1); c.beginPath(); for (const v of [-0.65, -0.35, 0.35, 0.65]) { c.moveTo(0.25, v * W); c.quadraticCurveTo(-0.4, v * W * 1.08, -0.85, v * W * 0.5); } c.stroke(); }
    });
    strokeP(ctx, lpath([[0.28, 0], [-0.92, 0]]), P.line, R.lw);
    if (R.lod) for (const sd of [-1, 1]) gloss(ctx, -0.12, sd * W * 0.5, 0.32, W * 0.12, sd * 0.05, 0.3);
  }
  // 마디가 이어진 긴 몸 (노래기·지네·갯지렁이): 머리 쪽 축을 따라 마디를 그린다
  function wormSpine(n, amp, phase, x0, x1, tt) {
    const pts = [];
    for (let i = 0; i < n; i++) { const u = i / (n - 1), x = lerp(x0, x1, u); pts.push([x, amp * Math.sin(u * PI * 1.6 + phase + tt * 1.2)]); }
    return pts;
  }
  // 마디 몸의 모양(축·다리·머리·더듬이): 그리기와 범위 계산이 같은 식을 쓴다
  function segGeo(P, kind, tt) {
    const g = P.g, n = kind === 'worm' ? 14 + 2 * g.seg : 10 + g.seg, W = (kind === 'centi' ? 0.11 : kind === 'worm' ? 0.08 : 0.095) + 0.04 * g.wid;
    const LL = kind === 'centi' ? 0.22 + 0.12 * g.limbL : kind === 'worm' ? 0.08 : 0.07;
    const pts = wormSpine(n, 0.2, 0.4, kind === 'centi' ? -0.8 : -0.92, kind === 'centi' ? 0.78 : 0.85, tt), S = spineOf(pts, pts.map(() => W), pts.map(() => W)), step = S.len / n;
    const legs = [];
    for (let i = 0; i < n; i++) {
      const q = spineAt(S, step * (i + 0.5)), ang = Math.atan2(q[7], q[6]);
      for (const sd of [-1, 1]) {
        const bx = q[0] - q[2] * sd * W * 0.8, by = q[1] - q[3] * sd * W * 0.8;
        if (kind === 'milli') {
          for (const o of [-0.25, 0.25]) { const a = ang + sd * (PI / 2) + Math.sin(tt * 9 - i * 0.8) * 0.3 - sd * 0.2, x0 = bx + q[6] * step * o, y0 = by + q[7] * step * o; legs.push([[x0, y0], [x0 + Math.cos(a) * LL, y0 + Math.sin(a) * LL]]); }
        } else if (kind === 'centi') {
          const last = i === 0, a = ang + sd * (PI / 2) + (last ? sd * 1.2 : sd * 0.45) + Math.sin(tt * 9 - i) * 0.15, L = last ? LL * 1.8 : LL;
          legs.push([[bx, by], [bx + Math.cos(a) * L * 0.5, by + Math.sin(a) * L * 0.5 - sd * 0.02], [bx + Math.cos(a + sd * 0.4) * L, by + Math.sin(a + sd * 0.4) * L]]);
        } else legs.push([bx, by, ang + sd * (PI / 2) + Math.sin(tt * 6 - i * 0.7) * 0.25]);
      }
    }
    const hq = pts[n - 1], hp = pts[n - 2], ha = Math.atan2(hq[1] - hp[1], hq[0] - hp[0]), hx = hq[0] + Math.cos(ha) * W * 0.6, hy = hq[1] + Math.sin(ha) * W * 0.6;
    const ant = kind === 'centi' ? 0.3 + 0.3 * g.ant : kind === 'worm' ? 0.18 : 0.14, aa = ha - 0.4 * (kind === 'centi' ? 1 : 0.5);
    return { n, W, LL, pts, S, step, legs, ha, hx, hy, ant, aa };
  }
  function drawSegmented(ctx, P, kind) {
    const g = P.g, t = R.t;
    // 범위는 멈춘 자세(t=0)로 재고 움직임 몫을 조금 더한다 → 살랑거려도 크기가 일정하다
    const G0 = segGeo(P, kind, 0), b = BB(), mg = 0.06;
    bbPts(b, G0.pts, G0.W * 1.1 + mg); bbAdd(b, G0.hx, G0.hy, G0.W * 1.1 + mg);
    for (const L of G0.legs) { if (kind === 'worm') bbAdd(b, L[0] + Math.cos(L[2]) * 0.17, L[1] + Math.sin(L[2]) * 0.17, mg); else bbAdd(b, L[L.length - 1][0], L[L.length - 1][1], mg + 0.02); }
    for (const sd of [-1, 1]) { const ax = G0.hx, ay = G0.hy + sd * G0.W * 0.3; bbAdd(b, ax + Math.cos(G0.aa + 0.5) * G0.ant, ay + sd * Math.sin(G0.aa + 0.5) * G0.ant, 0.04); }
    if (kind === 'centi') bbAdd(b, G0.hx + Math.cos(G0.ha) * (G0.W * 0.6 + 0.17), G0.hy, 0.06);
    fit(ctx, b[0], b[1], b[2], b[3]);
    const G = t ? segGeo(P, kind, t) : G0, { n, W, pts, S, step } = G;
    for (const L of G.legs) {
      if (kind === 'milli') limb(ctx, L, 0.02, P.light, P.line);
      else if (kind === 'centi') limb(ctx, L, 0.028, P.acc, P.accLine);
      else {
        const [bx, by, a] = L, lobe = ell(bx + Math.cos(a) * 0.04, by + Math.sin(a) * 0.04, 0.05, 0.03, a);
        ctx.fillStyle = P.fill; ctx.fill(lobe); outline(ctx, lobe, P.line, 0.7);
        if (R.lod) { const q2 = new Path2D(); for (let j = -1; j <= 1; j++) { q2.moveTo(bx + Math.cos(a) * 0.06, by + Math.sin(a) * 0.06); q2.lineTo(bx + Math.cos(a + j * 0.3) * 0.17, by + Math.sin(a + j * 0.3) * 0.17); } strokeP(ctx, q2, 'hsla(48,70%,72%,.8)', PX(0.9)); }
      }
    }
    const body = spath(tube(S, 0.8, 0.6));
    skin(ctx, body, P.fill, P.line, -0.3, 0.3, (c) => {
      c.lineWidth = Math.max(PX(1), step * (kind === 'milli' ? 0.18 : 0.12));
      c.strokeStyle = g.pat === 3 ? P.patCol : css(P.c, -0.2, 0, 0.6);
      c.beginPath();
      for (let i = 1; i < n; i++) { const q = spineAt(S, step * i); c.moveTo(q[0] + q[2] * W * 1.2, q[1] + q[3] * W * 1.2); c.lineTo(q[0] - q[2] * W * 1.2, q[1] - q[3] * W * 1.2); }
      c.stroke();
      if (g.pat && g.pat !== 3) spinePat(c, S, P, 0, 1, 0.8);
    });
    if (R.lod) { const hl = new Path2D(); smooth(hl, pts.map(([x, y]) => [x, y - W * 0.45]), false); strokeP(ctx, hl, 'rgba(255,255,255,.22)', W * 0.25); }
    const { ha, hx, hy } = G;
    if (kind === 'centi') for (const sd of [-1, 1]) {
      const fx = hx + Math.cos(ha) * W * 0.6, fy = hy + Math.sin(ha) * W * 0.6;
      limb(ctx, [[fx - Math.sin(ha) * sd * W * 0.4, fy + Math.cos(ha) * sd * W * 0.4], [fx + Math.cos(ha + sd * 0.6) * 0.12, fy + Math.sin(ha + sd * 0.6) * 0.12], [fx + Math.cos(ha - sd * 0.5) * 0.17, fy + Math.sin(ha - sd * 0.5) * 0.17]], 0.03, 'hsla(20,40%,18%,1)', P.line, true);
    }
    for (const sd of [-1, 1]) antenna(ctx, hx, hy + sd * W * 0.3, sd, G.aa, G.ant, 0.022, P, false, 0.05);
    if (kind === 'worm') for (const sd of [-1, 1]) { const pa = ell(hx + Math.cos(ha + sd * 0.5) * 0.1, hy + Math.sin(ha + sd * 0.5) * 0.1, 0.08, 0.03, ha + sd * 0.5); ctx.fillStyle = P.acc; ctx.fill(pa); outline(ctx, pa, P.accLine, 0.7); }
    const head = ell(hx, hy, W * 1.05, W * 1.0, ha);
    skinR(ctx, head, P.dark, P.line, hx, hy, W);
    for (const sd of [-1, 1]) eye(ctx, hx + Math.cos(ha) * W * 0.3 - Math.sin(ha) * sd * W * 0.5, hy + Math.sin(ha) * W * 0.3 + Math.cos(ha) * sd * W * 0.5, W * 0.24, P, 'bead');
  }
  // 등딱지형 (삼엽충·쥐며느리): 타원 방패 위에 마디선, 가운데 솟은 축엽
  function drawShield(ctx, P, kind) {
    const g = P.g, W = (kind === 'tri' ? 0.46 : 0.4) + 0.14 * g.wid, n = kind === 'tri' ? 6 + g.seg : 7, gen = kind === 'tri' ? 0.15 + 0.5 * g.spike : 0;
    const AL = kind === 'iso' ? 0.45 + 0.3 * g.ant : 0.35 + 0.3 * g.ant;
    const b = BB(); bbAdd(b, -1.0 - (kind === 'iso' ? 0.06 : 0), -W - 0.12, 0); bbAdd(b, 0.98, W + 0.12, 0);
    antBB(b, 0.88, 0.1, -0.5, AL, 0.03);
    fit(ctx, b[0], b[1], b[2], b[3]);
    const t = R.t;
    if (R.lod) for (let i = 0; i < n; i++) for (const sd of [-1, 1]) { const x = -0.5 + (0.85 * i) / (n - 1), a = sd * (PI / 2) + Math.sin(t * 8 + i) * 0.2; limb(ctx, [[x, sd * W * 0.85], [x + Math.cos(a) * 0.12 - 0.04, sd * W * 0.85 + Math.sin(a) * 0.12]], 0.025, P.light, P.line); }
    for (const sd of [-1, 1]) antenna(ctx, 0.88, sd * 0.1, sd, -0.5, AL, 0.022, P, false, 0.05);
    if (kind === 'iso') for (const sd of [-1, 1]) limb(ctx, [[-0.86, sd * 0.12], [-1.02, sd * 0.2]], 0.04, P.dark, P.line);
    if (gen) for (const sd of [-1, 1]) { const sp = spath([[0.42, sd * W * 0.7], [0.3, sd * (W + 0.05)], [-0.05 - gen * 0.5, sd * (W + 0.1)], [0.2, sd * W * 0.88]]); skin(ctx, sp, P.fill, P.line, -W, W); }
    const pts = [[0.95, 0], [0.82, -W * 0.65], [0.5, -W * 0.97], [0, -W], [-0.55, -W * 0.85], [-0.9, -W * 0.45], [-0.98, 0], [-0.9, W * 0.45], [-0.55, W * 0.85], [0, W], [0.5, W * 0.97], [0.82, W * 0.65]];
    const p = spath(pts);
    skinR(ctx, p, P.fill, P.line, 0, 0, 0.9, (c) => {
      boxPat(c, -0.95, -W, 0.45, W, P, 1.3, 0.55);
      c.strokeStyle = P.line; c.lineWidth = R.lw * 0.8;
      c.beginPath();
      for (let i = 0; i <= n; i++) { const x = -0.6 + (1.0 * i) / n; c.moveTo(x, -W * 1.1); c.quadraticCurveTo(x - 0.06, 0, x, W * 1.1); }
      if (kind === 'tri') { c.moveTo(0.42, -W); c.quadraticCurveTo(0.62, 0, 0.42, W); }
      c.stroke();
      if (kind === 'tri') {
        c.fillStyle = 'rgba(255,255,255,.14)';
        c.fill(spath([[0.85, 0], [0.75, -W * 0.25], [0.45, -W * 0.3], [-0.65, -W * 0.2], [-0.85, 0], [-0.65, W * 0.2], [0.45, W * 0.3], [0.75, W * 0.25]]));
        c.strokeStyle = css(P.c, -0.2, 0, 0.6);
        c.beginPath(); for (const sd of [-1, 1]) { c.moveTo(0.82, sd * W * 0.2); c.quadraticCurveTo(0.4, sd * W * 0.34, -0.85, sd * W * 0.15); } c.stroke();
      }
    });
    if (kind === 'tri') for (const sd of [-1, 1]) { const e = ell(0.6, sd * W * 0.48, 0.09, 0.05, sd * 0.4); ctx.fillStyle = '#1c1a22'; ctx.fill(e); if (R.lod) gloss(ctx, 0.58, sd * W * 0.48 - 0.015, 0.05, 0.015, sd * 0.4, 0.5); }
    else for (const sd of [-1, 1]) eye(ctx, 0.78, sd * W * 0.42, 0.045, P, 'bead');
  }
  function drawCrayfish(ctx, P) {
    const g = P.g, Wc = 0.2 + 0.08 * g.wid, big = g.spike > 0.4, cl = big ? 0.3 + 0.25 * g.spike : 0.14, AL = 0.6 + 0.7 * g.ant, t = R.t;
    const b = BB(); bbAdd(b, -1.0, -0.52, 0); bbAdd(b, 0.78 + cl + 0.2, 0.52, 0);
    fit(ctx, b[0], b[1], b[2], b[3]);
    for (const sd of [-1, 1]) {
      const pts = []; for (let j = 0; j <= 6; j++) { const u = j / 6, a = 0.3 + u * 1.9 + Math.sin(t * 1.5 + j) * 0.04; pts.push([0.72 + Math.cos(a) * AL * 0.35 * u * 2 - u * u * AL * 0.6, sd * (0.06 + Math.sin(a) * AL * 0.32 * u)]); }
      limb(ctx, pts, 0.016, P.dark, P.line, true);
      antenna(ctx, 0.72, sd * 0.04, sd, -0.3, 0.22, 0.014, P);
      for (let k = 0; k < 4; k++) bugLeg(ctx, 0.48 - k * 0.12, sd * Wc * 0.6, sd, 0.2 - k * 0.32, [[0.16, 0.25], [0.15, 0]], 0.028, P, k * PI);
      const a0 = [0.58, sd * Wc * 0.65], a1 = [0.7, sd * (Wc + 0.08)], a2 = [0.78 + cl * 0.1, sd * (Wc + 0.04)];
      limb(ctx, [a0, a1, a2], 0.075, P.fill, P.line);
      const hx = a2[0] + cl * 0.45, hy = a2[1] - sd * 0.02;
      const hand = ell(hx, hy, cl * 0.55, cl * 0.24, -sd * 0.15);
      skinR(ctx, hand, P.fill, P.line, hx, hy, cl * 0.5);
      for (const f of [-1, 1]) { const fx = hx + cl * 0.5, fy = hy + f * cl * 0.09; const fin = spath([[fx - 0.02, fy - f * 0.02], [fx + cl * 0.45, fy + f * cl * 0.02 - sd * 0.01], [fx + cl * 0.52, fy + f * cl * 0.08], [fx - 0.02, fy + f * cl * 0.12]]); skin(ctx, fin, P.fill, P.line, -1, 1); }
    }
    const segs = 6;
    for (let i = segs - 1; i >= 0; i--) {
      const x = -0.12 - i * 0.11, w = 0.18 - i * 0.012;
      const s = ell(x, 0, 0.085, w);
      skinR(ctx, s, i % 2 ? P.fill : P.dark, P.line, x, 0, w, (c) => boxPat(c, x - 0.1, -w, x + 0.1, w, P, 0.4));
    }
    for (const [a, l] of [[0, 0.24], [0.38, 0.22], [-0.38, 0.22], [0.75, 0.2], [-0.75, 0.2]]) {
      const ex = -0.76 - Math.cos(a) * l, ey = Math.sin(a) * l * 0.9;
      const f = spath([[-0.76, 0], [(ex - 0.76) / 2, ey / 2 - 0.05], [ex, ey], [(ex - 0.76) / 2, ey / 2 + 0.05]]);
      skin(ctx, f, P.light, P.line, -0.3, 0.3);
    }
    const car = spath([[0.86, 0], [0.66, -0.05], [0.55, -Wc * 0.95], [0.2, -Wc], [-0.06, -Wc * 0.8], [-0.08, 0], [-0.06, Wc * 0.8], [0.2, Wc], [0.55, Wc * 0.95], [0.66, 0.05]]);
    skinR(ctx, car, P.fill, P.line, 0.3, 0, 0.5, (c) => { boxPat(c, -0.08, -Wc, 0.66, Wc, P); if (R.lod) { c.strokeStyle = P.line; c.lineWidth = R.lw * 0.7; c.beginPath(); c.moveTo(0.42, -Wc); c.quadraticCurveTo(0.34, 0, 0.42, Wc); c.stroke(); } });
    for (const sd of [-1, 1]) { limb(ctx, [[0.66, sd * 0.04], [0.74, sd * 0.1]], 0.025, P.fill, P.line); eye(ctx, 0.75, sd * 0.11, 0.035, P, 'bead'); }
  }
  function drawSnail(ctx, P) {
    const g = P.g, t = R.t, cone = bit0(g), Rs = 0.5 + 0.1 * g.wid, cx = -0.12, cy = cone ? 0.05 : -0.02;
    ground(ctx, 0, 0.62, 0.9);
    const foot = spath([[-0.78, 0.58], [-0.6, 0.45], [0, 0.4], [0.55, 0.36], [0.8, 0.3], [0.92, 0.42], [0.85, 0.6], [0.2, 0.64]]);
    skin(ctx, foot, P.belly, P.line, 0.3, 0.64);
    for (const [dx, h, r] of [[0.62, 0.42, 0.028], [0.8, 0.22, 0.02]]) {
      const tip = [0.75 + dx * 0.25 + Math.sin(t * 2 + dx) * 0.02, 0.3 - h];
      limb(ctx, [[0.72, 0.36], [(0.72 + tip[0]) / 2 + 0.02, (0.36 + tip[1]) / 2], tip], 0.035, P.belly, P.line, true);
      if (r > 0.025) eye(ctx, tip[0], tip[1], r, P, 'bead');
    }
    if (g.horn !== 0) limb(ctx, [[0.55, 0.36], [0.6, 0.05], [0.7, -0.12]], 0.05, P.belly, P.line, true);
    const shellCol = P.acc;
    if (!cone) {
      const pts = [], turns = 2.6, k = Math.log(7) / (turns * TAU);
      for (let i = 0; i <= 60; i++) { const th = (i / 60) * turns * TAU, r = Rs * Math.exp(-k * th); pts.push([cx + Math.cos(th + 0.3) * r, cy + Math.sin(th + 0.3) * r * 0.95]); }
      const disc = ell(cx, cy, Rs, Rs * 0.95);
      skinR(ctx, disc, shellCol, P.accLine, cx, cy, Rs, (c) => {
        if (g.pat) { c.strokeStyle = P.patCol; c.lineWidth = Rs * 0.08 * (0.6 + g.patS); for (let j = 1; j <= 3; j++) { const q = new Path2D(); smooth(q, pts.filter((_, i) => i % 3 === 0).map(([x, y]) => [cx + (x - cx) * (1 - j * 0.12), cy + (y - cy) * (1 - j * 0.12)]), false); c.stroke(q); } }
      });
      strokeP(ctx, spath(pts.slice(18), true), P.accLine, Math.max(R.lw, Rs * 0.03));
      if (R.lod > 1) { const q = new Path2D(); for (let i = 0; i < 18; i++) { const th = (i / 18) * TAU, r0 = Rs * 0.55; q.moveTo(cx + Math.cos(th) * r0, cy + Math.sin(th) * r0); q.lineTo(cx + Math.cos(th) * Rs * 0.97, cy + Math.sin(th) * Rs * 0.92); } strokeP(ctx, q, 'rgba(0,0,0,.12)', PX(1)); }
    } else {
      const wh = 4, base = 0.42;
      for (let i = 0; i < wh; i++) {
        const u = i / wh, r = Rs * (1 - u * 0.68), x = cx - u * 0.25, y = base - 0.18 - u * 0.75;
        const w = spath([[x - r, y + r * 0.2], [x - r * 0.6, y - r * 0.45], [x + r * 0.5, y - r * 0.5], [x + r, y + r * 0.1], [x + r * 0.3, y + r * 0.5], [x - r * 0.6, y + r * 0.5]]);
        skinR(ctx, w, shellCol, P.accLine, x, y, r, (c) => boxPat(c, x - r, y - r, x + r, y + r, P, 0.5));
      }
      dot(ctx, cx - 0.25, base - 0.18 - 0.75 - 0.05, 0.03, P.accLine);
    }
    if (g.spike > 0.65 && R.lod) for (let i = 0; i < 7; i++) { const a = -PI * 0.9 + i * 0.32, r = Rs * (cone ? 0.85 : 1); const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.95; limb(ctx, [[x, y], [x + Math.cos(a) * 0.12, y + Math.sin(a) * 0.12]], 0.035, shellCol, P.accLine); }
  }
  function drawFlyer(ctx, P) {
    const g = P.g, t = R.t, fly = g.mouth === 4, WL = 0.55 + 0.45 * g.wing, flap = Math.sin(t * 14) * 0.12;
    const b = BB(); bbAdd(b, -0.98, -WL * 0.95 - 0.05, 0); bbAdd(b, 0.7, WL * 0.95 + 0.05, 0);
    antBB(b, 0.64, 0.03, -0.45, 0.25 + 0.4 * g.ant, fly ? 0.05 : 0.025);
    for (const back of [true, false]) for (const fl of [-0.12, 0.12]) for (const sd of [-1, 1]) {
      const ang = back ? (fly ? 0.15 : -0.55) : (fly ? -0.55 : -0.95), x0 = back ? 0.26 : 0.36, L = WL * (back ? (fly ? 0.82 : 0.9) : 1);
      if (fly && !back) { const a = sd * (ang + fl); bbAdd(b, x0 - Math.sin(a) * L + 0.05, sd * Math.cos(a) * L, 0.05); }
      else { const dir = sd * (PI / 2 + ang) + fl; bbAdd(b, x0 + Math.cos(dir) * L, Math.sin(dir) * L, 0.06); }
    }
    fit(ctx, b[0], b[1], b[2], b[3]);
    const legs = [[0.42, 0.7], [0.32, 0.05], [0.24, -0.7]];
    legs.forEach(([x, th], i) => { for (const sd of [-1, 1]) bugLeg(ctx, x, sd * 0.06, sd, th, [[0.18, th >= 0 ? 0.4 : -0.4], [0.22, 0]], 0.022, P, i * PI + sd); });
    const wing = (sd, back, ang) => {
      const a = sd * (ang + flap), x0 = back ? 0.26 : 0.36, L = WL * (back ? (fly ? 0.82 : 0.9) : 1), Wd = fly ? (back ? 0.32 : 0.3) * WL : 0.1 + 0.05 * g.wid;
      const c = Math.cos(PI / 2 + a), s = Math.sin(PI / 2 + a);
      const pts = fly && !back
        ? [[x0, 0], [x0 + c * L * 0.3 + 0.12, sd * Math.abs(s) * L * 0.3], [x0 + c * L + 0.05, sd * Math.abs(s) * L], [x0 + c * L - Wd * 0.8, sd * Math.abs(s) * L * 0.95], [x0 - Wd * 0.6, sd * Math.abs(s) * L * 0.4]]
        : leafPts(x0, 0, (sd < 0 ? -1 : 1) * (PI / 2 + ang + flap * sd) + (sd < 0 ? 0 : 0), L, Wd, fly ? 0 : 2, 0);
      const p = spath(pts);
      if (fly) {
        skin(ctx, p, back ? css(P.a, -0.06) : P.acc, P.accLine, -WL, WL, (c2) => {
          boxPat(c2, -WL, -WL, WL, WL, { ...P, patCol: P.patCol });
          if (R.lod) { const ex = x0 + c * L * 0.6, ey = sd * Math.abs(s) * L * 0.6; dot(c2, ex, ey, Wd * 0.28, '#14121a'); dot(c2, ex, ey, Wd * 0.18, P.fill); dot(c2, ex - Wd * 0.05, ey - Wd * 0.05, Wd * 0.06, '#fff'); }
          c2.fillStyle = 'rgba(0,0,0,.35)'; c2.fill(circ(x0, 0, WL * 0.25));
        }, 0.5);
      } else {
        ctx.fillStyle = 'rgba(225,240,255,.32)'; ctx.fill(p);
        if (R.lod) { const q = new Path2D(); const d = pts.length >> 1; for (let i = 1; i < d; i += 2) { q.moveTo(x0, 0); q.lineTo(pts[i][0], pts[i][1]); } strokeP(ctx, q, 'rgba(40,50,70,.35)', PX(0.8)); }
        outline(ctx, p, 'rgba(30,40,60,.7)', 0.8);
      }
    };
    for (const sd of [-1, 1]) { wing(sd, true, fly ? 0.15 : -0.55); wing(sd, false, fly ? -0.55 : -0.95); }
    const ab = spath(tube({ pts: [[-0.95, 0], [-0.6, 0], [-0.2, 0], [0.18, 0]], wt: [0.02, 0.09 + 0.04 * g.wid, 0.12 + 0.04 * g.wid, 0.08], wb: [0.02, 0.09 + 0.04 * g.wid, 0.12 + 0.04 * g.wid, 0.08] }, 0.8, 0.5));
    skin(ctx, ab, P.fill, P.line, -0.14, 0.14, (c) => {
      c.fillStyle = g.pat ? P.patCol : css(P.c, -0.18, 0, 0.6);
      for (let i = 0; i < 6; i++) c.fillRect(-0.85 + i * 0.17, -0.2, 0.06, 0.4);
    });
    const th = ell(0.33, 0, 0.16, 0.12);
    skinR(ctx, th, P.dark, P.line, 0.33, 0, 0.15);
    const hd = circ(0.56, 0, 0.1);
    skinR(ctx, hd, P.dark, P.line, 0.56, 0, 0.1);
    for (const sd of [-1, 1]) { eye(ctx, 0.6, sd * 0.07, 0.065, P, 'compound'); antenna(ctx, 0.64, sd * 0.03, sd, -0.45, 0.25 + 0.4 * g.ant, 0.016, P, fly); }
    if (fly && R.lod) { const q = new Path2D(); q.moveTo(0.66, 0); q.quadraticCurveTo(0.76, 0.02, 0.74, 0.06); q.arc(0.72, 0.06, 0.02, 0, PI * 1.6); strokeP(ctx, q, P.line, PX(1.2)); }
  }
  function drawSquid(ctx, P) {
    const g = P.g, t = R.t, ML = 1.0 + 0.2 * g.len, Wm = 0.2 + 0.07 * g.wid, AL = 0.45 + 0.25 * g.limbL;
    const b = BB(); bbAdd(b, -ML + 0.05, -Wm - 0.25, 0); bbAdd(b, 0.45 + AL * 1.45, Wm + 0.22, 0);
    fit(ctx, b[0], b[1], b[2], b[3]);
    const x0 = 0.42;
    for (let k = 0; k < 10; k++) { // 팔 8개 + 긴 촉완 2개
      const ten = k >= 8, off = ten ? (k === 8 ? -0.05 : 0.05) : (k / 7 - 0.5) * 0.24, L = ten ? AL * 1.45 : AL * (0.8 + 0.2 * hr(k, P.salt)), pts = [];
      for (let j = 0; j <= 6; j++) { const u = j / 6; pts.push([x0 + u * L, off * (1 + u * 1.8) + Math.sin(t * 2.4 + j * 0.8 + k) * 0.035 * u]); }
      const wt = pts.map((_, j) => (ten ? 0.025 : 0.05) * (1 - (j / 6) * 0.8));
      if (ten) { const e = pts[6]; skinR(ctx, ell(e[0] - 0.04, e[1], 0.07, 0.035), P.dark, P.line, e[0], e[1], 0.06); }
      const p = spath(tube({ pts, wt, wb: wt }, 0.3, 0.6));
      skin(ctx, p, k % 2 ? P.fill : P.dark, P.line, -0.2, 0.2);
    }
    const fin = spath([[-ML + 0.05, 0], [-ML + 0.25, -Wm - 0.2 - 0.1 * g.fin], [-ML + 0.58, -Wm * 0.7], [-ML + 0.58, Wm * 0.7], [-ML + 0.25, Wm + 0.2 + 0.1 * g.fin]]);
    skin(ctx, fin, P.light, P.line, -0.4, 0.4);
    const pts = [[-ML + 0.05, 0], [-ML + 0.35, 0], [-0.3, 0], [0.1, 0], [0.24, 0]], wt = [0.02, Wm * 0.6, Wm * 0.95, Wm, Wm * 0.92];
    const S = spineOf(pts, wt, wt), mantle = spath(tube(S, 0.6, 0.3));
    skin(ctx, mantle, P.fill, P.line, -Wm, Wm, (c) => { if (g.pat) spinePat(c, S, P, 0.05, 1); else if (R.lod) for (let k = 0; k < 18; k++) dot(c, -ML + 0.2 + (ML + 0.2) * hr(k, P.salt), (hr(k, P.salt + 1) - 0.5) * Wm * 1.7, 0.02, css(P.c, -0.18, 0.1, 0.6)); });
    const head = ell(0.33, 0, 0.12, Wm * 0.8);
    skinR(ctx, head, P.fill, P.line, 0.33, 0, 0.13);
    eye(ctx, 0.33, -0.02, 0.07 + 0.03 * g.eyeS, P, 'bar');
  }
  function drawEuryp(ctx, P) {
    const g = P.g, n = 12, t = R.t;
    const b = BB(); bbAdd(b, -1.0, -0.62, 0); bbAdd(b, 1.0, 0.62, 0);
    fit(ctx, b[0], b[1], b[2], b[3]);
    for (const sd of [-1, 1]) {
      for (let k = 0; k < 3; k++) { const th = 0.75 - k * 0.3; const e = bugLeg(ctx, 0.62 - k * 0.07, sd * 0.18, sd, th, [[0.14, 0.3], [0.14, 0.3], [0.08, 0]], 0.025, P, k); if (R.lod > 1) dot(ctx, e[0], e[1], 0.012, P.line); }
      const pad = bugLeg(ctx, 0.42, sd * 0.2, sd, -0.9 + Math.sin(t * 3) * 0.15, [[0.22, -0.4], [0.2, 0]], 0.04, P, 0);
      const pp = ell(pad[0] - 0.06, pad[1], 0.12, 0.06, -sd * 0.6);
      skin(ctx, pp, P.fill, P.line, -1, 1);
    }
    const segs = [];
    for (let i = 0; i < n; i++) { const u = i / (n - 1), x = 0.32 - u * 0.95, w = (0.3 + 0.06 * g.wid) * (u < 0.35 ? 1 : 1 - (u - 0.35) * 1.05) + 0.03; segs.push([x, w]); }
    const tel = g.tail > 0.6 ? spath([[-0.6, 0], [-0.78, -0.1], [-0.98, 0], [-0.78, 0.1]]) : spath([[-0.6, -0.03], [-1.0, 0], [-0.6, 0.03]]);
    skin(ctx, tel, P.dark, P.line, -0.1, 0.1);
    for (let i = n - 1; i >= 0; i--) { const [x, w] = segs[i]; const s = ell(x, 0, 0.07, w); skinR(ctx, s, i % 2 ? P.fill : P.dark, P.line, x, 0, w, (c) => boxPat(c, x - 0.07, -w, x + 0.07, w, P, 0.3), 0.7); }
    for (const sd of [-1, 1]) limb(ctx, [[0.88, sd * 0.06], [0.98, sd * 0.1], [1.0, sd * 0.04]], 0.03, P.dark, P.line);
    const pro = spath([[0.92, 0], [0.86, -0.22], [0.6, -0.33], [0.36, -0.32], [0.3, 0], [0.36, 0.32], [0.6, 0.33], [0.86, 0.22]]);
    skinR(ctx, pro, P.fill, P.line, 0.6, 0, 0.35, (c) => boxPat(c, 0.3, -0.33, 0.92, 0.33, P, 0.5));
    for (const sd of [-1, 1]) { const e = ell(0.7, sd * 0.2, 0.07, 0.04, sd * 0.5); ctx.fillStyle = '#1b1a22'; ctx.fill(e); if (R.lod) gloss(ctx, 0.69, sd * 0.2 - 0.01, 0.04, 0.012, sd * 0.5, 0.5); }
    if (R.lod) { dot(ctx, 0.62, -0.03, 0.015, '#1b1a22'); dot(ctx, 0.62, 0.03, 0.015, '#1b1a22'); }
  }
  function drawAnomalo(ctx, P) {
    const g = P.g, t = R.t, n = 11;
    const b = BB(); bbAdd(b, -1.0, -0.62, 0); bbAdd(b, 1.08, 0.62, 0);
    fit(ctx, b[0], b[1], b[2], b[3]);
    for (const [a, l] of [[0.5, 0.32], [0.25, 0.36], [0.05, 0.3]]) for (const sd of [-1, 1]) { const f = ell(-0.78 - Math.cos(a) * l * 0.5, sd * Math.sin(a) * l * 0.6, l * 0.5, 0.06, sd * -a); skin(ctx, f, P.acc, P.accLine, -0.3, 0.3); }
    for (let i = n - 1; i >= 0; i--) {
      const u = i / (n - 1), x = 0.4 - u * 1.08, w = 0.22 * (1 - u * 0.45);
      for (const sd of [-1, 1]) { const a = Math.sin(t * 4 - i * 0.7) * 0.25, f = ell(x - 0.02, sd * (w + 0.1), 0.085, 0.16 * (1 - u * 0.3), sd * (0.35 + a)); skin(ctx, f, i % 2 ? P.light : P.fill, P.line, -0.5, 0.5, null, 0.5); }
    }
    const body = spath(tube({ pts: [[-0.75, 0], [-0.3, 0], [0.2, 0], [0.55, 0]], wt: [0.07, 0.15, 0.2, 0.2], wb: [0.07, 0.15, 0.2, 0.2] }, 0.6, 0.6));
    skin(ctx, body, P.fill, P.line, -0.2, 0.2, (c) => { boxPat(c, -0.75, -0.2, 0.55, 0.2, P); c.strokeStyle = css(P.c, -0.2, 0, 0.5); c.lineWidth = R.lw * 0.7; c.beginPath(); for (let i = 0; i < n; i++) { const x = 0.4 - (i / (n - 1)) * 1.08; c.moveTo(x, -0.25); c.lineTo(x, 0.25); } c.stroke(); });
    for (const sd of [-1, 1]) {
      limb(ctx, [[0.62, sd * 0.1], [0.7, sd * 0.24]], 0.03, P.fill, P.line);
      eye(ctx, 0.71, sd * 0.27, 0.06, P, 'compound');
      const pts = [];
      for (let j = 0; j <= 9; j++) { const u = j / 9, a = u * (2.4 + 0.6 * g.bend) + Math.sin(t * 2) * 0.1; pts.push([0.78 + Math.sin(a) * 0.22 * (1 - u * 0.3), sd * (0.06 + (1 - Math.cos(a)) * 0.12 * (1 - u * 0.3))]); }
      for (let j = 0; j < 9; j++) {
        const w = 0.045 * (1 - j / 12);
        limb(ctx, [pts[j], pts[j + 1]], w, j % 2 ? P.acc : css(P.a, -0.08), P.accLine);
        if (R.lod) { const a = Math.atan2(pts[j + 1][1] - pts[j][1], pts[j + 1][0] - pts[j][0]) - sd * PI / 2; limb(ctx, [pts[j], [pts[j][0] + Math.cos(a) * 0.05, pts[j][1] + Math.sin(a) * 0.05]], 0.01, P.acc, P.accLine); }
      }
    }
    const hd = ell(0.6, 0, 0.13, 0.16);
    skinR(ctx, hd, P.fill, P.line, 0.6, 0, 0.16);
  }
  function drawScorpion(ctx, P) {
    const g = P.g, t = R.t, cl = 0.18 + 0.12 * g.spike, LL = 0.8 + 0.4 * g.limbL;
    const b = BB(); bbAdd(b, -0.95, -0.75, 0); bbAdd(b, 0.95 + cl * 0.8, 0.5, 0);
    fit(ctx, b[0], b[1], b[2], b[3]);
    for (const sd of [-1, 1]) [[0.5, 0.55], [0.4, 0.15], [0.3, -0.25], [0.2, -0.65]].forEach(([x, th], k) => bugLeg(ctx, x, sd * 0.14, sd, th, [[0.16 * LL, th >= 0 ? 0.35 : -0.35], [0.16 * LL, th >= 0 ? 0.35 : -0.35], [0.08 * LL, 0]], 0.03, P, k * PI + sd));
    for (const sd of [-1, 1]) {
      const a0 = [0.6, sd * 0.1], a1 = [0.7, sd * 0.3], a2 = [0.88, sd * 0.3];
      limb(ctx, [a0, a1, a2], 0.05, P.fill, P.line);
      const hx = a2[0] + cl * 0.35, hy = a2[1] - sd * 0.02;
      skinR(ctx, ell(hx, hy, cl * 0.5, cl * 0.3, -sd * 0.3), P.fill, P.line, hx, hy, cl * 0.5);
      for (const f of [-1, 1]) { const fin = spath([[hx + cl * 0.35, hy + f * cl * 0.1], [hx + cl * 0.85, hy + f * cl * 0.05 - sd * 0.04], [hx + cl * 0.4, hy + f * cl * 0.2]]); skin(ctx, fin, P.dark, P.line, -1, 1); }
    }
    const tail = [[-0.28, 0], [-0.48, -0.03], [-0.66, -0.14], [-0.74, -0.32], [-0.68, -0.5], [-0.5, -0.6]], sw = Math.sin(t * 2) * 0.03;
    const tp = tail.map(([x, y], i) => [x, y + sw * i * 0.3]), tw = [0.09, 0.08, 0.075, 0.07, 0.066, 0.06];
    const TS = spineOf(tp, tw, tw), tpath = spath(tube(TS, 0.4, 0.6));
    skin(ctx, tpath, P.fill, P.line, -0.7, 0.1, (c) => { c.strokeStyle = P.line; c.lineWidth = R.lw * 0.8; c.beginPath(); for (let i = 1; i < 6; i++) { const q = spineAt(TS, (TS.len * i) / 6); c.moveTo(q[0] + q[2] * 0.1, q[1] + q[3] * 0.1); c.lineTo(q[0] - q[2] * 0.1, q[1] - q[3] * 0.1); } c.stroke(); });
    const te = tail[5], bulb = ell(te[0] + 0.02, te[1] + sw * 1.5, 0.08, 0.06, 0.2);
    skinR(ctx, bulb, P.acc, P.accLine, te[0], te[1], 0.08);
    limb(ctx, [[te[0] + 0.08, te[1] + sw * 1.5], [te[0] + 0.18, te[1] - 0.02], [te[0] + 0.22, te[1] + 0.06]], 0.025, '#2a2024', P.line, true);
    for (let i = 6; i >= 0; i--) { const x = -0.22 + i * 0.075, w = 0.16 + 0.05 * Math.sin((i / 6) * PI) + 0.04 * g.wid; const s = ell(x, 0, 0.06, w); skinR(ctx, s, P.fill, P.line, x, 0, w, (c) => boxPat(c, x - 0.06, -w, x + 0.06, w, P, 0.3), 0.7); }
    const pro = spath([[0.66, 0], [0.62, -0.15], [0.32, -0.19], [0.28, 0], [0.32, 0.19], [0.62, 0.15]]);
    skinR(ctx, pro, P.fill, P.line, 0.48, 0, 0.2);
    for (const sd of [-1, 1]) eye(ctx, 0.5, sd * 0.035, 0.028, P, 'bead');
  }
  function drawSpider(ctx, P) {
    const g = P.g, LL = 0.75 + 0.55 * g.limbL, ra = 0.3 + 0.08 * g.len, rb = 0.26 + 0.08 * g.wid;
    const LEGS = [[0.42, 0.85], [0.37, 0.35], [0.3, -0.2], [0.24, -0.7]];
    const legPts = (sd, k, wig) => {
      const [x, th] = LEGS[k], segs = [[0.24 * LL, th >= 0 ? 0.55 : -0.55], [0.26 * LL, th >= 0 ? 0.25 : -0.25], [0.16 * LL, 0]], pts = [[x, sd * 0.1]];
      let a = th + wig, px = x, py = sd * 0.1;
      for (const [L, bd] of segs) { px += Math.sin(a) * L; py += sd * Math.cos(a) * L; pts.push([px, py]); a += bd; }
      return pts;
    };
    // 범위: 몸 + 멈춘 자세의 다리 끝 (다리가 상자 밖으로 잘리지 않게)
    const b = BB(); bbAdd(b, -0.25 - ra, -rb, 0.02); bbAdd(b, 0.66, rb, 0.02);
    for (const sd of [-1, 1]) for (let k = 0; k < 4; k++) bbPts(b, legPts(sd, k, 0), 0.06);
    fit(ctx, b[0], b[1], b[2], b[3]);
    const bands = g.pat === 3;
    for (const sd of [-1, 1]) LEGS.forEach((_, k) => {
      const pts = legPts(sd, k, Math.sin(R.t * 6 + k + sd) * 0.08);
      limb(ctx, pts, 0.035, P.dark, P.line);
      if (bands && R.lod) for (let j = 1; j < pts.length; j++) dot(ctx, pts[j][0], pts[j][1], 0.025, P.acc);
      if (R.lod > 1) { const q = new Path2D(); for (let j = 0; j < 3; j++) for (let m = 1; m < 4; m++) { const u = m / 4, x0 = lerp(pts[j][0], pts[j + 1][0], u), y0 = lerp(pts[j][1], pts[j + 1][1], u); q.moveTo(x0, y0); q.lineTo(x0 + 0.02, y0 + sd * 0.025); } strokeP(ctx, q, P.line, PX(0.8)); }
    });
    const abd = ell(-0.25, 0, ra, rb);
    skinR(ctx, abd, P.fill, P.line, -0.25, 0, ra, (c) => {
      boxPat(c, -0.25 - ra, -rb, -0.25 + ra, rb, P);
      if (R.lod && g.pat !== 1) { c.fillStyle = P.patCol; for (let k = 0; k < 3; k++) { const x = -0.05 - k * ra * 0.45, w = rb * (0.5 - k * 0.1); c.beginPath(); c.moveTo(x + 0.04, 0); c.lineTo(x - 0.05, -w); c.lineTo(x - 0.1, -w * 0.8); c.lineTo(x - 0.02, 0); c.lineTo(x - 0.1, w * 0.8); c.lineTo(x - 0.05, w); c.fill(); } }
    });
    const ceph = ell(0.34, 0, 0.21, 0.17);
    skinR(ctx, ceph, P.dark, P.line, 0.34, 0, 0.2);
    for (const sd of [-1, 1]) { limb(ctx, [[0.5, sd * 0.07], [0.6, sd * 0.12], [0.64, sd * 0.06]], 0.03, P.dark, P.line); limb(ctx, [[0.52, sd * 0.035], [0.6, sd * 0.03]], 0.05, '#221c20', P.line); }
    const ne = g.eyeN % 2 ? 6 : 8, eyes = [[0.49, -0.04, 0.035], [0.49, 0.04, 0.035], [0.46, -0.1, 0.022], [0.46, 0.1, 0.022], [0.44, -0.035, 0.018], [0.44, 0.035, 0.018], [0.42, -0.08, 0.016], [0.42, 0.08, 0.016]];
    for (let k = 0; k < ne; k++) eye(ctx, eyes[k][0], eyes[k][1], eyes[k][2], P, 'bead');
  }
  function drawInvert(ctx, P) { [() => drawShield(ctx, P, 'tri'), () => drawCrayfish(ctx, P), () => drawSnail(ctx, P), () => drawSegmented(ctx, P, 'worm')][P.form](); }
  function drawBug(ctx, P) { [() => drawBeetle(ctx, P), () => drawSegmented(ctx, P, 'milli'), () => drawFlyer(ctx, P), () => drawShield(ctx, P, 'iso')][P.form](); }
  function drawSeaHunter(ctx, P) { [() => drawSquid(ctx, P), () => drawEuryp(ctx, P), () => drawAnomalo(ctx, P)][P.form](); }
  function drawArachnid(ctx, P) { [() => drawScorpion(ctx, P), () => drawSpider(ctx, P), () => drawSegmented(ctx, P, 'centi')][P.form](); }

  /* ================= 물고기·상어 (옆모습, 머리는 오른쪽) ================= */
  const FISH_U = [0, 0.1, 0.22, 0.38, 0.55, 0.7, 0.82, 0.92, 1];
  const FISH_PROF = {
    torpedo: [0.1, 0.16, 0.45, 0.78, 0.97, 0.95, 0.8, 0.56, 0.14],
    deep: [0.08, 0.14, 0.5, 0.88, 1, 0.96, 0.8, 0.52, 0.12],
    eel: [0.25, 0.5, 0.78, 0.94, 1, 1, 0.95, 0.8, 0.35],
    armored: [0.12, 0.2, 0.5, 0.8, 0.95, 1, 1, 0.88, 0.45],
    shark: [0.08, 0.13, 0.38, 0.72, 0.95, 1, 0.84, 0.52, 0.06],
    placo: [0.1, 0.18, 0.4, 0.7, 0.92, 1, 1, 0.92, 0.5],
  };
  function fishGeo(g, kind) {
    const H = { torpedo: 0.19 + 0.14 * g.wid, deep: 0.42 + 0.2 * g.wid, eel: 0.08 + 0.04 * g.wid, armored: 0.24 + 0.12 * g.wid, shark: 0.17 + 0.07 * g.wid, placo: 0.2 + 0.08 * g.wid }[kind];
    const prof = FISH_PROF[kind], pts = [], wt = [], wb = [], t = R.t;
    for (let i = 0; i < 9; i++) {
      const u = FISH_U[i], x = -1 + 2 * u;
      const y = kind === 'eel' ? 0.2 * Math.sin(u * PI * 2 + 0.6 - t * 3) * (0.35 + 0.65 * (1 - u)) : Math.sin(u * PI * 1.3 - t * 4) * 0.035 * Math.pow(1 - u, 1.5);
      pts.push([x, y]); wt.push(prof[i] * H); wb.push(prof[i] * H * (kind === 'shark' ? 0.85 : 0.94));
    }
    return { S: spineOf(pts, wt, wb), H };
  }
  // 몸 가장자리의 점: u = 꼬리(0)→주둥이(1), side 1 = 등 / -1 = 배
  function edge(S, u, side, k) { const q = spineAt(S, u * S.len); const w = (side > 0 ? q[4] : q[5]) * (k == null ? 1 : k); return [q[0] + q[2] * side * w, q[1] + q[3] * side * w, q]; }
  function fin(ctx, P, pts, curved, alpha) {
    const p = curved ? spath(pts) : lpath(pts, true);
    ctx.fillStyle = css(P.a, 0, -0.05, alpha || 0.88); ctx.fill(p);
    if (R.lod > 1) { ctx.save(); ctx.clip(p); const q = new Path2D(), o = pts[0]; for (let i = 1; i < pts.length; i++) { q.moveTo(o[0], o[1]); q.lineTo(pts[i][0] * 1.02 - o[0] * 0.02, pts[i][1] * 1.02 - o[1] * 0.02); } strokeP(ctx, q, css(P.a, -0.25, 0, 0.35), PX(1)); ctx.restore(); }
    outline(ctx, p, P.accLine, 0.85);
    return p;
  }
  function finFan(ctx, P, base0, base1, tip, sweep, alpha) {
    const p = new Path2D();
    p.moveTo(base0[0], base0[1]);
    p.quadraticCurveTo((base0[0] + tip[0]) / 2 + sweep[0], (base0[1] + tip[1]) / 2 + sweep[1], tip[0], tip[1]);
    p.quadraticCurveTo((tip[0] + base1[0]) / 2 - sweep[0] * 0.4, (tip[1] + base1[1]) / 2 - sweep[1] * 0.4, base1[0], base1[1]);
    p.closePath();
    ctx.fillStyle = css(P.a, 0, -0.05, alpha || 0.88); ctx.fill(p);
    if (R.lod > 1) {
      ctx.save(); ctx.clip(p);
      const q = new Path2D();
      for (let i = 1; i < 6; i++) { const u = i / 6, bx = lerp(base0[0], base1[0], u), by = lerp(base0[1], base1[1], u); q.moveTo(bx, by); q.lineTo(bx + (tip[0] - bx) * 1.3, by + (tip[1] - by) * 1.3); }
      strokeP(ctx, q, css(P.a, -0.25, 0, 0.35), PX(1)); ctx.restore();
    }
    outline(ctx, p, P.accLine, 0.85);
  }
  function caudal(ctx, P, S, H, kind, size) {
    const g = P.g, tp = S.pts[0], q = spineAt(S, 0.001), tx = -q[6], ty = -q[7], nx = q[2], ny = q[3];
    const at = (a, b) => [tp[0] + tx * a + nx * b, tp[1] + ty * a + ny * b];
    const CF = size, b0 = at(-0.06, S.wt[0] * 1.1), b1 = at(-0.06, -S.wb[0] * 1.1);
    if (kind === 'shark' || kind === 'placo') { fin(ctx, P, [b0, at(CF * 0.9, CF * 1.15), at(CF * 0.55, CF * 0.5), at(CF * 0.25, 0), at(CF * 0.5, -CF * 0.55), b1], true); return; }
    if (kind === 'eel') { fin(ctx, P, [b0, at(CF * 0.5, 0), b1], true); return; }
    const ct = caudalType(g);
    if (ct === 0) fin(ctx, P, [b0, at(CF * 0.55, CF * 0.75), at(CF * 0.85, CF * 0.3), at(CF * 0.9, -CF * 0.3), at(CF * 0.55, -CF * 0.75), b1], true);
    else if (ct === 1) fin(ctx, P, [b0, at(CF * 0.95, CF * 0.85), at(CF * 0.45, 0), at(CF * 0.95, -CF * 0.85), b1], false);
    else fin(ctx, P, [b0, at(CF * 0.6, CF * 0.5), at(CF * 1.05, CF * 1.15), at(CF * 0.55, CF * 0.2), at(CF * 0.45, 0), at(CF * 0.55, -CF * 0.2), at(CF * 1.05, -CF * 1.15), at(CF * 0.6, -CF * 0.5), b1], true);
  }
  function drawFish(ctx, P) {
    const g = P.g, kindF = ['torpedo', 'deep', 'eel', 'armored'][P.form];
    const { S, H } = fishGeo(g, kindF), bill = g.mouth === 4 ? 0.3 + 0.35 * g.spike : 0;
    const CF = kindF === 'eel' ? H * 2 : H * (kindF === 'deep' ? 0.7 : 1.0) * (0.9 + 1.1 * g.fin);
    const DH = H * (kindF === 'deep' ? 0.9 + 0.9 * g.fin : kindF === 'eel' ? 0.6 : 0.5 + 1.0 * g.fin);
    const b = BB(); bbPts(b, S.pts, H * 1.05); bbAdd(b, -1 - CF * 1.0, 0, CF * 1.1); bbAdd(b, 0, -H - DH, 0); bbAdd(b, 1 + bill, 0, 0); bbAdd(b, 0, H + DH * 0.6, 0);
    fit(ctx, b[0], b[1], b[2], b[3]);
    caudal(ctx, P, S, H, kindF, CF);
    if (kindF === 'eel') {
      const top = [], bot = [];
      for (let i = 0; i <= 12; i++) { const u = 0.02 + (i / 12) * 0.68, e = edge(S, u, 1), q = e[2]; top.push([e[0] + q[2] * DH * Math.sin(PI * Math.min(1, (i + 1) / 13)) * 0.9, e[1] + q[3] * DH * Math.sin(PI * Math.min(1, (i + 1) / 13)) * 0.9]); }
      for (let i = 12; i >= 0; i--) { const u = 0.02 + (i / 12) * 0.68; top.push(edge(S, u, 1, 0.5).slice(0, 2)); }
      for (let i = 0; i <= 10; i++) { const u = 0.02 + (i / 10) * 0.5, e = edge(S, u, -1), q = e[2]; bot.push([e[0] - q[2] * DH * 0.7 * Math.sin(PI * (i + 1) / 11), e[1] - q[3] * DH * 0.7 * Math.sin(PI * (i + 1) / 11)]); }
      for (let i = 10; i >= 0; i--) bot.push(edge(S, 0.02 + (i / 10) * 0.5, -1, 0.5).slice(0, 2));
      fin(ctx, P, top, true, 0.75); fin(ctx, P, bot, true, 0.75);
    } else {
      const d0 = edge(S, kindF === 'deep' ? 0.68 : 0.64, 1, 0.9), d1 = edge(S, kindF === 'deep' ? 0.22 : 0.36, 1, 0.9);
      const dt = [lerp(d0[0], d1[0], 0.55), Math.min(d0[1], d1[1]) - DH];
      finFan(ctx, P, d0, d1, dt, [-0.02, -0.04]);
      if (g.spike > 0.6 && R.lod) { const q = new Path2D(); for (let i = 0; i < 5; i++) { const u = i / 4, x = lerp(d0[0], dt[0], u * 0.9), y = lerp(d0[1], dt[1], u * 0.9); q.moveTo(x, y); q.lineTo(x - 0.03, y - DH * 0.28); } strokeP(ctx, q, P.accLine, PX(1.2)); }
      const a0 = edge(S, kindF === 'deep' ? 0.5 : 0.36, -1, 0.9), a1 = edge(S, kindF === 'deep' ? 0.2 : 0.22, -1, 0.9);
      finFan(ctx, P, a0, a1, [lerp(a0[0], a1[0], 0.6), Math.max(a0[1], a1[1]) + DH * (kindF === 'deep' ? 0.85 : 0.45)], [0, 0.03]);
      const p0 = edge(S, 0.56, -1, 0.85), p1 = edge(S, 0.5, -1, 0.85);
      finFan(ctx, P, p0, p1, [p1[0] - H * 0.35, p1[1] + H * 0.45], [0, 0.02]);
    }
    const body = spath(tube(S, 0.7, 0.55));
    skin(ctx, body, P.fill, P.line, -H, H, (c) => {
      bellyShade(c, body, P, -H * 0.1, H, 0.7);
      if (R.lod > 1 && kindF !== 'eel' && kindF !== 'armored') {
        c.strokeStyle = css(P.c, -0.2, 0, 0.16); c.lineWidth = PX(0.9);
        c.beginPath();
        const st = H * 0.22;
        for (let y = -H; y < H; y += st * 0.8) for (let x = -0.85, j = 0; x < 0.62; x += st, j++) { const xx = x + ((Math.round(y / st) % 2) * st) / 2; c.moveTo(xx + st * 0.5, y); c.arc(xx, y, st * 0.5, 0, PI * 0.5); }
        c.stroke();
      }
      spinePat(c, S, P, 0.06, 0.82);
      if (kindF === 'armored') {
        const sx = edge(S, 0.66, 1)[0];
        c.fillStyle = css(P.c, -0.1, -0.05, 0.85); c.fillRect(sx, -1, 2, 2);
        c.strokeStyle = P.line; c.lineWidth = R.lw * 0.8; c.beginPath(); c.moveTo(sx, -1); c.lineTo(sx, 1);
        for (const v of [-0.4, 0.2]) { c.moveTo(sx, v * H); c.lineTo(1, v * H * 0.6); }
        c.stroke();
        if (R.lod) for (let k = 0; k < 16; k++) dot(c, sx + 0.05 + (1 - sx) * hr(k, P.salt), (hr(k, P.salt + 1) - 0.5) * H * 1.6, 0.015, css(P.c, 0.15, 0, 0.6));
      }
      if (R.lod > 1) { const q = new Path2D(); for (let i = 0; i <= 10; i++) { const s = spineAt(S, S.len * (0.12 + 0.68 * (i / 10))); if (i) q.lineTo(s[0], s[1] - s[4] * 0.1); else q.moveTo(s[0], s[1] - s[4] * 0.1); } strokeP(c, q, css(P.c, 0.2, 0, 0.4), PX(1)); }
    });
    if (kindF !== 'eel') {
      const pc = edge(S, 0.74, -1, 0.35), pl = H * (0.55 + 0.6 * g.fin);
      finFan(ctx, P, [pc[0] + 0.02, pc[1] - 0.03], [pc[0], pc[1] + 0.03], [pc[0] - pl, pc[1] + pl * 0.45], [0.02, 0.03], 0.82);
    }
    fishHead(ctx, P, S, H, kindF, bill);
  }
  function fishHead(ctx, P, S, H, kind, bill) {
    const g = P.g, shark = kind === 'shark' || kind === 'placo';
    if (kind === 'shark') {
      if (R.lod) for (let i = 0; i < 5; i++) { const u = 0.74 + i * 0.022, a = edge(S, u, 1, 0.45), b = edge(S, u - 0.01, -1, 0.3); strokeP(ctx, spath([a.slice(0, 2), [lerp(a[0], b[0], 0.5) + 0.01, lerp(a[1], b[1], 0.5)], b.slice(0, 2)], true), P.line, R.lw * 0.9); }
    } else if (kind !== 'placo') { const a = edge(S, 0.8, 1, 0.75), b = edge(S, 0.8, -1, 0.75), m = edge(S, 0.77, 1, 0); strokeP(ctx, spath([a.slice(0, 2), [m[0] - 0.02, m[1]], b.slice(0, 2)], true), P.line, R.lw); }
    const tip = S.pts[8];
    const mouthY = tip[1] + S.wb[8] * 0.3;
    if (bill) { const bp = lpath([[tip[0] - 0.02, tip[1] - S.wt[8] * 0.6], [tip[0] + bill, tip[1] + S.wb[8] * 0.1], [tip[0] - 0.02, tip[1] + S.wb[8] * 0.5]], true); skin(ctx, bp, P.dark, P.line, -0.1, 0.1); }
    if (g.mouth === 0 && !shark) { const m = ell(tip[0] + 0.01, tip[1] + 0.005, Math.max(0.03, S.wt[8] * 0.5), Math.max(0.04, S.wt[8] * 0.95)); ctx.fillStyle = '#2a0f14'; ctx.fill(m); outline(ctx, m, P.line, 1.2); }
    else if (g.mouth === 2 && !shark) { const bk = lpath([[tip[0] - 0.08, tip[1] - S.wt[8] * 0.8], [tip[0] + 0.05, mouthY - 0.01], [tip[0] - 0.08, tip[1] + S.wb[8] * 0.9]], true); skin(ctx, bk, 'hsla(48,30%,82%,1)', P.line, -0.1, 0.1); strokeP(ctx, lpath([[tip[0] - 0.07, mouthY], [tip[0] + 0.04, mouthY]]), P.line, R.lw); }
    else if (kind === 'shark') {
      const m0 = edge(S, 0.86, -1, 0.75), m1 = edge(S, 0.94, -1, 0.6);
      const mp = spath([m0.slice(0, 2), [lerp(m0[0], m1[0], 0.5), m0[1] + 0.03], m1.slice(0, 2)], true);
      strokeP(ctx, mp, P.line, R.lw * 1.4);
      if (R.lod) { ctx.fillStyle = '#f2ecdc'; ctx.beginPath(); for (let i = 1; i < 6; i++) { const x = lerp(m0[0], m1[0], i / 6), y = lerp(m0[1], m1[1], i / 6) + 0.015; ctx.moveTo(x - 0.012, y - 0.008); ctx.lineTo(x, y + 0.025); ctx.lineTo(x + 0.012, y - 0.008); } ctx.fill(); }
    } else if (kind === 'placo') {
      const jaw = lpath([[tip[0] - 0.2, mouthY - 0.02], [tip[0] + 0.05, mouthY - 0.03], [tip[0] + 0.02, mouthY + 0.06], [tip[0] - 0.08, mouthY + 0.02], [tip[0] - 0.12, mouthY + 0.07], [tip[0] - 0.25, mouthY + 0.04]], true);
      skin(ctx, jaw, 'hsla(40,20%,78%,1)', P.line, -0.1, 0.1);
    } else strokeP(ctx, spath([[tip[0] + 0.01, mouthY], [tip[0] - H * 0.25, mouthY + 0.01], [tip[0] - H * 0.4, mouthY - 0.005]], true), P.line, R.lw * 1.1);
    if (g.mouth === 3) for (let k = 0; k < 3; k++) { const x0 = tip[0] - 0.03 - k * 0.04, y0 = mouthY + 0.01; strokeP(ctx, spath([[x0, y0], [x0 - 0.08, y0 + 0.08 + k * 0.02], [x0 - 0.16 - k * 0.04, y0 + 0.1 + k * 0.05]], true), P.line, Math.max(PX(1), 0.012)); }
    const ex = lerp(edge(S, 0.885, 1)[0], tip[0], 0.1), er = shark ? Math.max(0.03, H * 0.13) : Math.max(0.035, H * (kind === 'deep' ? 0.13 : 0.2) * (0.75 + 0.6 * g.eyeS)), ey = spineAt(S, S.len * 0.88)[1] - S.wt[7] * 0.3;
    if (kind === 'placo') { const ring = circ(ex - 0.02, ey, er * 1.6); ctx.fillStyle = 'hsla(40,15%,72%,.9)'; ctx.fill(ring); outline(ctx, ring, P.line); }
    eye(ctx, ex - (kind === 'placo' ? 0.02 : 0), ey, er, P, shark ? 'bead' : 'round');
    const n = eyeCount(g);
    if (n === 4) eye(ctx, ex - er * 2.4, ey + er * 1.2, er * 0.75, P, shark ? 'bead' : 'round');
    if (n === 3) eye(ctx, ex - er * 2.2, ey - S.wt[7] * 0.5, er * 0.55, P, 'bead');
  }
  function drawShark(ctx, P) {
    if (P.form === 2) return drawPlesio(ctx, P);
    const g = P.g, kind = P.form === 0 ? 'shark' : 'placo';
    const { S, H } = fishGeo(g, kind), CF = H * (kind === 'shark' ? 1.5 + 0.9 * g.fin : 1.0), DH = H * (kind === 'shark' ? 1.0 + 0.8 * g.fin : 0.6);
    const b = BB(); bbPts(b, S.pts, H * 1.05); bbAdd(b, -1 - CF * 0.9, -CF * 1.2, 0); bbAdd(b, 0, -H - DH, 0); bbAdd(b, 1.05, H + DH * 0.9, 0);
    fit(ctx, b[0], b[1], b[2], b[3]);
    caudal(ctx, P, S, H, kind, CF);
    const d0 = edge(S, 0.62, 1, 0.9), d1 = edge(S, 0.46, 1, 0.9);
    fin(ctx, P, [d0.slice(0, 2), [d1[0] - DH * 0.15, d1[1] - DH], [d1[0] + 0.03, d1[1] - DH * 0.1], d1.slice(0, 2)], true);
    const e0 = edge(S, 0.26, 1, 0.9), e1 = edge(S, 0.2, 1, 0.9);
    fin(ctx, P, [e0.slice(0, 2), [e1[0] - 0.02, e1[1] - DH * 0.32], e1.slice(0, 2)], false);
    const a0 = edge(S, 0.24, -1, 0.9), a1 = edge(S, 0.19, -1, 0.9);
    fin(ctx, P, [a0.slice(0, 2), [a1[0] - 0.03, a1[1] + DH * 0.25], a1.slice(0, 2)], false);
    const p0 = edge(S, 0.45, -1, 0.9), p1 = edge(S, 0.4, -1, 0.9);
    fin(ctx, P, [p0.slice(0, 2), [p1[0] - 0.05, p1[1] + DH * 0.3], p1.slice(0, 2)], false);
    const body = spath(tube(S, 0.6, 0.5));
    skin(ctx, body, P.fill, P.line, -H, H, (c) => {
      bellyShade(c, body, { belly: 'hsla(40,20%,92%,1)' }, 0, H * 0.5, 0.95);
      spinePat(c, S, P, 0.1, 0.75, 0.7);
      if (kind === 'placo') {
        const sx = edge(S, 0.62, 1)[0];
        c.fillStyle = 'hsla(35,12%,62%,.92)';
        c.fill(spath([[sx, -H * 1.2], [1.1, -H * 1.2], [1.1, H * 1.2], [sx + 0.08, H * 1.2], [sx - 0.04, 0]]));
        c.strokeStyle = 'hsla(35,20%,22%,.8)'; c.lineWidth = R.lw * 0.9; c.beginPath();
        c.moveTo(sx, -H * 1.2); c.lineTo(sx - 0.04, 0); c.lineTo(sx + 0.08, H * 1.2);
        for (const [x0, y0, x1, y1] of [[sx + 0.1, -H, sx + 0.3, H * 0.1], [sx + 0.3, -H, sx + 0.25, H * 0.9], [sx + 0.3, H * 0.1, 1, H * 0.2]]) { c.moveTo(x0, y0); c.lineTo(x1, y1); }
        c.stroke();
        if (R.lod) for (let k = 0; k < 18; k++) dot(c, sx + (1 - sx) * hr(k, P.salt), (hr(k, P.salt + 1) - 0.5) * H * 1.8, 0.014, 'hsla(35,20%,85%,.7)');
      }
    });
    const pc = edge(S, 0.7, -1, 0.5), pl = H * (1.3 + 0.8 * g.fin);
    fin(ctx, P, [[pc[0] + 0.04, pc[1] - 0.02], [pc[0] - pl * 0.55, pc[1] + pl * 0.65], [pc[0] - pl * 0.25, pc[1] + pl * 0.4], [pc[0] - 0.04, pc[1] + 0.03]], true);
    fishHead(ctx, P, S, H, kind, 0);
  }

  /* ================= 네발·두발 척추동물 (옆모습) ================= */
  const TETRA = { grazer: ['amphibian', 'reptile', 'mammal', 'longneck'], hunter: ['cat', 'theropod', 'croc', 'bird'] };
  // 지성 종은 조상(네발 초식·포식 동물)의 겉모습을 그대로 이어받는다 → 털·색이 지성을 얻는 순간 바뀌지 않는다
  const ancKind = (g, tr) => { const ap = ancPlan(tr); return TETRA[ap][formFor(g, ap, tr, true)]; };
  function coverOf(g, pk, tr) {
    if (pk === 'sapient') return coverFor(ancKind(g, tr), g.armor);
    return coverFor(TETRA[pk === 'hunter' ? 'hunter' : 'grazer'][formFor(g, pk === 'hunter' ? 'hunter' : 'grazer', tr)], g.armor);
  }
  function coverFor(kind, a) {
    switch (kind) {
      case 'amphibian': return 'skin';
      case 'reptile': return a === 5 ? 'shell' : a === 2 ? 'plates' : a === 4 ? 'feathers' : 'scales';
      case 'mammal': return a === 2 || a === 5 ? 'plates' : a === 1 ? 'scales' : 'fur';
      case 'longneck': return a === 3 || a === 4 ? 'fur' : a === 2 ? 'plates' : 'scales';
      case 'cat': return a === 1 ? 'scales' : 'fur';
      case 'theropod': return a === 3 || a === 4 ? 'feathers' : 'scales';
      case 'croc': return a === 2 || a === 5 ? 'plates' : 'scales';
      default: return 'feathers';
    }
  }
  function geoTetra(g, P) {
    const pk = P.pk, kind = TETRA[pk][P.form], sz = P.sz, intel = P.intel, cover = coverFor(kind, g.armor);
    const post = { amphibian: 'sprawl', reptile: 'sprawl', croc: 'sprawl', mammal: 'upright', cat: 'upright', longneck: 'pillar', theropod: 'biped', bird: 'biped' }[kind];
    const Q = { kind, cover, post, sz };
    const frog = kind === 'amphibian' && isFrog(g);
    Q.frog = frog;
    Q.BL = (0.85 + 0.4 * g.len) * (frog ? 0.62 : kind === 'bird' ? 0.72 : 1) + (kind === 'croc' ? 0.25 : 0);
    Q.BH = (0.22 + 0.13 * g.wid) * ({ amphibian: frog ? 1.05 : 0.82, croc: 0.74, longneck: 1.3, bird: 0.95, reptile: 0.88 }[kind] || 1) * (0.88 + 0.3 * sz) * (cover === 'shell' ? 1.15 : 1);
    Q.LH = { sprawl: 0.25 + 0.14 * g.limbL, pillar: 0.46 + 0.26 * g.limbL, biped: kind === 'bird' ? 0.36 + 0.3 * g.limbL : 0.5 + 0.35 * g.limbL, upright: 0.36 + 0.4 * g.limbL }[post];
    if (frog) Q.LH = 0.2 + 0.08 * g.limbL;
    Q.SH = Q.LH * (kind === 'longneck' && cover === 'fur' ? 1.25 : kind === 'mammal' ? 1.04 : 1);
    Q.NL = { amphibian: 0.04, reptile: 0.1 + 0.15 * g.neck, mammal: 0.12 + 0.28 * g.neck, longneck: 0.7 + 0.8 * g.neck, cat: 0.1 + 0.14 * g.neck, theropod: 0.16 + 0.16 * g.neck, croc: 0.05, bird: 0.16 + 0.2 * g.neck }[kind];
    Q.NA = { amphibian: 0.1, reptile: 0.3, mammal: 0.55 + 0.35 * g.neck, longneck: 0.85 + 0.35 * g.neck, cat: 0.35, theropod: 0.6, croc: 0.05, bird: 1.2 }[kind];
    Q.cr = (0.13 + 0.07 * g.head) * (1.2 - 0.35 * sz) * (1 + 0.35 * intel) * { amphibian: 1.2, reptile: 0.95, mammal: 1, longneck: 0.78, cat: 1.02, theropod: 1.15, croc: 1.0, bird: 0.85 }[kind];
    const sn = 1 - g.round;
    Q.sl = Q.cr * { amphibian: 0.3, reptile: 0.8 + 0.8 * sn, mammal: 0.45 + 0.9 * sn, longneck: 0.5 + 0.6 * sn, cat: 0.3 + 0.5 * sn, theropod: 0.95 + 0.7 * sn, croc: 1.9 + 1.4 * sn, bird: 0 }[kind];
    Q.sd = Q.cr * { amphibian: 0.62, reptile: 0.42, mammal: 0.5, longneck: 0.45, cat: 0.56, theropod: 0.6, croc: 0.3, bird: 0.5 }[kind];
    Q.TL = { amphibian: frog ? 0 : 0.3 + 0.8 * g.tail, reptile: 0.6 + 0.9 * g.tail, mammal: 0.08 + 0.7 * g.tail, longneck: 0.6 + 0.8 * g.tail, cat: 0.45 + 0.6 * g.tail, theropod: 0.85 + 0.55 * g.tail, croc: 0.9 + 0.5 * g.tail, bird: 0.12 }[kind];
    Q.TW = Q.BH * { amphibian: 0.5, reptile: 0.55, mammal: 0.16, longneck: 0.5, cat: 0.17, theropod: 0.55, croc: 0.6, bird: 0.45 }[kind];
    Q.droop = { amphibian: 0.12, reptile: 0.3, mammal: 1.1, longneck: 0.28, cat: 0.7, theropod: -0.05, croc: 0.1, bird: 0.3 }[kind];
    Q.curl = kind === 'cat' ? -1.5 : kind === 'mammal' ? 0.2 : kind === 'reptile' ? 0.2 : 0;
    Q.foot = { amphibian: 'web', reptile: 'claw', croc: 'claw', mammal: sz > 0.35 && g.bend < 0.6 ? 'hoof' : 'paw', cat: 'paw', longneck: cover === 'fur' ? 'hoof' : 'pad', theropod: 'talon', bird: 'talon' }[kind];
    Q.ears = kind === 'mammal' || kind === 'cat' || (kind === 'longneck' && cover === 'fur');
    Q.extra = extraLimbs(g) && post !== 'biped';
    return Q;
  }
  function headPts(cr, sl, sd, jd, crown) {
    const nx = cr * 0.55 + sl;
    return [[-cr * 0.95, cr * 0.2], [-cr * 0.8, -cr * 0.62 * crown], [-cr * 0.1, -cr * crown], [cr * 0.55, -cr * 0.78 * crown], [cr * 0.45 + sl * 0.6, -sd * 0.95],
      [nx, -sd * 0.55], [nx + sd * 0.22, sd * 0.02], [nx - sd * 0.05, sd * 0.45], [cr * 0.45 + sl * 0.45, jd * 0.92], [cr * 0.05, cr * 0.85], [-cr * 0.6, cr * 0.7]];
  }
  function tetraLeg(ctx, P, Q, j, fore, far, ph) {
    const tpl = Q.frog && !fore ? [[0, 0], [0.62, 0.18], [-0.05, 0.62], [0.5, 1]] : {
      upright: fore ? [[0, 0], [-0.08, 0.45], [0.04, 0.84], [0.1, 1]] : [[0, 0], [0.24, 0.4], [-0.16, 0.78], [-0.02, 1]],
      sprawl: fore ? [[0, 0], [-0.3, 0.42], [-0.14, 0.86], [0.12, 1]] : [[0, 0], [0.36, 0.38], [0.16, 0.86], [0.4, 1]],
      pillar: [[0, 0], [0.04, 0.5], [0, 0.94], [0.04, 1]],
      biped: Q.kind === 'bird' ? [[0, 0], [0.2, 0.3], [-0.16, 0.66], [0.1, 1]] : [[0, 0], [0.3, 0.36], [-0.14, 0.74], [0.16, 1]],
    }[Q.post];
    const h = -j[1], bend = 0.6 + 0.8 * P.g.bend, sw = Math.sin(R.t * 5 + ph) * 0.14;
    const cs = Math.cos(sw), sn = Math.sin(sw);
    const kx = Q.post === 'sprawl' ? 0.95 : Q.post === 'biped' ? 0.55 : 0.6;
    const pts = tpl.map(([x, y]) => { const lx = x * h * bend * kx, ly = y * h; return [j[0] + lx * cs - ly * sn, j[1] + lx * sn + ly * cs]; });
    const w0 = Q.BH * (Q.kind === 'bird' ? 0.3 : Q.frog && !fore ? 0.62 : Q.post === 'sprawl' ? 0.46 : Q.post === 'biped' ? 0.62 : 0.5) * (0.85 + 0.4 * Q.sz) * (fore ? 0.85 : 1) * (Q.kind === 'longneck' ? 1.05 : 1);
    const ws = Q.post === 'pillar' ? [w0, w0 * 0.85, w0 * 0.78, w0 * 0.82] : Q.kind === 'bird' ? [w0 * 1.6, w0 * 0.55, w0 * 0.42, w0 * 0.38] : [w0 * 1.15, w0 * 0.62, w0 * 0.42, w0 * 0.38];
    if (Q.kind === 'bird') { // 새 다리: 깃털 덮인 넓적다리 + 비늘 덮인 노란 다리
      const lower = spath(tube({ pts: pts.slice(1), wt: ws.slice(1), wb: ws.slice(1) }, 0.6, 0.6));
      skin(ctx, lower, far ? 'hsla(44,40%,42%,1)' : 'hsla(44,55%,56%,1)', P.line, j[1], 0);
      // 깃털 바지: 엉덩이에서 무릎까지 늘어진 깃털 덩어리 (몸통 뒤에 그려져 윗부분은 몸에 가려진다)
      const tx = pts[1][0] - pts[0][0], ty = pts[1][1] - pts[0][1], tl = Math.hypot(tx, ty) || 1, ux = tx / tl, uy = ty / tl, wv = w0 * 1.5;
      let tp = [[pts[0][0] - uy * wv * 0.9 - ux * wv * 0.6, pts[0][1] + ux * wv * 0.9 - uy * wv * 0.6], [pts[0][0] + uy * wv - ux * wv * 0.6, pts[0][1] - ux * wv - uy * wv * 0.6],
        [pts[0][0] + uy * wv * 1.05 + tx * 0.6, pts[0][1] - ux * wv * 1.05 + ty * 0.6], [pts[1][0] + uy * wv * 0.45 + ux * wv * 0.3, pts[1][1] - ux * wv * 0.45 + uy * wv * 0.3],
        [pts[1][0] - uy * wv * 0.35 + ux * wv * 0.35, pts[1][1] + ux * wv * 0.35 + uy * wv * 0.35], [pts[0][0] - uy * wv * 0.95 + tx * 0.6, pts[0][1] + ux * wv * 0.95 + ty * 0.6]];
      if (R.lod) tp = fuzz(dens(tp, 3), wv * 0.22, P.salt + (far ? 5 : 9));
      skin(ctx, spath(tp), far ? P.far : P.fill, P.line, j[1], pts[1][1], null, far ? 0.6 : 0.8);
    } else {
      const p = spath(tube({ pts, wt: ws, wb: ws }, 0.6, 0.6));
      skin(ctx, p, far ? P.far : P.fill, P.line, j[1], 0, null, far ? 0.6 : 1);
    }
    footShape(ctx, P, Q, pts[3], ws[3], far);
  }
  function footShape(ctx, P, Q, f, w, far) {
    const x = f[0], y = Math.min(f[1], -0.005), dark = far ? 'hsla(30,15%,14%,1)' : 'hsla(30,12%,18%,1)';
    switch (Q.foot) {
      case 'hoof': { const p = lpath([[x - w * 0.9, y - w * 0.9], [x + w * 0.9, y - w * 0.9], [x + w * 1.15, y + w * 0.15], [x - w * 1.0, y + w * 0.15]], true); skin(ctx, p, dark, P.line, y - w, y); break; }
      case 'pad': { const p = ell(x + w * 0.1, y - w * 0.36, w * 1.05, w * 0.42); skin(ctx, p, far ? P.far : P.fill, P.line, y - w, y); if (R.lod) for (let k = -1; k <= 1; k++) dot(ctx, x + k * w * 0.6 + w * 0.3, y - w * 0.2, w * 0.18, 'hsla(40,20%,85%,.9)'); break; }
      case 'paw': { const p = ell(x + w * 0.35, y - w * 0.45, w * 1.1, w * 0.62); skin(ctx, p, far ? P.far : P.fill, P.line, y - w, y); break; }
      case 'web': { const p = new Path2D(); p.moveTo(x - w * 0.3, y - w * 0.6); for (let k = 0; k < 4; k++) { const a = -0.4 + k * 0.35; p.lineTo(x + Math.cos(a) * w * 2.2, y - w * 0.1 + Math.sin(a) * w * 0.6); p.lineTo(x + Math.cos(a + 0.17) * w * 1.3, y - w * 0.15 + Math.sin(a + 0.17) * w * 0.4); } p.closePath(); skin(ctx, p, far ? P.far : P.fill, P.line, y - w, y); break; }
      default: {
        const talon = Q.foot === 'talon', q = new Path2D(), n = talon ? 3 : 3, L = w * (talon ? 2.4 : 1.7);
        for (let k = 0; k < n; k++) { const a = -0.25 + k * 0.25; q.moveTo(x, y - w * 0.3); q.lineTo(x + Math.cos(a) * L, y - w * 0.15 + Math.sin(a) * L * 0.3); }
        if (talon) { q.moveTo(x, y - w * 0.3); q.lineTo(x - L * 0.55, y - w * 0.1); }
        ctx.lineWidth = w * 0.7 + 2 * R.lw; ctx.strokeStyle = P.line; ctx.stroke(q);
        ctx.lineWidth = w * 0.7; ctx.strokeStyle = talon ? 'hsla(45,55%,58%,1)' : far ? P.far : P.fill; ctx.stroke(q);
      }
    }
  }
  function drawTetra(ctx, P) {
    const g = P.g, Q = geoTetra(g, P), t = R.t;
    setColors(P, furTone(g, P.c, Q.cover));
    const { BL, BH, LH, SH, NL, NA, cr, TL, TW, kind } = Q, bip = Q.post === 'biped';
    const hip = [0, -LH - BH * 0.3];
    const bird = kind === 'bird';
    const sh = bip ? [BL * (bird ? 0.6 : 0.7), hip[1] - BL * (bird ? 0.55 : 0.14)] : [BL, -SH - BH * (Q.frog ? 0.75 : 0.3)];
    const mid = [(hip[0] + sh[0]) / 2, (hip[1] + sh[1]) / 2 + BH * 0.08];
    // 새는 비스듬히 선 자세: 꼬리 뿌리가 몸통 축(어깨→엉덩이)을 따라 이어진다
    const axd = Math.hypot(hip[0] - sh[0], hip[1] - sh[1]) || 1, ax = (hip[0] - sh[0]) / axd, ay = (hip[1] - sh[1]) / axd;
    const tb = bird ? [hip[0] + ax * BH * 0.75, hip[1] + ay * BH * 0.75] : [hip[0] - BH * 0.55, hip[1] - BH * 0.15], sw = Math.sin(t * 2.2) * 0.1;
    const d1 = Q.droop, d2 = Q.droop + Q.curl * 0.6 + sw;
    const tm = [tb[0] - TL * 0.5 * Math.cos(d1), Math.min(-0.04, tb[1] + TL * 0.5 * Math.sin(d1))];
    const tt = [tm[0] - TL * 0.5 * Math.cos(d2), Math.min(-0.03, tm[1] + TL * 0.5 * Math.sin(d2))];
    const nb = [sh[0] + BH * 0.3, sh[1] - BH * 0.25], na = NA + Math.sin(t * 1.3) * 0.04;
    const ne = [nb[0] + NL * Math.cos(na), nb[1] - NL * Math.sin(na)];
    const nm = [(nb[0] + ne[0]) / 2 - NL * 0.1 * Math.sin(na), (nb[1] + ne[1]) / 2 - NL * 0.04];
    const NW = Math.min(cr * 0.72, BH * 0.72);
    let pts, wt, wb;
    if (TL > 0.02) {
      pts = [tt, tm, tb, hip, mid, sh, nb, nm, ne];
      wt = [0.008, TW * 0.55, TW, BH * 0.92, BH, BH * 0.95, NW * 1.4, NW * 1.1, NW];
      wb = [0.008, TW * 0.5, TW * 0.85, BH * 0.9, BH * 1.08, BH * 0.92, NW * 1.3, NW * 1.05, NW];
    } else {
      pts = [[hip[0] - BH * 0.55, hip[1] + BH * 0.15], hip, mid, sh, nb, nm, ne];
      wt = [BH * 0.4, BH * 0.92, BH, BH * 0.95, NW * 1.4, NW * 1.1, NW];
      wb = [BH * 0.45, BH * 0.95, BH * 1.08, BH * 0.92, NW * 1.3, NW * 1.05, NW];
    }
    const S = spineOf(pts, wt, wb);
    const ha = { amphibian: 0, reptile: 0.1, mammal: 0.35, longneck: 0.2, cat: 0.15, theropod: 0.12, croc: 0.02, bird: 0.05 }[kind] + Math.sin(t * 1.3 + 1) * 0.03;
    const hc = [ne[0] + cr * 0.3, ne[1] - cr * 0.12];
    const reach = cr * 0.55 + Q.sl + Q.sd * 0.3 + (g.mouth === 4 && !bip ? cr * 0.8 : 0) + (kind === 'bird' ? cr * 1.1 : 0);
    // 크기 맞추기: 몸·다리·머리·장식의 범위
    const b = BB(); bbPts(b, pts, BH * 1.05); bbAdd(b, 0, 0.02, 0); bbAdd(b, hc[0] + Math.cos(ha) * reach, hc[1] + Math.sin(ha) * reach, Q.sd);
    bbAdd(b, hc[0], hc[1], cr * 1.15); bbAdd(b, hip[0] + LH * 0.35, 0, 0);
    if (Q.ears || g.horn === 1) bbAdd(b, hc[0] - cr * 0.6, hc[1] - cr * (1.7 + 0.8 * g.ant + (g.horn === 1 ? g.spike * 1.2 : 0)), 0);
    if (g.horn === 3) bbAdd(b, mid[0], mid[1] - BH * (1.6 + 1.6 * g.spike), 0);
    if (g.horn === 2) bbAdd(b, hc[0] - cr * 1.4, hc[1] - cr * 1.5, 0);
    const tailL = bird ? 0.45 + 0.4 * g.tail : 0.3, plumes = bird && g.horn === 3;
    const tailA = bird && !plumes ? PI - clamp(Math.min(0.5, Math.asin(clamp((-tb[1] - 0.04) / tailL, 0, 1)) - 0.34), 0, 0.5) : PI + (plumes ? 0.12 : 0.15);
    if (bird) {
      for (const far of [true, false]) { const W = birdWingGeo(Q, g, sh, hip, far, 0); for (const q of W.F) bbAdd(b, q[0] + Math.cos(q[2]) * q[3], q[1] + Math.sin(q[2]) * q[3], q[4] + 0.07); if (W.tip) bbAdd(b, W.tip[0], W.tip[1], 0.07); }
      for (const [a, LL, w] of tailGeo(tailL, plumes, tailA)) bbAdd(b, tb[0] + Math.cos(a) * LL, tb[1] + Math.sin(a) * LL, w + 0.04);
    } else if (kind === 'theropod' && Q.cover === 'feathers') bbAdd(b, tb[0] - 0.35, tb[1], 0);
    fit(ctx, b[0], b[1], b[2], b[3], 0.93);
    shadow(ctx, (b[0] + b[2]) / 2 + 0.05, 0.005, (b[2] - b[0]) * 0.42, 0.05);
    const hj = [hip[0] + BH * 0.15, hip[1] + BH * 0.25], fj = [sh[0] - BH * 0.1, sh[1] + BH * 0.3];
    const farOff = [BH * 0.22, -BH * 0.06];
    const offJ = (j) => [j[0] + farOff[0], j[1] + farOff[1]];
    // 먼 쪽 다리·날개
    tetraLeg(ctx, P, Q, offJ(hj), false, true, PI);
    if (!bip) tetraLeg(ctx, P, Q, offJ(fj), true, true, 0);
    if (Q.extra) tetraLeg(ctx, P, Q, offJ([mid[0], mid[1] + BH * 0.4]), true, true, PI / 2);
    if (kind === 'bird') birdWing(ctx, P, Q, sh, hip, true);
    // 등 장식 (몸 뒤)
    backDeco(ctx, P, Q, S, mid);
    if (bird || (kind === 'theropod' && Q.cover === 'feathers')) tailFan(ctx, P, tb, tailL, plumes, tailA);
    if (bird) tetraLeg(ctx, P, Q, hj, false, false, 0);
    // 몸통
    let outl = tube(S, TL > 0.02 ? 0.7 : 1.3, 0.4);
    if ((Q.cover === 'fur' || Q.cover === 'feathers') && R.lod) outl = fuzz(dens(outl, 4), Q.cover === 'fur' ? 0.02 : 0.016, P.salt);
    const body = spath(outl);
    const yTop = Math.min(sh[1], hip[1]) - BH, yBot = Math.max(sh[1], hip[1]) + BH;
    skin(ctx, body, P.fill, P.line, yTop, yBot, (c) => {
      bellyShade(c, body, P, (hip[1] + sh[1]) / 2, yBot, Q.cover === 'shell' ? 0.3 : 0.75);
      spinePat(c, S, P, 0.04, 0.88);
      coverTexture(c, P, Q, S, yTop, yBot);
    });
    if (Q.cover === 'shell') turtleShell(ctx, P, Q, hip, sh);
    if (Q.cover === 'plates') osteoderms(ctx, P, S, Q);
    if (kind === 'mammal' && Q.cover === 'fur' && TL > 0.3 && R.lod) { const tf = ell(tt[0], tt[1] + 0.02, 0.05, 0.08, 0.4); skin(ctx, tf, P.dark, P.line, -1, 1); }
    // 가까운 쪽 다리
    if (Q.extra) tetraLeg(ctx, P, Q, [mid[0], mid[1] + BH * 0.4], true, false, PI * 1.5);
    if (!bird) tetraLeg(ctx, P, Q, hj, false, false, 0);
    if (!bip) tetraLeg(ctx, P, Q, fj, true, false, PI);
    else if (kind === 'theropod') { // 짧은 앞발
      const a = [sh[0] + BH * 0.15, sh[1] + BH * 0.35], al = BH * (0.7 + 0.5 * g.limbL);
      const pts2 = [a, [a[0] + al * 0.45, a[1] + al * 0.5], [a[0] + al * 0.9, a[1] + al * 0.45]];
      const w = BH * 0.22, p = spath(tube({ pts: pts2, wt: [w, w * 0.7, w * 0.5], wb: [w, w * 0.7, w * 0.5] }, 0.5, 0.5));
      skin(ctx, p, P.fill, P.line, a[1], a[1] + al);
      footShape(ctx, P, { foot: 'claw' }, pts2[2], w * 0.5, false);
    }
    if (kind === 'bird') birdWing(ctx, P, Q, sh, hip, false);
    // 머리
    ctx.save();
    ctx.translate(hc[0], hc[1]); ctx.rotate(ha);
    tetraHead(ctx, P, Q);
    ctx.restore();
  }
  function coverTexture(c, P, Q, S, y0, y1) {
    if (R.lod < 2) return;
    if (Q.cover === 'scales' || Q.cover === 'plates') {
      const st = 0.045;
      c.strokeStyle = css(P.c, -0.22, 0, 0.22); c.lineWidth = PX(0.9);
      c.beginPath();
      for (let y = y0, r = 0; y < y1; y += st * 0.75, r++) for (let x = S.pts[0][0] - 0.2; x < S.pts[S.pts.length - 1][0] + 0.2; x += st) { const xx = x + (r % 2) * st * 0.5; c.moveTo(xx + st * 0.5, y); c.arc(xx, y, st * 0.5, 0, PI); }
      c.stroke();
    } else if (Q.cover === 'fur' || Q.cover === 'feathers') {
      c.strokeStyle = css(P.c, -0.18, 0, 0.25); c.lineWidth = PX(1);
      c.beginPath();
      for (let k = 0; k < 60; k++) { const q = spineAt(S, S.len * (0.08 + 0.85 * hr(k, P.salt + 40))), v = hr(k, P.salt + 41) * 2 - 1, x = q[0] + q[2] * v * q[4] * 0.8, y = q[1] + q[3] * v * q[4] * 0.8; c.moveTo(x, y); c.lineTo(x - q[6] * 0.05 + q[2] * 0.01, y - q[7] * 0.05 + q[3] * 0.01); }
      c.stroke();
    } else if (Q.cover === 'skin' && Q.kind === 'amphibian') {
      for (let k = 0; k < 10; k++) { const q = spineAt(S, S.len * (0.2 + 0.7 * hr(k, P.salt + 60))); dot(c, q[0] + q[2] * q[4] * 0.4, q[1] + q[3] * q[4] * 0.4, 0.012, 'rgba(255,255,255,.35)'); }
    }
  }
  function osteoderms(ctx, P, S, Q) {
    const n = R.lod ? 12 : 6;
    for (let k = 0; k < n; k++) {
      const q = spineAt(S, S.len * (0.15 + (0.7 * k) / (n - 1))), x = q[0] + q[2] * q[4] * 0.95, y = q[1] + q[3] * q[4] * 0.95, r = Math.max(0.02, q[4] * 0.22);
      skinR(ctx, ell(x, y, r * 1.2, r * 0.8, Math.atan2(q[7], q[6])), css(P.c, -0.08), P.line, x, y, r);
    }
    if (Q.kind === 'mammal' && R.lod) for (let k = 0; k < 7; k++) { const q = spineAt(S, S.len * (0.3 + k * 0.06)); strokeP(ctx, lpath([[q[0] + q[2] * q[4] * 0.95, q[1] + q[3] * q[4] * 0.95], [q[0] - q[2] * q[5] * 0.5, q[1] - q[3] * q[5] * 0.5]]), P.line, R.lw * 0.8); }
  }
  function turtleShell(ctx, P, Q, hip, sh) {
    const x0 = hip[0] - Q.BH * 0.5, x1 = sh[0] + Q.BH * 0.25, yb = (hip[1] + sh[1]) / 2 + Q.BH * 0.35, top = yb - Q.BH * 1.9;
    const p = new Path2D(); p.moveTo(x0, yb); p.bezierCurveTo(x0 + 0.05, top, x1 - 0.05, top, x1, yb); p.closePath();
    skin(ctx, p, css(P.a, -0.05, -0.15), P.accLine, top, yb, (c) => {
      c.strokeStyle = P.accLine; c.lineWidth = R.lw;
      c.beginPath();
      const w = x1 - x0;
      for (let k = 1; k < 4; k++) { const x = x0 + (w * k) / 4; c.moveTo(x, yb); c.lineTo(x + (k - 2) * 0.03, top + (yb - top) * 0.35); }
      c.moveTo(x0 + w * 0.12, yb - (yb - top) * 0.4); c.quadraticCurveTo((x0 + x1) / 2, top + (yb - top) * 0.15, x1 - w * 0.12, yb - (yb - top) * 0.4);
      c.stroke();
    });
    strokeP(ctx, lpath([[x0 - 0.03, yb], [x1 + 0.03, yb]]), P.accLine, Math.max(R.lw * 2, 0.03));
  }
  function backDeco(ctx, P, Q, S, mid) {
    const g = P.g, h = g.horn;
    if (h !== 3) return;
    const kind = Q.kind, n = R.lod ? 9 : 5, top = (k) => { const q = spineAt(S, S.len * k); return [q[0] + q[2] * q[4] * 0.8, q[1] + q[3] * q[4] * 0.8, q]; };
    if (kind === 'amphibian' || kind === 'theropod' || (kind === 'reptile' && g.spike < 0.5)) { // 등 돛
      const s0 = 0.3, s1 = 0.75, H = Q.BH * (1.0 + 1.6 * g.spike), pts = [];
      for (let k = 0; k <= 8; k++) { const u = k / 8, e = top(lerp(s0, s1, u)); pts.push([e[0], e[1] - H * Math.sin(PI * u) * (0.6 + 0.4 * Math.sin(PI * u))]); }
      const base = []; for (let k = 8; k >= 0; k--) base.push(top(lerp(s0, s1, k / 8)).slice(0, 2));
      const p = spath(pts.concat(base));
      skin(ctx, p, P.acc, P.accLine, mid[1] - H * 1.5, mid[1], (c) => { if (!R.lod) return; c.strokeStyle = P.accLine; c.lineWidth = R.lw * 0.8; c.beginPath(); for (let k = 1; k < 8; k++) { const a = top(lerp(s0, s1, k / 8)); c.moveTo(a[0], a[1] + 0.02); c.lineTo(pts[k][0], pts[k][1]); } c.stroke(); });
    } else if (kind === 'reptile' || kind === 'longneck' || kind === 'croc') { // 골판
      for (let k = 0; k < n; k++) {
        const u = 0.12 + (0.68 * k) / (n - 1), e = top(u), q = e[2], s = Q.BH * (0.35 + 0.7 * g.spike) * Math.sin(PI * (0.15 + 0.7 * (k / (n - 1)))) * (kind === 'croc' ? 0.35 : 1);
        const a = Math.atan2(q[7], q[6]), up = [q[2], q[3]];
        const p = lpath([[e[0] - Math.cos(a) * s * 0.4, e[1] - Math.sin(a) * s * 0.4], [e[0] + up[0] * s, e[1] + up[1] * s], [e[0] + Math.cos(a) * s * 0.4, e[1] + Math.sin(a) * s * 0.4]], true);
        skin(ctx, p, k % 2 ? P.acc : css(P.a, -0.06), P.accLine, e[1] - s, e[1]);
      }
    } else { // 가시털·갈기
      const q2 = new Path2D();
      for (let k = 0; k < 24; k++) { const e = top(0.2 + 0.65 * (k / 23)), q = e[2], s = Q.BH * (0.3 + 0.5 * g.spike) * (0.7 + 0.3 * hr(k, P.salt)); q2.moveTo(e[0], e[1]); q2.lineTo(e[0] + q[2] * s - q[6] * s * 0.5, e[1] + q[3] * s - q[7] * s * 0.5); }
      ctx.lineWidth = PX(2) + 2 * R.lw; ctx.strokeStyle = P.line; ctx.stroke(q2);
      ctx.lineWidth = PX(2); ctx.strokeStyle = P.acc; ctx.stroke(q2);
    }
  }
  // 꼬리깃: [각도, 길이, 폭] (그리기와 범위 계산 공용)
  function tailGeo(L, plumes, a0, tt) {
    const n = plumes ? 3 : 5, out = [];
    for (let k = 0; k < n; k++) {
      const a = a0 + (k - (n - 1) / 2) * 0.16 + (tt == null ? 0 : Math.sin(tt * 2 + k) * 0.03), LL = L * (plumes ? 2.2 + 0.4 * k : 1 - Math.abs(k - (n - 1) / 2) * 0.12);
      out.push([a, LL, LL * (plumes ? 0.07 : 0.16)]);
    }
    return out;
  }
  function tailFan(ctx, P, tb, L, plumes, a0) {
    tailGeo(L, plumes, a0 == null ? PI + 0.15 : a0, R.t).forEach(([a, LL, w], k) => {
      drawLeaf(ctx, P, tb[0], tb[1], a, LL, w, plumes ? 0 : 1, k % 2 ? P.dark : P.acc);
      if (plumes && R.lod) { const ex = tb[0] + Math.cos(a) * LL, ey = tb[1] + Math.sin(a) * LL; dot(ctx, ex, ey, LL * 0.08, P.acc); dot(ctx, ex, ey, LL * 0.04, '#141a2a'); }
    });
  }
  // 새 날개: 깃털 하나하나 [밑동 x, y, 방향, 길이, 폭]. 들어 올린 날개는 손끝 첫째날개깃이 손가락처럼 벌어지고,
  // 접은 날개는 몸 옆에 붙어 첫째날개깃 끝이 꼬리 쪽으로 뻗는다
  function birdWingGeo(Q, g, sh, hip, far, flap) {
    const span = Q.BL * (0.8 + 0.5 * g.wing), BH = Q.BH;
    if (bit1(g)) {
      const root = [sh[0] - BH * 0.3, sh[1] + BH * 0.05], a = -PI * 0.6 + (far ? -0.34 : 0) + flap;
      const wr = [root[0] + Math.cos(a) * span * 0.45, root[1] + Math.sin(a) * span * 0.45];
      const ah = a - 0.3, tip = [wr[0] + Math.cos(ah) * span * 0.4, wr[1] + Math.sin(ah) * span * 0.4];
      const F = [];
      for (let k = 0; k < 5; k++) { const u = (k + 0.5) / 5; F.push([lerp(root[0], wr[0], u), lerp(root[1], wr[1], u), a - 1.5 + 0.12 * u, span * (0.27 + 0.05 * u), span * 0.075]); }
      for (let k = 0; k < 6; k++) { const u = k / 5; F.push([lerp(wr[0], tip[0], 0.1 + 0.9 * u), lerp(wr[1], tip[1], 0.1 + 0.9 * u), a - 1.3 + 1.0 * u, span * (0.3 + 0.14 * u), span * 0.06]); }
      const cov = [root, [lerp(root[0], wr[0], 0.5) + Math.cos(a + 1.4) * BH * 0.12, lerp(root[1], wr[1], 0.5) + Math.sin(a + 1.4) * BH * 0.12], wr, [lerp(wr[0], tip[0], 0.32), lerp(wr[1], tip[1], 0.32)],
        [wr[0] + Math.cos(a - 1.35) * span * 0.15, wr[1] + Math.sin(a - 1.35) * span * 0.15], [lerp(root[0], wr[0], 0.5) + Math.cos(a - 1.5) * span * 0.16, lerp(root[1], wr[1], 0.5) + Math.sin(a - 1.5) * span * 0.16],
        [root[0] + Math.cos(a - 1.75) * span * 0.11, root[1] + Math.sin(a - 1.75) * span * 0.11]];
      return { open: true, root, wr, tip, a, F, cov };
    }
    const ux0 = hip[0] - sh[0], uy0 = hip[1] - sh[1], d = Math.hypot(ux0, uy0) || 1, ux = ux0 / d, uy = uy0 / d, nx = uy, ny = -ux;
    const at = (sA, nA) => [sh[0] + ux * sA + nx * nA, sh[1] + uy * sA + ny * nA];
    const L = d + BH * (1.0 + 0.5 * g.wing), au = Math.atan2(uy, ux) + flap * 0.25, F = [];
    for (let k = 0; k < 4; k++) { const sA = d * (0.42 + 0.1 * k), nA = BH * (0.36 - 0.11 * k), [bx, by] = at(sA, nA); F.push([bx, by, au + 0.05 * (1.5 - k), L - sA - BH * 0.06 * k, BH * 0.2]); }
    const cov = [at(-BH * 0.2, BH * 0.3), at(d * 0.22, BH * 0.7), at(d * 0.58, BH * 0.62), at(d * 0.74, BH * 0.3), at(d * 0.6, -BH * 0.02), at(d * 0.25, -BH * 0.15), at(-BH * 0.05, -BH * 0.05)];
    return { open: false, F, cov, tip: at(L, BH * 0.15) };
  }
  function birdWing(ctx, P, Q, sh, hip, far) {
    const g = P.g, W = birdWingGeo(Q, g, sh, hip, far, Math.sin(R.t * 3) * 0.08);
    const cPri = far ? css(P.c, -0.22, -0.05) : css(P.a, -0.1, -0.15), cSec = far ? css(P.c, -0.18) : css(P.c, -0.08), cCov = far ? P.far : css(P.c, 0.02);
    const nSec = W.open ? 5 : 0;
    if (!R.lod) { // 작은 그림: 깃털 끝을 이은 한 덩어리 날개 (그리기 횟수를 줄인다)
      let pts = W.cov;
      if (W.open) { const tips = W.F.map((q) => [q[0] + Math.cos(q[2]) * q[3], q[1] + Math.sin(q[2]) * q[3]]); pts = [W.root, W.cov[1], W.wr, W.tip, ...tips.slice(nSec).reverse(), ...tips.slice(0, nSec).reverse()]; }
      else { const q = W.F[0]; drawLeaf(ctx, P, q[0], q[1], q[2], q[3], q[4] * 1.5, 1, cPri); }
      const p = spath(pts); ctx.fillStyle = W.open ? cPri : cCov; ctx.fill(p); outline(ctx, p, P.line, 0.8);
      if (W.open) { const c = spath(W.cov); ctx.fillStyle = cCov; ctx.fill(c); }
      return;
    }
    W.F.forEach((q, k) => drawLeaf(ctx, P, q[0], q[1], q[2], q[3], q[4], 1, k < nSec ? cSec : cPri));
    const cp = spath(W.cov);
    skin(ctx, cp, cCov, P.line, Math.min(...W.cov.map((q) => q[1])), Math.max(...W.cov.map((q) => q[1])), (c) => {
      if (!R.lod) return;
      // 덮깃: 비늘처럼 겹친 작은 깃털 줄
      c.strokeStyle = css(P.c, -0.22, 0, 0.5); c.lineWidth = PX(1);
      c.beginPath();
      const A = W.cov[0], B = W.open ? W.wr : W.cov[3], rows = R.lod > 1 ? 3 : 2;
      for (let r = 1; r <= rows; r++) for (let k = 0; k < 6; k++) {
        const u = (k + 0.5) / 6, v = r / (rows + 1), x = lerp(A[0], B[0], u) + (W.cov[5][0] - W.cov[1][0]) * v, y = lerp(A[1], B[1], u) + (W.cov[5][1] - W.cov[1][1]) * v, rr = Q.BH * 0.09;
        c.moveTo(x + rr, y); c.arc(x, y, rr, 0, PI);
      }
      c.stroke();
    });
  }
  function tetraHead(ctx, P, Q) {
    const g = P.g, kind = Q.kind, cr = Q.cr, sl = Q.sl, sd = Q.sd, pred = P.pk === 'hunter';
    const crown = { amphibian: 0.72, croc: 0.6, bird: 1.02, mammal: 1.05, cat: 1.0, theropod: 0.85, longneck: 0.95, reptile: 0.8 }[kind];
    const jd = sd * (pred ? 1.25 : 1.05), nx = cr * 0.55 + sl;
    // 뒤쪽 장식: 귀·주름 목도리·갈기·아가미
    if (g.horn === 2) {
      if (kind === 'reptile' || kind === 'croc') {
        const p = spath([[-cr * 0.2, cr * 0.5], [-cr * 1.3, cr * 0.4], [-cr * 1.6, -cr * 0.5], [-cr * 1.0, -cr * 1.5], [cr * 0.1, -cr * 1.1]]);
        skin(ctx, p, P.acc, P.accLine, -cr * 1.5, cr * 0.5, (c) => { if (R.lod) { dot(c, -cr * 1.0, -cr * 0.5, cr * 0.25, P.patCol); dot(c, -cr * 1.0, -cr * 0.5, cr * 0.12, P.fill); } });
      } else if (kind === 'amphibian') {
        for (let k = 0; k < 3; k++) { const a = -PI * 0.75 - k * 0.32, x0 = -cr * 0.6, y0 = -cr * 0.2 + k * cr * 0.25, L = cr * (0.9 + 0.3 * g.spike); limb(ctx, [[x0, y0], [x0 + Math.cos(a) * L * 0.5, y0 + Math.sin(a) * L * 0.5], [x0 + Math.cos(a - 0.2) * L, y0 + Math.sin(a - 0.2) * L]], cr * 0.12, P.acc, P.accLine, true); if (R.lod) for (let j = 1; j < 4; j++) dot(ctx, x0 + Math.cos(a) * L * j * 0.25, y0 + Math.sin(a) * L * j * 0.25, cr * 0.09, P.acc); }
      } else if (Q.cover === 'fur' && (kind === 'cat' || kind === 'mammal')) {
        const pts = []; for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU, r = cr * (1.35 + (k % 2 ? 0.25 : 0)); pts.push([-cr * 0.25 + Math.cos(a) * r, cr * 0.1 + Math.sin(a) * r * 1.05]); }
        skinR(ctx, spath(pts), css(P.a, -0.1, -0.15), P.line, -cr * 0.2, 0, cr * 1.4);
      }
    }
    if (Q.ears) {
      const L = cr * (kind === 'cat' ? 0.55 + 0.35 * g.ant : 0.6 + 0.9 * g.ant), pointed = kind === 'cat' || g.ant > 0.6;
      const b0 = [-cr * 0.55, -cr * 0.7], b1 = [-cr * 0.05, -cr * 0.95], tp = kind === 'cat' ? [-cr * 0.4, -cr * 0.95 - L] : [-cr * 0.55 - L * 0.55, -cr * 0.85 - L * 0.75];
      const ear = pointed ? spath([b0, [lerp(b0[0], tp[0], 0.6) - cr * 0.08, lerp(b0[1], tp[1], 0.6)], tp, [lerp(b1[0], tp[0], 0.5) + cr * 0.05, lerp(b1[1], tp[1], 0.5)], b1]) : ell((b0[0] + tp[0]) / 2 + cr * 0.15, (b0[1] + tp[1]) / 2, cr * 0.22, L * 0.55, Math.atan2(tp[1] - b0[1], tp[0] - b0[0]) + PI / 2);
      skin(ctx, ear, P.fill, P.line, tp[1], b1[1]);
      if (R.lod) { ctx.save(); ctx.clip(ear); ctx.fillStyle = 'hsla(350,45%,72%,.6)'; ctx.fill(ell((b0[0] + tp[0] + b1[0]) / 3 + cr * 0.05, (b0[1] + tp[1] + b1[1]) / 3 + cr * 0.05, cr * 0.1, L * 0.3, Math.atan2(tp[1] - b0[1], tp[0] - b0[0]) + PI / 2)); ctx.restore(); }
    }
    // 머리 본체
    let hp;
    if (kind === 'bird') hp = ell(0, 0, cr * 1.02, cr * 0.88);
    else hp = spath(headPts(cr, sl, sd, jd, crown));
    skin(ctx, hp, P.fill, P.line, -cr, jd, (c) => {
      bellyShade(c, hp, P, sd * 0.1, jd, 0.7);
      if (g.pat === 1 || g.pat === 4) for (let k = 0; k < 3; k++) dot(c, -cr * 0.4 + cr * 0.6 * hr(k, P.salt + 70), -cr * 0.5 + cr * 0.4 * hr(k, P.salt + 71), cr * 0.12, P.patCol);
      if (g.pat === 2) { c.fillStyle = P.patCol; for (let k = 0; k < 2; k++) c.fillRect(-cr * (0.7 - k * 0.35), -cr * 1.2, cr * 0.12, cr * 1.0); }
    });
    // 주둥이 유형
    const lipY = sd * 0.25;
    if (kind === 'bird') {
      // 맹금 부리: 위로 둥글게 솟았다가 끝이 아래로 굽는 갈고리 + 부리 뿌리의 노란 납막
      const BKL = cr * (0.62 + 0.4 * (1 - g.round)), bx = cr * 0.72, hook = cr * (0.26 + 0.14 * (1 - g.round));
      const bc = g.acc > 0.55 ? 'hsla(40,22%,72%,1)' : 'hsla(220,12%,28%,1)';
      const lower = spath([[bx - cr * 0.05, cr * 0.14], [bx + BKL * 0.5, cr * 0.15], [bx + BKL * 0.58, cr * 0.22], [bx + BKL * 0.28, cr * 0.3], [bx - cr * 0.08, cr * 0.32]]);
      skin(ctx, lower, bc, P.line, cr * 0.1, cr * 0.32);
      const upper = spath([[bx - cr * 0.14, -cr * 0.42], [bx + BKL * 0.35, -cr * 0.38], [bx + BKL * 0.8, -cr * 0.14], [bx + BKL * 0.96, cr * 0.12], [bx + BKL * 0.84, cr * 0.12 + hook], [bx + BKL * 0.7, cr * 0.18], [bx + BKL * 0.42, cr * 0.11], [bx - cr * 0.06, cr * 0.15]]);
      skin(ctx, upper, bc, P.line, -cr * 0.42, cr * 0.3);
      const cere = spath([[bx - cr * 0.16, -cr * 0.43], [bx + BKL * 0.2, -cr * 0.4], [bx + BKL * 0.22, cr * 0.02], [bx - cr * 0.12, cr * 0.15]]);
      ctx.fillStyle = 'hsla(46,85%,56%,1)'; ctx.fill(cere); outline(ctx, cere, P.line, 0.8);
      if (R.lod) dot(ctx, bx + BKL * 0.08, -cr * 0.18, Math.max(PX(0.8), cr * 0.05), 'rgba(40,25,10,.8)');
      if (g.horn === 1) { const cq = spath([[bx - cr * 0.05, -cr * 0.36], [bx + BKL * 0.3, -cr * 0.62], [bx + BKL * 0.55, -cr * 0.3]]); skin(ctx, cq, 'hsla(20,70%,52%,1)', P.line, -cr * 0.6, -cr * 0.2); }
    } else {
      if (g.mouth === 0 && !pred) { const bill = spath([[nx - sl * 0.35, -sd * 0.55], [nx + sd * 0.55, -sd * 0.4], [nx + sd * 0.7, sd * 0.1], [nx + sd * 0.45, sd * 0.4], [nx - sl * 0.35, sd * 0.35]]); skin(ctx, bill, 'hsla(38,30%,72%,1)', P.line, -sd, sd); }
      if (g.mouth === 2 && !pred) { const bk = spath([[nx - sl * 0.25, -sd * 0.7], [nx + sd * 0.35, -sd * 0.3], [nx + sd * 0.15, sd * 0.45], [nx - sl * 0.2, sd * 0.5]]); skin(ctx, bk, 'hsla(40,25%,28%,1)', P.line, -sd, sd); }
      // 입 선 + 이빨
      const corner = pred ? [-cr * 0.05, lipY + sd * 0.15] : [cr * 0.35 + sl * 0.2, lipY + sd * 0.1], tipM = [nx + sd * 0.12, lipY];
      strokeP(ctx, spath([tipM, [lerp(tipM[0], corner[0], 0.5), lipY + sd * 0.05], corner], true), P.line, R.lw * 1.2);
      if (pred && R.lod) {
        const n = 4 + Math.round((sl / cr) * 2.5);
        ctx.fillStyle = '#f4eedf'; ctx.beginPath();
        for (let k = 0; k < n; k++) { const u = (k + 0.5) / n, x = lerp(tipM[0], corner[0] + cr * 0.15, u), y = lerp(lipY, corner[1], u) + sd * 0.02, s = sd * (k === 0 && kind === 'cat' ? 0.45 : 0.2); ctx.moveTo(x - s * 0.4, y); ctx.lineTo(x, y + s); ctx.lineTo(x + s * 0.4, y); }
        ctx.fill();
      }
      if (kind === 'cat' && g.horn === 1) { const s = spath([[nx - sl * 0.6, lipY], [nx - sl * 0.5, lipY + cr * (0.6 + 0.6 * g.spike)], [nx - sl * 0.35, lipY]]); skin(ctx, s, '#f1e8d2', P.line, lipY, lipY + cr); }
      if (R.lod) dot(ctx, nx - sd * 0.1, -sd * 0.38, Math.max(PX(1), sd * 0.1), 'rgba(0,0,0,.6)');
      if (g.mouth === 3 && R.lod) for (let k = 0; k < 3; k++) strokeP(ctx, spath([[nx - sd * 0.1, -sd * 0.1 + k * sd * 0.15], [nx + sd * 0.8, -sd * 0.3 + k * sd * 0.3], [nx + sd * 1.4, -sd * 0.2 + k * sd * 0.5]], true), 'rgba(240,235,220,.85)', PX(1));
      if (g.mouth === 4 && !pred && (kind === 'mammal' || kind === 'longneck')) { // 코끼리 같은 긴 코 (+엄니)
        const TLn = cr * (0.9 + 0.8 * g.len), pts = [[nx - sd * 0.1, -sd * 0.2], [nx + sd * 0.4, sd * 0.2], [nx + sd * 0.55, TLn * 0.55], [nx + sd * 0.25 + Math.sin(R.t * 1.5) * 0.02, TLn]];
        const w = [sd * 0.5, sd * 0.42, sd * 0.32, sd * 0.25];
        if (g.spike > 0.55) { const tk = spath([[cr * 0.5 + sl * 0.5, sd * 0.3], [nx + sd * 0.8, sd * 0.9], [nx + sd * 1.2, sd * 0.4], [nx + sd * 0.9, sd * 0.75], [cr * 0.5 + sl * 0.5, sd * 0.55]]); skin(ctx, tk, '#efe6cf', P.line, 0, sd); }
        skin(ctx, spath(tube({ pts, wt: w, wb: w }, 0.4, 0.8)), P.fill, P.line, -sd, TLn);
      }
    }
    // 뿔
    if (g.horn === 1 && kind !== 'cat' && kind !== 'bird') {
      const hs = 0.6 + 1.0 * g.spike;
      if (kind === 'mammal' && g.spike > 0.55 && Q.cover === 'fur') { // 가지 뿔
        const m = [[-cr * 0.1, -cr * 0.9], [-cr * 0.35, -cr * 1.6], [-cr * 0.6, -cr * (2.0 + g.spike)]];
        limb(ctx, m, cr * 0.13, 'hsla(35,30%,62%,1)', P.line, true);
        for (let k = 1; k <= 2; k++) { const s = m[k]; limb(ctx, [s, [s[0] + cr * 0.45, s[1] - cr * 0.35]], cr * 0.09, 'hsla(35,30%,62%,1)', P.line); }
      } else if (kind === 'reptile' || kind === 'theropod' || kind === 'croc') {
        const nose = spath([[nx - sl * 0.45, -sd * 0.85], [nx - sl * 0.3, -sd * 0.9 - cr * 0.5 * hs], [nx - sl * 0.1, -sd * 0.75]]);
        if (kind === 'reptile') skin(ctx, nose, '#ece2c8', P.line, -cr, 0);
        const brow = spath([[cr * 0.05, -cr * 0.75], [cr * 0.25 + cr * 0.6 * hs, -cr * (0.9 + 0.5 * hs)], [cr * 0.4, -cr * 0.6]]);
        skin(ctx, brow, '#ece2c8', P.line, -cr * 1.5, 0);
      } else if (kind === 'longneck' && Q.cover === 'fur') {
        for (const dx of [0, cr * 0.25]) { limb(ctx, [[-cr * 0.1 + dx, -cr * 0.85], [-cr * 0.18 + dx, -cr * (1.4 + 0.3 * g.spike)]], cr * 0.13, P.fill, P.line); dot(ctx, -cr * 0.18 + dx, -cr * (1.4 + 0.3 * g.spike), cr * 0.12, P.dark); }
      } else {
        const hp2 = [[cr * 0.05, -cr * 0.85], [-cr * 0.45 * hs, -cr * (1.0 + 0.7 * hs)], [-cr * 0.9 * hs, -cr * (0.9 + 0.5 * hs)], [-cr * 1.0 * hs, -cr * 0.5 * hs - cr * 0.4]];
        const w = [cr * 0.17, cr * 0.13, cr * 0.08, cr * 0.02];
        skin(ctx, spath(tube({ pts: hp2, wt: w, wb: w }, 0.4, 0.5)), '#ebe0c4', P.line, -cr * 2, 0);
      }
    }
    if (g.horn === 2) {
      if (kind === 'longneck' || kind === 'theropod') { const cq = spath([[-cr * 0.3, -cr * 0.8], [-cr * 0.9, -cr * 1.5], [-cr * 0.5, -cr * 1.35], [cr * 0.3, -cr * 0.85]]); skin(ctx, cq, P.acc, P.accLine, -cr * 1.5, -cr * 0.7); }
      else if (kind === 'bird') for (let k = 0; k < 4; k++) drawLeaf(ctx, P, -cr * 0.1, -cr * 0.85, -PI * 0.65 - k * 0.22, cr * (0.9 + 0.5 * g.spike), cr * 0.12, 2, P.acc);
      else if (kind === 'croc') skinR(ctx, circ(nx, -sd * 0.6, sd * 0.6), P.dark, P.line, nx, -sd * 0.6, sd * 0.6);
    }
    // 눈
    const ep = { amphibian: [cr * 0.25, -cr * 0.68], croc: [cr * 0.12, -cr * 0.55], bird: [cr * 0.28, -cr * 0.2], theropod: [cr * 0.25, -cr * 0.42] }[kind] || [cr * 0.3, -cr * 0.32];
    const er = cr * ({ amphibian: 0.3, croc: 0.2, bird: 0.28, theropod: 0.17, longneck: 0.24 }[kind] || 0.22) * (0.8 + 0.45 * g.eyeS);
    if (kind === 'amphibian' || kind === 'croc') skin(ctx, ell(ep[0], ep[1] - er * 0.2, er * 1.35, er * 1.15), P.fill, P.line, ep[1] - er * 1.4, ep[1]);
    if (kind === 'theropod' || kind === 'reptile' || kind === 'croc') strokeP(ctx, spath([[ep[0] - er * 1.2, ep[1] - er * 1.0], [ep[0], ep[1] - er * 1.35], [ep[0] + er * 1.3, ep[1] - er * 0.9]], true), P.line, R.lw);
    const ek = kind === 'cat' || kind === 'croc' || kind === 'reptile' || kind === 'theropod' ? 'slit' : kind === 'mammal' && !pred && P.sz > 0.3 ? 'bar' : 'round';
    eye(ctx, ep[0], ep[1], er, kind === 'bird' ? { ...P, iris: hsl(36 + 16 * g.acc, 0.88, 0.55) } : P, ek);
    if (kind === 'bird') { // 눈 위로 튀어나온 눈썹뼈: 맹금의 매서운 눈매
      const br = spath([[ep[0] - er * 1.5, ep[1] - er * 0.35], [ep[0] - er * 0.3, ep[1] - er * 1.25], [ep[0] + er * 1.55, ep[1] - er * 0.95], [ep[0] + er * 1.35, ep[1] - er * 0.42], [ep[0] - er * 0.1, ep[1] - er * 0.72]]);
      skin(ctx, br, css(P.c, -0.08), P.line, ep[1] - er * 1.3, ep[1] - er * 0.3, null, 0.5);
    }
    const n = eyeCount(g);
    if (n === 4) eye(ctx, ep[0] - er * 2.1, ep[1] + er * 0.9, er * 0.72, P, ek);
    if (n === 3) eye(ctx, -cr * 0.2, -cr * crown * 0.92, er * 0.55, P, 'bead');
  }
  function drawPlesio(ctx, P) {
    const g = P.g, t = R.t, BH = 0.22 + 0.08 * g.wid, NL = 0.7 + 0.6 * g.neck, cr = 0.09 + 0.04 * g.head;
    const nb = [0.35, -0.05], ne = [nb[0] + NL * 0.75, nb[1] - NL * 0.5 + Math.sin(t) * 0.03], nm = [(nb[0] + ne[0]) / 2 - 0.05, (nb[1] + ne[1]) / 2 - 0.06];
    const pts = [[-0.95, 0.06], [-0.65, 0.04], [-0.35, 0], [0, -0.02], [0.3, -0.04], nb, nm, ne];
    const wt = [0.01, 0.06, BH * 0.85, BH, BH * 0.85, cr * 1.2, cr * 0.95, cr * 0.85], wb = [0.01, 0.05, BH * 0.8, BH * 1.05, BH * 0.8, cr * 1.1, cr * 0.9, cr * 0.85];
    const S = spineOf(pts, wt, wb);
    const b = BB(); bbPts(b, pts, BH); bbAdd(b, ne[0] + cr * 3.5, ne[1], cr); bbAdd(b, 0, BH + 0.4, 0);
    fit(ctx, b[0], b[1], b[2], b[3]);
    const flipper = (x, y, a, L, far) => { const pts2 = leafPts(x, y, a + Math.sin(t * 2 + x * 3) * 0.15, L, L * 0.18, 1, 0); skin(ctx, spath(pts2), far ? P.far : P.fill, P.line, y, y + L); };
    flipper(0.25, BH * 0.4, 2.2, 0.55 + 0.2 * g.limbL, true); flipper(-0.35, BH * 0.4, 2.3, 0.45 + 0.2 * g.limbL, true);
    const body = spath(tube(S, 0.5, 0.5));
    skin(ctx, body, P.fill, P.line, -BH, BH, (c) => { bellyShade(c, body, P, 0, BH, 0.8); spinePat(c, S, P, 0.05, 0.6); });
    flipper(0.15, BH * 0.55, 2.0, 0.6 + 0.2 * g.limbL, false); flipper(-0.45, BH * 0.55, 2.1, 0.5 + 0.2 * g.limbL, false);
    ctx.save(); ctx.translate(ne[0] + cr * 0.4, ne[1] - cr * 0.1); ctx.rotate(0.1);
    const hp = spath(headPts(cr, cr * 1.6, cr * 0.45, cr * 0.55, 0.8));
    skin(ctx, hp, P.fill, P.line, -cr, cr, (c) => bellyShade(c, hp, P, 0, cr, 0.7));
    const nx = cr * 0.55 + cr * 1.6, ly = cr * 0.12;
    strokeP(ctx, lpath([[nx + cr * 0.1, ly], [cr * 0.1, ly + cr * 0.12]]), P.line, R.lw * 1.2);
    if (R.lod) { ctx.fillStyle = '#f4eedf'; ctx.beginPath(); for (let k = 0; k < 6; k++) { const x = lerp(nx, cr * 0.2, k / 6); ctx.moveTo(x - 0.008, ly); ctx.lineTo(x - 0.003, ly + cr * 0.25); ctx.lineTo(x + 0.004, ly); } ctx.fill(); }
    eye(ctx, cr * 0.3, -cr * 0.3, cr * 0.28, P, 'round');
    ctx.restore();
  }

  /* ================= 지성 종 (앞모습: 두 발로 서서 손을 쓴다) ================= */
  function drawSapient(ctx, P) {
    const g = P.g, t = R.t, cover = coverOf(g, 'sapient', P.tr);
    setColors(P, furTone(g, P.c, cover));
    // 조상(옆모습 네발 동물)의 생김새: 귀·꼬리·부리를 이어받아 '같은 동물이 일어선' 모습이 되게
    const ap = ancPlan(P.tr), Qa = geoTetra(g, { pk: ap, form: formFor(g, ap, P.tr, true), sz: P.sz, intel: P.intel });
    const hr0 = 0.2 + 0.05 * g.head + 0.07 * P.intel, hy = -0.56, SW = 0.22 + 0.08 * g.wid, WW = SW * 0.74, HW = SW * 0.82;
    const spear = P.social > 0.5, tool = !spear && P.manip > 0.8, beads = P.social > 0.65, paint = P.social > 0.8, arms4 = extraLimbs(g);
    const sn = 1 - g.round, beak = Qa.kind === 'bird' || (cover === 'feathers' && (g.mouth === 2 || g.round < 0.3));
    const ears = Qa.ears && !beak, earL = hr0 * (0.45 + 0.8 * g.ant), earPt = g.ant > 0.45;
    const tail = Qa.TL > 0.6, horn = g.horn, breathe = 1 + Math.sin(t * 1.6) * 0.012;
    const b = BB(); bbAdd(b, -SW - 0.22, hy - hr0 * (horn ? 1.9 + 0.6 * g.spike : 1.45), 0); bbAdd(b, SW + (spear ? 0.3 : 0.22), 0.96, 0);
    if (spear) bbAdd(b, SW + 0.14, -1.12, 0.06);
    if (ears) { const ex = hr0 * 0.95 + earL * (earPt ? 0.7 : 0.45) + 0.04; bbAdd(b, -ex, hy - hr0 * 0.5 - earL * 0.55 - 0.04, 0); bbAdd(b, ex, hy, 0); }
    if (tail) bbAdd(b, -SW - 0.45, 0.6, 0);
    if (horn === 2) bbAdd(b, 0, hy, hr0 * 1.6);
    fit(ctx, b[0], b[1], b[2], b[3], 0.94);
    shadow(ctx, 0, 0.93, 0.5, 0.06);
    const skinLimb = (pts, w0, w1, far) => { const n = pts.length, ws = pts.map((_, i) => lerp(w0, w1, i / (n - 1))); const p = spath(tube({ pts, wt: ws, wb: ws }, 0.6, 0.6)); skin(ctx, p, far ? P.far : P.fill, P.line, pts[0][1], pts[n - 1][1]); return p; };
    if (tail) {
      const sw = Math.sin(t * 1.8) * 0.06, tp = [[-0.05, 0.18], [-SW - 0.1, 0.35], [-SW - 0.32, 0.5 + sw], [-SW - 0.42, 0.32 + sw]];
      const w = 0.07 + 0.05 * (cover === 'scales' || cover === 'shell' ? 1 : 0), ws = [w, w * 0.8, w * 0.55, 0.012];
      skin(ctx, spath(tube({ pts: tp, wt: ws, wb: ws }, 0.4, 0.6)), P.far, P.line, 0.1, 0.6);
    }
    if (horn === 2) { // 머리 뒤 볏·목도리·갈기
      if (cover === 'scales' || cover === 'plates' || cover === 'skin' || cover === 'shell') {
        const pts = []; for (let k = 0; k < 12; k++) { const a = PI + (k / 11) * PI, r = hr0 * (1.55 + (k % 2 ? 0.18 : 0)); pts.push([Math.cos(a) * r, hy + 0.05 + Math.sin(a) * r]); }
        pts.push([hr0 * 0.8, hy + hr0 * 0.6], [-hr0 * 0.8, hy + hr0 * 0.6]);
        skin(ctx, spath(pts), P.acc, P.accLine, hy - hr0 * 1.6, hy + hr0);
      } else {
        const pts = []; for (let k = 0; k < 18; k++) { const a = (k / 18) * TAU, r = hr0 * (1.38 + (k % 2 ? 0.2 : 0)); pts.push([Math.cos(a) * r, hy + 0.06 + Math.sin(a) * r * 1.05]); }
        skinR(ctx, spath(pts), css(P.a, -0.12, -0.15), P.line, 0, hy, hr0 * 1.5);
      }
    }
    // 다리
    const foot = (x, y, sd) => {
      if (cover === 'scales' || cover === 'feathers' || cover === 'plates' || cover === 'shell') { const q = new Path2D(); for (let k = -1; k <= 1; k++) { q.moveTo(x, y - 0.02); q.lineTo(x + k * 0.06 + sd * 0.01, y + 0.03); } ctx.lineWidth = 0.035 + 2 * R.lw; ctx.strokeStyle = P.line; ctx.stroke(q); ctx.lineWidth = 0.035; ctx.strokeStyle = cover === 'feathers' ? 'hsla(44,55%,58%,1)' : P.dark; ctx.stroke(q); }
      else skin(ctx, ell(x + sd * 0.02, y, 0.085, 0.04), P.dark, P.line, y - 0.04, y + 0.04);
    };
    for (const sd of [-1, 1]) {
      const x0 = sd * HW * 0.5, pts = [[x0, 0.16], [x0 + sd * 0.04, 0.52], [x0 + sd * 0.03, 0.88]];
      skinLimb(pts, 0.1 + 0.03 * g.wid, 0.055, false);
      foot(pts[2][0], 0.9, sd);
    }
    // 등딱지 (거북 계통): 몸통 뒤로 비치는 둥근 껍데기 테두리
    if (cover === 'shell') { const sh = ell(0, -0.04 * breathe, SW * 1.28, 0.33); skin(ctx, sh, css(P.a, -0.05, -0.15), P.accLine, -0.37, 0.29); }
    // 몸통
    let tp = [[-SW, -0.25], [-SW * 0.95, -0.05], [-WW, 0.1], [-HW, 0.22], [0, 0.27], [HW, 0.22], [WW, 0.1], [SW * 0.95, -0.05], [SW, -0.25], [SW * 0.6, -0.31], [0, -0.33], [-SW * 0.6, -0.31]].map(([x, y]) => [x, y * breathe]);
    if ((cover === 'fur' || cover === 'feathers') && R.lod) tp = fuzz(dens(tp, 3), cover === 'fur' ? 0.016 : 0.022, P.salt);
    const torso = spath(tp);
    skin(ctx, torso, P.fill, P.line, -0.33, 0.27, (c) => {
      const chest = ell(0, 0.0, SW * 0.55, 0.24);
      c.fillStyle = css([P.c[0], P.c[1] * 0.45, Math.min(0.88, P.c[2] + 0.22)], 0, 0, 0.75); c.fill(chest);
      if (cover === 'shell') { // 배딱지: 연한 판을 가로·세로 줄로 나눔
        c.fillStyle = 'hsla(46,38%,72%,.92)'; c.fill(chest);
        c.strokeStyle = 'hsla(40,30%,30%,.75)'; c.lineWidth = R.lw * 0.8; c.beginPath(); c.moveTo(0, -0.24); c.lineTo(0, 0.24);
        for (let k = 1; k < 4; k++) { const y = -0.24 + k * 0.12, hw = SW * 0.55 * Math.sqrt(Math.max(0, 1 - (y / 0.24) ** 2)); c.moveTo(-hw, y); c.lineTo(hw, y); }
        c.stroke();
      } else if (cover === 'scales' || cover === 'plates') { c.strokeStyle = P.line; c.lineWidth = R.lw * 0.6; c.beginPath(); for (let k = 0; k < 5; k++) { const y = -0.15 + k * 0.07; c.moveTo(-SW * 0.45, y); c.quadraticCurveTo(0, y + 0.025, SW * 0.45, y); } c.stroke(); }
      boxPat(c, -SW, -0.33, SW, 0.27, P, 0.6);
      if (paint) { c.fillStyle = css(P.a, 0, 0.1, 0.85); for (const sd of [-1, 1]) c.fill(lpath([[sd * SW * 0.75, -0.18], [sd * SW * 0.35, -0.08], [sd * SW * 0.75, -0.02]], true)); }
    });
    // 팔 (+ 창)
    const arm = (sd, y0, lower) => {
      const sx = sd * SW * 0.92, holds = sd > 0 && (spear || tool) && !lower;
      const el = [sd * (SW + 0.1), y0 + 0.22], hd = holds ? [sd * (SW + 0.12), y0 + 0.28] : [sd * (SW + 0.08), y0 + 0.45 + Math.sin(t * 1.6 + sd) * 0.01];
      if (holds && spear) {
        const x = hd[0] + 0.02, sp = lpath([[x, -0.95], [x, 0.9]]);
        ctx.lineWidth = 0.04 + 2 * R.lw; ctx.strokeStyle = P.line; ctx.stroke(sp);
        ctx.lineWidth = 0.04; ctx.strokeStyle = 'hsla(30,40%,38%,1)'; ctx.stroke(sp);
        const tipP = spath([[x - 0.055, -0.9], [x, -1.1], [x + 0.055, -0.9], [x, -0.84]]);
        skin(ctx, tipP, 'hsla(210,8%,62%,1)', 'hsla(210,10%,20%,.95)', -1.1, -0.84);
        strokeP(ctx, lpath([[x - 0.035, -0.82], [x + 0.035, -0.8], [x - 0.035, -0.77], [x + 0.035, -0.75]]), P.acc, Math.max(PX(1.2), 0.018));
        if (R.lod) drawLeaf(ctx, P, x, -0.78, 1.9, 0.18, 0.04, 2, P.acc);
      }
      skinLimb([[sx, y0], el, hd], lower ? 0.07 : 0.085, 0.05, false);
      const hand = circ(hd[0], hd[1] + 0.02, 0.05);
      skinR(ctx, hand, P.fill, P.line, hd[0], hd[1], 0.05);
      if (R.lod) { const nf = P.manip > 0.75 ? 4 : 3, q = new Path2D(); for (let k = 0; k < nf; k++) { const a = PI / 2 + (k - (nf - 1) / 2) * 0.35 * sd; q.moveTo(hd[0] + Math.cos(a) * 0.03, hd[1] + 0.02 + Math.sin(a) * 0.03); q.lineTo(hd[0] + Math.cos(a) * 0.075, hd[1] + 0.02 + Math.sin(a) * 0.075); } ctx.lineWidth = 0.022 + 2 * R.lw; ctx.strokeStyle = P.line; ctx.stroke(q); ctx.lineWidth = 0.022; ctx.strokeStyle = P.fill; ctx.stroke(q); }
      if (holds && tool) { const ax = spath([[hd[0] + 0.02, hd[1] - 0.02], [hd[0] + 0.14, hd[1] - 0.12], [hd[0] + 0.2, hd[1] + 0.02], [hd[0] + 0.1, hd[1] + 0.08]]); skin(ctx, ax, 'hsla(210,8%,58%,1)', 'hsla(210,10%,20%,.95)', hd[1] - 0.12, hd[1] + 0.08); }
    };
    for (const sd of [-1, 1]) arm(sd, -0.24, false);
    if (arms4) for (const sd of [-1, 1]) arm(sd, -0.04, true);
    if (beads) { for (let k = 0; k < 9; k++) { const a = PI * (0.15 + (0.7 * k) / 8), x = Math.cos(a) * SW * 0.62, y = -0.3 + Math.sin(a) * 0.13; skinR(ctx, circ(x, y, 0.024), k % 2 ? P.acc : '#eee3c8', P.line, x, y, 0.024); } }
    // 목·머리
    skinLimb([[0, -0.3], [0, hy + hr0 * 0.6]], 0.09, 0.085, false);
    if (ears) {
      const L = earL, pointed = earPt;
      for (const sd of [-1, 1]) {
        const b0 = [sd * hr0 * 0.75, hy - hr0 * 0.45], b1 = [sd * hr0 * 0.92, hy + hr0 * 0.05], tp2 = [sd * (hr0 * 0.95 + L * 0.7), hy - hr0 * 0.5 - L * 0.55];
        const ear = pointed ? spath([b0, [lerp(b0[0], tp2[0], 0.5), lerp(b0[1], tp2[1], 0.5) - 0.02], tp2, [lerp(b1[0], tp2[0], 0.5) + sd * 0.02, lerp(b1[1], tp2[1], 0.5)], b1]) : ell(sd * (hr0 * 0.95), hy - hr0 * 0.3, L * 0.45 + 0.03, L * 0.5 + 0.03);
        skin(ctx, ear, P.fill, P.line, hy - hr0 - L, hy);
        if (R.lod) { ctx.save(); ctx.clip(ear); ctx.fillStyle = 'hsla(350,40%,70%,.55)'; ctx.fill(ell((b0[0] + tp2[0] + b1[0]) / 3, (b0[1] + tp2[1] + b1[1]) / 3, 0.03, 0.05, sd * 0.6)); ctx.restore(); }
      }
    }
    let head = [];
    for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU, r = hr0 * (1 + 0.06 * Math.sin(a * 2)); head.push([Math.cos(a) * r, hy + Math.sin(a) * r * (Math.sin(a) > 0 ? 0.95 + 0.25 * sn * 0.4 : 1)]); }
    if ((cover === 'fur' || cover === 'feathers') && R.lod) head = fuzz(dens(head, 2), 0.014, P.salt + 3);
    const hp = spath(head);
    skin(ctx, hp, P.fill, P.line, hy - hr0, hy + hr0, (c) => {
      if (g.pat === 2) { c.fillStyle = P.patCol; for (const sd of [-1, 1]) c.fillRect(sd * hr0 * 0.15 - hr0 * 0.06, hy - hr0 * 1.1, hr0 * 0.12, hr0 * 0.6); }
      if (g.pat === 1 || g.pat === 4) for (let k = 0; k < 4; k++) dot(c, (hr(k, P.salt) - 0.5) * hr0 * 1.4, hy - hr0 * 0.75 + hr(k, P.salt + 1) * hr0 * 0.3, hr0 * 0.09, P.patCol);
      if (paint) { c.fillStyle = css(P.a, 0, 0.1, 0.85); for (const sd of [-1, 1]) for (let k = 0; k < 2; k++) c.fillRect(sd * hr0 * 0.62 - hr0 * 0.12, hy + hr0 * (0.12 + k * 0.16), hr0 * 0.24, hr0 * 0.07); }
    });
    // 얼굴
    const my = hy + hr0 * 0.48;
    if (beak) {
      const bk = spath([[-hr0 * 0.28, my - hr0 * 0.25], [0, my - hr0 * 0.38], [hr0 * 0.28, my - hr0 * 0.25], [0, my + hr0 * (0.35 + 0.3 * sn)]]);
      skin(ctx, bk, 'hsla(44,65%,58%,1)', P.line, my - hr0 * 0.4, my + hr0 * 0.6);
      strokeP(ctx, lpath([[-hr0 * 0.24, my - hr0 * 0.1], [0, my], [hr0 * 0.24, my - hr0 * 0.1]]), P.line, R.lw);
    } else {
      const mz = ell(0, my, hr0 * 0.44, hr0 * (0.3 + 0.18 * sn));
      ctx.fillStyle = css([P.c[0], P.c[1] * 0.6, Math.min(0.85, P.c[2] + 0.1)]); ctx.fill(mz);
      bellyShade(ctx, mz, { belly: css([P.c[0], P.c[1] * 0.4, Math.min(0.9, P.c[2] + 0.25)]) }, my - hr0 * 0.3, my + hr0 * 0.3, 0.6);
      if (R.lod) for (const sd of [-1, 1]) strokeP(ctx, spath([[sd * hr0 * 0.06, my - hr0 * 0.12], [sd * hr0 * 0.12, my - hr0 * 0.08]], true), 'rgba(0,0,0,.45)', Math.max(PX(1), hr0 * 0.035));
      strokeP(ctx, spath([[-hr0 * 0.18, my + hr0 * 0.12], [0, my + hr0 * 0.17], [hr0 * 0.18, my + hr0 * 0.12]], true), P.line, R.lw);
    }
    const er = hr0 * (0.17 + 0.09 * g.eyeS), ex = hr0 * 0.42, ey = hy - hr0 * 0.1, n = eyeCount(g);
    for (const sd of [-1, 1]) {
      eye(ctx, sd * ex, ey, er, P, 'round');
      if (R.lod) strokeP(ctx, spath([[sd * (ex - er * 1.1), ey - er * 1.25], [sd * ex, ey - er * 1.55], [sd * (ex + er * 1.1), ey - er * 1.3]], true), P.line, R.lw * 1.1);
      if (n === 4) eye(ctx, sd * (ex + er * 0.9), ey + er * 1.9, er * 0.6, P, 'round');
    }
    if (n === 3) eye(ctx, 0, ey - er * 2.1, er * 0.7, P, 'round');
    // 뿔·볏
    if (horn === 1) for (const sd of [-1, 1]) {
      const hs = 0.6 + 0.9 * g.spike, pts = [[sd * hr0 * 0.45, hy - hr0 * 0.82], [sd * hr0 * (0.7 + 0.3 * hs), hy - hr0 * (1.3 + 0.3 * hs)], [sd * hr0 * (0.55 + 0.5 * hs), hy - hr0 * (1.5 + 0.6 * hs)]];
      const w = [hr0 * 0.14, hr0 * 0.09, hr0 * 0.015];
      skin(ctx, spath(tube({ pts, wt: w, wb: w }, 0.3, 0.5)), '#ebe0c4', P.line, hy - hr0 * 2, hy);
    }
    if (horn === 3) for (let k = 0; k < 5; k++) { const x = (k - 2) * hr0 * 0.2, h = hr0 * (0.35 + 0.35 * g.spike) * (1 - Math.abs(k - 2) * 0.2); const sp = lpath([[x - hr0 * 0.08, hy - hr0 * 0.9], [x, hy - hr0 * 0.95 - h], [x + hr0 * 0.08, hy - hr0 * 0.9]], true); skin(ctx, sp, P.acc, P.accLine, hy - hr0 * 1.6, hy - hr0 * 0.8); }
    if (horn === 2 && (cover === 'feathers' || cover === 'fur')) for (let k = 0; k < 3; k++) drawLeaf(ctx, P, (k - 1) * hr0 * 0.15, hy - hr0 * 0.85, -PI / 2 + (k - 1) * 0.35, hr0 * (0.7 + 0.4 * g.spike), hr0 * 0.13, 2, P.acc);
  }

  /* ================= 공개 함수 ================= */
  const DRAW = {
    chemo: drawProk, photo: drawProk, cyano: drawCyano, bact: drawBact, alga: drawAlga, protozoa: drawProtozoa, protopred: drawProtoPred,
    seaweed: drawSeaweed, moss: drawMoss, sponge: drawSponge, jelly: drawJelly, kelp: drawKelp, plant: drawPlant,
    invert: drawInvert, bug: drawBug, seahunter: drawSeaHunter, arachnid: drawArachnid, fish: drawFish, shark: drawShark,
    grazer: drawTetra, hunter: drawTetra, sapient: drawSapient,
  };
  // 빠진 유전자는 기본값으로 (예전 저장본·부분 유전체도 그릴 수 있게)
  function full(g) {
    g = g || {};
    let ok = true;
    for (const k of CONT) if (typeof g[k] !== 'number' || !isFinite(g[k])) { ok = false; break; }
    if (ok) for (const [k] of INTS) if (typeof g[k] !== 'number' || !isFinite(g[k])) { ok = false; break; }
    if (ok) return g;
    const c = {};
    for (const k of CONT) c[k] = clamp(num(g[k], 0.5), 0, 1);
    for (const [k, a, b] of INTS) c[k] = clamp(Math.round(num(g[k], (a + b) >> 1)), a, b);
    return c;
  }
  // ctx 위 (x,y)를 중심으로 size×size 상자에 맞춰 그린다. opts: { t: 초(살랑임), facing: ±1, outline: true }
  function draw(ctx, g, traits, x, y, size, opts) {
    if (!ctx || !(size > 0)) return;
    opts = opts || {};
    traits = traits || {};
    g = full(g);
    const pk = plan(traits), P = prep(g, traits, pk);
    R.px = size / 2; R.lwPx = clamp(size * 0.012, 0.75, 2.2); R.lw = R.lwPx / R.px; R.lod = size < 40 ? 0 : size < 90 ? 1 : 2; R.t = num(opts.t, 0); R.outline = opts.outline !== false;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale((opts.facing === -1 ? -1 : 1) * R.px, R.px);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    try { DRAW[pk](ctx, P); } finally { ctx.restore(); }
  }
  // 초상화: 화면 배율(DPR)에 맞춘 오프스크린 캔버스. (key, size)로 캐시 — 지도에 많이 찍을 때 쓴다
  const CACHE = new Map(), URLS = new Map(), CACHE_MAX = 600;
  const tkey = (tr) => plan(tr) + '/' + Math.round(num(tr.intel, 0) * 10) + Math.round(num(tr.manip, 0) * 10) + Math.round(num(tr.social, 0) * 10) + '/' + Math.round(num(tr.size, 0.4) * 10);
  // 갈래(형태)는 손재주에 따라 연속적으로 기울므로 키에 갈래 번호도 넣는다 (반올림 칸이 같아도 다른 그림이 섞이지 않게)
  const fkey = (g, tr) => { const pk = plan(tr); return PLANS[pk].forms.length > 1 ? 'f' + formFor(g, pk, tr) : ''; };
  // 캐시 키에는 항상 유전체 서명을 넣는다: 다른 세계의 같은 종 번호가 엉뚱한 그림을 꺼내지 않도록 (유전체 객체별로 기억)
  const GK = typeof WeakMap === 'function' ? new WeakMap() : null;
  const gkey = (g) => {
    let k = GK && GK.get(g);
    if (!k) { k = CONT.map((n) => Math.round(g[n] * 1000)).join(',') + ';' + INTS.map(([n]) => g[n]).join(','); if (GK) GK.set(g, k); }
    return k;
  };
  // 몸빛이 어두우면(상대 휘도 < 0.16: 숲 타일 #3f5a35 · 바다 타일과 대비 1.5:1 아래로 떨어지는 범위) 밝은 테두리 색
  const lin8 = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  function rimColor(g, traits) {
    const c = color(g, traits), Y = 0.2126 * lin8(c[0]) + 0.7152 * lin8(c[1]) + 0.0722 * lin8(c[2]);
    return Y < 0.16 ? 'rgba(228,234,214,0.62)' : null;
  }
  function portrait(g, traits, size, key) {
    size = Math.max(8, Math.round(num(size, 64)));
    traits = traits || {};
    g = full(g);
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? clamp(window.devicePixelRatio, 1, 3) : 1;
    const ck = (key == null ? '' : String(key)) + '#' + gkey(g) + '|' + size + '|' + tkey(traits) + fkey(g, traits) + '|' + dpr;
    let c = CACHE.get(ck);
    if (c) { CACHE.delete(ck); CACHE.set(ck, c); return c; }
    c = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(1, 1);
    c.width = c.height = Math.round(size * dpr);
    if (c.style) { c.style.width = size + 'px'; c.style.height = size + 'px'; }
    const x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rim = size <= 56 && rimColor(g, traits);
    if (rim) {
      // 지도 크기의 어두운 몸: 숲·바다 타일 위에서 묻히지 않도록 1px 밝은 테두리를 두른다
      const W = c.width, mk = () => { const k = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(W, W); k.width = k.height = W; return k; };
      const sp = mk(), sx = sp.getContext('2d');
      sx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(sx, g, traits, size / 2, size / 2, size, { t: 0 });
      const sil = mk(), lx = sil.getContext('2d');
      lx.drawImage(sp, 0, 0);
      lx.globalCompositeOperation = 'source-in'; lx.fillStyle = rim; lx.fillRect(0, 0, W, W); // 실루엣을 테두리 색으로
      const o = Math.max(1, Math.round(dpr));
      x.setTransform(1, 0, 0, 1, 0, 0);
      for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o]]) x.drawImage(sil, dx, dy);
      x.drawImage(sp, 0, 0);
    } else draw(x, g, traits, size / 2, size / 2, size, { t: 0 });
    CACHE.set(ck, c);
    if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
    return c;
  }
  // 같은 그림을 data URL로 (innerHTML 카드의 <img src>용). 캐시됨
  function portraitURL(g, traits, size, key) {
    const ck = (key == null ? '' : String(key)) + '#' + gkey(full(g)) + '|' + size + '|' + tkey(traits || {}) + fkey(full(g), traits || {});
    let u = URLS.get(ck);
    if (u) return u;
    try { u = portrait(g, traits, size, key).toDataURL('image/png'); } catch (e) { u = ''; }
    URLS.set(ck, u);
    if (URLS.size > CACHE_MAX) URLS.delete(URLS.keys().next().value);
    return u;
  }

  /* ================= 말로 설명하기 ================= */
  // 색 이름: 색상만이 아니라 밝기·채도도 본다 (어두운 주황 = 갈색, 어두운 노랑 = 올리브빛, 아주 어두우면 '짙은')
  function colorWord(c) {
    const h = fr(c[0] / 360) * 360, s = c[1], l = c[2];
    if (s < 0.13) return l < 0.28 ? '검은' : l > 0.72 ? '흰' : '회색';
    if (l < 0.17) return '검은';
    if (h >= 12 && h < 46 && (l < 0.44 || s < 0.5)) return '갈색';
    if (h >= 46 && h < 82 && l < 0.46) return '올리브빛';
    const dk = l < 0.3 ? '짙은 ' : '';
    if (h < 12 || h >= 346) return dk + '붉은';
    if (h < 40) return dk + '주황빛';
    if (h < 64) return dk + '노란';
    if (h < 90) return dk + '연둣빛';
    if (h < 150) return dk + '초록빛';
    if (h < 192) return dk + '청록빛';
    if (h < 240) return dk + '푸른';
    if (h < 270) return dk + '남빛';
    if (h < 308) return dk + '보랏빛';
    return dk + '분홍빛';
  }
  const PAT = ['', '점무늬', '줄무늬', '띠무늬', '고리 무늬'];
  const COVER = { skin: '매끈한 피부', scales: '비늘', plates: '골판 갑옷', fur: '털', feathers: '깃털', shell: '등딱지' };
  // 한국어 특징 목록: '다리 6개 · 겹눈 2개 · 단단한 껍데기 · 줄무늬'
  function describe(g, traits) {
    g = full(g); traits = traits || {};
    const pk = plan(traits), P = prep(g, traits, pk), f = P.form, F = [], forms = PLANS[pk].forms;
    let body = '몸';
    if (forms.length > 1) F.push(forms[f]);
    const ec = eyeCount(g), eyesV = ec === 3 ? '세 번째 눈' : ec === 4 ? '눈 4개' : '';
    switch (pk) {
      case 'chemo': case 'photo':
        if (f > 0 && g.flag > 0.3) F.push(g.flag > 0.72 ? '온몸에 편모' : '꼬리 같은 편모');
        F.push(pk === 'chemo' ? '황 알갱이를 품음' : '빛을 모으는 막');
        break;
      case 'cyano': F.push(['질소를 붙잡는 세포', '산소 거품', '끈적한 젤리 껍질'][f]); break;
      case 'bact': F.push(f === 0 ? '먹이 세포를 뚫고 들어감' : '여럿이 먹이를 에워쌈'); break;
      case 'alga': F.push(['편모 2개 · 붉은 안점', !bit0(g) ? '둥근 유리 껍데기' : '배 모양 유리 껍데기', '딸 군체를 품음'][f]); break;
      case 'protozoa': F.push(['위족으로 기어감', '섬모로 헤엄침', '섬모 고리로 물을 빨아들임'][f]); break;
      case 'protopred': F.push(['가시 같은 위족 수십 개', '먹이를 찌르는 주둥이', '갑옷판 · 뿔 3개'][f]); break;
      case 'seaweed': F.push(['잎 ' + (3 + (g.seg % 3)) + '장', '두 갈래씩 갈라지는 가지', '기는 줄기'][f]); body = '엽상체'; break;
      case 'moss': F.push(f === 0 ? '포자 주머니 ' + (2 + Math.floor(g.bloom * 6)) + '개' : f === 1 ? '우산 모양 생식 기관' : '바위에 붙어 삶'); body = f === 2 ? '몸' : '잎'; break;
      case 'sponge': F.push(['물을 걸러 먹는 구멍', '가지 끝마다 폴립', '관 여러 개', '촉수 왕관'][f]); break;
      case 'jelly': F.push(f === 0 ? '촉수 ' + (8 + g.seg) + '개' : f === 1 ? '무지갯빛 빗판 8줄' : '공기 주머니 돛'); body = '갓'; break;
      case 'kelp': F.push(['줄기 ' + (2 + (g.seg % 2)) + '개', '띠 잎 ' + (6 + (g.seg % 4)) + '장', '잎 ' + (10 + (g.seg % 5)) + '장'][f]); body = '잎'; break;
      case 'plant': {
        if (f === 0) F.push('잎 ' + (5 + (g.seg % 4)) + '장');
        else if (f === 1) F.push(g.bloom > 0.4 ? colorWord([g.flower * 360, 0.8, 0.6]) + ' 꽃' : '둥근 수관');
        else if (f === 2) F.push(g.leaf % 2 === 0 ? (g.bloom > 0.5 ? '바늘잎 · 솔방울' : '바늘잎') : (g.bloom > 0.5 ? '깃털 잎 · 열매' : '깃털 잎'));
        else F.push('꽃잎 ' + (4 + (g.seg % 5)) + '장의 ' + colorWord([g.flower * 360, 0.8, 0.6]) + ' 꽃');
        body = '잎';
        break;
      }
      case 'invert':
        if (f === 0) F.push('마디 ' + (6 + g.seg) + '개', '겹눈 2개', g.spike > 0.5 ? '긴 볼가시' : '단단한 껍데기');
        else if (f === 1) F.push('다리 10개', g.spike > 0.4 ? '큰 집게' : '작은 집게', '긴 더듬이');
        else if (f === 2) { F.push(bit0(g) ? '뾰족한 탑 껍데기' : '나선 껍데기', '눈자루 2개'); if (g.spike > 0.65) F.push('가시 돋은 껍데기'); body = '껍데기'; }
        else F.push('마디 ' + (14 + 2 * g.seg) + '개', '털 다발 다리');
        break;
      case 'bug':
        if (f === 0) { F.push('다리 6개', '겹눈 2개', '단단한 겉날개'); if (g.mouth === 1 && g.spike > 0.5) F.push('큰 턱'); else if (g.horn === 1) F.push('코뿔'); }
        else if (f === 1) F.push('다리 ' + 4 * (10 + g.seg) + '개', '둥근 마디 ' + (10 + g.seg) + '개');
        else if (f === 2) { F.push('다리 6개', '날개 4장'); if (g.mouth === 4) F.push('빨대 주둥이'); }
        else F.push('다리 14개', '둥글게 말리는 등판');
        break;
      case 'seahunter': F.push(...[['팔 8개', '긴 촉완 2개', '큰 눈'], ['다리 12개', '노 같은 헤엄다리', '꼬리 가시'], ['가시 달린 앞다리 2개', '옆 지느러미 11쌍', '겹눈 2개']][f]); break;
      case 'arachnid': F.push(...[['다리 8개', '큰 집게', '독침 꼬리'], ['다리 8개', '눈 ' + (g.eyeN % 2 ? 6 : 8) + '개', '독 엄니'], ['다리 ' + 2 * (10 + g.seg) + '개', '독 엄니', '긴 더듬이']][f]); break;
      case 'fish': case 'shark': {
        if (pk === 'shark') F.push(...[['날카로운 이빨', '아가미 구멍 5개'], ['뼈 갑옷 머리', '칼날 같은 턱'], ['긴 목', '노 모양 다리 4개', '바늘 이빨']][f]);
        else {
          F.push(f === 2 ? '긴 등지느러미' : ['둥근 꼬리지느러미', '갈라진 꼬리지느러미', '초승달 꼬리지느러미'][caudalType(g)]);
          const m = ['빨아들이는 둥근 입', '', '앵무새 같은 부리', '수염', '긴 창 주둥이'][g.mouth];
          if (m) F.push(m);
          if (g.spike > 0.6 && f !== 2) F.push('가시 등지느러미');
        }
        // (드문 눈 특징은 아래에서 앞쪽에 넣는다)
        break;
      }
      case 'grazer': case 'hunter': {
        const Q = geoTetra(g, P), k = Q.kind;
        F.push(Q.post === 'biped' ? (k === 'bird' ? '두 다리 · 날개' : '두 다리로 걷기') : Q.extra ? '다리 6개' : '네 다리');
        F.push(COVER[Q.cover]);
        const h = g.horn;
        if (h === 1) F.push(k === 'cat' ? '긴 송곳니' : k === 'bird' ? '부리 위 투구' : k === 'mammal' && g.spike > 0.55 && Q.cover === 'fur' ? '가지 뿔' : k === 'longneck' && Q.cover === 'fur' ? '짧은 뼈 뿔' : k === 'reptile' ? '코뿔 · 이마뿔' : k === 'mammal' || k === 'longneck' ? '굽은 뿔 2개' : '이마 뿔');
        else if (h === 2) { const w = k === 'reptile' ? '목 주름 방패' : k === 'amphibian' ? '깃털 같은 겉아가미' : k === 'croc' ? '코끝 혹' : k === 'bird' ? '깃털 볏' : (k === 'cat' || k === 'mammal') && Q.cover === 'fur' ? '갈기' : k === 'longneck' || k === 'theropod' ? '머리 볏' : ''; if (w) F.push(w); }
        else if (h === 3) F.push(k === 'bird' ? '긴 꽁지깃' : k === 'amphibian' || k === 'theropod' || (k === 'reptile' && g.spike < 0.5) ? '등 돛' : k === 'reptile' || k === 'longneck' || k === 'croc' ? '등 골판' : '등 가시털');
        if (k === 'longneck') F.push('아주 긴 목');
        if (P.pk === 'grazer' && k !== 'bird') { const m = ['오리 주둥이', '', '부리', '수염', k === 'mammal' || k === 'longneck' ? (g.spike > 0.55 ? '긴 코 · 엄니' : '긴 코') : ''][g.mouth]; if (m) F.push(m); }
        if (Q.TL > 1.1) F.push('긴 꼬리'); else if (Q.TL < 0.02) F.push('꼬리 없음');
        // (드문 눈 특징은 아래에서 앞쪽에 넣는다)
        break;
      }
      case 'sapient': {
        const cover = coverOf(g, 'sapient', traits);
        F.push('두 발로 섬', extraLimbs(g) ? '팔 4개' : '손가락 ' + (P.manip > 0.75 ? 4 : 3) + '개', COVER[cover]);
        if (P.social > 0.5) F.push('창을 듦'); else if (P.manip > 0.8) F.push('돌도끼를 듦');
        if (P.social > 0.65) F.push('구슬 목걸이');
        // (드문 눈 특징은 아래에서 앞쪽에 넣는다)
        break;
      }
    }
    const pat = PAT[g.pat] && !['chemo', 'photo', 'cyano', 'bact', 'alga', 'protozoa', 'protopred', 'seaweed', 'moss', 'kelp', 'plant', 'jelly'].includes(pk) ? PAT[g.pat] : '';
    let c = P.c;
    if (pk === 'grazer' || pk === 'hunter' || pk === 'sapient') c = furTone(g, c, coverOf(g, pk, traits));
    const list = F.filter(Boolean);
    // 드문 특징(셋째 눈·네 눈)은 그림에서 눈에 띄므로 목록이 잘려도 빠지지 않게 앞쪽(갈래·다리 다음)에 둔다
    const vert = pk === 'fish' || (pk === 'shark' && f !== 2) || pk === 'grazer' || pk === 'hunter' || pk === 'sapient';
    if (vert && eyesV) list.splice(Math.min(2, list.length), 0, eyesV);
    const out = list.slice(0, pat ? 4 : 5);
    out.push(colorWord(c) + ' ' + body);
    if (pat) out.push(pat);
    return out.join(' · ');
  }

  // 지금 그려질 갈래 번호 (PLANS[plan(traits)].forms 의 색인). 갤러리·도감에서 갈래 이름을 붙일 때
  function subform(g, traits) { traits = traits || {}; return formFor(full(g), plan(traits), traits); }

  WS.Creature = { genome, mutate, plan, draw, portrait, portraitURL, describe, color, subform, PLANS, GENES: CONT.concat(INTS.map((q) => q[0])), version: 2 };
})();
