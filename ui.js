/*
 * 共用 UI 工具：數字格式、SVG 圖表（含 hover）、判定窗尺規、表單、模型說明、狀態保存
 */
(function (root) {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

  // ---------- 狀態保存（只存在這位使用者的瀏覽器）----------
  function merge(base, src) {
    if (!src || typeof src !== 'object') return base;
    for (const k of Object.keys(base)) {
      if (src[k] === undefined) continue;
      if (Array.isArray(base[k])) { if (Array.isArray(src[k])) base[k] = src[k]; }
      else if (base[k] && typeof base[k] === 'object') merge(base[k], src[k]);
      else if (typeof src[k] === typeof base[k] && (typeof src[k] !== 'number' || isFinite(src[k]))) base[k] = src[k];
    }
    return base;
  }
  function store(key, defaults) {
    const S = JSON.parse(JSON.stringify(defaults));
    try { merge(S, JSON.parse(localStorage.getItem(key))); } catch (e) { /* 無法讀取就用預設值 */ }
    const save = () => { try { localStorage.setItem(key, JSON.stringify(S)); } catch (e) { /* 忽略 */ } };
    return { S, save };
  }

  // ---------- 格式 ----------
  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };
  const sup = s => String(s).replace(/[0-9-]/g, c => SUP[c]);
  const pct = (v, d = 2) => (v * 100).toFixed(d) + '%';
  const pts = v => Math.round(v * 1e5).toLocaleString('en-US');
  const int = v => Math.round(v).toLocaleString('en-US');
  const signed = (v, d) => {
    const a = Math.abs(v).toFixed(d);
    return (+a === 0 ? '±' : v > 0 ? '+' : '−') + a;
  };
  const signedInt = v => (v >= 0 ? '+' : '−') + Math.abs(Math.round(v)).toLocaleString('en-US');
  function expo(v) {
    const e = Math.floor(Math.log10(v)), m = v / 10 ** e;
    return `${m.toFixed(1)}×10${sup(e)}`;
  }
  // 極小機率：一般用百分比，太小改用 10 的次方
  function small(v) {
    if (!(v > 1e-300)) return '≈ 0';
    if (v >= 1e-4) return pct(v, v >= 0.01 ? 2 : 3);
    return expo(v);
  }
  function ratio(a, b) {
    if (!(a > 1e-300 && b > 1e-300)) return '';
    const r = a / b;
    if (r >= 1000) return `×10${sup(Math.round(Math.log10(r)))}`;
    if (r <= 1e-3) return `×10${sup(Math.round(Math.log10(r)))}`;
    return '×' + r.toFixed(r < 10 ? 2 : 0);
  }
  const reach = p => p >= 0.9995 ? '>99.9%' : p < 0.0005 ? '<0.1%' : (p * 100).toFixed(1) + '%';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  // ---------- 排程（同一幀只重畫一次）----------
  const queue = new Set();
  let raf = 0;
  function later(fn) {
    queue.add(fn);
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0;
      const fns = [...queue];
      queue.clear();
      fns.forEach(f => f());
    });
  }

  // ---------- SVG 圖表 ----------
  const L = (x1, y1, x2, y2, cls) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}"/>`;
  const T = (x, y, s, cls, anchor = 'start', style = '') =>
    `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}"${style ? ` style="${style}"` : ''}>${esc(s)}</text>`;
  const C = (x, y, r, cls, color) => `<circle cx="${x}" cy="${y}" r="${r}" class="${cls}" style="fill:${color}"/>`;
  const pathD = (points, xs, ys) =>
    points.map(([x, y], i) => (i ? 'L' : 'M') + xs(x).toFixed(1) + ' ' + ys(y).toFixed(1)).join('');

  function drawChart(host, cfg) {
    const svg = host.querySelector('svg');
    const W = Math.max(280, Math.round(host.getBoundingClientRect().width));
    const H = cfg.height;
    const m = Object.assign({ t: 20, r: 20, b: 36, l: 50 }, cfg.margin || {});
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const X = cfg.x, Y = cfg.y;
    const xs = v => m.l + (v - X.min) / (X.max - X.min) * pw;
    const xinv = px => X.min + (px - m.l) / pw * (X.max - X.min);
    const tf = Y.log ? v => Math.log10(Math.max(v, 1e-300)) : v => v;
    const lo = tf(Y.min), hi = tf(Y.max);
    const ys = v => m.t + (1 - (tf(v) - lo) / (hi - lo)) * ph;
    const c = { W, H, m, pw, ph, xs, ys, xinv, cfg, clip: `url(#${host.id}-clip)` };

    let o = `<defs><clipPath id="${host.id}-clip"><rect x="${m.l}" y="${m.t - 2}" width="${pw}" height="${ph + 4}"/></clipPath></defs>`;
    for (const v of Y.ticks) {
      const y = ys(v).toFixed(1);
      o += L(m.l, y, m.l + pw, y, 'grid') + T(m.l - 8, +y + 4, Y.fmt(v), 'tick', 'end');
    }
    o += L(m.l, m.t + ph, m.l + pw, m.t + ph, 'axis');
    const tickY = m.t + ph + (cfg.xTickGap || 0);
    for (const v of X.ticks) {
      const x = xs(v).toFixed(1);
      o += L(x, tickY, x, tickY + 4, 'axis') + T(x, tickY + 17, X.fmt(v), 'tick', 'middle');
    }
    if (cfg.under) o += cfg.under(c);
    for (const s of cfg.series) {
      const d = pathD(s.points, xs, ys);
      if (s.area) {
        const x0 = xs(s.points[0][0]).toFixed(1), x1 = xs(s.points[s.points.length - 1][0]).toFixed(1);
        o += `<path d="${d}L${x1} ${m.t + ph}L${x0} ${m.t + ph}Z" class="area" style="fill:${s.color}" clip-path="${c.clip}"/>`;
      }
      o += `<path d="${d}" class="series" style="stroke:${s.color}" clip-path="${c.clip}"/>`;
    }
    if (cfg.over) o += cfg.over(c);
    o += '<g class="hover"></g>';
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = o;
    host._c = c;
    if (!host._bound) bindHover(host);
  }

  function bindHover(host) {
    host._bound = true;
    const tip = host.querySelector('.tip');
    const hide = () => {
      tip.hidden = true;
      const g = host.querySelector('.hover');
      if (g) g.innerHTML = '';
    };
    const locate = e => {
      const c = host._c;
      const r = host.querySelector('svg').getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      if (!c || px < c.m.l - 4 || px > c.m.l + c.pw + 4 || py < 0 || py > c.H) return null;
      return { c, py, x: clamp(c.xinv(px), c.cfg.x.min, c.cfg.x.max) };
    };
    host.addEventListener('pointermove', e => {
      const p = locate(e);
      if (!p || !p.c.cfg.hover) return hide();
      const hv = p.c.cfg.hover(p.x);
      if (!hv) return hide();
      const { c } = p, x = c.xs(hv.x).toFixed(1);
      let g = L(x, c.m.t, x, c.m.t + c.ph, 'cross');
      for (const q of hv.points) {
        if (!(q.y >= c.cfg.y.min && q.y <= c.cfg.y.max)) continue;
        g += C(x, c.ys(q.y).toFixed(1), 4.5, 'dot', q.color);
      }
      host.querySelector('.hover').innerHTML = g;
      tip.innerHTML = `<div class="tip-t">${hv.title}</div>` + hv.rows.map(r =>
        `<div class="tip-r"><i style="background:${r.color || 'transparent'}"></i><span>${r.label}</span><b>${r.value}</b></div>`).join('');
      tip.hidden = false;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = +x + 14;
      if (left + tw > c.W - 2) left = +x - 14 - tw;
      tip.style.left = Math.max(0, left) + 'px';
      tip.style.top = clamp(p.py - th - 12, 0, Math.max(0, c.H - th)) + 'px';
    });
    host.addEventListener('pointerleave', hide);
    host.addEventListener('click', e => {
      const p = locate(e);
      if (p && p.c.cfg.onClick) p.c.cfg.onClick(p.x);
    });
  }

  function niceStep(span, count) {
    const raw = span / count, pow = 10 ** Math.floor(Math.log10(raw));
    const f = raw / pow;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  }
  function ticks(lo, hi, step) {
    const out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(round(v, 6));
    return out;
  }
  function interp(points, x) {
    if (x <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      if (points[i][0] >= x) {
        const [x0, y0] = points[i - 1], [x1, y1] = points[i];
        return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
      }
    }
    return points[points.length - 1][1];
  }

  function rulerRow(c, y, h, windows, names, g) {
    const X0 = c.cfg.x.min, X1 = c.cfg.x.max;
    const bounds = [X0, ...windows.slice().reverse().map(w => -w), ...windows.map(w => w), X1];
    const n = windows.length;
    let o = '';
    for (let i = 0; i < bounds.length - 1; i++) {
      const a = Math.max(X0, bounds[i]), b = Math.min(X1, bounds[i + 1]);
      if (b <= a) continue;
      const lv = i < n ? n - i : i - n;   // 0 = 中心
      const x0 = c.xs(a) + 1, x1 = c.xs(b) - 1, w = x1 - x0;
      if (w <= 0) continue;
      o += `<rect x="${x0.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${h}" rx="3" style="fill:var(--r-${g}-${lv + 1})"/>`;
      const name = names[lv];
      if (w >= name.length * 6.6 + 8) {
        o += T(((x0 + x1) / 2).toFixed(1), y + h / 2 + 3.5, name, 'seg-lbl', 'middle', `fill:var(--r-${g}-${lv + 1}-fg)`);
      }
    }
    return o;
  }

  function judgeName(windows, names, x) {
    const a = Math.abs(x);
    for (let i = 0; i < windows.length; i++) if (a <= windows[i]) return names[i];
    return names[names.length - 1];
  }

  // ---------- 表單 ----------
  function bindNumber(rangeEl, numEl, lo, hi, digits, set) {
    rangeEl.addEventListener('input', () => set(+rangeEl.value));
    numEl.addEventListener('change', () => {
      const v = parseFloat(numEl.value);
      if (isFinite(v)) set(clamp(v, lo, hi));
      else numEl.value = (+rangeEl.value).toFixed(digits);
    });
  }

  // ---------- 分布模型說明（兩個頁面共用）----------
  const MODEL_INFO = {
    normal: {
      fx: '<i class="v">X</i> ~ N(<i class="v">μ</i>, <i class="v">σ</i><sup>2</sup>)',
      text: '原圖使用的模型。尾巴衰減得非常快：σ = 13 ms 時，誤差超過 ±100 ms 的機率大約只有 10⁻¹⁴，等於假設玩家永遠打不出 BAD。',
      pro: '只有一個參數，計算最簡單。',
      con: '低估大誤差，把玩家想得太穩定。'
    },
    mixture: {
      fx: '<i class="v">X</i> ~ (1−<i class="v">p</i>)·N(<i class="v">μ</i>, <i class="v">σ</i><sub>c</sub><sup>2</sup>) + <i class="v">p</i>·N(<i class="v">μ</i>, (<i class="v">k σ</i><sub>c</sub>)<sup>2</sup>)',
      text: '大部分 note 打在穩定的核心 σc；比例 p 的 note（交互、皿、縱連、讀不到的段落）誤差放大成 k 倍。',
      pro: '參數有直覺意義，能直接對應「穩定段／失準段」。',
      con: '三個參數，只看 PGREAT、GREAT 數量無法唯一決定。'
    },
    t: {
      fx: '<i class="v">X</i> = <i class="v">μ</i> + <i class="v">s</i>·<i class="v">T</i><sub><i class="v">ν</i></sub>',
      text: '等於「每顆 note 的 σ 都不一樣」的常態連續混合（σ² 服從逆 Gamma 分布）。ν 越小尾巴越厚，ν → ∞ 就回到常態。',
      pro: '只比常態多一個參數，對偶發大失誤很穩健。',
      con: 'ν ≤ 2 時標準差不存在，要改用尺度 s 描述準度。'
    },
    gn: {
      fx: '<i class="v">f</i>(<i class="v">x</i>) ∝ exp(−(|<i class="v">x</i> − <i class="v">μ</i>| / <i class="v">α</i>)<sup><i class="v">β</i></sup>)',
      text: 'β = 2 是常態，β = 1 是拉普拉斯分布（尖峰），β > 2 是中間平、邊緣陡降的平頂分布。一個參數同時涵蓋兩個方向。',
      pro: '看 β 就知道偏尖還是偏平，可以用自己的判定數直接反推（PART 3）。',
      con: '尾巴仍是指數衰減，極端失誤的比例可能低估。'
    }
  };
  MODEL_INFO.shift = {
    fx: '½·N(<i class="v">μ</i> − <i class="v">d</i>, <i class="v">σ</i><sup>2</sup>) + ½·N(<i class="v">μ</i> + <i class="v">d</i>, <i class="v">σ</i><sup>2</sup>)',
    text: 'note 分成兩群，一群偏早 d、一群偏晚 d（例如左右手、左右腳、不同 note 種類的 offset 不一致）。d/σ < 1 時是一個平頂的峰，尾巴比同 SD 的常態更薄；d/σ > 1 會分成兩個峰。',
    pro: '和雙常態混合方向相反：中間變寬、尾巴變薄，而且能對應到「offset 不一致」這個具體原因。',
    con: '假設兩群一樣多、寬度一樣；偶發的大失誤完全描述不了。'
  };
  MODEL_INFO.plateau = {
    fx: '<i class="v">X</i> = <i class="v">μ</i> + <i class="v">U</i> + <i class="v">E</i>，<i class="v">U</i> ~ 均勻(−<i class="v">a</i>, <i class="v">a</i>)，<i class="v">E</i> ~ N(0, <i class="v">σ</i><sup>2</sup>)',
    text: '在 ±a 以內早晚「分不出來」，誤差平均分布；超出 ±a 之後才像常態一樣快速衰減。a/σ 越大，中間越平、邊緣越陡；a = 0 就是常態。',
    pro: '直接描述「中間一段都差不多、往外急速變少」，尾巴比常態更薄。',
    con: '平台內完全均勻是理想化；實際資料通常仍有微弱的峰。'
  };
  const PARAM_INFO = {
    p: { label: '失準 note 比例 p', fmt: v => Math.round(v * 100) + '%' },
    k: { label: '失準寬度倍率 k', fmt: v => '×' + v.toFixed(1) },
    nu: { label: '自由度 ν（越小尾巴越厚）', fmt: v => v.toFixed(1) },
    beta: { label: '形狀 β（2 = 常態）', fmt: v => v.toFixed(2) },
    dr: { label: '兩群距離 d/σ（< 1 平頂、> 1 雙峰）', fmt: v => v.toFixed(2) },
    ar: { label: '平台寬 a/σ（0 = 常態）', fmt: v => v.toFixed(2) }
  };

  root.UI = {
    $, $$, clamp, round, store,
    sup, pct, pts, int, signed, signedInt, expo, small, ratio, reach, esc,
    later, L, T, C, pathD, drawChart, niceStep, ticks, interp,
    rulerRow, judgeName, bindNumber, MODEL_INFO, PARAM_INFO
  };
})(this);
