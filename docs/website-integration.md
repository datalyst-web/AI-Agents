# Putting the platform on datalystafrica.com

How the existing HTML marketing site connects to the app. Two separate
things, often confused:

1. **Sending visitors to sign up / sign in** — plain links. No API calls, no
   CORS, no JavaScript.
2. **Putting your own agent on your own site** — the widget embed snippet,
   the same one every client gets.

---

## 1. Sign up / sign in buttons

**Link to the app — never rebuild the login form on the static site.** A
password field on `datalystafrica.com` posting cross-origin to the API means
credentials handled on an origin that isn't the app's, no shared session,
and a second place to keep Turnstile, password rules and error states
correct. Linking costs nothing and keeps auth on one origin.

Paste into the site's header:

```html
<a href="https://app.datalystafrica.com/login" class="dl-signin">Sign in</a>
<a href="https://app.datalystafrica.com/signup" class="dl-trial">Start free trial</a>
```

A fuller call-to-action block for the homepage:

```html
<section class="dl-cta">
  <h2>An AI employee that actually knows your business</h2>
  <p>
    We build and configure it for you from your own documents and website.
    You review it, approve it, and it goes live — on your site, WhatsApp,
    Telegram, Messenger and Instagram.
  </p>
  <div class="dl-cta-actions">
    <a href="https://app.datalystafrica.com/signup" class="dl-btn dl-btn-primary">
      Start your 14-day free trial
    </a>
    <a href="https://app.datalystafrica.com/guide" class="dl-btn dl-btn-secondary">
      See how it works
    </a>
  </div>
  <p class="dl-cta-note">No card required. Our team builds your agent during the trial.</p>
</section>

<style>
  .dl-cta { max-width: 720px; margin: 0 auto; padding: 64px 24px; text-align: center; }
  .dl-cta h2 { font-size: clamp(1.75rem, 4vw, 2.5rem); line-height: 1.15; margin: 0 0 16px; }
  .dl-cta p { color: #6b7280; line-height: 1.65; margin: 0 auto 28px; max-width: 34rem; }
  .dl-cta-actions { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
  .dl-btn { display: inline-block; padding: 13px 26px; border-radius: 12px; font-weight: 600;
            font-size: 0.95rem; text-decoration: none; transition: opacity 0.15s ease; }
  .dl-btn:hover { opacity: 0.9; }
  .dl-btn-primary { background: linear-gradient(135deg, #7288ff 0%, #4a5ef5 45%, #a21caf 100%); color: #fff; }
  .dl-btn-secondary { background: rgba(15, 19, 48, 0.06); color: #0f1330; }
  .dl-cta-note { font-size: 0.8rem; color: #9ca3af; margin-top: 20px; }
</style>
```

Deep links worth knowing:

| Destination | URL |
| --- | --- |
| Start a trial | `https://app.datalystafrica.com/signup` |
| Sign in | `https://app.datalystafrica.com/login` |
| How it works | `https://app.datalystafrica.com/guide` |
| Pricing | `https://app.datalystafrica.com/#pricing` |
| Terms | `https://app.datalystafrica.com/terms` |
| Privacy | `https://app.datalystafrica.com/privacy` |

Nothing here needs a CORS change: a link is a navigation, not a
cross-origin request.

---

## 2. Your own agent on your own site

Create a tenant for Datalyst itself, build its agent the same way a
client's is built, then copy that agent's embed snippet from its page in
the dashboard. It looks like this, with the real agent id filled in:

```html
<script
  src="https://app.datalystafrica.com/widget.js"
  data-agent-id="YOUR-AGENT-ID"
  data-api-base="https://api.datalystafrica.com"
></script>
```

Paste it once before `</body>`. Copy it from the dashboard rather than from
here — the id has to be the real one, and a wrong id renders a widget that
silently fails to load a config.

This works from any domain by design: `/v1/chat/` and `/v1/widget-config/`
are the two path prefixes the API serves with an open CORS origin (see
`apps/api/src/app.ts`), because the widget must load on arbitrary client
websites. Auth on that surface is a signed per-agent widget token, never a
cookie, so reflecting any origin can't leak a session.

---

## Production config this depends on

- `API_CORS_ORIGINS` should be the **dashboard origin**, not `*`. The
  allowlist only governs the authenticated dashboard surface — the widget
  paths above bypass it deliberately — so restricting it does not affect
  clients embedding the widget. Recommended value:
  `https://app.datalystafrica.com`
- `DASHBOARD_BASE_URL` — already `https://app.datalystafrica.com`. Used in
  outbound emails (password reset, escalation alerts, trial reminders), so
  it must stay correct or those links break.
- `API_PUBLIC_BASE_URL` — already `https://api.datalystafrica.com`. Used
  when registering channel webhooks with Telegram/Meta, which must reach us
  over the public internet.
