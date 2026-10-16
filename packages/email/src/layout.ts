/**
 * One branded HTML layout for the platform's important emails (the staff
 * build report, "your assistant is ready"). Table-based with inline styles
 * because that is what Gmail, Outlook and phone mail apps actually render;
 * every message still carries a plain-text body for clients that don't.
 *
 * All caller-supplied text is escaped here — answers from a client's
 * questionnaire end up in these emails, and must never become markup.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapes, then keeps the line breaks a person typed. */
function multiline(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

export type EmailBlock =
  /** A paragraph of plain text. */
  | { kind: "text"; text: string; muted?: boolean }
  /** Label/value rows, e.g. "Tone — Friendly". Empty values are skipped. */
  | { kind: "facts"; rows: { label: string; value: string }[] }
  /** A bulleted list; `tone` colours the bullets. */
  | { kind: "list"; items: string[]; tone?: "brand" | "success" | "warning" }
  /** Numbered steps with a short title and a line of detail. */
  | { kind: "steps"; items: { title: string; detail: string }[] }
  /** Monospace-free quoted block for long text such as instructions. */
  | { kind: "quote"; text: string }
  /** Small highlighted figures, e.g. "12 — answers loaded". */
  | { kind: "stats"; items: { value: string; label: string }[] }
  /** A coloured notice. */
  | { kind: "callout"; text: string; tone: "brand" | "success" | "warning" };

export interface EmailSection {
  title?: string;
  blocks: EmailBlock[];
}

export interface PremiumEmail {
  /** Hidden preview line most inboxes show next to the subject. */
  preheader: string;
  /** Who it's from, shown in the header bar. */
  brand: string;
  /** Short line above the headline, e.g. "Build report". */
  eyebrow: string;
  headline: string;
  intro: string;
  sections: EmailSection[];
  cta?: { label: string; url: string };
  /** Closing line(s) under the button. */
  signoff?: string;
  footer: string;
}

const C = {
  page: "#eef3f7",
  card: "#ffffff",
  ink: "#0f1b2a",
  body: "#33425a",
  muted: "#6b7a90",
  line: "#e3eaf1",
  soft: "#f5f9fc",
  brand: "#12a5e0",
  brandDeep: "#0a6a99",
  success: "#14966b",
  warning: "#b7791f",
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const TONE: Record<"brand" | "success" | "warning", { fg: string; bg: string }> = {
  brand: { fg: C.brandDeep, bg: "#e7f6fd" },
  success: { fg: C.success, bg: "#e6f6f0" },
  warning: { fg: C.warning, bg: "#fdf4e3" },
};

function renderBlock(block: EmailBlock): string {
  switch (block.kind) {
    case "text":
      return `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${block.muted ? C.muted : C.body};">${multiline(block.text)}</p>`;
    case "facts": {
      const rows = block.rows.filter((r) => r.value.trim());
      if (!rows.length) return "";
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 14px;">${rows
        .map(
          (r, i) =>
            `<tr><td style="padding:10px 12px 10px 0;width:36%;vertical-align:top;font-size:13px;color:${C.muted};${i ? `border-top:1px solid ${C.line};` : ""}">${escapeHtml(r.label)}</td>` +
            `<td style="padding:10px 0;vertical-align:top;font-size:14px;line-height:1.55;color:${C.ink};${i ? `border-top:1px solid ${C.line};` : ""}">${multiline(r.value)}</td></tr>`,
        )
        .join("")}</table>`;
    }
    case "list": {
      if (!block.items.length) return "";
      const dot = TONE[block.tone ?? "brand"].fg;
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">${block.items
        .map(
          (item) =>
            `<tr><td style="width:18px;vertical-align:top;padding:3px 0;font-size:15px;line-height:1.55;color:${dot};">&#9679;</td>` +
            `<td style="vertical-align:top;padding:3px 0;font-size:14px;line-height:1.6;color:${C.body};">${multiline(item)}</td></tr>`,
        )
        .join("")}</table>`;
    }
    case "steps":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">${block.items
        .map(
          (s, i) =>
            `<tr><td style="width:40px;vertical-align:top;padding:6px 0;">` +
            `<div style="width:28px;height:28px;border-radius:14px;background:${C.brand};color:#ffffff;font-size:13px;font-weight:700;line-height:28px;text-align:center;">${i + 1}</div></td>` +
            `<td style="vertical-align:top;padding:6px 0;"><div style="font-size:15px;font-weight:600;color:${C.ink};">${escapeHtml(s.title)}</div>` +
            `<div style="font-size:14px;line-height:1.6;color:${C.body};margin-top:2px;">${multiline(s.detail)}</div></td></tr>`,
        )
        .join("")}</table>`;
    case "quote":
      return `<div style="margin:0 0 14px;padding:14px 16px;border-left:3px solid ${C.brand};background:${C.soft};border-radius:6px;font-size:13.5px;line-height:1.65;color:${C.body};">${multiline(block.text)}</div>`;
    case "stats": {
      if (!block.items.length) return "";
      const width = Math.floor(100 / block.items.length);
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;"><tr>${block.items
        .map(
          (s) =>
            `<td width="${width}%" style="padding:4px;vertical-align:top;"><div style="background:${C.soft};border:1px solid ${C.line};border-radius:10px;padding:14px 8px;text-align:center;">` +
            `<div style="font-size:24px;font-weight:700;color:${C.brandDeep};line-height:1.1;">${escapeHtml(s.value)}</div>` +
            `<div style="font-size:12px;color:${C.muted};margin-top:4px;line-height:1.35;">${escapeHtml(s.label)}</div></div></td>`,
        )
        .join("")}</tr></table>`;
    }
    case "callout": {
      const t = TONE[block.tone];
      return `<div style="margin:0 0 14px;padding:13px 16px;border-radius:10px;background:${t.bg};color:${t.fg};font-size:14px;line-height:1.6;">${multiline(block.text)}</div>`;
    }
  }
}

export function renderPremiumEmail(email: PremiumEmail): string {
  const sections = email.sections
    .map((s) => {
      const blocks = s.blocks.map(renderBlock).join("");
      if (!blocks) return "";
      const title = s.title
        ? `<div style="font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${C.brandDeep};margin:0 0 12px;">${escapeHtml(s.title)}</div>`
        : "";
      return `<tr><td style="padding:22px 32px 8px;border-top:1px solid ${C.line};">${title}${blocks}</td></tr>`;
    })
    .join("");
  const cta = email.cta
    ? `<tr><td style="padding:12px 32px 8px;" align="left"><a href="${escapeHtml(email.cta.url)}" style="display:inline-block;background:${C.brand};background-image:linear-gradient(135deg,#35bdf0 0%,#12a5e0 45%,#0a6a99 100%);color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 26px;border-radius:10px;">${escapeHtml(email.cta.label)}</a></td></tr>`
    : "";
  const signoff = email.signoff
    ? `<tr><td style="padding:14px 32px 28px;font-size:14px;line-height:1.65;color:${C.body};">${multiline(email.signoff)}</td></tr>`
    : `<tr><td style="padding:0 32px 20px;"></td></tr>`;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(email.headline)}</title></head>
<body style="margin:0;padding:0;background:${C.page};font-family:${FONT};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(email.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:${C.card};border-radius:16px;overflow:hidden;border:1px solid ${C.line};">
<tr><td style="background:${C.brandDeep};background-image:linear-gradient(135deg,#35bdf0 0%,#12a5e0 45%,#0a6a99 100%);padding:22px 32px;">
<div style="font-size:15px;font-weight:700;letter-spacing:.3px;color:#ffffff;">${escapeHtml(email.brand)}</div></td></tr>
<tr><td style="padding:30px 32px 14px;">
<div style="font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${C.brand};">${escapeHtml(email.eyebrow)}</div>
<h1 style="margin:8px 0 14px;font-size:25px;line-height:1.3;font-weight:700;color:${C.ink};">${escapeHtml(email.headline)}</h1>
<p style="margin:0;font-size:15.5px;line-height:1.7;color:${C.body};">${multiline(email.intro)}</p></td></tr>
${sections}${cta}${signoff}
</table>
<p style="max-width:620px;margin:16px auto 0;font-size:12px;line-height:1.6;color:${C.muted};text-align:center;">${multiline(email.footer)}</p>
</td></tr></table></body></html>`;
}
