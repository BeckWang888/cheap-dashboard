// 即時報價轉接站（Cloudflare Worker）：網頁不能直接向 Yahoo／證交所要報價（瀏覽器的跨網域限制），由這裡代抓。
// GET /quotes?s=NVDA,SOXL,0050,00631L,TWD=X
//   數字開頭＝台股：先問 Yahoo 奇摩股市（即時、上市上櫃都有），抓不到的問證交所，再不行問 Yahoo Finance（延遲約 20 分鐘）
//   TXF＝台指期近月：Yahoo 奇摩的 WTX&（含夜盤），抓不到再問期交所
//   （證交所、期交所常對 Cloudflare 回 520，所以只當備援）
//   其他（美股、倫敦 .L、匯率 TWD=X）：Yahoo spark 批次
// 回傳 {at, q: {代碼: {price, prev, chg, date, time, src}}}
const ALLOW = ["https://beckwang888.github.io", "http://localhost:8765", "http://127.0.0.1:8765"];
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" };
const isTW = (s) => /^\d/.test(s);

function cors(req) {
  const o = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOW.includes(o) ? o : ALLOW[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
}

// 台灣時間的日期與時間
function twTime(sec) {
  const d = new Date(sec * 1000 + 8 * 3600 * 1000).toISOString();
  return [d.slice(0, 10), d.slice(11, 16)];
}

async function yahoo(symbols) {
  const out = {};
  for (let i = 0; i < symbols.length; i += 20) {
    const part = symbols.slice(i, i + 20);
    const url = "https://query1.finance.yahoo.com/v8/finance/spark?range=1d&interval=5m&symbols=" + part.map(encodeURIComponent).join(",");
    try {
      const r = await fetch(url, { headers: UA });
      if (!r.ok) continue;
      const j = await r.json();
      for (const [sym, v] of Object.entries(j)) {
        const close = (v.close || []).filter((x) => x != null);
        const price = v.fulldayPrice ?? close[close.length - 1];
        const prev = v.previousClose ?? v.chartPreviousClose;
        if (!(price > 0)) continue;   // 還沒成交的商品 Yahoo 會給 0
        const ts = v.timestamp ? v.timestamp[v.timestamp.length - 1] : v.end;
        const [date, time] = ts ? twTime(ts) : ["", ""];
        out[sym] = { price, prev: prev ?? null, chg: prev ? price / prev - 1 : null, date, time, src: "yahoo" };
      }
    } catch (e) { /* 這一批抓不到就跳過，網頁會沿用排程的價格 */ }
  }
  return out;
}

async function twse(ids) {
  const out = {};
  if (!ids.length) return out;
  const ch = ids.flatMap((id) => [`tse_${id}.tw`, `otc_${id}.tw`]).join("|");
  try {
    const r = await fetch("https://mis.twse.com.tw/stock/api/getStockInfo.jsp?json=1&delay=0&ex_ch=" + encodeURIComponent(ch), { headers: UA });
    if (!r.ok) return out;
    const j = await r.json();
    for (const m of j.msgArray || []) {
      const id = m.c, prev = parseFloat(m.y);
      let price = parseFloat(m.z);   // 最近成交價；這 5 秒內沒成交時是 "-"，改用最佳買價
      if (!(price > 0)) price = parseFloat((m.b || "").split("_")[0]);
      if (!(price > 0) || !id) continue;
      const d = m.d || "";
      out[id] = { price, prev: prev > 0 ? prev : null, chg: prev > 0 ? price / prev - 1 : null,
                  date: d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : "", time: (m.t || "").slice(0, 5), src: "twse" };
    }
  } catch (e) { /* 證交所擋掉或維護中：改由 Yahoo 補 */ }
  return out;
}

// 台指期近月（期交所 MIS）：08:45～15:00 用日盤，其餘時間用夜盤（15:00～隔天 05:00；收盤後仍顯示夜盤最後價）
async function taifexSession(mt) {
  const body = JSON.stringify({ MarketType: mt, SymbolType: "F", KindID: "1", CID: "TXF", ExpireMonth: "", RowSize: "全部", PageNo: "", SortColumn: "", AscDesc: "A" });
  const r = await fetch("https://mis.taifex.com.tw/futures/api/getQuoteList", { method: "POST", body, headers: { ...UA, "Content-Type": "application/json" } });
  if (!r.ok) { TXF_ERR = "HTTP " + r.status; return null; }
  const rows = ((await r.json()).RtData || {}).QuoteList || [];
  const spot = rows.find((x) => /^TXF-[SP]$/.test(x.SymbolID));
  const near = rows.find((x) => /^TXF[A-Z]\d-[FM]$/.test(x.SymbolID));   // 第一個就是近月
  if (!near) return null;
  const price = parseFloat(near.CLastPrice), ref = parseFloat(near.CRefPrice), t = near.CTime || "";
  return { price: price > 0 ? price : null, prev: ref > 0 ? ref : null, chg: price > 0 && ref > 0 ? price / ref - 1 : null,
           time: t ? t.slice(0, 2) + ":" + t.slice(2, 4) : "", name: near.DispCName, spot: spot && parseFloat(spot.CLastPrice) || null };
}
async function taifex() {
  try {
    const now = new Date(Date.now() + 8 * 3600 * 1000), hm = now.getUTCHours() * 100 + now.getUTCMinutes();
    const dayFirst = hm >= 845 && hm < 1500;
    const [day, night] = await Promise.all([taifexSession("0"), taifexSession("1")]);
    const pick = dayFirst ? (day && day.price ? [day, "日盤"] : [night, "夜盤"]) : (night && night.price ? [night, "夜盤"] : [day, "日盤"]);
    if (!pick[0] || !pick[0].price) return null;
    const open = dayFirst ? hm < 1345 : hm >= 1500 || hm < 500;
    return { ...pick[0], session: pick[1], open, spot: day && day.spot, date: now.toISOString().slice(0, 10), src: "taifex" };
  } catch (e) { TXF_ERR = String(e && e.message || e); return null; }
}
let TXF_ERR = "";

// Yahoo 奇摩股市（tw.stock.yahoo.com）：台股、台指期即時，延遲 0；代碼用 .TW，上櫃會自動對到 .TWO
async function yahooTW(symbols) {
  const out = {};
  for (let i = 0; i < symbols.length; i += 30) {
    const part = symbols.slice(i, i + 30);
    try {
      const r = await fetch("https://tw.stock.yahoo.com/_td-stock/api/resource/StockServices.stockList;symbols=" + encodeURIComponent(part.join(",")), { headers: UA });
      if (!r.ok) continue;
      for (const x of await r.json()) {
        const price = parseFloat(x.price && x.price.raw), prev = parseFloat(x.regularMarketPreviousClose && x.regularMarketPreviousClose.raw);
        if (!(price > 0)) continue;
        const ts = Date.parse(x.regularMarketTime || "");
        const [date, time] = ts ? twTime(ts / 1000) : ["", ""];
        const key = x.symbol === "WTX&" ? "WTX&" : x.symbol.replace(/\.TWO?$/, "");
        out[key] = { price, prev: prev > 0 ? prev : null, chg: prev > 0 ? price / prev - 1 : null, date, time, src: "yahootw" };
      }
    } catch (e) { /* 這批抓不到就交給備援 */ }
  }
  return out;
}

async function quotes(list) {
  const fut = list.includes("TXF");
  list = list.filter((s) => s !== "TXF");
  const tw = list.filter(isTW), other = list.filter((s) => !isTW(s));
  // 期交所、證交所在同時很多連線時常回 520：先各自單獨抓（失敗再試一次），最後才同時問 Yahoo
  const [y, b] = await Promise.all([yahooTW(tw.map((s) => s + ".TW").concat(fut ? ["WTX&", "^TWII"] : [])), yahoo(other)]);
  const q = { ...b };
  for (const s of tw) if (y[s]) q[s] = y[s];
  if (fut) {
    const w = y["WTX&"], now = new Date(Date.now() + 8 * 3600 * 1000), hm = now.getUTCHours() * 100 + now.getUTCMinutes();
    const dayFirst = hm >= 845 && hm < 1500;
    if (w) q.TXF = { ...w, session: dayFirst ? "日盤" : "夜盤", open: dayFirst ? hm < 1345 : hm >= 1500 || hm < 500, name: "台指期近一", spot: y["^TWII"] ? y["^TWII"].price : null, src: "yahootw" };
    else { const f = await taifex(); if (f) q.TXF = f; else q._txf_err = TXF_ERR || "no data"; }
  }
  let miss = tw.filter((s) => !q[s]);
  if (miss.length) { const a = await twse(miss); for (const s of miss) if (a[s]) q[s] = a[s]; }
  miss = tw.filter((s) => !q[s]);
  if (miss.length) {
    const y = await yahoo(miss.flatMap((s) => [s + ".TW", s + ".TWO"]));
    for (const s of miss) { const v = y[s + ".TW"] || y[s + ".TWO"]; if (v) q[s] = v; }
  }
  return q;
}

export default {
  async fetch(req, env, ctx) {
    const h = cors(req);
    if (req.method === "OPTIONS") return new Response(null, { headers: h });
    const url = new URL(req.url);
    if (url.pathname === "/debug") {   // 除錯：看證交所、期交所從 Cloudflare 連得到嗎
      const out = {};
      for (const [k, u, init] of [
        ["yahootw", "https://tw.stock.yahoo.com/_td-stock/api/resource/StockServices.stockList;symbols=WTX%26%2C0050.TW", { headers: UA }],
        ["twse", "https://mis.twse.com.tw/stock/api/getStockInfo.jsp?json=1&delay=0&ex_ch=tse_0050.tw", { headers: UA }],
        ["taifex", "https://mis.taifex.com.tw/futures/api/getQuoteList", { method: "POST", headers: { ...UA, "Content-Type": "application/json" },
          body: JSON.stringify({ MarketType: "1", SymbolType: "F", KindID: "1", CID: "TXF", ExpireMonth: "", RowSize: "全部", PageNo: "", SortColumn: "", AscDesc: "A" }) }]]) {
        try { const r = await fetch(u, init); out[k] = r.status + " " + (await r.text()).slice(0, 300); } catch (e) { out[k] = "ERR " + e.message; }
      }
      return new Response(JSON.stringify(out, null, 1), { headers: { ...h, "Content-Type": "application/json" } });
    }
    if (url.pathname !== "/quotes") return new Response("ok", { headers: h });
    const list = [...new Set((url.searchParams.get("s") || "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9.=^-]{1,15}$/.test(s)))].slice(0, 150);
    // 同一組代碼 10 秒內共用結果，避免連按時重複去抓
    const key = new Request("https://cache.local/quotes?s=" + list.sort().join(","));
    const cache = caches.default;
    let res = await cache.match(key);
    if (!res) {
      const body = JSON.stringify({ at: new Date().toISOString(), q: await quotes(list) });
      res = new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=10" } });
      ctx.waitUntil(cache.put(key, res.clone()));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(h)) out.headers.set(k, v);
    out.headers.set("Cache-Control", "no-store");
    return out;
  },
};
