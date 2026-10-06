/* 標的展開後的走勢圖：當日／五日／日K／週K，日K、週K 下方有 MACD（DIF、DEA、紅綠柱）與 RSI。
   用 TradingView Lightweight Charts（Apache-2.0）。資料在 k/<代碼>.json，展開時才下載。 */
var KChart = (function () {
  var LC = window.LightweightCharts, cache = {}, cur = null;
  var MODES = [["i1", "當日"], ["i5", "五日"], ["d", "日K"], ["w", "週K"], ["m", "月K"]];
  var mode = "d";
  try { var sm = localStorage.getItem("cd_kmode"); if (MODES.some(function (m) { return m[0] === sm; })) mode = sm; } catch (e) {}

  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  function alpha(c, a) {
    var m = /^#([0-9a-f]{6})$/i.exec(c);
    if (!m) return c;
    var n = parseInt(m[1], 16);
    return "rgba(" + (n >> 16) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a + ")";
  }
  function load(sym, ver) {
    if (!cache[sym]) cache[sym] = fetch("k/" + encodeURIComponent(sym) + ".json?t=" + encodeURIComponent(ver || ""))
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(function (e) { delete cache[sym]; throw e; });
    return cache[sym];
  }

  // ---- 指標（和後端 indicators.py 一致：EMA、RSI 都用 SMA 起始值） ----
  function ema(v, n) {
    var out = v.map(function () { return null; }), s = 0;
    while (s < v.length && v[s] == null) s++;
    if (v.length - s < n) return out;
    var a = 2 / (n + 1), sum = 0;
    for (var i = s; i < s + n; i++) sum += v[i];
    out[s + n - 1] = sum / n;
    for (i = s + n; i < v.length; i++) out[i] = out[i - 1] + a * (v[i] - out[i - 1]);
    return out;
  }
  function sma(v, n) {
    var out = [], sum = 0;
    for (var i = 0; i < v.length; i++) { sum += v[i]; if (i >= n) sum -= v[i - n]; out.push(i >= n - 1 ? sum / n : null); }
    return out;
  }
  function macd(c) {
    var f = ema(c, 12), s = ema(c, 26);
    var dif = c.map(function (_, i) { return f[i] == null || s[i] == null ? null : f[i] - s[i]; });
    var dea = ema(dif, 9);
    return { dif: dif, dea: dea, hist: dif.map(function (x, i) { return dea[i] == null ? null : x - dea[i]; }) };
  }
  function rsi(c, n) {
    n = n || 14;
    var out = c.map(function () { return null; });
    if (c.length <= n) return out;
    var ag = 0, al = 0, i, d;
    for (i = 1; i <= n; i++) { d = c[i] - c[i - 1]; if (d > 0) ag += d; else al -= d; }
    ag /= n; al /= n;
    out[n] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (i = n + 1; i < c.length; i++) {
      d = c[i] - c[i - 1];
      ag = (ag * (n - 1) + (d > 0 ? d : 0)) / n;
      al = (al * (n - 1) + (d < 0 ? -d : 0)) / n;
      out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
    return out;
  }
  function weekly(j) {
    var w = { d: [], o: [], h: [], l: [], c: [] }, key = null;
    for (var i = 0; i < j.d.length; i++) {
      var dt = new Date(j.d[i] + "T00:00:00Z"), mon = new Date(dt - ((dt.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
      if (mon !== key) { key = mon; w.d.push(j.d[i]); w.o.push(j.o[i]); w.h.push(j.h[i]); w.l.push(j.l[i]); w.c.push(j.c[i]); continue; }
      var k = w.d.length - 1;
      w.d[k] = j.d[i]; w.h[k] = Math.max(w.h[k], j.h[i]); w.l[k] = Math.min(w.l[k], j.l[i]); w.c[k] = j.c[i];
    }
    return w;
  }
  /** 定投點：RSI < 50、MACD 綠柱開始縮短、價格在 200 日均線之上；同一波至少隔 20 根。 */
  function dips(c, r, h, ma200) {
    var out = [], last = -1e9;
    for (var i = 2; i < c.length; i++) {
      if (r[i] == null || h[i] == null || h[i - 2] == null || ma200[i] == null) continue;
      if (r[i] < 50 && h[i] < 0 && h[i] > h[i - 1] && h[i - 1] <= h[i - 2] && c[i] > ma200[i] && i - last >= 20) { out.push(i); last = i; }
    }
    return out;
  }

  function fmt(v) {
    if (v == null) return "—";
    var a = Math.abs(v);
    return a >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : v.toFixed(a >= 100 ? 1 : 2);
  }
  function pct(x) {
    if (x == null || !isFinite(x)) return "";
    return '<span class="' + (x > 0 ? "pos" : x < 0 ? "neg" : "") + '">' + (x > 0 ? "+" : "") + (x * 100).toFixed(2) + "%</span>";
  }
  function hhmm(t) { return new Date(t * 1000).toISOString().slice(11, 16); }
  function mmdd(t) { return new Date(t * 1000).toISOString().slice(5, 10).replace("-", "/"); }

  function destroy() { if (cur && cur.chart) { cur.chart.remove(); } cur = null; }

  /** opt：{sym, ver, title, score: {d, s}, band: function(score)→顏色} */
  function mount(el, opt) {
    destroy();
    el.innerHTML = '<div class="tabs ktabs">' + MODES.map(function (m) {
      return '<button data-k="' + m[0] + '" aria-pressed="' + (m[0] === mode) + '">' + m[1] + "</button>";
    }).join("") + '</div><div class="klg"></div><div class="kbox"></div><div class="knote"></div>';
    el.querySelector(".ktabs").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      mode = b.dataset.k; try { localStorage.setItem("cd_kmode", mode); } catch (er) {}
      [].forEach.call(this.children, function (x) { x.setAttribute("aria-pressed", x === b); });
      draw(el, opt);
    });
    draw(el, opt);
  }

  function draw(el, opt) {
    var box = el.querySelector(".kbox"), lg = el.querySelector(".klg"), note = el.querySelector(".knote");
    if (!LC) { box.textContent = "圖表元件載入失敗，請重新整理。"; return; }
    var token = {}; el._tok = token;
    load(opt.sym, opt.ver).then(function (j) {
      if (el._tok !== token || !el.isConnected) return;
      if (cur && cur.chart) cur.chart.remove();
      box.innerHTML = ""; note.textContent = "";
      if (mode === "i1" || mode === "i5") drawIntra(box, lg, note, j);
      else drawK(box, lg, note, j, opt);
    }).catch(function (e) { box.innerHTML = '<div class="dim" style="padding:20px 0">走勢資料還沒產生（下次排程更新後就有）。</div>'; lg.innerHTML = ""; });
  }

  function base(box, height, extra) {
    box.style.height = height + "px";
    var o = {
      autoSize: true,
      layout: { background: { type: "solid", color: "transparent" }, textColor: css("--sub"), fontSize: 11, panes: { separatorColor: css("--line") } },
      grid: { vertLines: { visible: false }, horzLines: { color: alpha(css("--line"), 0.6) } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, rightOffset: 2 },
      crosshair: { mode: 0 },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: false, axisDoubleClickReset: true },
      localization: { locale: "zh-TW" }
    };
    for (var k in extra) o[k] = extra[k];
    var chart = LC.createChart(box, o);
    cur = { chart: chart };
    return chart;
  }

  function drawIntra(box, lg, note, j) {
    if (!j.i || !j.i.t.length) { box.innerHTML = '<div class="dim" style="padding:20px 0">這檔沒有盤中走勢資料。</div>'; lg.innerHTML = ""; return; }
    var t = j.i.t, c = j.i.c, day = function (x) { return Math.floor(x / 86400); };
    var lastDay = day(t[t.length - 1]), from = 0, prev = null;
    if (mode === "i1") {
      while (from < t.length && day(t[from]) !== lastDay) from++;
      prev = from > 0 ? c[from - 1] : null;
    } else {
      // 五日：以第一天開盤前一筆當基準（沒有就用第一筆）
      prev = c[0];
    }
    var up = css("--up"), dn = css("--down");
    var chart = base(box, 240, { timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 2 } });
    var ref = prev == null ? c[from] : prev;
    var s = chart.addSeries(LC.BaselineSeries, {
      baseValue: { type: "price", price: ref }, lineWidth: 2, priceLineVisible: false,
      topLineColor: up, topFillColor1: alpha(up, 0.25), topFillColor2: alpha(up, 0.02),
      bottomLineColor: dn, bottomFillColor1: alpha(dn, 0.02), bottomFillColor2: alpha(dn, 0.25)
    });
    var data = [];
    for (var i = from; i < t.length; i++) data.push({ time: t[i], value: c[i] });
    s.setData(data);
    s.createPriceLine({ price: ref, color: css("--sub"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
    chart.timeScale().fitContent();
    var lastT = t[t.length - 1];
    function show(i) {
      var x = data[i];
      lg.innerHTML = "<b>" + mmdd(x.time) + " " + hhmm(x.time) + "</b>　" + fmt(x.value) + "　" + pct(x.value / ref - 1)
        + '<span class="dim">　' + (mode === "i1" ? "相對前一日收盤" : "相對五日前") + "</span>";
    }
    show(data.length - 1);
    chart.subscribeCrosshairMove(function (p) {
      if (!p || p.time == null) { show(data.length - 1); return; }
      for (var i = 0; i < data.length; i++) if (data[i].time === p.time) { show(i); return; }
    });
    note.textContent = "5 分鐘走勢，資料時間到 " + mmdd(lastT) + " " + hhmm(lastT) + "（交易所當地時間）。只在排程更新時抓取，不是即時報價。";
  }

  function drawK(box, lg, note, j, opt) {
    var mo = mode === "m", w = mode === "w" || mo, k = mo ? j.m : mode === "w" ? weekly(j) : j;
    if (!k || !k.d || !k.d.length) { box.innerHTML = '<div class="dim" style="padding:20px 0">月K 資料還沒產生（下次排程更新後就有）。</div>'; lg.innerHTML = ""; return; }
    var n = k.d.length, unit = mo ? " 月" : mode === "w" ? " 週" : " 日";
    var up = css("--up"), dn = css("--down"), ink = css("--ink"), sub = css("--sub"), gold = css("--gold");
    var m = macd(k.c), r = rsi(k.c, 14);
    var ma = mo ? [[12, css("--c1")], [60, css("--c7")]] : w ? [[10, css("--c1")], [40, css("--c7")]] : [[20, css("--c1")], [60, css("--c5")], [200, css("--c7")]];
    var mav = ma.map(function (x) { return sma(k.c, x[0]); });
    var hasScore = !w && opt.score && opt.score.d && opt.score.d.length;
    var chart = base(box, hasScore ? 440 : 400, {});
    var cs = chart.addSeries(LC.CandlestickSeries, {
      upColor: up, downColor: dn, borderUpColor: up, borderDownColor: dn, wickUpColor: up, wickDownColor: dn, priceLineVisible: false
    }, 0);
    cs.setData(k.d.map(function (d, i) { return { time: d, open: k.o[i], high: k.h[i], low: k.l[i], close: k.c[i] }; }));
    ma.forEach(function (x, q) {
      var ls = chart.addSeries(LC.LineSeries, { color: x[1], lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0);
      ls.setData(k.d.map(function (d, i) { return mav[q][i] == null ? { time: d } : { time: d, value: mav[q][i] }; }));
    });
    if (!w) {
      // 拉回區（RSI < 50 且 MACD 綠柱）淡色底；定投點用箭頭
      var zone = chart.addSeries(LC.HistogramSeries, { priceScaleId: "zone", color: alpha(gold, 0.13), priceLineVisible: false, lastValueVisible: false }, 0);
      zone.priceScale().applyOptions({ scaleMargins: { top: 0, bottom: 0 } });
      zone.setData(k.d.map(function (d, i) { return r[i] != null && r[i] < 50 && m.hist[i] != null && m.hist[i] < 0 ? { time: d, value: 1 } : { time: d }; }));
      var dp = dips(k.c, r, m.hist, mav[2]);
      LC.createSeriesMarkers(cs, dp.map(function (i) { return { time: k.d[i], position: "belowBar", color: gold, shape: "arrowUp", size: 1 }; }));
    }
    var trs = [];
    if (mo && j.tr && j.tr.length) {
      // 月線 MACD 谷底（已確認）：金＝分數 ≥ 20（甜蜜點）；藍＝站上年線（強勢谷底）；灰＝跌破年線（弱勢）
      var byMonth = {}; k.d.forEach(function (d) { byMonth[d.slice(0, 7)] = d; });
      j.tr.forEach(function (t) { var d = byMonth[t[0].slice(0, 7)]; if (d) trs.push({ d: d, s: t[1], up: t[2] }); });
      var blue = css("--c1");
      LC.createSeriesMarkers(cs, trs.map(function (t) {
        var sw = t.s != null && t.s >= 20, up = t.up;
        return { time: t.d, position: "belowBar", shape: "arrowUp", size: sw || up ? 1.6 : 1,
          color: sw ? gold : up ? blue : alpha(sub, 0.9), text: sw ? "甜蜜" : up ? "強勢" : "弱" };
      }));
    }
    // MACD
    var hs = chart.addSeries(LC.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "price", precision: 2, minMove: 0.01 } }, 1);
    hs.setData(k.d.map(function (d, i) {
      var v = m.hist[i]; if (v == null) return { time: d };
      var weak = i > 0 && m.hist[i - 1] != null && Math.abs(v) < Math.abs(m.hist[i - 1]);
      return { time: d, value: v, color: alpha(v >= 0 ? up : dn, weak ? 0.5 : 1) };
    }));
    var dif = chart.addSeries(LC.LineSeries, { color: ink, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 1);
    var dea = chart.addSeries(LC.LineSeries, { color: css("--c4"), lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 1);
    dif.setData(k.d.map(function (d, i) { return m.dif[i] == null ? { time: d } : { time: d, value: m.dif[i] }; }));
    dea.setData(k.d.map(function (d, i) { return m.dea[i] == null ? { time: d } : { time: d, value: m.dea[i] }; }));
    // RSI
    var rs = chart.addSeries(LC.LineSeries, { color: css("--c2"), lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false }, 2);
    rs.setData(k.d.map(function (d, i) { return r[i] == null ? { time: d } : { time: d, value: r[i] }; }));
    [[70, 2], [50, 0], [30, 2]].forEach(function (x) { rs.createPriceLine({ price: x[0], color: alpha(sub, 0.7), lineWidth: 1, lineStyle: x[1], axisLabelVisible: false, title: "" }); });
    rs.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.08 } });
    rs.applyOptions({ autoscaleInfoProvider: function () { return { priceRange: { minValue: 0, maxValue: 100 } }; } });
    // 便宜度分數色帶（只有日K）
    var sc = null;
    if (hasScore) {
      // 這一格的價格軸不能隱藏（會讓整張圖畫不出來），改成不顯示刻度文字
      sc = chart.addSeries(LC.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "custom", formatter: function () { return ""; } } }, 3);
      sc.setData(opt.score.d.map(function (d, i) { var v = opt.score.s[i]; return v == null ? { time: d } : { time: d, value: 1, color: opt.band(v) }; }));
      sc.priceScale().applyOptions({ ticksVisible: false, scaleMargins: { top: 0, bottom: 0 } });
    }
    var panes = chart.panes();
    // 用比例分配高度（autoSize 在第一次畫之前還不知道總高度，setHeight 會失效）
    panes[0].setStretchFactor(205);
    panes[1].setStretchFactor(85);
    panes[2].setStretchFactor(75);
    if (panes[3]) panes[3].setStretchFactor(22);
    var show0 = Math.min(n, mo ? 120 : w ? 104 : 130);
    chart.timeScale().setVisibleLogicalRange({ from: n - show0, to: n + 1 });

    var idx = {}; k.d.forEach(function (d, i) { idx[d] = i; });
    var scIdx = {}; if (hasScore) opt.score.d.forEach(function (d, i) { scIdx[d] = opt.score.s[i]; });
    function show(i) {
      var chg = i > 0 ? k.c[i] / k.c[i - 1] - 1 : null, sv = scIdx[k.d[i]];
      lg.innerHTML = "<b>" + k.d[i] + "</b>　開 " + fmt(k.o[i]) + "　高 " + fmt(k.h[i]) + "　低 " + fmt(k.l[i]) + "　收 <b>" + fmt(k.c[i]) + "</b> " + pct(chg)
        + '<br><span class="dim">MACD</span> DIF ' + fmt(m.dif[i]) + "　DEA " + fmt(m.dea[i]) + "　柱 " + (m.hist[i] == null ? "—" : '<span class="' + (m.hist[i] >= 0 ? "pos" : "neg") + '">' + fmt(m.hist[i]) + "</span>")
        + '　<span class="dim">RSI</span> ' + (r[i] == null ? "—" : r[i].toFixed(0))
        + (sv != null ? '　<span class="dim">分數</span> ' + sv.toFixed(0) : "");
    }
    show(n - 1);
    chart.subscribeCrosshairMove(function (p) {
      var i = p && p.time != null ? idx[typeof p.time === "string" ? p.time : (p.time.year + "-" + String(p.time.month).padStart(2, "0") + "-" + String(p.time.day).padStart(2, "0"))] : null;
      show(i == null ? n - 1 : i);
    });
    var lines = ma.map(function (x) { return '<i class="kl" style="background:' + x[1] + '"></i>' + x[0] + unit + "均線"; }).join("　");
    note.innerHTML = lines + (mo ? '<br>月線 MACD 谷底：<b style="color:var(--gold)">▲甜蜜</b> 分數 ≥ 20　<b style="color:var(--c1)">▲強勢</b> 站上年線　<b class="dim">▲弱</b> 跌破年線' : w ? "" : '　<span class="kz"></span>拉回區（RSI&lt;50 且綠柱）　<b style="color:var(--gold)">▲</b> 定投點')
      + "<br>MACD：深色線 DIF、橘線 DEA，柱子變淡＝比前一根短。RSI 虛線 30／70、實線 50。"
      + (hasScore ? "最下方色帶是便宜度分數（綠＝便宜、紅＝貴）。" : "")
      + (mo ? "<br>谷底＝月線綠柱上個月最深、這個月開始縮短（月收盤才確認）。甜蜜、強勢兩種回測都優於平常；弱勢（跌破年線）沒有優勢、之後常再深跌。綠柱「剛出現」不是買點，要等它開始縮短。" + (trs.length ? "" : "這段期間沒有出現過。") : "")
      + (w ? "" : "<br>定投點＝RSI&lt;50、綠柱開始縮短、價格在 200 日均線上。回測只比任意日好一點點，當作「不是在追高」的參考，不是買進訊號。")
      + (opt.title ? "<br>" + opt.title : "");
  }

  return { mount: mount, destroy: destroy };
})();
