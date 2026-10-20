"use strict";(()=>{var ne={DARK:{"--panel-bg":"#0c0d13","--text-primary":"#ffffff","--text-secondary":"rgba(255,255,255,0.45)","--text-muted":"rgba(255,255,255,0.28)","--header-border":"rgba(255,255,255,0.07)","--bubble-agent-bg":"rgba(255,255,255,0.06)","--bubble-agent-border":"rgba(255,255,255,0.06)","--bubble-agent-text":"#f2f3f7","--input-bg":"rgba(255,255,255,0.06)","--input-border":"rgba(255,255,255,0.1)","--input-focus-bg":"rgba(255,255,255,0.08)","--input-text":"#ffffff","--input-placeholder":"rgba(255,255,255,0.32)","--composer-border":"rgba(255,255,255,0.07)","--composer-bg":"rgba(255,255,255,0.02)","--close-icon":"rgba(255,255,255,0.4)","--close-hover-bg":"rgba(255,255,255,0.08)","--scrollbar-thumb":"rgba(255,255,255,0.12)","--panel-shadow":"0 24px 70px rgba(0,0,0,0.5), 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.07) inset","--header-glow":"rgba(53,189,240,0.25)"},LIGHT:{"--panel-bg":"#ffffff","--text-primary":"#0f1330","--text-secondary":"rgba(15,19,48,0.55)","--text-muted":"rgba(15,19,48,0.4)","--header-border":"rgba(15,19,48,0.08)","--bubble-agent-bg":"rgba(15,19,48,0.045)","--bubble-agent-border":"rgba(15,19,48,0.07)","--bubble-agent-text":"#0f1330","--input-bg":"rgba(15,19,48,0.035)","--input-border":"rgba(15,19,48,0.12)","--input-focus-bg":"rgba(15,19,48,0.05)","--input-text":"#0f1330","--input-placeholder":"rgba(15,19,48,0.38)","--composer-border":"rgba(15,19,48,0.08)","--composer-bg":"rgba(15,19,48,0.015)","--close-icon":"rgba(15,19,48,0.45)","--close-hover-bg":"rgba(15,19,48,0.06)","--scrollbar-thumb":"rgba(15,19,48,0.14)","--panel-shadow":"0 24px 70px rgba(20,27,77,0.16), 0 4px 16px rgba(20,27,77,0.1), 0 0 0 1px rgba(15,19,48,0.06) inset","--header-glow":"rgba(53,189,240,0.14)"}};(function(){let k=document.currentScript,b=k?.dataset.agentId;if(!b){console.error("[chat-widget] missing data-agent-id on the embed <script> tag.");return}let T=k?.dataset.apiBase??new URL(k?.src??"",location.href).origin,oe=k?.dataset.position==="left"?"left":"right",F=`chat-agent:${b}`,L=JSON.parse(localStorage.getItem(F)??"{}"),Y=L.sessionCookie??crypto.randomUUID(),c=L.conversationId,z=L.csatSubmittedFor;function U(){localStorage.setItem(F,JSON.stringify({conversationId:c,sessionCookie:Y,csatSubmittedFor:z}))}let f=document.createElement("div");f.id="chat-agent-widget-root",f.style.display="none",document.body.appendChild(f);let i=f.attachShadow({mode:"open"});i.innerHTML=`
    <style>${Se(oe)}</style>
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
      <div class="voice-hint" role="status" aria-live="polite" hidden></div>
      <form class="composer">
        <input type="text" placeholder="Type a message\u2026" autocomplete="off" />
        <button type="button" class="mic" aria-label="Speak your message" aria-pressed="false" title="Speak instead of typing" hidden>
          <svg class="mic-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5"/>
          </svg>
          <span class="wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
        </button>
        <button type="submit" class="send" aria-label="Send" disabled>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
        </button>
      </form>
    </div>
  `;let r=i.querySelector(".launcher"),d=i.querySelector(".panel"),ae=i.querySelector(".close"),p=i.querySelector(".messages"),x=i.querySelector(".confirmation"),S=i.querySelector(".csat"),E=i.querySelectorAll(".csat-star"),re=i.querySelector(".csat-skip"),W=i.querySelector(".composer"),s=i.querySelector("input"),P=i.querySelector(".composer .send"),y=i.querySelector(".composer .mic"),m=i.querySelector(".voice-hint"),ie=i.querySelector(".name"),D=i.querySelector(".avatar"),se=i.querySelector(".avatar-fallback");s.addEventListener("input",()=>{P.disabled=s.value.trim().length===0});let l,w=!1;function le(e){let t=ne[e??"LIGHT"];for(let[n,o]of Object.entries(t))f.style.setProperty(n,o)}async function ce(){let e=await fetch(`${T}/v1/widget-config/${b}`);if(!e.ok)throw Object.assign(new Error(`widget-config fetch failed: ${e.status}`),{status:e.status});l=await e.json(),le(l.theme),ie.textContent=l.name;let t=l.logoUrl||l.avatarUrl;t&&(D.src=t,D.hidden=!1,se.hidden=!0),L.conversationId||h("agent",l.greeting)}let _;function R(e){w=e,clearTimeout(_),r.classList.toggle("open",e),e&&r.classList.remove("invite"),e?(d.hidden=!1,X(),requestAnimationFrame(()=>d.classList.add("open")),s.focus()):(g?.abort(),d.classList.remove("open"),_=setTimeout(()=>{w||(d.hidden=!0)},200))}function de(){return!c||z===c||!S.hidden?!1:(S.hidden=!1,E.forEach(e=>e.classList.remove("filled")),!0)}async function J(e){if(S.hidden=!0,e!==null&&c&&l){z=c,U();try{await fetch(`${T}/v1/chat/${b}/conversations/${c}/csat`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${l.widgetToken}`},body:JSON.stringify({score:e})})}catch{}}R(!1)}E.forEach(e=>{e.addEventListener("mouseenter",()=>{let t=Number(e.dataset.score);E.forEach(n=>n.classList.toggle("filled",Number(n.dataset.score)<=t))}),e.addEventListener("click",()=>void J(Number(e.dataset.score)))}),S.addEventListener("mouseleave",()=>E.forEach(e=>e.classList.remove("filled"))),re.addEventListener("click",()=>void J(null));let G=6,V=`chat-agent:pos:${b}`,M=!1,v=!1,B=0,N=0;function pe(e,t){let n=r.offsetWidth||60,o=8;return{x:Math.min(Math.max(e,o),Math.max(o,window.innerWidth-n-o)),y:Math.min(Math.max(t,o),Math.max(o,window.innerHeight-n-o))}}function O(e,t){let n=pe(e,t);return r.classList.add("placed"),r.style.left=`${n.x}px`,r.style.top=`${n.y}px`,r.style.right="auto",r.style.bottom="auto",X(),n}function X(){if(r.style.left==="")return;let e=r.getBoundingClientRect(),t=Math.min(372,window.innerWidth-32),n=Math.min(580,window.innerHeight-120),o=e.top>window.innerHeight/2,a=Math.min(Math.max(e.left+e.width/2-t/2,16),Math.max(16,window.innerWidth-t-16)),u=o?Math.max(16,e.top-n-12):Math.min(e.bottom+12,window.innerHeight-n-16);d.style.left=`${a}px`,d.style.top=`${Math.max(16,u)}px`,d.style.right="auto",d.style.bottom="auto",d.style.transformOrigin=o?"bottom center":"top center"}try{let e=JSON.parse(localStorage.getItem(V)||"null");e&&typeof e.x=="number"&&typeof e.y=="number"&&O(e.x,e.y)}catch{}r.addEventListener("pointerdown",e=>{let t=r.getBoundingClientRect();M=!0,v=!1,B=e.clientX-t.left,N=e.clientY-t.top,r.setPointerCapture(e.pointerId)}),r.addEventListener("pointermove",e=>{M&&(!v&&Math.abs(e.clientX-B-r.getBoundingClientRect().left)<G&&Math.abs(e.clientY-N-r.getBoundingClientRect().top)<G||(v=!0,r.classList.add("dragging"),r.classList.remove("invite"),O(e.clientX-B,e.clientY-N)))}),r.addEventListener("pointerup",e=>{if(M&&(M=!1,r.classList.remove("dragging"),r.hasPointerCapture(e.pointerId)&&r.releasePointerCapture(e.pointerId),v))try{localStorage.setItem(V,JSON.stringify({x:parseFloat(r.style.left),y:parseFloat(r.style.top)}))}catch{}}),window.addEventListener("resize",()=>{r.style.left!==""&&O(parseFloat(r.style.left),parseFloat(r.style.top))}),r.addEventListener("click",()=>{if(v){v=!1;return}R(!w)}),ae.addEventListener("click",()=>{de()||R(!1)}),r.addEventListener("animationend",e=>{e.animationName==="sonarPing"&&r.classList.remove("invite")});let ge=window.matchMedia?.("(prefers-reduced-motion: reduce)").matches??!1;function ue(e,t){if(ge){e.textContent=t;return}let n=t.split(/(\s+)/),o=Math.max(1,Math.ceil(n.length/55)),a=0,u=()=>{a=Math.min(n.length,a+o),e.textContent=n.slice(0,a).join(""),p.scrollTop=p.scrollHeight,a<n.length&&requestAnimationFrame(u)};requestAnimationFrame(u)}function h(e,t){let n=document.createElement("div");n.className=`row ${e}`;let o=document.createElement("div");o.className=`bubble ${e}`,e==="agent"?ue(o,t):o.textContent=t;let a=document.createElement("div");a.className="timestamp",a.textContent=new Date().toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}),n.append(o,a),p.appendChild(n),p.scrollTop=p.scrollHeight}function be(e){x.hidden=!1,x.innerHTML="";let t=document.createElement("div");t.className="confirmation-text",t.textContent=e.confirmationPrompt;let n=document.createElement("div");n.className="confirmation-actions";let o=document.createElement("button");o.textContent="Confirm",o.className="confirm",o.onclick=()=>{x.hidden=!0,K("",{confirmToolCallId:e.toolCallId})};let a=document.createElement("button");a.textContent="Cancel",a.className="cancel",a.onclick=()=>{x.hidden=!0,h("agent","No problem, I won't go ahead with that.")},n.append(o,a),x.append(t,n)}async function K(e,t){if(!l)return;e&&(x.hidden=!0),e&&h("customer",e);let n=document.createElement("div");n.className="row agent",n.innerHTML='<div class="bubble agent typing"><span></span><span></span><span></span><em>Thinking</em></div>',p.appendChild(n),p.scrollTop=p.scrollHeight;try{let o=await fetch(`${T}/v1/chat/${b}/messages`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${l.widgetToken}`},body:JSON.stringify({conversationId:c,message:e||"(customer confirmed the pending action)",customerIdentifier:{type:"widget_session_cookie",value:Y},...t})});if(n.remove(),!o.ok){h("agent","Sorry, I'm having trouble responding right now. Please try again shortly.");return}let a=await o.json();c=a.conversationId,U(),a.reply&&h("agent",a.reply),a.pendingConfirmation&&be(a.pendingConfirmation),a.humanTakeoverActive?me():he()}catch{n.remove(),h("agent","Sorry, I'm having trouble responding right now. Please try again shortly.")}}let C,I;function me(){C||(C=setInterval(fe,4e3))}function he(){clearInterval(C),C=void 0}async function fe(){if(!(!c||!l))try{let e=await fetch(`${T}/v1/chat/${b}/conversations/${c}/messages`,{headers:{authorization:`Bearer ${l.widgetToken}`}});if(!e.ok)return;let t=await e.json();if(I===void 0){I=t[t.length-1]?.id;return}let n=t.findIndex(a=>a.id===I),o=n>=0?t.slice(n+1):[];for(let a of o)(a.role==="staff"||a.role==="agent")&&h("agent",a.content);t.length>0&&(I=t[t.length-1].id)}catch{}}let Q=window,j=Q.SpeechRecognition??Q.webkitSpeechRecognition,g=null,$,q,Z,xe=2500,ve=6e4,ee=document,ye=(ee.permissionsPolicy??ee.featurePolicy)?.allowsFeature("microphone")===!1;j&&window.isSecureContext&&!ye&&(y.hidden=!1);function A(e,t,n){clearTimeout(Z),m.textContent=e,m.classList.toggle("error",t==="error"),m.hidden=!1,n&&(Z=setTimeout(()=>m.hidden=!0,n))}function te(e){y.classList.toggle("listening",e),y.setAttribute("aria-pressed",String(e)),y.setAttribute("aria-label",e?"Stop listening":"Speak your message"),W.classList.toggle("listening",e),s.placeholder=e?"Listening\u2026":"Type a message\u2026",e?A("Listening \u2014 speak naturally. Tap the mic again when you're done.","info"):m.classList.contains("error")||(m.hidden=!0)}function H(){clearTimeout($),clearTimeout(q),g?.stop()}let we={"not-allowed":"Microphone access is blocked. Allow it for this site in your browser settings to speak your message.","service-not-allowed":"Microphone access is blocked. Allow it for this site in your browser settings to speak your message.","no-speech":"I didn't hear anything \u2014 tap the mic and try again.","audio-capture":"No microphone was found on this device.",network:"Voice typing needs an internet connection \u2014 please type instead.","language-not-supported":"Voice typing isn't available in this language here \u2014 please type instead."};function ke(){if(!j)return;let e=new j;g=e,e.lang=document.documentElement.lang||navigator.language||"en-US",e.interimResults=!0,e.continuous=!0,e.maxAlternatives=1;let t=s.value.trim()?`${s.value.trim()} `:"";e.onresult=n=>{let o="";for(let u=0;u<n.results.length;u++)o+=n.results[u][0].transcript;let a=o.replace(/\s+/g," ").trimStart();s.value=t+(a?a.charAt(0).toUpperCase()+a.slice(1):""),P.disabled=s.value.trim().length===0,s.scrollLeft=s.scrollWidth,clearTimeout($),$=setTimeout(H,xe)},e.onerror=n=>{let o=we[n.error];o&&A(o,"error",6e3)},e.onend=()=>{clearTimeout($),clearTimeout(q),g=null,te(!1),w&&s.focus()};try{m.classList.remove("error"),e.start(),te(!0),q=setTimeout(H,ve)}catch{g=null,A("Voice typing couldn't start \u2014 please try again.","error",5e3)}}y.addEventListener("click",()=>{g?H():ke()}),W.addEventListener("submit",e=>{e.preventDefault(),g&&(g.onresult=null,H());let t=s.value.trim();t&&(s.value="",P.disabled=!0,K(t))});function Te(){f.style.display="",setTimeout(()=>{w||r.classList.add("invite")},900)}async function Le(){for(let e of[0,2e3,6e3]){e&&await new Promise(t=>setTimeout(t,e));try{await ce(),Te();return}catch(t){let n=t.status;if(n!==void 0&&n>=400&&n<500)break}}console.warn("[chat-widget] this assistant is unavailable right now, so the chat button is hidden.")}Le();function Se(e){let t=e==="left"?"left":"right",n=e==="left"?"right":"left";return`
      :host, * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; }
      :host {
        --brand-1: #35bdf0; --brand-2: #12a5e0; --brand-3: #0a6a99;
        ${Object.entries(ne.LIGHT).map(([o,a])=>`${o}: ${a};`).join(" ")}
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
      .composer input { flex: 1; min-width: 0; background: var(--input-bg); border: 1px solid var(--input-border); border-radius: 11px;
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

      .composer button.mic {
        position: relative; background: var(--input-bg); border: 1px solid var(--input-border); color: var(--text-secondary);
        box-shadow: none; flex-shrink: 0;
      }
      .composer button.mic:hover { color: var(--brand-2); filter: none; border-color: rgba(53,189,240,0.45); }
      .composer button.mic .wave { display: none; align-items: center; gap: 2.5px; height: 18px; }
      .composer button.mic .wave i { display: block; width: 3px; height: 6px; border-radius: 2px; background: currentColor; animation: wave 0.9s ease-in-out infinite; }
      .composer button.mic .wave i:nth-child(2) { animation-delay: 0.12s; }
      .composer button.mic .wave i:nth-child(3) { animation-delay: 0.24s; }
      .composer button.mic .wave i:nth-child(4) { animation-delay: 0.36s; }
      .composer button.mic .wave i:nth-child(5) { animation-delay: 0.48s; }
      .composer button.mic.listening {
        background: linear-gradient(135deg, #ff5a5f, #e5383b); border-color: transparent; color: #ffffff;
        animation: mic-pulse 1.6s ease-out infinite;
      }
      .composer button.mic.listening .mic-icon { display: none; }
      .composer button.mic.listening .wave { display: flex; }
      .composer.listening input { border-color: rgba(229,56,59,0.45); }
      .voice-hint { margin: 0 13px -4px; padding: 8px 11px; border-radius: 10px; font-size: 11.5px; line-height: 1.45;
        color: var(--text-secondary); background: var(--input-bg); border: 1px solid var(--input-border); animation: hint-in 0.18s ease-out; }
      .voice-hint[hidden] { display: none; }
      .voice-hint.error { color: #e5383b; border-color: rgba(229,56,59,0.3); background: rgba(229,56,59,0.07); }
      @keyframes wave { 0%, 100% { height: 5px; } 50% { height: 16px; } }
      @keyframes mic-pulse { 0% { box-shadow: 0 0 0 0 rgba(229,56,59,0.45); } 70% { box-shadow: 0 0 0 9px rgba(229,56,59,0); } 100% { box-shadow: 0 0 0 0 rgba(229,56,59,0); } }
      @keyframes hint-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }


      @media (prefers-reduced-motion: reduce) {
        .avatar-ring, .bubble.typing em, .status-dot, .launcher, .composer button.mic, .composer button.mic .wave i, .voice-hint { animation: none !important; }
      }

      @media (max-width: 480px) {
        .panel { bottom: 0; right: 0; left: 0; width: 100%; max-width: 100%; height: 100%; max-height: 100%; border-radius: 0; }
        .launcher { bottom: 18px; ${t}: 18px; ${n}: auto; }
      }
    `}})();})();
