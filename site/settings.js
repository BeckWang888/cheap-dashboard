/* 「設定」分頁：通知門檻、各類通知開關、冷卻天數、族群提醒、單一持股上限，存回 repo 的 config.json。 */
(function () {
  "use strict";
  var S = { cfg: null, sha: null, msg: "", busy: false };
  var NOTIFY = [
    ["cross", "分數跨上門檻", "例如從 15 分升到 25 分，跨過 20"],
    ["confirm", "狀態變成「轉折確認」", "便宜區內 3 個以上轉折訊號，且日線或週線 MACD 亮起"],
    ["trough", "月線 MACD 谷底（重點觀察）", "月中出現會先通知「形成中」，月底收盤再通知「已確認」"],
    ["group", "同族群同時進便宜區", "例如半導體／AI 有 3 檔以上同時便宜，提醒你留意總曝險"],
    ["heat", "個股乖離過熱", "回測顯示過熱後不一定會跌，預設關閉"]
  ];
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function el() { return document.getElementById("settings"); }

  function render() {
    var c = S.cfg;
    if (!c) { el().innerHTML = '<div class="card"><p class="note">' + esc(S.msg || "載入設定中…") + "</p></div>"; return; }
    var can = !!GH.token();
    var th = c.thresholds || [20, 50, 80];
    var h = '<div class="card"><h3>通知門檻</h3><p class="note">分數往上跨過這些數字時通知（−100 ~ 100，由小到大）。dashboard 溫度計上的刻度也會跟著改。</p><div class="sgrid">'
      + th.map(function (v, i) { return '<label>第 ' + (i + 1) + ' 個門檻<input id="st-th' + i + '" type="number" min="-100" max="100" step="1" value="' + esc(v) + '"></label>'; }).join("")
      + "</div></div>";
    h += '<div class="card"><h3>通知類型</h3>' + NOTIFY.map(function (n) {
      return '<label class="tg"><input type="checkbox" id="st-n-' + n[0] + '"' + ((c.notify || {})[n[0]] ? " checked" : "") + "><span><b>" + esc(n[1]) + '</b><span class="dim">' + esc(n[2]) + "</span></span></label>";
    }).join("") + "</div>";
    h += '<div class="card"><h3>其他</h3><div class="sgrid">'
      + '<label>同一事件冷卻天數<input id="st-cool" type="number" min="0" max="60" step="1" value="' + esc(c.cooldown_days) + '"></label>'
      + '<label>族群提醒門檻（檔數）<input id="st-gmin" type="number" min="2" max="20" step="1" value="' + esc(c.group_alert_min) + '"></label>'
      + '<label>單一持股上限（佔總資產 %）<input id="st-cap" type="number" min="1" max="100" step="1" value="' + esc(Math.round((c.position_cap || 0.1) * 100)) + '"></label>'
      + "</div></div>";
    h += '<div class="bar">' + (can ? '<button class="btn" id="st-save"' + (S.busy ? " disabled" : "") + ">" + (S.busy ? "儲存中…" : "儲存設定") + "</button>" : '<span class="note">要先在「持倉」分頁的「存檔設定」貼上權杖，才能儲存設定。</span>') + "</div>";
    if (S.msg) h += '<p class="note" style="margin-top:8px">' + esc(S.msg) + "</p>";
    el().innerHTML = h;
  }

  function num(id) { return Number(document.getElementById(id).value); }
  function save() {
    var th = [0, 1, 2].map(function (i) { return num("st-th" + i); });
    if (th.some(function (v) { return !isFinite(v) || v < -100 || v > 100; }) || !(th[0] < th[1] && th[1] < th[2])) {
      S.msg = "門檻要在 −100 到 100 之間，而且由小到大。"; render(); return;
    }
    var c = JSON.parse(JSON.stringify(S.cfg));
    c.thresholds = th;
    c.notify = c.notify || {};
    NOTIFY.forEach(function (n) { c.notify[n[0]] = document.getElementById("st-n-" + n[0]).checked; });
    c.cooldown_days = Math.max(0, Math.round(num("st-cool")) || 0);
    c.group_alert_min = Math.max(2, Math.round(num("st-gmin")) || 3);
    c.position_cap = Math.min(1, Math.max(0.01, (num("st-cap") || 10) / 100));
    S.busy = true; S.msg = ""; render();
    GH.put("config.json", c, S.sha, "更新設定").then(function (sha) {
      S.sha = sha; S.cfg = c; S.busy = false;
      S.msg = "已儲存。下一次更新（約 2 分鐘後）開始套用。"; render();
    }).catch(function (e) { S.busy = false; S.msg = e.message; if (e.conflict) load(); else render(); });
  }
  function load() {
    S.cfg = null; render();
    GH.get("config.json").then(function (r) { S.cfg = r.data; S.sha = r.sha; render(); }, function (e) { S.msg = e.message; render(); });
  }
  var started = false;
  function start() {
    if (!started) {
      started = true;
      el().addEventListener("click", function (e) { if (e.target.closest("#st-save")) save(); });
    }
    load();
  }
  window.Settings = { start: start };
})();
