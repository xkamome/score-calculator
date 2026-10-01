(function () {
  'use strict';
  const M = window.ScoreModel;
  const { GAMES, normalDist, triModel, TRI_DEFAULT, ddrPredict, ddrFromCat, withoutMiss, categoryProbs, calibrateDdr, floor10, rankOf, absQuantile, playScore, playSteps } = M;
  const {
    $, $$, clamp, round, store, sup, pct, int, small, expo, reach, signedInt,
    later, L, T, C, drawChart, niceStep, ticks, interp, rulerRow, judgeName, bindNumber
  } = window.UI;
  const G = GAMES.ddr;
  const SD_MIN = 5, SD_MAX = 25;

  // ---------- 三態模型參數：頁面上用好懂的單位，計算時換成 model.js 的參數 ----------
  // pLo／pHi：SD 8／16 時「不太準」的比例；acc12：SD 12 時每 1000 步的出事數；
  // accX：SD 每 +1 ms 出事率的倍數；missShare：出事之中變成 MISS 的比例
  const logit = v => Math.log(v / (1 - v));
  const sigm = x => 1 / (1 + Math.exp(-x));
  function toPrm(f) {
    const lo = logit(f.pLo), hi = logit(f.pHi);
    return {
      alA: f.alA, alB: f.alB,
      p1: (hi - lo) / 8, p0: (lo + hi) / 2,          // SD 8 與 16 的中點是 12
      g0: Math.log(f.acc12 / 1000 * (1 - f.missShare)),
      m0: Math.log(f.acc12 / 1000 * f.missShare),
      c1: Math.log(f.accX)
    };
  }
  function fromPrm(p) {
    const eg = Math.exp(p.g0), em = Math.exp(p.m0);
    return {
      alA: p.alA, alB: p.alB,
      pLo: sigm(p.p0 - 4 * p.p1), pHi: sigm(p.p0 + 4 * p.p1),
      acc12: 1000 * (eg + em), accX: Math.exp(p.c1), missShare: eg + em > 0 ? em / (eg + em) : 0.5
    };
  }
  const TRI_CTRLS = [
    { key: 'alA', label: '超準態形狀 α<sub>A</sub>', min: 1, max: 8, step: 0.05, fmt: v => v.toFixed(2) },
    { key: 'alB', label: '不太準態形狀 α<sub>B</sub>', min: 1, max: 40, step: 0.1, fmt: v => v.toFixed(1) },
    { key: 'pLo', label: 'SD 8 時不太準的比例', min: 0.01, max: 0.95, step: 0.005, fmt: v => pct(v, 1) },
    { key: 'pHi', label: 'SD 16 時不太準的比例', min: 0.02, max: 0.99, step: 0.005, fmt: v => pct(v, 1) },
    { key: 'acc12', label: 'SD 12 時的出事率', min: 0, max: 10, step: 0.05, fmt: v => v.toFixed(2) + ' ／千步' },
    { key: 'accX', label: 'SD 每 +1 ms，出事率 ×', min: 1, max: 3, step: 0.01, fmt: v => '× ' + v.toFixed(2) },
    { key: 'missShare', label: '出事之中 MISS 的比例', min: 0.02, max: 0.98, step: 0.01, fmt: v => pct(v, 0) }
  ];
  const clampTri = f => Object.fromEntries(TRI_CTRLS.map(c => [c.key, clamp(isFinite(f[c.key]) ? f[c.key] : c.min, c.min, c.max)]));

  // ---------- 狀態 ----------
  const EXAMPLE_PLAYS = (window.DDR_PLAYS || []).map(p => ({
    sd: p.sd, mean: p.mean, marv: p.marv, perf: p.perf, great: p.great, good: p.good, miss: p.miss, ok: p.ok, ng: p.ng || 0
  }));
  const FIELDS = ['sd', 'mean', 'marv', 'perf', 'great', 'good', 'miss', 'ok', 'ng'];
  const DEFAULT = {
    sd: 12, mean: 0, chart: { steps: 500, freezes: 20, shocks: 0 },
    k: 1, tri: fromPrm(TRI_DEFAULT), logY: false, noMiss: false,
    plays: EXAMPLE_PLAYS
  };
  const { S, save } = store('ddr-model-v2', DEFAULT);
  const num = v => (v === null || v === undefined || v === '' ? NaN : Number(v));   // 存檔時 NaN 會變成 null
  // ng 是後來加的欄位，舊存檔沒有時當作 0
  S.plays = S.plays.filter(p => p && typeof p === 'object').map(p => Object.fromEntries(FIELDS.map(f => [f, f === 'ng' && p[f] === undefined ? 0 : num(p[f])])));
  S.tri = clampTri(S.tri);

  const chartObj = () => ({ steps: S.chart.steps, freezes: S.chart.freezes + S.chart.shocks });
  const money = v => int(floor10(v));
  const rankName = v => rankOf(G, v / 1e6)?.name ?? '未達 A';
  const triOf = sd => triModel(sd, S.mean, toPrm(S.tri));
  // 「假設沒有 MISS」時，兩個模型都把 MISS 機率拿掉再算
  const predict = (dist, ch) => S.noMiss ? ddrFromCat(withoutMiss(categoryProbs(dist, G.windows)), ch) : ddrPredict(dist, ch);
  const pNormal = (sd, ch = chartObj()) => predict(normalDist(S.k * sd, S.mean), ch);
  const pTri = (sd, ch = chartObj()) => predict(triOf(sd).dist, ch);
  const cnt = v => v >= 99.95 ? int(v) : v >= 0.05 ? v.toFixed(1) : v > 0 ? small(v).replace('%', '') : '0';

  // =====================================================================
  // 兩個模型
  // =====================================================================
  function setRank(el, score) {
    const r = rankOf(G, score / 1e6);
    el.textContent = r ? r.name : '未達 A';
    el.classList.toggle('none', !r);
  }
  const chips = r => [['PFC', r.pfc], ['GFC', r.gfc], ['FC', r.fc]]
    .map(([k, v]) => `<span class="chip"><b>${k}</b><span>${reach(v)}</span></span>`).join('');

  function renderModels() {
    const sd = S.sd, ch = chartObj();
    const rn = pNormal(sd, ch);
    const tm = triOf(sd), rt = predict(tm.dist, ch);
    const U = 1e6 / (ch.steps + ch.freezes);

    $('#c-hint').textContent = `每個物件 U = ${U.toFixed(2)} 分；一個 GREAT 少 ${int(0.4 * U + 10)} 分，一個 MISS 少 ${int(U)} 分，一個 PERFECT 只少 10 分。`;

    $('#k-out').textContent = S.k.toFixed(3);
    $('#n-derived').innerHTML = `<div><dt>實際 σ</dt><dd>${(S.k * sd).toFixed(2)} ms</dd></div>`;
    $('#n-score').textContent = money(rn.score);
    setRank($('#n-rank'), rn.score);
    $('#n-chips').innerHTML = chips(rn);

    for (const c of TRI_CTRLS) $(`#t-${c.key}-out`).textContent = c.fmt(S.tri[c.key]);
    $('#t-derived').innerHTML = [
      ['不太準的比例', pct(tm.p, 1)],
      ['不太準的寬度', tm.p > 0 ? '±' + tm.b.toFixed(1) + ' ms' : '—'],
      ['出事（整首）', `GOOD ${cnt(tm.pg * ch.steps)}・MISS ${S.noMiss ? '0（假設）' : cnt(tm.pm * ch.steps)}`],
      ['模型 SD', tm.modelSd.toFixed(2) + ' ms']
    ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    const warn = $('#t-warn');
    const gap = tm.state === 'capped' && Math.abs(tm.modelSd - sd) >= 0.05;
    warn.hidden = !(tm.state === 'tight' || gap);
    warn.textContent = tm.state === 'tight'
      ? `SD 比超準態本身還小，視為全部超準，超準的範圍縮成 ±${tm.aA.toFixed(1)} ms。`
      : gap ? `不太準的寬度已經到 GREAT 邊界（±91.67 ms），比例由上面的參數決定，所以模型 SD（${tm.modelSd.toFixed(2)} ms）和輸入的 SD 不完全相同。` : '';
    $('#t-score').textContent = money(rt.score);
    setRank($('#t-rank'), rt.score);
    $('#t-chips').innerHTML = chips(rt);

    const qn = absQuantile(normalDist(S.k * sd, S.mean), 0.5), qt = absQuantile(tm.dist, 0.5);
    const rows = [
      ['期望分數', `${money(rn.score)}（${rankName(rn.score)}）`, `${money(rt.score)}（${rankName(rt.score)}）`],
      ['EX 分數率', pct(rn.ex / rn.exMax), pct(rt.ex / rt.exMax)],
      ...G.judgments.map((name, i) => [name, cnt(rn.counts[i]) + ' 步', cnt(rt.counts[i]) + ' 步', true]),
      ['PFC 機率', reach(rn.pfc), reach(rt.pfc)],
      ['GFC 機率', reach(rn.gfc), reach(rt.gfc)],
      ['FC 機率', reach(rn.fc), reach(rt.fc)],
      ['一半的步落在', '±' + qn.toFixed(2) + ' ms', '±' + qt.toFixed(2) + ' ms']
    ];
    $('#cmp tbody').innerHTML = rows.map(([k, a, b, sub]) =>
      `<tr><th class="${sub ? 'indent' : ''}">${k}</th><td>${a}</td><td>${b}</td></tr>`).join('');

    drawDensity(normalDist(S.k * sd, S.mean), tm.dist);
    drawCurves();
  }

  const SEGS = ['MARV', 'PERF', 'GREAT', 'GOOD', 'MISS'];
  function drawDensity(dn, dt) {
    const a = [], b = [];
    for (let x = -160; x <= 160; x += 0.5) { a.push([x, dn.pdf(x) * 100]); b.push([x, dt.pdf(x) * 100]); }
    const peak = Math.max(...a.map(p => p[1]), ...b.map(p => p[1]));
    let Y;
    if (S.logY) {
      const top = Math.ceil(Math.log10(peak)), tk = [];
      for (let e = -6; e <= top; e += 2) tk.push(10 ** e);
      Y = { log: true, min: 1e-6, max: 10 ** top, ticks: tk, fmt: v => '10' + sup(Math.round(Math.log10(v))) };
    } else {
      const step = niceStep(peak * 1.08, 4), top = Math.ceil(peak * 1.08 / step) * step;
      Y = { min: 0, max: top, ticks: ticks(0, top, step), fmt: v => (step < 1 ? v.toFixed(1) : String(v)) + '%' };
    }
    const RH = 20;
    drawChart($('#chartD'), {
      height: 300,
      margin: { t: 16, b: 38 + RH + 22, l: 50, r: 16 },
      xTickGap: RH + 10,
      x: { min: -160, max: 160, ticks: [-150, -100, -50, 0, 50, 100, 150], fmt: v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) },
      y: Y,
      series: [{ points: a, color: 'var(--c-normal)' }, { points: b, color: 'var(--c-tri)' }],
      under: c => {
        const y0 = c.m.t + c.ph + 6;
        let o = rulerRow(c, y0, RH, G.windows, SEGS, 'ddr') + T(c.m.l - 8, y0 + RH / 2 + 4, 'DDR', 'row-lbl', 'end');
        const ay = c.H - 6;
        o += T(c.m.l, ay, '← SLOW（晚）', 'axis-title', 'start') + T(c.m.l + c.pw / 2, ay, 'ms', 'axis-title', 'middle');
        o += T(c.m.l + c.pw, ay, 'FAST（早）→', 'axis-title', 'end');
        return o;
      },
      hover: xv => {
        const x = round(xv, 1), va = dn.pdf(x) * 100, vb = dt.pdf(x) * 100;
        const f = v => v >= 0.001 ? v.toFixed(3) + '%' : v > 1e-300 ? expo(v) + '%' : '≈ 0';
        return {
          x, title: `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(1)} ms`,
          points: [{ y: va, color: 'var(--c-normal)' }, { y: vb, color: 'var(--c-tri)' }],
          rows: [
            { color: 'var(--c-normal)', label: '常態', value: f(va) },
            { color: 'var(--c-tri)', label: '三態', value: f(vb) },
            { label: '判定', value: judgeName(G.windows, G.judgments, x) }
          ]
        };
      }
    });
  }

  // ---------- SD 曲線：分數、PFC、GFC ----------
  let curveCache = null;
  function curves() {
    const key = [S.k, S.mean, S.noMiss, ...TRI_CTRLS.map(c => S.tri[c.key]), S.chart.steps, S.chart.freezes, S.chart.shocks].join('/');
    if (curveCache && curveCache.key === key) return curveCache;
    const n = { score: [], pfc: [], gfc: [] }, t = { score: [], pfc: [], gfc: [] };
    for (let sd = SD_MIN; sd <= SD_MAX + 1e-9; sd += 0.25) {
      const a = pNormal(sd), b = pTri(sd);
      n.score.push([sd, a.score]); n.pfc.push([sd, a.pfc * 100]); n.gfc.push([sd, a.gfc * 100]);
      t.score.push([sd, b.score]); t.pfc.push([sd, b.pfc * 100]); t.gfc.push([sd, b.gfc * 100]);
    }
    return (curveCache = { key, n, t });
  }

  const X_SD = { min: SD_MIN, max: SD_MAX, ticks: [5, 10, 15, 20, 25], fmt: v => v + ' ms' };
  const cursor = (c, label) => {
    const x = c.xs(S.sd).toFixed(1), right = S.sd > SD_MAX - 4;
    return L(x, c.m.t, x, c.m.t + c.ph, 'cursor') +
      (label ? T(right ? +x - 6 : +x + 6, c.m.t + 12, `SD ${S.sd.toFixed(1)}`, 'cursor-lbl', right ? 'end' : 'start') : '');
  };

  function drawCurves() {
    const K = curves();
    const plays = validPlays().map(p => ({ sd: p.sd, score: playScore(p) }));
    const lows = [K.n.score[K.n.score.length - 1][1], K.t.score[K.t.score.length - 1][1], ...plays.map(p => p.score)];
    const low = Math.min(...lows);
    const step = niceStep(1e6 - low, 5);
    const Y0 = Math.max(0, Math.floor(low / step) * step);
    drawChart($('#chartS'), {
      height: 360,
      margin: { l: 70, r: 18, t: 20 },
      x: X_SD,
      y: { min: Y0, max: 1e6, ticks: ticks(Y0, 1e6, step), fmt: v => int(v) },
      series: [{ points: K.n.score, color: 'var(--c-normal)' }, { points: K.t.score, color: 'var(--c-tri)' }],
      under: c => {
        let o = '';
        for (const r of G.ranks) {
          const v = r.rate * 1e6;
          if (v <= Y0 || r.name === 'AA−') continue;
          const y = c.ys(v).toFixed(1);
          o += L(c.m.l, y, c.m.l + c.pw, y, 'guide') + T(c.m.l + c.pw - 4, +y - 5, r.name, 'guide-lbl', 'end');
        }
        return o + cursor(c, true);
      },
      over: c => plays.filter(p => p.sd >= SD_MIN && p.sd <= SD_MAX)
        .map(p => C(c.xs(p.sd).toFixed(1), c.ys(p.score).toFixed(1), 5, 'dot', 'var(--ink)')).join(''),
      hover: xv => {
        const x = round(xv, 2), a = interp(K.n.score, x), b = interp(K.t.score, x);
        const near = plays.filter(p => Math.abs(p.sd - x) <= 0.3);
        return {
          x, title: `SD ${x.toFixed(2)} ms`,
          points: [{ y: a, color: 'var(--c-normal)' }, { y: b, color: 'var(--c-tri)' }],
          rows: [
            { color: 'var(--c-normal)', label: '常態', value: `${money(a)} ${rankName(a)}` },
            { color: 'var(--c-tri)', label: '三態', value: `${money(b)} ${rankName(b)}` },
            ...near.map(p => ({ color: 'var(--ink)', label: `你的成績（SD ${p.sd}）`, value: int(p.score) }))
          ]
        };
      },
      onClick: xv => setSd(xv)
    });

    const probChart = (id, key, label) => drawChart($(id), {
      height: 230,
      margin: { l: 46, r: 14, t: 16 },
      x: X_SD,
      y: { min: 0, max: 100, ticks: [0, 25, 50, 75, 100], fmt: v => v + '%' },
      series: [{ points: K.n[key], color: 'var(--c-normal)' }, { points: K.t[key], color: 'var(--c-tri)' }],
      under: c => cursor(c, false),
      hover: xv => {
        const x = round(xv, 2), a = interp(K.n[key], x), b = interp(K.t[key], x);
        return {
          x, title: `SD ${x.toFixed(2)} ms　${label}`,
          points: [{ y: a, color: 'var(--c-normal)' }, { y: b, color: 'var(--c-tri)' }],
          rows: [
            { color: 'var(--c-normal)', label: '常態', value: reach(a / 100) },
            { color: 'var(--c-tri)', label: '三態', value: reach(b / 100) }
          ]
        };
      },
      onClick: xv => setSd(xv)
    });
    probChart('#chartP', 'pfc', 'PFC');
    probChart('#chartG', 'gfc', 'GFC');
  }

  // =====================================================================
  // 校準
  // =====================================================================
  const COUNT_FIELDS = ['marv', 'perf', 'great', 'good', 'miss', 'ok', 'ng'];
  const isCount = v => Number.isInteger(v) && v >= 0;
  const isValid = p => p.sd >= 3 && p.sd <= 60 && Math.abs(p.mean) <= 30 &&
    COUNT_FIELDS.every(f => isCount(p[f])) && playSteps(p) >= 10;
  const validPlays = () => S.plays.filter(isValid);
  let lastCal = null;

  const COLS = [
    ['sd', '顯示 SD', 0.1, 'sm'], ['mean', '平均', 0.1, 'sm'],
    ['marv', 'MARV', 1, 'cnt'], ['perf', 'PERF', 1, 'cnt'], ['great', 'GREAT', 1, 'cnt'],
    ['good', 'GOOD', 1, 'cnt'], ['miss', 'MISS', 1, 'cnt'], ['ok', 'O.K.', 1, 'cnt'], ['ng', 'N.G.', 1, 'cnt']
  ];
  function renderPlaysTable() {
    $('#plays tbody').innerHTML = S.plays.map((p, i) => `
      <tr data-i="${i}">
        <td>${i + 1}</td>
        ${COLS.map(([f, name, step, cls]) => `<td><input type="number" class="${cls}" id="pl-${i}-${f}" data-f="${f}" step="${step}" value="${isFinite(p[f]) ? p[f] : ''}" aria-label="第 ${i + 1} 場 ${name}"></td>`).join('')}
        <td id="pl-${i}-score" class="num">—</td>
        <td id="pl-${i}-pn" class="num">—</td>
        <td id="pl-${i}-pt" class="num">—</td>
        <td><button type="button" class="del" data-del="${i}" aria-label="刪除第 ${i + 1} 場">×</button></td>
      </tr>`).join('');
  }

  function runCalib() {
    const valid = validPlays();
    $('#plays-count').textContent = S.plays.length;
    S.plays.forEach((p, i) => {
      const tr = $(`#plays tr[data-i="${i}"]`);
      if (tr) tr.classList.toggle('bad', !isValid(p));
    });
    const out = $('#cal-out');
    $('#plays-hint').textContent = valid.length < S.plays.length
      ? `有 ${S.plays.length - valid.length} 列資料不完整，暫時不列入校準。`
      : valid.length < 8 ? '建議至少 8 場，SD 範圍越廣越好。' : '';
    if (valid.length === 0) {
      lastCal = null;
      out.innerHTML = '<p class="err">還沒有完整的成績。每一列都要填顯示 SD、タイミング平均與各判定數（沒有就填 0）。</p>';
      S.plays.forEach((_, i) => ['score', 'pn', 'pt'].forEach(id => { const el = $(`#pl-${i}-${id}`); if (el) el.textContent = '—'; }));
      return;
    }
    const cal = calibrateDdr(valid);
    lastCal = cal;
    let vi = 0;
    S.plays.forEach((p, i) => {
      const set = (id, v, title) => { const el = $(`#pl-${i}-${id}`); if (el) { el.textContent = v; el.title = title || ''; } };
      if (!isValid(p)) { set('score', '—'); set('pn', '—'); set('pt', '—'); return; }
      const actual = playScore(p);
      const diff = pr => `${signedInt(floor10(pr.score) - actual)}`;
      const pn = cal.normal.preds[vi], pt = cal.tri ? cal.tri.preds[vi] : null;
      set('score', int(actual));
      set('pn', diff(pn), `預測 ${money(pn.score)}`);
      set('pt', pt ? diff(pt) : '—', pt ? `預測 ${money(pt.score)}` : '');
      vi++;
    });

    const n = cal.normal, t = cal.tri;
    const errLine = c => `判定數誤差 ${c.judgeErr.map((v, j) => `${SEGS[j]} ${v.toFixed(1)}`).join('・')}`;
    let verdict;
    if (!t) verdict = '三態模型有 7 個參數，至少要 4 場成績才能校準。';
    else {
      const better = (a, b) => (a < b ? '三態' : '常態');
      const ratio = (a, b) => (a < b ? b / a : a / b);
      const wins = [t.exRmse < n.exRmse, t.rmse < n.rmse, t.aic < n.aic].filter(Boolean).length;
      verdict = wins >= 2 ? '<b>三態模型比較符合你的成績</b>。' : wins === 1 ? '<b>兩個模型各有勝負</b>。' : '<b>常態模型比較符合你的成績</b>。';
      verdict += `　EX 誤差：${better(t.exRmse, n.exRmse)}小 ${ratio(t.exRmse, n.exRmse).toFixed(1)} 倍；分數誤差：${better(t.rmse, n.rmse)}小 ${int(Math.abs(t.rmse - n.rmse))} 分。`;
      verdict += '分數誤差主要來自偶發的 MISS（一個就少 1,000 多分），兩個模型都很難預測；判定數與 EX 比較能看出哪個模型描述得對。';
    }
    const kNote = Math.abs(n.kScale - 1) < 0.03 ? '和顯示的 SD 幾乎一致' : n.kScale < 1 ? '實際比顯示的 SD 準' : '實際比顯示的 SD 鬆';
    const tf = t ? fromPrm(t.prm) : null;
    out.innerHTML = `
      <div class="cal-out">
        <div class="cal-card">
          <h4><i class="sw" style="background:var(--c-normal)"></i>常態</h4>
          <span class="val">k = ${n.kScale.toFixed(3)}</span>
          <small>實際 σ ≈ ${n.kScale.toFixed(2)} × 顯示 SD（${kNote}）</small>
          <small>分數誤差 ${int(n.rmse)} 分・EX 誤差 ${n.exRmse.toFixed(1)}</small>
          <small>${errLine(n)}</small>
        </div>
        <div class="cal-card">
          <h4><i class="sw" style="background:var(--c-tri)"></i>三態</h4>
          ${t ? `<span class="val">不太準 ${pct(tf.pLo, 0)}（SD 8）→ ${pct(tf.pHi, 0)}（SD 16）</span>
          <small>α<sub>A</sub> ${tf.alA.toFixed(2)}・α<sub>B</sub> ${tf.alB.toFixed(1)}・出事 ${tf.acc12.toFixed(2)} ／千步（SD 12），SD 每 +1 ms × ${tf.accX.toFixed(2)}，MISS 佔 ${pct(tf.missShare, 0)}</small>
          <small>分數誤差 ${int(t.rmse)} 分・EX 誤差 ${t.exRmse.toFixed(1)}</small>
          <small>${errLine(t)}</small>` : '<small>至少要 4 場才能校準。</small>'}
        </div>
      </div>
      <p class="verdict-line">${verdict}</p>
      <div class="calib-actions">
        <button type="button" class="btn" id="apply-cal">套用校準結果</button>
        <span class="ctrl-hint" id="apply-msg">會把兩個模型的參數換成上面的數字。</span>
      </div>`;
  }

  function applyCal() {
    if (!lastCal) return;
    S.k = round(clamp(lastCal.normal.kScale, 0.6, 1.4), 3);
    let clipped = Math.abs(S.k - lastCal.normal.kScale) > 0.01;
    if (lastCal.tri) {
      const f = fromPrm(lastCal.tri.prm), c = clampTri(f);
      clipped = clipped || TRI_CTRLS.some(x => Math.abs(c[x.key] - f[x.key]) > 1e-6);
      S.tri = c;
    }
    syncControls();
    later(renderModels);
    save();
    $('#apply-msg').textContent = clipped ? '已套用；部分參數超出滑桿範圍，已調整為最接近的值。' : '已套用到上方兩個模型。';
  }

  // 校準要跑最佳化，輸入時稍微等一下再算
  let calTimer = 0;
  const calibSoon = () => { clearTimeout(calTimer); calTimer = setTimeout(() => { runCalib(); drawCurves(); }, 250); };

  // =====================================================================
  // 事件
  // =====================================================================
  $('#tri-ctrls').innerHTML = TRI_CTRLS.map(c => `
    <div class="ctrl">
      <div class="ctrl-top"><label for="t-${c.key}">${c.label}</label><output id="t-${c.key}-out"></output></div>
      <input type="range" id="t-${c.key}" min="${c.min}" max="${c.max}" step="${c.step}">
    </div>`).join('');

  function syncControls() {
    $('#sd').value = S.sd;
    $('#sd-num').value = S.sd.toFixed(1);
    $('#c-mean').value = S.mean;
    $('#k').value = S.k;
    for (const c of TRI_CTRLS) $(`#t-${c.key}`).value = S.tri[c.key];
    $$('#scale-switch button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.scale === 'log') === S.logY)));
    $$('#miss-switch button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.miss === 'none') === S.noMiss)));
  }
  function setSd(v) {
    S.sd = round(clamp(v, SD_MIN, SD_MAX), 1);
    $('#sd').value = S.sd;
    $('#sd-num').value = S.sd.toFixed(1);
    later(renderModels);
    save();
  }
  bindNumber($('#sd'), $('#sd-num'), SD_MIN, SD_MAX, 1, setSd);

  $('#k').addEventListener('input', e => { S.k = +e.target.value; later(renderModels); save(); });
  for (const c of TRI_CTRLS) {
    $(`#t-${c.key}`).addEventListener('input', e => {
      S.tri[c.key] = +e.target.value;
      // SD 8 的比例不能高於 SD 16
      if (c.key === 'pLo' && S.tri.pHi < S.tri.pLo) { S.tri.pHi = Math.min(0.99, S.tri.pLo); $('#t-pHi').value = S.tri.pHi; }
      if (c.key === 'pHi' && S.tri.pLo > S.tri.pHi) { S.tri.pLo = Math.max(0.01, S.tri.pHi); $('#t-pLo').value = S.tri.pLo; }
      later(renderModels); save();
    });
  }
  $$('#miss-switch button').forEach(b => b.addEventListener('click', () => {
    S.noMiss = b.dataset.miss === 'none';
    syncControls();
    later(renderModels); save();
  }));
  $$('#scale-switch button').forEach(b => b.addEventListener('click', () => {
    S.logY = b.dataset.scale === 'log';
    syncControls();
    later(renderModels); save();
  }));

  const chartInputs = { steps: ['#c-steps', 10, 3000], freezes: ['#c-freezes', 0, 500], shocks: ['#c-shocks', 0, 500] };
  for (const [key, [sel, lo, hi]] of Object.entries(chartInputs)) {
    const el = $(sel);
    el.value = S.chart[key];
    el.addEventListener('change', () => {
      const v = parseInt(el.value, 10);
      S.chart[key] = isFinite(v) ? clamp(v, lo, hi) : S.chart[key];
      el.value = S.chart[key];
      later(renderModels); save();
    });
  }
  $('#c-mean').addEventListener('change', e => {
    const v = parseFloat(e.target.value);
    S.mean = isFinite(v) ? round(clamp(v, -20, 20), 1) : S.mean;
    e.target.value = S.mean;
    later(renderModels); save();
  });

  $('#plays').addEventListener('input', e => {
    const f = e.target.dataset.f;
    if (!f) return;
    const i = +e.target.closest('tr').dataset.i;
    const raw = e.target.value.trim();
    S.plays[i][f] = raw === '' ? NaN : Number(raw);
    calibSoon();
    save();
  });
  $('#plays').addEventListener('click', e => {
    const b = e.target.closest('button[data-del]');
    if (!b) return;
    S.plays.splice(+b.dataset.del, 1);
    renderPlaysTable();
    calibSoon(); save();
  });
  $('#add-play').addEventListener('click', () => {
    S.plays.push(Object.fromEntries(FIELDS.map(f => [f, f === 'mean' || f === 'ng' ? 0 : NaN])));
    renderPlaysTable();
    calibSoon(); save();
    const el = $(`#pl-${S.plays.length - 1}-sd`);
    if (el) el.focus();
  });
  $('#reset-plays').addEventListener('click', () => {
    S.plays = EXAMPLE_PLAYS.map(p => Object.assign({}, p));
    renderPlaysTable();
    calibSoon(); save();
  });
  $('#cal-out').addEventListener('click', e => { if (e.target.closest('#apply-cal')) applyCal(); });

  // 初始化
  syncControls();
  renderPlaysTable();
  renderModels();
  runCalib();

  let lastW = 0;
  new ResizeObserver(entries => {
    const w = Math.round(entries[0].contentRect.width);
    if (w === lastW) return;
    lastW = w;
    later(renderModels);
  }).observe($('.wrap'));
})();
