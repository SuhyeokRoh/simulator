'use strict';
/* 창세 관측소 — 실험 작업자 (Web Worker). 세계 하나(또는 쌍둥이 한 쌍)를 화면 없이 돌려 결과를 돌려줍니다.
   메시지: {type:'init', scripts:[url...]} (선택: 페이지가 읽은 스크립트와 같은 파일을 쓰도록), {type:'run', id, spec}
   응답:   {type:'ready'}, {type:'progress', id, p}, {type:'result', id, result}, {type:'error', id, message}, {type:'fatal', message} */
self.window = self;
(function () {
  // 경로는 이 파일 기준
  const DEFAULT = ['core.js', 'creature.js', 'earth.js', 'universe.js', 'stellar.js', 'life.js', 'civ.js', 'labcore.js'];
  let loaded = false;
  const errs = [];
  function load(list) {
    if (loaded) return;
    loaded = true;
    // 하나가 없어도(예: 선택 파일) 나머지는 읽습니다
    for (const s of list) { try { importScripts(s); } catch (e) { errs.push(s + ': ' + ((e && e.message) || e)); } }
    if (!self.WS || !self.WS.LabCore || !self.WS.modes) throw new Error('필수 스크립트를 읽지 못했습니다 · ' + errs.join(' / '));
  }
  self.onmessage = (ev) => {
    const d = ev.data || {};
    try {
      if (d.type === 'init') {
        load(d.scripts && d.scripts.length ? d.scripts : DEFAULT);
        self.postMessage({ type: 'ready', modes: Object.keys(self.WS.modes), errs });
        return;
      }
      if (d.type === 'run') {
        load(DEFAULT);
        const spec = d.spec || {};
        // 이 작업자에 모드가 없으면 메인 스레드가 대신 하도록 알립니다
        if (!self.WS.modes[spec.modeId]) { self.postMessage({ type: 'fatal', id: d.id, message: 'mode missing: ' + spec.modeId }); return; }
        let job;
        try { job = self.WS.LabCore.makeJob(spec); } catch (e) { self.postMessage({ type: 'error', id: d.id, message: String((e && e.message) || e) }); return; }
        let last = 0;
        while (!job.advance(120)) {
          const t = performance.now();
          if (t - last > 150) { last = t; self.postMessage({ type: 'progress', id: d.id, p: job.progress }); }
        }
        self.postMessage({ type: 'result', id: d.id, result: job.result });
      }
    } catch (e) {
      self.postMessage({ type: 'fatal', id: d.id, message: String((e && e.message) || e) });
    }
  };
})();
