/* 「事件表」分頁：未來的重要事件節點。
 * 來源：site/events.json（聯準會、CPI、選舉、台積電、台灣央行…固定行事曆，Claude 整理）
 *     ＋ data.json 的 events_auto（排程每次更新時自動抓的美股財報日）
 *     ＋ 交屋分頁的重要日期（只有解鎖後才會出現）。 */
(function () {
  "use strict";
  var S = { cal: null, auto: [], house: [], filter: "all", past: false, msg: "", open: null };
  var CATS = [["all", "全部"], ["macro", "總經・利率"], ["earn", "財報"], ["tw", "台股"], ["pol", "政治"], ["mine", "我的持股"], ["house", "房產"]];
  var KIND_CAT = { FOMC: "macro", FOMC_SEP: "macro", CPI: "macro", NFP: "macro", CBC: "macro", TSMC: "tw", TSMC_REV: "tw", ELECTION_US: "pol", ELECTION_TW: "pol", WITCHING: "macro", EARN: "earn", HOUSE: "house" };
  var KIND_LABEL = { macro: "總經", earn: "財報", tw: "台股", pol: "政治", house: "房產" };
  var WD = "日一二三四五六";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function el() { return document.getElementById("events"); }
  function day0() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function parse(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function daysTo(s) { return Math.round((parse(s) - day0()) / 864e5); }

  function all() {
    var kinds = (S.cal && S.cal.kinds) || {}, held = {};
    (window.Holdings ? Holdings.syms() : []).forEach(function (s) { held[s] = 1; });
    var out = ((S.cal && S.cal.events) || []).map(function (e) {
      var k = kinds[e.kind] || {};
      return { date: e.date, title: e.title, cat: KIND_CAT[e.kind] || "macro", level: e.level || "中", est: !!e.est, impact: k.impact || [], why: k.why || "" };
    });
    S.auto.forEach(function (e) {
      out.push({ date: e.date, title: e.name + "（" + e.sym + "）財報", cat: "earn", level: /NVDA|TSM|AVGO|MSFT|GOOGL|META|AMZN|AAPL/.test(e.sym) ? "高" : "中",
        est: e.est, impact: ["個股", "美股"], why: "公司公布季度營收、獲利與展望。結果和預期差很多時，股價常單日大漲大跌；AI 指標股的財報也會帶動整個半導體。" + (e.end ? "（日期區間 " + e.date.slice(5) + "～" + e.end.slice(5) + "，公司還沒確定）" : ""),
        sym: e.sym, mine: !!held[e.sym] });
    });
    S.house.forEach(function (e) { out.push({ date: e.date, title: e.title, cat: "house", level: e.level || "高", impact: ["資金"], why: "交屋資金規劃的重要日期，詳細數字在「交屋」分頁。" }); });
    return out.sort(function (a, b) { return a.date.localeCompare(b.date) || (a.level === "高" ? -1 : 1); });
  }
  function pick(list) {
    return list.filter(function (e) {
      if (!S.past && daysTo(e.date) < -1) return false;
      if (S.filter === "all") return true;
      if (S.filter === "mine") return e.mine || e.cat === "house";
      return e.cat === S.filter;
    });
  }

  function render() {
    if (!S.cal) { el().innerHTML = '<div class="card"><p class="note">' + esc(S.msg || "載入中…") + "</p></div>"; return; }
    var list = all(), shown = pick(list);
    var next = list.filter(function (e) { return daysTo(e.date) >= 0 && e.level === "高"; }).slice(0, 3);
    var h = '<div class="card ev-top"><h3>📅 事件表</h3><p class="note">未來的重要事件。財報日由排程自動更新，其他行事曆由 Claude 定期整理（最近整理 ' + esc(S.cal.updated) + "）。標「估」的日期是推算，以官方公布為準。</p>";
    if (next.length) h += '<div class="ev-next">' + next.map(function (e) {
      var n = daysTo(e.date);
      return '<div class="ev-cd ' + e.cat + '"><b>' + (n === 0 ? "今天" : n + " 天後") + "</b><span>" + esc(e.title) + "</span><em>" + esc(e.date.slice(5).replace("-", "/")) + "</em></div>";
    }).join("") + "</div>";
    h += '<div class="ev-f">' + CATS.map(function (c) { return '<button data-evf="' + c[0] + '" aria-pressed="' + (S.filter === c[0]) + '">' + c[1] + "</button>"; }).join("")
      + '<label class="ev-past"><input type="checkbox" id="ev-past"' + (S.past ? " checked" : "") + "> 顯示已過去</label></div></div>";
    if (!shown.length) h += '<div class="card"><p class="note">這個分類目前沒有事件。' + (S.filter === "house" && !S.house.length ? "房產日期要先到「交屋」分頁解鎖。" : "") + "</p></div>";
    var month = "";
    shown.forEach(function (e, i) {
      var m = e.date.slice(0, 7);
      if (m !== month) { if (month) h += "</div>"; month = m; h += '<h4 class="ev-m">' + m.replace("-", " 年 ") + ' 月</h4><div class="card ev-list">'; }
      var n = daysTo(e.date), d = parse(e.date), id = e.date + "|" + e.title, on = S.open === id;
      h += '<div class="ev ' + e.cat + (n < 0 ? " past" : "") + (on ? " open" : "") + '" data-ev="' + esc(id) + '" tabindex="0">'
        + '<div class="ev-d"><b>' + d.getDate() + "</b><span>週" + WD[d.getDay()] + "</span></div>"
        + '<div class="ev-b"><div class="ev-t"><span class="ev-lv l' + (e.level === "高" ? 3 : e.level === "中" ? 2 : 1) + '" title="重要性：' + e.level + '"></span>' + esc(e.title)
        + (e.est ? '<span class="ev-est">估</span>' : "") + (e.mine ? '<span class="ev-mine">持有</span>' : "") + "</div>"
        + '<div class="ev-i"><span class="ev-k">' + (KIND_LABEL[e.cat] || "") + "</span>" + e.impact.filter(function (x) { return x !== KIND_LABEL[e.cat]; }).map(function (x) { return '<span class="ev-c">' + esc(x) + "</span>"; }).join("") + "</div>"
        + (on ? '<p class="ev-why">' + esc(e.why) + "</p>" : "") + "</div>"
        + '<div class="ev-n">' + (n === 0 ? "今天" : n > 0 ? n + " 天" : "已過") + "</div></div>";
    });
    if (month) h += "</div>";
    h += '<p class="note">點一下事件看它為什麼重要、會影響什麼。只呈現時間與可能的影響，不是買賣建議。</p>';
    el().innerHTML = h;
  }

  function load() {
    S.msg = ""; render();
    var cal = fetch("events.json?t=" + Date.now()).then(function (r) { if (!r.ok) throw new Error("讀取事件表失敗（" + r.status + "）"); return r.json(); });
    var auto = fetch("data.json?t=" + Date.now()).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { return (d && d.events_auto) || []; }, function () { return []; });
    var house = window.Housing ? Housing.events().catch(function () { return []; }) : Promise.resolve([]);
    var held = window.Holdings ? Holdings.preload().catch(function () {}) : null;
    Promise.all([cal, auto, house, held]).then(function (r) { S.cal = r[0]; S.auto = r[1]; S.house = r[2]; render(); }, function (e) { S.msg = e.message; render(); });
  }

  var started = false;
  function start() {
    if (!started) {
      started = true;
      el().addEventListener("click", function (e) {
        var f = e.target.closest("[data-evf]"); if (f) { S.filter = f.dataset.evf; render(); return; }
        if (e.target.id === "ev-past") { S.past = e.target.checked; render(); return; }
        var r = e.target.closest("[data-ev]"); if (r) { S.open = S.open === r.dataset.ev ? null : r.dataset.ev; render(); }
      });
      el().addEventListener("keydown", function (e) { if ((e.key === "Enter" || e.key === " ") && e.target.dataset.ev) { e.preventDefault(); e.target.click(); } });
    }
    load();
  }
  /** 給建議操作的 AI 用：未來 n 天內的事件（不含房產細節以外的敏感資料）。 */
  function upcoming(n) { return S.cal ? all().filter(function (e) { var d = daysTo(e.date); return d >= 0 && d <= n; }) : []; }
  function ensure() { return S.cal ? Promise.resolve() : new Promise(function (ok) { var t = setInterval(function () { if (S.cal) { clearInterval(t); ok(); } }, 200); load(); setTimeout(function () { clearInterval(t); ok(); }, 8000); }); }
  window.Events = { start: start, upcoming: function (n) { return ensure().then(function () { return upcoming(n || 45); }); } };
})();
