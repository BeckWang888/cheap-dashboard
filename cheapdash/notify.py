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
        if on["confirm"] and c["state"] == "轉折確認" and p.get("state") != "轉折確認":
            events.append((sym, "confirm", "轉折確認"))
        if on["trough"] and cur["trough"] and cur["trough"] != p.get("trough"):
            events.append((sym, "trough" + cur["trough"], f"重點觀察：月線谷底（{cur['trough']}）"))
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
    urgent = any(k in ("cross80", "confirm") for _, k, _ in events)
    title = f"便宜度提醒：{len(order)} 項"
    return title, "\n".join(lines), 4 if urgent else 3


def send(title: str, message: str, priority: int = 3, click: str = "") -> bool:
    """發到 ntfy。沒設定 NTFY_TOPIC 時只印出來（本機測試用）。"""
    topic = os.environ.get("NTFY_TOPIC")
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
    with urllib.request.urlopen(req, context=ssl.create_default_context(cafile=certifi.where()), timeout=30) as r:
        return r.status == 200
