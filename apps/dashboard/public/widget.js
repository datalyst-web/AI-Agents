"use strict";(()=>{(function(){let g=document.currentScript,d=g?.dataset.agentId;if(!d){console.error("[chat-widget] missing data-agent-id on the embed <script> tag.");return}let h=g?.dataset.apiBase??new URL(g?.src??"",location.href).origin,b=`chat-agent:${d}`,p=JSON.parse(localStorage.getItem(b)??"{}"),x=p.sessionCookie??crypto.randomUUID(),f=p.conversationId;function k(){localStorage.setItem(b,JSON.stringify({conversationId:f,sessionCookie:x}))}let m=document.createElement("div");m.id="chat-agent-widget-root",document.body.appendChild(m);let o=m.attachShadow({mode:"open"});o.innerHTML=`
    <style>${N()}</style>
    <div class="launcher" part="launcher" aria-label="Open chat">
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      </svg>
    </div>
    <div class="panel" hidden>
      <div class="header">
        <img class="avatar" hidden />
        <div class="header-text">
          <div class="name"></div>
          <div class="status">Online</div>
        </div>
        <button class="close" aria-label="Close chat">&times;</button>
      </div>
      <div class="messages"></div>
      <div class="confirmation" hidden></div>
      <form class="composer">
        <input type="text" placeholder="Type a message..." autocomplete="off" />
        <button type="submit" aria-label="Send">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
        </button>
      </form>
      <div class="footer">Powered by ${z(location.hostname)}</div>
    </div>
  `;let v=o.querySelector(".launcher"),E=o.querySelector(".panel"),I=o.querySelector(".close"),s=o.querySelector(".messages"),l=o.querySelector(".confirmation"),S=o.querySelector(".composer"),u=o.querySelector("input"),T=o.querySelector(".name"),y=o.querySelector(".avatar"),r,L=!1;async function M(){let e=await fetch(`${h}/v1/widget-config/${d}`);if(!e.ok)throw new Error(`widget-config fetch failed: ${e.status}`);r=await e.json(),T.textContent=r.name,r.avatarUrl&&(y.src=r.avatarUrl,y.hidden=!1),p.conversationId||c("agent",r.greeting)}function w(e){L=e,E.hidden=!e,v.classList.toggle("hidden",e),e&&u.focus()}v.addEventListener("click",()=>w(!0)),I.addEventListener("click",()=>w(!1));function c(e,t){let n=document.createElement("div");n.className=`bubble ${e}`,n.textContent=t,s.appendChild(n),s.scrollTop=s.scrollHeight}function H(e){l.hidden=!1,l.innerHTML="";let t=document.createElement("div");t.className="confirmation-text",t.textContent=e.confirmationPrompt;let n=document.createElement("div");n.className="confirmation-actions";let a=document.createElement("button");a.textContent="Confirm",a.className="confirm",a.onclick=()=>{l.hidden=!0,C("",{confirmToolCallId:e.toolCallId})};let i=document.createElement("button");i.textContent="Cancel",i.className="cancel",i.onclick=()=>{l.hidden=!0,c("agent","No problem, I won't go ahead with that.")},n.append(a,i),l.append(t,n)}async function C(e,t){if(!r)return;e&&c("customer",e);let n=document.createElement("div");n.className="bubble agent typing",n.textContent="...",s.appendChild(n),s.scrollTop=s.scrollHeight;try{let a=await fetch(`${h}/v1/chat/${d}/messages`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${r.widgetToken}`},body:JSON.stringify({conversationId:f,message:e||"(customer confirmed the pending action)",customerIdentifier:{type:"widget_session_cookie",value:x},...t})});if(n.remove(),!a.ok){c("agent","Sorry, I'm having trouble responding right now. Please try again shortly.");return}let i=await a.json();f=i.conversationId,k(),i.reply&&c("agent",i.reply),i.pendingConfirmation&&H(i.pendingConfirmation)}catch{n.remove(),c("agent","Sorry, I'm having trouble responding right now. Please try again shortly.")}}S.addEventListener("submit",e=>{e.preventDefault();let t=u.value.trim();t&&(u.value="",C(t))}),M();function z(e){return e.replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t]??t)}function N(){return`
      :host, * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; }
      .launcher {
        position: fixed; bottom: 24px; right: 24px; width: 58px; height: 58px; border-radius: 50%;
        background: linear-gradient(135deg, #4a5ef5, #3742d6); color: white; display: flex; align-items: center;
        justify-content: center; cursor: pointer; box-shadow: 0 8px 24px rgba(74,94,245,0.35); z-index: 999999;
        transition: transform 0.15s ease;
      }
      .launcher:hover { transform: scale(1.06); }
      .launcher.hidden { display: none; }
      .panel {
        position: fixed; bottom: 24px; right: 24px; width: 360px; max-width: calc(100vw - 32px); height: 560px;
        max-height: calc(100vh - 48px); background: #0f1117; border-radius: 18px; box-shadow: 0 20px 60px rgba(0,0,0,0.35);
        display: flex; flex-direction: column; overflow: hidden; z-index: 999999; border: 1px solid rgba(255,255,255,0.08);
      }
      .header { display: flex; align-items: center; gap: 10px; padding: 14px 16px; background: rgba(255,255,255,0.03); border-bottom: 1px solid rgba(255,255,255,0.06); }
      .avatar { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; }
      .header-text { flex: 1; }
      .name { color: #fff; font-weight: 600; font-size: 14px; }
      .status { color: #2fbf71; font-size: 11px; }
      .close { background: none; border: none; color: rgba(255,255,255,0.5); font-size: 22px; cursor: pointer; line-height: 1; }
      .messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
      .bubble { max-width: 82%; padding: 10px 13px; border-radius: 14px; font-size: 13.5px; line-height: 1.45; white-space: pre-wrap; }
      .bubble.agent { align-self: flex-start; background: rgba(255,255,255,0.07); color: #f2f3f7; border-bottom-left-radius: 4px; }
      .bubble.customer { align-self: flex-end; background: #4a5ef5; color: white; border-bottom-right-radius: 4px; }
      .bubble.typing { opacity: 0.5; }
      .confirmation { padding: 10px 16px; background: rgba(232,165,61,0.08); border-top: 1px solid rgba(232,165,61,0.25); }
      .confirmation-text { color: #f2f3f7; font-size: 12.5px; margin-bottom: 8px; }
      .confirmation-actions { display: flex; gap: 8px; }
      .confirmation-actions button { flex: 1; padding: 7px; border-radius: 8px; border: none; font-size: 12.5px; cursor: pointer; font-weight: 600; }
      .confirmation-actions .confirm { background: #2fbf71; color: white; }
      .confirmation-actions .cancel { background: rgba(255,255,255,0.08); color: #f2f3f7; }
      .composer { display: flex; gap: 8px; padding: 12px; border-top: 1px solid rgba(255,255,255,0.06); }
      .composer input { flex: 1; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 10px 12px; color: #fff; font-size: 13.5px; outline: none; }
      .composer input::placeholder { color: rgba(255,255,255,0.35); }
      .composer button { background: #4a5ef5; border: none; color: white; border-radius: 10px; width: 40px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
      .footer { text-align: center; font-size: 10px; color: rgba(255,255,255,0.25); padding: 6px 0 10px; }
    `}})();})();
