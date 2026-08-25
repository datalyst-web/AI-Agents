/**
 * Embed contract (CLAUDE.md Deployment Surfaces):
 *   <script src="https://YOUR-PLATFORM.com/widget.js" data-agent-id="AGENT_ID"></script>
 *
 * Everything here runs inside a Shadow DOM so the host site's CSS can
 * never bleed into the widget (and vice versa) — a real requirement once
 * this is dropped onto arbitrary client websites, not just our own pages.
 * White-label per CLAUDE.md principle 6: nothing rendered here ever names
 * a model, provider, or internal system — only the tenant's configured
 * agent name/avatar/greeting.
 */

interface WidgetConfig {
  agentId: string;
  name: string;
  greeting: string;
  avatarUrl?: string;
  tone: string;
  widgetToken: string;
}

interface PendingConfirmation {
  toolCallId: string;
  toolName: string;
  input: unknown;
  confirmationPrompt: string;
}

interface ChatResponse {
  conversationId: string;
  reply: string;
  pendingConfirmation?: PendingConfirmation;
  handoffTriggered: boolean;
}

(function bootstrap() {
  const currentScript = document.currentScript as HTMLScriptElement | null;
  const agentId = currentScript?.dataset.agentId;
  if (!agentId) {
    console.error("[chat-widget] missing data-agent-id on the embed <script> tag.");
    return;
  }
  const apiBase = currentScript?.dataset.apiBase ?? new URL(currentScript?.src ?? "", location.href).origin;

  const storageKey = `chat-agent:${agentId}`;
  const stored = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as {
    conversationId?: string;
    sessionCookie?: string;
  };
  const sessionCookie = stored.sessionCookie ?? crypto.randomUUID();
  let conversationId = stored.conversationId;

  function persist() {
    localStorage.setItem(storageKey, JSON.stringify({ conversationId, sessionCookie }));
  }

  const host = document.createElement("div");
  host.id = "chat-agent-widget-root";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>${styles()}</style>
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
      <div class="footer">Powered by ${escapeHtml(location.hostname)}</div>
    </div>
  `;

  const launcher = shadow.querySelector<HTMLElement>(".launcher")!;
  const panel = shadow.querySelector<HTMLElement>(".panel")!;
  const closeBtn = shadow.querySelector<HTMLButtonElement>(".close")!;
  const messagesEl = shadow.querySelector<HTMLElement>(".messages")!;
  const confirmationEl = shadow.querySelector<HTMLElement>(".confirmation")!;
  const form = shadow.querySelector<HTMLFormElement>(".composer")!;
  const input = shadow.querySelector<HTMLInputElement>("input")!;
  const nameEl = shadow.querySelector<HTMLElement>(".name")!;
  const avatarEl = shadow.querySelector<HTMLImageElement>(".avatar")!;

  let config: WidgetConfig | undefined;
  let opened = false;

  async function loadConfig() {
    const resp = await fetch(`${apiBase}/v1/widget-config/${agentId}`);
    if (!resp.ok) throw new Error(`widget-config fetch failed: ${resp.status}`);
    config = (await resp.json()) as WidgetConfig;
    nameEl.textContent = config.name;
    if (config.avatarUrl) {
      avatarEl.src = config.avatarUrl;
      avatarEl.hidden = false;
    }
    if (!stored.conversationId) {
      appendMessage("agent", config.greeting);
    }
  }

  function toggle(open: boolean) {
    opened = open;
    panel.hidden = !open;
    launcher.classList.toggle("hidden", open);
    if (open) input.focus();
  }

  launcher.addEventListener("click", () => toggle(true));
  closeBtn.addEventListener("click", () => toggle(false));

  function appendMessage(role: "customer" | "agent", text: string) {
    const bubble = document.createElement("div");
    bubble.className = `bubble ${role}`;
    bubble.textContent = text;
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showConfirmation(pc: PendingConfirmation) {
    confirmationEl.hidden = false;
    confirmationEl.innerHTML = "";
    const text = document.createElement("div");
    text.className = "confirmation-text";
    text.textContent = pc.confirmationPrompt;
    const actions = document.createElement("div");
    actions.className = "confirmation-actions";
    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = "Confirm";
    confirmBtn.className = "confirm";
    confirmBtn.onclick = () => {
      confirmationEl.hidden = true;
      void sendMessage("", { confirmToolCallId: pc.toolCallId });
    };
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.className = "cancel";
    cancelBtn.onclick = () => {
      confirmationEl.hidden = true;
      appendMessage("agent", "No problem, I won't go ahead with that.");
    };
    actions.append(confirmBtn, cancelBtn);
    confirmationEl.append(text, actions);
  }

  async function sendMessage(text: string, confirmation?: { confirmToolCallId: string }) {
    if (!config) return;
    if (text) appendMessage("customer", text);

    const typing = document.createElement("div");
    typing.className = "bubble agent typing";
    typing.textContent = "...";
    messagesEl.appendChild(typing);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    try {
      const resp = await fetch(`${apiBase}/v1/chat/${agentId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.widgetToken}` },
        body: JSON.stringify({
          conversationId,
          message: text || "(customer confirmed the pending action)",
          customerIdentifier: { type: "widget_session_cookie", value: sessionCookie },
          ...confirmation,
        }),
      });
      typing.remove();
      if (!resp.ok) {
        appendMessage("agent", "Sorry, I'm having trouble responding right now. Please try again shortly.");
        return;
      }
      const data = (await resp.json()) as ChatResponse;
      conversationId = data.conversationId;
      persist();
      if (data.reply) appendMessage("agent", data.reply);
      if (data.pendingConfirmation) showConfirmation(data.pendingConfirmation);
    } catch {
      typing.remove();
      appendMessage("agent", "Sorry, I'm having trouble responding right now. Please try again shortly.");
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    void sendMessage(text);
  });

  void loadConfig();

  function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
  }

  function styles(): string {
    return `
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
    `;
  }
})();
