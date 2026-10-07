/* 上傳券商截圖 → Gemini（免費 API）辨識 → 和帳上持倉比對 → 變動放進「新增／修改持倉」表格讓使用者檢查、修改後再存。
   Gemini API 金鑰只存在這台裝置的瀏覽器（localStorage），直接從瀏覽器呼叫 Google，不經過其他伺服器。 */
var Scan = (function () {
  var KEY = "cd_gemini_key", MODEL = "cd_gemini_model", DEF_MODEL = "gemini-3.8-flash";
  var S = { files: [], busy: false, msg: "", err: false, acct: "", mode: "auto", setup: false };

  function ls(k, v) { return GH.ls(k, v); }
  function key() { return ls(KEY) || ""; }
  var VER = "1007d";   // 畫面上顯示，用來確認手機載入的是不是新版
  // App 內建瀏覽器（Android WebView 的 UA 會有「; wv)」）通常不支援選檔
  function inApp() { var u = navigator.userAgent || ""; return /; wv\)/.test(u) || /FBAN|FBAV|Instagram|Line\//.test(u); }
  function env() {
    var u = navigator.userAgent || "", m;
    if (inApp()) return "App 內建瀏覽器";
    if ((m = /SamsungBrowser\/(\d+)/.exec(u))) return "三星網際網路 " + m[1];
    if ((m = /Chrome\/(\d+)/.exec(u))) return "Chrome " + m[1];
    if ((m = /Version\/(\d+).*Safari/.exec(u))) return "Safari " + m[1];
    return "瀏覽器";
  }
  function model() { return ls(MODEL) || DEF_MODEL; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function accts() { return window.HoldParse.ACCOUNTS; }

  // ---------- 畫面 ----------
  function ui() {
    var h = '<div class="scan"><h4 style="margin:0 0 6px">📷 上傳截圖辨識</h4>';
    if (!key() || S.setup) return h + setupHtml() + "</div>";
    h += '<p class="note" style="margin:0 0 8px">上傳券商的<b>庫存／持股畫面</b>或<b>成交回報</b>截圖（可一次選多張，同一個帳戶）。AI 讀完會和帳上比對，把「新買、賣出、股數或成本變動」放進下面的表格，<b>檢查、修改後才會存</b>。</p>'
      + '<div class="scanr"><label>帳戶<select id="scacct"><option value="">讓 AI 判斷</option>' + accts().map(function (a) { return '<option value="' + a.id + '"' + (a.id === S.acct ? " selected" : "") + ">" + esc(a.name) + "</option>"; }).join("") + "</select></label>"
      + '<label>截圖內容<select id="scmode">' + [["auto", "讓 AI 判斷"], ["holdings", "庫存／持股畫面"], ["trades", "成交回報／交易明細"]].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === S.mode ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label></div>"
      // 直接用瀏覽器原生的檔案欄位（不隱藏、不疊按鈕），相容性最好；選完自動辨識
      + (inApp() ? '<p class="note" style="margin:8px 0 0;color:var(--hot)">⚠ 你現在是在 App 內建的瀏覽器開這個網頁，通常<b>不能選照片</b>。請按右上角「⋮」選「用 Chrome 開啟」，或直接在 Chrome 打開網址。</p>' : "")
      + '<div class="scup">' + (S.busy ? '<span class="btn dis">辨識中…</span>'
        : '<label class="dim" style="font-size:13px" for="scfile">① 選擇截圖（選完自動辨識）</label><input type="file" id="scfile" class="fin" accept="image/png,image/jpeg,image/webp,image/heic,image/*" multiple>')
      + '<div id="scpaste" class="scpaste" contenteditable="true" inputmode="none" aria-label="貼上截圖">② 或長按這裡 →「貼上」剛複製的截圖</div>'
      + (S.files.length && !S.busy ? '<button class="btn ghost" id="scgo">用剛才的 ' + S.files.length + " 張重新辨識</button>" : "") + "</div>"
      + '<p class="note" id="scmsg" style="margin:8px 0 0' + (S.err ? ";color:var(--hot)" : "") + (S.msg ? "" : ";display:none") + '">' + S.msg + "</p>"
      + '<p class="dim" style="font-size:12px;margin:8px 0 0">使用 ' + esc(model()) + '（Google 免費額度）・' + esc(env()) + '・版本 ' + VER + ' <button class="lk" id="scset">變更金鑰或模型</button></p>';
    return h + "</div>";
  }
  function setupHtml() {
    return '<p class="note" style="margin:0 0 8px">需要一組 <b>Google Gemini API 金鑰</b>（免費）：<br>'
      + '1. 用 Google 帳號開啟 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio 金鑰頁面</a><br>'
      + '2. 按「Create API key」（建立 API 金鑰），複製那串 <code>AIza…</code> 開頭的文字<br>'
      + '3. 貼到下面按「儲存」。金鑰只存在這台裝置的瀏覽器裡。<br>'
      + '<span class="dim">注意：免費版的內容可能被 Google 用來改進產品，也可能有人工審閱。截圖上若有帳號、身分證字號等，建議先裁掉。</span></p>'
      + '<div class="bar"><input id="sckey" type="password" placeholder="AIza…" autocomplete="off" style="flex:1;min-width:0" value=""><button class="btn" id="sckeysave">儲存</button>' + (key() ? '<button class="btn ghost" id="sckeyno">取消</button>' : "") + "</div>"
      + '<div class="bar" style="margin-top:6px"><span class="dim" style="font-size:13px">模型</span><input id="scmodel" value="' + esc(model()) + '" style="flex:1;min-width:0">'
      + (key() ? '<button class="lk" id="sclist">列出可用模型</button><button class="lk danger" id="sckeydel">移除金鑰</button>' : "") + "</div>"
      + (S.msg ? '<p class="note" style="margin:8px 0 0' + (S.err ? ";color:var(--hot)" : "") + '">' + S.msg + "</p>" : "");
  }

  // ---------- 圖片：縮小成 JPEG（長邊最多 3072 像素）再轉 base64 ----------
  function toJpeg(file) {
    return new Promise(function (ok, fail) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 2048, s = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok(c.toDataURL("image/jpeg", 0.85).split(",")[1]);
      };
      img.onerror = function () { URL.revokeObjectURL(url); fail(new Error("讀不到圖片：" + file.name)); };
      img.src = url;
    });
  }

  // ---------- Gemini ----------
  var SCHEMA = {
    type: "OBJECT",
    properties: {
      broker: { type: "STRING", description: "券商或 App 名稱，例如 華南金、第一金、Moomoo、eToro；看不出來填 unknown" },
      market: { type: "STRING", enum: ["TW", "US", "unknown"] },
      kind: { type: "STRING", enum: ["holdings", "trades", "unknown"], description: "holdings＝庫存／持股畫面；trades＝成交回報、交易明細" },
      currency: { type: "STRING", enum: ["TWD", "USD", "unknown"], description: "畫面上金額的幣別" },
      cash: { type: "NUMBER", nullable: true, description: "畫面上的現金／可用餘額，沒有就 null" },
      rows: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            symbol: { type: "STRING", description: "代碼。台股為數字代碼（如 0050、00631L、2330），美股為大寫代碼" },
            name: { type: "STRING" },
            side: { type: "STRING", enum: ["hold", "buy", "sell"], description: "持股畫面填 hold；成交紀錄填 buy 或 sell" },
            qty: { type: "NUMBER", description: "股數（台股 1 張＝1000 股，請換算成股）" },
            avg_cost: { type: "NUMBER", nullable: true, description: "每股平均成本（成本均價），沒有就 null" },
            total_cost: { type: "NUMBER", nullable: true, description: "總投資成本（含手續費），沒有就 null" },
            price: { type: "NUMBER", nullable: true, description: "現價或成交價" },
            trade_date: { type: "STRING", nullable: true, description: "成交日期 YYYY-MM-DD，沒有就 null" },
            confidence: { type: "STRING", enum: ["high", "medium", "low"] },
            note: { type: "STRING", description: "看不清楚或需要使用者確認的地方，沒有就空字串" }
          },
          required: ["symbol", "side", "qty", "confidence"]
        }
      },
      warnings: { type: "ARRAY", items: { type: "STRING" } }
    },
    required: ["kind", "market", "currency", "rows"]
  };

  function prompt(known) {
    return "你是幫台灣投資人登打券商持倉的助手。請只根據圖片內容，讀出所有股票／ETF 的資料，依指定的 JSON 格式回答。\n"
      + "規則：\n"
      + "- 同一次的多張圖片是同一個帳戶（可能是往下捲動的截圖），重複出現的同一檔只列一次。\n"
      + "- 台股代碼是數字（可能帶 L、R、A 等字尾）；畫面只有中文名稱時，用下方的已知對照表找代碼，找不到就填名稱並把 confidence 設為 low。\n"
      + "- 股數一律換成「股」：台股 1 張＝1000 股；零股就是股數。\n"
      + "- 成本：有「成本均價／平均成本」填 avg_cost；有「投資成本／總成本」（含手續費）填 total_cost。不要把市值、現價、損益當成成本。\n"
      + "- 幣別以畫面上的欄位或符號為準（NT$、$、USD、TWD），不要猜。\n"
      + "- 看不清楚的數字不要編造，confidence 設為 low 並在 note 說明。\n"
      + (S.mode === "holdings" ? "- 使用者說這是庫存／持股畫面：kind 填 holdings、side 填 hold。\n" : S.mode === "trades" ? "- 使用者說這是成交回報／交易明細：kind 填 trades、side 填 buy 或 sell。\n" : "")
      + "已知代碼與名稱對照：" + known;
  }

  var TIMEOUT = 120000;   // 2 分鐘還沒回來就放棄，不會一直卡在「辨識中」
  function call(parts, schema, noThink) {
    var url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model()) + ":generateContent";
    var gc = { responseMimeType: "application/json", responseSchema: schema || SCHEMA, temperature: 0 };
    // 讀表格不需要深度思考：請模型少想一點，速度快很多；模型不支援這個設定就自動拿掉重試
    if (!noThink && !ls("cd_gemini_nothink")) gc.thinkingConfig = { thinkingLevel: "low" };
    var ctl = window.AbortController ? new AbortController() : null, timer = ctl && setTimeout(function () { ctl.abort(); }, TIMEOUT);
    return fetch(url, {
      method: "POST", signal: ctl ? ctl.signal : undefined,
      headers: { "Content-Type": "application/json", "x-goog-api-key": key() },
      body: JSON.stringify({ contents: [{ role: "user", parts: parts }], generationConfig: gc })
    }).catch(function (e) {
      if (e && e.name === "AbortError") throw new Error("Gemini 超過 2 分鐘沒有回應（可能免費額度忙碌），請稍後按「重新辨識」，或換成較小的截圖。");
      throw new Error("連不到 Gemini（" + (e && e.message || e) + "），請確認網路後重試。");
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok) return j;
        var m = (j.error && j.error.message) || "";
        if (r.status === 400 && gc.thinkingConfig && /thinking/i.test(m)) { ls("cd_gemini_nothink", "1"); return { retry: true }; }
        if (r.status === 429) throw new Error("Gemini 免費額度暫時用完（每分鐘或每天有上限），等一下再試。");
        if (r.status === 400 && /API key/i.test(m)) throw new Error("Gemini 金鑰無效，請按「變更金鑰或模型」重新貼上。");
        if (r.status === 404) throw new Error("找不到模型「" + model() + "」，請按「變更金鑰或模型」→「列出可用模型」換一個。");
        if (r.status === 403) throw new Error("金鑰沒有權限使用 Gemini API（" + m + "）。");
        throw new Error("Gemini 回應錯誤 " + r.status + "：" + m);
      });
    }).then(function (j) {
      if (j.retry) return call(parts, schema, true);
      var c = j.candidates && j.candidates[0];
      var txt = c && c.content && (c.content.parts || []).filter(function (p) { return p.text && !p.thought; }).map(function (p) { return p.text; }).join("");
      if (!txt) throw new Error("Gemini 沒有回傳結果" + (c && c.finishReason ? "（" + c.finishReason + "）" : "") + "，請換張清楚一點的截圖再試。");
      return JSON.parse(txt);
    });
  }

  function listModels() {
    return fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key() } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.error) throw new Error(j.error.message);
        return (j.models || []).filter(function (m) { return (m.supportedGenerationMethods || []).indexOf("generateContent") >= 0 && /flash|pro/i.test(m.name); })
          .map(function (m) { return m.name.replace(/^models\//, ""); });
      });
  }

  // ---------- 辨識結果 → 表格列 ----------
  function guessAcct(res) {
    var b = String(res.broker || "").toLowerCase(), mk = res.market;
    if (/moomoo|富途/.test(b)) return "moomoo";
    if (/etoro/.test(b)) return "etoro";
    var side = mk === "TW" ? "tw" : mk === "US" ? "us" : (res.currency === "TWD" ? "tw" : res.currency === "USD" ? "us" : "");
    if (/華南/.test(b) && side) return "hn-" + side;
    if (/第一/.test(b) && side) return "fb-" + side;
    return "";
  }
  function normSym(s) {
    s = String(s || "").trim().toUpperCase().replace(/\.(TW|TWO)$/, "").replace(/\s+/g, "");
    return s;
  }
  function r2(x) { return x == null || !isFinite(x) ? null : Math.round(x * 10000) / 10000; }

  function toRows(res, acct) {
    var a = accts().filter(function (x) { return x.id === acct; })[0];
    var rows = [], notes = [], today = new Date().toISOString().slice(0, 10);
    var ccyFlag = a && res.currency !== "unknown" && res.currency !== a.ccy ? "截圖幣別是 " + res.currency + "，但這個帳戶是 " + a.ccy + "，請確認" : "";
    function flags(x) {
      var f = [];
      if (x.confidence !== "high") f.push("AI 不太確定" + (x.note ? "：" + x.note : "") + "，請核對");
      else if (x.note) f.push(x.note);
      if (ccyFlag) f.push(ccyFlag);
      return f;
    }
    var pos = Holdings.positions().filter(function (p) { return p.acct === acct; });
    var cur = {}; pos.forEach(function (p) { cur[p.sym] = p; });
    var kind = S.mode !== "auto" ? S.mode : res.kind;
    var seen = {};
    (res.rows || []).forEach(function (x) {
      var sym = normSym(x.symbol), qty = Number(x.qty);
      if (!sym || !(qty > 0)) { notes.push("略過一列讀不到代碼或股數的資料（" + esc(x.name || x.symbol || "") + "）"); return; }
      var newCost = x.total_cost > 0 ? x.total_cost : x.avg_cost > 0 ? x.avg_cost * qty : null;
      if (kind === "trades" || x.side === "buy" || x.side === "sell") {
        var px = x.price > 0 ? x.price : x.avg_cost > 0 ? x.avg_cost : null;
        rows.push({ kind: x.side === "sell" ? "sell" : "buy", acct: acct, sym: sym, date: x.trade_date || today, qty: qty, px: r2(px), note: "截圖辨識", warn: [], ai: flags(x) });
        return;
      }
      seen[sym] = 1;
      var c = cur[sym], d = qty - (c ? c.qty : 0);
      if (Math.abs(d) < 1e-6) {
        if (c && newCost != null && c.cost && Math.abs(newCost / c.cost - 1) > 0.01)
          notes.push(sym + " 股數相同，但截圖成本（均價 " + r2(newCost / qty) + "）和帳上（" + r2(c.avg) + "）不同，若要修正請到下方帳戶的買賣紀錄編輯");
        return;
      }
      if (d > 0) {
        // 新買：用「新總成本 − 舊總成本」÷ 新增股數 推回這次的買進價
        var bpx = newCost != null ? (newCost - (c ? c.cost : 0)) / d : null, f = flags(x);
        if (!(bpx > 0)) { bpx = x.price > 0 ? x.price : null; f.push("算不出這次的買進成本，先填現價，請改成實際成交價"); }
        rows.push({ kind: "buy", acct: acct, sym: sym, date: today, qty: r2(d), px: r2(bpx), note: "截圖辨識", warn: [], ai: f });
      } else {
        var f2 = flags(x); f2.push("賣出價先填現價，可改成實際成交價（不影響剩下股數的成本）");
        rows.push({ kind: "sell", acct: acct, sym: sym, date: today, qty: r2(-d), px: r2(x.price > 0 ? x.price : c.avg), note: "截圖辨識", warn: [], ai: f2 });
      }
    });
    if (kind !== "trades") {
      var gone = pos.filter(function (p) { return !seen[p.sym]; }).map(function (p) { return p.sym + "（" + p.qty + " 股）"; });
      if (gone.length) notes.push("帳上有、但截圖沒看到：" + gone.join("、") + "。如果是截圖沒拍到就不用管；如果已經賣光，請手動加一列「賣出」");
    }
    if (res.cash != null && res.cash >= 0 && a) rows.push({ kind: "cash", acct: acct, ccy: res.currency !== "unknown" ? res.currency : a.ccy, amount: res.cash, warn: [], ai: ["截圖上的現金餘額，會覆蓋帳上現金；不需要就移除這列"] });
    (res.warnings || []).forEach(function (w) { notes.push("AI 提醒：" + esc(w)); });
    return { rows: rows, notes: notes, kind: kind };
  }

  // 每秒更新「已等幾秒」，讓使用者知道還在跑
  var tk = null;
  function tick(label, hint) {
    var t0 = Date.now(); if (tk) clearInterval(tk);
    tk = setInterval(function () {
      if (!S.busy) { clearInterval(tk); tk = null; return; }
      var el = document.getElementById("scmsg"), s = Math.round((Date.now() - t0) / 1000);
      S.msg = label + "… 已 " + s + " 秒（" + hint + "）";
      if (el) { el.style.display = ""; el.textContent = S.msg; }
    }, 1000);
  }
  function run() {
    if (!S.files.length || S.busy) return;
    S.busy = true; S.err = false; S.msg = "讀取圖片中…"; Holdings.refresh();
    var known = Holdings.knownNames();
    Promise.all(S.files.map(toJpeg)).then(function (imgs) {
      S.msg = "AI 辨識中…"; Holdings.refresh(); tick("AI 辨識中", "通常 10～40 秒，最多等 2 分鐘");
      var parts = imgs.map(function (d) { return { inline_data: { mime_type: "image/jpeg", data: d } }; });
      parts.push({ text: prompt(known) });
      return call(parts);
    }).then(function (res) {
      var acct = S.acct || guessAcct(res);
      if (!acct) throw new Error("看不出是哪個帳戶（AI 讀到：" + (res.broker || "未知") + "、" + res.market + "）。請在「帳戶」選好再按一次「開始辨識」。");
      var out = toRows(res, acct), name = (accts().filter(function (x) { return x.id === acct; })[0] || {}).name;
      S.busy = false; S.files = [];
      var head = "已辨識（" + esc(name) + "，" + (out.kind === "trades" ? "成交紀錄" : "持股畫面") + "，讀到 " + (res.rows || []).length + " 檔）。";
      var body = out.rows.length ? "有 " + out.rows.length + " 筆變動放進下面表格，<b>黃色是 AI 提醒要核對的地方</b>，確認或修改後按「確認存入」。" : "和帳上比對沒有變動。";
      S.msg = head + body + (out.notes.length ? "<br>" + out.notes.join("<br>") : "");
      Holdings.addRows(out.rows);
    }).catch(function (e) { S.busy = false; S.err = true; S.msg = esc(e.message); Holdings.refresh(); });
  }

  // ---------- 念的或打字的內容 → AI 整理成表格 ----------
  function textSchema() {
    return {
      type: "OBJECT",
      properties: {
        rows: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              kind: { type: "STRING", enum: ["buy", "sell", "cash"], description: "buy 買進、sell 賣出、cash 設定帳戶現金餘額" },
              acct: { type: "STRING", enum: accts().map(function (a) { return a.id; }) },
              symbol: { type: "STRING", description: "代碼（cash 留空）。台股用數字代碼，美股用大寫代碼" },
              qty: { type: "NUMBER", nullable: true, description: "股數（1 張＝1000 股）" },
              price: { type: "NUMBER", nullable: true, description: "每股價格（含手續費的成本或賣出實收）" },
              total: { type: "NUMBER", nullable: true, description: "使用者說的總金額／總成本（沒有就 null）" },
              date: { type: "STRING", nullable: true, description: "YYYY-MM-DD，沒說就 null" },
              note: { type: "STRING" },
              currency: { type: "STRING", enum: ["TWD", "USD"], nullable: true, description: "cash 的幣別" },
              amount: { type: "NUMBER", nullable: true, description: "cash 的餘額" },
              confidence: { type: "STRING", enum: ["high", "medium", "low"] },
              warn: { type: "STRING", description: "不確定的地方，沒有就空字串" }
            },
            required: ["kind", "acct", "confidence"]
          }
        }
      },
      required: ["rows"]
    };
  }
  function parseText(text) {
    if (!key()) return Promise.reject(new Error("還沒設定 Gemini 金鑰（在上方「上傳截圖辨識」設定）。"));
    var today = new Date().toISOString().slice(0, 10);
    var p = "把台灣投資人用口語念或打的持倉異動，整理成指定的 JSON。今天是 " + today + "。\n"
      + "帳戶（acct 只能用這些 id）：" + accts().map(function (a) { return a.id + "＝" + a.name + "（" + (a.market === "TW" ? "台股，台幣" : "美股，美元") + "）"; }).join("；") + "。\n"
      + "規則：\n- 「華南」「第一」要配合台股／美股判斷帳戶；只說券商沒說台美股時，看代碼：數字代碼是台股、英文代碼是美股。\n"
      + "- 1 張＝1000 股；「零股」就是股數。\n- 價格是每股；只說總成本／總金額時填 total。\n"
      + "- 「買」「加碼」→ buy；「賣」「出清」「減碼」→ sell。\n"
      + "- 只有使用者明確說「現金／餘額是多少」才輸出 cash（買賣造成的現金增減，網站會自動計算，不要另外輸出 cash）。\n"
      + "- 中文名稱請對照代碼表換成代碼；對不到就保留名稱並把 confidence 設為 low。\n"
      + "- 不確定的地方不要猜，confidence 設 low 並在 warn 說明。\n"
      + "代碼對照：" + Holdings.knownNames() + "\n\n使用者的內容：\n" + text;
    return call([{ text: p }], textSchema()).then(function (res) {
      return (res.rows || []).map(function (x) {
        var a = accts().filter(function (y) { return y.id === x.acct; })[0], f = [];
        if (x.confidence !== "high") f.push("AI 不太確定" + (x.warn ? "：" + x.warn : "") + "，請核對");
        else if (x.warn) f.push(x.warn);
        if (x.kind === "cash") return { kind: "cash", acct: x.acct, ccy: x.currency || (a ? a.ccy : "TWD"), amount: x.amount, warn: [], ai: f };
        var qty = Number(x.qty) || null, px = x.price > 0 ? x.price : (x.total > 0 && qty ? x.total / qty : null);
        return { kind: x.kind, acct: x.acct, sym: normSym(x.symbol), date: x.date || "", qty: qty, px: r2(px), note: x.note || "", warn: [], ai: f };
      });
    });
  }

  // ---------- 事件（由持倉頁轉交） ----------
  function onClick(t) {
    if (t.closest("#scgo")) { run(); return true; }
    if (t.closest("#scset")) { S.setup = true; S.msg = ""; Holdings.refresh(); return true; }
    if (t.closest("#sckeyno")) { S.setup = false; S.msg = ""; Holdings.refresh(); return true; }
    if (t.closest("#sckeydel")) { ls(KEY, null); S.setup = false; S.msg = "已移除 Gemini 金鑰。"; Holdings.refresh(); return true; }
    if (t.closest("#sckeysave")) {
      var k = document.getElementById("sckey").value.trim(), m = document.getElementById("scmodel").value.trim();
      if (m) ls(MODEL, m === DEF_MODEL ? null : m);
      if (k) ls(KEY, k);
      if (!key()) { S.err = true; S.msg = "請貼上金鑰。"; Holdings.refresh(); return true; }
      S.setup = false; S.err = false; S.msg = "已儲存，可以上傳截圖了。"; Holdings.refresh(); return true;
    }
    if (t.closest("#sclist")) {
      var k2 = document.getElementById("sckey").value.trim(); if (k2) ls(KEY, k2);
      S.msg = "查詢中…"; Holdings.refresh();
      listModels().then(function (ms) { S.err = false; S.msg = "可用模型：" + ms.map(esc).join("、") + "（把想用的貼到「模型」欄再按儲存）"; Holdings.refresh(); })
        .catch(function (e) { S.err = true; S.msg = esc(e.message); Holdings.refresh(); });
      return true;
    }
    return false;
  }
  function onPaste(e) {
    if (!e.target.closest || !e.target.closest("#scpaste")) return false;
    e.preventDefault();
    var items = (e.clipboardData && e.clipboardData.items) || [], fs = [];
    for (var i = 0; i < items.length; i++) if (items[i].kind === "file" && /^image\//.test(items[i].type)) fs.push(items[i].getAsFile());
    if (!fs.length) { S.err = true; S.msg = "剪貼簿裡沒有圖片。先在相簿打開截圖 → 分享或「複製」，再回來貼上。"; Holdings.refresh(); return true; }
    if (!S.busy) { S.files = fs; S.msg = ""; run(); }
    return true;
  }
  function onChange(t) {
    if (t.id === "scfile") {   // 選完圖就直接開始辨識（input 與 change 兩個事件都會進來，run() 會擋掉重複）
      var fs = [].slice.call(t.files || []);
      if (fs.length && !S.busy) { S.files = fs; S.msg = ""; run(); }
      return true;
    }
    if (t.id === "scacct") { S.acct = t.value; return true; }
    if (t.id === "scmode") { S.mode = t.value; return true; }
    return false;
  }

  document.addEventListener("paste", onPaste);
  return { ui: ui, onClick: onClick, onChange: onChange, parseText: parseText, hasKey: function () { return !!key(); }, _toRows: toRows, _guessAcct: guessAcct };
})();
