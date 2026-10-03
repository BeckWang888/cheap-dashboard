/* 持倉分頁：讀寫 repo 裡的 holdings.json（透過 GitHub API），價格來自 prices.json。 */
(function () {
  "use strict";
  var CAP = 0.10;                // 單一標的佔總資產的提醒上限（設定頁可改，載入 data.json 後覆蓋）
  var P = window.HoldParse;
  var ACCTS = P.ACCOUNTS;
  var REPO = GH.REPO, ls = GH.ls, token = GH.token;

  var S = { h: null, sha: null, prices: null, data: null, ccy: "USD", open: {}, rows: [], msg: "", busy: false, confirmDel: null, renaming: null };
  S.ccy = ls("cd_ccy") === "TWD" ? "TWD" : "USD";

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

  // ---------- 畫面 ----------
  function render() {
    var el = document.getElementById("holdings");
    if (!S.h) { el.innerHTML = '<div class="card empty">' + esc(S.msg || "載入持倉中…") + "</div>"; return; }
    var pos = positions(), fxv = fx();
    var totStock = 0, totCash = 0, totCost = 0, totToday = 0, totPrev = 0, semi = 0, missing = 0;
    pos.forEach(function (p) {
      if (p.mv == null) { missing++; return; }
      var mv = toTWD(p.mv, p.ccy), c = toTWD(p.cost, p.ccy), t = toTWD(p.today || 0, p.ccy);
      if (mv == null) { missing++; return; }
      totStock += mv; totCost += c; totToday += t; totPrev += mv - t;
      var sc = scoreOf(p.sym); if (sc && sc.group) semi += mv;
    });
    Object.keys(S.h.cash).forEach(function (a) { var c = S.h.cash[a]; Object.keys(c).forEach(function (ccy) { var v = toTWD(Number(c[ccy]) || 0, ccy); if (v != null) totCash += v; }); });
    var total = totStock + totCash;

    var h = '<div class="hsum">'
      + '<div class="big"><span>總資產（台幣）</span><b>' + money(total, "TWD") + "</b></div>"
      + '<div><span>今日</span><b>' + signed(totToday, "TWD") + "</b><i>" + pct(totPrev ? totToday / totPrev : null, 2) + "</i></div>"
      + '<div><span>總損益</span><b>' + signed(totStock - totCost, "TWD") + "</b><i>" + pct(totCost ? (totStock - totCost) / totCost : null) + "</i></div>"
      + '<div><span>現金</span><b>' + money(totCash, "TWD") + "</b><i>佔 " + (total ? (totCash / total * 100).toFixed(1) : "0") + "%</i></div>"
      + '<div><span>半導體／AI</span><b>' + (total ? (semi / total * 100).toFixed(1) + "%" : "—") + "</b><i>依觀察清單分類</i></div>"
      + "</div>";
    h += '<p class="note">美元匯率 ' + (fxv ? fxv.toFixed(3) + "（" + S.prices.fx.date.slice(5).replace("-", "/") + "）" : "—")
      + "・價格更新 " + esc(S.prices ? S.prices.generated : "—")
      + (missing ? '・<span class="neg">' + missing + " 檔還沒有價格，存檔後約 2 分鐘更新</span>" : "") + "</p>";
    h += '<div class="bar"><span class="dim" style="font-size:14px">美股顯示</span><div class="tabs" id="hccy">'
      + '<button data-c="USD" aria-pressed="' + (S.ccy === "USD") + '">美元</button><button data-c="TWD" aria-pressed="' + (S.ccy === "TWD") + '">台幣</button></div></div>';

    // 帳戶列表
    var byAcct = {};
    pos.forEach(function (p) { (byAcct[p.acct] = byAcct[p.acct] || []).push(p); });
    var ids = ACCTS.map(function (a) { return a.id; }).concat(Object.keys(byAcct).filter(function (k) { return !ACCTS.some(function (a) { return a.id === k; }); }));
    var empty = [];
    h += '<div class="list">';
    ids.forEach(function (id) {
      var ps = byAcct[id] || [], cash = S.h.cash[id] || {};
      var hasCash = Object.keys(cash).some(function (c) { return Number(cash[c]); });
      if (!ps.length && !hasCash) { empty.push(acctName(id)); return; }
      var a = ACCTS.filter(function (x) { return x.id === id; })[0] || { market: "US", ccy: "USD" };
      var dc = a.market === "TW" ? "TWD" : S.ccy;     // 顯示幣別
      function conv(v, ccy) { if (v == null) return null; return dc === ccy ? v : dc === "TWD" ? toTWD(v, ccy) : (fxv ? v / fxv : null); }
      var mv = 0, cost = 0, today = 0, cashV = 0;
      ps.forEach(function (p) { if (p.mv != null) { mv += conv(p.mv, p.ccy); cost += conv(p.cost, p.ccy); today += conv(p.today || 0, p.ccy); } });
      Object.keys(cash).forEach(function (c) { cashV += conv(Number(cash[c]) || 0, c) || 0; });
      var open = S.open[id];
      h += '<div class="row hrow' + (open ? " open" : "") + '" tabindex="0" data-acct="' + esc(id) + '">'
        + '<div class="id"><b>' + esc(acctName(id)) + '</b><span class="nm">' + ps.length + " 檔" + (cashV ? "・現金 " + money(cashV, dc) : "") + "</span></div>"
        + '<div class="hv"><b>' + money(mv + cashV, dc) + '</b><span>今日 ' + signed(today, dc) + "</span></div>"
        + '<div class="sc"><b style="font-size:17px">' + pct(cost ? (mv - cost) / cost : null) + '</b><span class="dim" style="font-weight:400">' + signed(mv - cost, dc) + "</span></div>";
      if (open) h += acctDetail(id, ps, conv, dc, total);
      h += "</div>";
    });
    if (!pos.length && !Object.keys(S.h.cash).length) h += '<div class="empty">還沒有持倉。用下方的「新增持倉」念或打字輸入，例如：<br>「華南台股，0050，3000 股，成本 150」</div>';
    h += "</div>";
    if (empty.length && (pos.length || Object.keys(S.h.cash).length)) h += '<p class="note" style="margin-top:6px">沒有持倉的帳戶：' + empty.map(esc).join("、") + "</p>";

    h += inputCard() + settingsCard();
    el.innerHTML = h;
  }

  function acctDetail(id, ps, conv, dc, total) {
    var h = '<div class="det" style="display:block"><div class="scroll"><table class="ht"><tr><th>代碼</th><th>股數</th><th>均價</th><th>現價</th><th>今日</th><th>市值</th><th>損益</th><th>佔總資產</th><th>目標</th><th>便宜度</th></tr>';
    ps.sort(function (a, b) { return (conv(b.mv || 0, b.ccy) || 0) - (conv(a.mv || 0, a.ccy) || 0); }).forEach(function (p) {
      var sc = scoreOf(p.sym), w = total && p.mv != null ? toTWD(p.mv, p.ccy) / total : null, k = id + "|" + p.sym;
      var nm = S.h.names[p.sym] || (sc ? "" : "");
      var symCell = S.renaming === k
        ? '<input id="hren" value="' + esc(p.sym) + '" size="7" autocapitalize="characters"> <button class="lk" data-ren-ok="' + esc(k) + '">確定</button><button class="lk" data-ren-no="1">取消</button>'
        : "<b>" + esc(p.sym) + "</b>" + (nm ? ' <span class="dim">' + esc(nm) + "</span>" : "") + (token() ? ' <button class="lk" data-ren="' + esc(k) + '" title="修改代碼" aria-label="修改代碼">✎</button>' : "") + (p.q ? "" : ' <span class="neg" style="font-size:12px">抓不到價格，請確認代碼或手動輸入價格</span>');
      if (S.manualEdit === p.sym) symCell += '<div style="margin-top:4px">現價 <input id="hman" inputmode="decimal" size="8" value="' + esc((S.h.manual[p.sym] || {}).price || "") + '"> <button class="lk" data-man-ok="' + esc(p.sym) + '">儲存</button><button class="lk" data-man-no="1">取消</button>' + (S.h.manual[p.sym] ? '<button class="lk" data-man-clear="' + esc(p.sym) + '">改回自動</button>' : "") + "</div>";
      h += '<tr class="prow" data-k="' + esc(k) + '"><td>' + symCell + "</td>"
        + "<td>" + num(p.qty, 4) + "</td><td>" + num(p.avg, 2) + "</td>"
        + "<td>" + (p.q ? num(p.price, 2) + ' <span class="dim">' + (p.q.manual ? "手動" : p.q.est ? "估算" : String(p.q.date).slice(5).replace("-", "/")) + "</span>" : '<span class="dim">—</span>')
        + (token() && (!p.q || p.q.manual || p.q.est) ? ' <button class="lk" data-man="' + esc(p.sym) + '" title="手動輸入價格">' + (p.q ? "改價格" : "輸入價格") + "</button>" : "") + "</td>"
        + "<td>" + (p.q ? pct(p.q.chg, 2) : "—") + "</td>"
        + "<td>" + money(conv(p.mv, p.ccy), dc) + "</td>"
        + "<td>" + signed(conv(p.pnl, p.ccy), dc) + " " + pct(p.cost ? p.pnl / p.cost : null) + "</td>"
        + "<td" + (w != null && w > CAP ? ' class="neg" title="超過單一持股上限 ' + Math.round(CAP * 100) + '%"' : "") + ">" + (w == null ? "—" : (w * 100).toFixed(1) + "%" + (w > CAP ? " ⚠" : "")) + "</td>"
        + "<td>" + targetCell(p.sym, w, total, p.mv != null ? toTWD(p.mv, p.ccy) : null) + "</td>"
        + "<td>" + (sc && sc.score != null ? sc.score.toFixed(0) + " " + esc(sc.level) : '<span class="dim">—</span>') + "</td></tr>";
      if (S.open[k]) {
        h += '<tr class="lots"><td colspan="10">' + p.lots.map(function (l) {
          var del = S.confirmDel === l.id;
          return '<div class="lot">' + (l.date ? "<span>" + esc(l.date) + "</span>" : "") + "<span>" + (l.qty < 0 ? "賣 " : "買 ") + num(Math.abs(l.qty), 4) + " 股</span><span>@ " + num(l.px, 4) + "</span>" + (l.note ? '<span class="dim">' + esc(l.note) + "</span>" : "")
            + (token() ? '<button class="lk" data-edit="' + esc(l.id) + '">編輯</button><button class="lk' + (del ? " danger" : "") + '" data-del="' + esc(l.id) + '">' + (del ? "確定刪除？" : "刪除") + "</button>" : "") + "</div>";
        }).join("") + "</td></tr>";
      }
    });
    var cash = S.h.cash[id] || {};
    var cs = Object.keys(cash).filter(function (c) { return Number(cash[c]); });
    h += "</table></div>";
    if (cs.length || token()) h += '<div class="kv" style="margin-top:8px"><div>現金<b>' + (cs.length ? cs.map(function (c) { return money(Number(cash[c]), c) + (c === "USD" ? " 美元" : " 台幣"); }).join("、") : "未填") + "</b></div>"
      + (token() ? '<div><button class="lk" data-cash="' + esc(id) + '">修改現金</button></div>' : "") + "</div>";
    return h + "</div>";
  }

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
    var h = '<div class="card"><h3>新增／修改持倉</h3>'
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
    saveHoldings(h, "更新持倉（" + S.rows.length + " 筆）").then(function () {
      S.rows = []; ls("cd_draft", null); S.busy = false;
      S.msg = "已存檔。新代碼的價格約 2 分鐘後出現，屆時重新整理頁面。";
      render();
    }).catch(function (e) {
      S.busy = false; S.msg = e.message;
      if (e.conflict) loadHoldings().then(render, render); else render();
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

  function onClick(e) {
    var t = e.target, b;
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
    if (t.closest("input,select,textarea,button,a,.lots")) return;
    if ((b = t.closest(".prow"))) { S.open[b.dataset.k] = !S.open[b.dataset.k]; S.confirmDel = null; render(); return; }
    if ((b = t.closest(".hrow"))) { if (t.closest(".det")) return; S.open[b.dataset.acct] = !S.open[b.dataset.acct]; render(); }
  }
  function onInput(e) {
    var t = e.target;
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
  window.Holdings = { start: start };
})();
