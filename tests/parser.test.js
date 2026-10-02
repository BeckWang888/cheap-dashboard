// 語音解析測試：node --test tests/
const test = require("node:test");
const assert = require("node:assert");
const P = require("../site/parser.js");

const today = new Date(2026, 9, 2); // 2026-10-02
const parse = (s, o) => P.parse(s, Object.assign({ today }, o));

test("使用者的例子：多檔一口氣念完", () => {
  const r = parse("華南台股。0050，2024 年 3 月 5 號買的，3000 股，成本 150。0052 去年 8 月買 2 張成本 210。Moomoo。SNXX 今年 6 月 10 號買 50 股，價格 32.5。");
  assert.deepStrictEqual(r.map(x => [x.acct, x.sym, x.date, x.qty, x.px]), [
    ["hn-tw", "0050", "2024-03-05", 3000, 150],
    ["hn-tw", "0052", "2025-08", 2000, 210],
    ["moomoo", "SNXX", "2026-06-10", 50, 32.5],
  ]);
  assert.ok(r.every(x => x.warn.length === 0));
});

test("中文數字與張", () => {
  const r = parse("第一金台股 0056 二〇二五年一月二十號 三張 成本三十七點五");
  assert.deepStrictEqual([r[0].acct, r[0].date, r[0].qty, r[0].px], ["fb-tw", "2025-01-20", 3000, 37.5]);
});

test("名稱轉代碼，市場由代碼推斷", () => {
  const r = parse("華南 台積電 3月5號 200股 成本 980 特斯拉 9月1號 10股 價格 300");
  assert.deepStrictEqual(r.map(x => [x.acct, x.sym]), [["hn-tw", "2330"], ["hn-us", "TSLA"]]);
});

test("字母分開念的代碼", () => {
  const r = parse("eToro S M C I 7月3號 20股 價位 41");
  assert.deepStrictEqual([r[0].acct, r[0].sym, r[0].qty, r[0].px], ["etoro", "SMCI", 20, 41]);
});

test("成本後面的四位數不是代碼", () => {
  const r = parse("華南台股 2330 2025/5/2 100股 成本 1050");
  assert.strictEqual(r.length, 1);
  assert.deepStrictEqual([r[0].sym, r[0].date, r[0].qty, r[0].px], ["2330", "2025-05-02", 100, 1050]);
});

test("現金與萬", () => {
  const r = parse("Moomoo 美元現金 3200。華南台股現金 50萬");
  assert.deepStrictEqual(r.map(x => [x.type, x.acct, x.ccy, x.amount]), [
    ["cash", "moomoo", "USD", 3200], ["cash", "hn-tw", "", 500000]]);
});

test("缺資料會提醒", () => {
  const r = parse("TSLA 10股");
  assert.deepStrictEqual(r[0].warn, ["沒有帳戶", "沒有價格"]);
});

test("賣出為負數", () => {
  const r = parse("Moomoo AMD 9月30號 賣 5股 價格 160");
  assert.strictEqual(r[0].qty, -5);
});

test("未來月份視為去年", () => {
  assert.strictEqual(parse("Moomoo AMD 12月 5股 價格 100")[0].date, "2025-12");
});

test("語音輸入常見格式：沒有空格、全形標點、三千股", () => {
  const r = parse("華南台股0050，2024年3月5日買三千股，成本150元。0056，2025年7月1日，5張，成本36塊");
  assert.deepStrictEqual(r.map(x => [x.sym, x.date, x.qty, x.px]), [
    ["0050", "2024-03-05", 3000, 150], ["0056", "2025-07-01", 5000, 36]]);
});

test("美股用美元結尾", () => {
  const r = parse("第一金美股 NVDA 2026年1月15號 12股 182.5美元");
  assert.deepStrictEqual([r[0].acct, r[0].px], ["fb-us", 182.5]);
});

test("不念日期也不會提醒；備註", () => {
  const r = parse("華南台股 0050 3000股 成本150 備註長期持有，跌到130再加碼。2330 200股 成本 1050");
  assert.deepStrictEqual(r.map(x => [x.sym, x.date, x.qty, x.px, x.note, x.warn.length]), [
    ["0050", "", 3000, 150, "長期持有,跌到130再加碼", 0], ["2330", "", 200, 1050, "", 0]]);
});

test("AU9901 黃金現貨（英文字母＋數字、念成臺銀金或分開念）", () => {
  const r = parse("第一金台股 AU9901 13 股 成本 236309。臺銀金 2股 成本 4300。AU 9901 1股 價格 4200");
  assert.deepStrictEqual(r.map(x => [x.acct, x.sym, x.qty, x.px]), [
    ["fb-tw", "AU9901", 13, 236309], ["fb-tw", "AU9901", 2, 4300], ["fb-tw", "AU9901", 1, 4200]]);
});
