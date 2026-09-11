import type { Metadata } from "next";
import { LegalTitle, Clause, Bullets, Fill, PlaceholderNotice } from "../_components";

export const metadata: Metadata = {
  title: "Terms of Service — Datalyst Africa",
  description: "The terms governing use of the Datalyst Africa AI chat agent platform.",
};

export default function TermsPage() {
  return (
    <article>
      <LegalTitle title="Terms of Service" updated="[EFFECTIVE DATE]" />
      <div className="mt-8">
        <PlaceholderNotice />
      </div>

      <Clause heading="1. Who these terms are between">
        <p>
          These terms are an agreement between <Fill>LEGAL ENTITY NAME</Fill>, a company registered in{" "}
          <Fill>COUNTRY OF REGISTRATION</Fill> under company number <Fill>COMPANY REGISTRATION NUMBER</Fill> (&quot;we&quot;,
          &quot;us&quot;, the &quot;Provider&quot;), and the business or person that creates an account to use the platform
          (&quot;you&quot;, the &quot;Customer&quot;).
        </p>
        <p>
          By creating an account, or by letting us configure an agent on your behalf, you agree to these terms. If you are agreeing
          on behalf of a company, you confirm you have the authority to bind it.
        </p>
      </Clause>

      <Clause heading="2. What the service is">
        <p>
          We provide a hosted platform that lets you deploy an AI assistant (an &quot;Agent&quot;) to your website and messaging
          channels. The Agent answers questions using content you supply, and can take actions you have configured — such as
          creating records in your other systems, booking appointments, or sending notifications.
        </p>
        <p>
          We may also provide a paid setup service in which our staff build and configure your Agent and knowledge base on your
          behalf, using the same tools available to you. Where we do, every action our staff take under your account is logged and
          visible to you.
        </p>
      </Clause>

      <Clause heading="3. Your content and your customers' data">
        <p>
          You keep all rights in the documents, website content, product information, and other material you upload or point us at
          (&quot;Customer Content&quot;). You grant us only the licence needed to host, process, index and serve that content for
          the purpose of operating your Agent.
        </p>
        <p>
          Conversations between your Agent and your own customers, and any personal data within them, remain your data. In relation
          to that data we act as a processor and you act as the controller. How we handle it is described in our{" "}
          <a href="/privacy" className="text-brand-link underline underline-offset-2 hover:text-brand-link-hover">
            Privacy Policy
          </a>
          .
        </p>
        <p>You are responsible for:</p>
        <Bullets
          items={[
            "Having the right to upload the content you give us, and to have it processed by us.",
            "Telling your own customers that they are talking to an AI assistant where the law requires it.",
            "Having a lawful basis for the personal data your Agent collects, and honouring your customers' data rights.",
            "The accuracy of the content your Agent answers from — the Agent repeats what you supply.",
          ]}
        />
      </Clause>

      <Clause heading="4. What the AI can and cannot be relied on for">
        <p>
          The Agent is built to answer from your knowledge base and to decline rather than guess when it cannot verify something.
          Even so, AI systems can produce wrong or incomplete output. The service is provided as a tool, not as professional advice,
          and not as a guarantee of any particular answer.
        </p>
        <p>
          You should not configure the Agent to give medical, legal, financial or safety-critical advice without human review. You
          remain responsible for what your Agent says to your customers and for any action you have permitted it to take.
        </p>
        <p>
          Actions we classify as higher-risk require confirmation from your customer or approval from a human on your team before
          they execute. You should not disable those controls for actions that move money or change sensitive records.
        </p>
      </Clause>

      <Clause heading="5. Acceptable use">
        <p>You must not use the service to:</p>
        <Bullets
          items={[
            "Break the law, or help anyone else do so.",
            "Deceive people about who or what they are dealing with, or impersonate another business or person.",
            "Handle payment card numbers, passwords, or government identity numbers through Agent conversations.",
            "Send unsolicited bulk messages, or anything that breaches the rules of a messaging channel you connect.",
            "Attempt to access another customer's data, probe our systems, or work around usage limits.",
            "Deploy an Agent for adult content, gambling, weapons, or any use we tell you in writing is out of scope.",
          ]}
        />
        <p>
          We may suspend an Agent immediately where we reasonably believe it is being used this way, or where it is creating a
          security or legal risk. Where we can, we will tell you first.
        </p>
      </Clause>

      <Clause heading="6. Fees, usage allowances and overage">
        <p>
          Subscription prices are shown on our pricing page and are charged monthly in advance in{" "}
          <Fill>BILLING CURRENCY</Fill>. Each plan includes a monthly usage allowance. If you exceed it, the additional usage is
          billed at the overage rate for your plan, shown in your dashboard.
        </p>
        <p>
          Each plan other than Enterprise also has a hard usage cap. If you reach it, your Agent stops answering until the next
          billing period or until you upgrade. Your dashboard shows how close you are to both the allowance and the cap.
        </p>
        <p>
          Paid setup and ongoing knowledge upkeep are quoted separately and invoiced as agreed. Fees are non-refundable except where
          required by law. We may change prices with <Fill>NOTICE PERIOD, e.g. 30 days</Fill> notice; a change never applies to a
          period you have already paid for.
        </p>
      </Clause>

      <Clause heading="7. Trials, suspension and cancellation">
        <p>
          A trial gives you a limited usage allowance at no charge. We may end trials or change their limits at any time. If payment
          fails, we may suspend your Agent after giving you notice.
        </p>
        <p>
          You can cancel at any time and your subscription runs to the end of the paid period. When a subscription ends we suspend
          your Agent — we do not delete your data at that point. You can ask us to export or delete it, and we will delete it after{" "}
          <Fill>POST-CANCELLATION RETENTION PERIOD, e.g. 90 days</Fill> unless you ask us to sooner or the law requires us to keep
          it.
        </p>
      </Clause>

      <Clause heading="8. Availability">
        <p>
          We aim to keep the service available but do not promise uninterrupted operation. Your Agent depends on third-party AI
          providers, messaging platforms and infrastructure we do not control. We route across multiple AI providers so that one
          failing does not necessarily take your Agent down, but we cannot guarantee it.
        </p>
        <p>
          Any service level commitment applies only if we have agreed one with you in writing: <Fill>SLA TERMS, IF ANY</Fill>.
        </p>
      </Clause>

      <Clause heading="9. Intellectual property">
        <p>
          We keep all rights in the platform, its software, and its design. You keep all rights in your Customer Content and in your
          own brand. Nothing here transfers ownership either way. You may not copy, resell, or reverse engineer the platform, or use
          it to build a competing product.
        </p>
        <p>
          If you give us feedback, we may use it to improve the service without owing you anything for it. We will not use your
          Customer Content or your customers&apos; conversations to train general-purpose AI models.
        </p>
      </Clause>

      <Clause heading="10. Liability">
        <p>
          To the extent the law allows, neither party is liable for indirect or consequential loss, lost profit, lost revenue, or
          lost data. Our total liability under this agreement is capped at the fees you paid us in the{" "}
          <Fill>LIABILITY CAP PERIOD, e.g. 12 months</Fill> before the claim arose.
        </p>
        <p>
          Nothing in these terms limits liability that cannot be limited by law, including for death or personal injury caused by
          negligence, or for fraud.
        </p>
      </Clause>

      <Clause heading="11. Changes to these terms">
        <p>
          We may update these terms. If a change materially reduces your rights, we will tell you at least{" "}
          <Fill>NOTICE PERIOD, e.g. 30 days</Fill> before it takes effect. Continuing to use the service after that means you accept
          the updated terms.
        </p>
      </Clause>

      <Clause heading="12. Governing law and disputes">
        <p>
          These terms are governed by the laws of <Fill>GOVERNING JURISDICTION</Fill>, and the courts of{" "}
          <Fill>COURTS WITH JURISDICTION</Fill> have exclusive jurisdiction. Before starting proceedings, both parties agree to try
          to resolve the dispute by talking to each other first.
        </p>
      </Clause>

      <Clause heading="13. How to reach us">
        <p>
          Questions about these terms: <Fill>SUPPORT / LEGAL EMAIL</Fill>.
        </p>
        <p>
          Registered address: <Fill>REGISTERED BUSINESS ADDRESS</Fill>.
        </p>
      </Clause>
    </article>
  );
}
