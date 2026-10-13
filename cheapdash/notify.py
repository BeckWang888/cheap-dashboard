"""通知：比對上一次的狀態找出新事件，套用冷卻時間，彙整成一則 ntfy 推播。"""
import json
import os
import ssl
import urllib.request
from datetime import date

HYSTERESIS = 10  # 和回測相同：分數要先跌回門檻以下 10 分，才會再通知一次「跨上」


def find_events(items: list, prev: dict, cfg: dict) -> tuple[list, dict]:
    """items：本次各標的的 current（預設百分位基準）。回傳 (事件清單, 新狀態)。"""
    on = cfg["notify"]
    ths = cfg["thresholds"]
    new_items, events = {}, []
    for it in items:
        sym, c = it["symbol"], it["current"]
        p = prev.get("items", {}).get(sym, {})
        score = c["score"]
        armed = dict(p.get("armed", {}))
        cur = {"state": c["state"], "heat": c["heat"],
               "trough": "已確認" if c["trough"] else "形成中" if c["trough_forming"] else ""}
        if score is not None:
            for th in ths:
                k = str(th)
                was_armed = armed.get(k, score < th)  # 第一次看到這檔：目前在門檻下才算 armed
                if was_armed and score >= th:
                    if on["cross"]:
                        events.append((sym, f"cross{th}", f"跨上 {th}"))
                    armed[k] = False
                elif score < th - HYSTERESIS:
                    armed[k] = True
                else:
                    armed[k] = was_armed
        cur["armed"] = armed
        cur["sweet"] = bool(c.get("sweet"))
        if on.get("sweet", True) and cur["sweet"] and not p.get("sweet"):
            events.append((sym, "sweet", f"進入甜蜜點（{c.get('sweet_why', '')}）"))
        if on["confirm"] and c["state"] == "轉折確認" and p.get("state") != "轉折確認":
            events.append((sym, "confirm", "轉折確認"))
        if on["trough"] and cur["trough"] and cur["trough"] != p.get("trough"):
            kind = ("甜蜜點" if c.get("sweet") else "強勢谷底・站上年線" if c.get("above200")
                    else "跌破年線，弱勢谷底小心")
            events.append((sym, "trough" + cur["trough"], f"月線 MACD 谷底（{cur['trough']}，{kind}）"))
        rank = {"": 0, "過熱": 1, "嚴重過熱": 2}
        if on["heat"] and rank[c["heat"]] > rank[p.get("heat", "")]:
            events.append((sym, "heat" + c["heat"], f"{c['heat']}（追高提醒）"))
        new_items[sym] = cur
    return events, {"items": new_items, "sent": dict(prev.get("sent", {}))}


def group_events(groups: dict, prev: dict, cfg: dict) -> list:
    """groups：{群組: [在便宜區的代碼]}。數量第一次達到門檻時提醒。"""
    out = []
    if not cfg["notify"]["group"]:
        return out
    n_min = cfg["group_alert_min"]
    for g, syms in groups.items():
        was = prev.get("groups", {}).get(g, 0)
        if len(syms) >= n_min > was:
            out.append((g, "group", f"{g} 有 {len(syms)} 檔同時在便宜區（{'、'.join(syms)}），留意總曝險"))
    return out


MARKET_NAMES = {"US": "美股", "TW": "台股"}


def market_events(summary: dict, prev: dict, cfg: dict) -> list:
    """市場溫度：一個市場有 2 個以上指標過熱、且上次還沒有時提醒（預設關閉）。"""
    if not cfg["notify"].get("market"):
        return []
    out = []
    for mkt, s in summary.items():
        was = prev.get("market", {}).get(mkt, 0)
        if s["hot"] >= 2 > was:
            out.append((MARKET_NAMES.get(mkt, mkt) + "市場", "market", f"{s['hot']}/{s['total']} 個指標過熱，先別追高"))
    return out


def apply_cooldown(events: list, state: dict, cfg: dict, today: date) -> list:
    keep = []
    for sym, key, text in events:
        k = f"{sym}|{key}"
        last = state["sent"].get(k)
        if last and (today - date.fromisoformat(last)).days < cfg["cooldown_days"]:
            continue
        state["sent"][k] = today.isoformat()
        keep.append((sym, key, text))
    return keep


def compose(events: list, scores: dict) -> tuple[str, str, int]:
    """彙整成一則：依分數由高到低排序，同一檔的事件合併成一行。"""
    by_sym = {}
    for sym, key, text in events:
        by_sym.setdefault(sym, []).append(text)
    order = sorted(by_sym, key=lambda s: -(scores.get(s) if scores.get(s) is not None else -999))
    lines = []
    for s in order:
        sc = scores.get(s)
        head = f"{s} {sc:.0f} 分" if sc is not None else s
        lines.append(f"{head}｜{'、'.join(by_sym[s])}")
    urgent = any(k in ("cross80", "confirm", "sweet", "plan") for _, k, _ in events)
    title = f"便宜度提醒：{len(order)} 項"
    return title, "\n".join(lines), 4 if urgent else 3


def send(title: str, message: str, priority: int = 3, click: str = "") -> bool:
    """發到 ntfy。沒設定 NTFY_TOPIC 時只印出來（本機測試用）。"""
    topic = (os.environ.get("NTFY_TOPIC") or "").strip()
    if not topic:
        print(f"[未設定 NTFY_TOPIC，只印出]\n{title}\n{message}")
        return False
    server = os.environ.get("NTFY_SERVER", "https://ntfy.sh")
    body = {"topic": topic, "title": title, "message": message, "priority": priority, "tags": ["chart_with_downwards_trend"]}
    if click:
        body["click"] = click
    import certifi
    req = urllib.request.Request(server, data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, context=ssl.create_default_context(cafile=certifi.where()), timeout=30) as r:
            return r.status == 200
    except Exception as e:  # 推播失敗不影響資料更新
        detail = e.read().decode("utf-8", "replace") if hasattr(e, "read") else ""
        print(f"[警告] 推播失敗：{e} {detail}")
        return False


# ---------------- 計畫提醒（config.json 的 plan_alerts）：依使用者自己的操作計畫，時機到了推播 ----------------
def avg_costs(holdings: dict) -> dict:
    """各代碼跨帳戶的平均成本（原幣別、平均成本法，和持倉頁相同）。代碼不含 .TW。"""
    by = {}
    for l in sorted(holdings.get("lots", []), key=lambda x: str(x.get("date") or "")):
        k = (l.get("acct"), l.get("sym"))
        q, c = by.get(k, (0.0, 0.0))
        qty, px = float(l.get("qty") or 0), float(l.get("px") or 0)
        if qty >= 0:
            q, c = q + qty, c + qty * px
        else:
            avg = c / q if q else 0
            q, c = q + qty, c - avg * -qty
        by[k] = (q, c)
    tot = {}
    for (_, sym), (q, c) in by.items():
        if q > 1e-9:
            tq, tc = tot.get(sym, (0.0, 0.0))
            tot[sym] = (tq + q, tc + c)
    return {s: c / q for s, (q, c) in tot.items() if q}


def plan_events(rows: dict, costs: dict, prev: dict, rules: dict, today: date) -> tuple[list, dict]:
    """rows：{代碼: {"price", "r5"（近 5 日報酬）, "n_sig"}}；costs：平均成本；prev：上次的 plan 狀態。
    回傳 (事件, 新的 plan 狀態)。每種提醒各自有冷卻，日期提醒只發一次。"""
    st = {"sig": dict(prev.get("sig", {})), "be": dict(prev.get("be", {})), "sent": dict(prev.get("sent", {})),
          "dates": list(prev.get("dates", []))}
    out = []

    def cool(key, days):
        last = st["sent"].get(key)
        if last and (today - date.fromisoformat(last)).days < days:
            return False
        st["sent"][key] = today.isoformat()
        return True

    r = rules.get("signal") or {}
    for s in r.get("syms", []):
        x = rows.get(s)
        if not x or x.get("n_sig") is None:
            continue
        on = x["n_sig"] >= r.get("min_sig", 2)
        # 第一次看到只記錄、不通知；之後從「沒亮夠」變成「亮夠」才通知
        if on and st["sig"].get(s) is False and cool(s + "|plan_sig", r.get("cooldown", 7)):
            out.append((s, "plan", f"【計畫】亮 {x['n_sig']} 顆轉折訊號：{r.get('msg', '')}"))
        st["sig"][s] = on
    r = rules.get("rebound") or {}
    for s in r.get("syms", []):
        x = rows.get(s)
        if x and x.get("r5") is not None and x["r5"] >= r.get("pct", 0.08) and cool(s + "|plan_rb", r.get("cooldown", 7)):
            out.append((s, "plan", f"【計畫】近 5 日漲 {x['r5'] * 100:.0f}%：{r.get('msg', '')}"))
    r = rules.get("breakeven") or {}
    for s in r.get("syms", []):
        x, c = rows.get(s), costs.get(s)
        if not x or not c or x.get("price") is None:
            continue
        up = x["price"] >= c
        if up and st["be"].get(s) is False:   # 之前在成本下、這次回到成本以上才通知
            out.append((s, "plan", f"【計畫】回到成本 {c:.2f}（現價 {x['price']:.2f}）：{r.get('msg', '')}"))
        st["be"][s] = up
    for d in rules.get("dates", []):
        if d.get("date") and today.isoformat() >= d["date"] and d["date"] not in st["dates"]:
            out.append(("計畫", "plan", f"【{d['date']}】{d.get('msg', '')}"))
            st["dates"].append(d["date"])
    return out, st
