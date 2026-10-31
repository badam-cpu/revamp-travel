/**
 * Revamp result cards for AI assistants (MCP Apps, `text/html;profile=mcp-app`).
 *
 * Without our own UI, ChatGPT composes result cards itself and fetches photos
 * from a web image search — it showed other apartments' photos next to Revamp
 * listings (2026-10-26). Attaching this view to search_listings and get_quote
 * makes ChatGPT / Claude render OUR card: the listing's own photo, title, place,
 * price / all-in total, availability and a link to the listing.
 *
 * One self-contained HTML document (no external scripts). Data arrives through
 * the MCP Apps bridge (ui/initialize → ui/notifications/tool-result, the
 * shared standard both hosts implement), with ChatGPT's window.openai.toolOutput
 * as a fallback. All text is set with textContent (never innerHTML from data)
 * and links are only followed to revampvacations.com. Images may only come from
 * the declared origins (CSP resourceDomains): our Supabase storage + the site.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RE_PATH, RE_VIEWBOX, WORDMARK_PATH, WORDMARK_VIEWBOX } from "../shared/brandLogo.js";

// Brand marks from the brandbook outlines (never retyped as text) — fill follows currentColor.
const WORDMARK_SVG = `<svg viewBox="${WORDMARK_VIEWBOX}" aria-hidden="true" focusable="false"><path fill="currentColor" d="${WORDMARK_PATH}"/></svg>`;
const RE_SVG = `<svg viewBox="${RE_VIEWBOX}" aria-hidden="true" focusable="false"><path fill="currentColor" d="${RE_PATH}"/></svg>`;
// Manrope = the site's UI typeface (Circular isn't licensed for web text); falls back to the system font.
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap";

/** Versioned: hosts cache by URI, so bump it when the HTML/CSS/JS changes. */
export const CARDS_URI = "ui://revamp/cards-v7.html";
export const CARDS_MIME = "text/html;profile=mcp-app";

const SITE = () => (process.env.URL || "https://revampvacations.com").replace(/\/+$/, "");
function storageOrigin(): string | null {
  const u = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  try {
    return u ? new URL(u).origin : null;
  } catch {
    return null;
  }
}

/** Tool `_meta` that links a tool to the cards (standard key + ChatGPT alias). */
export function cardsToolMeta(invoking: string, invoked: string) {
  return {
    ui: { resourceUri: CARDS_URI },
    "openai/outputTemplate": CARDS_URI,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
  };
}

export function registerCardsResource(server: McpServer, chatgpt: boolean): void {
  const domains = [SITE(), storageOrigin(), "https://fonts.googleapis.com", "https://fonts.gstatic.com"].filter((d): d is string => !!d);
  server.registerResource(
    "revamp-cards",
    CARDS_URI,
    { title: "Revamp result cards", description: "Listing and quote cards with the listing's own photos.", mimeType: CARDS_MIME },
    async () => ({
      contents: [
        {
          uri: CARDS_URI,
          mimeType: CARDS_MIME,
          text: cardsHtml(SITE()),
          _meta: {
            ui: { prefersBorder: false, csp: { resourceDomains: domains, connectDomains: [] } },
            // ChatGPT reads this so it doesn't re-describe (and re-illustrate) what the card shows.
            ...(chatgpt && {
              "openai/widgetDescription":
                "Shows Revamp listings as cards with each listing's own photo, dates, availability, all-in price and link. The user already sees these details, so don't repeat them or add images — pictures found on the web show other properties.",
            }),
          },
        },
      ],
    }),
  );
}

export function cardsHtml(site: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${FONT_CSS}">
<style>
:root{--bg:#fff;--fg:#212121;--muted:#6b6b6b;--line:rgba(33,33,33,.1);--chip:#f5f5f5;--accent:#F15822;--soft:#FDEEE7;--tagbg:#fff}
.dark{--bg:#212121;--fg:#fff;--muted:#a9a9a9;--line:rgba(255,255,255,.12);--chip:#2d2d2d;--soft:rgba(241,88,34,.18);--tagbg:#212121}
*{box-sizing:border-box}html,body{margin:0;background:transparent;color:var(--fg);font:14px/1.45 Manrope,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans Armenian",sans-serif;-webkit-font-smoothing:antialiased}
svg{display:block}
#root{padding-top:3px}
.hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 2px 10px;font-size:13px;color:var(--muted)}
.wm{color:var(--accent);height:17px;width:89px;flex:none}.wm svg{height:100%;width:100%}
.hd b{color:var(--fg);font-weight:700}
.rail{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:2px 2px 10px;scrollbar-width:thin}
.card{flex:0 0 244px;scroll-snap-align:start;background:var(--bg);border:1px solid var(--line);border-radius:14px;overflow:hidden;display:flex;flex-direction:column;cursor:pointer;text-align:left;color:inherit;font:inherit;padding:0;transition:border-color .15s,transform .15s}
.card:hover{border-color:var(--accent)}.card:active{transform:scale(.99)}
.card:focus-visible,.btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ph{aspect-ratio:4/3;background:var(--chip) center/cover no-repeat;position:relative}
.ph .tag{position:absolute;left:10px;top:10px;background:var(--tagbg);color:var(--accent);font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;padding:5px 9px;border-radius:999px}
.bd{padding:12px 14px 14px;display:flex;flex-direction:column;gap:3px;flex:1}
.t{font-weight:800;font-size:15px;line-height:1.25;letter-spacing:-.01em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.m{color:var(--muted);font-size:12.5px}
.p{margin-top:auto;padding-top:8px;font-weight:800;font-size:17px;letter-spacing:-.01em}.p small{font-weight:600;font-size:12.5px;color:var(--muted);letter-spacing:0}.p .sub{display:block;font-size:12px;font-weight:500;color:var(--muted);letter-spacing:0}
.go{color:var(--accent);font-weight:800;font-size:13px;margin-top:8px}
.free{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:999px;margin-top:6px}
.badge{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px}
.ok{background:var(--soft);color:var(--accent)}.ok::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--accent)}
.no,.na{background:var(--chip);color:var(--muted)}
.more{flex:0 0 200px;scroll-snap-align:start;background:var(--accent);color:#fff;border:0;border-radius:14px;overflow:hidden;position:relative;display:flex;flex-direction:column;justify-content:space-between;padding:16px;cursor:pointer;text-align:left;font:inherit;min-height:100%}
.more .wm{color:#fff;height:20px;width:105px;position:relative;z-index:1}
.more .h{font-size:20px;font-weight:800;line-height:1.15;letter-spacing:-.01em;position:relative;z-index:1}
.more .s{font-size:12.5px;font-weight:600;opacity:.9;margin-top:6px;position:relative;z-index:1}
.more .pat{position:absolute;right:-70px;bottom:-34px;width:300px;color:#fff;opacity:.14;pointer-events:none}
.one{display:grid;grid-template-columns:minmax(0,220px) minmax(0,1fr);gap:0;background:var(--bg);border:1px solid var(--line);border-radius:14px;overflow:hidden}
@media (max-width:520px){.one{grid-template-columns:1fr}}
.one .ph{aspect-ratio:auto;min-height:170px}
.one .bd{padding:16px 18px;gap:6px;position:relative;overflow:hidden}
.one .wm{height:14px;width:73px;margin-bottom:4px}
.one .t{font-size:17px}
.one .pat{position:absolute;right:-40px;bottom:-30px;width:240px;color:var(--accent);opacity:.06;pointer-events:none}
.lines{border-top:1px solid var(--line);margin-top:8px;padding-top:10px;display:grid;gap:4px;font-size:13px;position:relative}
.ln{display:flex;justify-content:space-between;gap:12px}.ln span:first-child{color:var(--muted)}
.tot{font-weight:800;font-size:17px;border-top:1px solid var(--line);padding-top:8px;margin-top:4px}.tot span:first-child{color:var(--fg)}
.slots{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}.slot{background:var(--chip);border-radius:999px;padding:4px 10px;font-size:12.5px;font-weight:700}
.btn{align-self:flex-start;margin-top:10px;background:var(--accent);color:#fff;border:0;border-radius:999px;padding:11px 20px;font:inherit;font-weight:800;cursor:pointer;position:relative}
.btn:hover{filter:brightness(.95)}
.empty{color:var(--muted);padding:8px 2px}
@media (prefers-reduced-motion:reduce){.card{transition:none}.card:active{transform:none}}
</style></head>
<body><div id="root" aria-live="polite"></div>
<template id="wm">${WORDMARK_SVG}</template><template id="re">${RE_SVG}</template>
<script>
(function(){
  var SITE=${JSON.stringify(site)};
  var root=document.getElementById("root");
  var nextId=1, rendered=false;
  function send(msg){ try{ window.parent.postMessage(msg,"*"); }catch(e){} }
  function request(method,params){ var id=nextId++; send({jsonrpc:"2.0",id:id,method:method,params:params||{}}); return id; }
  function notify(method,params){ send({jsonrpc:"2.0",method:method,params:params||{}}); }
  function el(tag,cls,text){ var e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=String(text); return e; }
  function safeUrl(u){ try{ var x=new URL(u); return x.origin===new URL(SITE).origin ? x.href : null; }catch(e){ return null; } }
  function safeImg(u){ try{ var x=new URL(u); return x.protocol==="https:" ? x.href : null; }catch(e){ return null; } }
  function open(url){
    var u=safeUrl(url); if(!u) return;
    if(window.openai && typeof window.openai.openExternal==="function"){ try{ window.openai.openExternal({href:u}); return; }catch(e){} }
    request("ui/open-link",{url:u});
  }
  function resize(){ var h=Math.ceil(document.documentElement.scrollHeight); notify("ui/notifications/size-changed",{width:Math.ceil(document.documentElement.scrollWidth),height:h}); if(window.openai&&window.openai.notifyIntrinsicHeight){ try{window.openai.notifyIntrinsicHeight(h);}catch(e){} } }
  function photo(url,tag){ var d=el("div","ph"); var u=url&&safeImg(url); if(u) d.style.backgroundImage="url(\\""+u.replace(/"/g,"%22")+"\\")"; if(tag) d.appendChild(el("span","tag",tag)); d.setAttribute("role","img"); d.setAttribute("aria-label",tag?tag+" photo":"Listing photo"); return d; }
  var TYPE={stay:"Stay",tour:"Tour",experience:"Experience",eat:"Eat",place:"Visit"};
  var PLURAL={stay:"stays",tour:"tours",experience:"experiences",eat:"places to eat",place:"places to visit"};
  function mark(id,cls,label){ var d=el("span",cls); var t=document.getElementById(id); if(t) d.appendChild(t.content.cloneNode(true)); if(label){ d.setAttribute("role","img"); d.setAttribute("aria-label",label); } return d; }
  function day(iso,withYear){ try{ return new Date(iso+"T00:00:00Z").toLocaleDateString(document.documentElement.lang||undefined,{day:"numeric",month:"short",year:withYear?"numeric":undefined,timeZone:"UTC"}); }catch(e){ return iso; } }
  function listCards(data){
    var results=data.results;
    root.textContent="";
    var h=el("div","hd"); h.appendChild(mark("wm","wm","revamp."));
    if(data.startDate){
      var free=(results||[]).filter(function(r){return r.available===true;}).length, toCheck=(results||[]).length-free;
      h.appendChild(el("b",null,(free?free+" available":toCheck?"":"Nothing available")+(toCheck?(free?" + ":"")+toCheck+" to check rooms":"")));
      h.appendChild(el("span",null,(data.endDate?day(data.startDate,false)+" \u2192 "+day(data.endDate,true):day(data.startDate,true))+" \u00b7 "+(data.guests||2)+" guest"+(data.guests===1?"":"s")));
    } else if(results&&results.length){
      h.appendChild(el("b",null,results.length+" match"+(results.length===1?"":"es")));
    }
    root.appendChild(h);
    if(!results||!results.length){ root.appendChild(el("p","empty",data.note||"No Revamp listings matched.")); return; }
    var rail=el("div","rail");
    results.slice(0,10).forEach(function(r){
      var c=el("button","card"); c.type="button";
      c.appendChild(photo(r.image,TYPE[r.type]||""));
      var b=el("div","bd"); b.appendChild(el("div","t",r.title)); if(r.location) b.appendChild(el("div","m",r.location));
      if(r.totalFormatted){
        var pp=el("div","p",r.totalFormatted+" "); pp.appendChild(el("small",null,"total")); pp.appendChild(el("span","sub",(r.nights?r.nights+" night"+(r.nights===1?"":"s")+" · ":"")+"fees & tax incl.")); b.appendChild(pp);
      } else if(r.price){ b.appendChild(el("div","p",r.price)); }
      if(r.available===true) b.appendChild(el("span","free ok",r.slots&&r.slots.length?"Available · "+r.slots.join(", "):r.room?"Available · "+r.room:"Available on your dates"));
      else if(r.available===null) b.appendChild(el("span","free na",r.rooms?"Check rooms":"Check on the listing"));
      b.appendChild(el("div","go",(/\\/checkout\\//.test(r.bookUrl||"")?"Book on Revamp":"View on Revamp")+" ↗"));
      c.appendChild(b); c.addEventListener("click",function(){ open(r.bookUrl||r.url); }); rail.appendChild(c);
    });
    // Closing card: everything else on the site for the same search.
    var types={}; results.forEach(function(r){ types[r.type]=1; }); var only=Object.keys(types).length===1?Object.keys(types)[0]:"";
    var q=new URLSearchParams(); if(only==="stay"&&data.startDate&&data.endDate){ q.set("checkin",data.startDate); q.set("checkout",data.endDate); }
    var href=SITE+"/explore"+(only&&only!=="place"?"/"+only:"")+(q.toString()?"?"+q.toString():"");
    var more=el("button","more"); more.type="button";
    more.appendChild(mark("wm","wm","revamp."));
    var mt=el("div"); mt.appendChild(el("div","h",(only?"All "+PLURAL[only]:"Stays, tours & more")+(q.toString()?" for your dates":" in Armenia"))); mt.appendChild(el("div","s","Open the full search \u2192")); more.appendChild(mt);
    more.appendChild(mark("re","pat"));
    more.addEventListener("click",function(){ open(href); }); rail.appendChild(more);
    root.appendChild(rail);
  }
  function quoteCard(q){
    root.textContent="";
    var one=el("div","one"); one.appendChild(photo(q.image,TYPE[q.type]||""));
    var b=el("div","bd"); b.appendChild(mark("re","pat")); b.appendChild(mark("wm","wm","revamp.")); b.appendChild(el("div","t",q.title));
    var when=q.endDate?(day(q.startDate,false)+" \\u2192 "+day(q.endDate,true)+(q.nights?" \\u00b7 "+q.nights+" night"+(q.nights===1?"":"s"):"")):day(q.startDate,true);
    b.appendChild(el("div","m",when+" \\u00b7 "+q.guests+" guest"+(q.guests===1?"":"s")));
    var st=q.available===true?["ok","Available"]:q.available===false?["no","Not available"]:["na","Check on the listing"];
    b.appendChild(el("span","badge "+st[0],st[1]));
    if(q.reason) b.appendChild(el("div","m",q.reason));
    if(q.slots&&q.slots.length){ var s=el("div","slots"); q.slots.forEach(function(x){ s.appendChild(el("span","slot",x.localTime+" \\u00b7 "+x.seatsLeft+" left")); }); b.appendChild(s); }
    if(q.rooms&&q.rooms.length&&q.available!==true){ var rl=el("div","lines"); q.rooms.forEach(function(x){ var l=el("div","ln"); l.appendChild(el("span",null,x.name)); l.appendChild(el("span",null,x.nightlyFromFormatted?"from "+x.nightlyFromFormatted+" / night":"")); rl.appendChild(l); }); b.appendChild(rl); }
    if(q.price){
      var ls=el("div","lines");
      (q.price.lines||[]).forEach(function(x){ var l=el("div","ln"); l.appendChild(el("span",null,x.label)); l.appendChild(el("span",null,(x.amount<0?"\\u2212":"")+"\\u058f"+Math.abs(x.amount).toLocaleString("en-US"))); ls.appendChild(l); });
      if(q.price.tax){ var t=el("div","ln"); t.appendChild(el("span",null,q.price.tax.label)); t.appendChild(el("span",null,"\\u058f"+q.price.tax.amount.toLocaleString("en-US"))); ls.appendChild(t); }
      var tot=el("div","ln tot"); tot.appendChild(el("span",null,"Total")); tot.appendChild(el("span",null,q.price.totalFormatted)); ls.appendChild(tot);
      b.appendChild(ls);
    }
    if(q.cancellation&&q.available!==false) b.appendChild(el("div","m",q.cancellation));
    var btn=el("button","btn",/\\/checkout\\//.test(q.bookUrl||"")?"Book on Revamp":"View on Revamp"); btn.type="button"; btn.addEventListener("click",function(){ open(q.bookUrl); }); b.appendChild(btn);
    one.appendChild(b); root.appendChild(one);
  }
  function render(data){
    if(!data||typeof data!=="object") return;
    if(data.kind==="listings") listCards(data);
    else if(data.kind==="quote") quoteCard(data);
    else return;
    rendered=true; setTimeout(resize,0); Array.prototype.forEach.call(document.images,function(i){ i.addEventListener("load",resize); });
  }
  // The full card data travels in the result's _meta (not shown to the model); fall back to structuredContent.
  function full(meta){ return meta&&typeof meta==="object"&&meta["revamp/cards"]&&typeof meta["revamp/cards"]==="object"?meta["revamp/cards"]:null; }
  function theme(t){ document.documentElement.classList.toggle("dark",t==="dark"); }
  window.addEventListener("message",function(ev){
    if(ev.source!==window.parent) return;
    var m=ev.data; if(!m||typeof m!=="object") return;
    if(m.method==="ui/notifications/tool-result"&&m.params) render(full(m.params._meta)||m.params.structuredContent);
    else if(m.method==="ui/notifications/host-context-changed"&&m.params&&m.params.theme) theme(m.params.theme);
    else if(m.id===1&&m.result){ var hc=m.result.hostContext||{}; if(hc.theme) theme(hc.theme); notify("ui/notifications/initialized",{}); }
  });
  if(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches) theme("dark");
  request("ui/initialize",{protocolVersion:"2026-01-26",appCapabilities:{availableDisplayModes:["inline"]}});
  // ChatGPT also exposes the result directly (compatibility alias).
  function fromOpenai(){ var o=window.openai; if(!o) return; if(o.theme) theme(o.theme); var d=full(o.toolResponseMetadata)||o.toolOutput; if(!rendered&&d) render(d); }
  fromOpenai(); window.addEventListener("openai:set_globals",fromOpenai);
  new ResizeObserver(function(){ if(rendered) resize(); }).observe(document.body);
})();
</script></body></html>`;
}
