/* 「近期操作」分頁：一個可以打字的筆記本，記最近要注意的點、要做的事。
 * 內容存在 repo 的 notes.json（用持倉存檔的同一把權杖），手機和電腦看到同一份。
 * 還沒按儲存的內容會先暫存在這台裝置的瀏覽器，關掉網頁也不會不見。 */
(function () {
  "use strict";
  var DRAFT = "cd_notes_draft";
  var S = { text: "", updated: "", sha: null, loaded: false, busy: false, msg: "", err: false };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function el() { return document.getElementById("notes"); }
  function ta() { return document.getElementById("nt-text"); }
  function draft(v) {
    if (v === undefined) { try { return JSON.parse(GH.ls(DRAFT) || "null"); } catch (e) { return null; } }
    GH.ls(DRAFT, v === null ? null : JSON.stringify(v));
  }
  function dirty() { var t = ta(); return !!t && t.value !== S.text; }
  function when(iso) {
    if (!iso) return "";
    var d = new Date(iso); if (isNaN(d)) return "";
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function status() {
    var o = document.getElementById("nt-st"); if (!o) return;
    if (S.busy) { o.textContent = "儲存中…"; o.className = "dim"; return; }
    if (S.msg) { o.textContent = S.msg; o.className = S.err ? "nt-err" : "dim"; return; }
    if (dirty()) { o.textContent = "有還沒儲存的修改（已暫存在這台裝置）"; o.className = "nt-dirty"; return; }
    o.textContent = S.updated ? "上次儲存：" + when(S.updated) : "還沒有內容"; o.className = "dim";
  }

  function render() {
    if (!S.loaded) { el().innerHTML = '<div class="card"><p class="note">' + esc(S.msg || "載入中…") + "</p></div>"; return; }
    var can = !!GH.token();
    var d = draft(), text = d && d.text !== S.text ? d.text : S.text;
    el().innerHTML = '<div class="card"><h3>📝 近期操作</h3>'
      + '<p class="note">記下最近要注意的點、要做的事。手機和電腦共用同一份。</p>'
      + '<textarea id="nt-text" class="nt" rows="16" placeholder="例如：&#10;・10/15 前把 SNXX 反彈時賣一半&#10;・VWRA 分 3 次買，下一次 11/1&#10;・黃金分數 ≥80 再補"' + (can ? "" : " readonly") + ">" + esc(text) + "</textarea>"
      + '<div class="bar nt-bar">' + (can
        ? '<button class="btn" id="nt-save">儲存</button><button class="btn ghost" id="nt-undo">放棄修改</button>'
        : '<span class="note">要先在「持倉」分頁的「存檔設定」貼上權杖，才能編輯。</span>')
      + '<span id="nt-st"></span></div></div>';
    status();
    if (d && d.text !== S.text && !S.msg) { S.msg = "已還原上次還沒儲存的內容，記得按儲存。"; status(); S.msg = ""; }
  }

  function save() {
    if (S.busy || !dirty()) { status(); return; }
    var text = ta().value, now = new Date().toISOString();
    S.busy = true; S.msg = ""; S.err = false; status();
    document.getElementById("nt-save").disabled = true;
    GH.put("notes.json", { text: text, updated: now }, S.sha, "更新近期操作筆記").then(function (sha) {
      S.sha = sha; S.text = text; S.updated = now; S.busy = false;
      draft(null);
      S.msg = "已儲存（" + when(now) + "）"; status(); S.msg = "";
      document.getElementById("nt-save").disabled = false;
    }).catch(function (e) {
      S.busy = false; S.err = true;
      document.getElementById("nt-save").disabled = false;
      if (e.conflict) {
        // 別的裝置剛存過：拿到最新版本的 sha，畫面保留你現在打的內容，再按一次儲存就會用你的版本
        GH.get("notes.json").then(function (r) {
          S.sha = r.sha; S.text = (r.data && r.data.text) || ""; S.updated = (r.data && r.data.updated) || "";
          S.msg = "別的裝置剛存過另一個版本。畫面上是你的內容，再按一次儲存會蓋過去；想看另一個版本請按「放棄修改」。"; status();
        }, function (e2) { S.msg = e2.message; status(); });
        return;
      }
      S.msg = e.message; status();
    });
  }

  function load() {
    S.loaded = false; S.msg = ""; render();
    GH.get("notes.json").then(function (r) {
      S.text = (r.data && r.data.text) || ""; S.updated = (r.data && r.data.updated) || ""; S.sha = r.sha;
      S.loaded = true; render();
    }, function (e) { S.msg = e.message; render(); });
  }

  var started = false;
  function start() {
    if (!started) {
      started = true;
      el().addEventListener("click", function (e) {
        if (e.target.closest("#nt-save")) save();
        if (e.target.closest("#nt-undo")) { draft(null); S.msg = ""; S.err = false; render(); }
      });
      el().addEventListener("input", function (e) {
        if (e.target.id !== "nt-text") return;
        S.msg = ""; S.err = false;
        draft(dirty() ? { text: e.target.value } : null); status();
      });
      el().addEventListener("keydown", function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); }
      });
      window.addEventListener("beforeunload", function (e) { if (dirty()) { e.preventDefault(); e.returnValue = ""; } });
      load();
      return;
    }
    if (!dirty()) load();   // 每次切回來重新抓，看得到別的裝置的修改；正在打字就不打斷
  }
  window.Notes = { start: start };
})();
