# Meta App Review — step by step

WhatsApp, Messenger and Instagram all run through **one Meta app**. Right
now that app is in Development mode, which means it only works on pages
*you* are an admin of. To connect a client's Facebook Page or WhatsApp
number, Meta has to review and approve the app first.

This guide walks through that, start to finish, assuming no prior
experience with the Meta dashboard.

**Roughly how long:** business verification takes 2–5 days of waiting.
The rest is about 3 hours of your own work. App review itself is usually
2–7 days. So plan for two weeks, not two days.

Meta renames buttons fairly often. If a label here doesn't match what you
see, look for the closest equivalent — the order of the steps stays right
even when the wording drifts.

---

## What our platform already provides

You don't have to build any of this — it's live. You just need to paste
these into Meta's forms when asked.

| Meta asks for | Paste this |
| --- | --- |
| Webhook callback URL | `https://api.datalystafrica.com/v1/channels/meta/webhook` |
| Verify token | The `META_WEBHOOK_VERIFY_TOKEN` value (see below) |
| User data deletion callback | `https://api.datalystafrica.com/v1/channels/meta/data-deletion` |
| Data deletion instructions URL | `https://app.datalystafrica.com/data-deletion` |
| Privacy policy URL | `https://app.datalystafrica.com/privacy` |
| Terms of service URL | `https://app.datalystafrica.com/terms` |

To read the verify token, run this and copy the value — don't paste it
anywhere public:

```
railway variables --service api
```

---

## Stage 1 — Business verification (do this first, today)

This is the long pole. Everything else can happen while you wait.

1. Go to **business.facebook.com** and sign in with the Facebook account
   that owns the app.
2. Click the **gear icon** (Business Settings), bottom left.
3. In the left menu, find **Security Centre** (sometimes under "Business
   Info").
4. Click **Start Verification**.
5. Fill in the legal business details — the name must match your
   registration documents *exactly*, including "(Pvt) Ltd" or whatever
   form your registration uses.
6. Upload the documents it asks for. Usually two:
   - Your certificate of incorporation / business registration.
   - Something showing the business address — a utility bill or bank
     statement in the business's name, dated within 90 days.
7. Confirm you own the business by phone, email or the domain.

**Then wait.** Meta emails you. If it's rejected, the email says which
document failed — usually a name mismatch or a document too old. Fix that
one thing and resubmit; there's no penalty.

---

## Stage 2 — Verify the domain

Do this while Stage 1 is pending.

1. Business Settings → **Brand Safety** → **Domains**.
2. Click **Add**, type `datalystafrica.com`, click Add.
3. Choose the **DNS TXT record** method. Meta shows you a long string
   starting `facebook-domain-verification=`.
4. Open HostGator → cPanel → **Zone Editor** → the `datalystafrica.com`
   zone → **Add Record**:
   - Type: **TXT**
   - Name: `datalystafrica.com` (or leave blank / `@` depending on what
     HostGator shows)
   - Value: the whole string Meta gave you
5. Save, wait about 15 minutes, go back to Meta and click **Verify**.

If it fails, it's nearly always DNS not having propagated yet. Wait an
hour and click Verify again.

---

## Stage 3 — Fill in the app's basic settings

1. Go to **developers.facebook.com/apps** and open the app
   ("Datalyst Africa Agent").
2. Left menu → **App Settings** → **Basic**.
3. Fill in:
   - **App icon** — a 1024×1024 PNG of the Datalyst logo.
   - **Privacy Policy URL** — from the table above.
   - **Terms of Service URL** — from the table above.
   - **User data deletion** — choose **Data deletion callback URL** (not
     the "instructions URL" option) and paste the callback URL from the
     table. Our server answers it automatically.
   - **Category** — Business.
   - **Business verification** — link the app to the verified business
     from Stage 1 once that's approved.
4. Click **Save changes** at the bottom.

**How to know it worked:** Meta pings the deletion URL when you save. If
it accepts the URL without an error, our endpoint answered correctly.

---

## Stage 4 — Add the products and webhooks

In the app dashboard, **Add Product** and add Messenger, Instagram and
WhatsApp. For each one, find its **Webhooks** section and:

1. Click **Add Callback URL** (or Edit).
2. Callback URL: `https://api.datalystafrica.com/v1/channels/meta/webhook`
3. Verify token: the `META_WEBHOOK_VERIFY_TOKEN` value.
4. Click **Verify and Save**. It should succeed immediately — Meta calls
   our server and our server answers the challenge.
5. Then **Subscribe** to the `messages` field.

If "Verify and Save" fails, the token doesn't match. Re-read it from
Railway; no spaces, no quotes.

---

## Stage 5 — Request the permissions

Left menu → **App Review** → **Permissions and Features**. Find each of
these and click **Request Advanced Access**:

- `pages_messaging` — reply to people who message a client's Page
- `pages_show_list` and `pages_manage_metadata` — needed to connect a Page
- `instagram_basic` and `instagram_manage_messages` — the same for Instagram
- `whatsapp_business_messaging` and `whatsapp_business_management` — WhatsApp

**Ask for these and nothing else.** Every extra permission is another
thing the reviewer has to be convinced of, and a reason to reject.

Each one asks how you'll use it. Paste this, adjusting the wording to the
specific permission:

> Datalyst Africa provides small and medium businesses in Zimbabwe with an
> AI assistant that answers customer enquiries. A business connects its own
> Facebook Page, Instagram account or WhatsApp number. When one of their
> customers sends a message, the assistant replies using only that
> business's own published information — prices, opening hours, services —
> and books appointments or passes the conversation to a human member of
> staff when it can't help. We only ever message a person who messaged the
> business first, and only in that conversation.

---

## Stage 6 — Record the screencast

**This is where most submissions fail.** Not the code — the video. The
reviewer has to *see* each permission being used.

Record one continuous screen capture, no cuts, no editing. Windows Game
Bar (**Win + G**) records fine. Narrate or add captions.

Show, in this order:

1. Signing in at `app.datalystafrica.com`.
2. The **Integrations** page, connecting a test Facebook Page — use a Page
   you own, not a client's.
3. Switch to Messenger as an ordinary customer. Send a real question, like
   "What are your opening hours?"
4. The assistant's reply arriving in Messenger.
5. That same conversation appearing in the dashboard under Conversations.
6. **The deletion flow:** Facebook → Settings → Apps and Websites → remove
   the app → open the confirmation link Facebook gives you → show the
   status page at `app.datalystafrica.com/data-deletion` saying the data
   was deleted.

Step 6 is what proves the data-deletion requirement. Reviewers look for it
specifically, and it is now fully working on our side.

Upload the video to the submission, or to an unlisted YouTube link.

---

## Stage 7 — Give the reviewer a test account

A reviewer who can't reproduce your video rejects the submission.

Create a throwaway client in Managed Setup for this — **never use a real
client's account.** Then in the "App Review" instructions box, write:

> 1. Sign in at https://app.datalystafrica.com with the credentials
>    supplied in this submission.
> 2. Open "Integrations" to see the connected channels for this account.
> 3. Message the Facebook Page "<test page name>" with a question such as
>    "What are your opening hours?" — the assistant replies within a few
>    seconds.
> 4. The conversation appears under "Conversations" in the dashboard.
> 5. To test data deletion, remove the app at Facebook → Settings → Apps
>    and Websites, then open the confirmation link Facebook shows you.

Put the email and password in the credentials fields Meta provides.

---

## Stage 8 — Submit, then wait

Click **Submit for Review**. Typically 2–7 days.

While waiting, don't change the app's settings — an edit mid-review can
reset it.

---

## After approval

1. In the app dashboard, flip the toggle at the top from **Development**
   to **Live**. Nothing works for real clients until you do this.
2. Connect each client's Page / Instagram / WhatsApp through Integrations,
   inside a Managed Setup session, the same as any other setup work.
3. Meta expires Page tokens when the client changes their Facebook
   password. When a channel stops working, its error shows on the
   Integrations card — that's the first place to look.

## If it's rejected

The email names the permission and the reason. In order of likelihood:

1. **The screencast didn't show the permission in use.** Re-record showing
   that exact permission doing something visible.
2. **The reviewer couldn't sign in.** Test the credentials yourself in a
   private browser window before resubmitting.
3. **Business verification isn't finished.** Finish Stage 1 first.

Fix the one thing named and resubmit. There's no penalty, and second
reviews are usually faster.
