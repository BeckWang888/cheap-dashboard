/* 語音／文字持倉解析（固定句型版，不需要 AI）
 * 輸入：手機鍵盤語音輸入後的一段文字，例如
 *   「華南台股。0050，2024 年 3 月 5 號買的，3000 股，成本 150。0052 去年 8 月買 2 張成本 210。
 *    Moomoo。SNXX 今年 6 月 10 號買 50 股，價格 32.5。Moomoo 美元現金 3200」
 * 輸出：[{type:"lot", acct, sym, date, qty, px, warn:[]}, {type:"cash", acct, ccy, amount}]
 * 瀏覽器與 Node（測試）共用。 */
(function (root) {
  "use strict";

  var ACCOUNTS = [
    { id: "hn-tw", name: "華南金 台股", broker: "hn", market: "TW", ccy: "TWD" },
    { id: "hn-us", name: "華南金 美股", broker: "hn", market: "US", ccy: "USD" },
    { id: "fb-tw", name: "第一金 台股", broker: "fb", market: "TW", ccy: "TWD" },
    { id: "fb-us", name: "第一金 美股", broker: "fb", market: "US", ccy: "USD" },
    { id: "moomoo", name: "Moomoo", broker: "moomoo", market: "US", ccy: "USD" },
    { id: "etoro", name: "eToro", broker: "etoro", market: "US", ccy: "USD" }
  ];

  // 常見名稱 → 代碼（長的放前面，避免「超微」先吃掉「美超微」）
  var NAMES = [
    ["元大台灣50", "0050"], ["元大台灣五十", "0050"], ["台灣50", "0050"], ["台灣五十", "0050"],
    ["富邦台50", "006208"], ["富邦科技", "0052"], ["元大高股息", "0056"], ["國泰永續高股息", "00878"],
    ["群益台灣精選高息", "00919"], ["復華台灣科技優息", "00929"], ["元大美債20年", "00679B"],
    ["臺銀金", "AU9901"], ["台銀金", "AU9901"], ["臺銀黃金", "AU9901"], ["台銀黃金", "AU9901"], ["黃金現貨", "AU9901"],
    ["台積電", "2330"], ["鴻海", "2317"], ["聯發科", "2454"], ["廣達", "2382"], ["緯創", "3231"],
    ["美超微", "SMCI"], ["超微", "AMD"], ["特斯拉", "TSLA"], ["輝達", "NVDA"], ["蘋果", "AAPL"],
    ["微軟", "MSFT"], ["谷歌", "GOOGL"], ["亞馬遜", "AMZN"], ["博通", "AVGO"], ["美光", "MU"]
  ];

  var CN = { "零": 0, "〇": 0, "一": 1, "二": 2, "兩": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
  var CN_UNIT = { "十": 10, "百": 100, "千": 1000 };

  function cnInt(s) {
    // 「三千二百五十」→3250；「十」→10；「二〇二四」→2024（逐位）
    if (/^[零〇一二兩三四五六七八九]+$/.test(s) && s.length > 1) {
      return Number(s.split("").map(function (c) { return CN[c]; }).join(""));
    }
    var total = 0, section = 0, num = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c in CN) num = CN[c];
      else if (c in CN_UNIT) { section += (num || 1) * CN_UNIT[c]; num = 0; }
      else if (c === "萬") { total += (section + num) * 10000; section = 0; num = 0; }
    }
    return total + section + num;
  }

  function normalize(text) {
    var t = String(text || "");
    t = t.replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    t = t.replace(/　/g, " ");
    t = t.replace(/第一金|第一證券|第一/g, "＠FB＠").replace(/華南金|華南永昌|華南/g, "＠HN＠");
    t = t.replace(/富途牛牛|富途|牛牛|moomoo|moo moo/gi, "＠MM＠").replace(/e\s*toro|易投/gi, "＠ET＠");
    NAMES.forEach(function (p) { t = t.split(p[0]).join(" " + p[1] + " "); });
    // 中文數字（含「點」小數）→ 阿拉伯數字
    t = t.replace(/[零〇一二兩三四五六七八九十百千萬]+(?:點[零〇一二三四五六七八九]+)?/g, function (m) {
      if (!/[零〇一二兩三四五六七八九十]/.test(m)) return m;  // 單獨的「萬」「千」留給下面處理
      var parts = m.split("點");
      var n = cnInt(parts[0]);
      if (parts[1]) n = Number(n + "." + parts[1].split("").map(function (c) { return CN[c]; }).join(""));
      return String(n);
    });
    // 千分位逗號（3,000）才去掉；「0050,2024」這種是語音斷句，不能黏起來
    t = t.replace(/(?<![\d.])\d{1,3}(?:,\d{3})+(?![\d,])/g, function (m) { return m.replace(/,/g, ""); });
    t = t.replace(/(\d+(?:\.\d+)?)\s*萬/g, function (m, n) { return String(Math.round(Number(n) * 10000)); });
    t = t.replace(/(\d+(?:\.\d+)?)\s*千(?!股)/g, function (m, n) { return String(Math.round(Number(n) * 1000)); });
    t = t.replace(/(\d+(?:\.\d+)?)\s*千股/g, function (m, n) { return Math.round(Number(n) * 1000) + "股"; });
    // 語音常把代碼念成分開的字母：「S N X X」→「SNXX」
    t = t.replace(/\b([A-Za-z])(?:\s+(?=[A-Za-z]\b))/g, "$1");
    t = t.replace(/\b(AU)\s+(\d{4})\b/gi, "$1$2");   // 「AU 9901」→「AU9901」
    return t.replace(/[a-z]+/g, function (w) { return w.toUpperCase(); });
  }

  var PRICE_KW = "成本|價格|價位|點位|買在|均價|單價|買價|成交價|價錢|@";
  var TOKEN = new RegExp(
    "(＠HN＠|＠FB＠|＠MM＠|＠ET＠)" +                                  // 1 券商
    "|(台股|美股)" +                                                  // 2 市場
    "|(現金)" +                                                       // 3 現金
    "|(?<![A-Z\\d.\\/\\-]|(?:" + PRICE_KW + "|現金|美元|美金|台幣)\\s*(?:是|為|:|大概|約)?\\s*)" +
    "([A-Z]{1,3}\\d{3,6}|\\d{4,6}[A-Z]?)(?![\\d.\\/\\-]|\\s*(?:年|月|日|號|股|張|元|塊|美|%|萬|千|塊錢))" + // 4 台股代碼
    "|\\b([A-Z]{1,5}(?:\\.[A-Z])?)\\b",                                // 5 美股代碼
    "g");
  var BROKER = { "＠HN＠": "hn", "＠FB＠": "fb", "＠MM＠": "moomoo", "＠ET＠": "etoro" };
  var NOT_TICKER = { "ETF": 1, "TWD": 1, "NTD": 1, "OK": 1, "AI": 1 };

  function acctFor(broker, market, symIsTW) {
    if (broker === "moomoo" || broker === "etoro") return broker;
    var m = market || (symIsTW ? "TW" : "US");
    if (!broker) return "";
    return broker + "-" + m.toLowerCase();
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function parseDate(seg, today) {
    var y = today.getFullYear(), m, d, r;
    var rel = { "今年": y, "去年": y - 1, "前年": y - 2 };
    if ((r = seg.match(/(\d{4})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})\s*[日號]?/))) return [r[1] + "-" + pad(+r[2]) + "-" + pad(+r[3]), r[0]];
    if ((r = seg.match(/(\d{4})\s*年\s*(\d{1,2})\s*月份?/))) return [r[1] + "-" + pad(+r[2]), r[0]];
    if ((r = seg.match(/(今年|去年|前年)\s*(\d{1,2})\s*月份?\s*(?:(\d{1,2})\s*[日號])?/))) {
      return [rel[r[1]] + "-" + pad(+r[2]) + (r[3] ? "-" + pad(+r[3]) : ""), r[0]];
    }
    if ((r = seg.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日號]/))) {
      m = +r[1]; d = +r[2];
      var yy = new Date(y, m - 1, d) > today ? y - 1 : y;   // 未來的日期 → 去年
      return [yy + "-" + pad(m) + "-" + pad(d), r[0]];
    }
    if ((r = seg.match(/(\d{1,2})\s*月份?/))) {
      m = +r[1];
      return [(m > today.getMonth() + 1 ? y - 1 : y) + "-" + pad(m), r[0]];
    }
    return ["", ""];
  }

  function parseLot(seg, isTW, today) {
    var warn = [], qty = null, px = null, note = "", r;
    // 備註：「備註」後面到句號為止都算備註，先拿掉，免得裡面的數字被誤認成股數或價格
    if ((r = seg.match(/備註\s*[:：]?\s*([^。；;\n]*)/))) { note = r[1].replace(/[，,\s]+$/, "").trim(); seg = seg.replace(r[0], " "); }
    var dt = parseDate(seg, today);
    var rest = dt[1] ? seg.replace(dt[1], " ") : seg;
    if ((r = rest.match(/(\d+(?:\.\d+)?)\s*張/))) { qty = Math.round(Number(r[1]) * 1000); rest = rest.replace(r[0], " "); }
    else if ((r = rest.match(/(\d+(?:\.\d+)?)\s*股/))) { qty = Number(r[1]); rest = rest.replace(r[0], " "); }
    if ((r = rest.match(new RegExp("(?:" + PRICE_KW + ")\\s*(?:是|為|:|大概|約)?\\s*(\\d+(?:\\.\\d+)?)")))) { px = Number(r[1]); }
    else if ((r = rest.match(/(\d+(?:\.\d+)?)\s*(?:元|塊|美元|美金)/))) { px = Number(r[1]); }
    if (/賣/.test(seg) && qty) qty = -qty;
    if (qty == null) warn.push("沒有股數");
    if (px == null) warn.push("沒有價格");
    return { date: dt[0], qty: qty, px: px, note: note, warn: warn };
  }

  function parse(text, opts) {
    opts = opts || {};
    var today = opts.today || new Date();
    var t = normalize(text);
    var toks = [], m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(t))) {
      if (m[5] && NOT_TICKER[m[5]]) continue;
      toks.push({ i: m.index, end: m.index + m[0].length, m: m });
    }
    var out = [], broker = opts.broker || "", market = "", cashCcy = "";
    toks.forEach(function (k, n) {
      var next = n + 1 < toks.length ? toks[n + 1].i : t.length;
      var seg = t.slice(k.end, next);
      var g = k.m;
      if (g[1]) { broker = BROKER[g[1]]; market = ""; return; }
      if (g[2]) { market = g[2] === "台股" ? "TW" : "US"; return; }
      if (g[3]) {
        var before = t.slice(Math.max(0, k.i - 6), k.i);
        var ccy = /美元|美金|USD/.test(before + seg) ? "USD" : /台幣|新台幣/.test(before + seg) ? "TWD" : "";
        var a = seg.match(/(\d+(?:\.\d+)?)/);
        var acct = acctFor(broker, market || (ccy === "TWD" ? "TW" : ccy === "USD" ? "US" : ""), false);
        out.push({ type: "cash", acct: acct, ccy: ccy, amount: a ? Number(a[1]) : null,
          warn: (a ? [] : ["沒有金額"]).concat(acct ? [] : ["沒有帳戶"]) });
        return;
      }
      var sym = g[4] || g[5];
      var isTW = !!g[4];
      var lot = parseLot(seg, isTW, today);
      lot.type = "lot";
      lot.sym = sym;
      lot.acct = acctFor(broker, market, isTW);
      if (!lot.acct) lot.warn.unshift("沒有帳戶");
      out.push(lot);
    });
    return out;
  }

  var api = { parse: parse, normalize: normalize, ACCOUNTS: ACCOUNTS, cnInt: cnInt };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HoldParse = api;
})(this);
