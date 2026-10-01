(function () {
  'use strict';
  const M = window.ScoreModel;
  const { GAMES, MODELS, makeDist, judge, sdForRate, scoreSpread, rankOf, absQuantile } = M;
  const {
    $, $$, clamp, round, store, sup, pct, pts, int, signed, signedInt, expo, small, ratio, reach,
    later, L, T, C, drawChart, niceStep, ticks, interp, rulerRow, judgeName, bindNumber, MODEL_INFO, PARAM_INFO
  } = window.UI;

  // ---------- 狀態 ----------
  const DEFAULT = {
    sd1: 13, notes: 1500,
    model: 'mixture', sd2: 13, mu: 0, logY: false,
    prm: { normal: {}, mixture: { p: 0.1, k: 3 }, t: { nu: 4 }, gn: { beta: 1.3 }, shift: { dr: 0.9 }, plateau: { ar: 2 } },
    fit: { total: 1500, pg: 1180, gr: 290 }
  };
  const { S, save } = store('score-calculator-v1', DEFAULT);
  if (!MODELS[S.model]) S.model = DEFAULT.model;

  // =====================================================================
  // PART 1：常態模型
  // =====================================================================
  let p1Cache = null;
  function p1Data() {
    if (p1Cache) return p1Cache;
    const iidx = [], popn = [];
    for (let i = 0; i <= 200; i++) {
      const s = 5 + i * 0.1, d = makeDist('normal', s);
      iidx.push([s, judge(GAMES.iidx, d).rate * 100]);
      popn.push([s, judge(GAMES.popn, d).rate * 100]);
    }
    const marks = [];
    for (const g of ['iidx', 'popn']) {
      for (const k of GAMES[g].ranks) marks.push({ g, name: k.name, rate: k.rate, sd: sdForRate(GAMES[g], 'normal', k.rate) });
    }
    marks.sort((a, b) => b.sd - a.sd);
    return (p1Cache = { iidx, popn, marks });
  }

  const JUDGE_COLORS = {
    iidx: ['var(--r-iidx-1)', 'var(--r-iidx-2)', 'var(--r-iidx-3)'],
    popn: ['var(--r-popn-1)', 'var(--r-popn-2)', 'var(--r-popn-3)', 'var(--r-popn-4)']
  };

  function setSd1(v) {
    S.sd1 = round(clamp(v, 5, 30), 2);
    $('#p1-sd').value = S.sd1;
    $('#p1-sd-num').value = S.sd1.toFixed(2);
    later(renderP1);
    save();
  }

  function renderP1() {
    const sd = S.sd1, N = S.notes, d = makeDist('normal', sd);
    for (const g of ['iidx', 'popn']) {
      const G = GAMES[g], j = judge(G, d), sp = scoreSpread(j, N), r = rankOf(G, j.rate);
      $(`#p1-${g}-val`).textContent = g === 'iidx' ? pct(j.rate) : pts(j.rate);
      const rk = $(`#p1-${g}-rank`);
      rk.textContent = r ? r.name : `未達 ${G.ranks[0].name}`;
      rk.classList.toggle('none', !r);
      $(`#p1-${g}-sub`).textContent = g === 'iidx'
        ? `期望 EX ${int(j.rate * 2 * N)} / ${int(2 * N)}　重打波動 ±${int(sp.sd * 2 * N)}`
        : `重打波動 ±${int(sp.sd * 1e5)} 分（1 個標準差）`;
      $(`#p1-${g}-judge`).innerHTML = G.judgments.map((name, i) => {
        const p = j.probs[i];
        return `<li><span class="jn">${name}</span><span class="jbar"><i style="width:${(p * 100).toFixed(2)}%;background:${JUDGE_COLORS[g][i]}"></i></span><span class="jv">${p < 1e-4 ? small(p) : pct(p)}</span></li>`;
      }).join('');
      $(`#p1-${g}-reach`).innerHTML = G.ranks.map(k => {
        const p = sp.pReach(k.rate);
        return `<li class="${p >= 0.5 ? 'on' : ''}"><b>${k.name}</b><span>${reach(p)}</span></li>`;
      }).join('');
    }

    const D = p1Data();
    $('#p1-table tbody').innerHTML = D.marks.map(mk => {
      const dd = makeDist('normal', mk.sd);
      const ok = sd <= mk.sd + 1e-9;
      return `<tr class="click" data-sd="${mk.sd.toFixed(2)}">
        <th><span class="who"><i class="sw" style="background:var(--${mk.g})"></i>${GAMES[mk.g].short} ${mk.name}</span></th>
        <td>${mk.sd.toFixed(2)} ms</td>
        <td>${pct(judge(GAMES.iidx, dd).rate)}</td>
        <td>${pts(judge(GAMES.popn, dd).rate)}</td>
        <td>${ok ? '<span class="pill ok">達成</span>' : `<span class="pill gap">還差 ${(Math.ceil((sd - mk.sd) * 100 - 1e-9) / 100).toFixed(2)} ms</span>`}</td>
      </tr>`;
    }).join('');

    drawP1Chart();
  }

  function drawP1Chart() {
    const D = p1Data(), sd = S.sd1, d = makeDist('normal', sd);
    const ci = judge(GAMES.iidx, d).rate * 100, cp = judge(GAMES.popn, d).rate * 100;
    drawChart($('#chart1'), {
      height: 340,
      margin: { r: 48 },
      x: { min: 5, max: 25, ticks: [5, 10, 15, 20, 25], fmt: v => v + ' ms' },
      y: { min: 60, max: 100, ticks: [60, 70, 80, 90, 100], fmt: v => v + '%' },
      series: [{ points: D.iidx, color: 'var(--iidx)' }, { points: D.popn, color: 'var(--popn)' }],
      over: c => {
        let o = '';
        if (sd >= 5 && sd <= 25) {
          const x = c.xs(sd).toFixed(1), right = sd > 19;
          o += L(x, c.m.t, x, c.m.t + c.ph, 'cursor');
          o += T(right ? +x - 6 : +x + 6, c.m.t + c.ph - 8, `σ = ${sd.toFixed(2)} ms`, 'cursor-lbl', right ? 'end' : 'start');
        }
        for (const mk of D.marks) {
          if (mk.sd < 5 || mk.sd > 25) continue;
          const mx = c.xs(mk.sd), my = c.ys(mk.rate * 100);
          o += C(mx.toFixed(1), my.toFixed(1), 4, 'mark', `var(--${mk.g})`);
          o += mk.g === 'iidx'
            ? T((mx - 7).toFixed(1), (my + 15).toFixed(1), mk.name, 'mark-lbl', 'end')
            : T(mx.toFixed(1), (my - 10).toFixed(1), mk.name, 'mark-lbl', 'middle');
        }
        if (sd >= 5 && sd <= 25) {
          const x = c.xs(sd).toFixed(1);
          o += C(x, c.ys(ci).toFixed(1), 5.5, 'dot', 'var(--iidx)') + C(x, c.ys(cp).toFixed(1), 5.5, 'dot', 'var(--popn)');
        }
        const e1 = D.iidx[D.iidx.length - 1][1], e2 = D.popn[D.popn.length - 1][1];
        o += T(c.m.l + c.pw + 6, (c.ys(e1) + 4).toFixed(1), 'IIDX', 'end-lbl');
        o += T(c.m.l + c.pw + 6, (c.ys(e2) + 4).toFixed(1), "pop'n", 'end-lbl');
        return o;
      },
      hover: xv => {
        const s = round(xv, 2), dd = makeDist('normal', s);
        const a = judge(GAMES.iidx, dd).rate, b = judge(GAMES.popn, dd).rate;
        return {
          x: s, title: `σ = ${s.toFixed(2)} ms`,
          points: [{ y: a * 100, color: 'var(--iidx)' }, { y: b * 100, color: 'var(--popn)' }],
          rows: [
            { color: 'var(--iidx)', label: 'IIDX', value: `${pct(a)} ${rankOf(GAMES.iidx, a)?.name ?? ''}` },
            { color: 'var(--popn)', label: "pop'n", value: `${pts(b)} ${rankOf(GAMES.popn, b)?.name ?? ''}` }
          ]
        };
      },
      onClick: xv => setSd1(xv)
    });
  }

  // =====================================================================
  // PART 2：非常態模型
  // =====================================================================
  function syncP2Controls() {
    $$('.tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.model === S.model)));
    $$('.switch button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.scale === 'log') === S.logY)));
    $('#p2-sd').value = S.sd2;
    $('#p2-sd-num').value = S.sd2.toFixed(2);
    $('#p2-mu').value = S.mu;
    $('#p2-mu-num').value = S.mu.toFixed(1);
    const info = MODEL_INFO[S.model];
    $('#p2-desc').innerHTML = `<div class="fx">${info.fx}</div><p>${info.text}</p>
      <dl><dt>優點</dt><dd>${info.pro}</dd><dt>缺點</dt><dd>${info.con}</dd></dl>`;
    const prm = S.prm[S.model];
    $('#p2-params').innerHTML = MODELS[S.model].params.map(p => `
      <div class="ctrl">
        <div class="ctrl-top"><label for="p2-prm-${p.key}">${PARAM_INFO[p.key].label}</label><output id="p2-prm-${p.key}-out">${PARAM_INFO[p.key].fmt(prm[p.key])}</output></div>
        <input type="range" id="p2-prm-${p.key}" data-key="${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${prm[p.key]}">
      </div>`).join('');
    $('#p2-params').hidden = MODELS[S.model].params.length === 0;
  }

  let convNormalCache = null;
  function convCurve(model, mu, prm) {
    const out = [];
    for (let s = 3; s <= 48; s *= 1.02) {
      const d = makeDist(model, s, mu, prm);
      out.push([judge(GAMES.iidx, d).rate * 100, judge(GAMES.popn, d).rate * 100]);
    }
    return out.sort((a, b) => a[0] - b[0]);
  }
  // 以 IIDX 評級換算 pop'n，以 pop'n 評級換算 IIDX
  function convTable(model, mu, prm) {
    const rows = [];
    for (const k of GAMES.iidx.ranks.slice(1)) {
      const s = sdForRate(GAMES.iidx, model, k.rate, mu, prm);
      rows.push({ from: 'iidx', name: k.name, to: judge(GAMES.popn, makeDist(model, s, mu, prm)).rate });
    }
    for (const k of GAMES.popn.ranks) {
      const s = sdForRate(GAMES.popn, model, k.rate, mu, prm);
      rows.push({ from: 'popn', name: k.name, to: judge(GAMES.iidx, makeDist(model, s, mu, prm)).rate });
    }
    return rows;
  }

  function renderP2() {
    const prm = S.prm[S.model];
    const dm = makeDist(S.model, S.sd2, S.mu, prm);
    const dn = makeDist('normal', S.sd2, 0);

    $('#p2-derived').innerHTML = [['SD', S.sd2], ...dm.info].map(([k, v]) =>
      `<div><dt>${k}</dt><dd>${v.toFixed(2)} ms</dd></div>`).join('');

    // 同 SD 比較表
    const jn = { i: judge(GAMES.iidx, dn), p: judge(GAMES.popn, dn) };
    const jm = { i: judge(GAMES.iidx, dm), p: judge(GAMES.popn, dm) };
    const qn = [absQuantile(dn, 0.5), absQuantile(dn, 0.9)], qm = [absQuantile(dm, 0.5), absQuantile(dm, 0.9)];
    const badN = jn.p.probs[3], badM = jm.p.probs[3];
    const rows = [
      ['IIDX 分數率', pct(jn.i.rate), pct(jm.i.rate), signed((jm.i.rate - jn.i.rate) * 100, 2) + ' pt'],
      ['PGREAT', pct(jn.i.probs[0]), pct(jm.i.probs[0]), signed((jm.i.probs[0] - jn.i.probs[0]) * 100, 2) + ' pt', true],
      ["pop'n 分數", pts(jn.p.rate), pts(jm.p.rate), signedInt((jm.p.rate - jn.p.rate) * 1e5)],
      ['COOL', pct(jn.p.probs[0]), pct(jm.p.probs[0]), signed((jm.p.probs[0] - jn.p.probs[0]) * 100, 2) + ' pt', true],
      ['BAD（±100 ms 外）', small(badN), small(badM), ratio(badM, badN)],
      ['一半的 note 落在', '±' + qn[0].toFixed(2) + ' ms', '±' + qm[0].toFixed(2) + ' ms', signed(qm[0] - qn[0], 2) + ' ms'],
      ['90% 的 note 落在', '±' + qn[1].toFixed(2) + ' ms', '±' + qm[1].toFixed(2) + ' ms', signed(qm[1] - qn[1], 2) + ' ms']
    ];
    $('#p2-compare tbody').innerHTML = rows.map(([k, a, b, dlt, sub]) =>
      `<tr><th class="${sub ? 'indent' : ''}">${k}</th><td>${a}</td><td>${b}</td><td>${dlt}</td></tr>`).join('');

    // 換算
    if (!convNormalCache) convNormalCache = { curve: convCurve('normal', 0, {}), table: convTable('normal', 0, {}) };
    const curveM = convCurve(S.model, S.mu, prm), tableM = convTable(S.model, S.mu, prm);
    $('#p2-conv tbody').innerHTML = tableM.map((r, i) => {
      const n = convNormalCache.table[i];
      const fmt = r.from === 'iidx' ? pts : v => pct(v);
      const label = r.from === 'iidx' ? `IIDX ${r.name} → pop'n` : `pop'n ${r.name} → IIDX`;
      return `<tr><th><span class="who"><i class="sw" style="background:var(--${r.from})"></i>${label}</span></th><td>${fmt(n.to)}</td><td>${fmt(r.to)}</td></tr>`;
    }).join('');

    // 結論句
    const aaaN = convNormalCache.table.find(r => r.from === 'iidx' && r.name === 'AAA').to;
    const aaaM = tableM.find(r => r.from === 'iidx' && r.name === 'AAA').to;
    const same = S.model === 'normal' && Math.abs(S.mu) < 1e-9;
    $('#p2-finding').innerHTML = same
      ? '目前選的是常態、μ = 0，和原圖完全相同。切換到其他模型，看看換算怎麼偏移。'
      : `同樣 SD <span class="num">${S.sd2.toFixed(2)} ms</span> 下，目前模型的 IIDX 分數率是 <span class="num">${pct(jm.i.rate)}</span>（常態 ${pct(jn.i.rate)}），pop'n 是 <span class="num">${pts(jm.p.rate)}</span>（常態 ${pts(jn.p.rate)}）。` +
        `以 IIDX AAA 換算，pop'n 的等價分數從 <span class="num">${pts(aaaN)}</span> 變成 <span class="num">${pts(aaaM)}</span>。` +
        "原因是 IIDX 的 PGREAT 窗很窄（±16.67 ms），吃的是中心密度；pop'n 的窗很寬，怕的是尾巴。";

    drawDensity(dm, dn);
    drawConv(curveM, dm);
  }

  const IIDX_SEGS = ['PGREAT', 'GREAT', 'GOOD 以下'];
  const POPN_SEGS = ['COOL', 'GREAT', 'GOOD', 'BAD'];
  function drawDensity(dm, dn) {
    const pm = [], pn = [];
    for (let x = -110; x <= 110; x += 0.5) {
      pm.push([x, dm.pdf(x) * 100]);
      pn.push([x, dn.pdf(x) * 100]);
    }
    const peak = Math.max(...pm.map(p => p[1]), ...pn.map(p => p[1]));
    let Y;
    if (S.logY) {
      const top = Math.ceil(Math.log10(peak));
      const tk = [];
      for (let e = -6; e <= top; e += 2) tk.push(10 ** e);
      Y = { log: true, min: 1e-6, max: 10 ** top, ticks: tk, fmt: v => '10' + sup(Math.round(Math.log10(v))) };
    } else {
      const step = niceStep(peak * 1.08, 4), top = Math.ceil(peak * 1.08 / step) * step;
      Y = { min: 0, max: top, ticks: ticks(0, top, step), fmt: v => (step < 1 ? v.toFixed(1) : String(v)) + '%' };
    }
    const RH = 18, RG = 5;
    drawChart($('#chart2'), {
      height: 330,
      margin: { t: 16, b: 38 + 2 * RH + RG + 22, l: 50, r: 16 },
      xTickGap: 2 * RH + RG + 10,
      x: { min: -110, max: 110, ticks: [-100, -50, 0, 50, 100], fmt: v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) },
      y: Y,
      series: [
        { points: pn, color: 'var(--ref)' },
        { points: pm, color: 'var(--model)', area: !S.logY }
      ],
      under: c => {
        const y0 = c.m.t + c.ph + 6;
        let o = rulerRow(c, y0, RH, GAMES.iidx.windows, IIDX_SEGS, 'iidx');
        o += rulerRow(c, y0 + RH + RG, RH, GAMES.popn.windows, POPN_SEGS, 'popn');
        o += T(c.m.l - 8, y0 + RH / 2 + 4, 'IIDX', 'row-lbl', 'end');
        o += T(c.m.l - 8, y0 + RH + RG + RH / 2 + 4, "pop'n", 'row-lbl', 'end');
        const ay = c.H - 6;
        o += T(c.m.l, ay, '← FAST（早）', 'axis-title', 'start');
        o += T(c.m.l + c.pw / 2, ay, 'ms', 'axis-title', 'middle');
        o += T(c.m.l + c.pw, ay, 'SLOW（晚）→', 'axis-title', 'end');
        return o;
      },
      hover: xv => {
        const x = round(xv, 1);
        const a = dm.pdf(x) * 100, b = dn.pdf(x) * 100;
        const f = v => v >= 0.001 ? v.toFixed(3) + '%' : v > 1e-300 ? expo(v) + '%' : '≈ 0';
        return {
          x, title: `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(1)} ms`,
          points: [{ y: a, color: 'var(--model)' }, { y: b, color: 'var(--ref)' }],
          rows: [
            { color: 'var(--model)', label: '目前模型', value: f(a) },
            { color: 'var(--ref)', label: '常態', value: f(b) },
            { label: 'IIDX 判定', value: judgeName(GAMES.iidx.windows, IIDX_SEGS, x) },
            { label: "pop'n 判定", value: judgeName(GAMES.popn.windows, POPN_SEGS, x) }
          ]
        };
      }
    });
  }

  function drawConv(curveM, dm) {
    const curveN = convNormalCache.curve;
    const X0 = 70, X1 = 100;
    const inRange = pts => pts.filter(p => p[0] >= X0 - 1);
    const yLow = Math.min(interp(curveN, X0), interp(curveM, X0));
    const Y0 = Math.max(0, Math.floor(yLow - 0.5)), Y1 = 100;
    const step = niceStep(Y1 - Y0, 5);
    const cur = { i: judge(GAMES.iidx, dm).rate * 100, p: judge(GAMES.popn, dm).rate * 100 };
    drawChart($('#chart3'), {
      height: 340,
      margin: { t: 26, r: 18, l: 62 },
      x: { min: X0, max: X1, ticks: [70, 75, 80, 85, 90, 95, 100], fmt: v => v + '%' },
      y: { min: Y0, max: Y1, ticks: ticks(Y0, Y1, step), fmt: v => (v * 1000).toLocaleString('en-US') },
      series: [{ points: inRange(curveN), color: 'var(--ref)' }, { points: inRange(curveM), color: 'var(--model)' }],
      under: c => {
        let o = '';
        for (const k of GAMES.iidx.ranks) {
          const v = k.rate * 100;
          if (v < X0) continue;
          const x = c.xs(v).toFixed(1);
          o += L(x, c.m.t, x, c.m.t + c.ph, 'guide') + T(x, c.m.t - 8, k.name, 'guide-lbl', 'middle');
        }
        for (const k of GAMES.popn.ranks) {
          const v = k.rate * 100;
          if (v < Y0) continue;
          const y = c.ys(v).toFixed(1);
          o += L(c.m.l, y, c.m.l + c.pw, y, 'guide') + T(c.m.l + 4, +y - 5, "pop'n " + k.name, 'guide-lbl', 'start');
        }
        return o;
      },
      over: c => {
        if (!(cur.i >= X0 && cur.p >= Y0)) return '';
        const x = c.xs(cur.i).toFixed(1), y = c.ys(cur.p).toFixed(1);
        return C(x, y, 5.5, 'dot', 'var(--model)') + T(+x + 9, +y + 16, `目前 SD ${S.sd2.toFixed(2)}`, 'mark-lbl', 'start');
      },
      hover: xv => {
        const x = round(xv, 2), a = interp(curveM, x), b = interp(curveN, x);
        return {
          x, title: `IIDX ${x.toFixed(2)}%`,
          points: [{ y: a, color: 'var(--model)' }, { y: b, color: 'var(--ref)' }],
          rows: [
            { color: 'var(--model)', label: '目前模型', value: pts(a / 100) },
            { color: 'var(--ref)', label: '原圖', value: pts(b / 100) }
          ]
        };
      }
    });
  }

  // =====================================================================
  // PART 3：由判定數反推形狀
  // =====================================================================
  function renderFit() {
    const { total, pg, gr } = S.fit;
    const out = $('#fit-out');
    let err = '';
    if (![total, pg, gr].every(Number.isFinite)) err = '請填入譜面物量、PGREAT、GREAT 三個數字。';
    else if (!(total > 0)) err = '請輸入譜面物量。';
    else if (!(pg > 0)) err = 'PGREAT 要大於 0。';
    else if (gr < 0) err = 'GREAT 不能是負數。';
    else if (pg + gr > total) err = 'PGREAT＋GREAT 超過了譜面物量，請檢查數字。';
    else if (pg + gr === total) err = '這場沒有 GOOD 以下的判定，看不到尾巴，無法估計形狀。請換一場有 GOOD 以下的成績。';
    else if (gr === 0) err = 'GREAT 為 0 時無法估計形狀。';
    if (err) { out.innerHTML = `<p class="err">${err}</p>`; return; }

    const w1 = GAMES.iidx.windows[0], w2 = GAMES.iidx.windows[1];
    const r1 = pg / total, r2 = (pg + gr) / total;
    const s1 = M.normalSdFromRatio(r1, w1), s2 = M.normalSdFromRatio(r2, w2);
    const f = M.fitGN(r1, r2, w1, w2);
    const exRate = (2 * pg + gr) / (2 * total);

    let tag, cls, text;
    if (f.beta < 1.75) {
      cls = 'heavy'; tag = '尖峰厚尾';
      text = `中心比常態更集中，大誤差也更常出現。PGREAT 率看起來像 σ = ${s1.toFixed(2)} ms 的玩家，GREAT 窗外的失誤卻像 σ = ${s2.toFixed(2)} ms。這時原圖的換算表會高估你在 pop'n 的分數（或低估你在 IIDX 的分數）。`;
    } else if (f.beta <= 2.25) {
      cls = 'normal'; tag = '接近常態';
      text = '兩個 σ 很接近，這場的誤差大致符合常態假設，原圖的換算表對你適用。';
    } else {
      cls = 'flat'; tag = '平頂';
      text = '中心反而比常態鬆散、邊緣收得很緊。常見原因是 offset 不一致（整體偏 FAST／SLOW，或左右手偏的方向不同）。PART 2 的偏移混合、平台常態可以描述這種形狀。';
    }
    const betaTxt = f.clipped === 'low' ? '< 0.25' : f.clipped === 'high' ? '> 12' : f.beta.toFixed(2);

    out.innerHTML = `
      <div class="fit-pair">
        <div><span>用 PGREAT 率反推</span><b>σ = ${s1.toFixed(2)} ms</b><small>PGREAT 率 ${pct(r1)}</small></div>
        <div><span>用 PGREAT＋GREAT 率反推</span><b>σ = ${s2.toFixed(2)} ms</b><small>PGREAT＋GREAT 率 ${pct(r2)}</small></div>
      </div>
      <div class="verdict"><span class="tag ${cls}">${tag}</span><span class="num">廣義常態 β = ${betaTxt}　SD = ${f.sd.toFixed(2)} ms　EX 分數率 ${pct(exRate)}</span></div>
      <p>${text}</p>
      <button type="button" class="btn" id="fit-apply">套用到 PART 2 的模型</button>
      <p class="note">這裡假設誤差中心在 0。有 FAST／SLOW 偏向時 β 會被估得偏大（看起來比較平），所以算出 β &lt; 2 時，厚尾的結論是可靠的。兩個比例剛好解出兩個參數，所以這是「形狀診斷」而不是嚴格的適合度檢定。</p>`;

    $('#fit-apply').addEventListener('click', () => {
      S.model = 'gn';
      S.prm.gn.beta = round(clamp(f.beta, 0.6, 6), 2);
      S.sd2 = round(clamp(f.sd, 5, 30), 2);
      S.mu = 0;
      syncP2Controls();
      later(renderP2);
      save();
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      $('#shape').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    });
  }

  // =====================================================================
  // 事件
  // =====================================================================
  bindNumber($('#p1-sd'), $('#p1-sd-num'), 5, 30, 2, setSd1);
  $('#p1-notes').addEventListener('change', e => {
    const v = parseInt(e.target.value, 10);
    S.notes = isFinite(v) ? clamp(v, 100, 5000) : S.notes;
    e.target.value = S.notes;
    later(renderP1);
    save();
  });
  $('#p1-table').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-sd]');
    if (tr) setSd1(+tr.dataset.sd);
  });

  const setSd2 = v => {
    S.sd2 = round(clamp(v, 5, 30), 2);
    $('#p2-sd').value = S.sd2;
    $('#p2-sd-num').value = S.sd2.toFixed(2);
    later(renderP2); save();
  };
  const setMu = v => {
    S.mu = round(clamp(v, -12, 12), 1);
    $('#p2-mu').value = S.mu;
    $('#p2-mu-num').value = S.mu.toFixed(1);
    later(renderP2); save();
  };
  bindNumber($('#p2-sd'), $('#p2-sd-num'), 5, 30, 2, setSd2);
  bindNumber($('#p2-mu'), $('#p2-mu-num'), -12, 12, 1, setMu);

  $$('.tabs button').forEach(b => b.addEventListener('click', () => {
    S.model = b.dataset.model;
    syncP2Controls();
    later(renderP2); save();
  }));
  $$('.switch button').forEach(b => b.addEventListener('click', () => {
    S.logY = b.dataset.scale === 'log';
    syncP2Controls();
    later(renderP2); save();
  }));
  $('#p2-params').addEventListener('input', e => {
    const key = e.target.dataset.key;
    if (!key) return;
    S.prm[S.model][key] = +e.target.value;
    $(`#p2-prm-${key}-out`).textContent = PARAM_INFO[key].fmt(+e.target.value);
    later(renderP2); save();
  });

  const fitInputs = { total: '#fit-total', pg: '#fit-pg', gr: '#fit-gr' };
  for (const [k, sel] of Object.entries(fitInputs)) {
    const el = $(sel);
    el.value = S.fit[k];
    el.addEventListener('input', () => {
      const v = parseInt(el.value, 10);
      S.fit[k] = isFinite(v) ? v : NaN;
      later(renderFit);
      if (isFinite(v)) save();
    });
  }
  $('#fit-form').addEventListener('submit', e => e.preventDefault());

  // 初始化
  $('#p1-sd').value = S.sd1;
  $('#p1-sd-num').value = S.sd1.toFixed(2);
  $('#p1-notes').value = S.notes;
  syncP2Controls();
  renderP1();
  renderP2();
  renderFit();

  // 寬度改變時重畫圖表
  let lastW = 0;
  new ResizeObserver(entries => {
    const w = Math.round(entries[0].contentRect.width);
    if (w === lastW) return;
    lastW = w;
    later(drawP1Chart);
    later(renderP2);
  }).observe($('.wrap'));
})();
