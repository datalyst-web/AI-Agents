# Meta App Review — submission guide

Written for whoever submits the Datalyst Africa app in the Meta dashboard.

Messenger, Instagram and WhatsApp all run through **one Meta app**. Until
that app passes review it only works for people with a role on it (you),
so a client's Page can't be connected. This is the checklist for getting
it approved.

## What the platform already provides

| Meta asks for | Where it lives |
| --- | --- |
| Webhook URL | `https://api.datalystafrica.com/v1/channels/meta/webhook` |
| Verify token | `META_WEBHOOK_VERIFY_TOKEN` on the Railway `api` service |
| Signature checking | Every inbound event is HMAC-verified against `META_APP_SECRET` |
| **Data deletion callback** | `https://api.datalystafrica.com/v1/channels/meta/data-deletion` |
| **Data deletion instructions** | `https://app.datalystafrica.com/data-deletion` |
| Privacy policy | `https://app.datalystafrica.com/privacy` |
| Terms of service | `https://app.datalystafrica.com/terms` |

The deletion callback is new. When someone removes the app from their
Facebook or Instagram settings, Meta posts a signed request to it; we
erase that person's conversations, remembered facts and stored handle
across every tenant they had talked to, and hand back a confirmation code
they can check on the public page. Nothing identifying survives — only a
dated record that the erasure ran.

## Before you open the review form

1. **Business verification.** Meta will not grant messaging permissions to
   an unverified business. Business Manager → Security Centre → Start
   verification. Expect to upload the company registration certificate and
   a document showing the business address, and to confirm a phone number
   or the `datalystafrica.com` domain. This is the slowest step — a few
   days — so start it first.
2. **Verify the domain.** Business Manager → Brand Safety → Domains → add
   `datalystafrica.com` and confirm with the DNS TXT record. We already
   control the zone in Cloudflare.
3. **Fill in the app's Basic Settings.** App icon (1024×1024), category
   "Business", the privacy policy, terms and the deletion URLs from the
   table above, and a working contact email.
4. **Add the products** you are asking permission for: Messenger,
   Instagram, WhatsApp — each has its own setup tab where the webhook URL
   and verify token go.

## Permissions to request

Ask only for these; every extra one invites a rejection.

- `pages_messaging` — replying to people who message a client's Facebook Page.
- `pages_show_list` / `pages_manage_metadata` — required to subscribe a Page to the webhook.
- `instagram_manage_messages` + `instagram_basic` — the same for an Instagram business account.
- `whatsapp_business_messaging` + `whatsapp_business_management` — the WhatsApp Cloud API path.

## What to write in the use-case box

Keep it in the reviewer's language — what the person messaging sees, not
our architecture:

> Datalyst Africa provides small and medium businesses in Zimbabwe with an
> AI assistant that answers customer enquiries. A business connects its own
> Facebook Page, Instagram account or WhatsApp number. When one of their
> customers sends a message, the assistant replies using only that
> business's own published information — prices, opening hours, services —
> and books appointments or passes the conversation to a human member of
> staff when it can't help. We only ever message a person who messaged the
> business first, and only in that conversation.

## The screencast

Rejections are almost always about the video, not the code. Record one
continuous screen capture, no cuts, showing:

1. The Datalyst Africa dashboard, signing in as staff.
2. Integrations → connecting a **test** Facebook Page (use a Page you own).
3. Switching to Messenger as an ordinary customer, sending a real question.
4. The assistant's reply arriving in Messenger.
5. The same conversation appearing in the business's dashboard.
6. Removing the app under Facebook → Settings → Apps and Websites, then
   opening the confirmation link and showing the deletion status page.

Step 6 is what satisfies the data-deletion requirement; reviewers look for it.

## Reviewer test instructions

Give them a real account — a reviewer who can't reproduce it rejects it.

> 1. Sign in at https://app.datalystafrica.com with the test credentials
>    supplied in this submission.
> 2. Open "Integrations" to see the connected channels for this account.
> 3. Message the Facebook Page "<test page name>" with a question such as
>    "What are your opening hours?" and the assistant will reply within a
>    few seconds.
> 4. The conversation appears under "Conversations" in the dashboard.
> 5. To test data deletion, remove the app at
>    Facebook → Settings → Apps and Websites, then open the confirmation
>    link Facebook shows you.

Create a throwaway tenant for this and put its login in the submission —
never a real client's account.

## After approval

- Switch the app from Development to **Live** (toggle at the top of the app dashboard).
- Connect each client's Page/IG/WhatsApp through Integrations while
  impersonating their tenant, as with any other managed setup work.
- Meta expires long-lived Page tokens on password changes at the client's
  end; a channel that starts failing shows its error on the Integrations
  card, which is the first place to look.

## If it's rejected

The rejection email names the permission and the reason. In order of
likelihood: the screencast didn't show the permission actually in use; the
reviewer's test account couldn't sign in; or business verification wasn't
finished. Fix and resubmit — there is no penalty for resubmitting, and the
second review is usually faster.
