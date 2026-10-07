// 截圖辨識結果 → 變動清單的比對邏輯（不呼叫 Gemini）
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

function load(pos, fetchFn) {
  const g = {
    GH: { ls: (k) => (k === "cd_gemini_key" ? "test-key" : null) },
    window: { HoldParse: { ACCOUNTS: [{ id: "moomoo", name: "Moomoo", market: "US", ccy: "USD" }, { id: "hn-tw", name: "華南金 台股", market: "TW", ccy: "TWD" }] } },
    Holdings: { positions: () => pos, knownNames: () => "00708L=期元大S&P黃金正2" },
    document: { addEventListener() {} }, URL: {}, fetch: fetchFn || (() => {}),
  };
  const src = fs.readFileSync(path.join(__dirname, "../site/scan.js"), "utf8");
  return new Function(...Object.keys(g), src + "\nreturn Scan;")(...Object.values(g));
}
const POS = [
  { acct: "moomoo", sym: "SNXX", qty: 203, cost: 203 * 23.53, avg: 23.53 },
  { acct: "moomoo", sym: "SOXL", qty: 100, cost: 3000, avg: 30 },
  { acct: "moomoo", sym: "TSLA", qty: 10, cost: 2000, avg: 200 },
];

test("持股畫面：加碼、減碼、新標的、沒拍到的", () => {
  const Scan = load(POS);
  const out = Scan._toRows({ kind: "holdings", market: "US", currency: "USD", rows: [
    { symbol: "SNXX", side: "hold", qty: 253, avg_cost: 22, price: 16, confidence: "high", note: "" },
    { symbol: "SOXL", side: "hold", qty: 60, avg_cost: 30, price: 33, confidence: "high", note: "" },
    { symbol: "nvda", side: "hold", qty: 5, avg_cost: 240, price: 239, confidence: "medium", note: "代碼模糊" },
  ] }, "moomoo");
  const by = Object.fromEntries(out.rows.map(r => [r.sym, r]));
  assert.strictEqual(by.SNXX.kind, "buy");
  assert.strictEqual(by.SNXX.qty, 50);
  assert.ok(Math.abs(by.SNXX.px - (253 * 22 - 203 * 23.53) / 50) < 1e-3);
  assert.strictEqual(by.SOXL.kind, "sell");
  assert.strictEqual(by.SOXL.qty, 40);
  assert.strictEqual(by.NVDA.qty, 5);
  assert.ok(by.NVDA.ai.some(x => /不太確定/.test(x)));
  assert.ok(out.notes.some(n => /TSLA/.test(n)), "帳上有但截圖沒有的要提醒，不自動賣出");
  assert.ok(!by.TSLA);
});

test("股數相同不產生變動；幣別不符要提醒", () => {
  const Scan = load(POS);
  const out = Scan._toRows({ kind: "holdings", market: "US", currency: "TWD", rows: [
    { symbol: "TSLA", side: "hold", qty: 10, avg_cost: 200, confidence: "high", note: "" },
    { symbol: "AMD", side: "hold", qty: 1, avg_cost: 100, confidence: "high", note: "" },
  ] }, "moomoo");
  assert.strictEqual(out.rows.length, 1);
  assert.ok(out.rows[0].ai.some(x => /幣別/.test(x)));
});

test("成交紀錄：逐筆照買賣加入", () => {
  const Scan = load(POS);
  const out = Scan._toRows({ kind: "trades", market: "TW", currency: "TWD", rows: [
    { symbol: "0050.TW", side: "buy", qty: 1000, price: 116.4, trade_date: "2026-10-07", confidence: "high", note: "" },
    { symbol: "00631L", side: "sell", qty: 500, price: 120, confidence: "high", note: "" },
  ] }, "hn-tw");
  assert.deepStrictEqual(out.rows.map(r => [r.kind, r.sym, r.qty, r.px]), [["buy", "0050", 1000, 116.4], ["sell", "00631L", 500, 120]]);
});

test("由券商名稱與市場猜帳戶", () => {
  const Scan = load([]);
  assert.strictEqual(Scan._guessAcct({ broker: "華南金證券", market: "TW" }), "hn-tw");
  assert.strictEqual(Scan._guessAcct({ broker: "第一金", market: "unknown", currency: "USD" }), "fb-us");
  assert.strictEqual(Scan._guessAcct({ broker: "moomoo" }), "moomoo");
  assert.strictEqual(Scan._guessAcct({ broker: "unknown", market: "TW" }), "");
});

test("AI 整理文字：總成本換成每股價格、送出時帶少思考設定", async () => {
  let body;
  const reply = { rows: [
    { kind: "buy", acct: "hn-tw", symbol: "00708L", qty: 1000, price: null, total: 70850, date: null, note: "", confidence: "high", warn: "" },
    { kind: "cash", acct: "hn-tw", symbol: "", currency: "TWD", amount: 2000000, confidence: "medium", warn: "金額沒聽清楚" },
  ] };
  const fetchFn = (url, opt) => { body = JSON.parse(opt.body); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }) }); };
  const Scan = load([], fetchFn);
  const rows = await Scan.parseText("華南台股買黃金正二一張總共七萬零八百五十，現金兩百萬");
  assert.strictEqual(body.generationConfig.thinkingConfig.thinkingLevel, "low");
  assert.deepStrictEqual([rows[0].kind, rows[0].acct, rows[0].sym, rows[0].qty, rows[0].px], ["buy", "hn-tw", "00708L", 1000, 70.85]);
  assert.strictEqual(rows[1].kind, "cash");
  assert.ok(rows[1].ai.some(x => /不太確定/.test(x)));
});
