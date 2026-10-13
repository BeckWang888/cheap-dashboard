/* 「交屋」分頁：2027 年左營預售屋交屋的資金規劃。
 * 資料（房產、貸款、太太的現金…）比持股敏感，用使用者的密碼在瀏覽器內加密後才存進 repo 的 housing.enc.json
 * （PBKDF2-SHA256 → AES-GCM）。repo 公開也只看得到亂碼；密碼只存在使用者自己的裝置。
 * 股票市值、我的現金都直接用 dashboard 的持倉（Holdings.snapshot），買賣後自動跟著變。單位：萬元。 */
(function () {
  "use strict";
  var FILE = "housing.enc.json", PWKEY = "cd_house_pw", ITER = 310000;
  var S = { file: null, sha: null, data: null, snap: null, msg: "", err: false, busy: false, edit: false, needPw: false };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function el() { return document.getElementById("housing"); }
  function w(x, d) { return x == null || !isFinite(x) ? "—" : Number(x).toLocaleString("en-US", { maximumFractionDigits: d == null ? 0 : d }); }
  function sgn(x) { return x == null || !isFinite(x) ? "—" : (x >= 0 ? "+" : "−") + w(Math.abs(x)); }

  // ---------- 加密 ----------
  var b64 = { enc: function (u) { var s = ""; u = new Uint8Array(u); for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); },
              dec: function (s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; } };
  function key(pw, salt, iter) {
    return crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]).then(function (k) {
      return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt, iterations: iter, hash: "SHA-256" }, k, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }
  function encrypt(obj, pw) {
    var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    return key(pw, salt, ITER).then(function (k) {
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, k, new TextEncoder().encode(JSON.stringify(obj)));
    }).then(function (ct) { return { v: 1, kdf: "PBKDF2-SHA256", iter: ITER, salt: b64.enc(salt), iv: b64.enc(iv), ct: b64.enc(ct) }; });
  }
  function decrypt(f, pw) {
    return key(pw, b64.dec(f.salt), f.iter || ITER).then(function (k) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: b64.dec(f.iv) }, k, b64.dec(f.ct));
    }).then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); });
  }

  // ---------- 計算（萬元）----------
  function annuity(P, rate, years) { var i = rate / 12, n = years * 12; return i ? P * i / (1 - Math.pow(1 + i, -n)) : P / n; }
  /** f：銀行估價／合約價；r2：第二戶貸款成數上限。回傳交屋要補的現金（含雜費），以及我、太太各自的部分。 */
  function need(d, f, r2) {
    var ps = d.presale, mine = 0, wife = 0, loans = [];
    ps.units.forEach(function (u) {
      var ratio = u.first ? u.ratio : Math.min(u.ratio, r2);
      var loan = u.price * f * ratio, fee = u.price * ps.fee_pct;
      var c = u.price * (1 - ps.paid_pct) - loan + fee;
      loans.push(loan);
      if (u.owner === "太太") wife += c; else mine += c;
    });
    return { total: mine + wife, mine: mine, wife: wife, loans: loans };
  }
  function avail(d, snap, dropAll, dropLev) {
    var s = snap.stock / 1e4, lev = snap.lev / 1e4;
    var stock = (s - lev) * (1 - dropAll) + lev * (1 - (dropLev == null ? dropAll : dropLev));
    return { stock: stock, cash: myCash(d, snap), wife: d.people.wife_cash, total: stock + myCash(d, snap) + d.people.wife_cash };
  }
  function myCash(d, snap) { return d.people.my_cash_source === "manual" ? d.people.my_cash_manual : snap.cash / 1e4; }
  function base(d) { var b = d.basis; return { cons: need(d, b.cons_f, b.cons_r2), aggr: need(d, 1, 0.7) }; }

  // ---------- 畫面 ----------
  function render() {
    if (S.needPw || !S.data) return renderLock();
    var d = S.data, sn = S.snap;
    if (!sn) { el().innerHTML = '<div class="card"><p class="note">載入持倉中…</p></div>'; return; }
    var a = avail(d, sn, 0), nb = base(d), stock = a.stock;
    var capC = a.total - nb.cons.total, capA = a.total - nb.aggr.total;
    var cashAll = a.cash + a.wife;
    var h = '<div class="card hs-top"><h3>🏠 交屋資金規劃 <span class="dim" style="font-weight:400;font-size:13px">資料日期 ' + esc(d.asof) + '・單位：萬元</span></h3>';
    // 結論
    var gapC = stock - capC, gapA = stock - capA;
    h += '<div class="hs-concl">'
      + '<p><b>結論：</b>' + (gapC > 0
        ? '股票 ' + w(stock) + '，<b class="hs-bad">超過保守上限 ' + w(gapC) + '</b>（壞情況交屋要 ' + w(nb.cons.total) + '，現金只有 ' + w(cashAll) + '）。'
        : '股票 ' + w(stock) + '，在保守上限內，壞情況也能用現金付清交屋款。')
      + (gapA > 0 ? '也超過積極上限 ' + w(gapA) + '。' : '在積極上限內（還有 ' + w(-gapA) + ' 空間）。') + '</p>'
      + '<p class="dim">保守＝銀行估價 ' + Math.round(d.basis.cons_f * 100) + '%、第二戶 ' + Math.round(d.basis.cons_r2 * 10) + ' 成；積極＝估價等於合約價、第二戶 7 成。不足的部分要在交屋前從股票換成現金。</p></div>';
    h += '<div class="hs-kpi">'
      + kpi("股票（dashboard）", w(stock), sn.lev ? "其中槓桿 " + w(sn.lev / 1e4) : "")
      + kpi("我的現金", w(a.cash), d.people.my_cash_source === "manual" ? "手動輸入" : "dashboard 帳上")
      + kpi("太太的現金", w(a.wife), "")
      + kpi("可動用合計", w(a.total), "不含生活準備金") + "</div></div>";

    // 1. 資金分桶
    h += '<div class="card"><h3>① 資金分桶</h3><table class="ht hs-tb"><thead><tr><th></th><th>保守</th><th>積極</th></tr></thead><tbody>'
      + tr("生活準備金", d.people.reserve_low + "～" + d.people.reserve_high + "（不動）", "同左")
      + tr("交屋專款", w(nb.cons.total), w(nb.aggr.total))
      + tr("　其中我出", w(nb.cons.mine), w(nb.aggr.mine))
      + tr("　其中太太出", w(nb.cons.wife) + (nb.cons.wife > a.wife ? ' <span class="hs-bad">（超過她的 ' + w(a.wife) + '）</span>' : ""), w(nb.aggr.wife) + (nb.aggr.wife > a.wife ? ' <span class="hs-bad">（超過她的 ' + w(a.wife) + '）</span>' : ""))
      + tr("股票持有上限", w(capC), w(capA))
      + tr("目前股票 " + w(stock), gapTxt(gapC), gapTxt(gapA))
      + tr("要從股票換成現金", w(Math.max(0, nb.cons.total - cashAll)), w(Math.max(0, nb.aggr.total - cashAll)))
      + tr("額外緩衝（不計入）", esc(d.buffer_note || ""), "同左")
      + "</tbody></table></div>";

    // 2. 壓力測試
    var cols = [["股價不變", 0, 0], ["全部跌 30%", 0.3, 0.3], ["1 倍跌 30%＋槓桿跌 50%", 0.3, 0.5]];
    var rows = [["估價 10 成・第二戶 7 成", 1, 0.7], ["估價 8 折・7 成", 0.8, 0.7], ["估價 8 折・6 成", 0.8, 0.6], ["估價 7 折・7 成", 0.7, 0.7], ["估價 7 折・6 成", 0.7, 0.6]];
    h += '<div class="card"><h3>② 壓力測試</h3><p class="note">格子＝可動用資金扣掉交屋要付的錢，剩下多少（負數＝不夠）。括號＝要賣掉幾 % 的股票才付得出來。</p>'
      + '<div class="hs-scroll"><table class="ht hs-tb"><thead><tr><th>銀行估價／成數</th><th>交屋要付</th>' + cols.map(function (c) { return "<th>" + c[0] + "</th>"; }).join("") + "</tr></thead><tbody>";
    rows.forEach(function (r) {
      var n = need(d, r[1], r[2]).total;
      h += "<tr><td>" + r[0] + "</td><td>" + w(n) + "</td>" + cols.map(function (c) {
        var v = avail(d, sn, c[1], c[2]), left = v.total - n, sell = Math.max(0, n - v.cash - v.wife);
        return '<td class="' + (left < 0 ? "hs-bad" : left < d.people.reserve_high ? "hs-warn" : "hs-ok") + '">' + sgn(left)
          + '<br><span class="dim">(' + (v.stock > 0 ? Math.round(Math.min(1, sell / v.stock) * 100) : 0) + "%)</span></td>";
      }).join("") + "</tr>";
    });
    h += "</tbody></table></div></div>";

    // 3. 月付
    var L = d.loan, nA = need(d, 1, 0.7), my = 0, wifeNew = 0;
    d.presale.units.forEach(function (u, i) { if (u.owner === "太太") wifeNew += nA.loans[i]; else my += nA.loans[i]; });
    var first = d.presale.units.filter(function (u) { return u.first; })[0], fi = d.presale.units.indexOf(first);
    var pmy = annuity(my, L.rate, L.years), pw = annuity(wifeNew, L.rate, L.years), pex = L.wife_existing_payment || annuity(L.wife_existing, L.rate, L.years);
    var fl = nA.loans[fi], gNow = fl * L.rate / 12, gAfter = annuity(fl, L.rate, L.years - L.grace_years);
    h += '<div class="card"><h3>③ 每月房貸（好情況、利率 ' + (L.rate * 100).toFixed(2) + "%、" + L.years + ' 年本息均攤）</h3><table class="ht hs-tb"><tbody>'
      + tr("我（新貸 " + w(my) + "）", w(pmy, 1) + " / 月", "")
      + tr("太太新貸 " + w(wifeNew), w(pw, 1) + " / 月", "")
      + tr("太太現有房貸 " + w(L.wife_existing), w(pex, 1) + " / 月" + (L.wife_existing_payment ? "" : '<span class="dim">（估）</span>'), "")
      + tr("<b>全家合計</b>", "<b>" + w(pmy + pw + pex, 1) + " / 月</b>", "")
      + tr("我的第一戶寬限期 " + L.grace_years + " 年", w(annuity(fl, L.rate, L.years), 1) + " → " + w(gNow, 1) + "，" + L.grace_years + " 年後 " + w(gAfter, 1), "")
      + tr("每月收入（我）", w(incomeNow(d), 1) + '<span class="dim">（YouTube ' + d.income.youtube + "＋租金 " + d.income.rent + "）</span>", "")
      + "</tbody></table><p class=\"note\" style=\"margin-top:8px\">太太的獨立收入、現有房貸實際月付：待確認。</p></div>";

    // 4. 提醒
    h += '<div class="card"><h3>④ 提醒條件</h3>' + checks(d, sn, nb).map(function (c) {
      return '<div class="hs-ck ' + c[0] + '"><b>' + ({ ok: "✅", warn: "⚠️", bad: "🔴", todo: "📝" }[c[0]]) + " " + c[1] + "</b><span>" + c[2] + "</span></div>";
    }).join("") + "</div>";

    // 5. 資料
    h += '<div class="card"><h3>⑤ 房產、稅務與已定方向</h3>' + list("房產", d.properties) + list("左營預售屋", d.presale_notes) + list("稅務規則", d.tax) + list("已定方向", d.plans)
      + list("待確認", d.pending) + "</div>";

    // 編輯
    h += editCard(d);
    if (S.msg) h += '<p class="note ' + (S.err ? "hs-bad" : "") + '">' + esc(S.msg) + "</p>";
    h += '<p class="note">稅率與貸款條件是估算，重大決定前請跟地政士、會計師、銀行確認。這裡只呈現數字與情境，不是買賣建議。</p>';
    el().innerHTML = h;
  }
  function kpi(t, v, s) { return '<div><span>' + esc(t) + "</span><b>" + v + "</b>" + (s ? '<em>' + esc(s) + "</em>" : "") + "</div>"; }
  function tr(a, b, c) { return "<tr><td>" + a + "</td><td>" + b + "</td>" + (c === "" ? "" : "<td>" + c + "</td>") + "</tr>"; }
  function gapTxt(g) { return g > 0 ? '<span class="hs-bad">超出 ' + w(g) + "</span>" : '<span class="hs-ok">還有 ' + w(-g) + "</span>"; }
  function list(t, xs) { return xs && xs.length ? "<h4>" + esc(t) + "</h4><ul class=\"hs-ul\">" + xs.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : ""; }
  function incomeNow(d) { return (Number(d.income.youtube) || 0) + (Number(d.income.rent) || 0); }
  function monthsTo(ds) { var t = new Date(ds); if (isNaN(t)) return null; var n = new Date(); return (t.getFullYear() - n.getFullYear()) * 12 + t.getMonth() - n.getMonth(); }

  function checks(d, sn, nb) {
    var out = [], t = d.thresholds, a = avail(d, sn, 0), stock = a.stock, cashAll = a.cash + a.wife;
    // 銀行估價
    if (d.appraisal && d.appraisal.pct) {
      var n = need(d, d.appraisal.pct / 100, d.appraisal.r2 || 0.7).total;
      out.push([cashAll >= n ? "ok" : a.total >= n ? "warn" : "bad", "銀行估價 " + d.appraisal.pct + "%", "交屋要付 " + w(n) + "，現金 " + w(cashAll) + (cashAll >= n ? "，已足夠" : "，還差 " + w(n - cashAll) + "（要從股票換）")]);
    } else out.push(["todo", "銀行估價：待確認", "交屋前約半年找銀行預估價、談核貸，結果填進「編輯資料」就會重算"]);
    // 股價下跌
    var drop = t.stock_base ? 1 - stock / t.stock_base : 0;
    out.push([drop >= t.stock_drop_pct / 100 ? "bad" : drop >= t.stock_drop_pct / 200 ? "warn" : "ok", "股票跌幅 " + (drop > 0 ? "−" : "+") + Math.abs(drop * 100).toFixed(1) + "%",
      "以 " + esc(t.base_date) + " 的 " + w(t.stock_base) + " 為基準，跌超過 " + t.stock_drop_pct + "% 時檢查交屋現金"]);
    // 股票超過保守上限
    var capC = a.total - nb.cons.total;
    out.push([stock > capC ? "warn" : "ok", stock > capC ? "股票超過保守上限 " + w(stock - capC) : "股票在保守上限內", "保守上限 " + w(capC) + "；超過的部分要在交屋前分批換成現金"]);
    // 收入
    var inc = incomeNow(d);
    out.push([inc < t.income_floor ? "warn" : "ok", "每月收入 " + w(inc, 1), "底線 " + t.income_floor + "（YouTube＋租金）" + (inc < t.income_floor ? "，已低於底線" : "")]);
    // 交屋時間
    var m = d.presale.delivery_date ? monthsTo(d.presale.delivery_date) : null;
    if (m == null) out.push(["todo", "交屋月份：待確認", "知道月份後填進「編輯資料」，距離 6 個月時會提醒檢查現金"]);
    else out.push([m <= 6 ? (cashAll >= nb.cons.total ? "ok" : "bad") : "ok", "距離交屋 " + m + " 個月",
      m <= 6 ? (cashAll >= nb.cons.total ? "現金已備足保守情況的交屋款" : "現金還差 " + w(nb.cons.total - cashAll) + "，要開始把股票換成現金") : "還不到 6 個月的檢查點"]);
    return out;
  }

  // ---------- 編輯 ----------
  var FIELDS = [
    ["people.wife_cash", "太太的現金"], ["people.my_cash_manual", "我的現金（手動，選手動時才用）"],
    ["people.reserve_low", "生活準備金（低）"], ["people.reserve_high", "生活準備金（高）"],
    ["income.youtube", "YouTube 月收"], ["income.rent", "租金月收"],
    ["presale.units.0.price", "預售屋 1 總價"], ["presale.units.1.price", "預售屋 2 總價"], ["presale.units.2.price", "預售屋 3 總價"],
    ["presale.fee_pct", "交屋雜費比例（0.02＝2%）"], ["presale.delivery_date", "交屋月份（例 2027-06）"],
    ["basis.cons_f", "保守情境估價（0.8＝8 折）"], ["basis.cons_r2", "保守情境第二戶成數（0.7）"],
    ["loan.rate", "房貸利率（0.023＝2.3%）"], ["loan.wife_existing", "太太現有房貸餘額"], ["loan.wife_existing_payment", "太太現有房貸月付（不知道留空）"],
    ["appraisal.pct", "銀行估價結果 %（例 85，沒有留空）"], ["appraisal.r2", "銀行核准的第二戶成數（例 0.7）"],
    ["thresholds.stock_drop_pct", "股票跌幅提醒 %"], ["thresholds.stock_base", "股票基準（萬）"], ["thresholds.income_floor", "月收入底線"]
  ];
  var LISTS = [["milestones", "重要日期（一行一個：YYYY-MM-DD 事件，會出現在事件表）"], ["properties", "房產"], ["presale_notes", "左營預售屋"], ["tax", "稅務規則"], ["plans", "已定方向"], ["pending", "待確認"]];
  function get(o, p) { return p.split(".").reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function set(o, p, v) { var ks = p.split("."), last = ks.pop(); ks.reduce(function (a, k) { return a[k] = a[k] || {}; }, o)[last] = v; }
  function editCard(d) {
    var can = !!GH.token();
    if (!S.edit) return '<div class="bar"><button class="btn ghost" id="hs-edit">✏️ 編輯資料</button><button class="btn ghost" id="hs-lock">🔒 鎖定</button></div>';
    var h = '<div class="card"><h3>編輯資料</h3><label class="tg"><input type="checkbox" id="hs-src"' + (d.people.my_cash_source === "manual" ? "" : " checked") + '><span><b>我的現金用 dashboard 帳上現金</b><span class="dim">取消勾選就用下面手動輸入的數字</span></span></label><div class="sgrid">'
      + FIELDS.map(function (f) { var v = get(d, f[0]); return "<label>" + esc(f[1]) + '<input data-f="' + f[0] + '" value="' + esc(v == null ? "" : v) + '"></label>'; }).join("") + "</div>"
      + LISTS.map(function (l) { return '<label class="stn">' + esc(l[1]) + '（一行一項）<textarea data-l="' + l[0] + '" rows="5">' + esc((d[l[0]] || []).join("\n")) + "</textarea></label>"; }).join("")
      + '<label class="stn">額外緩衝說明<textarea data-f="buffer_note" rows="2">' + esc(d.buffer_note || "") + "</textarea></label>"
      + '<div class="sgrid" style="margin-top:10px"><label>改密碼（不改留空）<input id="hs-newpw" type="password" autocomplete="new-password"></label></div>'
      + '<div class="bar" style="margin-top:10px">' + (can ? '<button class="btn" id="hs-save"' + (S.busy ? " disabled" : "") + ">" + (S.busy ? "加密儲存中…" : "加密儲存") + "</button>" : '<span class="note">要先在「持倉」分頁的「存檔設定」貼上權杖，才能儲存。</span>')
      + '<button class="btn ghost" id="hs-cancel">取消</button></div></div>';
    return h;
  }
  function save() {
    var d = JSON.parse(JSON.stringify(S.data));
    el().querySelectorAll("[data-f]").forEach(function (i) {
      var p = i.dataset.f, v = i.value.trim(), old = get(S.data, p);
      if (p === "presale.delivery_date" || p === "buffer_note") { set(d, p, v); return; }
      if (v === "") { set(d, p, null); return; }
      var n = Number(v); if (!isFinite(n)) throw new Error("「" + p + "」要填數字");
      set(d, p, typeof old === "string" ? v : n);
    });
    el().querySelectorAll("[data-l]").forEach(function (t) { d[t.dataset.l] = t.value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean); });
    d.people.my_cash_source = document.getElementById("hs-src").checked ? "dashboard" : "manual";
    d.updated = new Date().toISOString();
    var npw = document.getElementById("hs-newpw").value, pw = npw || GH.ls(PWKEY) || S.pw;
    if (npw && npw.length < 8) throw new Error("新密碼至少 8 個字");
    S.busy = true; S.msg = ""; render();
    return encrypt(d, pw).then(function (f) { return GH.put(FILE, f, S.sha, "更新交屋資料（加密）"); }).then(function (sha) {
      S.sha = sha; S.data = d; S.pw = pw; if (GH.ls(PWKEY)) GH.ls(PWKEY, pw); S.busy = false; S.edit = false; S.err = false;
      S.msg = "已加密儲存" + (npw ? "，密碼已更換（其他裝置要用新密碼解鎖）" : "") + "。"; render();
    });
  }

  // ---------- 解鎖 ----------
  function renderLock() {
    if (!S.file) { el().innerHTML = '<div class="card"><p class="note">' + esc(S.msg || "載入中…") + "</p></div>"; return; }
    el().innerHTML = '<div class="card hs-top"><h3>🏠 交屋資金規劃 🔒</h3><p class="note">這頁的資料有加密，請輸入密碼解鎖。</p>'
      + '<div class="sgrid"><label>密碼<input id="hs-pw" type="password" autocomplete="current-password"></label></div>'
      + '<label class="tg"><input type="checkbox" id="hs-remember" checked><span><b>在這台裝置記住密碼</b><span class="dim">只存在這台裝置的瀏覽器；共用電腦請取消</span></span></label>'
      + '<div class="bar"><button class="btn" id="hs-unlock">解鎖</button></div>'
      + (S.msg ? '<p class="note ' + (S.err ? "hs-bad" : "") + '">' + esc(S.msg) + "</p>" : "") + "</div>";
  }
  function unlock(pw, remember) {
    S.msg = "解密中…"; S.err = false;
    return decrypt(S.file, pw).then(function (d) {
      S.data = d; S.pw = pw; S.needPw = false; S.msg = "";
      if (remember) GH.ls(PWKEY, pw);
      render(); return Holdings.snapshot().then(function (sn) { S.snap = sn; render(); });
    }, function () { S.needPw = true; S.err = true; S.msg = "密碼不對，請再試一次。"; GH.ls(PWKEY, null); render(); });
  }
  function load() {
    S.file = null; S.data = null; S.msg = ""; render();
    GH.get(FILE).then(function (r) {
      S.file = r.data; S.sha = r.sha;
      var pw = GH.ls(PWKEY);
      if (pw) return unlock(pw, true);
      S.needPw = true; render();
    }, function (e) { S.msg = e.message; render(); });
  }

  var started = false;
  function start() {
    if (!started) {
      started = true;
      el().addEventListener("click", function (e) {
        var t = e.target;
        if (t.closest("#hs-unlock")) unlock(document.getElementById("hs-pw").value, document.getElementById("hs-remember").checked);
        else if (t.closest("#hs-edit")) { S.edit = true; S.msg = ""; render(); }
        else if (t.closest("#hs-cancel")) { S.edit = false; render(); }
        else if (t.closest("#hs-lock")) { GH.ls(PWKEY, null); S.data = null; S.pw = null; S.needPw = true; S.msg = "已鎖定，這台裝置不再記住密碼。"; S.err = false; render(); }
        else if (t.closest("#hs-save")) {
          try { save().catch(function (er) { S.busy = false; S.err = true; S.msg = er.message; if (er.conflict) load(); else render(); }); }
          catch (er) { S.err = true; S.msg = er.message; render(); }
        }
      });
      el().addEventListener("keydown", function (e) { if (e.target.id === "hs-pw" && e.key === "Enter") document.getElementById("hs-unlock").click(); });
      load(); return;
    }
    if (S.data && !S.edit) Holdings.snapshot().then(function (sn) { S.snap = sn; render(); });
  }

  /** 給「建議操作」的 AI 用：已解鎖時回傳重點數字（萬元），沒解鎖回傳 null。 */
  function summary() {
    if (!S.data && GH.ls(PWKEY) && !S.file) return GH.get(FILE).then(function (r) { S.file = r.data; S.sha = r.sha; return decrypt(r.data, GH.ls(PWKEY)); }).then(function (d) { S.data = d; return summary(); }, function () { return null; });
    if (!S.data && S.file && GH.ls(PWKEY)) return decrypt(S.file, GH.ls(PWKEY)).then(function (d) { S.data = d; return summary(); }, function () { return null; });
    if (!S.data) return Promise.resolve(null);
    return Holdings.snapshot().then(function (sn) {
      var d = S.data, a = avail(d, sn, 0), nb = base(d);
      return { asof: d.asof, delivery: d.presale.delivery_date || "2027（月份待確認）", stock: Math.round(a.stock), lev: Math.round(sn.lev / 1e4), my_cash: Math.round(a.cash), wife_cash: a.wife,
        need_conservative: Math.round(nb.cons.total), need_aggressive: Math.round(nb.aggr.total),
        stock_cap_conservative: Math.round(a.total - nb.cons.total), stock_cap_aggressive: Math.round(a.total - nb.aggr.total),
        cash_short_conservative: Math.round(Math.max(0, nb.cons.total - a.cash - a.wife)), monthly_income: incomeNow(d), plans: d.plans, pending: d.pending };
    });
  }

  /** 給事件表用：已解鎖（或這台裝置記住密碼）時回傳房產相關的日期，否則回傳空陣列。 */
  function events() {
    var ready = S.data ? Promise.resolve(S.data)
      : !GH.ls(PWKEY) ? Promise.resolve(null)
      : (S.file ? Promise.resolve(S.file) : GH.get(FILE).then(function (r) { S.file = r.data; S.sha = r.sha; return r.data; }))
          .then(function (f) { return decrypt(f, GH.ls(PWKEY)); }).then(function (d) { S.data = d; return d; }, function () { return null; });
    return ready.then(function (d) {
      if (!d) return [];
      var out = (d.milestones || []).map(function (line) {
        var m = /^(\d{4}-\d{2}-\d{2})\s+(.+)$/.exec(line); return m ? { date: m[1], title: m[2], kind: "HOUSE", level: "高" } : null;
      }).filter(Boolean);
      var dd = d.presale.delivery_date;
      if (dd) {
        var t = new Date(dd.length === 7 ? dd + "-01" : dd);
        if (!isNaN(t)) {
          var iso = function (x) { return x.toISOString().slice(0, 10); };
          out.push({ date: iso(t), title: "左營預售屋交屋（付尾款）", kind: "HOUSE", level: "高" });
          var c = new Date(t); c.setMonth(c.getMonth() - 6);
          out.push({ date: iso(c), title: "距交屋 6 個月：找銀行估價、確認現金是否備足", kind: "HOUSE", level: "高" });
        }
      }
      return out;
    });
  }

  window.Housing = { start: start, summary: summary, events: events, _calc: { need: need, annuity: annuity } };
})();
