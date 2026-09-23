import type { Metadata } from "next";
import Link from "next/link";
import { LegalTitle, Clause, Bullets, PlaceholderNotice } from "../_components";

export const metadata: Metadata = {
  title: "Privacy Policy — Datalyst Africa",
  description: "What data the Datalyst Africa AI platform collects, why, how long it is kept, and the rights you and your customers have.",
};

export default function PrivacyPage() {
  return (
    <article>
      <LegalTitle title="Privacy Policy" updated="14 September 2026" />
      <div className="mt-8">
        <PlaceholderNotice />
      </div>

      <Clause heading="1. Who this policy is from">
        <p>
          This policy explains how Datalyst Africa (&quot;we&quot;) handles personal data in the course of operating
          the Datalyst Africa AI platform. Our contact point for privacy questions is munyaradzi@datalystafrica.com, and our
          registered address is Corner Rotten Row &amp; Pennefather Road, Harare City Library, Harare, Zimbabwe.
          We do not currently have a dedicated Data Protection Officer — a business of our size and processing scope is not required
          to appoint one under Zimbabwean law. Direct any data protection query to the email above.
        </p>
      </Clause>

      <Clause heading="2. Two different relationships">
        <p>This distinction matters, because our obligations differ in each case:</p>
        <Bullets
          items={[
            "Our customers (the businesses who buy the platform) — for their own account data we are the controller. This policy describes what we do with it.",
            "Our customers' end customers (people who talk to an Agent on a business's website or messaging channel) — for those conversations we are a processor acting on that business's instructions. That business decides what is collected and why, and its own privacy policy governs it.",
          ]}
        />
        <p>
          If you spoke to an AI assistant on a company&apos;s website and want your data removed, contact that company. They can
          action it themselves in their dashboard, and we support them doing so.
        </p>
      </Clause>

      <Clause heading="3. What we collect about our customers">
        <Bullets
          items={[
            "Account data: name, email address, hashed password, role, and an optional phone number for alerts.",
            "Business data: your company name, plan, billing state, and branding you upload.",
            "Content you supply: documents, website content and FAQs you add to your knowledge base, and the instructions you give your Agent.",
            "Configuration: the tools, channels and integrations you connect. Credentials for those are encrypted at rest and never shown back to you or anyone else.",
            "Usage and billing records: request counts, token volumes, cost estimates, payment references and invoices.",
            "Audit records: who did what in your account, including anything our setup staff did on your behalf.",
            "Support correspondence: tickets you raise with us and our replies.",
          ]}
        />
      </Clause>

      <Clause heading="4. What is stored from Agent conversations">
        <p>To operate an Agent we store, on behalf of the business that deployed it:</p>
        <Bullets
          items={[
            "The conversation itself — the messages exchanged, and metadata such as channel, outcome, sentiment trend and any satisfaction rating the customer chose to give.",
            "A durable identifier for a returning customer, stored as a one-way hash rather than as a raw email address or cookie value, so a returning person can be recognised without us holding the identifier itself.",
            "For messaging channels only (WhatsApp, Telegram, Messenger, Instagram), the channel-specific address needed to send a reply, stored encrypted. It is decrypted only to deliver a message and is never shown to any user of the platform.",
            "Facts a customer has stated across conversations, where the business has enabled longer-term memory — for example a stated preference or a prior issue raised. Not full transcripts by default.",
          ]}
        />
        <p>
          The Agent is designed not to present something as a fact the customer stated unless they actually stated it, and not to
          claim an action succeeded unless it was confirmed.
        </p>
      </Clause>

      <Clause heading="5. Why we process it">
        <Bullets
          items={[
            "To provide the service — answering questions, taking configured actions, and recognising a returning customer.",
            "To bill accurately, and to show usage against a plan allowance.",
            "To keep the platform secure, including detecting attempts to manipulate an Agent's instructions.",
            "To support you, investigate faults, and improve reliability.",
            "To meet legal and accounting obligations.",
          ]}
        />
        <p>
          Where the law requires a lawful basis, ours is performance of our contract with you, our legitimate interest in operating
          and securing the platform, and compliance with legal obligations. Your own basis for your customers&apos; data is yours to
          determine.
        </p>
      </Clause>

      <Clause heading="6. AI processing">
        <p>
          To generate a reply, the relevant conversation content and the retrieved extract of your knowledge base are sent to a
          third-party AI provider. We route across more than one provider for reliability. These providers process the content to
          return a response and are contractually restricted from using it to train their models.
        </p>
        <p>
          We do not use your content, or your customers&apos; conversations, to train general-purpose AI models.
        </p>
      </Clause>

      <Clause heading="7. Who else sees the data">
        <p>We share data only with service providers that make the platform work:</p>
        <Bullets
          items={[
            "AI model providers, to generate replies.",
            "Cloud hosting and database providers, to run and store the service.",
            "The messaging platforms you choose to connect, to deliver messages on those channels.",
            "Our payment provider, to take payment. We never see or store your full card details.",
            "Email and SMS providers, to send the notifications you have enabled.",
            "Error monitoring, to detect faults.",
          ]}
        />
        <p>
          Our current sub-processors:
        </p>
        <Bullets
          items={[
            "Neon, Inc. — PostgreSQL database hosting (United States).",
            "Railway Corporation — application hosting for the API and background workers (United States).",
            "Vercel Inc. — dashboard hosting and content delivery (United States, global edge network).",
            "Cloudflare, Inc. — encrypted document/logo storage and bot-verification on our sign-in forms (global network, United States-headquartered).",
            "Anthropic PBC, OpenAI, L.L.C. and Google LLC — AI model providers used to generate Agent replies (United States).",
            "Google LLC — additionally used for \"Sign in with Google\" and, where a customer connects it, Google Calendar (United States).",
            "Brevo (Sendinblue SAS) — transactional email delivery, e.g. sign-in codes and alerts (European Union).",
            "Meta Platforms, Inc. — WhatsApp Business Platform, Messenger and Instagram messaging, only for customers who connect those channels (United States).",
            "Twilio Inc. — SMS alert delivery, only for customers who enable that channel (United States).",
            "Paynow (Zimbabwe) — payment processing, only for customers on a paid plan (Zimbabwe).",
          ]}
        />
        <p>
        </p>
        <p>We do not sell personal data, and we do not share it for advertising.</p>
      </Clause>

      <Clause heading="8. Where data is held">
        <p>
          The platform currently operates primarily from the United States (see the sub-processor list above); Cloudflare&apos;s global network may cache static assets and file uploads closer to you. If you have a regulatory requirement
          for data to stay in a particular region, tell us before you go live — we record that requirement against your account, but
          you should not assume data is physically relocated unless we have confirmed that in writing.
        </p>
        <p>
          Where data crosses a border, we rely on the standard contractual data-processing safeguards each provider listed above already has in place, rather than a bespoke agreement of our own.
        </p>
      </Clause>

      <Clause heading="9. How we protect it">
        <Bullets
          items={[
            "Each business's data is isolated at the database level, not only by application code, so one business cannot read another's.",
            "Credentials and channel access tokens are encrypted at rest.",
            "Passwords are stored only as salted hashes.",
            "Access to production data is limited to staff who need it, and staff actions inside a customer's account are logged and attributable.",
            "Traffic is encrypted in transit.",
          ]}
        />
        <p>
          No system is perfectly secure. If a breach affects your data we will notify you without undue delay, and regulators where
          required.
        </p>
      </Clause>

      <Clause heading="10. How long we keep it">
        <p>
          Conversation and memory data is kept for the retention period configured on your account, then deleted automatically. The
          default is 365 days.
        </p>
        <p>
          Account, billing and audit records are kept for as long as you are a customer and then for as long as we are legally
          required to keep them — typically 6 years for accounting records, in line with Zimbabwean tax record-keeping requirements. Audit logs
          are kept deliberately, because they are the record of who changed what.
        </p>
      </Clause>

      <Clause heading="11. Your rights">
        <p>
          Depending on where you are, you may have the right to access, correct, export, or delete your personal data, to object to
          or restrict processing, and to complain to a regulator. To exercise any of these, contact{" "}
          munyaradzi@datalystafrica.com. We will respond within 30 days.
        </p>
        <p>
          You can delete a specific customer&apos;s stored memory from your dashboard at any time; that action is recorded in your
          audit log.
        </p>
        <p>
          If you are a member of the public who has chatted with one of these assistants, our{" "}
          <Link href="/data-deletion" className="font-medium text-brand-link underline underline-offset-2">
            data deletion page
          </Link>{" "}
          explains what is held about you and the three ways to have it erased.
        </p>
        <p>
          The regulator for our jurisdiction is the Postal and Telecommunications Regulatory Authority of Zimbabwe (POTRAZ), the Data Protection Authority under Zimbabwe&apos;s Cyber and Data Protection Act.
        </p>
      </Clause>

      <Clause heading="12. Cookies">
        <p>
          The dashboard stores a session token in your browser so you stay signed in, and remembers small interface preferences. The
          chat widget stores an identifier so a returning visitor&apos;s conversation can continue. We do not use advertising or
          cross-site tracking cookies.
        </p>
      </Clause>

      <Clause heading="13. Children">
        <p>
          The platform is sold to businesses and is not intended for children. We do not knowingly collect data from children. If you
          configure an Agent that will be used by children, that is your responsibility to handle lawfully.
        </p>
      </Clause>

      <Clause heading="14. Changes">
        <p>
          If we change this policy in a way that materially affects how we handle your data, we will tell you before it takes effect.
          The date at the top always reflects the current version.
        </p>
      </Clause>
    </article>
  );
}
