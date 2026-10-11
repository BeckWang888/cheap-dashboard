/* 目標配置：把每檔持股自動歸到七個部位，跟目標比例比較，算出還差多少。
 * 分類只看觀察清單的「類型」與「主題」，新增持股不用另外設定。瀏覽器與 Node（測試）共用。 */
(function (root) {
  "use strict";

  var BUCKETS = [
    { id: "tw2x", name: "台股正2", role: "進攻主力（台股大盤 2 倍）", color: "var(--c1)" },
    { id: "theme", name: "主題 ETF", role: "看好的產業（1 倍）", color: "var(--c3)" },
    { id: "risky", name: "高風險衛星", role: "其他槓桿 ETF、個股", color: "var(--c2)" },
    { id: "global", name: "全球 ETF", role: "防守：全球分散", color: "var(--c5)" },
    { id: "index", name: "1 倍大盤", role: "防守：台股／美股大盤", color: "var(--c7)" },
    { id: "gold", name: "黃金", role: "保險", color: "var(--c4)" },
    { id: "cash", name: "現金", role: "生活費與大跌加碼", color: "var(--cnull)" }
  ];
  // 2026-10-11 定案的配置（設定頁可改，存在 config.json 的 alloc_targets）
  var DEFAULT_TARGETS = { tw2x: 28, theme: 15, risky: 7, global: 18, index: 5, gold: 12, cash: 15 };
  var DEFAULT_BAND = 5;   // 偏離目標幾個百分點以內算「在範圍內」

  /** m：觀察清單的 {type, theme}；sym：代碼。 */
  function bucketOf(m, sym) {
    var theme = (m && m.theme) || "", type = (m && m.type) || "";
    if (sym === "AU9901" || theme === "黃金") return "gold";
    if (type === "leveraged") return theme === "台股大盤" ? "tw2x" : "risky";
    if (type === "stock") return "risky";
    if (theme === "全球") return "global";
    if (/大盤/.test(theme)) return "index";
    return "theme";
  }

  function targetsOf(t) {
    var out = {}, src = t && typeof t === "object" ? t : DEFAULT_TARGETS;
    BUCKETS.forEach(function (b) { var v = Number(src[b.id]); out[b.id] = isFinite(v) && v >= 0 ? v : (DEFAULT_TARGETS[b.id] || 0); });
    return out;
  }

  /** items：[{sym, mv（台幣）, m}]；cash：台幣現金；回傳各部位現況與距目標的差距。 */
  function compute(items, cash, targets, band) {
    var t = targetsOf(targets), bd = band > 0 ? band : DEFAULT_BAND;
    var rows = {}, total = cash || 0;
    BUCKETS.forEach(function (b) { rows[b.id] = { id: b.id, name: b.name, role: b.role, color: b.color, mv: 0, syms: [] }; });
    items.forEach(function (s) {
      if (s.mv == null || !isFinite(s.mv)) return;
      var r = rows[bucketOf(s.m, s.sym)];
      r.mv += s.mv; r.syms.push({ sym: s.sym, mv: s.mv });
      total += s.mv;
    });
    rows.cash.mv = cash || 0;
    var list = BUCKETS.map(function (b) {
      var r = rows[b.id];
      r.pct = total ? r.mv / total * 100 : 0;
      r.target = t[b.id];
      r.diffPct = r.target - r.pct;                // 正數：還差多少（要加碼）；負數：超出多少
      r.diffAmt = r.target / 100 * total - r.mv;
      r.status = Math.abs(r.diffPct) <= bd ? "ok" : r.diffPct > 0 ? "under" : "over";
      r.syms.sort(function (a, b2) { return b2.mv - a.mv; });
      r.syms.forEach(function (x) { x.pct = total ? x.mv / total * 100 : 0; });
      return r;
    });
    var tsum = BUCKETS.reduce(function (a, b) { return a + t[b.id]; }, 0);
    // 要搬動的資金＝超出部位的總和（也等於不足部位的總和）
    var move = list.reduce(function (a, r) { return a + Math.max(0, -r.diffAmt); }, 0);
    return { rows: list, total: total, band: bd, targetSum: tsum, move: move,
             movePct: total ? move / total * 100 : 0 };
  }

  var api = { BUCKETS: BUCKETS, DEFAULT_TARGETS: DEFAULT_TARGETS, DEFAULT_BAND: DEFAULT_BAND,
              bucketOf: bucketOf, targetsOf: targetsOf, compute: compute };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Alloc = api;
})(this);
