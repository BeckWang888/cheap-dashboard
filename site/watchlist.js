/* 便宜度分頁的「編輯清單」：新增、刪除、拖曳排序觀察標的，存回 repo 的 watchlist.json。 */
(function () {
  "use strict";
  var TYPES = { etf: "ETF", stock: "個股", leveraged: "槓桿" };
  var S = { list: null, sha: null, msg: "", busy: false, del: null, sortable: null };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function el() { return document.getElementById("wl"); }
  function normSym(v) {
    v = String(v || "").trim().toUpperCase().replace(/\s+/g, "");
    if (/^\d{4,6}[A-Z]?$/.test(v)) v += ".TW";
    return v;
  }

  function render() {
    var box = el();
    if (!GH.token()) {
      box.innerHTML = '<div class="card"><h3>編輯觀察清單</h3><p class="note">要先在「持倉」分頁最下面的「存檔設定」貼上 GitHub 存取權杖，才能修改清單。</p><button class="btn ghost" data-wl="close">關閉</button></div>';
      return;
    }
    if (!S.list) { box.innerHTML = '<div class="card"><p class="note">' + esc(S.msg || "載入清單中…") + '</p><button class="btn ghost" data-wl="close">關閉</button></div>'; return; }
    var h = '<div class="card"><h3>編輯觀察清單</h3><p class="note">按住左邊的 ☰ 上下拖曳排序；名稱和族群可以直接改。改完按「儲存」，新增的標的約 2 分鐘後出現分數。</p><ul class="wl" id="wlist">';
    S.list.forEach(function (it, i) {
      var lev = it.type === "leveraged";
      h += '<li data-i="' + i + '"><span class="hd" aria-label="拖曳排序">☰</span>'
        + '<b class="ws">' + esc(it.symbol.replace(/\.TW$/, "")) + "</b>"
        + '<input data-f="name" data-i="' + i + '" value="' + esc(it.name || "") + '" placeholder="名稱" aria-label="名稱">'
        + '<span class="wt">' + TYPES[it.type] + (lev ? " " + esc(it.x) + "× " + esc(it.underlying) : "") + "</span>"
        + '<input data-f="group" data-i="' + i + '" value="' + esc(it.group || "") + '" placeholder="族群" list="wgroups" aria-label="族群" class="wg">'
        + '<button class="lk' + (S.del === i ? " danger" : "") + '" data-wl="del" data-i="' + i + '">' + (S.del === i ? "確定刪除？" : "刪除") + "</button></li>";
    });
    h += '</ul><datalist id="wgroups"><option value="半導體/AI"></datalist>';
    h += '<h4 style="margin:14px 0 6px;font-size:13px;color:var(--sub)">新增標的</h4><div class="wadd">'
      + '<input id="wa-sym" placeholder="代碼，例：2330、NVDA" autocapitalize="characters">'
      + '<input id="wa-name" placeholder="名稱，例：台積電">'
      + '<select id="wa-type"><option value="stock">個股</option><option value="etf">ETF</option><option value="leveraged">槓桿 ETF</option></select>'
      + '<input id="wa-under" placeholder="對應標的，例：SOXX" class="lev" hidden autocapitalize="characters">'
      + '<input id="wa-x" placeholder="倍數，例：3" inputmode="decimal" class="lev" hidden>'
      + '<input id="wa-group" placeholder="族群（選填）" list="wgroups">'
      + '<button class="btn ghost" data-wl="add">加入</button></div>';
    h += '<div class="bar" style="margin-top:12px"><button class="btn" data-wl="save"' + (S.busy ? " disabled" : "") + ">" + (S.busy ? "儲存中…" : "儲存") + '</button><button class="btn ghost" data-wl="close">取消</button></div>';
    if (S.msg) h += '<p class="note" style="margin-top:8px">' + esc(S.msg) + "</p>";
    box.innerHTML = h + "</div>";
    if (window.Sortable) {
      S.sortable = Sortable.create(document.getElementById("wlist"), {
        handle: ".hd", animation: 150,
        onEnd: function () {
          var order = [].map.call(document.querySelectorAll("#wlist li"), function (li) { return +li.dataset.i; });
          S.list = order.map(function (i) { return S.list[i]; });
          S.del = null;
          render();
        }
      });
    }
  }

  function add() {
    var sym = normSym(document.getElementById("wa-sym").value);
    var type = document.getElementById("wa-type").value;
    if (!sym) { S.msg = "請輸入代碼。"; render(); return; }
    if (S.list.some(function (it) { return it.symbol === sym; })) { S.msg = sym + " 已經在清單裡。"; render(); return; }
    var it = { symbol: sym, name: document.getElementById("wa-name").value.trim() || sym.replace(/\.TW$/, ""),
      market: /\.TW$/.test(sym) ? "TW" : "US", type: type, group: document.getElementById("wa-group").value.trim() };
    if (type === "leveraged") {
      var u = normSym(document.getElementById("wa-under").value), x = Number(document.getElementById("wa-x").value);
      if (!u || !(x > 0)) { S.msg = "槓桿 ETF 要填對應標的和倍數。"; render(); return; }
      it.underlying = u; it.x = x;
    }
    S.list.push(it);
    S.msg = "已加入 " + sym.replace(/\.TW$/, "") + "，記得按「儲存」。";
    render();
  }

  function save() {
    S.busy = true; S.msg = ""; render();
    var list = S.list.map(function (it) { var o = {}; Object.keys(it).forEach(function (k) { if (it[k] !== "" || k === "group") o[k] = it[k]; }); return o; });
    GH.put("watchlist.json", list, S.sha, "更新觀察清單").then(function (sha) {
      S.sha = sha; S.busy = false;
      if (window.onWatchlistSaved) window.onWatchlistSaved(list);
      close();
    }).catch(function (e) {
      S.busy = false; S.msg = e.message;
      if (e.conflict) load(); else render();
    });
  }

  function load() {
    S.list = null; render();
    GH.get("watchlist.json").then(function (r) { S.list = r.data; S.sha = r.sha; S.del = null; render(); },
      function (e) { S.msg = e.message; render(); });
  }
  function open() { el().hidden = false; S.msg = ""; if (GH.token()) load(); else render(); el().scrollIntoView({ behavior: "smooth", block: "start" }); }
  function close() { el().hidden = true; S.list = null; if (S.sortable) { S.sortable.destroy(); S.sortable = null; } }

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-wl]");
    if (!b || !el().contains(b)) return;
    var a = b.dataset.wl;
    if (a === "close") close();
    else if (a === "add") add();
    else if (a === "save") save();
    else if (a === "del") {
      var i = +b.dataset.i;
      if (S.del === i) { S.list.splice(i, 1); S.del = null; S.msg = "已移除，記得按「儲存」。"; } else S.del = i;
      render();
    }
  });
  document.addEventListener("input", function (e) {
    var t = e.target;
    if (!el().contains(t)) return;
    if (t.dataset.f && S.list) { S.list[+t.dataset.i][t.dataset.f] = t.value; }
    if (t.id === "wa-type") [].forEach.call(el().querySelectorAll(".lev"), function (x) { x.hidden = t.value !== "leveraged"; });
  });
  document.addEventListener("change", function (e) {
    if (e.target.id === "wa-type") [].forEach.call(el().querySelectorAll(".lev"), function (x) { x.hidden = e.target.value !== "leveraged"; });
  });

  window.WL = { open: open };
})();
