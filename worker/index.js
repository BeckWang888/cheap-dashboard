// 即時報價轉接站（Cloudflare Worker）：網頁不能直接向 Yahoo／證交所要報價（瀏覽器的跨網域限制），由這裡代抓。
// GET /quotes?s=NVDA,SOXL,0050,00631L,TWD=X
//   數字開頭＝台股：先問證交所即時報價（上市 tse／上櫃 otc 都試），沒有成交價的再問 Yahoo（.TW／.TWO，約延遲 20 分鐘）
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
        if (price == null) continue;
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

async function quotes(list) {
  const tw = list.filter(isTW), other = list.filter((s) => !isTW(s));
  const [a, b] = await Promise.all([twse(tw), yahoo(other)]);
  const q = { ...b, ...a };
  const miss = tw.filter((s) => !q[s]);
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
