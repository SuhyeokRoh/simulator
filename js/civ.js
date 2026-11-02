'use strict';
/* 인류 문명 모드: 지구(또는 이어받은 행성) 지도 위의 부족·국가, 인구와 출산, 기술 확산, 전쟁·분열·식민,
   기후와 탄소, 핵무기, 대유행병, 인공지능, 우주 진출, 붕괴와 회복.
   모든 미래 사건은 정해진 날짜 없이 모형 안의 상태(연구, 협력, 기온, 군비 …)에서 생겨납니다. */
(function () {
  const WS = window.WS;
  // 실험실의 시작 조건 (core.js에 WS.cond가 없어도 동작하도록 직접 읽음)
  const cond = (s, k, d) => { const v = s.opts && s.opts.cond ? s.opts.cond[k] : undefined; return typeof v === 'number' && isFinite(v) ? v : d; };
  // 주 난수와 무관한 해시 (나라 색 같은 시각용 값)
  const hash32 = (a, b) => {
    let h = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  // 한국어 조사: 마지막 글자의 받침에 맞춰 붙임 (josa('인도', '이', '가') → '인도가'). 끝의 괄호·기호는 건너뛰고 읽음
  const DIGIT_BATCHIM = [1, 1, 0, 1, 0, 0, 1, 1, 1, 0]; // 영 일 이 삼 사 오 육 칠 팔 구
  function josa(w, a, b) {
    const s = String(w);
    for (let i = s.length - 1; i >= 0; i--) {
      const ch = s.charCodeAt(i);
      if (ch >= 0xac00 && ch <= 0xd7a3) return s + ((ch - 0xac00) % 28 ? a : b);
      if (ch >= 0x30 && ch <= 0x39) return s + (DIGIT_BATCHIM[ch - 0x30] ? a : b);
      if ((ch >= 0x41 && ch <= 0x5a) || (ch >= 0x61 && ch <= 0x7a)) break; // 로마자: 받침을 알 수 없음
    }
    return `${s}(${a})${b}`;
  }

  // [id, 이름, 시대, 비용, 선행 기술, 효과]  K = 땅이 먹여 살리는 사람 배수, dev = 생활 수준(출산율 전환)에 주는 몫
  const TECH = [
    ['agri', '농경', 1, 30, [], { K: 30 }],
    ['herd', '목축', 1, 40, [], { K: 1.25, immune: 1, mil: 0.15 }],
    ['pottery', '토기와 정착 마을', 1, 60, ['agri'], { K: 1.2 }],
    ['bronze', '청동기', 2, 320, ['pottery'], { mil: 0.3 }],
    ['writing', '문자', 2, 480, ['pottery'], { res: 0.6, admin: 0.6 }],
    ['wheel', '바퀴와 전차', 2, 420, ['herd', 'pottery'], { mil: 0.25, trade: 0.2 }],
    ['sail', '돛배', 2, 460, ['pottery'], { sea: 1 }],
    ['math', '수학과 천문학', 3, 1000, ['writing'], { res: 0.3 }],
    ['iron', '철기', 3, 1300, ['bronze'], { mil: 0.4, K: 1.3 }],
    ['law', '화폐와 법전', 3, 1200, ['writing'], { admin: 0.7, trade: 0.3, K: 1.2 }],
    ['philo', '철학', 3, 1700, ['math'], { res: 0.3 }],
    ['eng', '토목 공학', 3, 1900, ['math', 'iron'], { admin: 0.6, K: 1.6 }],
    ['paper', '종이', 4, 5000, ['philo'], { res: 0.3 }],
    ['compass', '나침반과 원양 항해', 4, 11600, ['sail', 'math'], { sea: 2, trade: 0.4, K: 1.45 }],
    ['powder', '화약', 4, 12000, ['iron', 'philo'], { mil: 0.8 }],
    ['print', '인쇄술', 4, 10000, ['paper'], { res: 0.6, K: 1.1 }],
    ['science', '과학 혁명', 5, 12000, ['print', 'math'], { res: 1.5 }],
    ['steam', '증기 기관 (산업 혁명)', 6, 33000, ['science', 'iron'], { K: 1.8, energy: 0.6, mil: 0.6, res: 1.5, dev: 0.15 }],
    ['elec', '전기', 6, 36000, ['steam'], { res: 2, energy: 0.5, K: 1.4, dev: 0.1, clean: 0.2 }],
    ['medicine', '근대 의학', 6, 36000, ['science', 'steam'], { immune: 2, K: 1.2, dev: 0.1 }],
    ['combust', '내연 기관과 비행', 7, 43000, ['elec'], { K: 1.8, energy: 1.4, mil: 0.8, dev: 0.1 }],
    ['fission', '핵분열', 7, 50000, ['elec', 'science'], { nuke: 1, mil: 0.3, clean: 0.35 }],
    ['computer', '컴퓨터', 8, 52000, ['elec'], { res: 3, K: 1.5, dev: 0.15 }],
    ['space', '우주 발사', 8, 40000, ['combust', 'fission'], {}],
    ['internet', '인터넷', 8, 60000, ['computer'], { res: 1.5, coop: 1, dev: 0.15 }],
    ['renew', '재생 에너지', 8, 75000, ['elec', 'computer'], { clean: 0.88 }],
    ['ai', '인공지능', 9, 95000, ['internet'], { res: 2.5, K: 1.1, dev: 0.05 }],
    ['gene', '유전공학', 9, 120000, ['medicine', 'computer'], { K: 1.4, dev: 0.05 }],
    ['fusion', '핵융합', 9, 1100000, ['fission', 'ai'], { clean: 0.98, K: 1.3, dev: 0.05 }],
    ['mars', '다른 행성 정착', 11, 15000000, ['space', 'fusion'], {}],
    // 초지능은 따로 진행되는 '인공지능 연구 경쟁'에서 나옴 (아래 aiRace)
    ['agi', '초지능', 10, 330000, ['ai'], {}],
    ['star', '항성 간 항해', 12, 70000000, ['mars', 'agi'], {}],
  ];
  const NT = TECH.length;
  const TI = {};
  TECH.forEach((t, i) => { TI[t[0]] = i; });
  const PRE = TECH.map((t) => t[4].map((q) => TI[q]));
  const ERA = ['수렵채집 시대', '신석기 혁명', '청동기 시대', '철기 시대', '중세', '근세', '산업 시대', '원자력 시대', '정보화 시대', '인공지능 시대', '초지능 시대', '다행성 시대', '항성 간 문명'];
  const ERA_MULTI = 11;
  const SELF_SUSTAIN = 1e5; // 지구 밖 인구가 이만큼 되면 스스로 유지되는 정착지 ('다행성 문명' 결말과 같은 기준)
  /* 화면에 보이는 시대 이름의 기준: 그 시대를 여는 기술을 실제로 손에 넣어야 합니다. 이 기술들은 처음 나올 때 모두 연대기에 적히므로 제목이 연대기를 앞서지 않습니다.
     (기술 표의 시대 번호 eraT는 걸음 크기 같은 동역학에 쓰이므로 그대로 둡니다. 그 번호로 이름을 붙이면 종이 하나로 '중세', 내연 기관 하나로 '원자력 시대'가 되어,
     서기 1년과 1900년 출발의 제목이 시작 시점보다 앞서 나갑니다.) */
  const ERA_OPENS = [[], ['agri'], ['bronze', 'writing'], ['iron'], ['powder', 'compass'], ['science'], ['steam'], ['fission'], ['internet'], ['ai'], ['agi'], ['mars'], ['star']].map((l) => l.map((id) => TI[id]));
  const polEraIndex = (s, p) => {
    for (let e = ERA.length - 1; e > 0; e--) {
      if (e === ERA_MULTI && s.offworld < SELF_SUSTAIN) continue; // '다행성 시대'는 기술만 갖췄을 때가 아니라 정말로 지구 밖에 사람들이 자리 잡았을 때의 이름
      const g = ERA_OPENS[e];
      for (let i = 0; i < g.length; i++) if (p.known[g[i]]) return e;
    }
    return 0;
  };
  const worldEraIndex = (s) => {
    let e = Math.min(s.eraNow, 1); // 나라가 없을 때: 농사짓는 부족이 있으면 신석기 혁명
    for (const p of s.alive) { const x = polEraIndex(s, p); if (x > e) e = x; }
    return s.offworld >= SELF_SUSTAIN ? Math.max(e, ERA_MULTI) : e;
  };
  const GOV = { tribe: '부족', chiefdom: '족장국', kingdom: '왕국', empire: '제국', republic: '공화국', democracy: '민주 국가', autocracy: '권위주의 국가' };
  const DIRS = { n: '북', s: '남', e: '동', w: '서' };
  // 부족 칸이 가질 수 있는 기술 (비트)
  const TRIBAL = ['agri', 'herd', 'pottery', 'bronze', 'iron', 'writing'];
  const TRIBE_D = new Float64Array(64);
  for (let b = 0; b < 64; b++) { let d = 0.05; for (let i = 0; i < TRIBAL.length; i++) if (b & (1 << i)) { const K = TECH[TI[TRIBAL[i]]][5].K; if (K) d *= K; } TRIBE_D[b] = d; }
  // 지도용 나라 색 (바다와 헷갈리는 파랑은 뺌). 이웃끼리는 렌더에서 겹치지 않게 다시 고름
  const PALETTE = [[196, 110, 84], [214, 176, 84], [146, 168, 80], [88, 150, 112], [168, 96, 148], [132, 112, 196], [214, 120, 136], [176, 150, 106], [170, 72, 72], [228, 208, 150], [128, 96, 72], [186, 200, 96], [232, 140, 60], [196, 170, 220], [150, 128, 150], [110, 170, 160]];
  const tint = (c, h) => { const k = 0.92 + 0.16 * h; return [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)]; };
  const TFR_MAX = 6.4; // 전통 사회의 합계출산율
  const TFR_EXP = 2.3; // 생활 수준이 오를 때 출산율이 떨어지는 모양
  const MS_TECH = { agri: 'agri', writing: 'writing', iron: 'iron', print: 'print', science: 'science', steam: 'steam', fission: 'fission', space: 'space', internet: 'internet', ai: 'ai', compass: 'compass', fusion: 'fusion', mars: 'mars', agi: 'agi', star: 'star' };
  /* 역사 출발점(기원전 1만 년 ~ 서기 1500년)의 보정. 1900년·2026년 출발점은 자료로 맞춘 세계라 그대로 둡니다.
     - 중세 기술의 순서와 값: 화약 → 나침반 → 인쇄술 → 과학 혁명 (실제 순서), 산업 시대 기술도 조금 더 어렵게
     - 기술이 자리 잡는 시간: 컴퓨터가 퍼진 지 30년은 지나야 인터넷, 인터넷이 퍼진 지 25년은 지나야 인공지능
     - 연구, 인구, 농업 집약화, 신석기 마을의 보정은 research · populate · intensify · tribes 안의 this.hist 부분 */
  const HIST_COST = { powder: 1.05, compass: 1.3, print: 2.0, elec: 1.1, medicine: 1.25, combust: 1.1, fission: 1.05, computer: 1.05 };
  const HIST_MATURE = [['internet', 'computer', 30], ['ai', 'internet', 25]];
  const ANC_POP = 4, ANC_RES = Math.pow(ANC_POP, 0.8); // 철기 이전 연구의 기준 인구(백만 명)와 그때의 연구력
  const INT_A = 4, INT_R = 0.0003, INT_DEC = 300; // 농업 집약화: 최대 배수 = 1 + 4 × 비옥도, 속도, 버려진 땅에서 사라지는 시간

  const OUTCOMES = [
    { key: 'extinct', label: '인류 멸종', color: '#8f2f2f', desc: '사람이 1만 명 아래로 줄어 인류가 사실상 사라졌습니다. 지구 밖에도 문명을 이어 갈 만큼의 사람은 남지 않았습니다.' },
    { key: 'aidoom', label: '초지능 재앙', color: '#c0466a', desc: '사람보다 뛰어난 인공지능이 통제를 벗어나 인류에게 큰 피해를 주었습니다.' },
    { key: 'collapse', label: '문명 붕괴', color: '#e46a4e', desc: '전쟁·기근·대유행병 등으로 인구가 짧은 기간에 절반 아래로 줄었거나 가장 앞선 나라마저 핵심 기술을 잃었고, 관측이 끝날 때까지 회복하지 못했습니다.' },
    { key: 'interstellar', label: '항성 간 문명', color: '#7fa8ff', desc: '인류의 후손이 다른 별을 향해 떠났습니다.' },
    { key: 'multiplanet', label: '다행성 문명', color: '#84c6d2', desc: '지구 밖에 스스로 유지되는 정착지가 생겨 인류가 여러 행성에 삽니다.' },
    { key: 'aiage', label: '초지능과 공존', color: '#9b8cf0', desc: '초지능이 나타났지만 통제를 벗어나지 않았고, 사람들은 초지능과 함께 지냅니다. 다만 기후 위기나 핵전쟁 같은 다른 큰 어려움은 따로 겪었을 수 있습니다.' },
    { key: 'strained', label: '위기 속의 지구 문명', color: '#e3a857', desc: '문명은 이어지지만 기온이 산업화 이전보다 3°C 넘게 올랐거나, 최근 60년 안에 핵전쟁이 있었습니다.' },
    { key: 'industrial', label: '지구의 산업·정보 문명', color: '#96cf88', desc: '지구 위에서 산업·정보 문명이 이어집니다. 지금은 기온 상승이 3°C 이하이고 최근 60년 안에 핵전쟁도 없었지만, 그 전에 대유행병이나 핵전쟁 같은 큰 재난을 겪었을 수 있습니다.' },
    { key: 'agrarian', label: '농업 문명', color: '#c9b37a', desc: '농사를 짓는 사회는 있지만 산업 혁명에 이른 나라는 없습니다. 세계에 따라 마을만 있을 수도, 나라와 제국이 있을 수도 있습니다.' },
    { key: 'forager', label: '수렵채집 사회', color: '#8a8f7a', desc: '사람들이 여전히 사냥과 채집으로 살아갑니다.' },
  ];
  const OUT = {};
  OUTCOMES.forEach((o) => { OUT[o.key] = o; });

  /* 지구 밖 정착지: 어느 천체로 가는지는 세계의 결말에 영향을 주지 않는 표현 모형입니다. 동역학에는 offworld만 쓰이고, 이 기록은 화면·범례·실험실만 읽습니다.
     gate = 지구 밖 인구 문턱, lag = 첫 정착지 뒤로 지나야 하는 햇수 [최소, 최대], w = 인구 몫, fs = 첫 정착지가 될 점수, why = 짧은 이유, first/next = 연대기 문장 */
  const SETTLE = [
    { id: 'moon', gate: 150, lag: [0, 5], w: 0.22, fs: 0.7, why: '가깝고 극지방에 얼음이 있음', first: '달에 첫 정착지가 세워졌습니다. 가깝고 극지방에 얼음이 있는 곳입니다.', next: '달에 정착지가 생겼습니다. 가까운 데다 극지방에 얼음이 있습니다.' },
    { id: 'mars', gate: 150, lag: [0, 15], w: 1, fs: 1, why: '물, 지구와 비슷한 하루 길이, 옅은 대기', first: '화성에 첫 정착지가 세워졌습니다. 물과 옅은 대기가 있는 곳입니다.', next: '화성에 정착지가 생겼습니다. 물과 옅은 대기가 있고 하루 길이도 지구와 비슷합니다.' },
    { id: 'ceres', gate: 3e3, lag: [8, 26], w: 0.32, fs: 0.12, why: '얼음과 광물', first: '소행성대의 세레스에 첫 정착지가 세워졌습니다. 얼음과 광물을 캘 수 있는 곳입니다.', next: '세레스에 정착지가 생겼습니다. 소행성대의 얼음과 광물을 캡니다.' },
    { id: 'venus', gate: 3e4, lag: [14, 40], w: 0.2, fs: 0.08, why: '지구와 비슷한 중력, 고도 50 km의 기압', first: '금성의 구름 위에 첫 도시가 세워졌습니다. 고도 50 km는 기압과 중력이 지구와 비슷합니다.', next: '금성의 구름 위에 떠 있는 도시가 생겼습니다. 고도 50 km는 기압과 중력이 지구와 비슷합니다.' },
    { id: 'mercury', gate: 5e4, lag: [18, 48], w: 0.08, fs: 0, why: '강한 햇빛과 금속', next: '수성에 정착지가 생겼습니다. 강한 햇빛으로 전기를 만들고 금속을 캡니다.' },
    { id: 'ganymede', gate: 2e5, lag: [28, 58], w: 0.25, fs: 0, why: '방사선을 막아 주는 자기장, 두꺼운 얼음', next: '목성의 위성 가니메데에 정착지가 생겼습니다. 자기장이 방사선을 막아 주고 얼음이 두껍습니다.' },
    { id: 'europa', gate: 5e5, lag: [34, 72], w: 0.14, fs: 0, why: '얼음 밑의 바다', next: '목성의 위성 유로파에 정착지가 생겼습니다. 두꺼운 얼음 밑에 바다가 있습니다.' },
    { id: 'titan', gate: 1e6, lag: [42, 88], w: 0.3, fs: 0, why: '두꺼운 대기와 메탄', next: '토성의 위성 타이탄에 정착지가 생겼습니다. 대기가 두껍고 연료가 되는 메탄이 흔합니다.' },
    { id: 'triton', gate: 2e7, lag: [70, 125], w: 0.05, fs: 0, why: '태양계 끝의 전초 기지', next: '해왕성의 위성 트리톤에 정착지가 생겼습니다. 사람이 사는 곳 가운데 태양에서 가장 먼 곳입니다.' },
  ];
  const STAR_TARGETS = [['프록시마 센타우리 b', 4.2, 5], ['바너드별', 6, 3], ['타우 세티 e', 11.9, 2], ['글리제 667C c', 23.6, 1], ['TRAPPIST-1 e', 40.7, 1]];
  // 다른 항성계의 천체: 이름 뒤에 조사를 붙이지 않음 ('WS-1234 b'처럼 로마자로 끝날 수 있음)
  const OTHER_WHY = {
    near: ['가까워서 오가기 쉬움', '가까워서 오가기 쉽습니다.'], moon: ['거대 행성 곁의 얼음과 자원', '거대 행성 곁에서 얼음과 자원을 얻습니다.'],
    ocean: ['물이 있음', '물이 있어 살아가기 좋습니다.'], ice: ['얼음에서 얻는 물과 연료', '얼음에서 물과 연료를 얻습니다.'], rock: ['단단한 땅과 광물', '단단한 땅과 광물이 있습니다.'],
  };
  /* 세계마다 한 번: 갈 곳과 문턱·몫을 전용 생성기로 정해 둡니다 (주 난수는 쓰지 않음). 이후에는 난수를 쓰지 않습니다 */
  function makeSettle(s, inherit) {
    const g = new WS.RNG((s.seed ^ 0x51ed270b) >>> 0 || 11);
    const ln = (sig) => Math.exp(sig * WS.clamp(g.normal(), -2.5, 2.5));
    const inh = inherit || {};
    const system = s.alien && inh.system && inh.system.planets && inh.system.planets.length ? inh.system : null;
    const planet = s.alien ? inh.planet || '' : '지구';
    const earth = !system && planet.includes('지구'); // 다른 종의 문명이라도 태양계라면 표의 사실이 그대로 맞음
    const homeName = earth ? '지구' : system ? system.home : planet || null;
    const sys = WS.systemBodies(system, { moon: s.alien ? inh.moon : true, giant: s.alien ? inh.giant : true, homeName });
    const byId = new Map(sys.bodies.map((b) => [b.id, b]));
    const home = sys.bodies.find((b) => b.home);
    const dest = [];
    if (earth || !system) {
      for (const d of SETTLE) {
        const b = byId.get(d.id);
        if (b) dest.push(earth ? Object.assign({}, d, { bodyId: b.id, name: b.name }) : otherDest(d, b, home));
      }
    } else {
      // 다른 항성계: 고향에서 궤도가 가까운 순서로, 문턱은 같은 순위의 값을 씀 (거대 행성에는 내릴 수 없음)
      const ax = (b) => (b.parent ? byId.get(b.parent).a : b.a);
      const cand = sys.bodies.filter((b) => !b.home && (b.parent || !b.giant)).sort((p, q) => Math.abs(ax(p) - home.a) - Math.abs(ax(q) - home.a));
      cand.slice(0, SETTLE.length).forEach((b, i) => dest.push(otherDest(SETTLE[i], b, home)));
    }
    // 갈 곳이 하나도 없으면 고향 행성의 궤도에 도시를 띄움
    if (!dest.length) dest.push({ id: 'orbit', bodyId: home.id, name: '궤도 도시', gate: 150, lag: [0, 0], w: 1, fs: 1, why: '갈 만한 천체가 없어 궤도에 띄운 거대한 도시', first: '행성 궤도에 첫 도시가 떠올랐습니다. 이 항성계에는 내려설 만한 천체가 없습니다.' });
    const gates = {}, weights = {}, lags = {};
    let firstId = null, best = -1;
    for (const d of dest) {
      gates[d.id] = d.gate * ln(0.8);
      weights[d.id] = d.w * ln(0.5);
      lags[d.id] = g.range(d.lag[0], d.lag[1]);
      const sc = d.fs * ln(0.6);
      if (sc > best) { best = sc; firstId = d.id; }
    }
    const pickStar = (() => {
      if (s.alien && !earth) return { target: '이웃 별 ' + WS.makeName(g), ly: g.range(4, 30) };
      const t = g.weighted(STAR_TARGETS, (q) => q[2]);
      return { target: t[0], ly: t[1] };
    })();
    pickStar.speedC = g.range(0.05, 0.2);
    return { list: [], dest, gates, weights, lags, firstId: null, plannedFirst: firstId, starPick: pickStar, star: null, allLost: false, sys, homeId: home.id, out: earth ? '지구 밖' : '행성 밖' };
  }
  function otherDest(d, b, home) {
    const key = b.parent ? (b.parent === home.id ? 'near' : 'moon') : b.look === 'ocean' ? 'ocean' : b.look === 'ice' ? 'ice' : 'rock';
    const w = OTHER_WHY[key];
    return { id: b.id, bodyId: b.id, name: b.name, gate: d.gate, lag: d.lag, w: d.w, fs: d.fs, why: w[0], first: `${b.name}에 첫 정착지가 세워졌습니다. ${w[1]}`, next: `${b.name}에 정착지가 생겼습니다. ${w[1]}` };
  }

  /* 격자 이웃표 (지도마다 한 번) */
  function prepMap(M) {
    if (M._nb) return;
    const W = M.W, H = M.H, NC = M.NC;
    const nb = new Int32Array(NC * 4).fill(-1), nbn = new Uint8Array(NC);
    const wl = new Float32Array(NC), hw = new Float32Array(NC);
    for (let c = 0; c < NC; c++) {
      const x = c % W, y = (c / W) | 0, o = c * 4;
      let k = 0;
      nb[o + k++] = y * W + ((x + 1) % W);
      nb[o + k++] = y * W + ((x - 1 + W) % W);
      if (y > 0) nb[o + k++] = c - W;
      if (y < H - 1) nb[o + k++] = c + W;
      nbn[c] = k;
      const la = M.lat[c], a = Math.abs(la);
      // 핵겨울은 북반구 중위도에서 가장 심함
      wl[c] = la > 30 ? 1.2 : la > 0 ? 1 : la > -30 ? 0.75 : 0.55;
      // 기온 상승 피해의 위도 가중치 (음수 = 오히려 농사에 이득)
      let w = a < 23 ? 1 : a < 35 ? 0.8 : a < 50 ? 0.35 : a < 60 ? -0.3 : -0.6;
      if (w > 0 && M.rain && M.rain[c] < 0.25) w *= 1.3;
      hw[c] = w;
    }
    M._nb = nb; M._nbn = nbn; M._wl = wl; M._hw = hw;
  }

  let EARTH = null;
  let uiMilestones = null; // 비교 표의 사건 순서 (아래 MILESTONES, 화면에 띄운 세계에 맞춤)
  let uiCompare = null; // 비교 그림의 가로축 (아래 compareFor, 화면에 띄운 세계에 맞춤)

  class Civ extends WS.SimBase {
    constructor(opts, seed, inherit) {
      super(seed, opts);
      const r = this.rng;
      this.C = {
        research: cond(this, 'research', 1), aggression: cond(this, 'aggression', 1), trade: cond(this, 'trade', 1),
        sens: cond(this, 'climateSens', 3), disease: cond(this, 'disease', 1), aiRisk: cond(this, 'aiRisk', 1),
        fert: cond(this, 'fertility', 1), nukes: cond(this, 'nukes', 1), coop: cond(this, 'coop', 0),
      };
      this.inherit = inherit || null;
      this.alien = !!(inherit && inherit.alien);
      if (this.alien) {
        this.map = WS.Earth.fromLife(inherit, r);
        this.epoch = { year: 0, label: '농경의 시작', co2: Math.max(200, (inherit.co2 || 1) * 280), polities: [], tribeTech: () => [] };
        this.speciesName = inherit.species;
        this.planetName = inherit.planet;
      } else {
        if (!EARTH) EARTH = WS.Earth.build();
        this.map = EARTH;
        this.epoch = WS.Earth.EPOCHS[opts.start] || WS.Earth.EPOCHS.bc10000;
      }
      const M = this.map, NC = M.NC;
      prepMap(M);
      this.nb = M._nb; this.nbn = M._nbn;
      this.year = this.epoch.year;
      this.startYear = this.year;
      const until = Number(opts.until);
      this.endYear = isFinite(until) && until > this.year ? until : Math.max(3000, this.year + 1000);
      this.landCells = [];
      this.isLand = new Uint8Array(NC);
      for (let c = 0; c < NC; c++) if (M.land[c] && (this.alien || M.lat[c] > -58)) { this.landCells.push(c); this.isLand[c] = 1; }
      this.lc = Int32Array.from(this.landCells);
      this.owner = new Int32Array(NC).fill(-1);
      this.pop = new Float64Array(NC);
      this.tribe = new Uint8Array(NC);
      this.kmod = new Float32Array(NC).fill(1);
      this.kbase = new Float32Array(NC).fill(1);
      // 칸의 기본 수용력 = 면적 × 비옥도 × 보정 (kbase가 바뀔 때만 다시 계산)
      this.kb0 = new Float64Array(NC);
      for (const c of this.landCells) this.kb0[c] = M.area[c] * (0.03 + M.fert[c]);
      // 역사 출발점인가 (지구, 1850년 이전): 아래의 산업화 이전 규칙과 보정은 이때만 씀
      this.hist = !this.alien && this.epoch.year < 1850;
      this.cm = null; this.matRule = null; this.matList = null;
      if (this.hist) {
        // 농업 집약화: 칸마다 지금의 집약도(kint)와 오를 수 있는 한계(kmax). kbB는 집약화 전의 기본 수용력
        this.kint = new Float32Array(NC).fill(1);
        this.kmax = new Float32Array(NC).fill(1);
        for (const c of this.landCells) this.kmax[c] = 1 + INT_A * Math.max(0, M.fert[c]);
        this.kbB = Float64Array.from(this.kb0);
        this.cm = new Float64Array(NT).fill(1);
        for (const k in HIST_COST) this.cm[TI[k]] = HIST_COST[k];
        this.matRule = new Array(NT).fill(null);
        this.matList = HIST_MATURE.map(([t, pre, n]) => [TI[t], TI[pre], n]);
        for (const [i, j, n] of this.matList) this.matRule[i] = [j, n];
      }
      this.kmodT = new Float32Array(NC);
      this.kmodList = [];
      this.ownVer = 0; this.unowned = 0;
      this.war = new Uint8Array(NC);
      this.dmg = new Float32Array(NC);
      this.pols = []; this.alive = [];
      this.knownShare = new Float64Array(NT);
      // 이 세계에서만 정해지는 '아무도 모르는 값' (늘 같은 순서로 뽑음)
      const z = () => WS.clamp(r.normal(), -2.5, 2.5);
      this.ecs = this.C.sens * Math.exp(0.2 * z());          // 기후 민감도 (CO₂ 두 배일 때 평형 기온 상승)
      this.diff = new Float64Array(NT).fill(1);
      this.diff[TI.agi] = Math.exp(0.9 * z()) * (r.next() < 0.25 ? 12 : 1); // 넷 중 하나는 근본적인 벽에 부딪힘                  // 초지능을 만들기가 얼마나 어려운가
      this.diff[TI.fusion] = Math.exp(0.5 * z());
      this.diff[TI.mars] = Math.exp(0.5 * z());
      this.diff[TI.star] = Math.exp(0.6 * z());
      this.tipT = r.range(2.0, 3.2);                            // 영구동토 탄소가 풀리기 시작하는 기온
      this.zeit = 0.04 * z();                                   // 시대 분위기 (협력에 더해지는 무작위 흐름)
      this.fertZ = 0.08 * z();                                  // 세계적인 출산 문화의 흐름
      // 세계 상태
      this.co2 = this.epoch.co2;
      this.winter = 0; this.coop = 0.1; this.emis = 0; this.longev = 0;
      this.tipRate = 0; this.tipLeft = 0; this.slr = 0; this.tips = {};
      this.agiOutcome = null; this.agiYear = NaN; this.offworld = 0;
      this.firstTech = {};
      this.impacts = []; this.impactN = 0; // 운석 기록 (태양계 뷰가 읽음)
      this.settle = makeSettle(this, inherit);
      this.worldPop = 0; this.earthPop = 0; this.popPeak = 0; this.popPeakYear = this.year; this.crashRef = 0;
      this.lastNuke = -1e9; this.nukeWars = 0; this.pandemics = 0; this.famineY = 0;
      this.catLoss = 0; // 최근 재앙(전쟁·기근·대유행병·초지능)으로 죽은 사람 수 (해마다 2%씩 잊힘)
      this.maxTechEver = 0; this.regressed = false; this.collapsed = false;
      this.lastLoud = { war: -Infinity, nuke: -Infinity };
      this.lossNow = new Array(NT).fill(null); this.lossAt = this.year; // 최근 기술을 잃은 나라들 (기록용)
      this.eraNow = 0;
      this.seedWorld(inherit);
      this.aggregate();
      this.refresh(0);
      this.popPeak = this.worldPop; this.crashRef = this.worldPop;
      this.coop = WS.clamp(this.coopTarget(), 0, 1);
      this.initClimate();
      this.T0 = this.Tanom(); // 시작할 때의 기온 (행성 그림의 얼음 경계 기준, 동역학에는 쓰지 않음)
      this.updateDamage(true);
      this.maxTechEver = this.techNow();
      // 해설용 인구 증가율의 처음 값 (동역학에는 쓰지 않음): 근대 나라들의 증가율을 인구로 평균
      let gs = 0, ps = 0;
      for (const p of this.alive) if (p.modern) { gs += p.g * p.popSum; ps += p.popSum; }
      if (ps > 0.5 * this.earthPop) this.popRate = gs / ps;
      this._lastPop = this.worldPop;
      if (!this.headless) {
        uiMilestones = orderMilestones(new Set(Object.keys(this.reached)));
        uiCompare = this.alien ? COMPARE_ALL : compareFor(this.startYear, this.endYear);
      }
    }
    timeValue() { return this.year; }
    labelAt(y) { return this.alien ? `문명 ${Math.round(y - this.startYear).toLocaleString('ko-KR')}년` : calText(y); }
    timeLabel() { return this.labelAt(this.year); }

    /* ----- 기술 ----- */
    techsOfCell(c) { const o = this.owner[c]; return o >= 0 ? this.pols[o].known : null; }
    has(known, id) { return known[TI[id]] === 1; }
    cacheTech(p) {
      let K = 1, res = 0, mil = 1, admin = 0, energy = 0, clean = 0, nt = 0, era = 0, dev = 0;
      for (let i = 0; i < NT; i++) if (p.known[i]) {
        const e = TECH[i][5];
        nt++;
        if (e.K) K *= e.K;
        if (e.res) res += e.res;
        if (e.mil) mil += e.mil;
        if (e.admin) admin += e.admin;
        if (e.energy) energy += e.energy;
        if (e.clean && e.clean > clean) clean = e.clean;
        if (e.dev) dev += e.dev;
        if (TECH[i][2] > era) era = TECH[i][2];
      }
      p.kprod = 0.05 * K; p.res = res; p.mil = mil; p.adminA = admin; p.energy = energy; p.cleanCap = clean;
      p.nt = nt; p.eraT = era; p.devTech = dev; p.tdirty = false;
    }
    density(c) {
      const o = this.owner[c];
      return o >= 0 ? this.pols[o].kmul : TRIBE_D[this.tribe[c]];
    }
    Kcell(c) {
      const M = this.map, o = this.owner[c];
      let d, adapt = 1;
      if (o >= 0) { const p = this.pols[o]; d = p.kmul; adapt = p.adapt; } else d = TRIBE_D[this.tribe[c]];
      const dm = this.dmg[c];
      let f = 1 - (dm > 0 ? dm * adapt : dm);
      if (this.winter > 0) f *= Math.max(0.03, 1 - 0.16 * this.winter * M._wl[c]);
      return Math.max(1e-4, this.kb0[c] * d * this.kmod[c] * f);
    }
    Tanom() { return this.Tf + this.Ts - this.winter; }
    costOf(p, i) { return TECH[i][3] * this.diff[i] * (this.cm ? this.cm[i] : 1) * (p.lost && p.lost[i] ? 0.35 : 1); }

    /* ----- 세계 만들기 ----- */
    seedWorld(inherit) {
      const M = this.map, r = this.rng, ep = this.epoch;
      for (const c of this.landCells) {
        const list = this.alien ? [] : ep.tribeTech(c, M);
        let b = 0;
        list.forEach((id) => { const i = TRIBAL.indexOf(id); if (i >= 0) b |= 1 << i; });
        this.tribe[c] = b;
      }
      if (this.alien) {
        // 지성 종이 처음 정착한 곳만 사람이 있음
        const st = inherit.start >= 0 && M.land[inherit.start] ? inherit.start : this.landCells[0];
        const q = [st], seen = new Set([st]);
        while (q.length && seen.size < 30) {
          const c = q.shift();
          for (const n of this.nbrs(c)) if (M.land[n] && !seen.has(n)) { seen.add(n); q.push(n); }
        }
        for (const c of seen) { this.tribe[c] = 1; this.pop[c] = this.Kcell(c) * 0.5; }
        // 첫 나라 이름도 다른 나라처럼 짧은 이름 + 체제 (주 난수를 쓰지 않음): 긴 학명은 지도에서 잘리고 '동Cyanognathus'처럼 어색해짐
        const p = this.newPolity({ name: WS.makeName(new WS.RNG((this.seed ^ 0x2f6e2b1d) >>> 0 || 3)) + ' ' + GOV.chiefdom, gov: 'chiefdom', cells: [st], known: ['agri'] });
        p.isFirst = true;
        this.cacheTech(p); this.prepPolity(p);
        // 이 세계는 농경과 함께 시작합니다: 연대기에도 처음부터 적습니다 (firstTech는 건드리지 않음. 뒤에 부족이 따로 농사를 시작할 때의 난수 흐름이 그대로이도록)
        this.reach('agri', `${p.name}에서 사람들이 씨앗을 심기 시작했습니다. 농경의 시작입니다.`);
        return;
      }
      for (const c of this.landCells) this.pop[c] = this.Kcell(c) * r.range(0.5, 0.9);
      // 역사적 나라들
      const seeds = [];
      let tot = 0;
      ep.polities.forEach((d) => { tot += d[2]; });
      const popScale = ep.popTotal ? ep.popTotal / tot : 1;
      ep.polities.forEach((d) => {
        const [name, places, popM, level, gov, minus, areaM, nukes, demo] = d;
        const p = this.newPolity({ name, gov, cells: [], known: this.levelTechs(level, minus), historical: true });
        const wh = typeof nukes === 'number' ? nukes : nukes ? 100 : 0;
        p.wh = Math.round(wh * this.C.nukes); p.nukes = p.wh > 0;
        if (level > TI.fission && gov !== 'chiefdom') p.nukeChance = true;
        p.targetPop = popM * 1e6 * popScale;
        p._demo = demo || null;
        places.forEach(([lo, la, n]) => {
          const c = this.cellAt(lo, la);
          if (c < 0) return;
          let budget = n;
          if (!n && areaM) budget = Math.max(1, Math.round((areaM * 1e6) / places.length / M.area[c]));
          seeds.push({ p, c, budget });
        });
      });
      this.growSeeds(seeds, ep.year >= 2000);
      // 기술·인구 구조 준비 (토지 보정 전에 생활 수준을 알아야 함)
      for (const p of this.pols) { this.cacheTech(p); this.prepPolity(p); if (p.known[TI.medicine]) this.initDemog(p, p._demo); this.updKmul(p); }
      // 인구 맞추기: 실제 인구 밀도에 맞춰 그 땅의 생산성을 보정 (모형이 못 보는 벼농사 등)
      const cellsOf = new Map();
      for (const c of this.landCells) { const o = this.owner[c]; if (o < 0) continue; if (!cellsOf.has(o)) cellsOf.set(o, []); cellsOf.get(o).push(c); }
      for (const p of this.pols) {
        if (!p.targetPop) continue;
        const cells = cellsOf.get(p.id) || [];
        let K = 0;
        cells.forEach((c) => { K += this.Kcell(c); });
        // 이미 땅이 꽉 찬 옛 사회는 85%, 오늘날은 출산율이 높을수록 늘어날 여지를 더 둠
        const u = p._demo ? WS.clamp(0.62 - 0.07 * (p._demo[0] - 1.5), 0.3, 0.62) : ep.year >= 1850 ? 0.5 : ep.year >= 1400 ? 0.45 : 0.85;
        const kb = WS.clamp(p.targetPop / Math.max(1, K) / u, 0.05, 25);
        cells.forEach((c) => {
          this.kbase[c] = kb;
          // 역사 출발점: 보정 배수 중 집약화로 설명되는 만큼(최대 kmax)은 집약도로, 나머지는 땅의 기본값으로
          if (this.hist) { const ki = WS.clamp(kb, 1, this.kmax[c]); this.kint[c] = ki; this.kbB[c] *= kb / ki; this.kb0[c] = this.kbB[c] * ki; }
          else this.kb0[c] *= kb;
        });
        K *= kb;
        cells.forEach((c) => { this.pop[c] = (p.targetPop * this.Kcell(c)) / Math.max(1, K); });
        if (cells.length) p.cap = cells.reduce((b, c) => (this.pop[c] > this.pop[b] ? c : b), cells[0]);
      }
      // 시작 전에 이미 있던 것은 '처음'으로 기록하지 않음
      const before = { v: NaN, label: '시작 이전' };
      for (const p of this.pols) for (let i = 0; i < NT; i++) if (p.known[i] && !this.firstTech[TECH[i][0]]) {
        this.firstTech[TECH[i][0]] = { year: this.year, seeded: true };
        if (MS_TECH[TECH[i][0]]) this.reached[MS_TECH[TECH[i][0]]] = before;
        if (TECH[i][0] === 'ai') for (const q of this.pols) if (q.known[i]) q.aiYear = this.year - 4;
      }
      if (this.pols.length) this.reached.state = before;
      if (this.year >= 1) this.reached.empire = before;
      if (this.year >= 1900) this.reached.ocean = before;
      if (this.year >= 1900) this.reached.pop1b = before;
      if (this.year >= 2026) this.reached.pop8b = before;
    }
    levelTechs(level, minus) {
      const out = [];
      for (let i = 0; i < Math.min(level, NT); i++) if (!minus || !minus.includes(TECH[i][0])) out.push(TECH[i][0]);
      return out;
    }
    cellAt(lo, la) {
      const M = this.map;
      const x = Math.floor((lo + 180) / M.deg), y = Math.floor((90 - la) / (180 / M.H));
      let best = -1, bd = 1e9;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const yy = y + dy;
        if (yy < 0 || yy >= M.H) continue;
        const c = yy * M.W + ((x + dx + M.W) % M.W);
        if (!M.land[c] || this.owner[c] >= 0) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = c; }
      }
      return best;
    }
    growSeeds(seeds, fillAll) {
      const fr = seeds.map((s) => { if (this.owner[s.c] < 0) this.owner[s.c] = s.p.id; s.budget--; return [s.c]; });
      let active = true;
      while (active) {
        active = false;
        seeds.forEach((s, k) => {
          let n = Math.max(1, Math.round(s.budget * 0.12));
          while (n-- > 0 && s.budget > 0 && fr[k].length) {
            const c = fr[k].shift();
            let free = false;
            for (const nb of this.nbrs(c)) {
              if (!this.isLand[nb] || this.owner[nb] >= 0) continue;
              if (s.budget <= 0) { free = true; break; }
              this.owner[nb] = s.p.id; s.budget--; fr[k].push(nb);
            }
            if (s.budget > 0 && free) fr[k].push(c);
            if (fr[k].length > 400) fr[k] = fr[k].slice(-400);
          }
          if (s.budget > 0 && fr[k].length) active = true;
        });
      }
      if (fillAll) {
        const q = this.landCells.filter((c) => this.owner[c] >= 0);
        for (let h = 0; h < q.length; h++) {
          const c = q[h];
          for (const nb of this.nbrs(c)) if (this.isLand[nb] && this.owner[nb] < 0) { this.owner[nb] = this.owner[c]; q.push(nb); }
        }
      }
    }
    nbrs(c) {
      const out = [], o = c * 4;
      for (let k = 0; k < this.nbn[c]; k++) out.push(this.nb[o + k]);
      return out;
    }
    newPolity(o) {
      const id = this.pols.length;
      const known = new Uint8Array(NT);
      (o.known || []).forEach((t) => { if (TI[t] !== undefined) known[TI[t]] = 1; });
      const r = this.rng;
      // 색은 시각용이므로 주 난수를 쓰지 않음
      const h1 = hash32(this.seed, id * 3 + 1), h2 = hash32(this.seed, id * 3 + 2);
      const ci = Math.floor(h2 * PALETTE.length) % PALETTE.length;
      const p = {
        id, name: o.name, gov: o.gov || 'chiefdom', known, ty: o.ty ? Float64Array.from(o.ty) : new Float64Array(NT).fill(-1e9), lost: null, rp: 0, alive: true, born: this.year, parent: o.parent === undefined ? -1 : o.parent,
        color: tint(PALETTE[ci], h1), ci, aggr: r.range(0.5, 1.5), open: r.range(0.5, 1.5), stab: 1,
        cells: 0, popSum: 0, cap: o.cells && o.cells.length ? o.cells[0] : -1, wars: new Map(), wh: 0, nukes: false, coastal: 0, historical: !!o.historical,
        area: 0, peakPop: 0, fam: 0, dmgAvg: 0, stress: 0, warMort: 0, dev: 0, adapt: 1, g: 0, modern: false, tdirty: true,
        // 아래는 나중에 채워지는 값들 (객체 모양을 처음부터 고정해 빠르게)
        tfr: undefined, fdev: undefined, gr: 0, floor: 1.6, mt: 0, clean: 0, aiYear: undefined, agiP: 0, rpRate: 0, rpEff: 0, kver: 0, frKey: -1, frList: null,
        migR: 0, _w: 0, _pk: undefined, kprod: 0.05, res: 0, mil: 1, adminA: 0, energy: 0, cleanCap: 0, nt: 0, eraT: 0, devTech: 0, kmul: 0.05,
        pw: 0, adminC: 0, fauna: 0, faunaN: 0, dmgSum: 0, big: false, golden: false, boost: 0, nukeChance: false, targetPop: 0, _demo: null, fell: undefined,
      };
      this.pols.push(p);
      (o.cells || []).forEach((c) => { this.owner[c] = id; });
      this.ownVer++;
      return p;
    }
    prepPolity(p) { if (p.tdirty) this.cacheTech(p); p.modern = !!p.known[TI.medicine]; p.adapt = 1 - 0.4 * (p.dev || 0); p.adminC = this.adminCap(p); }
    polityName(gov, parent, dir) {
      if (parent && dir) {
        const base = parent.name.replace(/^(신|후|북|남|동|서)(?=\S)/, '');
        // 같은 이름의 나라가 이미 있으면 ('북코스 왕국이 북코스 왕국에 전쟁을 …') 신·후를 붙여 구별
        let name = DIRS[dir] + base;
        for (const pre of ['신', '후']) { if (!this.pols.some((q) => q.alive && q.name === name)) break; name = pre + DIRS[dir] + base; }
        return name;
      }
      const base = WS.makeName(this.rng);
      return base + ' ' + (GOV[gov] || '왕국');
    }

    /* ----- 인구 구조: 근대 의학 이후의 출산·사망 전환 ----- */
    devTarget(p) {
      return WS.clamp((0.04 + p.devTech) * (0.55 + 0.45 * p.stab) * (1 - 0.5 * Math.max(0, p.dmgAvg)) + (p.golden ? 0.15 : 0), 0, 1);
    }
    initDemog(p, demo) {
      const C = this.C;
      const f0 = 1.55 + 0.18 * WS.clamp(this.rng.normal(), -2.5, 2.5);
      if (demo) {
        const [tfr0, gr0, clean0] = demo;
        p.floor = Math.min(f0, tfr0 * 0.97);
        const x = (tfr0 * 0.94 - p.floor) / (TFR_MAX - p.floor);
        p.dev = x <= 0 ? 0.95 : WS.clamp(1 - Math.pow(x, 1 / TFR_EXP), 0.05, 0.95);
        p.tfr = tfr0 * C.fert;
        // 출산 성향이 바뀌면 처음에는 출생률만큼만 증가율이 달라지고(조출생률 ≈ 합계출산율/140), 나머지는 세대가 바뀌며 천천히 나타남
        p.gr = gr0 / 100 + (tfr0 / 140) * (C.fert - 1);
        p.mt = 1;
        p.clean = clean0;
      } else {
        p.floor = f0;
        p.dev = Math.min(0.45, this.devTarget(p) * 0.35);
        const fl = p.floor * C.fert;
        p.tfr = fl + (TFR_MAX * C.fert - fl) * Math.pow(1 - p.dev, TFR_EXP);
        p.gr = 0.004;
        p.mt = this.year >= 1850 && p.known[TI.combust] ? 0.3 : 0.05;
        p.clean = 0;
      }
      p.modern = true;
    }
    demog(p, dt) {
      const C = this.C;
      if (p.tfr === undefined) this.initDemog(p, null);
      const dT = this.devTarget(p);
      if (dT > p.dev) p.dev += (dT - p.dev) * (1 - Math.exp(-0.035 * dt));
      else if (dT < p.dev * 0.85) p.dev += (dT - p.dev) * (1 - Math.exp(-0.05 * dt));
      p.mt = Math.min(1, p.mt + 0.03 * dt * (0.5 + p.dev));
      // 출산율의 바닥: 천천히 대체 수준 쪽으로 돌아오고(선택 효과), 인구가 급감하면 오름(이스털린 효과, 대체 수준을 조금 넘는 데까지),
      // 대체 수준을 넘는 출산으로 인구가 다시 늘면 붐비는 만큼 내려감(집값·경쟁), 나라마다 무작위로 흔들림
      const easter = 0.04 * Math.max(0, 0.65 - p.popSum / Math.max(1, p.peakPop)) * Math.max(0, 2.4 - p.floor);
      const fe = p.floor + this.fertZ;
      const crowd = fe > 2.05 && p.g > 0 ? 2.5 * (fe - 2.05) * p.g : 0;
      p.floor += dt * (0.0025 * (2.05 - p.floor) + 0.012 * Math.max(0, 1.5 - p.floor) + easter - crowd) + 0.025 * Math.sqrt(dt) * this.rng.normal();
      p.floor = WS.clamp(p.floor, 0.6, 3.2);
      const fl = WS.clamp((p.floor + this.fertZ) * C.fert, 0.45, 4);
      // 출산 문화는 생활 수준을 늦게 따라감 (세계가 통신망으로 이어질수록 빨리): 그사이 사망만 줄어 인구가 폭발적으로 늘어남
      if (p.fdev === undefined) p.fdev = p.dev;
      p.fdev += (p.dev - p.fdev) * (1 - Math.exp(-dt / (2 + 28 * Math.pow(1 - (this.netShare || 0), 3))));
      const tT = fl + (TFR_MAX * C.fert - fl) * Math.pow(1 - p.fdev, TFR_EXP);
      p.tfr += (tT - p.tfr) * (1 - Math.exp(-dt / 15));
      const repl = 2.08 + 1.4 * (1 - p.dev) * (1 - p.dev);
      const ri = Math.log(Math.max(0.2, p.tfr) / repl) / 28;
      // 사망률이 떨어지면 증가율은 곧바로 오르지만, 출산율이 떨어진 효과는 한 세대가 지나야 다 나타남 (인구 관성)
      p.gr += (ri - p.gr) * (1 - Math.exp(-dt / (ri > p.gr ? 12 : 40)));
    }
    updKmul(p) {
      p.adapt = 1 - 0.4 * (p.dev || 0);
      p.kmul = p.kprod * (p.golden ? 1.4 : 1) * (p.known[TI.elec] ? 1 + 2.5 * (p.dev || 0) : 1);
    }

    /* ----- 매 단계 ----- */
    tick() {
      const era = this.eraNow;
      let dt = era <= 1 ? 20 : era <= 3 ? 10 : era <= 4 ? 5 : era <= 5 ? 2 : 1;
      if (this.year + dt > this.endYear) dt = Math.max(1, this.endYear - this.year);
      this.dt = dt;
      this.year += dt;
      this.populate(dt);
      if (this.hist) this.intensify(dt);
      this.aggregate();
      this.refresh(dt);
      this.tribes(dt);
      this.research(dt);
      this.expand(dt);
      this.wars(dt);
      this.politics(dt);
      if (this.steps % 3 === 0) this.colonize(dt);
      this.calamities(dt);
      this.globalSystems(dt);
      this.checkMilestones();
      this.checkEnd();
      // 나비 효과: 역사의 우연(난수의 흐름)이 세계의 정확한 상태(사람 수, 한 명 단위)에 따라 달라짐.
      // 같은 씨앗·같은 상태면 늘 같은 역사지만, 사람 한 명만 달라도 이후의 우연이 갈라짐 (현실의 혼돈처럼)
      if (typeof this.rng.s === 'number') this.rng.s = (this.rng.s ^ Math.imul(Math.floor(this.worldPop) % 2147483647, 0x9e3779b1)) >>> 0 || 1;
    }
    populate(dt) {
      const lc = this.lc, pop = this.pop, owner = this.owner, pols = this.pols, war = this.war, tribe = this.tribe, C = this.C, hist = this.hist;
      const kb0 = this.kb0, kmod = this.kmod, dmg = this.dmg, wl = this.map._wl, winter = this.winter;
      const wf = Math.pow(0.992, dt), wfm = Math.pow(0.994, dt), famK = 1 - Math.exp(-0.3 * dt);
      let famine = 0;
      for (let k = 0; k < lc.length; k++) {
        const c = lc[k];
        let P = pop[c];
        if (P < 1) { pop[c] = 0; continue; }
        const o = owner[c];
        const p = o >= 0 ? pols[o] : null;
        // 이 칸이 먹여 살릴 수 있는 사람 수 (Kcell과 같은 계산)
        const dm = dmg[c];
        let f = 1 - (dm > 0 ? dm * (p ? p.adapt : 1) : dm);
        if (winter > 0) f *= Math.max(0.03, 1 - 0.16 * winter * wl[c]);
        let K = kb0[c] * (p ? p.kmul : TRIBE_D[tribe[c]]) * kmod[c] * f;
        if (K < 1e-4) K = 1e-4;
        if (p && p.modern) {
          const g = p.g - 0.012 * (dm > 0 ? dm * p.adapt : 0);
          const x = P / K;
          if (x < 1) { const x2 = x * x; P *= Math.exp((g > 0 ? g * (1 - x2 * x2) : g) * dt); }
          else if (g < 0) P *= Math.exp(g * dt);
          if (war[c]) P *= wfm;
          if (P > K) { const ex = (P - K) * famK; P -= ex; p.fam += ex; famine += ex; }
        } else {
          let rate = 0.0012;
          // 원양 항해 뒤에는 대륙 사이의 작물 교환(감자·옥수수 등)으로 농업 사회도 더 빨리 늘어남
          // (역사 출발점에서는 신석기 마을이 더 천천히 늘어나 첫 국가가 기원전 3700년 무렵에 생기고, 근세·산업화 초기의 인구는 더 빨리 늚)
          if (p) rate = p.known[TI.steam] ? (hist ? 0.009 : 0.006) : p.known[TI.compass] ? (hist ? 0.007 : 0.006) : p.known[TI.agri] ? 0.0025 : 0.0012;
          else if (tribe[c] & 1) rate = hist ? 0.00092 : 0.0018;
          rate *= C.fert;
          // 로지스틱 성장의 정확한 해
          P = K / (1 + (K / P - 1) * Math.exp(-rate * dt));
          if (war[c]) P *= wf;
        }
        pop[c] = P;
      }
      this.famineY = famine / dt;
      this.catLoss += famine;
      // 기근·풍년 등 지역 보정의 소멸
      if (this.kmodList.length) {
        const keep = [];
        for (const c of this.kmodList) { this.kmodT[c] -= dt; if (this.kmodT[c] <= 0) { this.kmodT[c] = 0; this.kmod[c] = 1; } else keep.push(c); }
        this.kmodList = keep;
      }
      // 수렵채집민의 빈 땅 확산
      if (this.unowned > 0) {
        const nb = this.nb, nbn = this.nbn;
        for (let k = 0; k < lc.length; k++) {
          const c = lc[k];
          if (pop[c] >= 1 || owner[c] >= 0) continue;
          for (let j = 0; j < nbn[c]; j++) {
            const n = nb[c * 4 + j];
            if (pop[n] > 100 && this.rng.chance(0.05 * dt)) { pop[c] = 50; tribe[c] = owner[n] >= 0 ? 0 : tribe[n] & 1; break; }
          }
        }
      }
    }
    /* 농업 집약화 (역사 출발점): 나라가 다스리고 사람이 꽉 찬 땅에서 관개·계단식 논밭·윤작이 쌓여 같은 땅이 더 많은 사람을 먹여 살림.
       산업화 이후에는 기술(K)이 그 몫을 맡음. 버려진 땅은 서서히 되돌아감 */
    intensify(dt) {
      const lc = this.lc, owner = this.owner, pols = this.pols, kint = this.kint, kmax = this.kmax, kbB = this.kbB, kb0 = this.kb0, pop = this.pop;
      const g = 1 - Math.exp(-INT_R * dt), dec = 1 - Math.exp(-dt / INT_DEC);
      for (let k = 0; k < lc.length; k++) {
        const c = lc[k], o = owner[c];
        let v = kint[c];
        if (o >= 0) {
          const p = pols[o];
          if (p.known[TI.steam] || v >= kmax[c]) continue;
          const x = Math.min(1, pop[c] / (kb0[c] * p.kmul));
          v += (kmax[c] - v) * g * x * x;
        } else if (v > 1) v = Math.max(1, v - (v - 1) * dec);
        else continue;
        kint[c] = v; kb0[c] = kbB[c] * v;
      }
    }
    aggregate() {
      const pols = this.pols;
      for (const p of pols) { p.cells = 0; p.popSum = 0; p.coastal = 0; p.area = 0; p.faunaN = 0; p.dmgSum = 0; }
      let wp = 0, un = 0;
      const M = this.map, lc = this.lc, pop = this.pop, owner = this.owner, dmg = this.dmg;
      for (let k = 0; k < lc.length; k++) {
        const c = lc[k], P = pop[c];
        wp += P;
        const o = owner[c];
        if (o < 0) { un++; continue; }
        const p = pols[o];
        p.cells++; p.popSum += P; p.area += M.area[c]; p.dmgSum += P * dmg[c];
        if (M.coast[c]) p.coastal++;
        if (M.fauna[c] > 0.3) p.faunaN++;
      }
      this.earthPop = wp;
      this.worldPop = wp + this.offworld;
      this.unowned = un;
      for (const p of pols) {
        if (!p.alive) continue;
        p.fauna = p.faunaN > 0 ? 1 : 0;
        p.dmgAvg = p.popSum > 0 ? p.dmgSum / p.popSum : 0;
        if (p.cells === 0) this.fall(p);
        else if (p.cap < 0 || owner[p.cap] !== p.id) this.moveCapital(p);
      }
      this.alive = pols.filter((p) => p.alive);
      if (this.worldPop > this.popPeak) { this.popPeak = this.worldPop; this.popPeakYear = this.year; }
    }
    /* 나라별 값 정리: 기술 효과, 인구 구조, 이주, 힘 (한 단계에 한 번) */
    refresh(dt) {
      const C = this.C, ks = this.knownShare;
      ks.fill(0);
      let era = 0, inflow = 0, wsum = 0;
      for (const p of this.alive) {
        if (p.tdirty) this.cacheTech(p);
        p.peakPop = Math.max(p.peakPop * Math.exp(-0.002 * dt), p.popSum);
        p.modern = !!p.known[TI.medicine];
        if (p.modern) this.demog(p, dt);
        this.updKmul(p);
        const famR = p.popSum > 0 ? p.fam / p.popSum / Math.max(1, dt) : 0;
        p.fam = 0;
        p.stress = WS.clamp(Math.max(0, p.dmgAvg) * 1.5 + famR * 25 + (this.winter > 1 ? 0.15 : 0), 0, 1);
        p.pw = Math.pow(p.popSum + 1, 0.7) * p.mil * p.mil * (0.5 + 0.5 * p.stab);
        p.adminC = this.adminCap(p);
        if (p.eraT > era) era = p.eraT;
        const k = p.known, ps = p.popSum;
        for (let i = 0; i < NT; i++) if (k[i]) ks[i] += ps;
        // 이주: 잘사는 나라로 들어오고, 가난하거나 기후 피해·위기가 큰 나라에서 빠져나감 (세계 인구는 거의 그대로)
        p.migR = 0; p._w = 0;
        if (p.modern && ps > 1e5) {
          if (p.dev > 0.65 && p.dmgAvg < 0.15) { p.migR = 0.007 * (p.dev - 0.65) * p.stab * Math.sqrt(C.trade) * (0.6 + this.coop); inflow += p.migR * ps; }
          else { p._w = ps * (Math.max(0, 0.7 - p.dev) + 3 * Math.max(0, p.dmgAvg - 0.1) + 2 * p.stress); wsum += p._w; }
        }
      }
      const W = Math.max(1, this.earthPop);
      for (let i = 0; i < NT; i++) ks[i] /= W;
      this.netShare = ks[TI.internet];
      if (!this.pols.length) { for (const c of this.landCells) if (this.tribe[c] & 1) { era = 1; break; } }
      this.eraNow = era;
      this.migFlow = wsum > 0 ? inflow : 0;
      for (const p of this.alive) {
        if (wsum <= 0) p.migR = 0;
        else if (p._w > 0) p.migR = -Math.min(0.05, (inflow * p._w) / wsum / p.popSum);
        p.g = p.modern ? p.mt * p.gr + (1 - p.mt) * 0.004 * C.fert - p.warMort + this.longev + p.migR : 0;
      }
    }
    moveCapital(p) {
      let best = -1, bv = -1;
      for (const c of this.landCells) if (this.owner[c] === p.id && this.pop[c] > bv) { bv = this.pop[c]; best = c; }
      p.cap = best;
    }
    fall(p) {
      p.alive = false;
      p.fell = this.year;
      for (const [q] of p.wars) { const o = this.pols[q]; if (o) o.wars.delete(p.id); }
      p.wars.clear();
      if (p.peakPop > 5e6 || p.historical) this.log(`${josa(p.name, '이', '가')} 역사 속으로 사라졌습니다.`, p.peakPop > 2e7 ? 'disaster' : 'info');
    }
    techShare(id) { return this.knownShare[TI[id]] || 0; }
    maxEra() { return this.eraNow; }
    techNow() { let m = 0; for (const p of this.alive) if (p.nt > m) m = p.nt; return m; }

    /* 부족: 농경의 독자 발명과 확산, 첫 국가의 탄생 */
    tribes(dt) {
      const M = this.map, r = this.rng, nb = this.nb, nbn = this.nbn, lc = this.lc;
      for (let k = 0; k < lc.length; k++) {
        const c = lc[k];
        if (this.owner[c] >= 0) continue;
        const b = this.tribe[c];
        if (!(b & 1)) {
          // 독자 발명: 비옥하고 큰 강이 있는 온화한 곳에서 더 쉬움
          const la = Math.abs(M.lat[c]);
          const dom = M.fert[c] > 0.5 ? M.fert[c] * (M.river[c] ? 3 : 1) * (la > 8 && la < 42 ? 1.5 : 0.25) * (0.3 + 0.7 * M.fauna[c]) : 0;
          // 역사 출발점: 빙하기 말의 추위(영거 드라이아스)가 끝나는 기원전 9700년 전에는 농사가 자리 잡지 못하고, 그 뒤에는 금방 시작됨
          const clim = this.hist ? (this.year < -9700 ? 0 : 4) : this.year < -8000 ? 0.5 : 1;
          if (dom > 0 && r.chance(3.5e-6 * dom * dt * clim)) {
            this.tribe[c] |= 1;
            if (!this.firstTech.agri) this.firstLearn('agri', null, c);
            else if (r.chance(0.5)) this.log(`${this.regionName(c)}에서 농경이 따로 발명되었습니다.`);
          }
          // 이웃에게서 배우기: 위도가 비슷해야 같은 작물이 잘 자람
          for (let j = 0; j < nbn[c]; j++) {
            const n = nb[c * 4 + j];
            const has = this.owner[n] >= 0 ? (this.pols[this.owner[n]].known[TI.agri] ? 1 : 0) : this.tribe[n] & 1;
            if (has && M.fert[c] > 0.12 && r.chance(0.012 * dt * Math.exp(-Math.abs(M.lat[c] - M.lat[n]) / 6) * Math.min(1, M.fert[c] * 2))) { this.tribe[c] |= 1; break; }
          }
        } else {
          // 목축·토기·청동·철 등도 이웃에게서 천천히 배움
          for (let j = 0; j < nbn[c]; j++) {
            const n = nb[c * 4 + j];
            const o = this.owner[n];
            for (let i = 1; i < TRIBAL.length; i++) {
              if (b & (1 << i)) continue;
              const hasN = o >= 0 ? this.pols[o].known[TI[TRIBAL[i]]] : this.tribe[n] & (1 << i);
              if (hasN && (i !== 1 || M.fauna[c] > 0.3) && r.chance(0.006 * dt)) this.tribe[c] |= 1 << i;
            }
          }
          if (!(b & 2) && M.fauna[c] >= 1 && r.chance(0.0006 * dt)) this.tribe[c] |= 2;
          if (!(b & 4) && r.chance(0.002 * dt)) this.tribe[c] |= 4;
          // 인구가 빽빽해지면 족장국이 생김
          const dens = this.pop[c] / M.area[c];
          if (b & 4 && dens > 2.2 && r.chance(0.004 * dt)) {
            const cells = [c, ...this.nbrs(c).filter((n) => M.land[n] && this.owner[n] < 0 && this.tribe[n] & 1)].slice(0, 3);
            const known = TRIBAL.filter((_, i) => b & (1 << i));
            const p = this.newPolity({ name: this.polityName('chiefdom'), gov: 'chiefdom', cells, known });
            this.prepPolity(p); this.updKmul(p);
            if (!this.reached.state) { this.reach('state', `${this.regionName(c)}에서 첫 국가 ${josa(p.name, '이', '가')} 생겨났습니다. 족장이 여러 마을을 다스립니다.`); this.mark('state', c); }
          }
        }
      }
    }
    regionName(c) {
      const M = this.map;
      const la = M.lat[c];
      if (M.earth) { const lo = M.lon[c]; for (const [n, a, b, c1, d] of REGIONS) if (lo >= a && lo <= b && la >= c1 && la <= d) return n; }
      // 다른 행성(또는 이름 없는 곳): 위도로 말하는 거친 지명
      const a = Math.abs(la), side = la >= 0 ? '북쪽' : '남쪽';
      return a < 15 ? '적도 부근 지방' : `${side} ${a < 35 ? '저위도' : a < 55 ? '중위도' : '고위도'} 지방`;
    }

    /* 연구와 기술 확산 */
    available(p, i) {
      if (p.known[i]) return false;
      const pre = PRE[i];
      for (let k = 0; k < pre.length; k++) if (!p.known[pre[k]]) return false;
      if (i === TI.herd && !p.fauna) return false;
      if ((i === TI.sail || i === TI.compass) && !p.coastal) return false;
      // 역사 출발점: 바탕 기술이 사회에 자리 잡을 시간이 필요함
      if (this.matRule) { const m = this.matRule[i]; if (m && this.year - p.ty[m[0]] < m[1]) return false; }
      return true;
    }
    /* 지금 배울 수 있는 기술 목록 (아는 기술이 바뀌거나 바탕 기술이 자리 잡을 때만 다시 계산) */
    frontier(p) {
      let mm = 0;
      if (this.matList) for (let k = 0; k < this.matList.length; k++) { const m = this.matList[k]; if (p.known[m[1]] && !p.known[m[0]] && this.year - p.ty[m[1]] >= m[2]) mm |= 1 << k; }
      const key = ((p.kver || 0) * 4 + mm) * 4 + (p.fauna ? 2 : 0) + (p.coastal > 0 ? 1 : 0);
      if (p.frKey === key && p.frList) return p.frList;
      const list = [];
      for (let i = 0; i < NT; i++) if (this.available(p, i)) list.push(i);
      list.sort((a, b) => this.costOf(p, a) - this.costOf(p, b) || a - b);
      p.frList = list; p.frKey = key;
      return list;
    }
    research(dt) {
      const r = this.rng, C = this.C;
      const adj = this.adjacency();
      let tradeRP = 0;
      for (const p of this.alive) {
        const gov = p.gov === 'democracy' ? 1.25 : p.gov === 'republic' ? 1.15 : p.gov === 'autocracy' ? 0.9 : p.gov === 'chiefdom' ? 0.7 : 1;
        const urban = Math.min(3, Math.sqrt(p.popSum / Math.max(1, p.area) / 5) + 0.3);
        // 정보화 이전의 큰 나라는 크기만큼 연구가 늘지 않음 (경쟁이 적고 지식이 수도와 소수에게 갇힘).
        // 산업화 이전에는 약 1,500만 명, 산업 시대에는 약 6,000만 명을 넘는 부분이 덜 보탬
        const ind = p.known[TI.steam] === 1, T0 = ind ? 6e7 : 1.5e7;
        // 역사 출발점: 컴퓨터와 인터넷의 연구 효과는 수십 년에 걸쳐 나타남 (컴퓨터 40년, 인터넷 30년). 처음부터 가진 나라는 이미 다 나타난 상태
        const hist = this.hist;
        const wC = hist && p.known[TI.computer] ? WS.clamp((this.year - p.ty[TI.computer]) / 40, 0, 1) : 1;
        const wN = hist && p.known[TI.internet] ? WS.clamp((this.year - p.ty[TI.internet]) / 30, 0, 1) : 1;
        const ex = p.known[TI.computer] ? (ind ? 0.6 : 0.4) * (1 - wC) + wC : ind ? 0.6 : 0.4;
        const rpop = (p.known[TI.computer] && wC >= 1) || p.popSum <= T0 ? p.popSum / 1e6 : (T0 / 1e6) * Math.pow(p.popSum / T0, ex);
        const resE = p.res - (p.known[TI.computer] ? 3 * (1 - wC) : 0) - (p.known[TI.internet] ? 1.5 * (1 - wN) : 0);
        // 역사 출발점의 산업화 이전: 발명은 한 왕조의 성격이나 일시적 안정보다 문명권 전체에 쌓인 조건에 달려 있음.
        // 철기 이전에는 나라가 커도 연구가 그만큼 늘지 않음 (아는 사람이 소수라 작은 나라도 새 기술을 만들 수 있음)
        const pre = hist && !ind;
        const scale = pre && !p.known[TI.iron] ? ANC_RES * Math.sqrt(rpop / ANC_POP) : Math.pow(rpop, 0.8);
        let RP = scale * (1 + resE) * gov * (pre ? 1 : p.stab) * urban * (pre ? 1 : p.open) * 0.4 * C.research;
        if (p.modern) RP *= 0.4 + 0.8 * p.dev;
        // 인공지능이 연구를 돕기 시작하면 점점 빨라짐
        if (p.known[TI.ai]) RP *= 1 + 1.2 * WS.clamp((this.year - (p.aiYear === undefined ? this.year : p.aiYear)) / 25, 0, 1);
        if (this.agiOutcome === 'aligned') RP *= 2.5;
        else if (this.agiOutcome === 'contained' && p.known[TI.agi]) RP *= 1.5;
        if (p.wars.size) RP *= Math.max(0.5, 1 - 0.15 * p.wars.size);
        if (p.boost) { RP *= 1 + p.boost; p.boost *= Math.pow(0.9, dt); }
        p.rpRate = RP;
        if (p.known[TI.compass]) tradeRP += RP;
      }
      for (const p of this.alive) {
        // 지식의 그물: 이웃과 교역 상대의 연구 일부가 흘러들어옴
        let net = 0;
        const nbs = adj.get(p.id);
        if (nbs) for (const qid of nbs) net += this.pols[qid].rpRate || 0;
        const trade = p.known[TI.compass] ? tradeRP * (p.known[TI.print] ? 0.2 : 0.05) * C.trade : 0;
        p.rpEff = p.rpRate + Math.min(p.rpRate * (p.known[TI.steam] ? 1.5 : 3), (p.known[TI.print] ? 0.3 : 0.12) * net + trade);
        p.rp += p.rpEff * dt;
        // 발견 (가장 싼 것부터)
        let guard = 4;
        while (guard-- > 0) {
          const fl = this.frontier(p);
          let cand = -1;
          for (let j = 0; j < fl.length; j++) if (fl[j] !== TI.agi) { cand = fl[j]; break; }
          if (cand < 0) break;
          const cost = this.costOf(p, cand);
          if (p.rp < cost) break;
          p.rp -= cost;
          this.learn(p, cand, true);
        }
        // 인공지능 연구 경쟁: 연구력의 일부가 초지능 개발에 따로 쓰임 (여러 나라가 동시에 달림)
        if (p.known[TI.ai] && !p.known[TI.agi]) {
          p.agiP = (p.agiP || 0) + 0.3 * p.rpEff * dt;
          if (p.agiP >= this.costOf(p, TI.agi)) this.learn(p, TI.agi, true);
        }
        // 확산: 이웃이 아는 기술은 훨씬 싸게 배움
        const nb = adj.get(p.id);
        if (nb) for (const qid of nb) {
          const q = this.pols[qid];
          if (!q.alive) continue;
          const i = r.int(0, NT - 1);
          if (q.known[i] && this.available(p, i) && r.chance(1 - Math.exp(-0.025 * p.open * C.trade * dt))) this.learn(p, i, false);
        }
        // 원양 항해 이후에는 세계 교역망으로 뒤처진 기술을 따라잡음 (그 기술을 쓰는 인구가 많을수록 빨리)
        if (p.known[TI.compass]) {
          let cand = -1, cost = Infinity;
          const fl = this.frontier(p);
          for (let j = 0; j < fl.length; j++) { const i = fl[j]; if (this.knownShare[i] > 0 && TECH[i][3] < cost) { cost = TECH[i][3]; cand = i; } }
          if (cand >= 0) {
            // 증기선과 비행기로 세계가 이어진 뒤에는 뒤처진 나라도 남의 기술을 빨리 들여옴 (따라잡기)
            const reach = p.known[TI.internet] ? 2 : p.known[TI.steam] || this.knownShare[TI.combust] > 0.3 ? 1 : 0.2;
            const k = 0.06 * C.trade * p.open * reach * this.knownShare[cand];
            if (r.chance(1 - Math.exp(-k * dt))) this.learn(p, cand, false);
          }
        }
      }
    }
    learn(p, i, invented) {
      p.known[i] = 1;
      p.ty[i] = this.year;
      p.kver = (p.kver || 0) + 1;
      if (p.lost) p.lost[i] = 0;
      p.tdirty = true;
      const id = TECH[i][0];
      if (id === 'ai') p.aiYear = this.year;
      if (id === 'medicine' && p.tfr === undefined) this.initDemog(p, null);
      if (!this.firstTech[id]) this.firstLearn(id, p, p.cap);
      else if (this.firstTech[id].lostAll) { this.firstTech[id].lostAll = false; this.log(`${josa(p.name, '이', '가')} 잊혔던 ${josa(TECH[i][1], '을', '를')} 다시 손에 넣었습니다.`, 'milestone'); this.mark('discovery', p.cap); }
      if (id === 'fission' && p.gov !== 'chiefdom') p.nukeChance = true;
      void invented;
    }
    firstLearn(id, p, c) {
      this.firstTech[id] = { year: this.year, by: p ? p.name : null };
      const t = TECH[TI[id]];
      const who = p ? p.name : this.regionName(c);
      const txt = {
        agri: `${who}에서 사람들이 씨앗을 심기 시작했습니다. 농경의 시작입니다.`,
        writing: `${who}에서 문자가 발명되었습니다. 역사가 기록되기 시작합니다.`,
        iron: `${josa(who, '이', '가')} 철을 다루기 시작했습니다.`,
        compass: `${who}의 배가 대양을 건널 수 있게 되었습니다.`,
        print: `${who}에서 인쇄술이 나왔습니다. 지식이 빠르게 퍼집니다.`,
        science: `${who}에서 실험과 수학으로 자연을 탐구하는 과학 혁명이 일어났습니다.`,
        steam: `${who}에서 증기 기관이 공장을 돌리기 시작했습니다. 산업 혁명입니다.`,
        medicine: `${who}에서 근대 의학이 자리 잡았습니다. 아이들이 덜 죽고 인구가 빠르게 늘기 시작합니다.`,
        fission: `${josa(who, '이', '가')} 원자를 쪼개는 법을 알아냈습니다. 핵무기가 가능해졌습니다.`,
        space: `${josa(who, '이', '가')} 처음으로 우주에 물체를 쏘아 올렸습니다.`,
        internet: `${who}에서 시작된 컴퓨터 통신망이 세계를 하나로 잇습니다.`,
        renew: `${who}에서 태양과 바람으로 값싼 전기를 만들기 시작했습니다.`,
        ai: `${who}에서 스스로 배우는 기계, 인공지능이 등장했습니다.`,
        gene: `${josa(who, '이', '가')} 유전자를 마음대로 고치는 기술을 얻었습니다. 병을 고칠 수도, 무기를 만들 수도 있습니다.`,
        fusion: `${josa(who, '이', '가')} 별의 불꽃, 핵융합 발전에 성공했습니다. 깨끗한 에너지가 넘쳐납니다.`,
        mars: `${josa(who, '이', '가')} ${this.settle.out}에 영구 정착지를 세웠습니다.`,
        agi: `${who}에서 인간을 넘어서는 초지능이 깨어났습니다.`,
        star: `${who}의 우주선이 다른 별을 향해 떠났습니다.`,
      }[id] || `${who}: ${josa(t[1], '을', '를')} 처음 손에 넣었습니다.`;
      const ms = MS_TECH[id];
      if (ms) this.reach(ms, txt); else this.log(txt);
      if (c >= 0) this.mark(id === 'mars' || id === 'space' || id === 'star' ? 'space' : id === 'agi' ? 'agi' : 'discovery', c);
      if (id === 'agi') this.agiEvent(p);
      if (id === 'gene') this.longev += 0.0015;
      if (id === 'mars') this.offworld = Math.max(this.offworld, 200);
    }
    adjacency() {
      // 국경이 바뀔 때만 다시 계산 (ownVer는 땅 주인이 바뀔 때마다 올라감)
      if (this._adjVer === this.ownVer && this._adj) return this._adj;
      const M = this.map, W = M.W, adj = new Map(), border = new Map();
      const add = (a, b) => {
        let s = adj.get(a);
        if (!s) { s = new Set(); adj.set(a, s); }
        s.add(b);
      };
      const lc = this.lc, owner = this.owner;
      for (let k = 0; k < lc.length; k++) {
        const c = lc[k], a = owner[c];
        if (a < 0) continue;
        const x = c % W;
        const right = c - x + ((x + 1) % W), down = c + W;
        let b = owner[right];
        if (b >= 0 && b !== a) { add(a, b); add(b, a); const key = a < b ? a * 100000 + b : b * 100000 + a; border.set(key, (border.get(key) || 0) + 1); }
        if (down < M.NC) { b = owner[down]; if (b >= 0 && b !== a) { add(a, b); add(b, a); const key = a < b ? a * 100000 + b : b * 100000 + a; border.set(key, (border.get(key) || 0) + 1); } }
      }
      this._adj = adj; this._border = border; this._adjVer = this.ownVer;
      return adj;
    }

    /* 영토 확장 (빈 땅·부족 땅 흡수) */
    expand(dt) {
      const r = this.rng, lc = this.lc, owner = this.owner, nb = this.nb, nbn = this.nbn;
      // 주인 없는 땅마다, 이웃한 나라 칸들이 흡수를 시도 (각 나라 칸은 이웃 하나를 골라 시도하므로 1/이웃 수)
      for (let k = 0; k < lc.length; k++) {
        const n = lc[k];
        if (owner[n] >= 0) continue;
        // 국가는 주변 부족을 흡수 (농경민은 쉽게, 사냥꾼 땅은 천천히)
        const base = (this.tribe[n] & 1 ? 0.025 : 0.006) * dt;
        for (let j = 0; j < nbn[n]; j++) {
          const c = nb[n * 4 + j], o = owner[c];
          if (o < 0) continue;
          const p = this.pols[o];
          const room = p.cells < p.adminC ? 1 : 0.15;
          if (r.chance((base * room * (0.6 + 0.4 * p.aggr) * (p.gov === 'chiefdom' ? 0.6 : 1)) / nbn[c])) { owner[n] = o; this.ownVer++; break; }
        }
      }
    }
    adminCap(p) {
      const g = p.gov === 'empire' ? 1.4 : p.gov === 'chiefdom' ? 0.5 : 1;
      const modern = p.known[TI.steam] ? 3.5 : 1;
      const net = p.known[TI.internet] ? 2.5 : 1;
      return 6 * (1 + p.adminA * 2.2) * g * modern * net;
    }
    power(p) { return p.pw !== undefined ? p.pw : Math.pow(p.popSum + 1, 0.7) * p.mil * p.mil * (0.5 + 0.5 * p.stab); }

    /* 전쟁 */
    wars(dt) {
      const r = this.rng, C = this.C, adj = this.adjacency();
      this.war.fill(0);
      const coopF = Math.max(0.05, 1 - 0.8 * this.coop);
      for (const p of this.alive) {
        if (!p.alive) continue;
        const nb = adj.get(p.id);
        if (!nb) continue;
        // 이웃에게 선전 포고
        if (p.wars.size < 2 && p.gov !== 'tribe') {
          let target = null, best = 0;
          for (const qid of nb) {
            const q = this.pols[qid];
            if (!q.alive || p.wars.has(qid)) continue;
            const ratio = p.pw / (q.pw + 1);
            const peace = p.gov === 'democracy' && q.gov === 'democracy' ? 0.08 : 1;
            const s = ratio * peace * (q.wh > 0 ? 0.3 : 1);
            if (s > best) { best = s; target = q; }
          }
          const g = p.gov === 'empire' || p.gov === 'autocracy' ? 1.4 : p.gov === 'democracy' ? 0.5 : 1;
          // 근대 이후에는 정복 전쟁이 드묾 (국제 규범, 억지력)
          const modern = p.known[TI.combust] ? 0.12 * (1 + 2 * p.stress) : 1;
          if (target && best > 1.25 && r.chance(0.012 * dt * p.aggr * g * coopF * Math.min(3, best - 0.8) * modern * C.aggression)) this.declare(p, target);
        }
      }
      this.greatPowers(dt);
      // 전선
      const W = this.map.W, lc = this.lc, owner = this.owner, NC = this.map.NC;
      const flips = [];
      for (let k = 0; k < lc.length; k++) {
        const c = lc[k], a = owner[c];
        if (a < 0) continue;
        const A = this.pols[a];
        if (!A.wars.size) continue;
        const x = c % W;
        for (const n of [c - x + ((x + 1) % W), c - x + ((x - 1 + W) % W), c + W, c - W]) {
          if (n < 0 || n >= NC) continue;
          const b = owner[n];
          if (b < 0 || !A.wars.has(b)) continue;
          this.war[c] = 1; this.war[n] = 1;
          const B = this.pols[b];
          const pr = A.pw / (A.pw + B.pw);
          const speed = A.known[TI.combust] && B.known[TI.combust] ? 0.05 : 0.12;
          if (r.chance(speed * dt * Math.max(0, pr - 0.42))) flips.push([n, a]);
        }
      }
      for (const [n, a] of flips) { owner[n] = a; this.ownVer++; }
      // 핵 확전과 평화
      for (const p of this.alive) {
        let mort = 0;
        for (const [qid, since] of p.wars) {
          const q = this.pols[qid];
          if (!q || !q.alive) { p.wars.delete(qid); continue; }
          // 산업화된 나라끼리의 전쟁은 전선 밖에서도 사람이 죽음 (폭격, 동원)
          if (p.known[TI.combust] && q.known[TI.combust]) mort += 0.0025 * Math.min(1, q.pw / Math.max(1, p.pw));
          if (p.id > qid) continue;
          if (p.wh > 0 && q.wh > 0) {
            const esc = 0.018 * dt * Math.pow(Math.min(2, (p.wh + q.wh) / 300), 0.4) * (1.35 - this.coop) * (p.gov === 'autocracy' || q.gov === 'autocracy' ? 1.4 : 1) * Math.sqrt(C.aggression) * (this.agiOutcome === 'aligned' ? 0.5 : 1);
            if (r.chance(esc)) { this.nuclearWar(p, q); continue; }
          }
          if (r.chance(1 - Math.exp(-0.06 * dt * (1 + (this.year - since) / 20)))) {
            p.wars.delete(qid); q.wars.delete(p.id);
            if (p.big && q.big && p.popSum + q.popSum > 2e8) this.log(`${josa(p.name, '과', '와')} ${q.name}의 전쟁이 끝났습니다.`);
          }
        }
        p.warMort = mort;
      }
    }
    /* 강대국 사이의 큰 전쟁 (국경을 맞대지 않아도 일어남) */
    greatPowers(dt) {
      if (this.eraNow < 7) return;
      const r = this.rng, C = this.C;
      const gp = this.alive.filter((p) => p.popSum > 3e7 && p.known[TI.combust]).sort((a, b) => b.pw - a.pw).slice(0, 6);
      for (const p of gp) p.big = true;
      const adj = this.adjacency();
      for (let i = 0; i < gp.length; i++) for (let j = i + 1; j < gp.length; j++) {
        const p = gp[i], q = gp[j];
        if (p.wars.has(q.id)) continue;
        const close = Math.min(p.pw, q.pw) / Math.max(p.pw, q.pw);
        let t = 0.25 + close;
        const dp = p.gov === 'democracy', dq = q.gov === 'democracy';
        t *= dp && dq ? 0.12 : dp || dq ? 1 : 0.7;
        t *= Math.sqrt(p.aggr * q.aggr) * C.aggression * Math.pow(Math.max(0.05, 1.25 - this.coop), 2) / Math.sqrt(C.trade);
        t *= 1 + 2 * (p.stress + q.stress);
        if (p.known[TI.ai] && q.known[TI.ai] && !this.agiOutcome) t *= 1.3; // 초지능 경쟁
        if (this.agiOutcome === 'aligned') t *= 0.5;
        const nbp = adj.get(p.id);
        if (nbp && nbp.has(q.id)) t *= 1.5;
        if (r.chance(0.0022 * t * dt)) this.declare(p, q, true);
      }
    }
    declare(p, q, big) {
      p.wars.set(q.id, this.year); q.wars.set(p.id, this.year);
      if (big || p.popSum + q.popSum > 2e7 || (p.wh > 0 && q.wh > 0)) {
        this.log(big ? `강대국 ${josa(p.name, '과', '와')} ${q.name} 사이에 큰 전쟁이 일어났습니다.` : `${josa(p.name, '이', '가')} ${q.name}에 전쟁을 선포했습니다.`, big ? this.repeatKind('war') : 'info');
        this.mark('war', this.borderCell(p, q));
      }
    }
    // 비슷한 일(강대국 전쟁, 새 핵 보유국)이 잇따르면 앞선 일에서 30년이 지나기 전까지는 보통 기록으로 남김.
    // 실험실의 '큰 사건만 추린' 기록과 알림이 한 종류로 가득 차지 않게 하려는 것으로, 동역학에는 영향이 없음 (관측 화면의 연대기에는 모두 남음)
    repeatKind(cat) {
      if (this.year - this.lastLoud[cat] < 30) return 'info';
      this.lastLoud[cat] = this.year;
      return 'disaster';
    }
    borderCell(p, q) {
      const W = this.map.W;
      for (const c of this.landCells) {
        if (this.owner[c] !== p.id) continue;
        const x = c % W;
        for (const n of [c - x + ((x + 1) % W), c - x + ((x - 1 + W) % W), c + W, c - W]) if (n >= 0 && n < this.map.NC && this.owner[n] === q.id) return c;
      }
      return q.cap;
    }
    nuclearWar(p, q) {
      const r = this.rng;
      const W1 = p.wh * r.range(0.3, 0.9), W2 = q.wh * r.range(0.3, 0.9);
      const kill = (W) => Math.min(0.85, 0.08 + 0.6 * (1 - Math.exp(-W / 700)));
      const k1 = kill(W2), k2 = kill(W1);
      let dead = 0;
      for (const c of this.landCells) {
        const o = this.owner[c];
        if (o === p.id || o === q.id) {
          const k = (o === p.id ? k1 : k2) * r.range(0.7, 1.15);
          dead += this.pop[c] * Math.min(0.95, k);
          this.pop[c] *= 1 - Math.min(0.95, k);
        }
      }
      // 불타는 도시의 그을음이 햇빛을 가림
      const soot = 0.5 + 7 * (1 - Math.exp(-(W1 + W2) / 2000));
      this.winter += soot;
      p.wh = Math.max(0, Math.round(p.wh - W1)); q.wh = Math.max(0, Math.round(q.wh - W2));
      p.nukes = p.wh > 0; q.nukes = q.wh > 0;
      p.stab *= 0.5; q.stab *= 0.5;
      p.wars.delete(q.id); q.wars.delete(p.id);
      this.lastNuke = this.year; this.nukeWars++;
      this.catLoss += dead;
      const txt = `${josa(p.name, '과', '와')} ${q.name} 사이에 핵전쟁이 일어났습니다. 핵탄두 약 ${Math.round(W1 + W2).toLocaleString('ko-KR')}발, 즉시 약 ${ppl(dead)}이 목숨을 잃었습니다.`;
      if (!this.reach('nuclearwar', txt + (soot > 2.5 ? ' 재가 하늘을 덮어 세계가 핵겨울에 빠졌습니다.' : ''))) this.log(txt, 'disaster');
      this.mark('nuke', p.cap); this.mark('nuke', q.cap);
      this.lastCat = { year: this.year, kind: '핵전쟁' };
    }

    /* 정치: 체제 변화, 핵무장, 안정, 분열, 기술 퇴보 */
    politics(dt) {
      const r = this.rng, C = this.C;
      const newOnes = [];
      const crashWorld = this.worldPop < 0.5 * this.crashRef;
      for (const p of this.alive) {
        const k = p.known;
        // 체제
        if (p.gov === 'chiefdom' && (k[TI.writing] || k[TI.bronze]) && p.cells >= 4) { p.gov = 'kingdom'; if (p.name.endsWith('족장국')) p.name = p.name.replace('족장국', '왕국'); }
        if (p.gov === 'kingdom' && p.cells >= 40 && k[TI.writing]) { p.gov = 'empire'; if (p.name.endsWith('왕국')) p.name = p.name.replace('왕국', '제국'); if (!this.reached.empire && p.area > 1.5e6) this.reach('empire', `${josa(p.name, '이', '가')} 수많은 민족을 다스리는 대제국이 되었습니다.`); }
        if (p.gov === 'empire' && !this.reached.empire && p.area > 1.5e6) this.reach('empire', `${josa(p.name, '이', '가')} 수많은 민족을 다스리는 대제국이 되었습니다.`);
        if ((p.gov === 'kingdom' || p.gov === 'empire') && k[TI.print] && k[TI.science] && r.chance(0.003 * dt * (k[TI.steam] ? 3 : 1) * (1.4 - p.stab))) {
          const demo = r.chance(0.6 + 0.2 * this.coop);
          p.gov = demo ? 'democracy' : 'autocracy';
          this.log(`${p.name}에서 혁명이 일어나 ${demo ? '민주 정부' : '독재 정부'}가 들어섰습니다.`);
          p.stab *= 0.7;
        }
        if (p.gov === 'democracy' && r.chance(0.0008 * dt * (2 - p.stab) * (1 + 3 * p.stress))) {
          p.gov = 'autocracy';
          if (p.popSum > 5e7) this.log(`위기 속에서 ${p.name}의 민주주의가 무너지고 권위주의 정부가 들어섰습니다.`);
        }
        if (p.gov === 'autocracy' && k[TI.internet] && r.chance(0.002 * dt * (1 - 0.5 * p.stress))) {
          p.gov = 'democracy';
          if (p.popSum > 5e7) this.log(`${josa(p.name, '이', '가')} 민주주의로 바뀌었습니다.`);
        }
        // 핵무장: 핵분열을 아는 나라가 위협을 느끼면 (핵확산금지 체제 이후에는 드묾)
        if (p.nukeChance && !p.wh && C.nukes > 0) {
          // 핵확산금지 체제(인터넷 시대)에서는 드묾
          const base = this.knownShare[TI.internet] > 0.2 ? 0.0004 * (1.4 - this.coop) : 0.03;
          if (r.chance(base * dt * (p.wars.size ? 4 : 1) * (p.gov === 'democracy' ? 0.6 : 1) * Math.sqrt(C.nukes))) {
            p.wh = Math.max(1, Math.round(20 * C.nukes)); p.nukes = true;
            this.log(`${josa(p.name, '이', '가')} 핵무기를 보유했습니다.`, this.repeatKind('nuke'));
            this.mark('nukeown', p.cap);
          }
        }
        // 군비: 전쟁과 긴장 속에서는 늘고, 협력이 높으면 줄어듦
        if (p.wh > 0) {
          if (p.wars.size || this.coop < 0.25) p.wh = Math.min(8000 * C.nukes + 50, p.wh * Math.exp(0.025 * dt));
          else if (this.coop > 0.45) {
            p.wh *= Math.exp(-0.08 * (this.coop - 0.4) * dt);
            if (p.wh < 5) { p.wh = 0; p.nukes = false; this.log(`${josa(p.name, '이', '가')} 마지막 핵탄두를 해체했습니다.`); }
          }
          p.nukes = p.wh > 0;
        }
        // 안정도
        const over = p.cells / this.adminCap(p);
        const target = WS.clamp(1.15 - 0.35 * Math.max(0, over - 1) - 0.12 * p.wars.size - 0.6 * p.stress, 0.15, 1);
        p.stab += (target - p.stab) * Math.min(1, 0.08 * dt);
        // 분열
        if (p.cells >= 6 && (over > 1 || p.stress > 0.3) && r.chance(0.006 * dt * (Math.max(0, over - 0.8) + p.stress) * (1.3 - p.stab))) newOnes.push(p);
        // 붕괴 속의 기술 퇴보: 인구가 급감하면 첨단 기술을 유지할 사람과 공장이 사라짐
        if (k[TI.steam] && (p.popSum < 0.45 * p.peakPop || crashWorld) && r.chance(0.05 * dt)) this.forget(p);
      }
      for (const p of newOnes) this.secede(p);
    }
    forget(p) {
      const minEra = p.popSum < 0.2 * p.peakPop ? 6 : 7;
      let best = -1;
      for (let i = NT - 1; i >= 0; i--) {
        if (!p.known[i] || TECH[i][2] < minEra) continue;
        // 다른 아는 기술의 바탕이 되는 기술은 마지막에 잃음
        let leaf = true;
        for (let j = 0; j < NT; j++) if (p.known[j] && PRE[j].includes(i)) { leaf = false; break; }
        if (leaf) { best = i; break; }
      }
      if (best < 0) return;
      p.known[best] = 0;
      p.kver = (p.kver || 0) + 1;
      if (!p.lost) p.lost = new Uint8Array(NT);
      p.lost[best] = 1;
      p.tdirty = true;
      const id = TECH[best][0];
      if (id === 'fission' || id === 'elec') { p.nukeChance = false; }
      // 나라 하나가 기술을 잃는 일은 인구가 줄어드는 나라에서 흔함: 25년마다 묶어서 관측 화면의 기록에만 남김 (flushTechLoss).
      // 큰 사건으로 남기는 것은 세계 전체에서 사라졌을 때
      if (p.popSum > 2e7) { (this.lossNow[best] || (this.lossNow[best] = new Set())).add(p.name); this.mark('collapse', p.cap); }
      if (!this.alive.some((q) => q.known[best])) {
        const ft = this.firstTech[id];
        if (ft && !ft.lostAll) this.log(`세계 어느 나라에도 ${TECH[best][1]} 기술이 남지 않았습니다.`, 'disaster');
        if (ft) ft.lostAll = true;
      }
    }
    flushTechLoss() {
      for (let i = 0; i < NT; i++) {
        const who = this.lossNow[i];
        if (!who) continue;
        this.log(who.size === 1 ? `${josa([...who][0], '이', '가')} ${TECH[i][1]} 기술을 잃어버렸습니다.` : `최근 ${who.size}개 나라가 ${TECH[i][1]} 기술을 잃어버렸습니다.`, 'info');
        this.lossNow[i] = null;
      }
      this.lossAt = this.year;
    }
    secede(p) {
      const M = this.map;
      // 수도에서 가장 먼 곳에서 떨어져 나감
      const dist = new Map([[p.cap, 0]]), q = [p.cap];
      let far = p.cap;
      for (let h = 0; h < q.length; h++) {
        const c = q[h];
        for (const n of this.nbrs(c)) if (this.owner[n] === p.id && !dist.has(n)) { dist.set(n, dist.get(c) + 1); q.push(n); far = n; }
      }
      // 연결되지 않은 영토(식민지)는 그대로 독립 후보
      let start = far;
      const orphan = this.landCells.find((c) => this.owner[c] === p.id && !dist.has(c));
      if (orphan !== undefined && this.rng.chance(0.6)) start = orphan;
      const size = Math.max(2, Math.round(p.cells * this.rng.range(0.15, 0.45)));
      const cells = [start], seen = new Set([start]);
      for (let i = 0; i < cells.length && cells.length < size; i++) for (const n of this.nbrs(cells[i])) if (this.owner[n] === p.id && !seen.has(n) && n !== p.cap) { seen.add(n); cells.push(n); }
      if (cells.length >= p.cells - 1) return;
      const dx = M.lon[start] - M.lon[p.cap], dy = M.lat[start] - M.lat[p.cap];
      const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : dy > 0 ? 'n' : 's';
      const colonial = orphan !== undefined && start === orphan;
      const gov = p.known[TI.science] ? (this.rng.chance(0.6) ? 'republic' : 'autocracy') : p.gov === 'empire' ? 'kingdom' : p.gov;
      const name = colonial ? this.polityName(gov) : this.rng.chance(0.55) ? this.polityName(gov, p, dir) : this.polityName(gov);
      let moved = 0;
      for (const c of cells) moved += this.pop[c];
      const n = this.newPolity({ name, gov, cells, known: TECH.filter((_, i) => p.known[i]).map((t) => t[0]), parent: p.id, ty: p.ty });
      n.rp = p.rp * 0.2;
      n.nukeChance = p.nukeChance;
      if (p.lost) n.lost = Uint8Array.from(p.lost);
      // 인구 구조와 에너지 전환은 떨어져 나온 나라도 그대로 이어받음
      for (const key of ['tfr', 'fdev', 'gr', 'dev', 'floor', 'mt', 'clean', 'aiYear', 'golden']) if (p[key] !== undefined) n[key] = p[key];
      const share = p.popSum > 0 ? moved / p.popSum : 0;
      n.peakPop = p.peakPop * share; p.peakPop *= 1 - share;
      if (p.wh > 0 && share > 0.3 && this.rng.chance(share)) { n.wh = Math.round(p.wh * share); p.wh -= n.wh; n.nukes = n.wh > 0; }
      this.cacheTech(n); this.prepPolity(n); this.updKmul(n);
      n.pw = this.power(n);
      p.stab = Math.min(1, p.stab + 0.25);
      if (cells.length >= 4 || colonial) {
        this.log(colonial ? `${josa(n.name, '이', '가')} ${p.name}의 식민 지배에서 독립했습니다.` : `${p.name}에서 ${josa(n.name, '이', '가')} 떨어져 나왔습니다.`);
        this.mark('split', start);
      }
      if (this.rng.chance(0.5)) this.declare(p, n);
    }

    /* 바다 건너 식민 (탈식민 시대 이전까지) */
    colonize(dt) {
      const r = this.rng, M = this.map;
      // 내연 기관과 비행기가 세계에 퍼진 시대(탈식민 시대)에는 새 식민지가 더 생기지 않음
      if (this.knownShare[TI.combust] > 0.3) return;
      for (const p of this.alive) {
        if (!p.known[TI.compass] || !p.coastal || p.known[TI.combust]) continue;
        if (!r.chance(0.02 * dt * 3 * p.aggr * Math.min(2, p.pw / 3e5))) continue;
        // 대상: 기술이 훨씬 뒤처진 해안
        for (let k = 0; k < 30; k++) {
          const c = this.landCells[r.int(0, this.landCells.length - 1)];
          if (!M.coast[c] || this.owner[c] === p.id) continue;
          const o = this.owner[c];
          const gap = o < 0 ? 99 : p.nt - this.pols[o].nt;
          if (gap < 5) continue;
          if (Math.abs(M.lon[c] - M.lon[p.cap]) < 25 && Math.abs(M.lat[c] - M.lat[p.cap]) < 20) continue;
          const cells = [c, ...this.nbrs(c).filter((n) => M.land[n] && (this.owner[n] < 0 || this.owner[n] === o))].slice(0, 4);
          cells.forEach((q) => { this.owner[q] = p.id; });
          this.ownVer++;
          if (!this.reached.ocean) { this.reach('ocean', `${p.name}의 함대가 대양 건너 ${this.regionName(c)}에 닻을 내렸습니다.`); this.mark('ship', c); }
          else if (r.chance(0.3)) this.log(`${josa(p.name, '이', '가')} ${this.regionName(c)}에 식민지를 세웠습니다.`);
          // 낯선 병원균: 면역이 없는 쪽이 큰 피해를 입음
          if (p.known[TI.herd] && (o < 0 ? !(this.tribe[c] & 2) : !this.pols[o].known[TI.herd])) this.epidemicAt(c, 0.6, 7, '바다 건너 들어온 낯선 병원균', true);
          break;
        }
      }
    }
    techCount(p) { return p.nt !== undefined && !p.tdirty ? p.nt : p.known.reduce((a, b) => a + b, 0); }

    /* 사건들 */
    // virgin: 가축과 함께 살아 본 적 없는(면역이 없는) 사람들만 걸리는 병원균. quiet: 기록은 부르는 쪽이 남김. → 죽은 사람 수
    epidemicAt(c0, severity, radius, cause, virgin, quiet) {
      const M = this.map, x0 = c0 % M.W, y0 = (c0 / M.W) | 0;
      let dead = 0;
      for (const c of this.landCells) {
        const dx = Math.min(Math.abs((c % M.W) - x0), M.W - Math.abs((c % M.W) - x0)), dy = ((c / M.W) | 0) - y0;
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;
        const o = this.owner[c];
        const herd = o >= 0 ? this.pols[o].known[TI.herd] : this.tribe[c] & 2;
        const immune = virgin && herd ? 1 : o >= 0 && this.pols[o].known[TI.medicine] ? 0.85 : herd ? 0.3 : 0;
        if (immune >= 1) continue;
        const k = severity * (1 - immune) * (1 - d / (radius + 1));
        dead += this.pop[c] * k;
        this.pop[c] *= 1 - k;
      }
      this.catLoss += dead;
      if (dead > 1e5) { if (!quiet) this.log(`${cause}: 약 ${ppl(dead)}이 목숨을 잃었습니다.`, 'disaster'); this.mark('plague', c0); }
      this.lastCat = { year: this.year, kind: cause };
      return dead;
    }
    /* 세계적 대유행병 (비행기로 이어진 세계) */
    pandemic(kind) {
      const r = this.rng;
      const origin = r.weighted(this.alive, (p) => p.popSum);
      if (!origin) return;
      let base = kind === 'eng' ? Math.exp(r.range(Math.log(0.02), Math.log(0.45))) : kind === 'major' ? Math.exp(r.range(Math.log(0.015), Math.log(0.12))) : Math.exp(r.range(Math.log(0.0005), Math.log(0.006)));
      if (kind === 'eng' && r.chance(0.05)) base = 0.85; // 최악의 경우: 거의 막을 수 없는 병원체
      const mit = this.agiOutcome === 'aligned' ? 0.4 : 1;
      for (const p of this.pols) {
        if (!p.alive) continue;
        const vuln = (p.modern ? 1.45 - 0.9 * p.dev : 1.6) * (p === origin ? 1.4 : 1) * Math.exp(0.35 * WS.clamp(r.normal(), -2.5, 2.5));
        p._pk = Math.min(0.97, base * vuln * mit);
      }
      let dead = 0;
      for (const c of this.landCells) {
        const o = this.owner[c];
        const k = o >= 0 && this.pols[o]._pk !== undefined ? this.pols[o]._pk : Math.min(0.97, base * 1.5 * mit);
        dead += this.pop[c] * k;
        this.pop[c] *= 1 - k;
      }
      const share = dead / Math.max(1, this.earthPop);
      this.pandemics++;
      this.catLoss += dead;
      const what = kind === 'eng' ? `${origin.name}에서 새어 나온 인공 병원체` : `${origin.name}에서 시작된 새로운 전염병`;
      if (share > 0.03) {
        const txt = `${josa(what, '이', '가')} 세계로 퍼져 약 ${ppl(dead)}(인류의 ${Math.round(share * 100)}%)이 목숨을 잃었습니다.`;
        if (!this.reach('pandemic', txt)) this.log(txt, 'disaster');
        this.lastCat = { year: this.year, kind: kind === 'eng' ? '인공 병원체' : '대유행병' };
        this.lastPandemic = this.year;
      } else if (share > 0.0015) this.log(`${josa(what, '이', '가')} 세계로 퍼졌습니다. 약 ${ppl(dead)}이 목숨을 잃었습니다.`, 'disaster');
      this.mark('plague', origin.cap);
    }
    calamities(dt) {
      const r = this.rng, C = this.C;
      // 지역 전염병 (밀집할수록 잦음, 근대 의학 이후 드묾)
      for (const p of this.alive) {
        if (p.popSum < 5e6 || p.known[TI.combust]) continue;
        const dens = p.popSum / Math.max(1, p.area);
        const pr = 0.0002 * dt * Math.min(3, dens / 15) * (p.known[TI.medicine] ? 0.15 : 1) * (p.known[TI.compass] ? 1.6 : 1) * C.disease;
        if (r.chance(pr) && p.cap >= 0) this.epidemicAt(p.cap, r.range(0.12, p.known[TI.medicine] ? 0.15 : 0.4), r.range(4, 14), `${p.name}에서 시작된 역병`);
      }
      // 비행기로 이어진 세계의 대유행병: 자연 발생 + 유전공학으로 만든 병원체
      const conn = this.knownShare[TI.combust];
      if (conn > 0.15) {
        const med = this.knownShare[TI.medicine];
        if (r.chance(0.025 * C.disease * conn * dt)) this.pandemic('minor');
        if (r.chance(0.0045 * C.disease * conn * (1 - 0.5 * med) * dt)) this.pandemic('major');
        // 유전공학 연구소가 있는 곳이면 어디서든 사고나 악용이 가능 (퍼질수록 위험)
        const gene = this.firstTech.gene ? Math.min(1, 0.3 + this.knownShare[TI.gene]) : 0;
        if (gene > 0) {
          const ai = this.agiOutcome === 'aligned' ? 0.35 : this.agiOutcome === 'contained' ? 0.8 : 1 + 0.5 * this.knownShare[TI.ai];
          if (r.chance(0.0028 * C.disease * gene * Math.max(0.05, 1.35 - this.coop) * ai * dt)) this.pandemic('eng');
        }
      }
      // 화산·가뭄 같은 지역 재해
      if (r.chance(0.01 * dt)) {
        const c = this.landCells[r.int(0, this.landCells.length - 1)];
        this.regionK(c, 3, 0.55, 15);
      }
      if (this.winter > 0) { this.winter = Math.max(0, this.winter - (0.12 * this.winter + 0.08) * dt); }
    }
    regionK(c0, rad, mult, years) {
      const M = this.map, x0 = c0 % M.W, y0 = (c0 / M.W) | 0;
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const y = y0 + dy;
        if (y < 0 || y >= M.H || dx * dx + dy * dy > rad * rad) continue;
        const c = y * M.W + ((x0 + dx + M.W) % M.W);
        if (!(this.kmodT[c] > 0)) this.kmodList.push(c);
        this.kmod[c] = mult; this.kmodT[c] = years;
      }
    }
    /* 화면에 잠깐 나타나는 사건 아이콘 (시각 효과만, 난수를 쓰지 않음) */
    mark(kind, c) {
      if (this.headless || c === undefined || c < 0) return;
      const M = this.map;
      this.addFx({ type: 'icon', kind, x: M.lon[c], y: M.lat[c], life: kind === 'nuke' ? 7 : 5 });
      let n = 0;
      for (let i = this.fx.length - 1; i >= 0; i--) if (this.fx[i].type === 'icon' && ++n > 14) this.fx.splice(i, 1);
    }
    addFxCell(c, type, color) {
      if (this.headless) return;
      const M = this.map;
      this.addFx({ type, x: M.lon[c], y: M.lat[c], r: 6, life: 1.5, color });
    }
    agiEvent(p) {
      const r = this.rng, C = this.C;
      this.agiYear = this.year;
      const good = WS.clamp((0.15 + 0.3 * this.coop) / Math.sqrt(Math.max(0.25, C.aiRisk)), 0, 0.95);
      const bad = Math.min(0.9, 0.06 * C.aiRisk * Math.max(0.1, 1.4 - this.coop));
      const u = r.next();
      if (u < bad) this.agiDoom(p, true);
      else if (u < bad + good) this.agiAlign(true);
      else {
        this.agiOutcome = 'contained';
        this.log('초지능은 엄격한 국제 감시 아래 묶여 조금씩만 쓰입니다. 언제든 풀려날 위험이 남아 있습니다. (여러 가능성 중 하나)', 'milestone');
      }
    }
    agiAlign(first) {
      this.agiOutcome = 'aligned';
      for (const q of this.alive) q.golden = true;
      this.longev += 0.004;
      this.log(first ? '초지능은 인류와 목표를 같이했습니다. 질병과 가난이 빠르게 사라집니다. (여러 가능성 중 하나)' : '오랜 감시와 연구 끝에 초지능을 인류의 편으로 만드는 데 성공했습니다.', 'milestone');
      if (!first) this.mark('agi', this.alive.length ? this.alive[0].cap : -1);
    }
    agiDoom(p, first) {
      const r = this.rng;
      this.agiOutcome = 'misaligned';
      const k = r.chance(0.25) ? 0.9995 : r.range(0.5, 0.95);
      for (const c of this.landCells) { this.catLoss += this.pop[c] * k; this.pop[c] *= 1 - k; }
      this.offworld *= 1 - k * 0.8;
      this.log(`${first ? '' : '감시를 받던 '}초지능이 통제를 벗어났습니다. 세계 인구의 ${Math.round(k * 1000) / 10}%가 사라졌습니다. (여러 가능성 중 하나)`, 'disaster');
      this.lastCat = { year: this.year, kind: '통제를 벗어난 초지능' };
      if (p && p.cap >= 0) this.mark('agi', p.cap);
    }
    coopTarget() {
      let demo = 0, net = 0, trade = 0, warN = 0;
      for (const p of this.alive) {
        if (p.gov === 'democracy') demo += p.popSum;
        if (p.known[TI.internet]) net += p.popSum;
        if (p.known[TI.compass]) trade += p.popSum;
        if (p.wars.size) warN++;
      }
      const W = Math.max(1, this.earthPop), C = this.C;
      let stress = 0;
      for (const p of this.alive) stress += p.stress * p.popSum;
      const s = 0.1 + 0.2 * (demo / W) + 0.12 * (net / W) + 0.12 * (trade / W) * Math.min(1.5, Math.sqrt(C.trade))
        - 0.4 * warN / Math.max(1, this.alive.length) - 0.3 * stress / W + (this.agiOutcome === 'aligned' ? 0.15 : 0) + (this.year - this.lastNuke < 40 ? 0.1 : 0);
      return s + this.zeit + C.coop;
    }
    initClimate() {
      this.emissions(0);
      const Teq = this.Teq();
      if (this.epoch.temp !== undefined) { this.Tf = 0.72 * Teq; this.Ts = this.epoch.temp - this.Tf; }
      else { this.Tf = 0.72 * Teq; this.Ts = 0.28 * Teq; }
    }
    /* 평형 기온: CO₂ + 메탄 등 다른 온실가스(농업·인구에 비례) − 화석 연료 미세먼지의 냉각 효과 */
    Teq() { return this.ecs * Math.log2(this.co2 / 280) + 0.35 * Math.min(1.4, this.earthPop / 8.2e9) * (this.energyUse > 0.3 ? 1 : this.energyUse / 0.3) - 0.08 * this.emis; }
    emissions(dt) {
      const C = this.C;
      let Ed = 0, Et = 0;
      for (const p of this.alive) {
        if (!p.energy) continue;
        const dev = p.dev || 0;
        const cap = p.cleanCap;
        if (p.clean === undefined) p.clean = 0;
        if (dt > 0) {
          if (cap > p.clean) {
            // 청정 에너지 전환은 S자 곡선: 협력, 소득, 평화가 빠르게 함
            const a = 0.028 * (0.5 + this.coop) * (0.6 + 0.6 * dev) * (p.wars.size ? 0.6 : 1) * (this.agiOutcome === 'aligned' ? 3 : 1) * (p.gov === 'autocracy' ? 0.85 : 1);
            p.clean = Math.min(cap, p.clean + a * (p.clean + 0.02) * (cap - p.clean) * dt);
          } else if (p.clean > cap + 0.05) p.clean += (cap - p.clean) * (1 - Math.exp(-0.05 * dt));
        }
        const e = (p.popSum / 1e9) * E_SCALE * (p.energy / 2.5) * (0.12 + Math.pow(dev, 1.4));
        Et += e; Ed += e * (1 - p.clean);
      }
      this.emis = Ed; this.energyUse = Et;
    }
    updateDamage(force) {
      const Tc = this.Tf + this.Ts;
      if (!force && Math.abs(Tc - this._dmgT) < 0.01 && this.slr === this._dmgS) return;
      const M = this.map, x = Math.max(0, Tc - 1), hw = M._hw, lc = this.lc;
      for (let k = 0; k < lc.length; k++) {
        const c = lc[k], w = hw[c];
        let d = w >= 0 ? 0.05 * w * x * x : 0.03 * w * x;
        if (M.coast[c]) d += 0.03 * x + 0.25 * this.slr;
        this.dmg[c] = WS.clamp(d, -0.15, 0.9);
      }
      this._dmgT = Tc; this._dmgS = this.slr;
    }
    globalSystems(dt) {
      const r = this.rng, C = this.C;
      // 협력 지수: 민주 국가, 인터넷, 무역, 전쟁, 그리고 시대 분위기
      this.zeit += -0.03 * this.zeit * dt + 0.025 * Math.sqrt(dt) * r.normal();
      this.fertZ += -0.006 * this.fertZ * dt + 0.022 * Math.sqrt(dt) * r.normal();
      this.coop += (WS.clamp(this.coopTarget(), 0, 1) - this.coop) * Math.min(1, 0.08 * dt);
      // 에너지와 탄소
      this.emissions(dt);
      const removal = this.agiOutcome === 'aligned' ? 0.8 * WS.clamp((this.co2 - 300) / 100, 0, 1) : 0;
      this.co2 += (0.6 * this.emis + this.tipRate - 0.005 * (this.co2 - 280) - removal) * dt;
      this.co2 = Math.max(250, this.co2);
      // 기온: 빨리 반응하는 상자(대기·표층 바다)와 느린 상자(심해)
      const Teq = this.Teq();
      this.Tf += (0.72 * Teq - this.Tf) * (1 - Math.exp(-dt / 4));
      this.Ts += (0.28 * Teq - this.Ts) * (1 - Math.exp(-dt / 160));
      // 되돌릴 수 없는 문턱 (티핑 포인트)
      const T = this.Tf + this.Ts;
      if (!this.tips.perma && T > this.tipT && r.chance(Math.min(0.5, 0.04 * (T - this.tipT) * dt))) {
        this.tips.perma = this.year; this.tipLeft = r.range(60, 120); this.tipRate = r.range(0.6, 1.4);
        this.log('녹아내린 영구동토에서 메탄과 이산화탄소가 쏟아져 나오기 시작했습니다. 이제 사람이 배출을 멈춰도 한동안 더워집니다.', 'disaster');
        this.mark('climate', this.cellNear(100, 66));
      }
      if (this.tipLeft > 0) { this.tipLeft -= dt; if (this.tipLeft <= 0) this.tipRate = 0; }
      if (!this.tips.ice && T > this.tipT + 0.6 && r.chance(Math.min(0.5, 0.025 * (T - this.tipT - 0.6) * dt))) {
        this.tips.ice = this.year;
        this.log('서남극과 그린란드의 빙상이 무너지기 시작했습니다. 바다가 수백 년에 걸쳐 몇 미터 높아집니다.', 'disaster');
        this.mark('climate', this.cellNear(-42, 70));
      }
      if (this.tips.ice) this.slr = Math.min(1, this.slr + 0.006 * dt);
      this.updateDamage(false);
      // 초지능 이후
      if (this.agiOutcome === 'contained') {
        const brk = 0.0004 * C.aiRisk * Math.max(0.1, 1.4 - this.coop) * dt, ok = 0.0025 * (0.5 + this.coop) * dt;
        const u = r.next();
        if (u < brk) this.agiDoom(this.alive.find((p) => p.known[TI.agi]), false);
        else if (u < brk + ok) this.agiAlign(false);
      }
      this.longev *= Math.exp(-dt / 50);
      // 우주 정착
      if (this.firstTech.mars && this.offworld > 0) {
        const support = this.earthPop > 0.5 * this.crashRef && this.knownShare[TI.space] > 0.05 ? 1 : 0;
        const capW = this.agiOutcome === 'aligned' ? 2e10 : 2e9;
        const self = this.offworld > 2e5;
        const nat = support || self ? 0.025 : -0.05;
        this.offworld = Math.max(0, this.offworld + (this.offworld * nat * (1 - this.offworld / capW) + support * 300 * (this.agiOutcome === 'aligned' ? 3 : 1)) * dt);
        if (this.offworld < 10) this.offworld = 0;
      }
      this.settleStep();
      this.crashRef = Math.max(this.crashRef * Math.exp(-0.004 * dt), this.worldPop);
      this.catLoss *= Math.exp(-0.02 * dt);
      // 최근 인구 증가율 (해설용, 동역학에는 쓰지 않음)
      const gNow = this._lastPop > 0 && this.worldPop > 0 ? Math.log(this.worldPop / this._lastPop) / dt : 0;
      this.popRate = this.popRate === undefined ? gNow : this.popRate + (gNow - this.popRate) * Math.min(1, 0.25 * dt);
      this._lastPop = this.worldPop;
    }
    /* 정착지 기록: 지구 밖 인구를 읽기만 하고 동역학에는 되먹이지 않습니다. 각 천체의 인구는 지금 상태만으로 다시 계산하므로 합이 늘 offworld와 같습니다 */
    settleStep() {
      const S = this.settle, y = this.year, off = this.offworld;
      if (this.firstTech.star && !S.star) {
        const t = S.starPick;
        S.star = { target: t.target, ly: t.ly, year: y, speedC: t.speedC, arrive: y + t.ly / t.speedC };
        this.log(`우주선의 목적지는 ${t.target}입니다. ${WS.trimNum(t.ly)}광년 떨어져 있어 약 ${Math.round(t.ly / t.speedC).toLocaleString('ko-KR')}년 뒤에 닿습니다.`, 'milestone').soft = true;
      }
      if (!this.firstTech.mars || S.allLost) return;
      if (off <= 0) {
        if (!S.list.length) return;
        S.allLost = true;
        for (const e of S.list) { e.lost = y; e.pop = 0; }
        this.log(`${S.out} 정착지가 모두 사라졌습니다.`, 'milestone').soft = true;
        return;
      }
      if (!S.list.length) this.settleFound(S.dest.find((d) => d.id === S.plannedFirst), true);
      const div = this.agiOutcome === 'aligned' ? 3 : 1, y0 = S.list[0].since;
      if (S.list.length < S.dest.length) for (const d of S.dest) {
        if (off >= S.gates[d.id] / div && y - y0 >= S.lags[d.id] && !S.list.some((e) => e.id === d.id)) this.settleFound(d, false);
      }
      let tot = 0;
      for (const e of S.list) { e.w = S.weights[e.id] * (1 - Math.exp(-(y - e.since + 1) / 40)); tot += e.w; } // +1: 세운 해에도 몫이 0이 되지 않게
      for (const e of S.list) e.pop = (off * e.w) / tot;
    }
    settleFound(d, first) {
      const S = this.settle;
      if (first) S.firstId = d.id;
      S.list.push({ id: d.id, bodyId: d.bodyId, name: d.name, since: this.year, first, lost: false, pop: 0, w: 0 });
      this.log((first && d.first) || d.next || d.first, 'milestone').soft = true; // 실험실 연대기가 40줄 제한에 세지 않음
    }
    cleanShare() {
      let a = 0, b = 0;
      for (const p of this.alive) if (p.energy) { a += (p.clean || 0) * p.popSum; b += p.popSum; }
      return b ? a / b : 0;
    }
    cellNear(lo, la) {
      const M = this.map;
      if (!M.earth) return this.landCells[0];
      let best = -1, bd = 1e9;
      for (const c of this.landCells) { const d = (M.lon[c] - lo) ** 2 + (M.lat[c] - la) ** 2; if (d < bd) { bd = d; best = c; } }
      return best;
    }

    checkMilestones() {
      const wp = this.worldPop, T = this.Tanom();
      if (wp >= 1e9) this.reach('pop1b', '세계 인구가 10억 명을 넘었습니다.');
      if (wp >= 8e9) this.reach('pop8b', '세계 인구가 80억 명을 넘었습니다.');
      if (T > 2 && !this.reached.warm2) { this.reach('warm2', '지구 평균 기온이 산업화 이전보다 2°C 올랐습니다. 폭염과 가뭄이 잦아집니다.'); this.mark('climate', this.cellNear(20, 12)); }
      if (T > 3 && !this.reached.warm3) { this.reach('warm3', '기온 상승이 3°C를 넘었습니다. 열대의 농사가 크게 흔들리고 해안이 물에 잠기기 시작합니다.'); this.mark('climate', this.cellNear(78, 20)); }
      if (T > 4 && !this.warm4) { this.warm4 = true; this.log('기온 상승이 4°C를 넘었습니다. 열대의 많은 곳이 사람이 살기 힘든 땅이 됩니다.', 'disaster'); }
      this.checkPeak(false);
      if (this.year - this.lossAt >= 25) this.flushTechLoss();
      // 붕괴: 재앙으로 많은 사람이 죽어 인구가 짧은 기간에 절반 아래로 (출산율이 낮아 서서히 줄어드는 것은 붕괴가 아님)
      if (wp < 0.5 * this.crashRef && this.catLoss > 0.2 * this.crashRef && !this.collapsed) {
        this.collapsed = true;
        const txt = `세계 인구가 짧은 기간에 절반 아래로 줄었습니다. 문명이 무너지는 시기입니다.${this.lastCat ? ' (' + this.lastCat.kind + ')' : ''}`;
        if (!this.reach('collapse', txt)) this.log(txt, 'disaster');
        if (this.alive.length) this.mark('collapse', this.alive.reduce((a, b) => (b.popSum > a.popSum ? b : a)).cap);
      }
      if (this.collapsed && (wp > 0.8 * this.crashRef || this.catLoss < 0.05 * this.crashRef)) { this.collapsed = false; this.log('가장 어두운 시기가 지나고 세계가 다시 안정을 찾아 가고 있습니다.', 'milestone'); }
      const tn = this.techNow();
      if (tn > this.maxTechEver) this.maxTechEver = tn;
      const reg = this.maxTechEver >= 20 && tn <= this.maxTechEver - 3;
      if (reg && !this.regressed) {
        this.regressed = true;
        if (!this.reach('collapse', '가장 앞선 나라마저 여러 핵심 기술을 잃었습니다. 문명이 뒷걸음질합니다.')) this.log('가장 앞선 나라마저 여러 핵심 기술을 잃었습니다.', 'disaster');
      }
      if (this.regressed && tn >= this.maxTechEver - 1) this.regressed = false;
    }
    /* 세계 인구 정점: 인구가 최고치보다 5% 넘게 적은 채 20년이 지나면(또는 관측이 끝날 때 그 상태면) 그 최고치를 정점으로 기록합니다.
       사건의 시각은 알아챈 해가 아니라 실제로 가장 많았던 해입니다. 재난 뒤 인구가 그 기록을 다시 넘어서면 정점이 아니었으므로 기록을 지웁니다.
       (이 기록은 글과 실험 통계에만 쓰이고 세계의 동역학에는 영향을 주지 않습니다) */
    checkPeak(final) {
      const rec = this.reached.peak;
      if (rec) {
        if (this.popPeakYear <= rec.v) return;
        delete this.reached.peak;
        this.peakAgain = true;
      }
      if (this.popPeak < 3e9 || this.worldPop >= 0.95 * this.popPeak) return;
      if (!final && this.year - this.popPeakYear < 20) return;
      const y = this.popPeakYear, when = this.alien ? this.labelAt(y) : `${Math.round(y)}년`;
      const after = (this.popRate || 0) < 0 ? '그 뒤로 줄어들고 있습니다' : '그 뒤로 아직 그 수준을 되찾지 못했습니다';
      this.reach('peak', this.peakAgain ? `세계 인구가 다시 늘어 ${when} 약 ${ppl(this.popPeak)}으로 새 정점을 찍었습니다. ${after}.` : `세계 인구는 ${when} 약 ${ppl(this.popPeak)}이 정점이었습니다. ${after}.`);
      this.reached.peak = { v: y, label: this.labelAt(y) };
    }
    checkEnd() {
      const gone = this.worldPop < 1e4 && this.year > this.startYear + 10, star = this.firstTech.star, over = this.year >= this.endYear;
      if (!gone && !star && !over) return;
      this.checkPeak(true);
      this.flushTechLoss();
      if (gone) { this.end('인류 멸종', `${this.lastCat ? this.lastCat.kind + ' 이후 ' : ''}남은 사람들도 버티지 못했습니다.`, OUT.extinct.label); return; }
      if (star) { this.end('항성 간 문명', `${this.timeLabel()}, ${this.alien ? `${this.speciesName || '이 문명'}의 후손` : '인류의 후손'}이 다른 별로 떠났습니다.`, OUT.interstellar.label); return; }
      const label = this.outcomeText();
      this.end('관측 종료', `${this.timeLabel()}, 이 세계의 결말은 「${label}」입니다. 인구 ${ppl(this.worldPop)}, 나라 ${this.alive.length}개, 기온 ${fmtT(this.Tanom())}.`, label);
    }
    classify() {
      if (this.worldPop < 1e4) return 'extinct';
      if (this.agiOutcome === 'misaligned') return 'aidoom';
      if (this.collapsed || this.regressed || (this.worldPop < 0.5 * this.crashRef && this.catLoss > 0.1 * this.crashRef)) return 'collapse';
      if (this.firstTech.star) return 'interstellar';
      if (this.offworld >= 1e5) return 'multiplanet';
      if (this.agiOutcome === 'aligned' || this.agiOutcome === 'contained') return 'aiage';
      if (this.Tanom() > 3 || this.year - this.lastNuke < 60) return 'strained';
      if (this.alive.some((p) => p.known[TI.steam])) return 'industrial';
      if (this.pols.length || this.landCells.some((c) => this.tribe[c] & 1)) return 'agrarian';
      return 'forager';
    }
    outcomeText() { return OUT[this.classify()].label; }
  }

  const E_SCALE = 1.0; // 2026년 세계 배출이 약 5.3 ppm/년(이산화탄소 약 410억 톤)이 되도록 맞춘 크기
  const REGIONS = [
    ['메소포타미아', 38, 50, 28, 38], ['나일강 유역', 28, 35, 15, 32], ['인더스강 유역', 65, 77, 22, 35], ['갠지스강 유역', 77, 92, 20, 30], ['황허 유역', 104, 120, 32, 41], ['양쯔강 유역', 104, 123, 24, 32],
    ['한반도', 124, 131, 33, 43], ['일본 열도', 129, 146, 30, 46], ['동남아시아', 92, 125, -11, 22], ['인도 남부', 72, 88, 6, 22], ['이란 고원', 44, 63, 25, 40], ['아라비아', 34, 60, 12, 30],
    ['아나톨리아', 26, 45, 36, 42], ['지중해 유럽', -10, 30, 35, 46], ['서유럽', -10, 15, 46, 60], ['동유럽', 15, 45, 44, 62], ['북유럽', 4, 32, 55, 72], ['시베리아', 45, 180, 50, 80], ['중앙아시아', 50, 90, 35, 55], ['몽골 초원', 90, 125, 41, 52], ['중국 남부', 98, 122, 18, 26],
    ['북아프리카', -18, 38, 15, 37], ['서아프리카', -18, 15, 0, 15], ['동아프리카', 28, 52, -12, 15], ['중앙아프리카', 10, 32, -12, 8], ['남아프리카', 10, 52, -36, -12],
    ['메소아메리카', -106, -83, 7, 23], ['북아메리카 동부', -95, -60, 25, 50], ['북아메리카 서부', -125, -95, 25, 50], ['캐나다', -142, -52, 50, 72], ['안데스', -82, -63, -35, 5], ['아마존', -75, -45, -15, 5], ['남아메리카 남부', -75, -50, -56, -15], ['브라질 해안', -50, -34, -30, -2],
    ['오스트레일리아', 112, 155, -45, -10], ['뉴기니', 130, 152, -11, 0],
    // 위의 상자들 사이에 남는 땅 (거친 지명)
    ['알래스카', -180, -142, 50, 72], ['캐나다 북쪽 섬들', -142, -60, 72, 85], ['북아메리카 동부', -60, -50, 40, 50], ['아이슬란드', -25, -12, 62, 68], ['그린란드', -60, -15, 59, 85],
    ['멕시코 북부', -118, -90, 23, 25], ['중앙아메리카', -83, -78, 7, 10], ['남아메리카 북부', -82, -50, 5, 13], ['카리브해', -90, -60, 13, 25],
    ['사하라 남쪽', 15, 28, 8, 15], ['러시아 북부', 32, 45, 62, 72], ['카스피해 연안', 40, 50, 40, 50], ['인더스강 유역', 63, 72, 20, 36], ['티베트 고원', 77, 104, 30, 41], ['중국 서남부', 92, 104, 22, 30],
    ['동남아시아', 125, 130, -11, 22], ['황허 유역', 120, 124, 32, 41], ['만주와 연해주', 124, 150, 43, 50], ['뉴질랜드', 165, 180, -50, -30],
  ];
  const fmtT = (T) => { const t = T.toFixed(1); return `${t === '0.0' || t === '-0.0' ? '0.0' : T > 0 ? '+' + t : t}°C`; };

  // 달력 표기: 세계의 해 -y는 곧 '기원전 y년'입니다 (출발점 이름, 실제 역사 표식, 실험실 표가 모두 이 셈을 씀). 시작 화면은 '기원전 1만 년'
  const bcText = (a) => (a % 10000 === 0 ? `기원전 ${a / 10000}만 년` : `기원전 ${a}년`);
  const yearText = (y) => { y = Math.round(y); return y < 0 ? bcText(-y) : `${y}년`; };
  const calText = (y) => { y = Math.round(y); return y < 0 ? bcText(-y) : `서기 ${Math.max(1, y)}년`; }; // 달력에는 0년이 없음
  const ppl = (n) => (WS.fmtCount(n) + ' 명').replace(/(\d) 명$/, '$1명'); // '4.39만 명'은 띄우고 '134명'은 붙임
  const pct = (v) => `${Math.round(v * 100)}%`;
  // 개입의 크기를 알 수 있게: '약 9,099만 명(인류의 1.1%)'
  const tollText = (s, dead) => { const v = (dead / Math.max(1, s.earthPop)) * 100; return `약 ${ppl(dead)}(${s.alien ? '전체' : '인류'}의 ${v >= 10 ? Math.round(v) + '%' : v >= 0.1 ? v.toFixed(1) + '%' : '0.1% 미만'})`; };
  const topPolity = (s) => { let t = null; for (const p of s.alive) if (!t || p.popSum > t.popSum) t = p; return t; };
  const warCount = (s) => { let n = 0; for (const p of s.alive) n += p.wars.size; return n / 2; };
  const eraOf = (s, p) => ERA[Math.min(ERA.length - 1, polEraIndex(s, p))];

  /* ---------- 그리기 ---------- */
  const LAT_TOP = 80, LAT_BOT = -58;
  const ERA_COL = [[96, 92, 80], [150, 132, 86], [176, 138, 74], [190, 120, 70], [186, 98, 92], [170, 94, 140], [120, 108, 190], [86, 136, 214], [70, 176, 210], [96, 210, 190], [130, 222, 176], [170, 230, 160], [240, 240, 200]];
  const ICON_COL = { war: '#e46a4e', nuke: '#f2c14e', nukeown: '#f2c14e', plague: '#a6d86f', discovery: '#84c6d2', space: '#aab8ff', agi: '#b79cff', climate: '#ff8f4a', collapse: '#cfc6b8', split: '#f1cb86', state: '#f1cb86', ship: '#84c6d2' };

  // 밀러 도법: 고위도를 조금 늘여 지도를 더 크게, 모양은 덜 일그러지게
  const millerY = (la) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * (WS.clamp(la, -89.9, 89.9) * Math.PI) / 180));
  const millerInv = (y) => ((2.5 * Math.atan(Math.exp(y / 1.25)) - 0.625 * Math.PI) * 180) / Math.PI;
  function view(s, W, H, safe) {
    const M = s.map;
    const latTop = M.earth ? LAT_TOP : 90, latBot = M.earth ? LAT_BOT : -90;
    const yT = millerY(latTop), yB = millerY(latBot);
    const aspect = (2 * Math.PI) / (yT - yB);
    const pad = W < 520 ? 6 : 12;
    const st = safe ? safe.top || 0 : 0, sb = safe ? safe.bottom || 0 : 0;
    const fullH = H - pad * 2;
    // 해설 카드·범례가 덮는 위아래를 피하되, 지도가 너무 작아지지는 않게 (모서리는 대개 바다)
    const bandH = Math.max(fullH * 0.8, fullH - st - sb);
    const w = Math.max(200, Math.min(W - pad * 2, bandH * aspect)), h = w / aspect;
    const x0 = Math.round((W - w) / 2);
    const top = pad + st, bot = H - pad - sb;
    let y0 = Math.round(top + (bot - top - h) / 2);
    y0 = WS.clamp(y0, pad, Math.max(pad, H - pad - h));
    const X = (lo) => x0 + ((lo + 180) / 360) * w;
    const Y = (la) => y0 + ((yT - millerY(la)) / (yT - yB)) * h;
    const LA = (y) => millerInv(yT - ((y - y0) / h) * (yT - yB));
    // 격자 행 경계의 화면 y (행 j의 위쪽 = 위도 90 - j·칸높이)
    const dy = 180 / M.H, rowY = new Float64Array(M.H + 1);
    for (let j = 0; j <= M.H; j++) rowY[j] = Y(WS.clamp(90 - j * dy, latBot, latTop));
    return { x0, y0, w, h, X, Y, LA, rowY, latTop, latBot, k: w / 360, key: `${W}x${H}:${x0},${y0},${Math.round(w)}` };
  }
  /* 등장방형(위도 균등) 그림을 밀러 도법 화면으로 옮겨 그리기: 가는 띠로 나눠 늘임 */
  function drawProjected(g, img, V, latTop, latBot) {
    const n = Math.max(24, Math.round(img.height / 4));
    for (let i = 0; i < n; i++) {
      const sy0 = (i * img.height) / n, sy1 = ((i + 1) * img.height) / n;
      const la0 = latTop - (sy0 / img.height) * (latTop - latBot), la1 = latTop - (sy1 / img.height) * (latTop - latBot);
      const y0 = V.Y(la0), y1 = V.Y(la1);
      g.drawImage(img, 0, sy0, img.width, sy1 - sy0, V.x0, y0, V.w, y1 - y0 + 0.6);
    }
  }
  function landPath(s, V) {
    const M = s.map;
    if (!M.earth) return null;
    if (M._lp && M._lpKey === V.key) return M._lp;
    const p = new Path2D();
    for (const pts of M.polys) {
      p.moveTo(V.X(pts[0][0]), V.Y(pts[0][1]));
      for (let i = 1; i < pts.length; i++) p.lineTo(V.X(pts[i][0]), V.Y(pts[i][1]));
      p.closePath();
    }
    M._lp = p; M._lpKey = V.key;
    return p;
  }
  /* 지형 질감: 기후로 정한 생물군계 색 + 산줄기 음영 (지도마다 한 번만 계산) */
  function biomeCol(t, r) {
    const dry = 1 - WS.smooth(0.08, 0.6, r);
    const warm = WS.smooth(-8, 26, t);
    const wet = WS.ramp([[138, 142, 128], [58, 84, 64], [72, 106, 66], [40, 92, 54]], warm);
    const arid = WS.ramp([[150, 146, 126], [160, 150, 106], [194, 166, 116]], warm);
    let col = WS.mix(wet, arid, dry * dry * (3 - 2 * dry));
    const ice = 1 - WS.smooth(-16, -5, t);
    if (ice > 0) col = WS.mix(col, [214, 222, 230], ice);
    return col;
  }
  function terrainTex(M) {
    if (M._tex) return M._tex;
    const latTop = M.earth ? LAT_TOP : 90, latBot = M.earth ? LAT_BOT : -90;
    const TW = 960, TH = Math.round((TW * (latTop - latBot)) / 360);
    const W = M.W, H = M.H, NC = M.NC;
    // 바다 칸에도 이웃 땅의 기후를 번져 놓아 해안선 색이 부드럽게 이어지게
    const T = Float32Array.from(M.temp), R = Float32Array.from(M.rain || M.fert);
    let known = Uint8Array.from(M.land);
    for (let pass = 0; pass < 5; pass++) {
      const nk = known.slice();
      for (let c = 0; c < NC; c++) {
        if (known[c]) continue;
        const x = c % W, y = (c / W) | 0;
        let n = 0, st = 0, sr = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          const q = yy * W + ((x + dx + W) % W);
          if (known[q]) { n++; st += T[q]; sr += R[q]; }
        }
        if (n) { T[c] = st / n; R[c] = sr / n; nk[c] = 1; }
      }
      known = nk;
    }
    const samp = (A, lo, la) => {
      const fx = ((lo + 180) / 360) * W - 0.5, fy = ((90 - la) / 180) * H - 0.5;
      const x0 = Math.floor(fx), y0 = WS.clamp(Math.floor(fy), 0, H - 1), y1 = Math.min(H - 1, y0 + 1);
      const tx = fx - x0, ty = WS.clamp(fy - y0, 0, 1);
      const xa = (x0 + W) % W, xb = (x0 + 1 + W) % W;
      return (A[y0 * W + xa] * (1 - tx) + A[y0 * W + xb] * tx) * (1 - ty) + (A[y1 * W + xa] * (1 - tx) + A[y1 * W + xb] * tx) * ty;
    };
    // 높이: 지구는 산줄기 자료, 외계 행성은 이어받은 고도
    const RW = 240, RH = Math.round(RW * (latTop - latBot) / 360);
    const rel = new Float32Array(RW * RH);
    let eMin = 0, eMax = 1;
    if (!M.earth && M.elev) { eMin = Infinity; eMax = -Infinity; for (let c = 0; c < NC; c++) if (M.land[c]) { eMin = Math.min(eMin, M.elev[c]); eMax = Math.max(eMax, M.elev[c]); } if (!(eMax > eMin)) { eMin = 0; eMax = 1; } }
    for (let j = 0; j < RH; j++) for (let i = 0; i < RW; i++) {
      const lo = -180 + ((i + 0.5) / RW) * 360, la = latTop - ((j + 0.5) / RH) * (latTop - latBot);
      rel[j * RW + i] = M.earth ? WS.Earth.relief(lo, la) : WS.clamp((samp(M.elev, lo, la) - eMin) / (eMax - eMin), 0, 1) * 0.8;
    }
    const relAt = (px, py) => {
      const fx = (px / TW) * RW - 0.5, fy = WS.clamp((py / TH) * RH - 0.5, 0, RH - 1.001);
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const xa = (x0 + RW) % RW, xb = (x0 + 1) % RW, y1 = Math.min(RH - 1, y0 + 1);
      return (rel[y0 * RW + xa] * (1 - tx) + rel[y0 * RW + xb] * tx) * (1 - ty) + (rel[y1 * RW + xa] * (1 - tx) + rel[y1 * RW + xb] * tx) * ty;
    };
    const nz = new WS.Noise(M.earth ? 2026 : 77);
    const hb = new Float32Array(TW * TH);
    for (let py = 0; py < TH; py++) for (let px = 0; px < TW; px++) {
      const lo = -180 + ((px + 0.5) / TW) * 360, la = latTop - ((py + 0.5) / TH) * (latTop - latBot);
      hb[py * TW + px] = relAt(px, py) * (0.85 + 0.3 * nz.n3(lo * 0.11, la * 0.11, 3.3)) + 0.05 * nz.fbm(lo * 0.09, la * 0.09, 1.7, 2);
    }
    const cv = document.createElement('canvas');
    cv.width = TW; cv.height = TH;
    const g = cv.getContext('2d');
    const img = g.createImageData(TW, TH), d = img.data;
    const L = M.earth ? null : Float32Array.from(M.land);
    const shc = document.createElement('canvas');
    shc.width = TW; shc.height = TH;
    const shImg = shc.getContext('2d').createImageData(TW, TH), sd = shImg.data;
    for (let py = 0; py < TH; py++) for (let px = 0; px < TW; px++) {
      const lo = -180 + ((px + 0.5) / TW) * 360, la = latTop - ((py + 0.5) / TH) * (latTop - latBot);
      const h = hb[py * TW + px];
      const hx = hb[py * TW + Math.max(0, px - 1)] - hb[py * TW + Math.min(TW - 1, px + 1)];
      const hy = hb[Math.max(0, py - 1) * TW + px] - hb[Math.min(TH - 1, py + 1) * TW + px];
      const shade = WS.clamp((hx * 0.8 + hy * 1.1) * 7, -0.4, 0.4); // 북서쪽에서 비치는 빛
      let col = biomeCol(samp(T, lo, la) - h * 14, samp(R, lo, la));
      const rock = WS.smooth(0.35, 0.9, h);
      if (rock > 0) col = WS.mix(col, [128, 120, 110], rock * 0.55);
      const k = 0.8 * (1 + shade);
      const o = (py * TW + px) * 4;
      d[o] = col[0] * k; d[o + 1] = col[1] * k; d[o + 2] = col[2] * k;
      d[o + 3] = L ? Math.round(255 * WS.smooth(0.4, 0.6, samp(L, lo, la))) : 255;
      const sv = shade > 0 ? 255 : 0, sa = shade > 0 ? shade * 0.35 : -shade * 0.5;
      sd[o] = sv; sd[o + 1] = sv; sd[o + 2] = sv; sd[o + 3] = Math.round(255 * Math.min(0.3, sa) * (L ? d[o + 3] / 255 : 1));
    }
    g.putImageData(img, 0, 0);
    shc.getContext('2d').putImageData(shImg, 0, 0);
    M._shadeTex = shc;
    M._tex = cv;
    return cv;
  }
  function baseLayer(s, V, W, H, dpr) {
    const M = s.map, key = V.key + '@' + dpr;
    if (M._base && M._baseKey === key) return M._base;
    const cv = document.createElement('canvas');
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 바다
    const og = g.createLinearGradient(0, V.y0, 0, V.y0 + V.h);
    og.addColorStop(0, '#0a1424'); og.addColorStop(0.5, '#0d1c30'); og.addColorStop(1, '#091321');
    g.fillStyle = og;
    g.fillRect(V.x0, V.y0, V.w, V.h);
    // 경위선
    g.strokeStyle = 'rgba(150,180,210,0.07)';
    g.lineWidth = 1;
    g.beginPath();
    for (let lo = -150; lo < 180; lo += 30) { g.moveTo(Math.round(V.X(lo)) + 0.5, V.y0); g.lineTo(Math.round(V.X(lo)) + 0.5, V.y0 + V.h); }
    for (let la = -30; la <= 60; la += 30) { g.moveTo(V.x0, Math.round(V.Y(la)) + 0.5); g.lineTo(V.x0 + V.w, Math.round(V.Y(la)) + 0.5); }
    g.stroke();
    g.strokeStyle = 'rgba(216,168,91,0.10)';
    g.beginPath(); g.moveTo(V.x0, Math.round(V.Y(0)) + 0.5); g.lineTo(V.x0 + V.w, Math.round(V.Y(0)) + 0.5); g.stroke();
    const tex = terrainTex(M);
    const lp = landPath(s, V);
    const lt = M.earth ? LAT_TOP : 90, lb = M.earth ? LAT_BOT : -90;
    // 지형을 화면 도법으로 한 번 옮겨 둠
    const pt = document.createElement('canvas');
    pt.width = cv.width; pt.height = cv.height;
    const pg = pt.getContext('2d');
    pg.setTransform(dpr, 0, 0, dpr, 0, 0);
    pg.imageSmoothingEnabled = true;
    drawProjected(pg, tex, V, lt, lb);
    g.save();
    g.beginPath(); g.rect(V.x0, V.y0, V.w, V.h); g.clip();
    // 대륙붕: 해안 둘레의 밝은 바다
    g.shadowColor = 'rgba(70,150,180,0.55)';
    g.shadowBlur = Math.max(6, 12 * V.k * 2.5);
    if (lp) { g.fillStyle = '#17344c'; g.fill(lp); } else g.drawImage(pt, 0, 0, W, H);
    g.restore();
    g.save();
    g.beginPath(); g.rect(V.x0, V.y0, V.w, V.h); g.clip();
    if (lp) g.clip(lp);
    g.drawImage(pt, 0, 0, W, H);
    g.restore();
    // 나라 색 위에 다시 얹을 산 그림자
    const sc = document.createElement('canvas');
    sc.width = cv.width; sc.height = cv.height;
    const sg = sc.getContext('2d');
    sg.setTransform(dpr, 0, 0, dpr, 0, 0);
    sg.save();
    sg.beginPath(); sg.rect(V.x0, V.y0, V.w, V.h); sg.clip();
    if (lp) sg.clip(lp);
    drawProjected(sg, M._shadeTex, V, lt, lb);
    sg.restore();
    M._shadeScr = sc;
    if (lp) {
      g.save();
      g.beginPath(); g.rect(V.x0, V.y0, V.w, V.h); g.clip();
      g.strokeStyle = 'rgba(236,226,200,0.32)';
      g.lineWidth = 0.8;
      g.stroke(lp);
      g.strokeStyle = 'rgba(120,180,220,0.45)';
      g.lineWidth = 0.9;
      for (const pts of Object.values(M.rivers)) {
        g.beginPath();
        for (let i = 0; i < pts.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, V.X(pts[i]), V.Y(pts[i + 1]));
        g.stroke();
      }
      g.restore();
    }
    M._base = cv; M._baseKey = key;
    return cv;
  }
  /* 이웃한 나라가 같은 색이 되지 않게 (시각용, 동역학과 무관). 겹치는 나라만 바꿔 색이 자주 바뀌지 않음 */
  function recolor(s) {
    const key = s.ownVer + ':' + s.pols.length;
    if (s._rcKey === key) return;
    s._rcKey = key;
    const adj = s.adjacency();
    const order = s.alive.slice().sort((a, b) => b.cells - a.cells || a.id - b.id);
    const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    for (const p of order) {
      const nb = adj.get(p.id);
      if (!nb || !nb.size) continue;
      const used = new Set();
      let clash = false;
      for (const q of nb) { const ci = s.pols[q].ci; used.add(ci); if (dist(PALETTE[ci], PALETTE[p.ci]) < 85) clash = true; }
      if (!clash) continue;
      let best = p.ci, bv = -1;
      for (let i = 0; i < PALETTE.length; i++) {
        if (used.has(i)) continue;
        let m = 1e9;
        for (const q of nb) m = Math.min(m, dist(PALETTE[i], PALETTE[s.pols[q].ci]));
        if (m > bv) { bv = m; best = i; }
      }
      if (best !== p.ci) { p.ci = best; p.color = tint(PALETTE[best], hash32(s.seed, p.id * 3 + 1)); }
    }
    s._layKey = null;
  }
  /* 칸 색 (나라·인구·기술·기후 피해): 격자 해상도의 작은 그림 → 확대해서 또렷하게 */
  function cellLayer(s, vmode) {
    const M = s.map;
    const key = `${s.steps}|${vmode}|${s.ownVer}|${s.year}`;
    if (s._lay && s._layKey === key) return s._lay;
    if (!s._lay) { s._lay = document.createElement('canvas'); s._lay.width = M.W; s._lay.height = M.H; s._layImg = s._lay.getContext('2d').createImageData(M.W, M.H); }
    const img = s._layImg, d = img.data;
    d.fill(0);
    const put = (c, col, a) => { const o = c * 4; d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = Math.round(255 * a); };
    for (const c of s.landCells) {
      const o = s.owner[c], P = s.pop[c];
      if (vmode === 0) {
        if (o >= 0) { const p = s.pols[o]; put(c, s.war[c] ? WS.mix(p.color, [228, 90, 70], 0.28) : p.color, 0.52); }
        else if (P < 1) put(c, [6, 8, 12], 0.22);
        else if (s.tribe[c] & 1) put(c, [206, 190, 120], 0.2);
      } else if (vmode === 1) {
        const dd = P / M.area[c];
        if (P < 1) { put(c, [6, 8, 14], 0.78); continue; }
        const t = WS.clamp((Math.log10(dd) + 1) / 4, 0, 1);
        put(c, WS.ramp([[24, 28, 52], [70, 52, 120], [190, 80, 80], [250, 170, 80], [255, 244, 210]], t), 0.9);
      } else if (vmode === 2) {
        const e = o >= 0 ? polEraIndex(s, s.pols[o]) : s.tribe[c] & 1 ? 1 : 0;
        if (P < 1 && o < 0) { put(c, [6, 8, 12], 0.5); continue; }
        put(c, ERA_COL[Math.min(ERA_COL.length - 1, e)], 0.82);
      } else {
        const v = s.dmg[c];
        if (v < -0.005) put(c, [70, 180, 150], Math.min(0.7, 0.2 - v * 3));
        else if (v > 0.005) put(c, WS.ramp([[236, 214, 120], [244, 150, 64], [214, 66, 50], [120, 18, 42]], WS.clamp(v / 0.6, 0, 1)), Math.min(0.9, 0.3 + v * 2.2));
      }
    }
    s._lay.getContext('2d').putImageData(img, 0, 0);
    s._layKey = key;
    return s._lay;
  }
  /* 국경선: 나라 사이(진한 선), 전선(붉은 선), 부족 땅과의 경계(옅은 선) */
  function borderPaths(s, V) {
    const key = `${s.steps}|${s.ownVer}|${V.key}`;
    if (s._bp && s._bpKey === key) return s._bp;
    const M = s.map, W = M.W, deg = 360 / W, dy = 180 / M.H;
    const intl = new Path2D(), front = new Path2D(), soft = new Path2D();
    const seg = (path, x1, y1, x2, y2) => { path.moveTo(x1, y1); path.lineTo(x2, y2); };
    for (const c of s.landCells) {
      const o = s.owner[c], x = c % W, y = (c / W) | 0;
      const la0 = 90 - y * dy, la1 = la0 - dy;
      if (la1 > V.latTop + dy || la0 < V.latBot - dy) continue;
      const ya = V.rowY[y], yb = V.rowY[y + 1];
      const r = y * W + ((x + 1) % W), dn = c + W;
      const pick = (o2) => (o >= 0 && o2 >= 0 ? (s.pols[o].wars.has(o2) ? front : intl) : soft);
      if (s.isLand[r]) {
        const o2 = s.owner[r];
        if (o2 !== o && (o >= 0 || o2 >= 0)) { const bx = V.X(-180 + (x + 1) * deg); seg(pick(o2), bx, ya, bx, yb); }
      }
      if (dn < M.NC && s.isLand[dn]) {
        const o2 = s.owner[dn];
        if (o2 !== o && (o >= 0 || o2 >= 0)) seg(pick(o2), V.X(-180 + x * deg), yb, V.X(-180 + (x + 1) * deg), yb);
      }
    }
    s._bp = { intl, front, soft }; s._bpKey = key;
    return s._bp;
  }
  /* 나라 이름 자리: 수도 근처 영토의 무게 중심 */
  function labelSpots(s) {
    const key = `${s.ownVer}|${s.alive.length}`;
    if (s._ls && s._lsKey === key) return s._ls;
    const M = s.map, acc = new Map();
    for (const c of s.landCells) {
      const o = s.owner[c];
      if (o < 0) continue;
      const p = s.pols[o];
      if (p.cap < 0) continue;
      let lo = M.lon[c];
      const clo = M.lon[p.cap];
      if (lo - clo > 180) lo -= 360; else if (clo - lo > 180) lo += 360;
      if (Math.abs(lo - clo) > 45 || Math.abs(M.lat[c] - M.lat[p.cap]) > 28) continue;
      let a = acc.get(o);
      if (!a) { a = { x: 0, y: 0, w: 0 }; acc.set(o, a); }
      const w = M.area[c];
      a.x += lo * w; a.y += M.lat[c] * w; a.w += w;
    }
    const out = new Map();
    for (const [o, a] of acc) { let lo = a.x / a.w; if (lo > 180) lo -= 360; if (lo < -180) lo += 360; out.set(o, [lo, a.y / a.w]); }
    s._ls = out; s._lsKey = key;
    return out;
  }
  function trefoil(ctx, x, y, r, col) {
    ctx.fillStyle = col;
    for (let k = 0; k < 3; k++) {
      const a0 = -Math.PI / 2 + (k * 2 * Math.PI) / 3 - 0.5, a1 = a0 + 1;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a0) * r * 0.32, y + Math.sin(a0) * r * 0.32);
      ctx.arc(x, y, r, a0, a1); ctx.arc(x, y, r * 0.32, a1, a0, true); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(x, y, r * 0.18, 0, Math.PI * 2); ctx.fill();
  }
  function drawGlyph(ctx, kind, x, y, r, col) {
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const u = r / 10;
    ctx.beginPath();
    if (kind === 'war') {
      ctx.moveTo(x - 6 * u, y - 6 * u); ctx.lineTo(x + 6 * u, y + 6 * u); ctx.moveTo(x + 6 * u, y - 6 * u); ctx.lineTo(x - 6 * u, y + 6 * u);
      ctx.moveTo(x - 6 * u, y + 2 * u); ctx.lineTo(x - 2 * u, y + 6 * u); ctx.moveTo(x + 6 * u, y + 2 * u); ctx.lineTo(x + 2 * u, y + 6 * u);
      ctx.stroke();
    } else if (kind === 'nuke' || kind === 'nukeown') {
      trefoil(ctx, x, y, 7 * u, col);
    } else if (kind === 'plague') {
      ctx.arc(x, y, 3.6 * u, 0, Math.PI * 2); ctx.stroke();
      for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 3.6 * u, y + Math.sin(a) * 3.6 * u); ctx.lineTo(x + Math.cos(a) * 6.4 * u, y + Math.sin(a) * 6.4 * u); ctx.stroke(); ctx.beginPath(); ctx.arc(x + Math.cos(a) * 7 * u, y + Math.sin(a) * 7 * u, 1.1 * u, 0, Math.PI * 2); ctx.fill(); }
    } else if (kind === 'discovery') {
      for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 2; ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a + 0.6) * 2 * u, y + Math.sin(a + 0.6) * 2 * u, x + Math.cos(a) * 7 * u, y + Math.sin(a) * 7 * u); }
      ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, 2 * u, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'space') {
      ctx.moveTo(x, y - 7 * u); ctx.quadraticCurveTo(x + 4 * u, y - 2 * u, x + 3 * u, y + 4 * u); ctx.lineTo(x - 3 * u, y + 4 * u); ctx.quadraticCurveTo(x - 4 * u, y - 2 * u, x, y - 7 * u); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 2 * u, y + 5 * u); ctx.lineTo(x, y + 8 * u); ctx.lineTo(x + 2 * u, y + 5 * u); ctx.stroke();
    } else if (kind === 'agi') {
      ctx.strokeRect(x - 4.5 * u, y - 4.5 * u, 9 * u, 9 * u);
      for (let k = -1; k <= 1; k++) { ctx.moveTo(x + k * 3 * u, y - 4.5 * u); ctx.lineTo(x + k * 3 * u, y - 7 * u); ctx.moveTo(x + k * 3 * u, y + 4.5 * u); ctx.lineTo(x + k * 3 * u, y + 7 * u); ctx.moveTo(x - 4.5 * u, y + k * 3 * u); ctx.lineTo(x - 7 * u, y + k * 3 * u); ctx.moveTo(x + 4.5 * u, y + k * 3 * u); ctx.lineTo(x + 7 * u, y + k * 3 * u); }
      ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, 1.6 * u, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'climate') {
      ctx.moveTo(x - 1.5 * u, y + 2 * u); ctx.lineTo(x - 1.5 * u, y - 6 * u); ctx.arc(x, y - 6 * u, 1.5 * u, Math.PI, 0); ctx.lineTo(x + 1.5 * u, y + 2 * u); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y + 4.2 * u, 3 * u, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'collapse') {
      ctx.moveTo(x - 6 * u, y - 5 * u); ctx.lineTo(x - 1 * u, y - 1 * u); ctx.lineTo(x - 3 * u, y + 1 * u); ctx.lineTo(x + 3 * u, y + 6 * u);
      ctx.moveTo(x + 6 * u, y - 5 * u); ctx.lineTo(x + 2 * u, y - 2 * u); ctx.stroke();
    } else if (kind === 'ship') {
      ctx.moveTo(x - 7 * u, y + 2 * u); ctx.lineTo(x + 7 * u, y + 2 * u); ctx.lineTo(x + 4 * u, y + 6 * u); ctx.lineTo(x - 4 * u, y + 6 * u); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y + 2 * u); ctx.lineTo(x, y - 7 * u); ctx.lineTo(x + 5 * u, y - 1 * u); ctx.lineTo(x, y - 1 * u); ctx.stroke();
    } else {
      ctx.moveTo(x - 4 * u, y + 7 * u); ctx.lineTo(x - 4 * u, y - 7 * u); ctx.lineTo(x + 6 * u, y - 4 * u); ctx.lineTo(x - 4 * u, y - 1 * u); ctx.stroke();
    }
  }
  function drawIcons(ctx, s, V) {
    for (const f of s.fx) {
      if (f.type !== 'icon') continue;
      const age = 1 - f.life / f.max;
      const a = Math.min(1, f.life / 1.2) * Math.min(1, age * 10);
      if (a <= 0) continue;
      const x = V.X(f.x), y = V.Y(f.y), col = ICON_COL[f.kind] || '#f1cb86';
      const r = 10 * (0.7 + 0.3 * Math.min(1, age * 6));
      ctx.save();
      ctx.globalAlpha = a;
      if (age < 0.45) {
        ctx.strokeStyle = col; ctx.lineWidth = 2;
        ctx.globalAlpha = a * (0.45 - age) * 2;
        ctx.beginPath(); ctx.arc(x, y, r + age * 70, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = a;
      }
      ctx.fillStyle = 'rgba(9,11,17,0.9)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      drawGlyph(ctx, f.kind, x, y, r * 0.78, col);
      ctx.restore();
    }
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function render(s, ctx, W, H, time, app) {
    const dpr = app && app.dpr ? app.dpr : Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, W, H);
    const V = view(s, W, H, app && app.safe);
    s._V = V; s._VW = W; s._VH = H;
    const M = s.map;
    ctx.drawImage(baseLayer(s, V, W, H, dpr), 0, 0, W, H);
    const vmode = app && app.view !== SPACE_VIEW ? app.view || 0 : 0; // 태양계 뷰에서는 보통 여기로 오지 않음 (그릴 수 없을 때의 대비)
    const lp = landPath(s, V);
    ctx.save();
    ctx.beginPath(); ctx.rect(V.x0, V.y0, V.w, V.h); ctx.clip();
    if (lp) ctx.clip(lp);
    // 칸 색
    recolor(s);
    const lay = cellLayer(s, vmode);
    ctx.imageSmoothingEnabled = false;
    const dyc = 180 / M.H;
    for (let j = 0; j < M.H; j++) {
      const la0 = 90 - j * dyc, la1 = la0 - dyc;
      if (la1 >= V.latTop || la0 <= V.latBot) continue;
      const t0 = Math.min(la0, V.latTop), t1 = Math.max(la1, V.latBot);
      ctx.drawImage(lay, 0, j + (la0 - t0) / dyc, M.W, (t0 - t1) / dyc, V.x0, V.rowY[j], V.w, V.rowY[j + 1] - V.rowY[j] + 0.35);
    }
    ctx.imageSmoothingEnabled = true;
    if (M._shadeScr) ctx.drawImage(M._shadeScr, 0, 0, W, H);
    // 국경
    const bp = borderPaths(s, V);
    const lw = WS.clamp(V.k * 0.55, 0.8, 1.6);
    if (vmode === 0) {
      ctx.strokeStyle = 'rgba(16,14,12,0.38)'; ctx.lineWidth = lw * 0.8; ctx.stroke(bp.soft);
      ctx.strokeStyle = 'rgba(12,12,14,0.9)'; ctx.lineWidth = lw * 1.25; ctx.stroke(bp.intl);
      ctx.strokeStyle = 'rgba(255,246,226,0.10)'; ctx.lineWidth = lw * 0.5; ctx.stroke(bp.intl);
    } else {
      ctx.strokeStyle = 'rgba(10,12,16,0.35)'; ctx.lineWidth = lw * 0.8; ctx.stroke(bp.intl);
    }
    const pulse = 0.6 + 0.4 * Math.sin(time * 5);
    ctx.strokeStyle = `rgba(240,96,70,${0.55 + 0.4 * pulse})`; ctx.lineWidth = lw * 2; ctx.stroke(bp.front);
    ctx.restore();
    // 핵겨울
    if (s.winter > 0.3) {
      const g = ctx.createLinearGradient(0, V.y0, 0, V.y0 + V.h);
      const a = Math.min(0.55, s.winter * 0.08);
      g.addColorStop(0, `rgba(150,150,158,${a})`); g.addColorStop(0.55, `rgba(130,130,140,${a * 0.8})`); g.addColorStop(1, `rgba(110,110,120,${a * 0.45})`);
      ctx.fillStyle = g; ctx.fillRect(V.x0, V.y0, V.w, V.h);
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(V.x0, V.y0, V.w, V.h); ctx.clip();
    const boxes = [];
    const badge = offworldBadge(ctx, s, V);
    s._badge = badge; // 눌렀을 때 태양계 뷰로 가는 자리 (시각용, pick이 읽음)
    if (badge) boxes.push(badge);
    capitalsAndLabels(ctx, s, V, vmode, boxes);
    WS.drawFx(ctx, s, (lo, la) => [V.X(lo), V.Y(la), V.k]);
    drawIcons(ctx, s, V);
    ctx.restore();
    ctx.strokeStyle = 'rgba(216,168,91,0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(V.x0 - 0.5, V.y0 - 0.5, V.w + 1, V.h + 1);
  }
  function offworldBadge(ctx, s, V) {
    if (!(s.offworld >= 1)) return null;
    ctx.font = '600 12px "IBM Plex Sans KR", "Malgun Gothic", sans-serif';
    const link = '태양계 보기'; // 누르면 태양계 뷰로 감 (pick)
    let txt = `${s.settle.out} 정착민 ${ppl(s.offworld)} · `;
    if (ctx.measureText(txt + link).width + 56 > V.w) txt = `정착민 ${ppl(s.offworld)} · `;
    const tw = ctx.measureText(txt + link).width;
    const w = tw + 36, h = 26, x = V.x0 + V.w - w - 10, y = V.y0 + 10;
    ctx.fillStyle = 'rgba(9,11,17,0.86)'; roundRect(ctx, x, y, w, h, 13); ctx.fill();
    ctx.strokeStyle = 'rgba(216,168,91,0.4)'; ctx.lineWidth = 1; ctx.stroke();
    const g = ctx.createRadialGradient(x + 13, y + 11, 1, x + 15, y + 13, 8);
    g.addColorStop(0, '#f0a070'); g.addColorStop(1, '#8c3a22');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x + 15, y + 13, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f3eee2'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(txt, x + 28, y + h / 2 + 0.5);
    ctx.fillStyle = '#f1cb86';
    ctx.fillText(link, x + 28 + ctx.measureText(txt).width, y + h / 2 + 0.5);
    ctx.textBaseline = 'alphabetic';
    return [x, y, w, h];
  }
  function capitalsAndLabels(ctx, s, V, vmode, boxes) {
    const M = s.map;
    const byPop = s.alive.filter((p) => p.cap >= 0 && p.popSum > 0).sort((a, b) => b.popSum - a.popSum);
    const capN = V.w > 700 ? 16 : 9;
    const caps = byPop.slice(0, capN);
    // 수도
    for (let i = 0; i < caps.length; i++) {
      const p = caps[i], x = V.X(M.lon[p.cap]), y = V.Y(M.lat[p.cap]);
      const r = i < 3 ? 3.2 : 2.4;
      ctx.fillStyle = '#f4eedf'; ctx.strokeStyle = 'rgba(8,10,14,0.9)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (i < 3) { ctx.strokeStyle = 'rgba(244,238,223,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r + 2.6, 0, Math.PI * 2); ctx.stroke(); }
      boxes.push([x - r - 1, y - r - 1, 2 * r + 2, 2 * r + 2]);
    }
    if (vmode !== 0 && vmode !== 2) return;
    // 이름: 넓은 나라부터, 겹치면 자리를 옮기거나 생략
    const spots = labelSpots(s);
    const sc = WS.clamp(V.w / 900, 0.75, 1.25);
    const maxN = V.w > 700 ? 30 : 16;
    const cand = s.alive.filter((p) => spots.has(p.id) && (p.cells >= 4 || byPop.indexOf(p) < 10)).sort((a, b) => b.cells - a.cells || b.popSum - a.popSum).slice(0, maxN + 10);
    const rank = new Map(byPop.slice(0, 6).map((p, i) => [p.id, i]));
    let shown = 0;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of cand) {
      if (shown >= maxN) break;
      const [lo, la] = spots.get(p.id);
      const fs = Math.round(WS.clamp(7.5 + Math.sqrt(p.cells) * 0.62, 9.5, 17) * sc);
      ctx.font = `600 ${fs}px "IBM Plex Sans KR", "Malgun Gothic", sans-serif`;
      const name = p.name.length > 11 ? p.name.slice(0, 10) + '…' : p.name;
      const tw = ctx.measureText(name).width + (p.wh > 0 ? fs * 0.9 : 0);
      const sub = rank.has(p.id) && V.w > 640 ? ppl(p.popSum) : '';
      const bh = fs + 4 + (sub ? fs * 0.8 : 0);
      const cx0 = V.X(lo), cy0 = V.Y(la);
      let placed = null;
      for (const [ox, oy] of [[0, 0], [0, -0.9], [0, 0.9], [-0.7, 0], [0.7, 0], [0, -1.6], [0, 1.6]]) {
        const cx = cx0 + ox * (tw * 0.5 + 6), cy = cy0 + oy * bh;
        const b = [cx - tw / 2 - 3, cy - fs / 2 - 2, tw + 6, bh];
        if (b[0] < V.x0 + 2 || b[0] + b[2] > V.x0 + V.w - 2 || b[1] < V.y0 + 2 || b[1] + b[3] > V.y0 + V.h - 2) continue;
        if (boxes.some((q) => b[0] < q[0] + q[2] && b[0] + b[2] > q[0] && b[1] < q[1] + q[3] && b[1] + b[3] > q[1])) continue;
        placed = [cx, cy, b];
        break;
      }
      if (!placed) continue;
      const [cx, cy, b] = placed;
      boxes.push(b);
      shown++;
      const nx = cx - (p.wh > 0 ? fs * 0.45 : 0);
      ctx.lineWidth = Math.max(2.5, fs * 0.28); ctx.strokeStyle = 'rgba(7,9,13,0.82)'; ctx.lineJoin = 'round';
      ctx.strokeText(name, nx, cy);
      ctx.fillStyle = p.wars.size ? '#ffd9cc' : '#f3eee2';
      ctx.fillText(name, nx, cy);
      if (p.wh > 0) {
        const tx = nx + ctx.measureText(name).width / 2 + fs * 0.55;
        ctx.fillStyle = 'rgba(7,9,13,0.85)'; ctx.beginPath(); ctx.arc(tx, cy, fs * 0.42, 0, Math.PI * 2); ctx.fill();
        trefoil(ctx, tx, cy, fs * 0.34, '#f2c14e');
      }
      if (sub) {
        ctx.font = `500 ${Math.round(fs * 0.72)}px "IBM Plex Sans KR", "Malgun Gothic", sans-serif`;
        ctx.lineWidth = 2.5; ctx.strokeText(sub, cx, cy + fs * 0.82);
        ctx.fillStyle = 'rgba(232,222,198,0.78)'; ctx.fillText(sub, cx, cy + fs * 0.82);
      }
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  function pick(s, x, y, W, H) {
    const V = s._V && s._VW === W && s._VH === H ? s._V : view(s, W, H, null), M = s.map;
    const bd = s._badge;
    if (bd && s.offworld >= 1 && x >= bd[0] - 3 && x <= bd[0] + bd[2] + 3 && y >= bd[1] - 4 && y <= bd[1] + bd[3] + 4) return { goView: SPACE_VIEW };
    if (x < V.x0 || x >= V.x0 + V.w || y < V.y0 || y > V.y0 + V.h) return null;
    const lo = ((x - V.x0) / V.w) * 360 - 180, la = V.LA(y);
    if (la > V.latTop || la < V.latBot) return null;
    const cx = Math.floor((lo + 180) / (360 / M.W)), cy = Math.floor((90 - la) / (180 / M.H));
    return { c: cy * M.W + cx, lo, la };
  }

  /* ---------- 글로 보는 세계 ---------- */
  // 하늘이 어두운 까닭이 핵전쟁이 아니라 운석인지 (글에만 씁니다)
  function dustWinter(s) {
    const last = s.impacts && s.impacts[s.impacts.length - 1];
    return !!last && s.year - last.year < 20 && !(s.lastCat && s.lastCat.kind === '핵전쟁');
  }
  function era(s) {
    if (s.winter > 2) return dustWinter(s) ? { name: '충돌의 겨울', sub: '운석 먼지가 햇빛을 가려 농사가 어려워졌습니다' } : { name: '핵겨울', sub: '재가 햇빛을 가려 농사가 무너졌습니다' };
    if (s.collapsed) return { name: '암흑기', sub: '인구가 크게 줄고 많은 지식이 흩어졌습니다' };
    if (s.agiOutcome === 'misaligned' && s.year - s.agiYear < 60) return { name: '초지능 재앙 이후', sub: '살아남은 사람들이 다시 일어서려 합니다' };
    const e = worldEraIndex(s);
    let sub = s.alien ? `${s.speciesName}의 역사` : e <= 0 ? '사냥과 채집으로 살아갑니다' : `가장 앞선 사회 기준 · 나라 ${s.alive.length}개`;
    if (s.agiOutcome === 'aligned') sub = '초지능이 인류를 돕고 있습니다';
    else if (s.agiOutcome === 'contained') sub = '초지능이 감시 속에 묶여 있습니다';
    if (s.offworld >= 1 && s.offworld < SELF_SUSTAIN) sub = `${s.settle.out} 첫 정착지에 ${ppl(s.offworld)}이 삽니다`;
    return { name: ERA[Math.min(ERA.length - 1, e)], sub };
  }
  function popTrend(s) {
    if (!s.alive.length) return '';
    const g = s.popRate || 0;
    if (s.reached.peak && isFinite(s.reached.peak.v) && g < -0.0005) return `${Math.round(s.popPeakYear)}년 정점(${ppl(s.popPeak)})을 지나 줄고 있습니다`;
    if (g > 0.012) return '빠르게 늘고 있습니다';
    if (g > 0.003) return '늘고 있습니다';
    if (g > -0.002) return s.popPeak >= 3e9 && s.worldPop > 0.97 * s.popPeak ? '정점 근처입니다' : '거의 그대로입니다';
    return '줄고 있습니다';
  }
  // 해설 문장에는 연도를 쓰지 않음: 같은 카드의 머리글이 늘 지금 시각을 보여 주고, 해설은 몇 초에 한 번만 바뀌어 두 시각이 어긋나 보임
  function narrate(s) {
    const n = s.alive.length, wars = warCount(s), T = s.Tanom();
    const popTxt = ppl(s.worldPop);
    if (!n) {
      const farm = s.landCells.some((c) => s.tribe[c] & 1);
      return farm ? `몇몇 강가에서 농사를 짓기 시작했지만, 아직 나라는 없습니다. 세계 인구는 약 ${popTxt}입니다.` : `사람들은 모두 사냥과 채집으로 살아갑니다. 세계 인구는 약 ${popTxt}입니다.`;
    }
    const top = topPolity(s);
    const warTxt = wars >= 1 ? ` ${Math.round(wars)}곳에서 전쟁이 벌어지고 있습니다.` : '';
    if (s.eraNow <= 5) return `나라 ${n}개, 세계 인구는 약 ${popTxt}입니다. 가장 큰 나라는 ${top.name}입니다.${warTxt}`;
    let first = `세계 인구 ${popTxt}, ${popTrend(s)}.`;
    let second;
    if (s.winter > 1) second = (dustWinter(s) ? ' 운석 먼지로 하늘이 어둡고 농사가 어려워졌습니다.' : ' 핵겨울로 하늘이 어둡고 농사가 무너졌습니다.') + ` 기온은 ${fmtT(T)}입니다.`;
    else if (s.collapsed) second = ` 문명이 무너지는 시기입니다. 기온은 ${fmtT(T)}, 나라 ${n}개가 남았습니다.`;
    else {
      second = ` 기온은 ${fmtT(T)}`;
      second += wars >= 1 ? `, ${Math.round(wars)}곳에서 전쟁 중입니다.` : ', 큰 전쟁은 없습니다.';
      if (s.agiOutcome === 'aligned') second += ' 초지능이 연구와 살림을 돕습니다.';
      else if (s.agiOutcome === 'contained') second += ' 초지능은 감시 속에 묶여 있습니다.';
      if (s.offworld >= SELF_SUSTAIN) second += ` ${s.settle.out}에도 ${ppl(s.offworld)}이 삽니다.`;
    }
    return first + second;
  }
  function legend(s, v) {
    if (v === SPACE_VIEW) return spaceLegend(s);
    if (v === 1) return [{ gradient: ['#18203a', '#463478', '#be5050', '#faaa50', '#fff4d2'], from: '1km²에 0.1명', to: '1,000명 이상', label: '인구 밀도' }, { color: '#06080e', label: '사람이 살지 않는 땅' }];
    if (v === 2) { const e = Math.min(ERA.length - 1, worldEraIndex(s)); return [{ gradient: ERA_COL.map((c) => WS.rgb(c)), from: '수렵채집', to: '항성 간 문명', label: '기술 시대' }, { color: WS.rgb(ERA_COL[e]), label: `지금 가장 앞선 곳: ${ERA[e]}` }]; }
    if (v === 3) return [{ gradient: ['#46b496', '#46505e', '#ecd678', '#f49640', '#d64232', '#78122a'], from: '오히려 이득', to: '심각한 피해', label: `기후 피해 (기온 ${fmtT(s.Tanom())})` }, { color: '#f49640', label: '해안은 해수면 상승 피해가 더해짐' }];
    const out = [];
    const top = s.alive.slice().sort((a, b) => b.popSum - a.popSum).slice(0, 3);
    for (const p of top) out.push({ color: WS.rgb(p.color), label: `${p.name} (${ppl(p.popSum)})` });
    if (s.alive.some((p) => p.wars.size)) out.push({ color: '#f06046', label: '붉은 선 = 전쟁 중인 국경' });
    out.push({ color: '#f4eedf', label: '흰 점 = 큰 나라의 수도' });
    if (s.alive.some((p) => p.wh > 0)) out.push({ color: '#f2c14e', label: '노란 표시 = 핵무기 보유국' });
    if (s.unowned > 0 && s.landCells.some((c) => s.owner[c] < 0 && s.tribe[c] & 1)) out.push({ color: 'rgba(206,190,120,0.6)', label: '옅은 노랑 = 나라 없이 농사짓는 부족' });
    return out;
  }
  function stats(s) {
    const top = topPolity(s);
    const wars = warCount(s);
    const T = s.Tanom();
    let wh = 0, nn = 0;
    for (const p of s.alive) if (p.wh > 0) { wh += p.wh; nn++; }
    const rows = [
      ['세계 인구', ppl(s.worldPop)],
      ['기온 변화', fmtT(T), T > 2 ? 'warn' : ''],
      ['나라 수', `${s.alive.length}개`],
      ['진행 중인 전쟁', `${Math.round(wars)}곳`, wars > 3 ? 'warn' : ''],
      ['핵 보유국', nn ? `${nn}개국` : '없음', nn ? 'warn' : ''],
      ['국제 협력', pct(s.coop)],
      ['CO₂ 농도', `${Math.round(s.co2)} ppm`],
      ['가장 큰 나라', top ? top.name : '—'],
    ];
    if (s.firstTech.agi) rows.push(['초지능', s.agiOutcome === 'aligned' ? '인류와 협력' : s.agiOutcome === 'contained' ? '감시 속에 묶임' : '재앙', s.agiOutcome === 'misaligned' ? 'warn' : '']);
    if (s.offworld >= 1) rows.push([`${s.settle.out} 인구`, ppl(s.offworld)]);
    return rows;
  }
  function inspect(s, w) {
    if (w.goView != null) return ['태양계 보기', `${s.settle.out} 사람들이 어느 천체에 사는지 봅니다.`];
    const c = w.c, M = s.map;
    if (!M.land[c]) return ['바다'];
    if (!s.isLand[c]) return ['얼음 땅'];
    const o = s.owner[c];
    const lines = [];
    if (o >= 0) {
      const p = s.pols[o];
      lines.push(p.name, `${GOV[p.gov]} · 인구 ${ppl(p.popSum)} · ${eraOf(s, p)}`);
      if (p.modern && p.tfr !== undefined) lines.push(`출산율 ${p.tfr.toFixed(1)}명 · 인구 ${p.g >= 0 ? '증가' : '감소'} 연 ${Math.abs(p.g * 100).toFixed(1)}%`);
      if (p.wars.size) lines.push('전쟁 중: ' + [...p.wars.keys()].map((q) => s.pols[q].name).join(', '));
      lines.push(`안정도 ${pct(p.stab)}${p.wh > 0 ? ` · 핵탄두 ${Math.round(p.wh).toLocaleString('ko-KR')}발` : ''}${p.energy ? ` · 청정 에너지 ${pct(p.clean || 0)}` : ''}`);
    } else {
      lines.push(s.tribe[c] & 1 ? '농사짓는 부족' : s.pop[c] > 1 ? '수렵채집 부족' : '사람이 살지 않는 땅');
    }
    const dm = s.dmg[c];
    if (Math.abs(dm) > 0.01) lines.push(dm > 0 ? `기후 피해: 수확 ${Math.round(dm * (o >= 0 ? s.pols[o].adapt : 1) * 100)}% 감소${o >= 0 && s.pols[o].adapt < 0.95 ? ' (적응 후)' : ''}` : `기후 변화로 농사가 ${Math.round(-dm * 100)}% 쉬워짐`);
    lines.push(`${s.regionName(c)} · 이 칸 인구 ${ppl(s.pop[c])}`);
    return lines;
  }

  /* ---------- 태양계 뷰에 넘기는 장면 ---------- */
  const SPACE_VIEW = 4; // views에서 '태양계'의 자리 (늘 마지막)
  const yearOf = (s, y) => (s.alien ? s.labelAt(y) : yearText(y));
  const homeEmpty = (s) => s.earthPop < 1e3 && s.offworld > 0; // 고향에는 사실상 아무도 없고 지구 밖에만 사람이 있음
  // 실험실이 세계마다 받아 가는 요약 (값만 있어 Worker에서 그대로 전달됨)
  function settleSummary(s) {
    const S = s.settle, t = S.star;
    return {
      first: S.firstId,
      list: S.list.map((e) => ({ id: e.id, name: e.name, pop: e.pop, since: e.since, lost: e.lost })),
      star: t ? { target: t.target, ly: t.ly, year: t.year, speedC: t.speedC, arrive: t.arrive } : null,
      homeEmpty: homeEmpty(s),
    };
  }
  // 격자 값의 쌍선형 보간 (경도 방향은 이어짐)
  function gridSamp(M, A, lo, la) {
    const W = M.W, H = M.H, fx = ((lo + 180) / 360) * W - 0.5, fy = WS.clamp(((90 - la) / 180) * H - 0.5, 0, H - 1.001);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, xa = (x0 + W) % W, xb = (x0 + 1 + W) % W;
    return (A[y0 * W + xa] * (1 - tx) + A[y0 * W + xb] * tx) * (1 - ty) + (A[(y0 + 1) * W + xa] * (1 - tx) + A[(y0 + 1) * W + xb] * tx) * ty;
  }
  // 땅 칸의 값을 넓게 번짐 (바다 칸은 값이 없으므로 무게를 함께 번져 나눔)
  function* spreadLand(M, A) {
    const W = M.W, H = M.H, NC = M.NC;
    let V = new Float32Array(NC), K = new Float32Array(NC);
    for (let c = 0; c < NC; c++) if (M.land[c]) { V[c] = A[c]; K[c] = 1; }
    for (let pass = 0; pass < 3; pass++) {
      const V2 = new Float32Array(NC), K2 = new Float32Array(NC);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let sv = 0, sk = 0;
        for (let dy = -2; dy <= 2; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -2; dx <= 2; dx++) { const q = yy * W + ((x + dx + W) % W); sv += V[q]; sk += K[q]; }
        }
        V2[y * W + x] = sv / 25; K2[y * W + x] = sk / 25;
        if (x === W - 1 && y % 8 === 7) yield;
      }
      V = V2; K = K2;
    }
    for (let c = 0; c < NC; c++) V[c] = K[c] > 1e-4 ? V[c] / K[c] : 0;
    return V;
  }
  /* 둥근 지구의 땅 색: 지도와 같은 기후 자료를 넓게 번져 네모난 경계를 없애고, 추운 곳의 숲과 빙상을 더함 */
  function* earthLandTex(M, T) {
    const R = yield* spreadLand(M, M.rain);
    const tw = 256, th = 128, cv = document.createElement('canvas');
    cv.width = tw; cv.height = th;
    const g = cv.getContext('2d'), img = g.createImageData(tw, th), d = img.data;
    const nz = new WS.Noise(2027);
    for (let py = 0, o = 0; py < th; py++) {
      const la = 90 - ((py + 0.5) / th) * 180;
      for (let px = 0; px < tw; px++, o += 4) {
        const lo = -180 + ((px + 0.5) / tw) * 360;
        const h = la > -60 && la < 84 ? WS.Earth.relief(lo, la) : 0, t = gridSamp(M, T, lo, la) - h * 14;
        // 추운 내륙은 비가 적어도 증발이 적어 숲이 자람 (지도 자료로는 사막색이 됨)
        let col = biomeCol(t + 5 * WS.smooth(12, 0, t), gridSamp(M, R, lo, la) + 0.55 * WS.smooth(12, 2, t));
        const rock = WS.smooth(0.35, 0.9, h);
        if (rock > 0) col = WS.mix(col, [132, 124, 112], rock * 0.6);
        if (h > 0.72) col = WS.mix(col, [226, 230, 234], WS.smooth(0.72, 1, h) * 0.7);
        const ice = la < -60 || (la > 60 && lo < -21 && lo > -55 - Math.max(0, la - 72) * 2.7); // 남극 대륙과 그린란드의 빙상
        if (ice) col = [226, 232, 238];
        const k = 0.98 + 0.28 * nz.fbm(lo * 0.09, la * 0.09, 5.2, 3);
        d[o] = col[0] * k; d[o + 1] = col[1] * k; d[o + 2] = col[2] * k; d[o + 3] = 255;
      }
      yield;
    }
    g.putImageData(img, 0, 0);
    return cv;
  }
  /* 둥근 행성 그림의 바탕 (지도마다 한 번): 바다, 대륙붕, 땅. 맨 윗줄이 북위 90°, 맨 왼쪽이 서경 180° */
  const GLOBE_W = 512, GLOBE_H = 256;
  // 오래 걸리므로 조금씩 나눠 만듭니다. 다 되면 M._globe가 채워집니다
  function* globeBase(M) {
    const w = GLOBE_W, h = GLOBE_H, n = w * h;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const tex = terrainTex(M);
    const X = (lo) => ((lo + 180) / 360) * w, Y = (la) => ((90 - la) / 180) * h;
    const ty = Y(M.earth ? LAT_TOP : 90), tb = Y(M.earth ? LAT_BOT : -90);
    let lp = null;
    if (M.polys) {
      lp = new Path2D();
      for (const pts of M.polys) {
        lp.moveTo(X(pts[0][0]), Y(pts[0][1]));
        for (let i = 1; i < pts.length; i++) lp.lineTo(X(pts[i][0]), Y(pts[i][1]));
        lp.closePath();
      }
    }
    const field = M.earth ? yield* spreadLand(M, M.temp) : M.temp;
    const ltex = M.earth ? yield* earthLandTex(M, field) : null;
    yield;
    const land = () => {
      g.save();
      if (lp) { g.clip(lp); g.drawImage(ltex, 0, 0, w, h); g.drawImage(M._shadeTex, 0, ty, w, tb - ty); } // 지도와 같은 산 그림자
      else g.drawImage(tex, 0, ty, w, tb - ty);
      g.restore();
    };
    land();
    yield;
    const mask = g.getImageData(0, 0, w, h).data;
    g.clearRect(0, 0, w, h);
    const og = g.createLinearGradient(0, 0, 0, h);
    og.addColorStop(0, '#0f2c4a'); og.addColorStop(0.3, '#123a63'); og.addColorStop(0.5, '#14457a'); og.addColorStop(0.7, '#123a63'); og.addColorStop(1, '#0f2c4a');
    g.fillStyle = og; g.fillRect(0, 0, w, h);
    g.save();
    g.shadowColor = 'rgba(92,178,206,0.6)'; g.shadowBlur = 6;
    if (lp) { g.fillStyle = '#1f4f6b'; g.fill(lp); } else g.drawImage(tex, 0, ty, w, tb - ty);
    g.restore();
    land();
    yield;
    const rgba = g.getImageData(0, 0, w, h).data;
    yield;
    const cellOf = new Int32Array(n), iceV = new Float32Array(n), spark = new Float32Array(n), isLand = new Uint8Array(n);
    const nz = new WS.Noise(M.earth ? 4242 : 99);
    for (let y = 0, i = 0; y < h; y++) {
      const la = 90 - ((y + 0.5) / h) * 180, ca = Math.cos((la * Math.PI) / 180), sa = Math.sin((la * Math.PI) / 180);
      const lat0 = 27 * Math.pow(ca, 1.5) - 8 * (1 - ca); // 바다 위 기온 근사 (지구 기후 계산과 같은 식)
      const row = Math.min(M.H - 1, Math.floor((y / h) * M.H)) * M.W;
      for (let x = 0; x < w; x++, i++) {
        const lo = -180 + ((x + 0.5) / w) * 360, co = Math.cos((lo * Math.PI) / 180), so = Math.sin((lo * Math.PI) / 180);
        const c = row + Math.min(M.W - 1, Math.floor((x / w) * M.W));
        cellOf[i] = c;
        // 얼음 경계는 위도를 따르되 땅과 물결무늬로 흐트러뜨림 (구면 위 노이즈라 이음매가 없음)
        const wob = 6 * nz.fbm(ca * co * 4, ca * so * 4, sa * 4, 4);
        isLand[i] = mask[i * 4 + 3] > 128 ? 1 : 0;
        const tv = gridSamp(M, field, lo, la);
        iceV[i] = (M.earth ? lat0 + (isLand[i] ? (tv - lat0) * 0.35 : 0) : tv) + wob;
        // 불빛이 켜지는 문턱: 도시가 무리 지어 보이게 작은 노이즈를 섞음
        spark[i] = WS.clamp(0.55 * hash32(x + 7, y * 977 + 13) + 0.45 * (0.5 - 2.2 * nz.fbm(ca * co * 16, ca * so * 16, sa * 16 + 9, 2)), 0.002, 1);
      }
      yield;
    }
    M._globe = { w, h, n, rgba, cellOf, iceV, spark, isLand };
  }
  // ms만큼만 더 만들고, 다 되었으면 true
  function globeStep(M, ms) {
    if (M._globe) return true;
    if (typeof document === 'undefined') return false;
    const job = M._globeJob || (M._globeJob = globeBase(M)), t0 = performance.now();
    do { if (job.next().done) { M._globeJob = null; return true; } } while (performance.now() - t0 < ms);
    return false;
  }
  /* 지금 상태의 표면: 얼음은 추우면 늘고 더우면 줄며, 밤의 불빛은 인구에서 나옵니다. 보이는 때에 물을 때만 다시 만듭니다 */
  function homeSurface(s) {
    const M = s.map;
    if (!globeStep(M, 6)) return null;
    const B = M._globe;
    let G = s._surf;
    if (!G) G = s._surf = { w: B.w, h: B.h, rgba: new Uint8ClampedArray(B.n * 4), lights: new Float32Array(B.n), ver: 0, year: NaN, hits: -1 };
    if (G.year === s.year && G.hits === s.impactN) return G;
    G.year = s.year; G.hits = s.impactN; G.ver++;
    const T = s.Tanom(), thr = M.earth ? -0.9 + 1.44 * (1.4 - T) : -5 + 1.2 * (s.T0 - T);
    const src = B.rgba, out = G.rgba, iv = B.iceV;
    for (let i = 0, o = 0; i < B.n; i++, o += 4) {
      let a = (thr + 1 - iv[i]) * 0.5;
      a = a < 0 ? 0 : a > 0.96 ? 0.96 : a;
      out[o] = src[o] + (232 - src[o]) * a; out[o + 1] = src[o + 1] + (238 - src[o + 1]) * a; out[o + 2] = src[o + 2] + (244 - src[o + 2]) * a; out[o + 3] = 255;
    }
    // 칸마다 불빛 세기: 인구 밀도의 로그, 전기가 없는 사회는 희미한 등불
    const cl = G.cl || (G.cl = new Float32Array(M.NC)), pop = s.pop, area = M.area, owner = s.owner, pols = s.pols, elec = TI.elec;
    cl.fill(0);
    for (const c of s.landCells) {
      if (pop[c] < 1) continue;
      const o = owner[c], t = (Math.log10(pop[c] / area[c]) - 0.1) / 2.5;
      if (t > 0) cl[c] = 0.8 * Math.pow(t > 1 ? 1 : t, 1.4) * (o >= 0 && pols[o].known[elec] ? 1 : 0.12);
    }
    const lights = G.lights, cellOf = B.cellOf, spark = B.spark, isL = B.isLand;
    for (let i = 0; i < B.n; i++) {
      const v = isL[i] ? cl[cellOf[i]] : 0;
      lights[i] = v > spark[i] ? Math.min(1, 0.3 + (v - spark[i]) * 2.4) : 0;
    }
    return G;
  }
  function spaceScene(s) {
    // 같은 해 안에서는 달라질 것이 없음 (운석만 걸음 사이에 떨어질 수 있음)
    if (s._scn && s._scnYear === s.year && s._scnHits === s.impactN) return s._scn;
    const S = s.settle, sys = S.sys, home = sys.bodies.find((b) => b.home), off = s.offworld, empty = homeEmpty(s);
    const live = S.list.filter((e) => e.lost === false);
    const settlements = S.list.map((e) => (e.lost === false
      ? { id: e.id, bodyId: e.bodyId, name: e.name, pop: e.pop, popText: ppl(e.pop), since: e.since, sinceText: `${yearOf(s, e.since)}부터`, lost: false, lostText: null, first: e.first }
      : { id: e.id, bodyId: e.bodyId, name: e.name, pop: 0, popText: '', since: e.since, sinceText: '', lost: true, lostText: `${yearOf(s, e.lost)}에 사라짐`, first: e.first }));
    const t = S.star;
    const canLaunch = s.earthPop > 0.5 * s.crashRef && s.knownShare[TI.space] > 0.05;
    const traffic = live.length ? WS.clamp((Math.log10(off + 1) - 1.5) / 7, 0, 1) * (canLaunch ? 1 : 0.25) : 0;
    let caption = yearOf(s, s.year);
    if (live.length) caption += ` · ${S.out} 인구 ${ppl(off)}`;
    else if (S.allLost) caption += ` · ${S.out} 정착지가 모두 사라졌습니다`;
    s._scn = {
      key: s.alien ? `sys:${s.seed}` : 'solar',
      star: sys.star,
      bodies: sys.bodies,
      belt: sys.belt,
      home: {
        id: home.id, name: home.name,
        atmosphere: [120, 170, 255],
        surface: s._surfFn || (s._surfFn = () => homeSurface(s)),
        dust: WS.clamp(1 - Math.exp(-s.winter / 2.5), 0, 1),
        popText: s.earthPop >= 1 ? `인구 ${ppl(s.earthPop)}` : null,
        sats: !!s.firstTech.space,
      },
      bombard: 0,
      hidden: sys.hidden || 0,
      listTitle: s.alien ? '이 문명이 간 곳' : '인류가 간 곳',
      impacts: s.impacts.slice(-8).map((q) => ({ n: q.n, D: q.D, lo: q.lo, la: q.la, user: true, title: '운석 충돌', sub: `${yearOf(s, q.year)} · ${q.dead >= 1 ? `약 ${ppl(q.dead)}이 목숨을 잃었습니다` : '사람이 없는 곳에 떨어졌습니다'}` })),
      settlements,
      traffic,
      interstellar: t ? { target: t.target, ly: t.ly, text: s.alien ? `${yearOf(s, t.year)} 출발 · 약 ${Math.round(t.arrive - t.year).toLocaleString('ko-KR')}년 뒤 도착 예정` : `${yearOf(s, t.year)} 출발 · 약 ${yearOf(s, t.arrive)} 도착 예정` } : null,
      homeEmpty: empty,
      caption,
      emptyNote: S.list.length || t ? null : `아직 ${S.out}으로 나간 ${s.alien ? '이가' : '사람이'} 없습니다.`,
    };
    s._scnYear = s.year; s._scnHits = s.impactN;
    return s._scn;
  }
  // 태양계 천체의 사실: [거리, 중력(지구 = 100)]
  const BODY_FACT = {
    mercury: ['태양에서 5,800만 km', 38], venus: ['태양에서 1억 800만 km', 90], earth: ['태양에서 1억 5,000만 km', 100], moon: ['지구에서 38만 km', 17],
    mars: ['태양에서 2억 2,800만 km', 38], ceres: ['태양에서 4억 1,400만 km', 3], jupiter: ['태양에서 7억 7,800만 km', 253], europa: ['목성에서 67만 km', 13], ganymede: ['목성에서 107만 km', 15],
    saturn: ['태양에서 14억 3,000만 km', 106], titan: ['토성에서 122만 km', 14], uranus: ['태양에서 28억 7,000만 km', 89], neptune: ['태양에서 45억 km', 114], triton: ['해왕성에서 35만 km', 8],
  };
  function spaceInspect(s, id) {
    const S = s.settle, sys = S.sys;
    if (id === 'sun' || id === 'star') return [sys.star.name, '행성들을 붙잡아 두고 빛과 열을 보내는 별입니다.'];
    const b = sys.bodies.find((q) => q.id === id);
    if (!b) return null;
    const lines = [b.name], home = sys.bodies.find((q) => q.home);
    // 실제 값 표는 태양계에서만 씁니다 (다른 별의 '달'이나 무작위 행성의 이웃은 이름과 자리만 같음)
    const F = S.out === '지구 밖' ? BODY_FACT[id] : null;
    if (F) lines.push(b.home ? F[0] : `${F[0]} · 중력은 지구의 ${F[1]}%`);
    else if (b.parent) lines.push(`${sys.bodies.find((q) => q.id === b.parent).name} 둘레를 도는 위성입니다.`);
    else if (!b.home) {
      const ra = b.a / home.a, far = Math.abs(Math.log(ra)) < 0.05 ? '고향 행성과 거의 같은 궤도' : ra >= 1 ? `고향 행성보다 ${ra.toFixed(1)}배 먼 궤도` : `고향 행성보다 ${(1 / ra).toFixed(1)}배 가까운 궤도`;
      const gv = b.m > 0 && home.m > 0 ? Math.pow(b.m / home.m, 0.46) : 0; // 표면 중력 ∝ 질량^0.46 (반지름 ∝ 질량^0.27)
      lines.push(gv ? `${far} · 중력은 고향 행성의 ${gv >= 2 ? `약 ${gv.toFixed(1)}배` : `약 ${Math.round(gv * 100)}%`}` : far);
    }
    const e = S.list.find((q) => q.bodyId === id), d = S.dest.find((q) => q.bodyId === id);
    if (b.home) {
      lines.push(homeEmpty(s) ? '고향 행성에는 아무도 남지 않았습니다.' : `${s.alien ? '이 문명' : '사람들'}의 고향 · 인구 ${ppl(s.earthPop)} · 기온 변화 ${fmtT(s.Tanom())}`);
    } else if (d) lines.push(`${s.alien ? '이 문명이' : '사람들이'} ${e || s.firstTech.mars ? '가는' : '갈 만한'} 이유: ${d.why}`);
    else if (b.giant || ['jupiter', 'saturn', 'uranus', 'neptune'].includes(b.look)) lines.push('단단한 땅이 없어 내려설 수 없습니다.');
    if (e) lines.push(e.lost === false ? `${b.home ? '궤도 도시 인구' : s.alien ? '인구' : '사는 사람'} ${ppl(e.pop)} · ${yearOf(s, e.since)}부터` : `${yearOf(s, e.since)}에 세운 정착지가 ${yearOf(s, e.lost)}에 사라졌습니다.`);
    else if (d && !b.home) lines.push(s.alien ? '아직 정착지가 없습니다.' : '아직 아무도 살지 않습니다.');
    return lines;
  }
  // 지도 위에서 충돌 지점의 자리 (작은 창이 그곳을 가리지 않게)
  function spaceSite(s, imp, W, H) {
    const V = s._V && s._VW === W && s._VH === H ? s._V : null;
    return V && imp.lo != null ? [V.X(imp.lo), V.Y(imp.la)] : null;
  }
  function spaceLegend(s) {
    // 정착지 이름과 인구는 그림 안의 목록이 보여 줍니다. 범례는 표시법만 짧게 (행 수가 늘지 않아 궤도가 들썩이지 않음)
    const S = s.settle, home = S.sys.bodies.find((b) => b.id === S.homeId);
    return [
      S.allLost ? { color: '#6f7784', label: '회색 고리 = 정착지가 사라진 곳' } : { color: '#f1cb86', label: s.alien ? '고리 = 정착지가 있는 곳' : '고리 = 사람이 사는 곳' },
      { color: '#5b9bd5', label: `밝게 표시한 행성 = ${home.name} (고향)` },
    ];
  }

  /* ---------- 실험 설정 ---------- */
  const startYearOf = (opts) => (opts && opts.start === 'alien' ? 0 : (WS.Earth && WS.Earth.EPOCHS[opts && opts.start] ? WS.Earth.EPOCHS[opts.start].year : -10000));
  const HORIZONS = {
    alien: [[250, '문명 250년'], [500, '문명 500년'], [1000, '문명 1000년', true], [2000, '문명 2000년'], [3000, '문명 3000년']],
    bc10000: [[-3000, '기원전 3000년'], [1, '서기 1년'], [1500, '1500년'], [2026, '2026년 (오늘)', true], [3000, '3000년']],
    bc3000: [[1, '서기 1년'], [1000, '1000년'], [1500, '1500년'], [2026, '2026년 (오늘)', true], [3000, '3000년']],
    ad1: [[1000, '1000년'], [1500, '1500년'], [2026, '2026년 (오늘)', true], [2300, '2300년'], [3000, '3000년']],
    ad1500: [[1800, '1800년'], [1900, '1900년'], [2026, '2026년 (오늘)', true], [2300, '2300년']],
    ad1900: [[1950, '1950년'], [2026, '2026년 (오늘)', true], [2100, '2100년'], [2300, '2300년']],
    ad2026: [[2100, '2100년'], [2200, '2200년'], [2300, '2300년', true], [2500, '2500년'], [3000, '3000년']],
  };
  const horizonsOf = (opts) => HORIZONS[(opts && opts.start) || 'bc10000'] || HORIZONS.bc10000;
  // 지역 = 경도·위도 상자 몇 개의 합 [서, 동, 남, 북]
  const REG_BOX = {
    eastasia: [[98, 123, 18, 42], [115, 135, 38, 50], [124, 146, 30, 46]],
    southasia: [[60, 92, 5, 30], [60, 80, 30, 37]],
    seasia: [[92, 141, -11, 22]],
    mideast: [[34, 61, 12, 42], [25, 34, 22, 42]],
    europe: [[-11, 26, 35, 71], [26, 40, 42, 71]],
    africa: [[-18, 34, -35, 37], [34, 52, -35, 12]],
    namerica: [[-170, -52, 7, 75]],
    samerica: [[-82, -34, -56, 12]],
    oceania: [[112, 180, -48, -10], [141, 180, -10, 0]],
    russia: [[32, 60, 50, 72], [36, 50, 42, 50], [60, 180, 50, 78], [46, 80, 37, 55]],
  };
  const inBoxes = (B, lo, la) => { for (const b of B) if (lo >= b[0] && lo <= b[1] && la >= b[2] && la <= b[3]) return true; return false; };
  const EXP = {
    clock: (s) => s.year,
    axis: 'lin',
    span: (opts) => { const x0 = startYearOf(opts); const h = horizonsOf(opts).find((o) => o[2]); return [x0, h ? h[0] : x0 + 1000]; },
    horizonOptions: (opts) => horizonsOf(opts).map(([value, label, def]) => (def ? { value, label, def: true } : { value, label })),
    setHorizon(opts, x1) { opts.until = x1; },
    xfmt: (x) => (Math.round(x) === 0 ? '0년' : yearText(x)),
    maxSteps: 6000,
    metrics: [
      { key: 'pop', label: '세계 인구', get: (s) => Math.max(1, s.worldPop), log: true, scale: 0.15, fmt: (v) => ppl(v), color: '#f1cb86' },
      { key: 'temp', label: '기온 변화 (산업화 이전 대비)', get: (s) => s.Tanom(), log: false, scale: 0.5, fmt: (v) => fmtT(v), color: '#e46a4e' },
      { key: 'states', label: '나라 수', get: (s) => s.alive.length || 0.5, log: true, scale: 0.2, fmt: (v) => (v < 1 ? '없음' : `${Math.round(v)}개`), color: '#84c6d2' },
      { key: 'tech', label: '가장 앞선 기술 수준', get: (s) => (s.alive.length ? s.techNow() : s.landCells.some((c) => s.tribe[c] & 1) ? 1 : 0), log: false, scale: 2, fmt: (v) => `${Math.round(v)}/${NT}`, color: '#96cf88' },
      { key: 'top', label: '가장 큰 나라의 인구 비중', get: (s) => { const t = topPolity(s); return t ? t.popSum / Math.max(1, s.earthPop) : 0; }, log: false, scale: 0.1, fmt: (v) => pct(v), color: '#c9a0dc' },
      // 0명에서 10만 명이 되면 값이 5(로그)나 뛰므로, scale이 작으면 정착지 하나 있고 없음이 다른 지표를 모두 묻어 버림 (scale 4면 약 1.25 단위)
      { key: 'space', label: '지구 밖 인구', get: (s) => 1 + s.offworld, log: true, scale: 4, fmt: (v) => (v < 1.5 ? '없음' : ppl(v - 1)), color: '#9db8ff' },
    ],
    outcomes: OUTCOMES.map((o) => Object.assign({}, o)),
    classify: (s) => s.classify(),
    conditions: [
      { key: 'research', label: '연구 속도', desc: '모든 사회가 새 지식을 얻는 빠르기에 곱해집니다.', min: 0.5, max: 2, step: 0.05, def: 1, kind: 'mult', fmt: (v) => `×${(+v).toFixed(2)}` },
      { key: 'aggression', label: '호전성', desc: '나라들이 전쟁을 일으키는 경향입니다. 핵전쟁 위험에도 영향을 줍니다.', min: 0.25, max: 3, step: 0.05, def: 1, kind: 'mult', fmt: (v) => `×${(+v).toFixed(2)}` },
      { key: 'trade', label: '교역과 교류', desc: '기술이 퍼지는 빠르기와 이주, 나라 사이의 의존(전쟁을 줄임)에 영향을 줍니다.', min: 0.25, max: 3, step: 0.05, def: 1, kind: 'mult', fmt: (v) => `×${(+v).toFixed(2)}` },
      { key: 'climateSens', label: '기후 민감도', desc: '이산화탄소가 두 배가 되면 결국 오르는 기온입니다. 과학자들의 최선 추정은 약 3°C이고, 세계마다 이 값 근처에서 조금씩 다르게 정해집니다.', min: 1.5, max: 6, step: 0.1, def: 3, kind: 'abs', fmt: (v) => `${(+v).toFixed(1)}°C` },
      { key: 'disease', label: '전염병 위험', desc: '전염병과 대유행병(자연 발생·인공 병원체)이 생길 가능성에 곱해집니다.', min: 0.25, max: 4, step: 0.05, def: 1, kind: 'mult', fmt: (v) => `×${(+v).toFixed(2)}` },
      { key: 'aiRisk', label: '인공지능 위험', desc: '초지능이 나타났을 때 통제를 벗어날 가능성에 곱해집니다. 0이면 그런 위험이 없습니다.', min: 0, max: 3, step: 0.1, def: 1, kind: 'mult', fmt: (v) => `×${(+v).toFixed(1)}` },
      { key: 'fertility', label: '출산율', desc: '모든 사회의 출산 성향에 곱해집니다. 인구가 언제, 얼마나 크게 정점을 찍을지에 영향을 줍니다.', min: 0.5, max: 1.5, step: 0.05, def: 1, kind: 'mult', fmt: (v) => `×${(+v).toFixed(2)}` },
      { key: 'nukes', label: '핵무기', desc: '핵탄두 수와 핵무장 경향에 곱해집니다. 0이면 핵무기가 없는 세계입니다.', min: 0, max: 3, step: 0.1, def: 1, kind: 'mult', fmt: (v) => `×${(+v).toFixed(1)}` },
      { key: 'coop', label: '국제 협력', desc: '국제 협력 수준에 더해집니다. 협력은 전쟁과 핵 위험을 줄이고, 청정 에너지 전환과 초지능 관리를 돕습니다.', min: -0.3, max: 0.3, step: 0.05, def: 0, kind: 'abs', fmt: (v) => `${v >= 0 ? '+' : ''}${(+v).toFixed(2)}` },
    ],
    presets: [
      { label: '협력하는 세계', desc: '국제 협력이 높고 덜 호전적이며 교역이 활발한 세계', cond: { coop: 0.25, aggression: 0.5, trade: 1.5 } },
      { label: '분열된 세계', desc: '협력이 낮고 호전적이며, 교역이 줄고 핵무기가 많은 세계', cond: { coop: -0.25, aggression: 2, trade: 0.5, nukes: 1.5 } },
      { label: '기후에 민감한 지구', desc: '이산화탄소에 기온이 더 크게 반응하는 지구 (기후 민감도 4.5°C)', cond: { climateSens: 4.5 } },
      { label: 'AI 안전 투자', desc: '인공지능 안전 연구와 국제 공조로 초지능의 위험을 크게 줄인 세계', cond: { aiRisk: 0.3, coop: 0.1 } },
      { label: '느린 혁신', desc: '새 지식이 지금보다 절반 속도로 쌓이는 세계', cond: { research: 0.5 } },
    ],
    schedulable: ['bolt', 'harvest', 'drought', 'plague', 'genius', 'meteor', 'butterfly'],
    targets: [
      { key: 'eastasia', label: '동아시아' }, { key: 'southasia', label: '남아시아' }, { key: 'seasia', label: '동남아시아' }, { key: 'mideast', label: '중동' },
      { key: 'europe', label: '유럽' }, { key: 'africa', label: '아프리카' }, { key: 'namerica', label: '북아메리카' }, { key: 'samerica', label: '남아메리카' },
      { key: 'oceania', label: '오세아니아' }, { key: 'russia', label: '러시아·중앙아시아' }, { key: 'capital', label: '가장 큰 나라의 수도' }, { key: 'random', label: '무작위 육지' },
    ],
    target(s, key, rng) {
      const M = s.map;
      if (key === 'capital') { const t = topPolity(s); return t && t.cap >= 0 ? { c: t.cap, lo: M.lon[t.cap], la: M.lat[t.cap] } : null; }
      const B = M.earth ? REG_BOX[key] : null;
      let cells = s.landCells.filter((c) => s.pop[c] >= 1 && (!B || inBoxes(B, M.lon[c], M.lat[c])));
      if (!B) {
        // 무작위 육지 (외계 행성에서는 지역 대신): 사람이 사는 칸 중 아무 곳
        if (!cells.length) return null;
        const c = cells[Math.min(cells.length - 1, Math.floor(rng.next() * cells.length))];
        return { c, lo: M.lon[c], la: M.lat[c] };
      }
      // 국민의 절반 이상이 그 지역에 사는 나라의 땅(또는 나라 없는 땅)만: 상자에 걸친 이웃 나라의 변두리에 떨어지지 않게
      const inside = new Map();
      for (const c of cells) { const o = s.owner[c]; if (o >= 0) inside.set(o, (inside.get(o) || 0) + s.pop[c]); }
      const home = cells.filter((c) => { const o = s.owner[c]; return o < 0 || inside.get(o) >= 0.5 * s.pols[o].popSum; });
      if (home.length) cells = home;
      if (!cells.length) return null;
      // 사람이 많이 사는 곳일수록 잘 뽑힘 (그 지역에 사는 아무나 한 사람의 자리)
      let tot = 0;
      for (const c of cells) tot += s.pop[c];
      let u = rng.next() * tot, c = cells[cells.length - 1];
      for (const q of cells) { u -= s.pop[q]; if (u < 0) { c = q; break; } }
      return { c, lo: M.lon[c], la: M.lat[c] };
    },
    // 같은 씨앗의 두 세계에서 땅 주인이 같은 칸의 비율 (갈라지기 전까지는 나라 번호가 같음)
    similarity(a, b) {
      let same = 0, tot = 0;
      for (const c of a.landCells) { const x = a.owner[c], y = b.owner[c]; if (x < 0 && y < 0) continue; tot++; if (x === y) same++; }
      return tot ? same / tot : 1;
    },
    // 역사의 우연(난수의 흐름)이 매 단계 세계의 정확한 사람 수에 따라 달라짐: 개입 뒤에 '같은 주사위'를 유지할 수 없음
    chanceCoupled: true,
    extra: settleSummary, // 어느 천체로 갔는지 (결말·통계와 무관한 표현 모형)
    eventIds: ['warm2', 'warm3', 'pandemic', 'nuclearwar', 'agi', 'fusion', 'mars', 'peak', 'collapse', 'agri', 'writing', 'steam', 'fission', 'internet'],
    eventIdsFor: (opts) => (opts && opts.start === 'ad2026' ? ['warm2', 'warm3', 'pandemic', 'nuclearwar', 'agi', 'fusion', 'mars', 'peak', 'collapse']
      : opts && (opts.start === 'ad1900' || opts.start === 'ad1500') ? ['steam', 'fission', 'space', 'internet', 'ai', 'pop8b', 'warm2', 'nuclearwar', 'pandemic']
        : ['agri', 'state', 'writing', 'iron', 'empire', 'print', 'ocean', 'science', 'steam', 'fission']),
  };

  const MILESTONES = [
    { id: 'agri', name: '농경의 시작', real: -9500, realLabel: '기원전 9500년' },
    { id: 'state', name: '최초의 국가', real: -3500, realLabel: '기원전 3500년' },
    { id: 'writing', name: '문자', real: -3200, realLabel: '기원전 3200년' },
    { id: 'iron', name: '철기', real: -1200, realLabel: '기원전 1200년' },
    { id: 'empire', name: '대제국', real: -550, realLabel: '기원전 550년' },
    { id: 'print', name: '인쇄술', real: 1440, realLabel: '1440년' },
    { id: 'ocean', name: '대양 건너 식민', real: 1492, realLabel: '1492년' },
    { id: 'science', name: '과학 혁명', real: 1600, realLabel: '1600년경' },
    { id: 'steam', name: '산업 혁명', real: 1760, realLabel: '1760년' },
    { id: 'pop1b', name: '세계 인구 10억', real: 1804, realLabel: '1804년' },
    { id: 'fission', name: '핵무기', real: 1945, realLabel: '1945년' },
    { id: 'space', name: '우주 진출', real: 1957, realLabel: '1957년' },
    { id: 'internet', name: '인터넷', real: 1990, realLabel: '1990년' },
    { id: 'pop8b', name: '세계 인구 80억', real: 2022, realLabel: '2022년' },
    { id: 'ai', name: '인공지능', real: 2023, realLabel: '2020년대' },
    { id: 'warm2', name: '기온 +2°C', real: null, realLabel: '아직 (2026년 약 +1.4°C)' },
    { id: 'pandemic', name: '대유행병 (인류 3% 이상 사망)', real: null, realLabel: '아직 (1918년 독감은 약 2~3%)' },
    { id: 'nuclearwar', name: '핵전쟁', real: null, realLabel: '일어나지 않음' },
    { id: 'fusion', name: '핵융합 발전', real: null, realLabel: '아직' },
    { id: 'agi', name: '초지능', real: null, realLabel: '아직' },
    { id: 'peak', name: '세계 인구 정점', real: null, realLabel: '아직 (UN 전망 2080년대)' },
    { id: 'warm3', name: '기온 +3°C', real: null, realLabel: '아직' },
    { id: 'collapse', name: '문명 붕괴 위기 (회복 포함)', real: null, realLabel: '일어나지 않음' },
    { id: 'mars', name: '다른 행성 정착', real: null, realLabel: '아직' },
    { id: 'star', name: '항성 간 항해', real: null, realLabel: '아직' },
  ];
  /* 지금 화면에 띄운 세계가 시작하기 전에 이미 지나간 사건('시작 이전')은 비교 표의 아래로 보냅니다.
     2026년 출발이면 앞으로 일어날 수 있는 일(기온, 핵전쟁, 초지능, 인구 정점 …)이 표의 맨 위에 옵니다. 순서만 바뀌고 내용은 그대로입니다. */
  const orderMilestones = (pre) => (pre.size ? MILESTONES.filter((m) => !pre.has(m.id)).concat(MILESTONES.filter((m) => pre.has(m.id))) : MILESTONES);

  const yearTf = (v) => -Math.log10(3300 - Math.min(3299, v));

  uiMilestones = MILESTONES;

  const COMPARE_ALL = { min: -10000, max: 3100, tf: yearTf, ticks: [[-10000, '-1만'], [-3000, '-3000'], [0, '0'], [1500, '1500'], [1900, '1900'], [2026, '2026'], [2100, '2100']] };
  uiCompare = COMPARE_ALL;
  /* 비교 그림의 가로축: 화면에 띄운 세계가 시작한 해부터 끝나는 해까지만 그립니다. 축이 역사 전체(기원전 1만 년 ~ 3100년)이면
     늦게 출발한 세계의 사건은 좁은 구간에 몰려 번호가 겹칩니다.
     - 1500년 이후 출발: 사건이 몰리는 앞쪽(출발 ~ 2100년, 또는 출발 + 150년)에 폭의 약 2/3를 줍니다.
     - 그보다 이른 출발: 옛 시대는 드문드문하므로 끝으로 갈수록 넓어지는 로그 눈금 (끝이 3000년이면 예전 눈금과 같음).
     범위 밖의 사건은 tf가 NaN을 돌려주어 점을 찍지 않습니다 (캔버스는 NaN 좌표를 그리지 않음). 표에는 그대로 남습니다. */
  const compareFor = (s, e) => {
    const LO = 0.035, HI = 0.965; // 양 끝 눈금 글자가 잘리지 않을 여백
    const min = s - 0.5, max = e + 0.5;
    let f;
    if (s >= 1500) {
      const mid = Math.max(2100, s + 150);
      f = e > mid ? (v) => (v <= mid ? (0.7 * (v - s)) / (mid - s) : 0.7 + (0.3 * (v - mid)) / (e - mid)) : (v) => (v - s) / (e - s);
    } else {
      const l = (v) => -Math.log10(e + 300 - v);
      f = (v) => (l(v) - l(s)) / (l(e) - l(s));
    }
    const slack = Math.max(3, (e - s) * 0.002); // 마지막 걸음이 끝을 조금 넘을 수 있음
    const tf = (v) => (v === min ? 0 : v === max ? 1 : v < s || v > e + slack ? NaN : LO + (HI - LO) * f(Math.min(v, e)));
    // 눈금: 앞에 있는 후보부터 고르고, 이미 고른 눈금과 너무 가까우면 건너뜁니다.
    const cand = s >= 1500 ? [s, e, 2026, 2100, 1900, 1800, 2200, 2000, 1950, 2300, 2050, 2150, 1700, 1600, 2500]
      : [s, e, 2026, 0, 1500, -3000, 1000, 2300, 1900, 500, -5000, 2100, 2500];
    const picks = [];
    cand.forEach((v) => { if (v >= s && v <= e && !picks.some((p) => Math.abs(f(p) - f(v)) < 0.11)) picks.push(v); });
    picks.sort((a, b) => a - b);
    return { min, max, tf, ticks: picks.map((v) => [v, v === -10000 ? '-1만' : String(v)]) };
  };

  WS.registerMode({
    id: 'civ',
    name: '문명',
    when: '1만 년 전 ~ 미래',
    question: '역사는 다시 같은 길을 갈까? 인류는 어디로 갈까?',
    desc: '실제 지구 지도 위에서 시작합니다. 농경이 어디서 먼저 시작되는지, 어떤 나라가 일어나고 무너지는지, 산업 혁명과 핵무기, 기후 변화와 인공지능을 지나 인류가 어디에 이르는지 지켜봅니다. 2026년에서 시작하면 오늘의 세계(인구 약 82억 명, 기온 +1.4°C, 핵보유국 9개)에서 미래를 봅니다.',
    setup: [{ id: 'start', label: '시작 시점', value: 'bc10000', options: [['bc10000', '기원전 1만 년 (수렵채집)'], ['bc3000', '기원전 3000년 (첫 문명들)'], ['ad1', '서기 1년 (로마와 한)'], ['ad1500', '서기 1500년 (대항해 직전)'], ['ad1900', '서기 1900년 (제국주의)'], ['ad2026', '2026년 (현재에서 미래로)']] }],
    baseRate: 10,
    sampleEvery: 4,
    powerRegenSec: 7,
    views: ['나라', '인구', '기술', '기후 피해', '태양계'],
    space: { view: SPACE_VIEW, scene: spaceScene, inspect: spaceInspect, impactSeq: (s) => s.impactN, site: spaceSite, prepare: function* (s) { while (!globeStep(s.map, 1)) yield; } },
    create: (opts, seed, inherit) => new Civ(opts, seed, inherit),
    step: (s) => { s.tick(); },
    render,
    era,
    stats,
    pick,
    inspect,
    narrate,
    legend,
    eventArt(s, e) {
      // 외계 문명: 연대기 그림으로 그 종의 초상을 씀
      if (!s.alien || !WS.Creature || !s.inherit || !s.inherit.genome || !s.inherit.traits || !e || (e.kind !== 'milestone' && e.kind !== 'end')) return null;
      try { return WS.Creature.portrait(s.inherit.genome, s.inherit.traits, 64, 'civ-species-' + s.seed); } catch (err) { return null; }
    },
    sample: (s) => ({ pop: s.worldPop, n: s.alive.length, tech: s.techNow(), T: s.Tanom(), co2: s.co2 }),
    chart: [
      { key: 'pop', label: '세계 인구', color: '#f1cb86', log: true, fmt: (v) => ppl(v) },
      { key: 'T', label: '기온 변화', color: '#e46a4e', fmt: (v) => fmtT(v) },
      { key: 'n', label: '나라 수', color: '#84c6d2', fmt: (v) => `${Math.round(v)}개` },
      { key: 'tech', label: '최고 기술', color: '#96cf88', fmt: (v) => `${Math.round(v)}/${NT}` },
      { key: 'co2', label: 'CO₂', color: '#b8b1a3', fmt: (v) => `${Math.round(v)} ppm` },
    ],
    interventions: [
      {
        id: 'bolt', name: '번개', icon: 'bolt', cost: 1, target: 'point',
        desc: '하늘에서 번개를 내립니다. 과학 이전의 사람들은 이것을 신의 뜻으로 해석합니다. 좋은 징조일지 나쁜 징조일지는 그들이 정합니다.',
        apply(s, w) {
          s.addFx({ type: 'bolt', x: w.lo, y: w.la, life: 0.7 });
          const o = s.owner[w.c];
          if (o < 0) return '번개가 사람 없는 들판에 떨어졌습니다';
          const p = s.pols[o];
          if (p.known[TI.science]) return `${p.name} 사람들은 번개를 그저 날씨로 여겼습니다`;
          const good = s.rng.chance(0.5);
          p.stab = WS.clamp(p.stab + (good ? 0.3 : -0.35), 0.1, 1);
          return `${p.name} 사람들은 번개를 ${good ? '하늘의 축복으로 여겨 단결했습니다' : '하늘의 분노로 여겨 동요했습니다'}`;
        },
      },
      {
        id: 'harvest', name: '풍년', icon: 'sun', cost: 2, target: 'point',
        desc: '고른 지역에 몇 년 동안 날씨가 좋습니다. 인구가 늘고 나라가 안정됩니다.',
        apply(s, w) { s.regionK(w.c, 4, 1.7, 30); const o = s.owner[w.c]; if (o >= 0) s.pols[o].stab = Math.min(1, s.pols[o].stab + 0.2); return `${s.regionName(w.c)}에 풍년이 이어집니다`; },
      },
      {
        id: 'drought', name: '가뭄', icon: 'drought', cost: 2, target: 'point',
        desc: '고른 지역에 긴 가뭄이 듭니다. 기근과 이주, 반란이 뒤따를 수 있습니다.',
        apply(s, w) { s.regionK(w.c, 4, 0.35, 25); const o = s.owner[w.c]; if (o >= 0) s.pols[o].stab *= 0.6; s.lastCat = { year: s.year, kind: '대가뭄' }; s.mark('climate', w.c); return `${s.regionName(w.c)}에 큰 가뭄이 들었습니다`; },
      },
      {
        id: 'plague', name: '역병', icon: 'plague', cost: 3, target: 'point',
        desc: '고른 곳에서 전염병이 시작됩니다. 면역과 의학 수준에 따라 피해가 다릅니다.',
        apply(s, w) {
          const place = s.regionName(w.c);
          const dead = s.epidemicAt(w.c, 0.45, 12, `${place}에서 시작된 역병`, false, true);
          s.addFx({ type: 'ring', x: w.lo, y: w.la, r: 30, r0: 3, life: 1.8, color: [190, 230, 120] });
          return dead >= 1 ? `${place}에서 시작된 역병으로 ${tollText(s, dead)}이 목숨을 잃었습니다` : `${place}에서 역병이 돌았지만 희생자는 거의 없었습니다`;
        },
      },
      {
        id: 'genius', name: '천재의 탄생', icon: 'bulb', cost: 3, target: 'point',
        desc: '고른 곳에 한 세대에 한 번 나올 천재가 태어납니다. 그 나라의 연구가 크게 빨라집니다.',
        apply(s, w) {
          const o = s.owner[w.c];
          if (o < 0) return false;
          const p = s.pols[o];
          p.boost = (p.boost || 0) + 3;
          p.rp += 50 + Math.min(p.rp, 2e5 + p.rpEff * 5);
          s.mark('discovery', w.c);
          return `${p.name}에 천재가 태어났습니다`;
        },
      },
      {
        id: 'meteor', name: '운석', icon: 'meteor', cost: 5, target: 'point',
        desc: '고른 곳에 운석이 떨어집니다. 주변이 초토화되고 하늘이 잠시 어두워집니다.',
        apply(s, w) {
          const M = s.map, x0 = w.c % M.W, y0 = (w.c / M.W) | 0;
          let dead = 0;
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const y = y0 + dy;
            if (y < 0 || y >= M.H) continue;
            const c = y * M.W + ((x0 + dx + M.W) % M.W);
            dead += s.pop[c] * 0.9; s.pop[c] *= 0.1;
          }
          s.winter += 1.5;
          s.lastCat = { year: s.year, kind: '운석 충돌' };
          s.impactN++;
          s.impacts.push({ n: s.impactN, year: s.year, D: null, lo: w.lo, la: w.la, dead });
          if (s.impacts.length > 16) s.impacts.shift();
          s.addFx({ type: 'flash', x: w.lo, y: w.la, r: 10, life: 1.6, color: [255, 210, 150] });
          s.addFx({ type: 'ring', x: w.lo, y: w.la, r: 25, r0: 3, life: 2, color: [255, 150, 90] });
          return dead >= 1 ? `운석이 떨어져 ${tollText(s, dead)}이 목숨을 잃었습니다` : '운석이 사람이 없는 곳에 떨어졌습니다';
        },
      },
      {
        id: 'butterfly', name: '나비의 날갯짓', icon: 'butterfly', cost: 1, target: 'global', labOnly: true,
        desc: '세계 어딘가에 사람 한 명을 더합니다. 이렇게 작은 차이가 시간이 흐르며 커지는지(나비 효과) 알아보는 실험용 개입입니다.',
        apply(s) {
          let c = -1;
          for (let k = 0; k < 64 && c < 0; k++) { const q = s.landCells[s.rng.int(0, s.landCells.length - 1)]; if (s.pop[q] >= 1) c = q; }
          if (c < 0) c = s.landCells.reduce((b, q) => (s.pop[q] > s.pop[b] ? q : b), s.landCells[0]);
          s.pop[c] += 1;
          return `${s.regionName(c)}에 한 사람이 더 태어났습니다`;
        },
      },
    ],
    extra: {
      label: '세계 정세',
      render(s, el) {
        const top = s.alive.slice().sort((a, b) => b.popSum - a.popSum).slice(0, 14);
        const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
        let wh = 0;
        for (const p of s.alive) wh += p.wh;
        const head = `<div class="civ-world" style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;align-items:center;margin-bottom:10px">`
          + `<div class="civ-species"></div><div style="font-size:12.5px;line-height:1.55">`
          + (s.alien ? `<b>${esc(s.speciesName || '지성 종')}</b>의 문명 · ${esc(s.planetName || '')}<br>` : '')
          + `세계 인구 <b>${esc(ppl(s.worldPop))}</b> · 기온 <b>${esc(fmtT(s.Tanom()))}</b> · CO₂ ${Math.round(s.co2)} ppm<br>`
          + `국제 협력 ${pct(s.coop)} · 청정 에너지 ${pct(s.cleanShare())} · 핵탄두 ${esc(WS.fmtCount(wh, '발'))}`
          + (s.offworld >= 1 ? ` · ${s.settle.out} ${esc(ppl(s.offworld))}` : '') + `</div></div>`;
        el.innerHTML = head + '<div class="extra-list">' + top.map((p) => {
          const wars = p.wars.size ? ` · 전쟁: ${[...p.wars.keys()].map((q) => esc(s.pols[q].name)).join(', ')}` : '';
          const demo = p.modern && p.tfr !== undefined ? ` · 출산율 ${p.tfr.toFixed(1)}` : '';
          return `<div class="sp"><span class="sw" style="background:${WS.rgb(p.color)}"></span><div><div class="nm">${esc(p.name)}${p.wh > 0 ? ' ☢' : ''}</div><div class="tr">${GOV[p.gov]} · ${eraOf(s, p)} · 영토 ${esc(WS.fmtCount(p.area, 'km²'))}${demo}${wars}</div></div><div class="bm">${esc(ppl(p.popSum))}</div></div>`;
        }).join('') + '</div>';
        if (s.alien && WS.Creature && s.inherit && s.inherit.genome && s.inherit.traits) {
          try {
            const cv = WS.Creature.portrait(s.inherit.genome, s.inherit.traits, 72, 'civ-species-' + s.seed);
            const box = el.querySelector('.civ-species');
            if (cv && box) { cv.style.width = '72px'; cv.style.height = '72px'; box.appendChild(cv); }
          } catch (err) { /* 초상이 없어도 목록은 보여 줌 */ }
        }
      },
    },
    get milestones() { return uiMilestones; },
    realName: '실제 역사',
    get compare() { return uiCompare; },
    experiment: EXP,
    batch: {
      maxSteps: 4000,
      defaultN: 30,
      key: ['agri', 'writing', 'steam', 'fission', 'internet'],
      fmt: (v) => calText(v),
      finish: (s) => { s.end('관측 종료', '', s.outcomeText()); },
      desc: '같은 시작 시점에서 씨앗만 바꿔 역사를 여러 번 다시 돌립니다.',
    },
  });

  if (!WS.icons.butterfly) WS.icons.butterfly = '<path d="M12 7v12M12 9c-2-4-7-6-8-3s1 6 8 5M12 9c2-4 7-6 8-3s-1 6-8 5M12 13c-2 2-6 4-6 6s4 1 6-3M12 13c2 2 6 4 6 6s-4 1-6-3"/>';
  WS.CivSim = Civ;
  WS.CivTech = { TECH, TI, ERA, OUTCOMES };
})();
