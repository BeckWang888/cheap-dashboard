/* 「建議操作」分頁（原「近期操作」）：
 * 上半部：按「更新建議」→ 把目標配置、持股分數、交屋規劃、近期事件、市場溫度和使用者的筆記交給 Gemini，
 *         整理出接下來 1～4 週往目標前進的具體步驟。結果存在 notes.json 的 ai 欄位，手機電腦共用。
 * 下半部：使用者自己的筆記本（notes.json 的 text）。
 * Gemini 金鑰與模型跟截圖辨識共用（localStorage cd_gemini_key / cd_gemini_model）。 */
(function () {
  "use strict";
  var DRAFT = "cd_notes_draft", KEY = "cd_gemini_key", MODEL = "cd_gemini_model", DEF_MODEL = "gemini-3.8-flash", HOUSE_OK = "cd_adv_house";
  var S = { text: "", updated: "", ai: null, sha: null, loaded: false, busy: false, msg: "", err: false,
            aiBusy: false, aiMsg: "", aiErr: false, aiT0: 0, showCtx: false, ctx: null };

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
  function file(extra) { return Object.assign({ text: S.text, updated: S.updated, ai: S.ai }, extra || {}); }

  // ---------- 版面：建議（#adv）和筆記（#nt-card）分開畫，更新建議時不會打斷正在打的字 ----------
  function render() {
    if (!S.loaded) { el().innerHTML = '<div class="card"><p class="note">' + esc(S.msg || "載入中…") + "</p></div>"; return; }
    el().innerHTML = '<div id="adv"></div><div id="nt-card"></div>';
    renderAdvice(); renderNotes();
  }

  function renderAdvice() {
    var box = document.getElementById("adv"); if (!box) return;
    var a = S.ai, hasKey = !!GH.ls(KEY);
    var h = '<div class="card adv-card"><div class="adv-hd"><h3>🧭 建議操作</h3>'
      + (hasKey ? '<button class="btn" id="adv-run"' + (S.aiBusy ? " disabled" : "") + ">" + (S.aiBusy ? "AI 分析中… " + Math.round((Date.now() - S.aiT0) / 1000) + " 秒" : "🔄 更新建議") + "</button>" : "") + "</div>";
    if (!hasKey) {
      h += '<p class="note">要先貼上 Gemini 金鑰（跟持倉頁的截圖辨識共用同一把）。到 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> 免費申請。</p>'
        + '<div class="bar"><input id="adv-key" type="password" placeholder="貼上 Gemini 金鑰" style="flex:1;min-width:0"><button class="btn" id="adv-keyok">儲存金鑰</button></div>';
    }
    if (S.aiMsg) h += '<p class="note ' + (S.aiErr ? "nt-err" : "") + '">' + esc(S.aiMsg) + "</p>";
    if (a) {
      h += '<p class="adv-head">' + esc(a.headline) + "</p>";
      h += '<ol class="adv-list">' + (a.actions || []).slice().sort(function (x, y) { return (x.priority || 9) - (y.priority || 9); }).map(function (x) {
        var p = Math.min(3, Math.max(1, x.priority || 2));
        return '<li class="adv-a p' + p + '"><span class="adv-p">' + ["", "優先", "接著", "之後"][p] + "</span><b>" + esc(x.title) + "</b><p>" + esc(x.detail) + "</p>"
          + (x.why ? '<p class="dim">為什麼：' + esc(x.why) + "</p>" : "") + "</li>";
      }).join("") + "</ol>";
      if (a.watch && a.watch.length) h += '<h4 class="adv-h4">👀 近期留意</h4><ul class="adv-ul">' + a.watch.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
      if (a.cautions && a.cautions.length) h += '<h4 class="adv-h4">⚠️ 要先確認</h4><ul class="adv-ul">' + a.cautions.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
      h += '<p class="note adv-meta">產生時間 ' + esc(when(a.at)) + "・" + esc(a.model || "") + "・依據：" + esc((a.sources || []).join("、"))
        + ' <button class="lk" id="adv-ctx">' + (S.showCtx ? "收起資料" : "看 AI 讀到的資料") + "</button></p>";
      if (S.showCtx && a.ctx) h += '<pre class="adv-ctx">' + esc(a.ctx) + "</pre>";
    } else if (hasKey) {
      h += '<p class="note">還沒有建議。按「更新建議」，AI 會依你的目標配置、交屋規劃、近期事件和下面的筆記，整理出接下來該做的事。</p>';
    }
    if (hasKey) h += '<label class="tg adv-opt"><input type="checkbox" id="adv-house"' + (GH.ls(HOUSE_OK) === "0" ? "" : " checked") + '><span><b>把交屋的數字一起給 AI</b><span class="dim">只送金額與日期（交屋分頁要先解鎖過）。Google 免費版可能用內容訓練模型。</span></span></label>';
    h += '<p class="note">AI 只是幫你把自己訂的計畫整理成步驟，可能算錯或漏看，重大決定前請自己確認。不是投資建議。</p></div>';
    box.innerHTML = h;
  }

  function status() {
    var o = document.getElementById("nt-st"); if (!o) return;
    if (S.busy) { o.textContent = "儲存中…"; o.className = "dim"; return; }
    if (S.msg) { o.textContent = S.msg; o.className = S.err ? "nt-err" : "dim"; return; }
    if (dirty()) { o.textContent = "有還沒儲存的修改（已暫存在這台裝置）"; o.className = "nt-dirty"; return; }
    o.textContent = S.updated ? "上次儲存：" + when(S.updated) : "還沒有內容"; o.className = "dim";
  }
  function renderNotes() {
    var box = document.getElementById("nt-card"); if (!box) return;
    var can = !!GH.token();
    var d = draft(), text = d && d.text !== S.text ? d.text : S.text;
    box.innerHTML = '<div class="card nt-cardx"><h3>📝 我的筆記</h3>'
      + '<p class="note">你的計畫、規則、要注意的事。AI 產生建議時也會讀這裡。</p>'
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
    GH.put("notes.json", file({ text: text, updated: now }), S.sha, "更新筆記").then(function (sha) {
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
          S.sha = r.sha; S.text = (r.data && r.data.text) || ""; S.updated = (r.data && r.data.updated) || ""; S.ai = (r.data && r.data.ai) || S.ai;
          S.msg = "別的裝置剛存過另一個版本。畫面上是你的內容，再按一次儲存會蓋過去；想看另一個版本請按「放棄修改」。"; status();
        }, function (e2) { S.msg = e2.message; status(); });
        return;
      }
      S.msg = e.message; status();
    });
  }

  // ---------- AI ----------
  function wan(v) { return v == null ? null : Math.round(v / 1e4); }
  function context() {
    var useHouse = GH.ls(HOUSE_OK) !== "0", src = [];
    var snap = Holdings.snapshot();
    var house = useHouse && window.Housing ? Housing.summary().catch(function () { return null; }) : Promise.resolve(null);
    var ev = window.Events ? Events.upcoming(45).catch(function () { return []; }) : Promise.resolve([]);
    var mk = fetch("data.json?t=" + Date.now()).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    return Promise.all([snap, house, ev, mk]).then(function (r) {
      var sn = r[0], hs = r[1], evs = r[2], d = r[3], L = [];
      L.push("今天：" + new Date().toISOString().slice(0, 10) + "。金額單位：萬元台幣（美元已換算）。");
      L.push("\n【總資產】" + wan(sn.total) + "，股票等持股 " + wan(sn.stock) + "（其中槓桿 ETF " + wan(sn.lev) + "），現金 " + wan(sn.cash) + "。價格時間 " + sn.at + "。");
      src.push("持倉");
      L.push("\n【目標配置（目前 % → 目標 %，差額：正數＝還要補、負數＝超出）】");
      sn.goal.rows.forEach(function (g) { L.push("- " + g.name + "：" + g.pct.toFixed(1) + "% → " + g.target + "%，差 " + wan(g.diffAmt) + "（" + g.syms.map(function (s) { return s.sym; }).join("、") + "）"); });
      L.push("\n【持股（市值大到小，含便宜度分數與狀態；分數 ≥20 便宜、≥50 很便宜、≥80 極便宜）】");
      sn.syms.slice().sort(function (a, b) { return b.mv - a.mv; }).slice(0, 25).forEach(function (s) {
        L.push("- " + s.sym + " " + (s.name || "") + "｜" + (s.type === "leveraged" ? "槓桿" : s.type) + "｜" + wan(s.mv) + "｜報酬 " + (s.ret == null ? "—" : (s.ret * 100).toFixed(0) + "%") + "｜分數 " + (s.score == null ? "—" : Math.round(s.score)) + (s.state ? "｜" + s.state : ""));
      });
      if (hs) {
        src.push("交屋規劃");
        L.push("\n【交屋資金規劃（2027 左營三間預售屋，交屋 " + hs.delivery + "）】");
        L.push("- 保守情境（銀行估價 8 折、第二戶 7 成）交屋要付 " + hs.need_conservative + "；積極情境 " + hs.need_aggressive);
        L.push("- 股票持有上限：保守 " + hs.stock_cap_conservative + "、積極 " + hs.stock_cap_aggressive + "；目前股票 " + hs.stock + "（其中槓桿 " + hs.lev + "）");
        L.push("- 我的現金 " + hs.my_cash + "＋太太 " + hs.wife_cash + "；保守情境還差 " + hs.cash_short_conservative + " 要在交屋前從股票換成現金");
        L.push("- 每月收入約 " + hs.monthly_income + "；已定方向：" + (hs.plans || []).join("；") + "；待確認：" + (hs.pending || []).join("；"));
      }
      if (evs && evs.length) {
        src.push("事件表");
        L.push("\n【未來 45 天重要事件】");
        evs.slice(0, 20).forEach(function (e) { L.push("- " + e.date + " " + e.title + "（" + e.level + (e.est ? "，日期推算" : "") + "）"); });
      }
      if (d && d.market) {
        src.push("市場溫度");
        var hot = (d.market.indicators || []).filter(function (x) { return x.status; }).map(function (x) { return x.name + "：" + x.status; });
        var mac = ((d.market.macro && d.market.macro.indicators) || []).filter(function (x) { return x.status; }).map(function (x) { return x.name + "：" + x.status; });
        L.push("\n【市場溫度】過熱指標：" + (hot.join("；") || "無") + (mac.length ? "。總經壓力：" + mac.join("；") : ""));
      }
      if (d && d.alloc_notes) {
        L.push("\n【各部位執行原則（使用者訂的）】");
        Object.keys(d.alloc_notes).forEach(function (k) { L.push("- " + k + "：" + d.alloc_notes[k]); });
      }
      if (S.text) { src.push("我的筆記"); L.push("\n【使用者的筆記與計畫】\n" + S.text.slice(0, 4000)); }
      return { text: L.join("\n"), sources: src };
    });
  }
  var PROMPT = "你是使用者的投資紀律助理。使用者在台灣，投資台股與美股，已經訂好「目標配置」「槓桿減碼計畫」「交屋資金規劃」。"
    + "請只根據下面的資料，把他自己的計畫整理成接下來 1～4 週可以照做的步驟，幫他一步步往目標配置靠近，同時確保 2027 交屋的現金足夠。\n"
    + "規則：\n- 繁體中文、白話、短句，每個步驟要有具體金額（萬元）或比例，並說明對應哪個部位或目標。\n"
    + "- 交屋資金優先：保守情境現金不足時，要排在前面處理（例如超出股票上限的部分分批換成現金，優先從槓桿部位減）。\n"
    + "- 遵守他的原則：槓桿部位不攤平、反彈時分批賣；台股正2 分批買；VWRA 可以一次買；黃金分批。\n"
    + "- 有近期重大事件（FOMC、CPI、財報）時，說明那幾天要不要避開或分批。\n"
    + "- 不預測漲跌、不推薦資料以外的新標的；資料不確定或待確認的地方放進 cautions。\n"
    + "- actions 3～6 項，priority 1＝最優先；headline 一句話講現在最重要的方向。watch 列 2～4 個近期要留意的事。\n\n資料：\n";
  var SCHEMA = { type: "OBJECT", properties: {
    headline: { type: "STRING" },
    actions: { type: "ARRAY", items: { type: "OBJECT", properties: { priority: { type: "INTEGER" }, title: { type: "STRING" }, detail: { type: "STRING" }, why: { type: "STRING" } }, required: ["priority", "title", "detail"] } },
    watch: { type: "ARRAY", items: { type: "STRING" } }, cautions: { type: "ARRAY", items: { type: "STRING" } } }, required: ["headline", "actions"] };
  function gemini(prompt) {
    var model = GH.ls(MODEL) || DEF_MODEL, ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, 150000);
    return fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
      method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json", "x-goog-api-key": GH.ls(KEY) },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.3 } })
    }).catch(function (e) { throw new Error(e && e.name === "AbortError" ? "Gemini 超過 2 分半沒有回應，請稍後再試。" : "連不到 Gemini，請確認網路後再試。"); })
      .then(function (r) {
        clearTimeout(t);
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) {
            var m = (j.error && j.error.message) || "";
            if (r.status === 429) throw new Error("Gemini 免費額度暫時用完，等一下再試。");
            if (r.status === 400 && /API key/i.test(m)) throw new Error("Gemini 金鑰無效，請到持倉頁的截圖辨識「變更金鑰或模型」重新貼上。");
            if (r.status === 404) throw new Error("找不到模型「" + model + "」，請到持倉頁的截圖辨識換一個模型。");
            throw new Error("Gemini 回應錯誤 " + r.status + "：" + m);
          }
          var c = j.candidates && j.candidates[0];
          var txt = c && c.content && (c.content.parts || []).filter(function (p) { return p.text && !p.thought; }).map(function (p) { return p.text; }).join("");
          if (!txt) throw new Error("Gemini 沒有回傳結果" + (c && c.finishReason ? "（" + c.finishReason + "）" : ""));
          return { out: JSON.parse(txt), model: model };
        });
      });
  }
  var tick = null;
  function runAI() {
    if (S.aiBusy) return;
    S.aiBusy = true; S.aiErr = false; S.aiMsg = "整理資料中…"; S.aiT0 = Date.now(); renderAdvice();
    tick = setInterval(renderAdvice, 1000);
    var ctx;
    context().then(function (c) { ctx = c; S.aiMsg = ""; return gemini(PROMPT + c.text); }).then(function (r) {
      S.ai = Object.assign(r.out, { at: new Date().toISOString(), model: r.model, sources: ctx.sources, ctx: ctx.text });
      if (!GH.token()) return "沒有存檔權杖，建議只顯示在這台裝置。";
      return GH.put("notes.json", file(), S.sha, "更新 AI 建議").then(function (sha) { S.sha = sha; return ""; }, function (e) {
        if (!e.conflict) return "建議已產生，但存檔失敗：" + e.message;
        return GH.get("notes.json").then(function (g) {
          S.sha = g.sha; S.text = (g.data && g.data.text) || S.text; S.updated = (g.data && g.data.updated) || S.updated;
          return GH.put("notes.json", file(), S.sha, "更新 AI 建議").then(function (sha) { S.sha = sha; return ""; });
        });
      });
    }).then(function (m) { S.aiMsg = m || ""; }, function (e) { S.aiErr = true; S.aiMsg = e.message; })
      .then(function () { clearInterval(tick); S.aiBusy = false; renderAdvice(); });
  }

  function load() {
    S.loaded = false; S.msg = ""; render();
    GH.get("notes.json").then(function (r) {
      S.text = (r.data && r.data.text) || ""; S.updated = (r.data && r.data.updated) || ""; S.ai = (r.data && r.data.ai) || null; S.sha = r.sha;
      S.loaded = true; render();
    }, function (e) { S.msg = e.message; render(); });
  }

  var started = false;
  function start() {
    if (!started) {
      started = true;
      el().addEventListener("click", function (e) {
        if (e.target.closest("#nt-save")) save();
        if (e.target.closest("#nt-undo")) { draft(null); S.msg = ""; S.err = false; renderNotes(); }
        if (e.target.closest("#adv-run")) runAI();
        if (e.target.closest("#adv-ctx")) { S.showCtx = !S.showCtx; renderAdvice(); }
        if (e.target.closest("#adv-keyok")) { var k = document.getElementById("adv-key").value.trim(); if (k) { GH.ls(KEY, k); renderAdvice(); } }
        if (e.target.id === "adv-house") GH.ls(HOUSE_OK, e.target.checked ? null : "0");
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
    if (!dirty() && !S.aiBusy) load();   // 每次切回來重新抓，看得到別的裝置的修改；正在打字就不打斷
  }
  window.Notes = { start: start };
})();
