"""把回測結果寫成單一 HTML 報告（資料內嵌，用瀏覽器直接開）。"""
import json
from pathlib import Path

TEMPLATE = r"""<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>便宜度回測</title>
<style>
:root{--bg:#eef1f4;--panel:#fff;--ink:#1b2430;--sub:#5d6978;--line:#d9dfe6;
--hot:#c2452d;--warm:#e0a24a;--mid:#c9d0d8;--cool:#6fb79c;--cheap:#12805f;--accent:#12805f;--chip:#e3e8ee}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#10161d;--panel:#18202a;--ink:#e6ebf1;--sub:#93a0af;--line:#2a3441;--hot:#e0644a;--warm:#d9a04c;--mid:#3a4553;--cool:#4fa88a;--cheap:#3ec9a0;--accent:#3ec9a0;--chip:#232d3a}}
:root[data-theme="dark"]{--bg:#10161d;--panel:#18202a;--ink:#e6ebf1;--sub:#93a0af;--line:#2a3441;--hot:#e0644a;--warm:#d9a04c;--mid:#3a4553;--cool:#4fa88a;--cheap:#3ec9a0;--accent:#3ec9a0;--chip:#232d3a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif;line-height:1.5}
.wrap{max-width:980px;margin:0 auto;padding:20px 16px 48px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;margin:0}h3{font-size:14px;margin:18px 0 6px;color:var(--sub);font-weight:600}
.note{font-size:13px;color:var(--sub);margin:0 0 14px}
.bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:12px 0}
.tabs{display:inline-flex;background:var(--chip);border-radius:8px;padding:3px}
.tabs button{border:0;background:none;color:var(--sub);font:inherit;font-size:14px;padding:6px 14px;border-radius:6px;cursor:pointer}
.tabs button[aria-pressed="true"]{background:var(--panel);color:var(--ink);font-weight:600}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin:14px 0}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}
th,td{padding:6px 8px;border-top:1px solid var(--line);text-align:right;white-space:nowrap}
th{color:var(--sub);font-weight:600;border-top:0}
td:first-child,th:first-child{text-align:left}
tr.base td{color:var(--sub)}
tr.click{cursor:pointer}tr.click:hover td{background:var(--chip)}
.pos{color:var(--cheap)}.neg{color:var(--hot)}.dim{color:var(--sub)}
.hd{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline}
.hd .sc{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}
.tag{display:inline-block;font-size:12px;padding:1px 8px;border-radius:10px;background:var(--chip);color:var(--sub);margin-left:6px}
.tag.warn{background:var(--hot);color:#fff}
.chart{position:relative;margin-top:10px}
.chart svg{display:block;width:100%;height:auto}
.tip{position:absolute;pointer-events:none;background:var(--ink);color:var(--bg);font-size:12px;padding:4px 8px;border-radius:6px;white-space:nowrap;display:none;transform:translate(-50%,-110%)}
.leg{display:flex;flex-wrap:wrap;gap:10px;font-size:12px;color:var(--sub);margin-top:6px}
.leg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;font-size:13px;color:var(--sub)}
.grid b{display:block;font-size:16px;color:var(--ink);font-variant-numeric:tabular-nums}
.dates{font-size:12px;color:var(--sub);margin:4px 0 0;word-break:break-all}
details{font-size:13px;color:var(--sub)}details p{margin:6px 0}
</style>
</head>
<body>
<div class="wrap">
<h1>便宜度回測 demo</h1>
<p class="note">資料：美股 Yahoo Finance、台股 FinMind（自行還原除權息與分割），都免 key。所有百分位、週線、月線都只用當天以前的資料，沒有偷看未來。
這是驗證分數設計用的工具，不是投資建議。產生時間：__GEN__</p>
<div class="bar">
  <span class="dim" style="font-size:14px">百分位基準</span>
  <div class="tabs" id="vt"><button data-v="full" aria-pressed="true">全部歷史</button><button data-v="5y" aria-pressed="false">近 5 年滾動</button></div>
</div>
<details class="card"><summary>怎麼看這份報告</summary>
<p><b>分數</b>：距 52 週高點回撤 60%、相對 MA200 20%、日線 RSI 20%。每一項換成「相對自身歷史的百分位」再映射到 −100~+100，前 3 年資料只當暖機。</p>
<p><b>全部歷史 vs 近 5 年</b>：全部歷史會被很久以前的大崩盤「定錨」（例如 QQQ 2000 年），之後的回檔看起來都不夠便宜；近 5 年滾動則只跟最近比，便宜區比較常出現，但也比較不「真的」便宜。切換看看兩者差異。</p>
<p><b>事件</b>只算「跨進去的那一刻」：分數要先跌回門檻以下 10 分才會再算一次，同類事件至少隔 20 個交易日，避免一次崩盤被算成幾十次。</p>
<p><b>之後最大再跌</b>：事件後 6 個月內，最低點相對進場價的跌幅（中位數／最糟 10%）。左側交易一定會遇到，重點是心裡有數。</p>
<p><b>分批模擬</b>：每月存 1 份錢。定期定額＝當天買；左側＝現金先放著（不計利息），分數跨上 20 / 50 / 80 各投入 20% / 30% / 50%。</p>
<p><b>過熱</b>：相對 MA200 的乖離落在自身歷史前 5%（或 RSI ≥ 80）算「過熱」，前 1% 算「嚴重過熱」。事件表最後兩列是「在過熱時追高」的結果，和基準比較就知道追高的代價。</p><p><b>槓桿型</b>：分數與事件都用對應的一倍標的計算；報酬用「標的日報酬 × 倍數」模擬，不含費用與融資成本，實際會比模擬差（見每檔的實際 vs 模擬）。</p>
</details>
<div class="card"><h2>總覽</h2><div class="scroll"><table id="ov"></table></div>
<p class="note" style="margin-top:8px">「跨上 50 之後 6 個月」與「任意日買進 6 個月」都是中位數。點任一列跳到該檔。</p></div>
<div id="cards"></div>
</div>
<script>
var R=__DATA__, SN=__SIGNAMES__, V="full";
var LV=[["極便宜",80,"--cheap",1],["很便宜",50,"--cheap",.65],["便宜",20,"--cool",1],["合理",-10,"--mid",1],["小貴",-33,"--warm",1],["中貴",-66,"--hot",.6],["很貴",-1e9,"--hot",1]];
function lvOf(s){for(var i=0;i<LV.length;i++)if(s>=LV[i][1])return LV[i];}
function pc(x,d){if(x==null)return'<span class="dim">—</span>';var v=(x*100).toFixed(d==null?1:d);return'<span class="'+(x>0?"pos":x<0?"neg":"")+'">'+(x>0?"+":"")+v+'%</span>'}
function pp(x){return x==null?'—':(x*100).toFixed(0)+'%'}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function id(r){return"c_"+r.symbol.replace(/\W/g,"_")}
function ev(r,label){return r.v[V].events.filter(function(e){return e.label===label})[0]}
function overview(){
 var h='<tr><th>標的</th><th>目前分數</th><th>便宜區時間占比</th><th>每年進便宜區</th><th>最長沒進便宜區</th><th>跨上 50 次數</th><th>跨上 50 之後 6 個月</th><th>任意日買進 6 個月</th></tr>';
 R.forEach(function(r){var v=r.v[V],c=v.current,z=v.zones,e50=ev(r,"分數跨上 50"),b=ev(r,"任意日買進（基準）"),g=z.longest_gap;
  h+='<tr class="click" data-j="'+id(r)+'"><td><b>'+esc(r.symbol)+'</b> <span class="dim">'+esc(r.name)+'</span></td><td>'+(c.score==null?'—':c.score.toFixed(0)+' '+c.level)+'</td><td>'+pp(z.cheap_share)+'</td><td>'+z.cheap_per_year.toFixed(1)+' 次</td><td>'+(g?(g.years).toFixed(1)+' 年'+(g.ongoing?'（進行中）':''):'—')+'</td><td>'+e50.n+'</td><td>'+pc(e50.r126)+'</td><td>'+pc(b.r126)+'</td></tr>'});
 document.getElementById("ov").innerHTML=h;
}
function chart(r){
 var W=900,H=230,P=44,top=10,ph=150,sy=top+ph+14,sh=26,d=r.chart.d,p=r.chart.p,s=r.chart["s_"+V],n=d.length;
 var lp=p.map(function(x){return Math.log(x)}),mn=Math.min.apply(null,lp),mx=Math.max.apply(null,lp);
 function X(i){return P+(W-P-8)*i/(n-1)}function Y(v){return top+ph-(v-mn)/(mx-mn||1)*ph}
 var g='',path='';
 // 對數刻度：標 4 條價格線
 for(var k=0;k<=3;k++){var v=mn+(mx-mn)*k/3,y=Y(v);g+='<line x1="'+P+'" x2="'+(W-8)+'" y1="'+y+'" y2="'+y+'" stroke="var(--line)" stroke-width="1"/><text x="'+(P-6)+'" y="'+(y+4)+'" text-anchor="end" font-size="11" fill="var(--sub)">'+fmtP(Math.exp(v))+'</text>'}
 var lastY=-1;for(var i=0;i<n;i++){var yr=+d[i].slice(0,4);if(yr!==lastY&&yr%(n>900?4:2)===0&&d[i].slice(5,7)<="01"){g+='<text x="'+X(i)+'" y="'+(sy+sh+14)+'" text-anchor="middle" font-size="11" fill="var(--sub)">'+yr+'</text>'}lastY=yr}
 for(i=0;i<n;i++)path+=(i?'L':'M')+X(i).toFixed(1)+' '+Y(lp[i]).toFixed(1);
 // 分數色帶：每週一格，顏色 = 級距
 var band='',bw=(W-P-8)/(n-1)+.6;
 for(i=0;i<n;i++){if(s[i]==null)continue;var l=lvOf(s[i]);band+='<rect x="'+(X(i)-bw/2).toFixed(1)+'" y="'+sy+'" width="'+bw.toFixed(2)+'" height="'+sh+'" fill="var('+l[2]+')" opacity="'+l[3]+'"/>'}
 return '<svg viewBox="0 0 '+W+' '+(sy+sh+20)+'" role="img" aria-label="'+esc(r.base)+' 價格與分數色帶">'+g+'<path d="'+path+'" fill="none" stroke="var(--ink)" stroke-width="1.6"/>'+band+'<text x="'+(P-6)+'" y="'+(sy+17)+'" text-anchor="end" font-size="11" fill="var(--sub)">分數</text><line class="hx" x1="0" x2="0" y1="'+top+'" y2="'+(sy+sh)+'" stroke="var(--sub)" stroke-width="1" style="display:none"/><rect class="hit" x="'+P+'" y="0" width="'+(W-P-8)+'" height="'+(sy+sh)+'" fill="transparent"/></svg>';
}
function fmtP(v){return v>=1000?v.toFixed(0):v>=10?v.toFixed(1):v.toFixed(2)}
function hover(el,r){
 var svg=el.querySelector("svg"),tip=el.querySelector(".tip"),hx=svg.querySelector(".hx"),hit=svg.querySelector(".hit"),d=r.chart.d,p=r.chart.p;
 function mv(e){var b=svg.getBoundingClientRect(),vb=svg.viewBox.baseVal,x=(e.clientX-b.left)*vb.width/b.width,n=d.length,i=Math.round((x-44)/(vb.width-52)*(n-1));if(i<0||i>=n)return;var s=r.chart["s_"+V][i];
  var X=44+(vb.width-52)*i/(n-1);hx.setAttribute("x1",X);hx.setAttribute("x2",X);hx.style.display="";
  tip.style.display="block";tip.style.left=(X*b.width/vb.width)+"px";tip.style.top="10px";
  tip.textContent=d[i]+"　"+r.base+" "+fmtP(p[i])+"　分數 "+(s==null?"暖機中":s.toFixed(0)+" "+lvOf(s)[0])}
 function out(){tip.style.display="none";hx.style.display="none"}
 hit.addEventListener("mousemove",mv);hit.addEventListener("touchmove",function(e){mv(e.touches[0])},{passive:true});hit.addEventListener("mouseleave",out);
}
function card(r){
 var v=r.v[V],c=v.current,z=v.zones,sim=v.sim,L=r.lev,l=c.score==null?null:lvOf(c.score);
 var h='<div class="card" id="'+id(r)+'"><div class="hd"><div><h2>'+esc(r.symbol)+' <span class="dim" style="font-weight:400;font-size:14px">'+esc(r.name)+'</span>'+(L?'<span class="tag">'+L.x+' 倍・對應 '+esc(L.underlying)+'</span>':'')+(r.thin?'<span class="tag warn">資料不足，分數僅供參考</span>':'')+'</h2>'
  +'<div class="dim" style="font-size:13px">'+(L?'分數用 '+esc(r.base)+' 計算・':'')+'資料自 '+r.first_date+'・有分數 '+z.years.toFixed(1)+' 年</div></div>'
  +'<div style="text-align:right"><span class="sc">'+(c.score==null?'—':c.score.toFixed(0))+'</span> <b style="color:var('+(l?l[2]:'--sub')+')">'+(l?l[0]:'')+'</b><div class="dim" style="font-size:13px">'+esc(c.state)+'・'+c.date+'</div></div></div>';
 h+='<div class="chart">'+chart(r)+'<div class="tip"></div></div><div class="leg">'+LV.map(function(x){return'<span><i style="background:var('+x[2]+');opacity:'+x[3]+'"></i>'+x[0]+'</span>'}).join('')+'</div>';
 h+='<h3>目前狀況（'+esc(r.base)+'）</h3><div class="grid"><div>距 52 週高點<b>'+pc(c.dd52)+'</b></div><div>距歷史高點<b>'+pc(c.dd_ath)+'</b></div><div>日線 RSI<b>'+(c.rsi==null?'—':c.rsi.toFixed(0))+'</b></div><div>相對 MA200<b>'+pc(c.ma_dev)+'</b></div><div>轉折訊號<b>'+c.sigs.filter(Boolean).length+' / 5'+(c.trough?'・月線谷底':'')+'</b></div></div>';
 if(L)h+='<h3>槓桿 ETF 本身（實際資料，自 '+L.since+'）</h3><div class="grid"><div>離高點<b>'+pc(L.dd_ath)+'</b></div><div>回本所需漲幅<b>'+pc(L.recover,0)+'</b></div><div>近一年實際 − 標的×'+L.x+'<b>'+(L.gap_1y==null?'不足 1 年':pc(L.gap_1y))+'</b></div><div>年化：實際 / 模擬<b>'+pc(L.real_cagr)+' / '+pc(L.sim_cagr)+'</b></div><div>最大回撤：實際 / 模擬<b>'+pc(L.real_mdd,0)+' / '+pc(L.sim_mdd,0)+'</b></div></div>';
 var sh=z.shares,g=z.longest_gap;
 h+='<h3>各級距時間占比</h3><div class="grid">'+LV.map(function(x){return'<div>'+x[0]+'<b>'+pp(sh[x[0]])+'</b></div>'}).join('')+'<div>最長沒進便宜區<b>'+(g?g.years.toFixed(1)+' 年':'—')+'</b>'+(g?g.from+' ~ '+g.to+(g.ongoing?'（進行中）':''):'')+'</div></div>';
 h+='<h3>事件之後'+(L?'（報酬為模擬 '+L.x+' 倍）':'')+'</h3><div class="scroll"><table><tr><th>事件</th><th>次數</th><th>1 個月</th><th>3 個月</th><th>6 個月</th><th>6 個月上漲機率</th><th>之後最大再跌（中位）</th><th>最糟 10%</th></tr>';
 v.events.forEach(function(e,k){h+='<tr class="'+(k?'click':'base')+'" data-k="'+k+'"><td>'+esc(e.label)+'</td><td>'+(k?e.n+(e.n6<e.n?' <span class="dim">('+e.n6+')</span>':''):'<span class="dim">'+e.n+' 天</span>')+'</td><td>'+pc(e.r21)+'</td><td>'+pc(e.r63)+'</td><td>'+pc(e.r126)+'</td><td>'+pp(e.win126)+'</td><td>'+pc(e.mae_med)+'</td><td>'+pc(e.mae_p10)+'</td></tr>'});
 h+='</table></div><div class="dates" data-dates></div><p class="note" style="margin:6px 0 0">報酬欄位是中位數。次數括號內為已滿 6 個月的樣本數。次數少於 10 的結果參考就好。點事件列可看日期。</p>';
 h+='<h3>分批模擬（自 '+sim.since+'，每月存 1 份，共 '+sim.deposited+' 份）</h3><div class="grid"><div>定期定額 最終價值<b>'+sim.dca_value.toFixed(0)+'</b></div><div>左側分批 最終價值<b>'+sim.left_value.toFixed(0)+'</b></div><div>左側平均成本 vs 定期定額<b>'+pc(sim.cost_vs_dca)+'</b></div><div>最後還沒投入的現金<b>'+sim.left_cash_end.toFixed(0)+' 份</b></div><div>最長「現金 ≥6 份」連續<b>'+sim.longest_idle_months+' 個月</b></div></div>';
 return h+'</div>';
}
function render(){
 overview();
 document.getElementById("cards").innerHTML=R.map(card).join('');
 R.forEach(function(r){var el=document.getElementById(id(r));hover(el.querySelector(".chart"),r);
  el.querySelectorAll("tr.click").forEach(function(tr){tr.addEventListener("click",function(){var e=r.v[V].events[+tr.dataset.k],box=el.querySelector("[data-dates]");box.textContent=e.label+"："+(e.dates&&e.dates.length?e.dates.join("、"):"沒有事件")})})});
 document.querySelectorAll("#ov tr.click").forEach(function(tr){tr.addEventListener("click",function(){document.getElementById(tr.dataset.j).scrollIntoView({behavior:"smooth"})})});
}
document.getElementById("vt").addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;V=b.dataset.v;[].forEach.call(this.children,function(x){x.setAttribute("aria-pressed",x===b)});render()});
render();
</script>
</body>
</html>"""


def write_report(results, signal_names, path: Path) -> Path:
    from datetime import datetime
    html = (TEMPLATE
            .replace("__DATA__", json.dumps(results, ensure_ascii=False).replace("</", "<\\/"))
            .replace("__SIGNAMES__", json.dumps(signal_names, ensure_ascii=False))
            .replace("__GEN__", datetime.now().strftime("%Y-%m-%d %H:%M")))
    path.write_text(html, encoding="utf-8")
    return path
