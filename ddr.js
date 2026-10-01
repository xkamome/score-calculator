(function () {
  'use strict';
  const M = window.ScoreModel;
  const { GAMES, MODELS, makeDist, judge, rankOf, absQuantile, ddrScore, floor10, sdForDdr, fitCounts } = M;
  const {
    $, $$, clamp, round, store, sup, pct, pts, int, signed, signedInt, small, ratio, reach, expo,
    later, L, T, C, drawChart, niceStep, ticks, interp, rulerRow, judgeName, bindNumber, MODEL_INFO, PARAM_INFO
  } = window.UI;
  const G = GAMES.ddr;
  const SD_MIN = 5, SD_MAX = 50;
  const MODEL_NAMES = { normal: '常態', t: 'Student-t', gn: '廣義常態', mixture: '雙常態混合', shift: '偏移混合', plateau: '平台常態' };
  const FIT_MODELS = ['normal', 'gn', 'mixture', 't', 'shift', 'plateau'];

  // ---------- 狀態 ----------
  const DEFAULT = {
    sd1: 14, chart: { steps: 600, freezes: 30, shocks: 0 },
    model: 'mixture', sd2: 14, mu: 0, logY: false,
    prm: { normal: {}, mixture: { p: 0.05, k: 5 }, t: { nu: 3 }, gn: { beta: 1 }, shift: { dr: 0.9 }, plateau: { ar: 2 } },
    fit: { m: 480, p: 95, g: 20, gd: 2, miss: 3 }
  };
  const { S, save } = store('score-calculator-ddr-v1', DEFAULT);
  if (!MODELS[S.model]) S.model = DEFAULT.model;

  const money = v => int(floor10(v));
  const ddrAt = dist => {
    const j = judge(G, dist);
    return { j, r: ddrScore(j.probs, S.chart) };
  };
  const chartKey = () => `${S.chart.steps}/${S.chart.freezes}/${S.chart.shocks}`;
  const rankLabel = score => rankOf(G, score / 1e6)?.name ?? '未達 A';

  // =====================================================================
  // PART 1：常態模型
  // =====================================================================
  let p1Cache = null;
  function p1Data() {
    if (p1Cache && p1Cache.key === chartKey()) return p1Cache;
    const curve = [];
    for (let s = SD_MIN; s <= SD_MAX + 1e-9; s += 0.25) curve.push([s, ddrAt(makeDist('normal', s)).r.score]);
    const marks = G.ranks.map(k => ({ name: k.name, score: k.rate * 1e6, sd: sdForDdr(k.rate * 1e6, S.chart, 'normal') }))
      .sort((a, b) => b.sd - a.sd);
    return (p1Cache = { key: chartKey(), curve, marks });
  }

  function setSd1(v) {
    S.sd1 = round(clamp(v, SD_MIN, SD_MAX), 2);
    $('#p1-sd').value = S.sd1;
    $('#p1-sd-num').value = S.sd1.toFixed(2);
    later(renderP1);
    save();
  }

  function renderP1() {
    const sd = S.sd1, d = makeDist('normal', sd);
    const { j, r } = ddrAt(d);
    const rk = rankOf(G, r.score / 1e6);

    $('#c-hint').textContent = `每個物件 U = ${r.U.toFixed(2)} 分；PERFECT 的 −10 分相當於 U 的 ${(1000 / r.U).toFixed(2)}%。`;
    $('#p1-val').textContent = money(r.score);
    const rkEl = $('#p1-rank');
    rkEl.textContent = rk ? rk.name : '未達 A';
    rkEl.classList.toggle('none', !rk);
    $('#p1-sub').textContent = `EX ${int(r.ex)} / ${int(r.exMax)}（${pct(r.ex / r.exMax)}）　重打波動 ±${int(r.scoreSd)}`;
    $('#p1-judge').innerHTML = G.judgments.map((name, i) => {
      const p = j.probs[i];
      return `<li><span class="jn">${name}</span><span class="jbar"><i style="width:${(p * 100).toFixed(2)}%;background:var(--ddr)"></i></span><span class="jv">${p < 1e-4 ? small(p) : pct(p)}</span></li>`;
    }).join('');
    const loss = r.loss, total = loss.perfect + loss.great + loss.good + loss.miss;
    const lossRow = (label, v) => `<li><span>${label}</span><b>${v < 0.5 ? '0' : '−' + int(v)}</b></li>`;
    $('#p1-loss').innerHTML = lossRow('PERFECT 的 −10', loss.perfect) + lossRow('GREAT（少 0.4U 再 −10）', loss.great) +
      lossRow('GOOD（少 0.8U 再 −10）', loss.good) + lossRow('MISS（少 U）', loss.miss) +
      `<li class="total"><span>距離 1,000,000</span><b>−${int(total)}</b></li>`;
    $('#p1-reach').innerHTML = G.ranks.map(k => {
      const p = r.scoreSd > 0 ? M.PhiC((k.rate * 1e6 - r.score) / r.scoreSd) : (r.score >= k.rate * 1e6 ? 1 : 0);
      return `<li class="${p >= 0.5 ? 'on' : ''}"><b>${k.name}</b><span>${reach(p)}</span></li>`;
    }).join('');
    const ii = judge(GAMES.iidx, d).rate, pp = judge(GAMES.popn, d).rate;
    $('#p1-cross').textContent = `同一個 σ：IIDX ${pct(ii)}（${rankOf(GAMES.iidx, ii)?.name ?? '未達 A'}）、pop'n ${pts(pp)}（${rankOf(GAMES.popn, pp)?.name ?? '未達 AAA'}）`;

    const D = p1Data();
    $('#p1-table tbody').innerHTML = D.marks.map(mk => {
      const dd = makeDist('normal', mk.sd), rr = ddrAt(dd).r;
      const ok = sd <= mk.sd + 1e-9;
      return `<tr class="click" data-sd="${mk.sd.toFixed(2)}">
        <th><span class="who"><i class="sw" style="background:var(--ddr)"></i>${mk.name}　${int(mk.score)}</span></th>
        <td>${mk.sd.toFixed(2)} ms</td>
        <td>${pct(rr.ex / rr.exMax)}</td>
        <td>${pct(judge(GAMES.iidx, dd).rate)}</td>
        <td>${pts(judge(GAMES.popn, dd).rate)}</td>
        <td>${ok ? '<span class="pill ok">達成</span>' : `<span class="pill gap">還差 ${(Math.ceil((sd - mk.sd) * 100 - 1e-9) / 100).toFixed(2)} ms</span>`}</td>
      </tr>`;
    }).join('');

    drawP1Chart(r.score);
  }

  function scoreAxis(lowest) {
    const Y0 = Math.min(750000, Math.floor(lowest / 50000) * 50000);
    return { min: Math.max(0, Y0), max: 1e6, ticks: ticks(Math.max(0, Y0), 1e6, 50000), fmt: v => int(v) };
  }

  function drawP1Chart(cur) {
    const D = p1Data(), sd = S.sd1;
    drawChart($('#chart1'), {
      height: 340,
      margin: { l: 68, r: 20 },
      x: { min: SD_MIN, max: SD_MAX, ticks: [10, 20, 30, 40, 50], fmt: v => v + ' ms' },
      y: scoreAxis(D.curve[D.curve.length - 1][1]),
      series: [{ points: D.curve, color: 'var(--ddr)' }],
      over: c => {
        let o = '';
        const x = c.xs(sd).toFixed(1), right = sd > 38;
        o += L(x, c.m.t, x, c.m.t + c.ph, 'cursor');
        o += T(right ? +x - 6 : +x + 6, c.m.t + c.ph - 8, `σ = ${sd.toFixed(2)} ms`, 'cursor-lbl', right ? 'end' : 'start');
        for (const mk of D.marks) {
          if (mk.sd < SD_MIN || mk.sd > SD_MAX) continue;
          const mx = c.xs(mk.sd), my = c.ys(mk.score);
          o += C(mx.toFixed(1), my.toFixed(1), 4, 'mark', 'var(--ddr)');
          o += T((mx - 7).toFixed(1), (my + 15).toFixed(1), mk.name, 'mark-lbl', 'end');
        }
        if (cur >= c.cfg.y.min) o += C(x, c.ys(cur).toFixed(1), 5.5, 'dot', 'var(--ddr)');
        return o;
      },
      hover: xv => {
        const s = round(xv, 2), { r } = ddrAt(makeDist('normal', s));
        return {
          x: s, title: `σ = ${s.toFixed(2)} ms`,
          points: [{ y: r.score, color: 'var(--ddr)' }],
          rows: [
            { color: 'var(--ddr)', label: '分數', value: `${money(r.score)} ${rankLabel(r.score)}` },
            { label: 'EX 分數率', value: pct(r.ex / r.exMax) }
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

  const normalCache = { key: null };
  function rankTable(model, mu, prm) {
    return G.ranks.slice().reverse().map(k => {
      const sd = sdForDdr(k.rate * 1e6, S.chart, model, mu, prm);
      return { name: k.name, sd, iidx: judge(GAMES.iidx, makeDist(model, sd, mu, prm)).rate };
    });
  }
  function sdCurve(model, mu, prm) {
    const out = [];
    for (let s = SD_MIN; s <= SD_MAX + 1e-9; s += 0.5) out.push([s, ddrAt(makeDist(model, s, mu, prm)).r.score]);
    return out;
  }

  function renderP2() {
    const prm = S.prm[S.model];
    const dm = makeDist(S.model, S.sd2, S.mu, prm);
    const dn = makeDist('normal', S.sd2, 0);
    const am = ddrAt(dm), an = ddrAt(dn);

    $('#p2-derived').innerHTML = [['SD', S.sd2], ...dm.info].map(([k, v]) =>
      `<div><dt>${k}</dt><dd>${v.toFixed(2)} ms</dd></div>`).join('');

    const qn = [absQuantile(dn, 0.5), absQuantile(dn, 0.9)], qm = [absQuantile(dm, 0.5), absQuantile(dm, 0.9)];
    const pn = an.j.probs, pm = am.j.probs;
    const rows = [
      ['DDR 分數', money(an.r.score), money(am.r.score), signedInt(floor10(am.r.score) - floor10(an.r.score))],
      ['MARVELOUS', pct(pn[0]), pct(pm[0]), signed((pm[0] - pn[0]) * 100, 2) + ' pt', true],
      ['GREAT 以下', pct(1 - pn[0] - pn[1]), pct(1 - pm[0] - pm[1]), signed((pn[0] + pn[1] - pm[0] - pm[1]) * 100, 2) + ' pt', true],
      ['MISS（±141.67 ms 外）', small(pn[4]), small(pm[4]), ratio(pm[4], pn[4]), true],
      ['EX 分數率', pct(an.r.ex / an.r.exMax), pct(am.r.ex / am.r.exMax), signed((am.r.ex / am.r.exMax - an.r.ex / an.r.exMax) * 100, 2) + ' pt'],
      ['一半的步落在', '±' + qn[0].toFixed(2) + ' ms', '±' + qm[0].toFixed(2) + ' ms', signed(qm[0] - qn[0], 2) + ' ms'],
      ['90% 的步落在', '±' + qn[1].toFixed(2) + ' ms', '±' + qm[1].toFixed(2) + ' ms', signed(qm[1] - qn[1], 2) + ' ms']
    ];
    $('#p2-compare tbody').innerHTML = rows.map(([k, a, b, dlt, sub]) =>
      `<tr><th class="${sub ? 'indent' : ''}">${k}</th><td>${a}</td><td>${b}</td><td>${dlt}</td></tr>`).join('');

    if (normalCache.key !== chartKey()) {
      Object.assign(normalCache, { key: chartKey(), curve: sdCurve('normal', 0, {}), table: rankTable('normal', 0, {}) });
    }
    const curveM = sdCurve(S.model, S.mu, prm), tableM = rankTable(S.model, S.mu, prm);
    $('#p2-conv tbody').innerHTML = tableM.map((r, i) => {
      const n = normalCache.table[i];
      return `<tr><th><span class="who"><i class="sw" style="background:var(--ddr)"></i>${r.name}</span></th>
        <td>${n.sd.toFixed(2)}</td><td>${r.sd.toFixed(2)}</td><td>${pct(n.iidx)}</td><td>${pct(r.iidx)}</td></tr>`;
    }).join('');

    const aaaN = normalCache.table[0], aaaM = tableM[0];
    const same = S.model === 'normal' && Math.abs(S.mu) < 1e-9;
    $('#p2-finding').innerHTML = same
      ? '目前選的是常態、μ = 0，和 PART 1 相同。切換到其他模型，看看分數怎麼變。'
      : `同樣 SD <span class="num">${S.sd2.toFixed(2)} ms</span> 下，目前模型的期望分數是 <span class="num">${money(am.r.score)}</span>（常態 ${money(an.r.score)}），` +
        `MISS 率 <span class="num">${small(pm[4])}</span>（常態 ${small(pn[4])}）。` +
        `要拿 AAA，常態需要 SD ≤ <span class="num">${aaaN.sd.toFixed(2)} ms</span>，目前模型需要 SD ≤ <span class="num">${aaaM.sd.toFixed(2)} ms</span>。` +
        (pm[0] >= pn[0] && pm[4] >= pn[4]
          ? '尖峰厚尾的分布中心比較集中，MARVELOUS 變多；但落到 GOOD、MISS 的步也變多，每一次都比 PERFECT 的 −10 貴得多。'
          : pm[0] < pn[0] && pm[4] <= pn[4]
            ? '平頂尾薄的分布中心比較鬆，MARVELOUS 變少、PERFECT 變多；但幾乎不會掉到 GOOD、MISS。'
            : '');

    drawDensity(dm, dn);
    drawSdChart(curveM, am.r.score);
  }

  const SEGS = ['MARV', 'PERF', 'GREAT', 'GOOD', 'MISS'];
  function drawDensity(dm, dn) {
    const pm = [], pn = [];
    for (let x = -170; x <= 170; x += 0.5) {
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
    const RH = 20;
    drawChart($('#chart2'), {
      height: 310,
      margin: { t: 16, b: 38 + RH + 22, l: 50, r: 16 },
      xTickGap: RH + 10,
      x: { min: -170, max: 170, ticks: [-150, -100, -50, 0, 50, 100, 150], fmt: v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) },
      y: Y,
      series: [
        { points: pn, color: 'var(--ref)' },
        { points: pm, color: 'var(--model)', area: !S.logY }
      ],
      under: c => {
        const y0 = c.m.t + c.ph + 6;
        let o = rulerRow(c, y0, RH, G.windows, SEGS, 'ddr');
        o += T(c.m.l - 8, y0 + RH / 2 + 4, 'DDR', 'row-lbl', 'end');
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
            { label: '判定', value: judgeName(G.windows, G.judgments, x) }
          ]
        };
      }
    });
  }

  function drawSdChart(curveM, cur) {
    const curveN = normalCache.curve;
    const lowest = Math.min(curveN[curveN.length - 1][1], curveM[curveM.length - 1][1]);
    const Y = scoreAxis(lowest);
    drawChart($('#chart3'), {
      height: 340,
      margin: { l: 68, r: 18 },
      x: { min: SD_MIN, max: SD_MAX, ticks: [10, 20, 30, 40, 50], fmt: v => v + ' ms' },
      y: Y,
      series: [{ points: curveN, color: 'var(--ref)' }, { points: curveM, color: 'var(--model)' }],
      under: c => {
        let o = '';
        for (const k of G.ranks) {
          const v = k.rate * 1e6;
          if (v < Y.min || k.name === 'AA−') continue;   // AA− 與 AA 太近，省略標籤避免重疊
          const y = c.ys(v).toFixed(1);
          o += L(c.m.l, y, c.m.l + c.pw, y, 'guide') + T(c.m.l + c.pw - 4, +y - 5, k.name, 'guide-lbl', 'end');
        }
        return o;
      },
      over: c => {
        if (!(cur >= Y.min)) return '';
        const x = c.xs(S.sd2).toFixed(1), y = c.ys(cur).toFixed(1);
        return C(x, y, 5.5, 'dot', 'var(--model)');
      },
      hover: xv => {
        const x = round(xv, 2), a = interp(curveM, x), b = interp(curveN, x);
        return {
          x, title: `SD = ${x.toFixed(2)} ms`,
          points: [{ y: a, color: 'var(--model)' }, { y: b, color: 'var(--ref)' }],
          rows: [
            { color: 'var(--model)', label: '目前模型', value: `${money(a)} ${rankLabel(a)}` },
            { color: 'var(--ref)', label: '常態', value: `${money(b)} ${rankLabel(b)}` }
          ]
        };
      }
    });
  }

  // =====================================================================
  // PART 3：最大概似擬合
  // =====================================================================
  let lastFits = null;
  function shapeText(f) {
    const sdTxt = isFinite(f.sd) ? `SD ${f.sd.toFixed(2)} ms` : 'SD 無限大';
    if (f.model === 'normal') return sdTxt;
    if (f.model === 't') return `ν ${f.shape.nu.toFixed(2)}・${sdTxt}`;
    if (f.model === 'gn') return `β ${f.shape.beta.toFixed(2)}・${sdTxt}`;
    if (f.model === 'shift') return `d/σ ${f.shape.dr.toFixed(2)}・${sdTxt}`;
    if (f.model === 'plateau') return `a/σ ${f.shape.ar.toFixed(2)}・${sdTxt}`;
    return `p ${Math.round(f.shape.p * 100)}%・k ${f.shape.k.toFixed(1)}・${sdTxt}`;
  }
  const pFmt = p => p == null ? '—' : p >= 0.001 ? p.toFixed(3) : '< 0.001';

  function renderFit() {
    const { m, p, g, gd, miss } = S.fit;
    const counts = [m, p, g, gd, miss];
    const out = $('#fit-out');
    const total = counts.reduce((a, b) => a + b, 0);
    let err = '';
    if (!counts.every(v => Number.isInteger(v) && v >= 0)) err = '五個判定數都要填 0 以上的整數。';
    else if (total < 20) err = '判定數太少（至少 20 步）才能擬合。';
    else if (m === 0) err = 'MARVELOUS 為 0 時無法估計中心寬度。';
    else if (m === total) err = '全部都是 MARVELOUS，看不出分布形狀。';
    if (err) { out.innerHTML = `<p class="err">${err}</p>`; lastFits = null; return; }

    const fits = FIT_MODELS.map(md => fitCounts(md, G.windows, counts));
    lastFits = fits;
    const best = fits.reduce((a, b) => (b.aic < a.aic ? b : a));
    const sorted = fits.slice().sort((a, b) => a.aic - b.aic);
    const runnerUp = sorted[1];
    const fmtC = v => v >= 99.95 ? int(v) : v.toFixed(1);

    const rowsHtml = fits.map((f, i) => `
      <tr class="${f === best ? 'best' : ''}">
        <th>${MODEL_NAMES[f.model]}${f === best ? ' <span class="pill ok">最佳</span>' : ''}<small>${shapeText(f)}</small></th>
        ${f.expected.map(v => `<td>${fmtC(v)}</td>`).join('')}
        <td class="hl">${(f.aic - best.aic).toFixed(1)}</td>
        <td>${pFmt(f.pValue)}</td>
        <td><button type="button" class="btn" data-fit="${i}">套用</button></td>
      </tr>`).join('');

    const normal = fits[0];
    const normalLine = normal.pValue != null && normal.pValue < 0.05
      ? `常態分布和你的判定數明顯不合（p ${pFmt(normal.pValue)}）：它預測 GREAT 以下只有 ${fmtC(normal.expected[2] + normal.expected[3] + normal.expected[4])} 步，實際是 ${g + gd + miss} 步。`
      : '常態分布和你的判定數沒有明顯衝突（p ≥ 0.05）。';
    const close = runnerUp.aic - best.aic < 2;

    out.innerHTML = `
      <div class="tbl-wrap">
        <table class="tbl fit-tbl">
          <thead><tr><th>模型</th><th>MARV</th><th>PERF</th><th>GREAT</th><th>GOOD</th><th>MISS</th><th>ΔAIC</th><th>適合度 p</th><th></th></tr></thead>
          <tbody>
            <tr class="obs"><th>你的判定數</th>${counts.map(v => `<td>${int(v)}</td>`).join('')}<td></td><td></td><td></td></tr>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
      <p><b>最符合的是${MODEL_NAMES[best.model]}</b>${close ? `，但和${MODEL_NAMES[runnerUp.model]}只差 ${(runnerUp.aic - best.aic).toFixed(1)}，兩者差不多` : ''}。${normalLine}</p>
      <p class="note" id="fit-msg">各模型那一列是「用最佳參數預測的判定數」。適合度 p 小於 0.05 表示模型和資料明顯不合；雙常態混合有 3 個參數，只剩 1 個自由度，p 值參考就好。按「套用」會把該模型的參數帶到 PART 2。</p>`;
  }

  function applyFit(f) {
    let clipped = false;
    const clip = (v, lo, hi) => { const c = clamp(v, lo, hi); if (Math.abs(c - v) > 1e-9) clipped = true; return c; };
    const scale = f.dist.info[0] ? f.dist.info[0][1] : f.sd;
    let sd;
    if (f.model === 'normal') sd = f.sd;
    else if (f.model === 't') {
      const nu = round(clip(f.shape.nu, 2.5, 30), 1);
      S.prm.t.nu = nu;
      sd = M.tScale(scale, 0, nu).sd;
    } else if (f.model === 'gn') {
      const beta = round(clip(f.shape.beta, 0.6, 6), 2);
      S.prm.gn.beta = beta;
      sd = M.gnScale(scale, 0, beta).sd;
    } else if (f.model === 'shift') {
      const dr = round(clip(f.shape.dr, 0, 2.5), 2);
      S.prm.shift.dr = dr;
      sd = M.shiftScale(scale, 0, dr * scale).sd;
    } else if (f.model === 'plateau') {
      const ar = round(clip(f.shape.ar, 0, 5), 2);
      S.prm.plateau.ar = ar;
      sd = M.plateauScale(f.dist.info[1][1], 0, ar * f.dist.info[1][1]).sd;
    } else {
      const p = round(clip(f.shape.p, 0.01, 0.4), 2), k = round(clip(f.shape.k, 1.2, 6), 1);
      S.prm.mixture = { p, k };
      sd = M.mixtureScale(scale, 0, p, k).sd;
    }
    S.model = f.model;
    S.sd2 = round(clip(sd, SD_MIN, SD_MAX), 2);
    S.mu = 0;
    syncP2Controls();
    later(renderP2);
    save();
    const msg = $('#fit-msg');
    if (msg && clipped) msg.innerHTML = `已套用${MODEL_NAMES[f.model]}。部分參數超出 PART 2 滑桿的範圍，已調整為最接近的值，所以 PART 2 的曲線會和這裡的擬合結果略有差異。`;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('#shape').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

  // =====================================================================
  // 事件
  // =====================================================================
  bindNumber($('#p1-sd'), $('#p1-sd-num'), SD_MIN, SD_MAX, 2, setSd1);
  const chartInputs = { steps: ['#c-steps', 10, 3000], freezes: ['#c-freezes', 0, 500], shocks: ['#c-shocks', 0, 500] };
  for (const [k, [sel, lo, hi]] of Object.entries(chartInputs)) {
    const el = $(sel);
    el.value = S.chart[k];
    el.addEventListener('change', () => {
      const v = parseInt(el.value, 10);
      S.chart[k] = isFinite(v) ? clamp(v, lo, hi) : S.chart[k];
      el.value = S.chart[k];
      later(renderP1); later(renderP2);
      save();
    });
  }
  $('#p1-table').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-sd]');
    if (tr) setSd1(+tr.dataset.sd);
  });

  const setSd2 = v => {
    S.sd2 = round(clamp(v, SD_MIN, SD_MAX), 2);
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
  bindNumber($('#p2-sd'), $('#p2-sd-num'), SD_MIN, SD_MAX, 2, setSd2);
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

  const fitInputs = { m: '#f-m', p: '#f-p', g: '#f-g', gd: '#f-gd', miss: '#f-miss' };
  for (const [k, sel] of Object.entries(fitInputs)) {
    const el = $(sel);
    el.value = S.fit[k];
    el.addEventListener('input', () => {
      const v = Number(el.value);
      S.fit[k] = el.value.trim() === '' ? NaN : v;
      later(renderFit);
      if (Number.isInteger(v) && v >= 0) save();
    });
  }
  $('#fit-out').addEventListener('click', e => {
    const b = e.target.closest('button[data-fit]');
    if (b && lastFits) applyFit(lastFits[+b.dataset.fit]);
  });

  // 初始化
  $('#p1-sd').value = S.sd1;
  $('#p1-sd-num').value = S.sd1.toFixed(2);
  syncP2Controls();
  renderP1();
  renderP2();
  renderFit();

  let lastW = 0;
  new ResizeObserver(entries => {
    const w = Math.round(entries[0].contentRect.width);
    if (w === lastW) return;
    lastW = w;
    later(renderP1);
    later(renderP2);
  }).observe($('.wrap'));
})();
