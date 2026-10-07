/* 持倉分頁：讀寫 repo 裡的 holdings.json（透過 GitHub API），價格來自 prices.json。 */
(function () {
  "use strict";
  var CAP = 0.10;                // 單一標的佔總資產的提醒上限（設定頁可改，載入 data.json 後覆蓋）
  var P = window.HoldParse;
  var ACCTS = P.ACCOUNTS;
  var REPO = GH.REPO, ls = GH.ls, token = GH.token;

  var S = { h: null, sha: null, prices: null, data: null, ccy: "USD", open: {}, rows: [], msg: "", busy: false, confirmDel: null, renaming: null };
  S.ccy = ls("cd_ccy") === "TWD" ? "TWD" : "USD";
  S.chart = ls("cd_chart") || "alloc";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function money(v, ccy, dp) {
    if (v == null || isNaN(v)) return "—";
    var d = dp != null ? dp : (ccy === "USD" ? 2 : 0);
    return (v < 0 ? "-" : "") + (ccy === "USD" ? "$" : "") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function signed(v, ccy) { if (v == null || isNaN(v)) return "—"; return '<span class="' + (v > 0 ? "pos" : v < 0 ? "neg" : "") + '">' + (v > 0 ? "+" : "") + money(v, ccy) + "</span>"; }
  function pct(x, d) { if (x == null || !isFinite(x)) return "—"; return '<span class="' + (x > 0 ? "pos" : x < 0 ? "neg" : "") + '">' + (x > 0 ? "+" : "") + (x * 100).toFixed(d == null ? 1 : d) + "%</span>"; }
  function num(x, d) { return x == null ? "—" : Number(x).toLocaleString("en-US", { maximumFractionDigits: d == null ? 4 : d }); }
  function isTW(sym) { return /\d/.test(sym); }   // 台股代碼都有數字（含 AU9901 黃金現貨）
  function acctName(id) { var a = ACCTS.filter(function (x) { return x.id === id; })[0]; return a ? a.name : "（未指定）"; }
  function fx() { return S.prices && S.prices.fx ? S.prices.fx.price : null; }
  function toTWD(v, ccy) { return ccy === "USD" ? (fx() ? v * fx() : null) : v; }

  // ---------- GitHub 讀寫 ----------
  function loadHoldings() {
    return GH.get("holdings.json").then(function (r) { S.sha = r.sha; S.h = normalizeH(r.data); });
  }
  function saveHoldings(h, message) {
    h.updated = new Date().toISOString();
    return GH.put("holdings.json", h, S.sha, message).then(function (sha) { S.sha = sha; S.h = h; });
  }
  function normalizeH(h) { h.lots = h.lots || []; h.cash = h.cash || {}; h.names = h.names || {}; h.manual = h.manual || {}; h.targets = h.targets || {}; return h; }

  // ---------- 計算 ----------
  function positions() {
    var map = {};
    S.h.lots.slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); }).forEach(function (l) {
      var k = l.acct + "|" + l.sym;
      var p = map[k] || (map[k] = { acct: l.acct, sym: l.sym, qty: 0, cost: 0, lots: [] });
      if (l.qty >= 0) { p.cost += l.qty * l.px; p.qty += l.qty; }
      else { var avg = p.qty ? p.cost / p.qty : 0; p.qty += l.qty; p.cost -= avg * -l.qty; }   // 賣出：平均成本法
      p.lots.push(l);
    });
    return Object.keys(map).map(function (k) {
      var p = map[k], q = S.prices && S.prices.q[p.sym];
      var man = S.h.manual[p.sym];
      if (man && man.price > 0 && (!q || q.est)) q = { price: man.price, prev: null, chg: null, date: man.date || "", manual: true };  // 手動價格優先於估算
      p.ccy = isTW(p.sym) ? "TWD" : "USD";
      p.avg = p.qty ? p.cost / p.qty : null;
      p.price = q ? q.price : null;
      p.q = q;
      p.mv = q ? p.qty * q.price : null;
      p.pnl = q ? p.mv - p.cost : null;
      p.today = q && q.prev ? p.qty * (q.price - q.prev) : null;
      return p;
    }).filter(function (p) { return Math.abs(p.qty) > 1e-9; });
  }
  function scoreOf(sym) {
    if (!S.data) return null;
    var v = ls("cd_v") === "5y" ? "5y" : "full";
    var it = S.data.items.filter(function (r) { return r.symbol.replace(/\.TW$/, "") === sym; })[0];
    if (it) return { score: it.v[v].current.score, level: it.v[v].current.level, group: it.group };
    var q = S.prices && S.prices.q[sym];   // 不在觀察清單的持股：用持股自己的分數
    return q && q["s_" + v] ? { score: q["s_" + v].score, level: q["s_" + v].level, group: "" } : null;
  }

  // ---------- 分類 ----------
  var RISK = [   // 顏色跟著類別固定，不跟排名變
    ["大盤 ETF", "var(--c1)"], ["槓桿 ETF", "var(--c2)"], ["產業／主題 ETF", "var(--c3)"],
    ["黃金", "var(--c4)"], ["個股", "var(--c7)"], ["現金", "var(--cnull)"]
  ];
  var THEME_COLOR = { "半導體": "var(--c1)", "記憶體": "var(--c2)", "美股大盤": "var(--c3)", "台股大盤": "var(--c4)",
    "AI／軟體": "var(--c5)", "黃金": "var(--c6)", "生技": "var(--c7)", "電動車": "var(--c8)", "全球": "var(--cnull2)", "其他": "var(--cnull)" };
  var ACCT_COLOR = { "hn-tw": "var(--c1)", "hn-us": "var(--c2)", "fb-tw": "var(--c3)", "fb-us": "var(--c4)", "moomoo": "var(--c5)", "etoro": "var(--c7)" };
  function metaOf(sym) {
    var it = S.data && S.data.items.filter(function (r) { return r.symbol.replace(/\.TW$/, "") === sym; })[0];
    var v = ls("cd_v") === "5y" ? "5y" : "full";
    if (it) return { name: it.name, type: it.type, theme: it.theme || "其他", group: it.group, x: it.x, cur: it.v[v].current };
    var q = S.prices && S.prices.q[sym];
    return { name: S.h.names[sym] || sym, type: "stock", theme: "其他", group: "", cur: q && q["s_" + v] ? q["s_" + v] : null };
  }
  function riskOf(m, sym) {
    if (sym === "AU9901" || m.theme === "黃金") return "黃金";
    if (m.type === "leveraged") return "槓桿 ETF";
    if (m.type === "stock") return "個股";
    return /大盤|全球/.test(m.theme) ? "大盤 ETF" : "產業／主題 ETF";
  }

  // ---------- 彙總：同一代碼跨帳戶合併（台幣）----------
  function summarize() {
    var pos = positions(), by = {}, cashTW = 0, cashUS = 0, acctVal = {}, missing = 0;
    pos.forEach(function (p) {
      var mv = p.mv != null ? toTWD(p.mv, p.ccy) : null;
      if (mv == null) { missing++; return; }
      var c = toTWD(p.cost, p.ccy), t = toTWD(p.today || 0, p.ccy);
      var s = by[p.sym] || (by[p.sym] = { sym: p.sym, mv: 0, cost: 0, today: 0, qty: 0, ccy: p.ccy, q: p.q, accts: [] });
      s.mv += mv; s.cost += c; s.today += t; s.qty += p.qty; s.accts.push(p.acct);
      acctVal[p.acct] = (acctVal[p.acct] || 0) + mv;
    });
    Object.keys(S.h.cash).forEach(function (a) {
      var c = S.h.cash[a];
      Object.keys(c).forEach(function (ccy) {
        var v = toTWD(Number(c[ccy]) || 0, ccy); if (v == null) return;
        if (ccy === "USD") cashUS += v; else cashTW += v;
        acctVal[a] = (acctVal[a] || 0) + v;
      });
    });
    var syms = Object.keys(by).map(function (k) { var s = by[k]; s.m = metaOf(s.sym); s.risk = riskOf(s.m, s.sym); s.pnl = s.mv - s.cost; return s; });
    var stock = syms.reduce(function (a, s) { return a + s.mv; }, 0);
    var cost = syms.reduce(function (a, s) { return a + s.cost; }, 0);
    var today = syms.reduce(function (a, s) { return a + s.today; }, 0);
    return { pos: pos, syms: syms, stock: stock, cost: cost, today: today, cashTW: cashTW, cashUS: cashUS,
             cash: cashTW + cashUS, total: stock + cashTW + cashUS, acctVal: acctVal, missing: missing };
  }

  // ---------- 環圈圖 ----------
  function donut(slices, centerTop, centerBottom) {
    var R = 70, C = 2 * Math.PI * R, tot = slices.reduce(function (a, s) { return a + s.v; }, 0), off = 0, h = "";
    var gap = slices.filter(function (s) { return s.v > 0; }).length > 1 ? 2 : 0;
    slices.forEach(function (s) {
      var len = tot ? s.v / tot * C : 0;
      if (len <= 0) return;
      var seg = Math.max(0, len - gap);
      h += '<circle r="' + R + '" cx="90" cy="90" fill="none" stroke="' + s.c + '" stroke-width="26" stroke-dasharray="' + seg.toFixed(2) + " " + (C - seg).toFixed(2)
        + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 90 90)"><title>' + esc(s.k) + "：" + money(s.v, "TWD") + "（" + (s.v / tot * 100).toFixed(1) + "%）</title></circle>";
      off += len;
    });
    return '<svg viewBox="0 0 180 180" class="dn" role="img" aria-label="' + esc(centerTop) + '">' + h
      + '<text x="90" y="84" text-anchor="middle" class="dn-t">' + esc(centerTop) + '</text><text x="90" y="106" text-anchor="middle" class="dn-v">' + esc(centerBottom) + "</text></svg>";
  }
  function legend(slices) {
    var tot = slices.reduce(function (a, s) { return a + s.v; }, 0);
    return '<ul class="lg">' + slices.filter(function (s) { return s.v > 0; }).map(function (s) {
      return '<li><i style="background:' + s.c + '"></i><span class="lk2">' + esc(s.k) + "</span><b>" + (s.v / tot * 100).toFixed(1) + '%</b><span class="dim">' + compact(s.v) + "</span></li>";
    }).join("") + "</ul>";
  }
  function compact(v) { return Math.abs(v) >= 1e4 ? (v < 0 ? "-" : "") + (Math.abs(v) / 1e4).toFixed(Math.abs(v) >= 1e6 ? 0 : 1) + " 萬" : money(v, "TWD"); }

  function chartSlices(sm, kind) {
    var g = {};
    function add(k, v) { g[k] = (g[k] || 0) + v; }
    if (kind === "alloc") {
      sm.syms.forEach(function (s) { add(isTW(s.sym) ? "台股" : "美股", s.mv); });
      add("現金（台幣）", sm.cashTW); add("現金（美元）", sm.cashUS);
      var AC = { "台股": "var(--c1)", "美股": "var(--c2)", "現金（台幣）": "var(--cnull)", "現金（美元）": "var(--cnull2)" };
      return ["台股", "美股", "現金（台幣）", "現金（美元）"].map(function (k) { return { k: k, v: g[k] || 0, c: AC[k] }; });
    }
    if (kind === "risk") {
      sm.syms.forEach(function (s) { add(s.risk, s.mv); }); add("現金", sm.cash);
      return RISK.map(function (r) { return { k: r[0], v: g[r[0]] || 0, c: r[1] }; });
    }
    if (kind === "theme") {
      sm.syms.forEach(function (s) { add(s.m.theme, s.mv); });
      return Object.keys(g).sort(function (a, b) { return g[b] - g[a]; })
        .map(function (k) { return { k: k, v: g[k], c: THEME_COLOR[k] || "var(--cnull)" }; });
    }
    if (kind === "acct") {
      return ACCTS.map(function (a) { return { k: a.name, v: sm.acctVal[a.id] || 0, c: ACCT_COLOR[a.id] }; });
    }
    return [];
  }
  var CHARTS = [["alloc", "資產配置"], ["risk", "風險類別"], ["theme", "產業主題"], ["acct", "帳戶"], ["top", "持股排行"]];

  function chartCard(sm) {
    var kind = S.chart || "alloc";
    var h = '<div class="card"><div class="tabs ctabs" id="hchart">' + CHARTS.map(function (c) { return '<button data-ch="' + c[0] + '" aria-pressed="' + (c[0] === kind) + '">' + c[1] + "</button>"; }).join("") + "</div>";
    if (kind === "top") {
      var list = sm.syms.slice().sort(function (a, b) { return b.mv - a.mv; });
      var max = list.length ? list[0].mv : 1;
      h += '<p class="note" style="margin:10px 0 6px">每檔佔總資產的比例（同一檔在不同券商合併計算）。紅線是單一持股上限 ' + Math.round(CAP * 100) + "%。<b>點一檔看它在哪些帳戶、股數、成本與損益。</b></p><div class='topb'>";
      list.forEach(function (s) {
        var w = s.mv / sm.total, over = w > CAP, on = S.topOpen === s.sym;
        h += '<div class="tb tbc' + (on ? " on" : "") + '" data-top="' + esc(s.sym) + '" tabindex="0" role="button" aria-expanded="' + on + '"><span class="tbn"><b>' + esc(s.sym) + '</b> <span class="dim">' + esc(s.m.name || "") + '</span></span><span class="tbbar"><i style="width:' + (s.mv / max * 100).toFixed(1) + "%;background:" + (over ? "var(--hot)" : "var(--c1)") + '"></i>'
          + '<u style="left:' + Math.min(100, CAP * sm.total / max * 100).toFixed(1) + '%"></u></span><span class="tbv' + (over ? " neg" : "") + '">' + (w * 100).toFixed(1) + "%" + (over ? " ⚠" : "") + "</span></div>";
        if (on) h += topDetail(s, sm);
      });
      return h + "</div></div>";
    }
    var sl = chartSlices(sm, kind);
    var center = kind === "theme" ? ["股票部位", compact(sm.stock)] : ["總資產", compact(sm.total)];
    var notes = { alloc: "台股、美股與現金的比例。", risk: "由穩到積極：大盤 ETF、產業 ETF、個股、槓桿 ETF；現金與黃金是緩衝。", theme: "只算股票部位，依產業或主題分類。", acct: "每個帳戶的總值（含現金）。" };
    return h + '<div class="dnw">' + donut(sl, center[0], center[1]) + legend(sl) + "</div><p class='note' style='margin:4px 0 0'>" + notes[kind] + "</p></div>";
  }

  // 持股排行展開：這檔在各帳戶的合計與明細（股數、成本、市值、損益）
  function topDetail(s, sm) {
    var ps = sm.pos.filter(function (p) { return p.sym === s.sym; }).sort(function (a, b) { return (b.mv || 0) - (a.mv || 0); });
    if (!ps.length) return "";
    var ccy = ps[0].ccy, qty = 0, cost = 0, mv = 0, today = 0;
    ps.forEach(function (p) { qty += p.qty; cost += p.cost; mv += p.mv || 0; today += p.today || 0; });
    var avg = qty ? cost / qty : null, price = s.q ? s.q.price : null, c = s.m.cur, w = s.mv / (sm.total || 1);
    var twd = ccy === "USD" ? '<span class="dim" style="font-size:12px"> ≈ ' + compact(s.mv) + "</span>" : "";
    var h = '<div class="tbd">'
      + '<div class="kv"><div>帳戶<b>' + ps.length + " 個</b></div><div>合計股數<b>" + num(qty, 4) + "</b></div>"
      + "<div>平均成本<b>" + num(avg, 2) + "</b></div><div>現價<b>" + (price == null ? "—" : num(price, 2)) + "</b></div>"
      + "<div>漲幅（相對成本）<b>" + pct(avg && price ? price / avg - 1 : null) + "</b></div>"
      + "<div>今日<b>" + pct(s.q ? s.q.chg : null, 2) + "</b></div>"
      + "<div>市值<b>" + money(mv, ccy) + twd + "</b></div><div>損益<b>" + signed(mv - cost, ccy) + "</b></div>"
      + "<div>今日損益<b>" + signed(today, ccy) + "</b></div><div>佔總資產<b>" + (w * 100).toFixed(1) + "%</b></div>"
      + "<div>目標比重<b>" + targetCell(s.sym, null, sm.total, s.mv) + "</b></div>"
      + "<div>便宜度<b>" + (c && c.score != null ? c.score.toFixed(0) + " " + esc(c.level) : "資料不足") + "</b></div></div>";
    if (avg && price) {
      var lo = Math.min(avg, price), hi = Math.max(avg, price), pad = (hi - lo) * 0.25 || hi * 0.05;
      var X = function (v) { return ((v - (lo - pad)) / (hi - lo + 2 * pad) * 100); };
      h += '<div class="cp"><div class="cpb"><i class="' + (price >= avg ? "up" : "dn2") + '" style="left:' + X(lo).toFixed(1) + "%;width:" + (X(hi) - X(lo)).toFixed(1) + '%"></i>'
        + '<u style="left:' + X(avg).toFixed(1) + '%"></u><u class="now" style="left:' + X(price).toFixed(1) + '%"></u></div>'
        + '<div class="cpl"><span>平均成本 ' + num(avg, 2) + "</span><span>現價 " + num(price, 2) + "</span></div></div>";
    }
    h += '<div class="tac"><span class="dim" style="font-size:12px">各帳戶明細</span>';
    ps.forEach(function (p) {
      h += '<div class="ta"><div class="ta1"><span><i class="sw2" style="background:' + (ACCT_COLOR[p.acct] || "var(--cnull)") + '"></i><b>' + esc(acctName(p.acct)) + "</b></span><b>" + pct(p.cost && p.pnl != null ? p.pnl / p.cost : null) + "</b></div>"
        + '<div class="ta2">' + num(p.qty, 4) + " 股・均價 " + num(p.avg, 2) + "・市值 " + (p.mv == null ? "—" : money(p.mv, ccy)) + "・損益 " + signed(p.pnl, ccy)
        + (qty ? "・佔這檔 " + (p.qty / qty * 100).toFixed(0) + "%" : "") + "</div></div>";
    });
    h += "</div>";
    var inWl = S.data && S.data.items.some(function (r) { return r.symbol.replace(/\.TW$/, "") === s.sym; });
    h += '<div class="pd-act">' + (inWl ? '<button class="lk" data-goto="' + esc(s.sym) + '">看走勢圖與買點訊號 →</button>' : "")
      + '<span class="dim" style="font-size:12px">' + (ccy === "USD" ? "金額為美元，" : "") + "買賣紀錄與修改請到下方「各帳戶」展開。</span></div>";
    return h + "</div>";
  }

  // ---------- 損益與漲跌 ----------
  function pnlCard(sm) {
    var mode = S.pnlMode || "total";
    var rows = sm.syms.map(function (s) {
      var v = mode === "total" ? (s.cost ? s.pnl / s.cost : 0) : mode === "today" ? (s.q && s.q.chg != null ? s.q.chg : 0) : s.pnl;
      return { s: s, v: v };
    }).sort(function (a, b) { return b.v - a.v; });
    var max = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.v); }).concat([1e-9]));
    var showAll = S.pnlAll || rows.length <= 12;
    var shown = showAll ? rows : rows.slice(0, 6).concat([null]).concat(rows.slice(-6));
    var h = '<div class="card"><div class="hd2"><h3>損益與漲跌</h3><div class="tabs" id="hpnl">'
      + [["total", "總報酬"], ["today", "今日"], ["amt", "損益金額"]].map(function (o) { return '<button data-pm="' + o[0] + '" aria-pressed="' + (o[0] === mode) + '">' + o[1] + "</button>"; }).join("") + "</div></div><div class='pl'>";
    shown.forEach(function (r) {
      if (!r) { h += '<div class="plgap">⋯ 中間還有 ' + (rows.length - 12) + " 檔</div>"; return; }
      var w = Math.abs(r.v) / max * 50, up = r.v >= 0;
      var label = mode === "amt" ? (r.v > 0 ? "+" : "") + compact(r.v) : (r.v > 0 ? "+" : "") + (r.v * 100).toFixed(mode === "today" ? 2 : 1) + "%";
      h += '<div class="plr"><span class="pln"><b>' + esc(r.s.sym) + '</b></span><span class="plbar"><i class="' + (up ? "up" : "dn2") + '" style="' + (up ? "left:50%" : "right:50%") + ";width:" + w.toFixed(1) + '%"></i><em></em></span><span class="plv ' + (r.v > 0 ? "pos" : r.v < 0 ? "neg" : "") + '">' + label + "</span></div>";
    });
    h += "</div>";
    if (rows.length > 12) h += '<button class="lk" id="hpnlall" style="margin-top:6px">' + (showAll ? "只看前後 6 名" : "顯示全部 " + rows.length + " 檔") + "</button>";
    var nUp = rows.filter(function (r) { return r.v > 0; }).length, nDn = rows.filter(function (r) { return r.v < 0; }).length;
    h += '<p class="note" style="margin:6px 0 0">' + nUp + " 檔上漲、" + nDn + " 檔下跌" + (mode === "today" ? "（今日漲跌，盤中為即時價）" : "（以成本計算，同一檔各券商合併）") + "</p></div>";
    return h;
  }

  // ---------- 提醒與建議 ----------
  function adviceCard(sm) {
    var A = [];   // [等級, 標題, 說明]
    var cashR = sm.total ? sm.cash / sm.total : 0;
    sm.syms.forEach(function (s) {
      var w = s.mv / sm.total;
      if (w > CAP) A.push(["warn", s.sym + " 佔總資產 " + (w * 100).toFixed(1) + "%", "超過單一持股上限 " + Math.round(CAP * 100) + "%，先別再加碼。"]);
    });
    var lev = sm.syms.filter(function (s) { return s.risk === "槓桿 ETF"; }).reduce(function (a, s) { return a + s.mv; }, 0) / (sm.total || 1);
    if (lev > 0.15) A.push([lev > 0.25 ? "warn" : "caution", "槓桿 ETF 佔總資產 " + (lev * 100).toFixed(1) + "%", "槓桿產品波動與耗損大，建議控制在 15% 以內；大跌時虧損會放大 2～4 倍。"]);
    var semi = sm.syms.filter(function (s) { return /半導體|記憶體/.test(s.m.theme); }).reduce(function (a, s) { return a + s.mv; }, 0) / (sm.stock || 1);
    if (semi > 0.4) A.push(["caution", "半導體與記憶體佔股票部位 " + (semi * 100).toFixed(0) + "%", "這個族群常一起漲跌，分散到其他產業可以降低單一產業修正的衝擊。"]);
    if (cashR < 0.1) A.push(["caution", "現金只剩 " + (cashR * 100).toFixed(1) + "%", "左側分批需要子彈，遇到便宜區時可能沒有資金。"]);
    else if (cashR > 0.4) A.push(["info", "現金佔 " + (cashR * 100).toFixed(1) + "%", "現金充足，可以等便宜度到門檻時分批進場。"]);
    var M = S.data && S.data.market;
    if (M && M.summary) {
      var share = function (tw) { return sm.syms.filter(function (s) { return isTW(s.sym) === tw; }).reduce(function (a, s) { return a + s.mv; }, 0) / (sm.total || 1); };
      if (M.summary.TW && M.summary.TW.hot >= 2) A.push(["caution", "台股市場過熱（" + M.summary.TW.hot + "/" + M.summary.TW.total + " 個指標）", "台股部位佔總資產 " + (share(true) * 100).toFixed(0) + "%。過熱時先別追高、別加碼。"]);
      if (M.summary.US && M.summary.US.hot >= 2) A.push(["caution", "美股市場過熱（" + M.summary.US.hot + "/" + M.summary.US.total + " 個指標）", "美股部位佔總資產 " + (share(false) * 100).toFixed(0) + "%。過熱時先別追高、別加碼。"]);
    }
    sm.syms.forEach(function (s) {
      var c = s.m.cur;
      if (c && c.sweet) A.push(["chance", s.sym + " 在甜蜜點", (c.sweet_why || "") + "，回測勝率較高。依分批規則決定是否加碼。"]);
      else if (c && c.score != null && c.score >= 50) A.push(["chance", s.sym + " 很便宜（" + c.score.toFixed(0) + " 分）", "可以依分批規則考慮加碼。"]);
      if (c && c.score != null && c.score <= -66 && s.mv / sm.total > 0.03) A.push(["info", s.sym + " 目前很貴（" + c.score.toFixed(0) + " 分）", "佔總資產 " + (s.mv / sm.total * 100).toFixed(1) + "%，暫緩加碼；有獲利可考慮是否部分了結。"]);
      var r = s.cost ? s.pnl / s.cost : 0;
      if (r < -0.25) A.push([s.risk === "個股" || s.risk === "槓桿 ETF" ? "warn" : "caution", s.sym + " 虧損 " + (r * 100).toFixed(0) + "%", s.risk === "槓桿 ETF" ? "槓桿 ETF 回本需要更大的漲幅，確認是否還符合你的計畫。" : "檢查是否有基本面變化，再決定續抱、停損或分批攤平。"]);
      var t = S.h.targets[s.sym];
      if (t != null) { var gap = t / 100 * sm.total - s.mv; if (gap > sm.total * 0.01) A.push(["info", s.sym + " 距目標 " + t + "% 還差 " + compact(gap), "可等便宜度到門檻時補足。"]); }
    });
    var order = { warn: 0, caution: 1, chance: 2, info: 3 }, label = { warn: "警示", caution: "注意", chance: "機會", info: "資訊" };
    A.sort(function (a, b) { return order[a[0]] - order[b[0]]; });
    var h = '<div class="card"><h3>提醒與建議</h3>';
    if (!A.length) h += '<p class="note">目前沒有需要注意的地方。</p>';
    else h += '<ul class="adv">' + A.slice(0, S.advAll ? 99 : 6).map(function (a) {
      return '<li class="' + a[0] + '"><span class="ab">' + label[a[0]] + "</span><div><b>" + esc(a[1]) + '</b><span class="dim">' + esc(a[2]) + "</span></div></li>";
    }).join("") + "</ul>" + (A.length > 6 ? '<button class="lk" id="hadvall">' + (S.advAll ? "收起" : "顯示全部 " + A.length + " 則") + "</button>" : "");
    return h + '<p class="note" style="margin:6px 0 0">依你的設定與回測自動產生，僅供參考，不是投資建議。</p></div>';
  }

  // ---------- 畫面 ----------
  function render() {
    var el = document.getElementById("holdings");
    if (!S.h) { el.innerHTML = '<div class="card empty">' + esc(S.msg || "載入持倉中…") + "</div>"; return; }
    var sm = summarize(), fxv = fx();
    var cashR = sm.total ? sm.cash / sm.total : 0;
    var h = '<div class="hero"><span class="dim">總資產（台幣）</span><b class="hb">' + money(sm.total, "TWD") + "</b>"
      + '<div class="hero2"><span>今日 ' + signed(sm.today, "TWD") + " " + pct(sm.stock - sm.today ? sm.today / (sm.stock - sm.today) : null, 2) + "</span>"
      + "<span>總損益 " + signed(sm.stock - sm.cost, "TWD") + " " + pct(sm.cost ? (sm.stock - sm.cost) / sm.cost : null) + "</span></div>"
      + '<div class="hbar" role="img" aria-label="股票 ' + ((1 - cashR) * 100).toFixed(0) + "%、現金 " + (cashR * 100).toFixed(0) + '%"><i style="width:' + ((1 - cashR) * 100).toFixed(1) + '%"></i></div>'
      + '<div class="hbl"><span><i class="sw2" style="background:var(--c1)"></i>股票 ' + compact(sm.stock) + "（" + ((1 - cashR) * 100).toFixed(0) + '%）</span><span><i class="sw2" style="background:var(--cnull)"></i>現金 ' + compact(sm.cash) + "（" + (cashR * 100).toFixed(0) + "%）</span></div></div>";
    h += '<p class="note">美元匯率 ' + (fxv ? fxv.toFixed(3) + "（" + S.prices.fx.date.slice(5).replace("-", "/") + "）" : "—")
      + "・價格更新 " + esc(S.prices ? S.prices.generated : "—")
      + (sm.missing ? '・<span class="neg">' + sm.missing + " 檔還沒有價格</span>" : "")
      + '・<button class="lk" id="hupdn">漲跌色：' + (upDown() === "tw" ? "紅漲綠跌" : "綠漲紅跌") + "</button></p>";
    h += chartCard(sm) + adviceCard(sm) + pnlCard(sm);

    var byAcct = {};
    sm.pos.forEach(function (p) { (byAcct[p.acct] = byAcct[p.acct] || []).push(p); });
    var ids = ACCTS.map(function (a) { return a.id; }).concat(Object.keys(byAcct).filter(function (k) { return !ACCTS.some(function (a) { return a.id === k; }); }));
    var empty = [];
    h += '<div class="bar" style="margin-top:6px"><h3 style="margin:0;font-size:16px">各帳戶</h3><span class="dim" style="font-size:14px;margin-left:auto">美股顯示</span><div class="tabs" id="hccy">'
      + '<button data-c="USD" aria-pressed="' + (S.ccy === "USD") + '">美元</button><button data-c="TWD" aria-pressed="' + (S.ccy === "TWD") + '">台幣</button></div></div>';
    h += '<div class="list">';
    ids.forEach(function (id) {
      var ps = byAcct[id] || [], cash = S.h.cash[id] || {};
      var hasCash = Object.keys(cash).some(function (c) { return Number(cash[c]); });
      if (!ps.length && !hasCash) { empty.push(acctName(id)); return; }
      var a = ACCTS.filter(function (x) { return x.id === id; })[0] || { market: "US", ccy: "USD" };
      var dc = a.market === "TW" ? "TWD" : S.ccy;
      var conv = function (v, ccy) { if (v == null) return null; return dc === ccy ? v : dc === "TWD" ? toTWD(v, ccy) : (fxv ? v / fxv : null); };
      var mv = 0, cost = 0, today = 0, cashV = 0;
      ps.forEach(function (p) { if (p.mv != null) { mv += conv(p.mv, p.ccy); cost += conv(p.cost, p.ccy); today += conv(p.today || 0, p.ccy); } });
      Object.keys(cash).forEach(function (c) { cashV += conv(Number(cash[c]) || 0, c) || 0; });
      var open = S.open[id];
      h += '<div class="row hrow' + (open ? " open" : "") + '" tabindex="0" data-acct="' + esc(id) + '">'
        + '<div class="id"><i class="sw2" style="background:' + (ACCT_COLOR[id] || "var(--cnull)") + '"></i><b>' + esc(acctName(id)) + '</b><span class="nm">' + ps.length + " 檔" + (cashV ? "・現金 " + money(cashV, dc) : "") + "</span></div>"
        + '<div class="hv"><b>' + money(mv + cashV, dc) + '</b><span>今日 ' + signed(today, dc) + "</span></div>"
        + '<div class="sc"><b style="font-size:17px">' + pct(cost ? (mv - cost) / cost : null) + '</b><span class="dim" style="font-weight:400">' + signed(mv - cost, dc) + "</span></div>";
      if (open) h += acctDetail(id, ps, conv, dc, sm.total, mv + cashV);
      h += "</div>";
    });
    if (!sm.pos.length && !Object.keys(S.h.cash).length) h += '<div class="empty">還沒有持倉。用下方的「新增持倉」念或打字輸入，例如：<br>「華南台股，0050，3000 股，成本 150」</div>';
    h += "</div>";
    if (empty.length && sm.pos.length) h += '<p class="note" style="margin-top:6px">沒有持倉的帳戶：' + empty.map(esc).join("、") + "</p>";
    h += inputCard() + settingsCard();
    el.innerHTML = h;
  }

  // 帳戶展開：每檔一列（佔帳戶比重條＋市值＋報酬率），點一下看完整資料與操作
  function acctDetail(id, ps, conv, dc, total, acctTotal) {
    var h = '<div class="det" style="display:block">';
    ps.sort(function (a, b) { return (conv(b.mv || 0, b.ccy) || 0) - (conv(a.mv || 0, a.ccy) || 0); }).forEach(function (p) {
      var m = metaOf(p.sym), c = m.cur, k = id + "|" + p.sym;
      var mvC = conv(p.mv, p.ccy), wA = acctTotal && mvC != null ? mvC / acctTotal : 0, wT = total && p.mv != null ? toTWD(p.mv, p.ccy) / total : null;
      var r = p.cost && p.pnl != null ? p.pnl / p.cost : null;
      var badges = (c && c.sweet ? '<span class="sw">甜蜜點</span>' : "") + (wT != null && wT > CAP ? '<span class="chip vhot">超過上限</span>' : "")
        + (c && c.score != null ? '<span class="chip">' + c.score.toFixed(0) + " " + esc(c.level) + "</span>" : "");
      h += '<div class="pr prow' + (S.open[k] ? " on" : "") + '" data-k="' + esc(k) + '">'
        + '<div class="pr1"><span class="prn"><b>' + esc(p.sym) + '</b> <span class="dim">' + esc(m.name || S.h.names[p.sym] || "") + "</span> " + badges + "</span>"
        + '<span class="prv">' + money(mvC, dc) + " " + pct(r) + "</span></div>"
        + '<div class="pr2"><span class="wb"><i style="width:' + (wA * 100).toFixed(1) + '%"></i></span><span class="dim">佔帳戶 ' + (wA * 100).toFixed(0) + "%・總資產 " + (wT == null ? "—" : (wT * 100).toFixed(1) + "%") + "</span>"
        + (p.q ? '<span class="dim">今日 ' + pct(p.q.chg, 2) + "</span>" : '<span class="neg" style="font-size:12px">抓不到價格</span>') + "</div>";
      if (S.open[k]) h += posDetail(p, k, conv, dc, total, m);
      h += "</div>";
    });
    var cash = S.h.cash[id] || {};
    var cs = Object.keys(cash).filter(function (c) { return Number(cash[c]); });
    if (cs.length || token()) h += '<div class="kv" style="margin-top:10px"><div>現金<b>' + (cs.length ? cs.map(function (c) { return money(Number(cash[c]), c) + (c === "USD" ? " 美元" : " 台幣"); }).join("、") : "未填") + "</b></div>"
      + (token() ? '<div><button class="lk" data-cash="' + esc(id) + '">修改現金</button></div>' : "") + "</div>";
    return h + "</div>";
  }

  function posDetail(p, k, conv, dc, total, m) {
    var c = m.cur;
    var symLine = S.renaming === k
      ? '<input id="hren" value="' + esc(p.sym) + '" size="7" autocapitalize="characters"> <button class="lk" data-ren-ok="' + esc(k) + '">確定</button><button class="lk" data-ren-no="1">取消</button>'
      : (token() ? '<button class="lk" data-ren="' + esc(k) + '">✎ 修改代碼</button>' : "");
    var priceTag = p.q ? (p.q.manual ? "手動" : p.q.est ? "估算" : String(p.q.date).slice(5).replace("-", "/")) : "";
    var h = '<div class="pd">'
      + '<div class="kv"><div>股數<b>' + num(p.qty, 4) + "</b></div><div>平均成本<b>" + num(p.avg, 2) + "</b></div>"
      + "<div>現價<b>" + (p.q ? num(p.price, 2) + ' <span class="dim" style="font-size:12px">' + priceTag + "</span>" : "—") + "</b></div>"
      + "<div>損益<b>" + signed(conv(p.pnl, p.ccy), dc) + "</b></div>"
      + "<div>目標比重<b>" + targetCell(p.sym, null, total, p.mv != null ? toTWD(p.mv, p.ccy) : null) + "</b></div>"
      + "<div>便宜度<b>" + (c && c.score != null ? c.score.toFixed(0) + " " + esc(c.level) : "資料不足") + "</b></div></div>";
    if (p.avg && p.price) {   // 成本到現價的距離：一眼看出賺或賠多少
      var lo = Math.min(p.avg, p.price), hi = Math.max(p.avg, p.price), pad = (hi - lo) * 0.25 || hi * 0.05;
      var X = function (v) { return ((v - (lo - pad)) / (hi - lo + 2 * pad) * 100); };
      h += '<div class="cp"><div class="cpb"><i class="' + (p.price >= p.avg ? "up" : "dn2") + '" style="left:' + X(lo).toFixed(1) + "%;width:" + (X(hi) - X(lo)).toFixed(1) + '%"></i>'
        + '<u style="left:' + X(p.avg).toFixed(1) + '%"></u><u class="now" style="left:' + X(p.price).toFixed(1) + '%"></u></div>'
        + '<div class="cpl"><span>成本 ' + num(p.avg, 2) + "</span><span>現價 " + num(p.price, 2) + "（" + pct(p.avg ? p.price / p.avg - 1 : null) + "）</span></div></div>";
    }
    h += '<div class="pd-act">' + symLine + (token() && (!p.q || p.q.manual || p.q.est) ? ' <button class="lk" data-man="' + esc(p.sym) + '">' + (p.q ? "改價格" : "輸入價格") + "</button>" : "") + "</div>";
    if (S.manualEdit === p.sym) h += '<div style="margin-top:4px">現價 <input id="hman" inputmode="decimal" size="8" value="' + esc((S.h.manual[p.sym] || {}).price || "") + '"> <button class="lk" data-man-ok="' + esc(p.sym) + '">儲存</button><button class="lk" data-man-no="1">取消</button>' + (S.h.manual[p.sym] ? '<button class="lk" data-man-clear="' + esc(p.sym) + '">改回自動</button>' : "") + "</div>";
    h += '<div class="lots2"><span class="dim" style="font-size:12px">買賣紀錄</span>' + p.lots.map(function (l) {
      var del = S.confirmDel === l.id;
      return '<div class="lot">' + (l.date ? "<span>" + esc(l.date) + "</span>" : "") + "<span>" + (l.qty < 0 ? "賣 " : "買 ") + num(Math.abs(l.qty), 4) + " 股</span><span>@ " + num(l.px, 4) + "</span>" + (l.note ? '<span class="dim">' + esc(l.note) + "</span>" : "")
        + (token() ? '<button class="lk" data-edit="' + esc(l.id) + '">編輯</button><button class="lk' + (del ? " danger" : "") + '" data-del="' + esc(l.id) + '">' + (del ? "確定刪除？" : "刪除") + "</button>" : "") + "</div>";
    }).join("") + "</div></div>";
    return h;
  }
  function upDown() { return ls("cd_updn") === "us" ? "us" : "tw"; }
  function applyUpDown() { document.documentElement.setAttribute("data-updn", upDown()); }

  // 目標比重：同一代碼跨帳戶共用一個目標（佔總資產 %），顯示到目標還差多少台幣
  function targetCell(sym, w, total, mvTWD) {
    var t = S.h.targets[sym];
    if (S.targetEdit === sym) {
      return '<input id="htgt" inputmode="decimal" size="4" value="' + esc(t == null ? "" : t) + '">% <button class="lk" data-tgt-ok="' + esc(sym) + '">存</button><button class="lk" data-tgt-no="1">取消</button>';
    }
    var pen = token() ? ' <button class="lk" data-tgt="' + esc(sym) + '" title="設定目標比重" aria-label="設定目標比重">✎</button>' : "";
    if (t == null) return '<span class="dim">—</span>' + pen;
    var gap = total && mvTWD != null ? t / 100 * total - symTotalTWD(sym) : null;
    var txt = gap == null ? "" : Math.abs(gap) < total * 0.002 ? '<span class="dim">已達標</span>'
      : gap > 0 ? '<span class="pos">差 ' + money(gap, "TWD") + "</span>" : '<span class="neg">超 ' + money(-gap, "TWD") + "</span>";
    return t + "% " + txt + pen;
  }
  function symTotalTWD(sym) {   // 同一代碼在所有帳戶的市值合計（台幣）
    return positions().filter(function (p) { return p.sym === sym && p.mv != null; })
      .reduce(function (a, p) { return a + (toTWD(p.mv, p.ccy) || 0); }, 0);
  }

  function inputCard() {
    if (!token()) return '<div class="card"><h3>新增持倉</h3><p class="note">要先在下方「存檔設定」貼上 GitHub 存取權杖，才能新增或修改。</p></div>';
    var h = '<div class="card"><h3>新增／修改持倉</h3>' + (window.Scan ? Scan.ui() : "")
      + '<h4 style="margin:14px 0 6px">🎤 用念的或打字</h4>'
      + '<p class="note">按手機鍵盤上的麥克風一路念下去，念完按「整理成表格」。每一檔念「代碼、幾股或幾張、成本」就好，日期可以不念；想加備註就說「備註」再接內容。說「總成本」會自動除以股數換成每股成本。換券商時先念券商和台股／美股。<br>例：「華南台股。0050，3000 股，成本 150，備註長期持有。0052，2 張，成本 210。Moomoo。SNXX，50 股，價格 32.5。Moomoo 美元現金 3200。」賣出就說「賣」。</p>'
      + '<textarea id="hin" rows="5" placeholder="在這裡念或打字…">' + esc(ls("cd_draft") || "") + "</textarea>"
      + '<div class="bar" style="margin-top:8px"><button class="btn" id="hparse">整理成表格</button><button class="btn ghost" id="hadd">手動加一列</button></div>';
    if (S.rows.length) {
      h += '<div class="scroll"><table class="ht edit"><tr><th>類型</th><th>帳戶</th><th>代碼</th><th>股數</th><th>價格／金額</th><th>日期（選填）</th><th>備註（選填）</th><th></th></tr>';
      S.rows.forEach(function (r, i) {
        var bad = r.warn && r.warn.length;
        var acctSel = '<select data-i="' + i + '" data-f="acct"><option value="">選帳戶</option>' + ACCTS.map(function (a) { return '<option value="' + a.id + '"' + (a.id === r.acct ? " selected" : "") + ">" + a.name + "</option>"; }).join("") + "</select>";
        var typeSel = '<select data-i="' + i + '" data-f="kind">' + [["buy", "買進"], ["sell", "賣出"], ["cash", "現金"]].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === r.kind ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select>";
        h += '<tr class="' + (bad ? "warn" : "") + '"><td>' + typeSel + (r.id ? '<div class="dim" style="font-size:11px">修改既有</div>' : "") + "</td><td>" + acctSel + "</td>";
        if (r.kind === "cash") {
          h += '<td><select data-i="' + i + '" data-f="ccy"><option value="TWD"' + (r.ccy === "TWD" ? " selected" : "") + '>台幣</option><option value="USD"' + (r.ccy === "USD" ? " selected" : "") + ">美元</option></select></td><td></td>"
            + '<td><input data-i="' + i + '" data-f="amount" inputmode="decimal" value="' + esc(r.amount == null ? "" : r.amount) + '"></td><td></td><td></td>';
        } else {
          h += '<td><input data-i="' + i + '" data-f="sym" value="' + esc(r.sym || "") + '" size="7"></td>'
            + '<td><input data-i="' + i + '" data-f="qty" inputmode="decimal" value="' + esc(r.qty == null ? "" : Math.abs(r.qty)) + '" size="7"></td>'
            + '<td><input data-i="' + i + '" data-f="px" inputmode="decimal" value="' + esc(r.px == null ? "" : r.px) + '" size="7"></td>'
            + '<td><input data-i="' + i + '" data-f="date" value="' + esc(r.date || "") + '" placeholder="可不填" size="10"></td>'
            + '<td><input data-i="' + i + '" data-f="note" value="' + esc(r.note || "") + '" placeholder="例：長期持有" size="12"></td>';
        }
        h += '<td><button class="lk" data-rm="' + i + '">移除</button></td></tr>';
        if (bad) h += '<tr class="warn"><td colspan="8" class="neg" style="font-size:12px">' + r.warn.map(esc).join("、") + "，請補上</td></tr>";
        if (r.ai && r.ai.length) h += '<tr class="ai"><td colspan="8"><span>⚠ ' + r.ai.map(esc).join("；") + "</span></td></tr>";
      });
      h += '</table></div><div class="bar" style="margin-top:8px"><button class="btn" id="hsave"' + (S.busy ? " disabled" : "") + ">" + (S.busy ? "存檔中…" : "確認存入（" + S.rows.length + " 筆）") + '</button><button class="btn ghost" id="hclear">清除表格</button></div>';
    }
    if (S.msg) h += '<p class="note" style="margin-top:8px">' + esc(S.msg) + "</p>";
    return h + "</div>";
  }

  function settingsCard() {
    var t = token();
    return '<details class="card"' + (t ? "" : " open") + '><summary><b>存檔設定</b> <span class="dim">' + (t ? "已設定存取權杖" : "尚未設定") + "</span></summary>"
      + '<p class="note">持倉存在 GitHub repo 的 holdings.json（公開）。要在這裡新增修改，需要一組只能改這個 repo 的「存取權杖」，存在這台裝置的瀏覽器裡，不會上傳到別處。<br>'
      + '產生方式：GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token；Repository access 選 Only select repositories → <b>' + esc(REPO.split("/")[1]) + '</b>；Permissions → Contents 選 <b>Read and write</b>。<br>'
      + '<a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">開啟 GitHub 產生權杖頁面</a></p>'
      + '<div class="bar"><input id="htok" type="password" placeholder="github_pat_…" autocomplete="off" style="flex:1;min-width:0"><button class="btn" id="htoksave">儲存</button>' + (t ? '<button class="btn ghost" id="htokdel">移除</button>' : "") + "</div></details>";
  }

  // ---------- 互動 ----------
  function rowFromParsed(x) {
    if (x.type === "cash") return { kind: "cash", acct: x.acct, ccy: x.ccy || (x.acct && /tw$/.test(x.acct) ? "TWD" : "USD"), amount: x.amount, warn: x.warn };
    return { kind: x.qty < 0 ? "sell" : "buy", acct: x.acct, sym: x.sym, date: x.date, qty: x.qty == null ? null : Math.abs(x.qty), px: x.px, note: x.note || "", warn: x.warn };
  }
  function validate(r) {
    var w = [];
    if (!r.acct) w.push("沒有帳戶");
    if (r.kind === "cash") { if (!(Number(r.amount) >= 0) || r.amount === "" || r.amount == null) w.push("沒有金額"); }
    else {
      if (!r.sym) w.push("沒有代碼");
      if (!(Number(r.qty) > 0)) w.push("沒有股數");
      if (!(Number(r.px) > 0)) w.push("沒有價格");
    }
    r.warn = w;
    return !w.length;
  }
  function commit() {
    var ok = S.rows.map(validate).every(Boolean);
    if (!ok) { S.msg = "有欄位沒填完整（紅色列），補上後再存。"; render(); return; }
    var h = JSON.parse(JSON.stringify(S.h));
    S.rows.forEach(function (r) {
      if (r.kind === "cash") {
        h.cash[r.acct] = h.cash[r.acct] || {};
        h.cash[r.acct][r.ccy] = Number(r.amount);
        return;
      }
      var lot = { id: r.id || "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), acct: r.acct, sym: String(r.sym).toUpperCase().trim(),
        date: r.date || "", qty: (r.kind === "sell" ? -1 : 1) * Number(r.qty), px: Number(r.px) };
      if (r.note && String(r.note).trim()) lot.note = String(r.note).trim();
      var at = h.lots.findIndex(function (l) { return l.id === lot.id; });
      if (at >= 0) h.lots[at] = lot; else h.lots.push(lot);
      var sc = S.data && S.data.items.filter(function (it) { return it.symbol.replace(/\.TW$/, "") === lot.sym; })[0];
      if (sc && !h.names[lot.sym]) h.names[lot.sym] = sc.name;
    });
    S.busy = true; S.msg = ""; render();
    var newSyms = S.rows.filter(function (r) { return r.kind === "buy" && r.sym; }).map(function (r) { return String(r.sym).toUpperCase().trim(); });
    saveHoldings(h, "更新持倉（" + S.rows.length + " 筆）").then(function () {
      S.rows = []; ls("cd_draft", null); S.busy = false;
      S.msg = "已存檔。新代碼的價格約 2 分鐘後出現，屆時重新整理頁面。";
      render();
      return addToWatchlist(newSyms).then(function (added) {
        if (added.length) { S.msg += "已把 " + added.join("、") + " 加進觀察清單。"; render(); }
      }, function () {});
    }).catch(function (e) {
      S.busy = false; S.msg = e.message;
      if (e.conflict) loadHoldings().then(render, render); else render();
    });
  }
  // 有持倉就要觀察：新買進、不在觀察清單的代碼加進 watchlist.json（類型讓排程自動判斷）
  function addToWatchlist(syms) {
    var have = {};
    (S.data ? S.data.items : []).forEach(function (r) { have[r.symbol.replace(/\.TW$/, "")] = 1; });
    var miss = syms.filter(function (s, i) { return s && syms.indexOf(s) === i && !have[s] && s !== "AU9902"; });
    if (!miss.length) return Promise.resolve([]);
    return GH.get("watchlist.json").then(function (r) {
      var list = r.data, inList = {};
      list.forEach(function (it) { inList[it.symbol.replace(/\.TW$/, "")] = 1; });
      var add = miss.filter(function (s) { return !inList[s]; });
      if (!add.length) return [];
      add.forEach(function (s) { var tw = isTW(s); list.push({ symbol: tw ? s + ".TW" : s, market: tw ? "TW" : "US", type: "auto", group: "" }); });
      return GH.put("watchlist.json", list, r.sha, "持倉新增，加入觀察：" + add.join(" ")).then(function () { return add; });
    });
  }
  function renameSym(k) {
    var inp = document.getElementById("hren");
    var to = inp ? inp.value.trim().toUpperCase() : "";
    var acct = k.split("|")[0], from = k.slice(acct.length + 1);
    if (!to || to === from) { S.renaming = null; render(); return; }
    var h = JSON.parse(JSON.stringify(S.h)), n = 0;
    h.lots.forEach(function (l) { if (l.acct === acct && l.sym === from) { l.sym = to; n++; } });
    S.renaming = null;
    saveHoldings(h, "持倉代碼 " + from + " → " + to).then(function () {
      S.msg = "已把 " + from + " 改成 " + to + "（" + n + " 筆）。新代碼的價格約 2 分鐘後出現。"; render();
    }).catch(function (e) { S.msg = e.message; if (e.conflict) loadHoldings().then(render, render); else render(); });
  }
  function deleteLot(id) {
    var h = JSON.parse(JSON.stringify(S.h));
    h.lots = h.lots.filter(function (l) { return l.id !== id; });
    S.confirmDel = null;
    saveHoldings(h, "刪除一筆持倉").then(function () { S.msg = "已刪除。"; render(); }).catch(function (e) { S.msg = e.message; render(); });
  }

  // 從持倉跳到便宜度頁並展開那一檔（清掉篩選，確保看得到）
  function goTo(sym) {
    var it = window.D && window.D.items.filter(function (r) { return r.symbol.replace(/\.TW$/, "") === sym; })[0];
    if (!it || !window.st) return;
    st.m = "all"; st.only = false; st.cand = false; st.sum = null; st.open = it.symbol;
    ["only", "cand"].forEach(function (id) { var x = document.getElementById(id); if (x) x.checked = false; });
    [].forEach.call(document.querySelectorAll("#tabs button"), function (x) { x.setAttribute("aria-pressed", x.dataset.m === "all"); });
    location.hash = "";
    setTimeout(function () { window.render(); var row = document.querySelector('.row.open'); if (row) row.scrollIntoView({ block: "start" }); }, 0);
  }

  function onClick(e) {
    var t = e.target, b;
    if (window.Scan && Scan.onClick(t)) return;
    if ((b = t.closest("#hchart button"))) { S.chart = b.dataset.ch; ls("cd_chart", S.chart); render(); return; }
    if ((b = t.closest("[data-goto]"))) { goTo(b.dataset.goto); return; }
    if ((b = t.closest("[data-top]")) && !t.closest(".tbd")) { S.topOpen = S.topOpen === b.dataset.top ? null : b.dataset.top; render(); return; }
    if ((b = t.closest("#hpnl button"))) { S.pnlMode = b.dataset.pm; render(); return; }
    if (t.closest("#hpnlall")) { S.pnlAll = !S.pnlAll; render(); return; }
    if (t.closest("#hadvall")) { S.advAll = !S.advAll; render(); return; }
    if (t.closest("#hupdn")) { ls("cd_updn", upDown() === "tw" ? "us" : "tw"); applyUpDown(); render(); return; }
    if ((b = t.closest("#hccy button"))) { S.ccy = b.dataset.c; ls("cd_ccy", S.ccy); render(); return; }
    if (t.closest("#hparse")) {
      var txt = document.getElementById("hin").value;
      var got = P.parse(txt).map(rowFromParsed);
      S.rows = S.rows.concat(got);
      S.msg = got.length ? "整理出 " + got.length + " 筆，檢查後按「確認存入」。" : "沒有認出任何代碼。每一檔要先念代碼或名稱，例如「0050」「台積電」「TSLA」。";
      render(); return;
    }
    if (t.closest("#hadd")) { S.rows.push({ kind: "buy", acct: "", sym: "", date: "", qty: null, px: null, note: "", warn: [] }); render(); return; }
    if (t.closest("#hclear")) { S.rows = []; S.msg = ""; render(); return; }
    if (t.closest("#hsave")) { commit(); return; }
    if ((b = t.closest("[data-tgt]"))) { S.targetEdit = b.dataset.tgt; render(); var ti = document.getElementById("htgt"); if (ti) ti.focus(); return; }
    if (t.closest("[data-tgt-no]")) { S.targetEdit = null; render(); return; }
    if ((b = t.closest("[data-tgt-ok]"))) {
      var tsym = b.dataset.tgtOk, raw = document.getElementById("htgt").value.trim(), ht = JSON.parse(JSON.stringify(S.h));
      if (raw === "") delete ht.targets[tsym];
      else {
        var tv = Number(raw);
        if (!(tv >= 0 && tv <= 100)) { S.msg = "目標比重請填 0～100 的數字（%），清空代表取消目標。"; render(); return; }
        ht.targets[tsym] = tv;
      }
      S.targetEdit = null;
      saveHoldings(ht, "目標比重 " + tsym).then(function () { S.msg = raw === "" ? "已取消 " + tsym + " 的目標。" : "已設定 " + tsym + " 目標 " + raw + "%。"; render(); })
        .catch(function (e) { S.msg = e.message; if (e.conflict) loadHoldings().then(render, render); else render(); });
      return;
    }
    if ((b = t.closest("[data-man]"))) { S.manualEdit = b.dataset.man; render(); var mi = document.getElementById("hman"); if (mi) mi.focus(); return; }
    if (t.closest("[data-man-no]")) { S.manualEdit = null; render(); return; }
    if ((b = t.closest("[data-man-ok]")) || (b = t.closest("[data-man-clear]"))) {
      var msym = b.dataset.manOk || b.dataset.manClear, hm = JSON.parse(JSON.stringify(S.h)), clear = !!b.dataset.manClear;
      if (clear) delete hm.manual[msym];
      else {
        var v = Number(document.getElementById("hman").value);
        if (!(v > 0)) { S.msg = "請輸入大於 0 的價格。"; render(); return; }
        hm.manual[msym] = { price: v, date: new Date().toISOString().slice(0, 10) };
      }
      S.manualEdit = null;
      saveHoldings(hm, "手動價格 " + msym).then(function () { S.msg = clear ? "已改回自動抓價格。" : "已存 " + msym + " 的手動價格。"; render(); })
        .catch(function (e) { S.msg = e.message; if (e.conflict) loadHoldings().then(render, render); else render(); });
      return;
    }
    if ((b = t.closest("[data-ren]"))) { S.renaming = b.dataset.ren; render(); var ri = document.getElementById("hren"); if (ri) { ri.focus(); ri.select(); } return; }
    if ((b = t.closest("[data-ren-ok]"))) { renameSym(b.dataset.renOk); return; }
    if (t.closest("[data-ren-no]")) { S.renaming = null; render(); return; }
    if ((b = t.closest("[data-rm]"))) { S.rows.splice(+b.dataset.rm, 1); render(); return; }
    if ((b = t.closest("[data-edit]"))) {
      var l = S.h.lots.filter(function (x) { return x.id === b.dataset.edit; })[0];
      if (l) S.rows.push({ id: l.id, kind: l.qty < 0 ? "sell" : "buy", acct: l.acct, sym: l.sym, date: l.date, qty: Math.abs(l.qty), px: l.px, note: l.note || "", warn: [] });
      S.msg = "已放進下方表格，改完按「確認存入」。"; render();
      var inp = document.getElementById("hin"); if (inp) inp.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if ((b = t.closest("[data-del]"))) { if (S.confirmDel === b.dataset.del) deleteLot(b.dataset.del); else { S.confirmDel = b.dataset.del; render(); } return; }
    if ((b = t.closest("[data-cash]"))) {
      var a = ACCTS.filter(function (x) { return x.id === b.dataset.cash; })[0], c = S.h.cash[b.dataset.cash] || {};
      S.rows.push({ kind: "cash", acct: b.dataset.cash, ccy: a ? a.ccy : "USD", amount: c[a ? a.ccy : "USD"] || 0, warn: [] }); render(); return;
    }
    if (t.closest("#htoksave")) {
      var v = document.getElementById("htok").value.trim();
      if (!v) return;
      ls("cd_gh_token", v);
      GH.canWrite().then(function (ok) {
        S.msg = ok ? "權杖可以寫入，設定完成。" : "權杖已儲存，但它看起來沒有這個 repo 的寫入權限，請確認 Contents 是 Read and write。";
        render();
      });
      return;
    }
    if (t.closest("#htokdel")) { ls("cd_gh_token", null); S.msg = "已從這台裝置移除權杖。"; render(); return; }
    if (t.closest("input,select,textarea,button,a,.lots,.pd")) return;
    if ((b = t.closest(".prow"))) { S.open[b.dataset.k] = !S.open[b.dataset.k]; S.confirmDel = null; render(); return; }
    if ((b = t.closest(".hrow"))) { if (t.closest(".det")) return; S.open[b.dataset.acct] = !S.open[b.dataset.acct]; render(); }
  }
  function onInput(e) {
    var t = e.target;
    if (window.Scan && Scan.onChange(t)) return;
    if (t.id === "hin") { ls("cd_draft", t.value); return; }
    if (t.dataset && t.dataset.i != null) {
      var r = S.rows[+t.dataset.i]; if (!r) return;
      var f = t.dataset.f;
      r[f] = (f === "qty" || f === "px" || f === "amount") ? (t.value === "" ? null : Number(t.value)) : t.value;
      if (f === "kind" || f === "acct" || f === "ccy") { validate(r); render(); }
    }
  }

  var started = false;
  function start() {
    if (started) return; started = true;
    applyUpDown();
    var el = document.getElementById("holdings");
    el.addEventListener("click", onClick);
    el.addEventListener("input", onInput);
    el.addEventListener("change", onInput);
    el.addEventListener("keydown", function (e) {
      if (e.target.id === "htgt" && e.key === "Enter") { e.preventDefault(); var tk = document.querySelector("[data-tgt-ok]"); if (tk) tk.click(); return; }
      if (e.target.id === "hman" && e.key === "Enter") { e.preventDefault(); var ok = document.querySelector("[data-man-ok]"); if (ok) ok.click(); return; }
      if (e.target.id !== "hren") return;
      if (e.key === "Enter") { e.preventDefault(); renameSym(S.renaming); }
      else if (e.key === "Escape") { S.renaming = null; render(); }
    });
    render();
    Promise.all([
      loadHoldings(),
      fetch("prices.json?t=" + Date.now()).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { S.prices = j; }, function () {}),
      fetch("data.json?t=" + Date.now()).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { S.data = j; if (j && j.position_cap) CAP = j.position_cap; }, function () {})
    ]).then(render, function (e) { S.msg = e.message; render(); });
  }
  // 便宜度頁用：先在背景載入持倉與現價（不畫持倉頁）
  function preload() {
    var ps = [];
    if (!S.h) ps.push(loadHoldings());
    if (!S.prices) ps.push(fetch("prices.json?t=" + Date.now()).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { S.prices = j; }));
    return Promise.all(ps);
  }
  // 某代碼跨帳戶合計（原幣別）＋各帳戶明細；沒有持有回傳 null
  var memo = { key: null, sm: null };
  function held(sym) {
    if (!S.h) return null;
    var ps = positions().filter(function (p) { return p.sym === sym; });
    if (!ps.length) return null;
    if (memo.key !== S.h || memo.p !== S.prices) { memo = { key: S.h, p: S.prices, sm: summarize() }; }
    var qty = 0, cost = 0, mv = 0, hasPx = true;
    ps.forEach(function (p) { qty += p.qty; cost += p.cost; if (p.mv == null) hasPx = false; else mv += p.mv; });
    var price = ps[0].price, mvT = ps[0].mv != null ? toTWD(mv, ps[0].ccy) : null;
    return { sym: sym, ccy: ps[0].ccy, qty: qty, avg: qty ? cost / qty : null, cost: cost, price: price,
      mv: hasPx ? mv : null, pnl: hasPx ? mv - cost : null, ret: hasPx && cost ? mv / cost - 1 : null,
      share: mvT != null && memo.sm.total ? mvT / memo.sm.total : null,
      accts: ps.sort(function (a, b) { return b.qty - a.qty; }).map(function (p) { return { name: acctName(p.acct), qty: p.qty, avg: p.avg, ret: p.cost && p.mv != null ? p.mv / p.cost - 1 : null }; }) };
  }

  window.Holdings = {
    preload: preload, held: held,
    openTop: function (sym) { S.chart = "top"; ls("cd_chart", "top"); S.topOpen = sym; },
    start: start, refresh: function () { render(); }, positions: function () { return S.h ? positions() : []; },
    // 截圖辨識的結果放進表格（不直接存檔）
    addRows: function (rows) { rows.forEach(validate); S.rows = S.rows.concat(rows); render(); var tb = document.querySelector("#holdings .ht.edit"); if (tb) tb.scrollIntoView({ behavior: "smooth", block: "start" }); },
    // 給 AI 的「代碼＝名稱」對照：觀察清單＋持倉
    knownNames: function () {
      var m = {};
      (S.data ? S.data.items : []).forEach(function (r) { m[r.symbol.replace(/\.TW$/, "")] = r.name; });
      Object.keys((S.h && S.h.names) || {}).forEach(function (k) { if (!m[k]) m[k] = S.h.names[k]; });
      return Object.keys(m).map(function (k) { return k + "=" + m[k]; }).join("、");
    }
  };
})();
