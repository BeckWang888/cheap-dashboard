// 目標配置測試：node --test tests/
const test = require("node:test");
const assert = require("node:assert");
const A = require("../site/alloc.js");

test("分類：依觀察清單的類型與主題自動歸類", () => {
  const b = (type, theme, sym = "X") => A.bucketOf({ type, theme }, sym);
  assert.strictEqual(b("leveraged", "台股大盤", "00631L"), "tw2x");
  assert.strictEqual(b("leveraged", "半導體", "SOXL"), "risky");
  assert.strictEqual(b("leveraged", "記憶體", "SNXX"), "risky");
  assert.strictEqual(b("leveraged", "全球", "WLDU"), "risky");      // 2 倍全球也算高風險
  assert.strictEqual(b("leveraged", "黃金", "00708L"), "gold");     // 黃金正2 仍算黃金
  assert.strictEqual(b("etf", "黃金", "AU9901"), "gold");
  assert.strictEqual(b("stock", "AI／軟體", "PLTR"), "risky");
  assert.strictEqual(b("etf", "全球", "VWRA.L"), "global");
  assert.strictEqual(b("etf", "台股大盤", "0050"), "index");
  assert.strictEqual(b("etf", "美股大盤", "00662"), "index");
  assert.strictEqual(b("etf", "半導體", "00947"), "theme");
  assert.strictEqual(b("etf", "生技", "IBB"), "theme");
  assert.strictEqual(A.bucketOf(null, "AU9901"), "gold");
});

test("計算：比例、差距金額、要搬動的資金", () => {
  const items = [
    { sym: "00631L", mv: 100, m: { type: "leveraged", theme: "台股大盤" } },
    { sym: "SNXX", mv: 500, m: { type: "leveraged", theme: "記憶體" } },
    { sym: "AU9901", mv: 100, m: { type: "etf", theme: "黃金" } },
    { sym: "BAD", mv: null, m: { type: "etf", theme: "半導體" } },   // 沒有價格的跳過
  ];
  const r = A.compute(items, 300, { tw2x: 30, theme: 0, risky: 10, global: 20, index: 0, gold: 20, cash: 20 }, 5);
  const by = Object.fromEntries(r.rows.map(x => [x.id, x]));
  assert.strictEqual(r.total, 1000);
  assert.strictEqual(by.tw2x.pct, 10);
  assert.strictEqual(by.tw2x.diffAmt, 200);       // 目標 300，現有 100
  assert.strictEqual(by.risky.diffAmt, -400);     // 目標 100，現有 500
  assert.strictEqual(by.risky.status, "over");
  assert.strictEqual(by.global.status, "under");
  assert.strictEqual(by.gold.status, "under");    // 10% vs 目標 20%：差 10 個百分點，超出 ±5 範圍
  assert.strictEqual(r.targetSum, 100);
  assert.strictEqual(r.move, 500);                // 高風險超出 400＋現金超出 100
});

test("目標缺漏時用預設值", () => {
  const t = A.targetsOf({ tw2x: 30 });
  assert.strictEqual(t.tw2x, 30);
  assert.strictEqual(t.gold, A.DEFAULT_TARGETS.gold);
  assert.deepStrictEqual(A.targetsOf(null), A.DEFAULT_TARGETS);
});
