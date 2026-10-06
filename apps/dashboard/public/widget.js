"use strict";(()=>{var W={DARK:{"--panel-bg":"#0c0d13","--text-primary":"#ffffff","--text-secondary":"rgba(255,255,255,0.45)","--text-muted":"rgba(255,255,255,0.28)","--header-border":"rgba(255,255,255,0.07)","--bubble-agent-bg":"rgba(255,255,255,0.06)","--bubble-agent-border":"rgba(255,255,255,0.06)","--bubble-agent-text":"#f2f3f7","--input-bg":"rgba(255,255,255,0.06)","--input-border":"rgba(255,255,255,0.1)","--input-focus-bg":"rgba(255,255,255,0.08)","--input-text":"#ffffff","--input-placeholder":"rgba(255,255,255,0.32)","--composer-border":"rgba(255,255,255,0.07)","--composer-bg":"rgba(255,255,255,0.02)","--close-icon":"rgba(255,255,255,0.4)","--close-hover-bg":"rgba(255,255,255,0.08)","--scrollbar-thumb":"rgba(255,255,255,0.12)","--panel-shadow":"0 24px 70px rgba(0,0,0,0.5), 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.07) inset","--header-glow":"rgba(53,189,240,0.25)"},LIGHT:{"--panel-bg":"#ffffff","--text-primary":"#0f1330","--text-secondary":"rgba(15,19,48,0.55)","--text-muted":"rgba(15,19,48,0.4)","--header-border":"rgba(15,19,48,0.08)","--bubble-agent-bg":"rgba(15,19,48,0.045)","--bubble-agent-border":"rgba(15,19,48,0.07)","--bubble-agent-text":"#0f1330","--input-bg":"rgba(15,19,48,0.035)","--input-border":"rgba(15,19,48,0.12)","--input-focus-bg":"rgba(15,19,48,0.05)","--input-text":"#0f1330","--input-placeholder":"rgba(15,19,48,0.38)","--composer-border":"rgba(15,19,48,0.08)","--composer-bg":"rgba(15,19,48,0.015)","--close-icon":"rgba(15,19,48,0.45)","--close-hover-bg":"rgba(15,19,48,0.06)","--scrollbar-thumb":"rgba(15,19,48,0.14)","--panel-shadow":"0 24px 70px rgba(20,27,77,0.16), 0 4px 16px rgba(20,27,77,0.1), 0 0 0 1px rgba(15,19,48,0.06) inset","--header-glow":"rgba(53,189,240,0.14)"}};(function(){let h=document.currentScript,p=h?.dataset.agentId;if(!p){console.error("[chat-widget] missing data-agent-id on the embed <script> tag.");return}let x=h?.dataset.apiBase??new URL(h?.src??"",location.href).origin,A=h?.dataset.position==="left"?"left":"right",z=`chat-agent:${p}`,v=JSON.parse(localStorage.getItem(z)??"{}"),P=v.sessionCookie??crypto.randomUUID(),l=v.conversationId,S=v.csatSubmittedFor;function B(){localStorage.setItem(z,JSON.stringify({conversationId:l,sessionCookie:P,csatSubmittedFor:S}))}let b=document.createElement("div");b.id="chat-agent-widget-root",b.style.display="none",document.body.appendChild(b);let i=b.attachShadow({mode:"open"});i.innerHTML=`
    <style>${le(A)}</style>
    <div class="launcher" part="launcher" aria-label="Open chat">
      <svg class="icon-chat" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      </svg>
      <svg class="icon-close" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.25">
        <path d="M5 5l14 14M19 5L5 19" stroke-linecap="round"/>
      </svg>
    </div>
    <div class="panel" hidden>
      <div class="header">
        <div class="header-glow"></div>
        <div class="avatar-halo">
        <div class="avatar-ring"></div>
        <div class="avatar-wrap">
          <img class="avatar" hidden />
          <svg class="avatar-fallback" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
        </div>
        </div>
        <div class="header-text">
          <div class="name"></div>
          <div class="status"><span class="status-dot"></span>Online \xB7 replies in seconds</div>
        </div>
        <button class="close" aria-label="Close chat">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 5l14 14M19 5L5 19" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="messages"></div>
      <div class="confirmation" hidden></div>
      <div class="csat" hidden>
        <div class="csat-text">How did we do?</div>
        <div class="csat-stars">
          ${[1,2,3,4,5].map(e=>`<button type="button" class="csat-star" data-score="${e}" aria-label="${e} star${e===1?"":"s"}">\u2605</button>`).join("")}
        </div>
        <button type="button" class="csat-skip">Skip</button>
      </div>
      <form class="composer">
        <input type="text" placeholder="Type a message\u2026" autocomplete="off" />
        <button type="submit" aria-label="Send" disabled>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
        </button>
      </form>
    </div>
  `;let a=i.querySelector(".launcher"),c=i.querySelector(".panel"),D=i.querySelector(".close"),d=i.querySelector(".messages"),m=i.querySelector(".confirmation"),y=i.querySelector(".csat"),w=i.querySelectorAll(".csat-star"),J=i.querySelector(".csat-skip"),G=i.querySelector(".composer"),f=i.querySelector("input"),N=i.querySelector(".composer button"),_=i.querySelector(".name"),j=i.querySelector(".avatar"),K=i.querySelector(".avatar-fallback");f.addEventListener("input",()=>{N.disabled=f.value.trim().length===0});let s,k=!1;function X(e){let t=W[e??"LIGHT"];for(let[n,o]of Object.entries(t))b.style.setProperty(n,o)}async function V(){let e=await fetch(`${x}/v1/widget-config/${p}`);if(!e.ok)throw Object.assign(new Error(`widget-config fetch failed: ${e.status}`),{status:e.status});s=await e.json(),X(s.theme),_.textContent=s.name;let t=s.logoUrl||s.avatarUrl;t&&(j.src=t,j.hidden=!1,K.hidden=!0),v.conversationId||g("agent",s.greeting)}let O;function I(e){k=e,clearTimeout(O),a.classList.toggle("open",e),e&&a.classList.remove("invite"),e?(c.hidden=!1,R(),requestAnimationFrame(()=>c.classList.add("open")),f.focus()):(c.classList.remove("open"),O=setTimeout(()=>{k||(c.hidden=!0)},200))}function Q(){return!l||S===l||!y.hidden?!1:(y.hidden=!1,w.forEach(e=>e.classList.remove("filled")),!0)}async function Y(e){if(y.hidden=!0,e!==null&&l&&s){S=l,B();try{await fetch(`${x}/v1/chat/${p}/conversations/${l}/csat`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${s.widgetToken}`},body:JSON.stringify({score:e})})}catch{}}I(!1)}w.forEach(e=>{e.addEventListener("mouseenter",()=>{let t=Number(e.dataset.score);w.forEach(n=>n.classList.toggle("filled",Number(n.dataset.score)<=t))}),e.addEventListener("click",()=>void Y(Number(e.dataset.score)))}),y.addEventListener("mouseleave",()=>w.forEach(e=>e.classList.remove("filled"))),J.addEventListener("click",()=>void Y(null));let q=6,F=`chat-agent:pos:${p}`,T=!1,u=!1,C=0,$=0;function Z(e,t){let n=a.offsetWidth||60,o=8;return{x:Math.min(Math.max(e,o),Math.max(o,window.innerWidth-n-o)),y:Math.min(Math.max(t,o),Math.max(o,window.innerHeight-n-o))}}function H(e,t){let n=Z(e,t);return a.classList.add("placed"),a.style.left=`${n.x}px`,a.style.top=`${n.y}px`,a.style.right="auto",a.style.bottom="auto",R(),n}function R(){if(a.style.left==="")return;let e=a.getBoundingClientRect(),t=Math.min(372,window.innerWidth-32),n=Math.min(580,window.innerHeight-120),o=e.top>window.innerHeight/2,r=Math.min(Math.max(e.left+e.width/2-t/2,16),Math.max(16,window.innerWidth-t-16)),M=o?Math.max(16,e.top-n-12):Math.min(e.bottom+12,window.innerHeight-n-16);c.style.left=`${r}px`,c.style.top=`${Math.max(16,M)}px`,c.style.right="auto",c.style.bottom="auto",c.style.transformOrigin=o?"bottom center":"top center"}try{let e=JSON.parse(localStorage.getItem(F)||"null");e&&typeof e.x=="number"&&typeof e.y=="number"&&H(e.x,e.y)}catch{}a.addEventListener("pointerdown",e=>{let t=a.getBoundingClientRect();T=!0,u=!1,C=e.clientX-t.left,$=e.clientY-t.top,a.setPointerCapture(e.pointerId)}),a.addEventListener("pointermove",e=>{T&&(!u&&Math.abs(e.clientX-C-a.getBoundingClientRect().left)<q&&Math.abs(e.clientY-$-a.getBoundingClientRect().top)<q||(u=!0,a.classList.add("dragging"),a.classList.remove("invite"),H(e.clientX-C,e.clientY-$)))}),a.addEventListener("pointerup",e=>{if(T&&(T=!1,a.classList.remove("dragging"),a.hasPointerCapture(e.pointerId)&&a.releasePointerCapture(e.pointerId),u))try{localStorage.setItem(F,JSON.stringify({x:parseFloat(a.style.left),y:parseFloat(a.style.top)}))}catch{}}),window.addEventListener("resize",()=>{a.style.left!==""&&H(parseFloat(a.style.left),parseFloat(a.style.top))}),a.addEventListener("click",()=>{if(u){u=!1;return}I(!k)}),D.addEventListener("click",()=>{Q()||I(!1)}),a.addEventListener("animationend",e=>{e.animationName==="sonarPing"&&a.classList.remove("invite")});let ee=window.matchMedia?.("(prefers-reduced-motion: reduce)").matches??!1;function te(e,t){if(ee){e.textContent=t;return}let n=t.split(/(\s+)/),o=Math.max(1,Math.ceil(n.length/55)),r=0,M=()=>{r=Math.min(n.length,r+o),e.textContent=n.slice(0,r).join(""),d.scrollTop=d.scrollHeight,r<n.length&&requestAnimationFrame(M)};requestAnimationFrame(M)}function g(e,t){let n=document.createElement("div");n.className=`row ${e}`;let o=document.createElement("div");o.className=`bubble ${e}`,e==="agent"?te(o,t):o.textContent=t;let r=document.createElement("div");r.className="timestamp",r.textContent=new Date().toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}),n.append(o,r),d.appendChild(n),d.scrollTop=d.scrollHeight}function ne(e){m.hidden=!1,m.innerHTML="";let t=document.createElement("div");t.className="confirmation-text",t.textContent=e.confirmationPrompt;let n=document.createElement("div");n.className="confirmation-actions";let o=document.createElement("button");o.textContent="Confirm",o.className="confirm",o.onclick=()=>{m.hidden=!0,U("",{confirmToolCallId:e.toolCallId})};let r=document.createElement("button");r.textContent="Cancel",r.className="cancel",r.onclick=()=>{m.hidden=!0,g("agent","No problem, I won't go ahead with that.")},n.append(o,r),m.append(t,n)}async function U(e,t){if(!s)return;e&&g("customer",e);let n=document.createElement("div");n.className="row agent",n.innerHTML='<div class="bubble agent typing"><span></span><span></span><span></span><em>Thinking</em></div>',d.appendChild(n),d.scrollTop=d.scrollHeight;try{let o=await fetch(`${x}/v1/chat/${p}/messages`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${s.widgetToken}`},body:JSON.stringify({conversationId:l,message:e||"(customer confirmed the pending action)",customerIdentifier:{type:"widget_session_cookie",value:P},...t})});if(n.remove(),!o.ok){g("agent","Sorry, I'm having trouble responding right now. Please try again shortly.");return}let r=await o.json();l=r.conversationId,B(),r.reply&&g("agent",r.reply),r.pendingConfirmation&&ne(r.pendingConfirmation),r.humanTakeoverActive?ae():oe()}catch{n.remove(),g("agent","Sorry, I'm having trouble responding right now. Please try again shortly.")}}let L,E;function ae(){L||(L=setInterval(re,4e3))}function oe(){clearInterval(L),L=void 0}async function re(){if(!(!l||!s))try{let e=await fetch(`${x}/v1/chat/${p}/conversations/${l}/messages`,{headers:{authorization:`Bearer ${s.widgetToken}`}});if(!e.ok)return;let t=await e.json();if(E===void 0){E=t[t.length-1]?.id;return}let n=t.findIndex(r=>r.id===E),o=n>=0?t.slice(n+1):[];for(let r of o)(r.role==="staff"||r.role==="agent")&&g("agent",r.content);t.length>0&&(E=t[t.length-1].id)}catch{}}G.addEventListener("submit",e=>{e.preventDefault();let t=f.value.trim();t&&(f.value="",N.disabled=!0,U(t))});function ie(){b.style.display="",setTimeout(()=>{k||a.classList.add("invite")},900)}async function se(){for(let e of[0,2e3,6e3]){e&&await new Promise(t=>setTimeout(t,e));try{await V(),ie();return}catch(t){let n=t.status;if(n!==void 0&&n>=400&&n<500)break}}console.warn("[chat-widget] this assistant is unavailable right now, so the chat button is hidden.")}se();function le(e){let t=e==="left"?"left":"right",n=e==="left"?"right":"left";return`
      :host, * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; }
      :host {
        --brand-1: #35bdf0; --brand-2: #12a5e0; --brand-3: #0a6a99;
        ${Object.entries(W.LIGHT).map(([o,r])=>`${o}: ${r};`).join(" ")}
      }

      @keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes panelIn { from { opacity: 0; transform: translateY(16px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
      @keyframes pulseDot { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
      @keyframes typingBounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.5; } 30% { transform: translateY(-3px); opacity: 1; } }
      @keyframes launcherPop { 0% { opacity: 0; transform: scale(0.4) translateY(12px); } 60% { opacity: 1; transform: scale(1.08) translateY(0); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
      @keyframes sonarPing { 0% { box-shadow: 0 0 0 0 rgba(18,165,224,0.45); } 100% { box-shadow: 0 0 0 22px rgba(18,165,224,0); } }
      @keyframes bobIdle { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

      .launcher {
        position: fixed; bottom: 24px; ${t}: 24px; ${n}: auto; width: 60px; height: 60px; border-radius: 50%;
        background: linear-gradient(135deg, var(--brand-1), var(--brand-2) 55%, var(--brand-3));
        background-size: 160% auto; background-position: left center;
        color: white; display: flex; align-items: center; justify-content: center; cursor: pointer;
        box-shadow: 0 4px 14px rgba(18,165,224,0.3), 0 12px 32px rgba(18,165,224,0.28), 0 0 0 1px rgba(255,255,255,0.08) inset;
        z-index: 999999;
        /* Plays automatically the instant this element mounts \u2014 no JS
           gating needed for the entrance itself, so it can never get stuck
           invisible if a later script hook fails to run. */
        animation: launcherPop 0.55s cubic-bezier(0.34,1.56,0.64,1) both, bobIdle 3.2s ease-in-out 0.6s infinite;
        transition: transform 0.2s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.25s ease, background-position 0.3s ease;
      }
      .launcher.invite { animation: launcherPop 0.55s cubic-bezier(0.34,1.56,0.64,1) both, sonarPing 1.6s ease-out 3, bobIdle 3.2s ease-in-out 0.6s infinite; }
      /* Draggable: touch-action stops a drag from scrolling the host page. */
      .launcher { cursor: grab; touch-action: none; }
      .launcher.dragging { cursor: grabbing; transition: none; transform: scale(1.04); }
      /* Once it has been moved by hand, the entrance pop and idle bob stop:
         re-adding them after a drag replays the pop from scale(0.4), which
         reads as the button breaking. */
      .launcher.placed, .launcher.dragging { animation: none !important; }
      .launcher:hover { animation-play-state: paused; transform: scale(1.07); background-position: right center; box-shadow: 0 6px 18px rgba(18,165,224,0.4), 0 16px 40px rgba(18,165,224,0.32), 0 0 0 1px rgba(255,255,255,0.1) inset; }
      .launcher:active { transform: scale(0.96); }
      .launcher.open { animation: none; transform: scale(1); }
      .launcher .icon-chat, .launcher .icon-close { position: absolute; transition: opacity 0.18s ease, transform 0.25s cubic-bezier(0.34,1.56,0.64,1); }
      .launcher .icon-close { opacity: 0; transform: rotate(-45deg) scale(0.6); }
      .launcher.open .icon-chat { opacity: 0; transform: rotate(45deg) scale(0.6); }
      .launcher.open .icon-close { opacity: 1; transform: rotate(0) scale(1); }

      .panel {
        position: fixed; bottom: 96px; ${t}: 24px; ${n}: auto; width: 372px; max-width: calc(100vw - 32px); height: 580px;
        max-height: calc(100vh - 120px); background: var(--panel-bg); border-radius: 20px;
        box-shadow: var(--panel-shadow);
        display: flex; flex-direction: column; overflow: hidden; z-index: 999999;
        opacity: 0; transform: translateY(16px) scale(0.97); transform-origin: bottom ${t};
        transition: opacity 0.22s cubic-bezier(0.16,1,0.3,1), transform 0.22s cubic-bezier(0.16,1,0.3,1), background 0.2s ease;
        /* The closed panel keeps its box (display:flex beats [hidden], and it
           has to stay laid out to animate open). Invisible is not the same as
           gone: without this it silently swallowed every click in a 372x580
           area of the host's own page \u2014 a button behind it could not be
           pressed. Only the open panel takes pointer input. */
        pointer-events: none;
      }
      .panel.open { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }

      .header { position: relative; display: flex; align-items: center; gap: 11px; padding: 16px; overflow: hidden;
        background: linear-gradient(180deg, rgba(128,128,128,0.06), rgba(128,128,128,0) 100%); border-bottom: 1px solid var(--header-border); }
      .header-glow { position: absolute; top: -40px; left: -20px; width: 140px; height: 140px; border-radius: 50%;
        background: radial-gradient(circle, var(--header-glow), transparent 70%); pointer-events: none; }
      .avatar-halo { position: relative; width: 42px; height: 42px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
      .avatar-ring { position: absolute; inset: 0; border-radius: 50%;
        background: conic-gradient(from 0deg, var(--brand-1), var(--brand-3), #8b5cf6, var(--brand-1));
        animation: spin 6s linear infinite; opacity: 0.9; }
      .avatar-halo .avatar-wrap { box-shadow: 0 0 0 2px var(--panel-bg); }
      .avatar-wrap { position: relative; width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0;
        background: linear-gradient(135deg, var(--brand-1), var(--brand-3)); display: flex; align-items: center; justify-content: center;
        box-shadow: 0 0 0 2px rgba(128,128,128,0.15); overflow: hidden; }
      /* A client's logo is rarely a square mark \u2014 most are wide wordmarks.
         object-fit: cover fills the circle by cropping, which turns a wide
         logo into an unrecognisable sliver (reported on the Datalyst mark
         itself). contain shows the whole logo, letterboxed on a white disc
         so it reads on any header colour \u2014 the same treatment the header's
         "white logo tile" pattern already uses elsewhere in the dashboard. */
      .avatar { position: absolute; inset: 3px; width: calc(100% - 6px); height: calc(100% - 6px); border-radius: 50%;
        object-fit: contain; background: #fff; }
      .avatar-fallback { color: rgba(255,255,255,0.9); }
      .header-text { flex: 1; min-width: 0; position: relative; }
      .name { color: var(--text-primary); font-weight: 600; font-size: 14.5px; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .status { display: flex; align-items: center; gap: 5px; color: var(--text-secondary); font-size: 11.5px; margin-top: 1px; }
      .status-dot { width: 6px; height: 6px; border-radius: 50%; background: #2fbf71; box-shadow: 0 0 6px #2fbf71; animation: pulseDot 2s ease-in-out infinite; }
      .close { position: relative; background: none; border: none; color: var(--close-icon); cursor: pointer; line-height: 1;
        display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 8px; transition: background 0.15s, color 0.15s; }
      .close:hover { background: var(--close-hover-bg); color: var(--text-primary); }

      .messages { flex: 1; overflow-y: auto; padding: 18px 16px; display: flex; flex-direction: column; gap: 4px; scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb) transparent; }
      .messages::-webkit-scrollbar { width: 6px; }
      .messages::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 999px; }

      .row { display: flex; flex-direction: column; margin-bottom: 10px; animation: fadeInUp 0.32s cubic-bezier(0.16,1,0.3,1) both; max-width: 84%; }
      .row.agent { align-self: flex-start; align-items: flex-start; }
      .row.customer { align-self: flex-end; align-items: flex-end; }
      .bubble { padding: 10px 13px; border-radius: 15px; font-size: 13.5px; line-height: 1.48; white-space: pre-wrap; word-break: break-word; }
      .bubble.agent { background: var(--bubble-agent-bg); color: var(--bubble-agent-text); border: 1px solid var(--bubble-agent-border); border-bottom-left-radius: 4px; }
      .bubble.customer { background: linear-gradient(135deg, var(--brand-1), var(--brand-2)); color: white; border-bottom-right-radius: 4px; box-shadow: 0 2px 10px rgba(18,165,224,0.25); }
      .timestamp { font-size: 10px; color: var(--text-muted); margin-top: 4px; padding: 0 3px; }

      .bubble.typing { display: flex; align-items: center; gap: 4px; padding: 12px 14px; }
      .bubble.typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--text-secondary); animation: typingBounce 1.2s ease-in-out infinite; }
      .bubble.typing span:nth-child(2) { animation-delay: 0.15s; }
      .bubble.typing span:nth-child(3) { animation-delay: 0.3s; }
      .bubble.typing em { font-style: normal; font-size: 11.5px; margin-left: 6px; letter-spacing: 0.01em;
        background: linear-gradient(90deg, var(--text-secondary) 0%, var(--brand-1) 50%, var(--text-secondary) 100%);
        background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent;
        animation: shimmer 1.8s linear infinite; }

      .confirmation { padding: 12px 16px; background: rgba(232,165,61,0.08); border-top: 1px solid rgba(232,165,61,0.25); animation: fadeInUp 0.2s ease both; }
      .confirmation-text { color: var(--bubble-agent-text); font-size: 12.5px; margin-bottom: 9px; line-height: 1.4; }
      .confirmation-actions { display: flex; gap: 8px; }
      .confirmation-actions button { flex: 1; padding: 8px; border-radius: 9px; border: none; font-size: 12.5px; cursor: pointer; font-weight: 600; transition: filter 0.15s, transform 0.15s; }
      .confirmation-actions button:hover { filter: brightness(1.1); }
      .confirmation-actions button:active { transform: scale(0.97); }
      .confirmation-actions .confirm { background: #2fbf71; color: white; }
      .confirmation-actions .cancel { background: var(--input-bg); color: var(--bubble-agent-text); }

      .csat { padding: 14px 16px; border-top: 1px solid var(--composer-border); background: var(--composer-bg); text-align: center; animation: fadeInUp 0.2s ease both; }
      .csat-text { color: var(--text-primary); font-size: 13px; font-weight: 600; margin-bottom: 8px; }
      .csat-stars { display: flex; justify-content: center; gap: 4px; margin-bottom: 6px; }
      .csat-star { background: none; border: none; cursor: pointer; font-size: 22px; line-height: 1; color: var(--input-border); padding: 2px; transition: color 0.12s, transform 0.12s; }
      .csat-star:hover, .csat-star.filled { color: #f5a623; transform: scale(1.12); }
      .csat-skip { background: none; border: none; cursor: pointer; font-size: 11px; color: var(--text-secondary); text-decoration: underline; }

      .composer { display: flex; gap: 8px; padding: 13px; border-top: 1px solid var(--composer-border); background: var(--composer-bg); }
      .composer input { flex: 1; background: var(--input-bg); border: 1px solid var(--input-border); border-radius: 11px;
        padding: 10px 13px; color: var(--input-text); font-size: 13.5px; outline: none; transition: border-color 0.15s, background 0.15s; }
      .composer input:focus { border-color: rgba(53,189,240,0.55); background: var(--input-focus-bg); }
      .composer input::placeholder { color: var(--input-placeholder); }
      .composer button {
        background: linear-gradient(135deg, var(--brand-1), var(--brand-2)); border: none; color: white; border-radius: 11px;
        width: 42px; cursor: pointer; display: flex; align-items: center; justify-content: center;
        transition: transform 0.15s, opacity 0.2s, filter 0.15s; box-shadow: 0 2px 10px rgba(18,165,224,0.3);
      }
      .composer button:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }
      .composer button:active:not(:disabled) { transform: scale(0.94); }
      .composer button:disabled { opacity: 0.35; cursor: default; box-shadow: none; }


      @media (prefers-reduced-motion: reduce) {
        .avatar-ring, .bubble.typing em, .status-dot, .launcher { animation: none !important; }
      }

      @media (max-width: 480px) {
        .panel { bottom: 0; right: 0; left: 0; width: 100%; max-width: 100%; height: 100%; max-height: 100%; border-radius: 0; }
        .launcher { bottom: 18px; ${t}: 18px; ${n}: auto; }
      }
    `}})();})();
