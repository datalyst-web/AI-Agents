"use strict";(()=>{var I={DARK:{"--panel-bg":"#0c0d13","--text-primary":"#ffffff","--text-secondary":"rgba(255,255,255,0.45)","--text-muted":"rgba(255,255,255,0.28)","--header-border":"rgba(255,255,255,0.07)","--bubble-agent-bg":"rgba(255,255,255,0.06)","--bubble-agent-border":"rgba(255,255,255,0.06)","--bubble-agent-text":"#f2f3f7","--input-bg":"rgba(255,255,255,0.06)","--input-border":"rgba(255,255,255,0.1)","--input-focus-bg":"rgba(255,255,255,0.08)","--input-text":"#ffffff","--input-placeholder":"rgba(255,255,255,0.32)","--composer-border":"rgba(255,255,255,0.07)","--composer-bg":"rgba(255,255,255,0.02)","--close-icon":"rgba(255,255,255,0.4)","--close-hover-bg":"rgba(255,255,255,0.08)","--footer-text":"rgba(255,255,255,0.25)","--footer-brand-text":"rgba(255,255,255,0.4)","--scrollbar-thumb":"rgba(255,255,255,0.12)","--panel-shadow":"0 24px 70px rgba(0,0,0,0.5), 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.07) inset","--header-glow":"rgba(114,136,255,0.25)"},LIGHT:{"--panel-bg":"#ffffff","--text-primary":"#0f1330","--text-secondary":"rgba(15,19,48,0.55)","--text-muted":"rgba(15,19,48,0.4)","--header-border":"rgba(15,19,48,0.08)","--bubble-agent-bg":"rgba(15,19,48,0.045)","--bubble-agent-border":"rgba(15,19,48,0.07)","--bubble-agent-text":"#0f1330","--input-bg":"rgba(15,19,48,0.035)","--input-border":"rgba(15,19,48,0.12)","--input-focus-bg":"rgba(15,19,48,0.05)","--input-text":"#0f1330","--input-placeholder":"rgba(15,19,48,0.38)","--composer-border":"rgba(15,19,48,0.08)","--composer-bg":"rgba(15,19,48,0.015)","--close-icon":"rgba(15,19,48,0.45)","--close-hover-bg":"rgba(15,19,48,0.06)","--footer-text":"rgba(15,19,48,0.32)","--footer-brand-text":"rgba(15,19,48,0.5)","--scrollbar-thumb":"rgba(15,19,48,0.14)","--panel-shadow":"0 24px 70px rgba(20,27,77,0.16), 0 4px 16px rgba(20,27,77,0.1), 0 0 0 1px rgba(15,19,48,0.06) inset","--header-glow":"rgba(114,136,255,0.14)"}};(function(){let b=document.currentScript,g=b?.dataset.agentId;if(!g){console.error("[chat-widget] missing data-agent-id on the embed <script> tag.");return}let v=b?.dataset.apiBase??new URL(b?.src??"",location.href).origin,S=b?.dataset.position==="left"?"left":"right",y=`chat-agent:${g}`,h=JSON.parse(localStorage.getItem(y)??"{}"),w=h.sessionCookie??crypto.randomUUID(),x=h.conversationId;function M(){localStorage.setItem(y,JSON.stringify({conversationId:x,sessionCookie:w}))}let u=document.createElement("div");u.id="chat-agent-widget-root",document.body.appendChild(u);let r=u.attachShadow({mode:"open"});r.innerHTML=`
    <style>${q(S)}</style>
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
        <div class="avatar-wrap">
          <img class="avatar" hidden />
          <svg class="avatar-fallback" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
        </div>
        <div class="header-text">
          <div class="name"></div>
          <div class="status"><span class="status-dot"></span>Online now</div>
        </div>
        <button class="close" aria-label="Close chat">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 5l14 14M19 5L5 19" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="messages"></div>
      <div class="confirmation" hidden></div>
      <form class="composer">
        <input type="text" placeholder="Type a message\u2026" autocomplete="off" />
        <button type="submit" aria-label="Send" disabled>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
        </button>
      </form>
      <div class="footer">Powered by <span class="footer-brand">Datalyst Africa</span></div>
    </div>
  `;let s=r.querySelector(".launcher"),f=r.querySelector(".panel"),z=r.querySelector(".close"),l=r.querySelector(".messages"),d=r.querySelector(".confirmation"),H=r.querySelector(".composer"),p=r.querySelector("input"),k=r.querySelector(".composer button"),$=r.querySelector(".name"),T=r.querySelector(".avatar"),B=r.querySelector(".avatar-fallback");p.addEventListener("input",()=>{k.disabled=p.value.trim().length===0});let i,m=!1;function P(e){let t=I[e??"DARK"];for(let[a,n]of Object.entries(t))u.style.setProperty(a,n)}async function N(){let e=await fetch(`${v}/v1/widget-config/${g}`);if(!e.ok)throw new Error(`widget-config fetch failed: ${e.status}`);i=await e.json(),P(i.theme),$.textContent=i.name;let t=i.logoUrl||i.avatarUrl;t&&(T.src=t,T.hidden=!1,B.hidden=!0),h.conversationId||c("agent",i.greeting)}let C;function E(e){m=e,clearTimeout(C),s.classList.toggle("open",e),e&&s.classList.remove("invite"),e?(f.hidden=!1,requestAnimationFrame(()=>f.classList.add("open")),p.focus()):(f.classList.remove("open"),C=setTimeout(()=>{m||(f.hidden=!0)},200))}s.addEventListener("click",()=>E(!m)),z.addEventListener("click",()=>E(!1)),setTimeout(()=>{m||s.classList.add("invite")},900),s.addEventListener("animationend",e=>{e.animationName==="sonarPing"&&s.classList.remove("invite")});function c(e,t){let a=document.createElement("div");a.className=`row ${e}`;let n=document.createElement("div");n.className=`bubble ${e}`,n.textContent=t;let o=document.createElement("div");o.className="timestamp",o.textContent=new Date().toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}),a.append(n,o),l.appendChild(a),l.scrollTop=l.scrollHeight}function Y(e){d.hidden=!1,d.innerHTML="";let t=document.createElement("div");t.className="confirmation-text",t.textContent=e.confirmationPrompt;let a=document.createElement("div");a.className="confirmation-actions";let n=document.createElement("button");n.textContent="Confirm",n.className="confirm",n.onclick=()=>{d.hidden=!0,L("",{confirmToolCallId:e.toolCallId})};let o=document.createElement("button");o.textContent="Cancel",o.className="cancel",o.onclick=()=>{d.hidden=!0,c("agent","No problem, I won't go ahead with that.")},a.append(n,o),d.append(t,a)}async function L(e,t){if(!i)return;e&&c("customer",e);let a=document.createElement("div");a.className="row agent",a.innerHTML='<div class="bubble agent typing"><span></span><span></span><span></span></div>',l.appendChild(a),l.scrollTop=l.scrollHeight;try{let n=await fetch(`${v}/v1/chat/${g}/messages`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${i.widgetToken}`},body:JSON.stringify({conversationId:x,message:e||"(customer confirmed the pending action)",customerIdentifier:{type:"widget_session_cookie",value:w},...t})});if(a.remove(),!n.ok){c("agent","Sorry, I'm having trouble responding right now. Please try again shortly.");return}let o=await n.json();x=o.conversationId,M(),o.reply&&c("agent",o.reply),o.pendingConfirmation&&Y(o.pendingConfirmation)}catch{a.remove(),c("agent","Sorry, I'm having trouble responding right now. Please try again shortly.")}}H.addEventListener("submit",e=>{e.preventDefault();let t=p.value.trim();t&&(p.value="",k.disabled=!0,L(t))}),N();function q(e){let t=e==="left"?"left":"right",a=e==="left"?"right":"left";return`
      :host, * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; }
      :host {
        --brand-1: #7288ff; --brand-2: #4a5ef5; --brand-3: #a21caf;
        ${Object.entries(I.DARK).map(([n,o])=>`${n}: ${o};`).join(" ")}
      }

      @keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes panelIn { from { opacity: 0; transform: translateY(16px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
      @keyframes pulseDot { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
      @keyframes typingBounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.5; } 30% { transform: translateY(-3px); opacity: 1; } }
      @keyframes launcherPop { 0% { opacity: 0; transform: scale(0.4) translateY(12px); } 60% { opacity: 1; transform: scale(1.08) translateY(0); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
      @keyframes sonarPing { 0% { box-shadow: 0 0 0 0 rgba(74,94,245,0.45); } 100% { box-shadow: 0 0 0 22px rgba(74,94,245,0); } }
      @keyframes bobIdle { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }

      .launcher {
        position: fixed; bottom: 24px; ${t}: 24px; ${a}: auto; width: 60px; height: 60px; border-radius: 50%;
        background: linear-gradient(135deg, var(--brand-1), var(--brand-2) 55%, var(--brand-3));
        background-size: 160% auto; background-position: left center;
        color: white; display: flex; align-items: center; justify-content: center; cursor: pointer;
        box-shadow: 0 4px 14px rgba(74,94,245,0.3), 0 12px 32px rgba(74,94,245,0.28), 0 0 0 1px rgba(255,255,255,0.08) inset;
        z-index: 999999;
        /* Plays automatically the instant this element mounts \u2014 no JS
           gating needed for the entrance itself, so it can never get stuck
           invisible if a later script hook fails to run. */
        animation: launcherPop 0.55s cubic-bezier(0.34,1.56,0.64,1) both, bobIdle 3.2s ease-in-out 0.6s infinite;
        transition: transform 0.2s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.25s ease, background-position 0.3s ease;
      }
      .launcher.invite { animation: launcherPop 0.55s cubic-bezier(0.34,1.56,0.64,1) both, sonarPing 1.6s ease-out 3, bobIdle 3.2s ease-in-out 0.6s infinite; }
      .launcher:hover { animation-play-state: paused; transform: scale(1.07); background-position: right center; box-shadow: 0 6px 18px rgba(74,94,245,0.4), 0 16px 40px rgba(74,94,245,0.32), 0 0 0 1px rgba(255,255,255,0.1) inset; }
      .launcher:active { transform: scale(0.96); }
      .launcher.open { animation: none; transform: scale(1); }
      .launcher .icon-chat, .launcher .icon-close { position: absolute; transition: opacity 0.18s ease, transform 0.25s cubic-bezier(0.34,1.56,0.64,1); }
      .launcher .icon-close { opacity: 0; transform: rotate(-45deg) scale(0.6); }
      .launcher.open .icon-chat { opacity: 0; transform: rotate(45deg) scale(0.6); }
      .launcher.open .icon-close { opacity: 1; transform: rotate(0) scale(1); }

      .panel {
        position: fixed; bottom: 96px; ${t}: 24px; ${a}: auto; width: 372px; max-width: calc(100vw - 32px); height: 580px;
        max-height: calc(100vh - 120px); background: var(--panel-bg); border-radius: 20px;
        box-shadow: var(--panel-shadow);
        display: flex; flex-direction: column; overflow: hidden; z-index: 999999;
        opacity: 0; transform: translateY(16px) scale(0.97); transform-origin: bottom ${t};
        transition: opacity 0.22s cubic-bezier(0.16,1,0.3,1), transform 0.22s cubic-bezier(0.16,1,0.3,1), background 0.2s ease;
      }
      .panel.open { opacity: 1; transform: translateY(0) scale(1); }

      .header { position: relative; display: flex; align-items: center; gap: 11px; padding: 16px; overflow: hidden;
        background: linear-gradient(180deg, rgba(128,128,128,0.06), rgba(128,128,128,0) 100%); border-bottom: 1px solid var(--header-border); }
      .header-glow { position: absolute; top: -40px; left: -20px; width: 140px; height: 140px; border-radius: 50%;
        background: radial-gradient(circle, var(--header-glow), transparent 70%); pointer-events: none; }
      .avatar-wrap { position: relative; width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0;
        background: linear-gradient(135deg, var(--brand-1), var(--brand-3)); display: flex; align-items: center; justify-content: center;
        box-shadow: 0 0 0 2px rgba(128,128,128,0.15); }
      .avatar { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
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
      .bubble.customer { background: linear-gradient(135deg, var(--brand-1), var(--brand-2)); color: white; border-bottom-right-radius: 4px; box-shadow: 0 2px 10px rgba(74,94,245,0.25); }
      .timestamp { font-size: 10px; color: var(--text-muted); margin-top: 4px; padding: 0 3px; }

      .bubble.typing { display: flex; align-items: center; gap: 4px; padding: 12px 14px; }
      .bubble.typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--text-secondary); animation: typingBounce 1.2s ease-in-out infinite; }
      .bubble.typing span:nth-child(2) { animation-delay: 0.15s; }
      .bubble.typing span:nth-child(3) { animation-delay: 0.3s; }

      .confirmation { padding: 12px 16px; background: rgba(232,165,61,0.08); border-top: 1px solid rgba(232,165,61,0.25); animation: fadeInUp 0.2s ease both; }
      .confirmation-text { color: var(--bubble-agent-text); font-size: 12.5px; margin-bottom: 9px; line-height: 1.4; }
      .confirmation-actions { display: flex; gap: 8px; }
      .confirmation-actions button { flex: 1; padding: 8px; border-radius: 9px; border: none; font-size: 12.5px; cursor: pointer; font-weight: 600; transition: filter 0.15s, transform 0.15s; }
      .confirmation-actions button:hover { filter: brightness(1.1); }
      .confirmation-actions button:active { transform: scale(0.97); }
      .confirmation-actions .confirm { background: #2fbf71; color: white; }
      .confirmation-actions .cancel { background: var(--input-bg); color: var(--bubble-agent-text); }

      .composer { display: flex; gap: 8px; padding: 13px; border-top: 1px solid var(--composer-border); background: var(--composer-bg); }
      .composer input { flex: 1; background: var(--input-bg); border: 1px solid var(--input-border); border-radius: 11px;
        padding: 10px 13px; color: var(--input-text); font-size: 13.5px; outline: none; transition: border-color 0.15s, background 0.15s; }
      .composer input:focus { border-color: rgba(114,136,255,0.55); background: var(--input-focus-bg); }
      .composer input::placeholder { color: var(--input-placeholder); }
      .composer button {
        background: linear-gradient(135deg, var(--brand-1), var(--brand-2)); border: none; color: white; border-radius: 11px;
        width: 42px; cursor: pointer; display: flex; align-items: center; justify-content: center;
        transition: transform 0.15s, opacity 0.2s, filter 0.15s; box-shadow: 0 2px 10px rgba(74,94,245,0.3);
      }
      .composer button:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }
      .composer button:active:not(:disabled) { transform: scale(0.94); }
      .composer button:disabled { opacity: 0.35; cursor: default; box-shadow: none; }

      .footer { text-align: center; font-size: 10.5px; color: var(--footer-text); padding: 7px 0 11px; letter-spacing: 0.01em; }
      .footer-brand { color: var(--footer-brand-text); font-weight: 600; }

      @media (max-width: 480px) {
        .panel { bottom: 0; right: 0; left: 0; width: 100%; max-width: 100%; height: 100%; max-height: 100%; border-radius: 0; }
        .launcher { bottom: 18px; ${t}: 18px; ${a}: auto; }
      }
    `}})();})();
