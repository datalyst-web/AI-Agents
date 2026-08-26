"use strict";(()=>{(function(){let b=document.currentScript,p=b?.dataset.agentId;if(!p){console.error("[chat-widget] missing data-agent-id on the embed <script> tag.");return}let x=b?.dataset.apiBase??new URL(b?.src??"",location.href).origin,v=`chat-agent:${p}`,f=JSON.parse(localStorage.getItem(v)??"{}"),w=f.sessionCookie??crypto.randomUUID(),m=f.conversationId;function I(){localStorage.setItem(v,JSON.stringify({conversationId:m,sessionCookie:w}))}let u=document.createElement("div");u.id="chat-agent-widget-root",document.body.appendChild(u);let n=u.attachShadow({mode:"open"});n.innerHTML=`
    <style>${q()}</style>
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
  `;let y=n.querySelector(".launcher"),g=n.querySelector(".panel"),S=n.querySelector(".close"),s=n.querySelector(".messages"),l=n.querySelector(".confirmation"),M=n.querySelector(".composer"),d=n.querySelector("input"),k=n.querySelector(".composer button"),z=n.querySelector(".name"),C=n.querySelector(".avatar"),B=n.querySelector(".avatar-fallback");d.addEventListener("input",()=>{k.disabled=d.value.trim().length===0});let i,h=!1;async function H(){let e=await fetch(`${x}/v1/widget-config/${p}`);if(!e.ok)throw new Error(`widget-config fetch failed: ${e.status}`);i=await e.json(),z.textContent=i.name,i.avatarUrl&&(C.src=i.avatarUrl,C.hidden=!1,B.hidden=!0),f.conversationId||c("agent",i.greeting)}let E;function T(e){h=e,clearTimeout(E),y.classList.toggle("open",e),e?(g.hidden=!1,requestAnimationFrame(()=>g.classList.add("open")),d.focus()):(g.classList.remove("open"),E=setTimeout(()=>{h||(g.hidden=!0)},200))}y.addEventListener("click",()=>T(!h)),S.addEventListener("click",()=>T(!1));function c(e,r){let o=document.createElement("div");o.className=`row ${e}`;let a=document.createElement("div");a.className=`bubble ${e}`,a.textContent=r;let t=document.createElement("div");t.className="timestamp",t.textContent=new Date().toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}),o.append(a,t),s.appendChild(o),s.scrollTop=s.scrollHeight}function N(e){l.hidden=!1,l.innerHTML="";let r=document.createElement("div");r.className="confirmation-text",r.textContent=e.confirmationPrompt;let o=document.createElement("div");o.className="confirmation-actions";let a=document.createElement("button");a.textContent="Confirm",a.className="confirm",a.onclick=()=>{l.hidden=!0,L("",{confirmToolCallId:e.toolCallId})};let t=document.createElement("button");t.textContent="Cancel",t.className="cancel",t.onclick=()=>{l.hidden=!0,c("agent","No problem, I won't go ahead with that.")},o.append(a,t),l.append(r,o)}async function L(e,r){if(!i)return;e&&c("customer",e);let o=document.createElement("div");o.className="row agent",o.innerHTML='<div class="bubble agent typing"><span></span><span></span><span></span></div>',s.appendChild(o),s.scrollTop=s.scrollHeight;try{let a=await fetch(`${x}/v1/chat/${p}/messages`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${i.widgetToken}`},body:JSON.stringify({conversationId:m,message:e||"(customer confirmed the pending action)",customerIdentifier:{type:"widget_session_cookie",value:w},...r})});if(o.remove(),!a.ok){c("agent","Sorry, I'm having trouble responding right now. Please try again shortly.");return}let t=await a.json();m=t.conversationId,I(),t.reply&&c("agent",t.reply),t.pendingConfirmation&&N(t.pendingConfirmation)}catch{o.remove(),c("agent","Sorry, I'm having trouble responding right now. Please try again shortly.")}}M.addEventListener("submit",e=>{e.preventDefault();let r=d.value.trim();r&&(d.value="",k.disabled=!0,L(r))}),H();function q(){return`
      :host, * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; }
      :host { --brand-1: #7288ff; --brand-2: #4a5ef5; --brand-3: #a21caf; }

      @keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes panelIn { from { opacity: 0; transform: translateY(16px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
      @keyframes pulseDot { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
      @keyframes typingBounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.5; } 30% { transform: translateY(-3px); opacity: 1; } }

      .launcher {
        position: fixed; bottom: 24px; right: 24px; width: 60px; height: 60px; border-radius: 50%;
        background: linear-gradient(135deg, var(--brand-1), var(--brand-2) 55%, var(--brand-3));
        background-size: 160% auto; background-position: left center;
        color: white; display: flex; align-items: center; justify-content: center; cursor: pointer;
        box-shadow: 0 4px 14px rgba(74,94,245,0.3), 0 12px 32px rgba(74,94,245,0.28), 0 0 0 1px rgba(255,255,255,0.08) inset;
        z-index: 999999; transition: transform 0.2s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.25s ease, background-position 0.3s ease;
      }
      .launcher:hover { transform: scale(1.07); background-position: right center; box-shadow: 0 6px 18px rgba(74,94,245,0.4), 0 16px 40px rgba(74,94,245,0.32), 0 0 0 1px rgba(255,255,255,0.1) inset; }
      .launcher:active { transform: scale(0.96); }
      .launcher .icon-chat, .launcher .icon-close { position: absolute; transition: opacity 0.18s ease, transform 0.25s cubic-bezier(0.34,1.56,0.64,1); }
      .launcher .icon-close { opacity: 0; transform: rotate(-45deg) scale(0.6); }
      .launcher.open .icon-chat { opacity: 0; transform: rotate(45deg) scale(0.6); }
      .launcher.open .icon-close { opacity: 1; transform: rotate(0) scale(1); }

      .panel {
        position: fixed; bottom: 96px; right: 24px; width: 372px; max-width: calc(100vw - 32px); height: 580px;
        max-height: calc(100vh - 120px); background: #0c0d13; border-radius: 20px;
        box-shadow: 0 24px 70px rgba(0,0,0,0.5), 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.07) inset;
        display: flex; flex-direction: column; overflow: hidden; z-index: 999999;
        opacity: 0; transform: translateY(16px) scale(0.97); transform-origin: bottom right;
        transition: opacity 0.22s cubic-bezier(0.16,1,0.3,1), transform 0.22s cubic-bezier(0.16,1,0.3,1);
      }
      .panel.open { opacity: 1; transform: translateY(0) scale(1); }

      .header { position: relative; display: flex; align-items: center; gap: 11px; padding: 16px; overflow: hidden;
        background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0) 100%); border-bottom: 1px solid rgba(255,255,255,0.07); }
      .header-glow { position: absolute; top: -40px; left: -20px; width: 140px; height: 140px; border-radius: 50%;
        background: radial-gradient(circle, rgba(114,136,255,0.25), transparent 70%); pointer-events: none; }
      .avatar-wrap { position: relative; width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0;
        background: linear-gradient(135deg, var(--brand-1), var(--brand-3)); display: flex; align-items: center; justify-content: center;
        box-shadow: 0 0 0 2px rgba(255,255,255,0.08); }
      .avatar { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
      .avatar-fallback { color: rgba(255,255,255,0.9); }
      .header-text { flex: 1; min-width: 0; position: relative; }
      .name { color: #fff; font-weight: 600; font-size: 14.5px; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .status { display: flex; align-items: center; gap: 5px; color: rgba(255,255,255,0.45); font-size: 11.5px; margin-top: 1px; }
      .status-dot { width: 6px; height: 6px; border-radius: 50%; background: #2fbf71; box-shadow: 0 0 6px #2fbf71; animation: pulseDot 2s ease-in-out infinite; }
      .close { position: relative; background: none; border: none; color: rgba(255,255,255,0.4); cursor: pointer; line-height: 1;
        display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 8px; transition: background 0.15s, color 0.15s; }
      .close:hover { background: rgba(255,255,255,0.08); color: #fff; }

      .messages { flex: 1; overflow-y: auto; padding: 18px 16px; display: flex; flex-direction: column; gap: 4px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent; }
      .messages::-webkit-scrollbar { width: 6px; }
      .messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 999px; }

      .row { display: flex; flex-direction: column; margin-bottom: 10px; animation: fadeInUp 0.25s ease both; max-width: 84%; }
      .row.agent { align-self: flex-start; align-items: flex-start; }
      .row.customer { align-self: flex-end; align-items: flex-end; }
      .bubble { padding: 10px 13px; border-radius: 15px; font-size: 13.5px; line-height: 1.48; white-space: pre-wrap; word-break: break-word; }
      .bubble.agent { background: rgba(255,255,255,0.06); color: #f2f3f7; border: 1px solid rgba(255,255,255,0.06); border-bottom-left-radius: 4px; }
      .bubble.customer { background: linear-gradient(135deg, var(--brand-1), var(--brand-2)); color: white; border-bottom-right-radius: 4px; box-shadow: 0 2px 10px rgba(74,94,245,0.25); }
      .timestamp { font-size: 10px; color: rgba(255,255,255,0.28); margin-top: 4px; padding: 0 3px; }

      .bubble.typing { display: flex; align-items: center; gap: 4px; padding: 12px 14px; }
      .bubble.typing span { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.55); animation: typingBounce 1.2s ease-in-out infinite; }
      .bubble.typing span:nth-child(2) { animation-delay: 0.15s; }
      .bubble.typing span:nth-child(3) { animation-delay: 0.3s; }

      .confirmation { padding: 12px 16px; background: rgba(232,165,61,0.08); border-top: 1px solid rgba(232,165,61,0.25); animation: fadeInUp 0.2s ease both; }
      .confirmation-text { color: #f2f3f7; font-size: 12.5px; margin-bottom: 9px; line-height: 1.4; }
      .confirmation-actions { display: flex; gap: 8px; }
      .confirmation-actions button { flex: 1; padding: 8px; border-radius: 9px; border: none; font-size: 12.5px; cursor: pointer; font-weight: 600; transition: filter 0.15s, transform 0.15s; }
      .confirmation-actions button:hover { filter: brightness(1.1); }
      .confirmation-actions button:active { transform: scale(0.97); }
      .confirmation-actions .confirm { background: #2fbf71; color: white; }
      .confirmation-actions .cancel { background: rgba(255,255,255,0.08); color: #f2f3f7; }

      .composer { display: flex; gap: 8px; padding: 13px; border-top: 1px solid rgba(255,255,255,0.07); background: rgba(255,255,255,0.02); }
      .composer input { flex: 1; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 11px;
        padding: 10px 13px; color: #fff; font-size: 13.5px; outline: none; transition: border-color 0.15s, background 0.15s; }
      .composer input:focus { border-color: rgba(114,136,255,0.55); background: rgba(255,255,255,0.08); }
      .composer input::placeholder { color: rgba(255,255,255,0.32); }
      .composer button {
        background: linear-gradient(135deg, var(--brand-1), var(--brand-2)); border: none; color: white; border-radius: 11px;
        width: 42px; cursor: pointer; display: flex; align-items: center; justify-content: center;
        transition: transform 0.15s, opacity 0.2s, filter 0.15s; box-shadow: 0 2px 10px rgba(74,94,245,0.3);
      }
      .composer button:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }
      .composer button:active:not(:disabled) { transform: scale(0.94); }
      .composer button:disabled { opacity: 0.35; cursor: default; box-shadow: none; }

      .footer { text-align: center; font-size: 10.5px; color: rgba(255,255,255,0.25); padding: 7px 0 11px; letter-spacing: 0.01em; }
      .footer-brand { color: rgba(255,255,255,0.4); font-weight: 600; }

      @media (max-width: 480px) {
        .panel { bottom: 0; right: 0; left: 0; width: 100%; max-width: 100%; height: 100%; max-height: 100%; border-radius: 0; }
        .launcher { bottom: 18px; right: 18px; }
      }
    `}})();})();
