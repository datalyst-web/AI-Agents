"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

/**
 * The free-trial welcome questionnaire (trials only — the dashboard layout
 * routes a trial owner/admin here until it's sent). Everything our team
 * needs to build and connect their assistant, in seven short steps; only a
 * few answers are required. Answers autosave to this browser so a refresh
 * or dropped connection never loses them (files can't be kept, so those
 * are picked again if needed). Server side: apps/api/src/routes/onboarding.routes.ts.
 */

type Goal = "answer_questions" | "capture_leads" | "book_appointments" | "take_orders" | "customer_support";
type Channel = "website" | "whatsapp" | "facebook" | "instagram" | "telegram";
type Tone = "friendly" | "professional" | "playful" | "formal" | "empathetic";

interface Answers {
  businessName: string;
  whatYouDo: string;
  industry: string;
  location: string;
  businessHours: string;
  website: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  assistantName: string;
  tone: Tone;
  greeting: string;
  languages: string;
  goals: Goal[];
  mustNotDo: string;
  handoffWhen: string;
  handoffContact: string;
  leadQuestions: string;
  productsAndPrices: string;
  faqs: { question: string; answer: string }[];
  policies: string;
  brandDisplayName: string;
  brandColor: string;
  channels: Channel[];
  websitePlatform: "wordpress" | "wix" | "shopify" | "squarespace" | "custom" | "none" | "not_sure";
  websiteInstall: "do_it_for_me" | "send_me_a_guide" | "not_now";
  whatsappNumber: string;
  facebookPage: string;
  instagramHandle: string;
  telegramNotes: string;
  calendar: "google" | "outlook" | "other" | "none";
  otherTools: string;
  notes: string;
}

const EMPTY: Answers = {
  businessName: "",
  whatYouDo: "",
  industry: "",
  location: "",
  businessHours: "",
  website: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  assistantName: "",
  tone: "friendly",
  greeting: "",
  languages: "English",
  goals: ["answer_questions"],
  mustNotDo: "",
  handoffWhen: "",
  handoffContact: "",
  leadQuestions: "",
  productsAndPrices: "",
  faqs: [{ question: "", answer: "" }],
  policies: "",
  brandDisplayName: "",
  brandColor: "#12a5e0",
  channels: ["website"],
  websitePlatform: "not_sure",
  websiteInstall: "do_it_for_me",
  whatsappNumber: "",
  facebookPage: "",
  instagramHandle: "",
  telegramNotes: "",
  calendar: "none",
  otherTools: "",
  notes: "",
};

const STEPS = [
  { title: "Your business", blurb: "The basics, so your assistant introduces you properly." },
  { title: "Your assistant", blurb: "Its personality and the jobs you want it to do." },
  { title: "What it should know", blurb: "Your prices, FAQs and documents — the heart of every answer." },
  { title: "Rules & handover", blurb: "What it must never do, and when to bring in a person." },
  { title: "Your brand", blurb: "So it looks like yours, everywhere it appears." },
  { title: "Where customers reach you", blurb: "We connect every channel for you — nothing technical on your side." },
  { title: "Last step", blurb: "Who we should talk to, then a quick check before sending." },
] as const;

const GOALS: { value: Goal; label: string; hint: string; icon: string }[] = [
  { value: "answer_questions", label: "Answer questions", hint: "Prices, hours, services, policies", icon: "💬" },
  { value: "capture_leads", label: "Capture leads", hint: "Collect contacts and qualify them", icon: "🎯" },
  { value: "book_appointments", label: "Book appointments", hint: "From your real availability", icon: "📅" },
  { value: "take_orders", label: "Take orders & enquiries", hint: "Collect the details you need", icon: "🛍️" },
  { value: "customer_support", label: "Customer support", hint: "Resolve issues, open tickets", icon: "🛟" },
];
const TONES: { value: Tone; label: string; hint: string }[] = [
  { value: "friendly", label: "Friendly", hint: "Warm and approachable" },
  { value: "professional", label: "Professional", hint: "Polished and precise" },
  { value: "playful", label: "Playful", hint: "Light and fun" },
  { value: "formal", label: "Formal", hint: "Courteous and proper" },
  { value: "empathetic", label: "Empathetic", hint: "Patient and caring" },
];
const CHANNELS: { value: Channel; label: string; icon: string }[] = [
  { value: "website", label: "Website", icon: "🌐" },
  { value: "whatsapp", label: "WhatsApp", icon: "🟢" },
  { value: "facebook", label: "Facebook Messenger", icon: "💙" },
  { value: "instagram", label: "Instagram", icon: "📸" },
  { value: "telegram", label: "Telegram", icon: "✈️" },
];
const PLATFORMS: { value: Answers["websitePlatform"]; label: string }[] = [
  { value: "wordpress", label: "WordPress" },
  { value: "wix", label: "Wix" },
  { value: "shopify", label: "Shopify" },
  { value: "squarespace", label: "Squarespace" },
  { value: "custom", label: "Custom-built" },
  { value: "none", label: "No website yet" },
  { value: "not_sure", label: "Not sure" },
];
const INSTALLS: { value: Answers["websiteInstall"]; label: string; hint: string }[] = [
  { value: "do_it_for_me", label: "Install it for me", hint: "Our team adds it to your site" },
  { value: "send_me_a_guide", label: "Send me a guide", hint: "Simple step-by-step instructions" },
  { value: "not_now", label: "Not now", hint: "We'll sort it out later" },
];
const CALENDARS: { value: Answers["calendar"]; label: string }[] = [
  { value: "google", label: "Google Calendar" },
  { value: "outlook", label: "Outlook" },
  { value: "other", label: "Something else" },
  { value: "none", label: "I don't take bookings" },
];

const DRAFT_KEY = "chat-agent:welcome-draft";

export default function WelcomePage() {
  const { user, refreshUser, logout } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [a, setA] = useState<Answers>(EMPTY);
  const [documents, setDocuments] = useState<File[]>([]);
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const loaded = useRef(false);

  // Restore a saved draft (or start from their business name), then autosave.
  useEffect(() => {
    if (!user || loaded.current) return;
    loaded.current = true;
    try {
      const saved = localStorage.getItem(`${DRAFT_KEY}:${user.tenantId}`);
      if (saved) {
        const parsed = JSON.parse(saved) as { answers: Answers; step: number };
        setA({ ...EMPTY, ...parsed.answers });
        setStep(Math.min(Math.max(parsed.step, 0), STEPS.length - 1));
        return;
      }
    } catch {
      // Unreadable draft — start fresh.
    }
    setA((prev) => ({ ...prev, businessName: user.tenantName ?? "", contactEmail: user.email }));
  }, [user]);
  useEffect(() => {
    if (!user || !loaded.current || done) return;
    try {
      localStorage.setItem(`${DRAFT_KEY}:${user.tenantId}`, JSON.stringify({ answers: a, step }));
    } catch {
      // Private browsing etc. — autosave is a convenience, not a requirement.
    }
  }, [a, step, user, done]);

  useEffect(() => {
    if (!logo) {
      setLogoPreview(null);
      return;
    }
    const url = URL.createObjectURL(logo);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  const set = <K extends keyof Answers>(key: K, value: Answers[K]) => setA((prev) => ({ ...prev, [key]: value }));
  const toggle = <T extends string>(key: "goals" | "channels", value: T) =>
    setA((prev) => {
      const list = prev[key] as string[];
      return { ...prev, [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] };
    });

  /** The only required answers, checked per step so problems surface where they are. */
  function problemOn(s: number): string | null {
    if (s === 0 && !a.businessName.trim()) return "Tell us your business name.";
    if (s === 0 && a.whatYouDo.trim().length < 10) return "Tell us a little more about what your business does.";
    if (s === 1 && a.goals.length === 0) return "Choose at least one thing your assistant should do.";
    if (s === 5 && a.channels.length === 0) return "Choose at least one place your customers should reach it.";
    if (s === 6 && !a.contactName.trim()) return "Tell us who we should talk to.";
    if (s === 6 && a.contactPhone.trim().length < 5) return "Add a phone or WhatsApp number we can reach you on.";
    return null;
  }

  function next() {
    const problem = problemOn(step);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function back() {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit() {
    for (let s = 0; s < STEPS.length; s++) {
      const problem = problemOn(s);
      if (problem) {
        setStep(s);
        setError(problem);
        return;
      }
    }
    if (!user) return;
    setSending(true);
    setError(null);
    try {
      const payload = { ...a, faqs: a.faqs.filter((f) => f.question.trim() && f.answer.trim()) };
      await api.submitIntake(user.tenantId, payload, documents, logo);
      try {
        localStorage.removeItem(`${DRAFT_KEY}:${user.tenantId}`);
      } catch {
        // Nothing to clean up.
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't send your answers. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function finish() {
    await refreshUser();
    router.replace("/overview");
  }

  const progress = useMemo(() => Math.round(((done ? STEPS.length : step) / STEPS.length) * 100), [step, done]);
  const firstName = (user?.displayName ?? "").split(" ")[0];

  if (!user) return null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-surface text-foreground">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[28rem] w-[48rem] -translate-x-1/2 rounded-full bg-brand-gradient opacity-[0.16] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-20 h-80 w-80 rounded-full bg-brand-gradient opacity-10 blur-3xl" />

      <header className="relative z-10 mx-auto flex w-full max-w-3xl items-center justify-between px-5 pt-6">
        <span className="text-sm font-semibold tracking-tight text-foreground/80">{user.tenantName ?? "Welcome"}</span>
        <button onClick={logout} className="text-xs text-foreground/40 transition-colors hover:text-foreground/70">
          Sign out
        </button>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-3xl px-5 pb-20 pt-8">
        {done ? (
          <Celebration onContinue={finish} />
        ) : (
          <>
            {step === 0 ? (
              <div className="mb-8 animate-fade-up text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-link">Welcome{firstName ? `, ${firstName}` : ""} 👋</p>
                <h1 className="mt-3 text-3xl font-semibold tracking-tightest sm:text-4xl">
                  Let&apos;s build your <span className="text-gradient">AI assistant</span>
                </h1>
                <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-foreground/55">
                  Answer a few questions and our team does the rest — setup, knowledge, connecting your website and channels. Your
                  14-day free trial starts the day it goes live.
                </p>
              </div>
            ) : null}

            <Progress step={step} percent={progress} />

            <div key={step} className="mt-6 animate-fade-up rounded-xl3 bg-brand-gradient-soft p-px shadow-card">
              <section className="rounded-[calc(1.75rem-1px)] bg-surface-raised/95 p-6 backdrop-blur sm:p-8">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-link">
                  Step {step + 1} of {STEPS.length}
                </p>
                <h2 className="mt-1.5 text-xl font-semibold tracking-tight">{STEPS[step]?.title}</h2>
                <p className="mt-1 text-sm text-foreground/50">{STEPS[step]?.blurb}</p>

                <div className="mt-6 space-y-5">
                  {step === 0 ? (
                    <>
                      <Field label="Business name" required>
                        <Input value={a.businessName} onChange={(v) => set("businessName", v)} placeholder="e.g. Sunrise Dental Clinic" />
                      </Field>
                      <Field label="What does your business do?" required hint="Your products or services, who you serve, what makes you different.">
                        <TextArea value={a.whatYouDo} onChange={(v) => set("whatYouDo", v)} rows={4} placeholder="We're a family dental clinic in Harare offering check-ups, whitening and braces…" />
                      </Field>
                      <div className="grid gap-5 sm:grid-cols-2">
                        <Field label="Industry">
                          <Input value={a.industry} onChange={(v) => set("industry", v)} placeholder="e.g. Healthcare" />
                        </Field>
                        <Field label="Website">
                          <Input value={a.website} onChange={(v) => set("website", v)} placeholder="www.yourbusiness.com" />
                        </Field>
                        <Field label="Location or service area">
                          <Input value={a.location} onChange={(v) => set("location", v)} placeholder="e.g. Harare CBD, delivers nationwide" />
                        </Field>
                        <Field label="Opening hours">
                          <Input value={a.businessHours} onChange={(v) => set("businessHours", v)} placeholder="Mon–Fri 8–5, Sat 8–1" />
                        </Field>
                      </div>
                    </>
                  ) : null}

                  {step === 1 ? (
                    <>
                      <Field label="What should your assistant do?" required hint="Pick as many as you like.">
                        <div className="grid gap-3 sm:grid-cols-2">
                          {GOALS.map((g) => (
                            <ChoiceCard key={g.value} selected={a.goals.includes(g.value)} onClick={() => toggle("goals", g.value)} icon={g.icon} title={g.label} hint={g.hint} />
                          ))}
                        </div>
                      </Field>
                      <Field label="Its personality">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                          {TONES.map((t) => (
                            <ChoiceCard key={t.value} compact selected={a.tone === t.value} onClick={() => set("tone", t.value)} title={t.label} hint={t.hint} />
                          ))}
                        </div>
                      </Field>
                      <div className="grid gap-5 sm:grid-cols-2">
                        <Field label="Assistant's name" hint="Optional — e.g. “Ava”.">
                          <Input value={a.assistantName} onChange={(v) => set("assistantName", v)} placeholder="Ava" />
                        </Field>
                        <Field label="Languages it should speak">
                          <Input value={a.languages} onChange={(v) => set("languages", v)} placeholder="English, Shona" />
                        </Field>
                      </div>
                      <Field label="How should it greet customers?" hint="Optional — we'll write one if you leave this blank.">
                        <Input value={a.greeting} onChange={(v) => set("greeting", v)} placeholder="Hi! Welcome to Sunrise Dental — how can I help today?" />
                      </Field>
                    </>
                  ) : null}

                  {step === 2 ? (
                    <>
                      <Field label="Products, services and prices" hint="Paste your price list or describe what you offer. The more detail, the better its answers.">
                        <TextArea value={a.productsAndPrices} onChange={(v) => set("productsAndPrices", v)} rows={5} placeholder={"Check-up — $30\nTeeth whitening — $120\nBraces consultation — free"} />
                      </Field>
                      <Field label="Frequently asked questions" hint="The questions customers ask you most — and your answers.">
                        <div className="space-y-3">
                          {a.faqs.map((f, i) => (
                            <div key={i} className="group rounded-xl bg-foreground/[0.03] p-3.5 ring-1 ring-inset ring-surface-border transition-all duration-200 hover:ring-brand-500/30">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/35">Question {i + 1}</span>
                                {a.faqs.length > 1 ? (
                                  <button
                                    type="button"
                                    onClick={() => set("faqs", a.faqs.filter((_, j) => j !== i))}
                                    className="text-xs text-foreground/35 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                                  >
                                    Remove
                                  </button>
                                ) : null}
                              </div>
                              <Input className="mt-2" value={f.question} onChange={(v) => set("faqs", a.faqs.map((x, j) => (j === i ? { ...x, question: v } : x)))} placeholder="Do you accept medical aid?" />
                              <TextArea className="mt-2" rows={2} value={f.answer} onChange={(v) => set("faqs", a.faqs.map((x, j) => (j === i ? { ...x, answer: v } : x)))} placeholder="Yes — we accept CIMAS, PSMAS and First Mutual." />
                            </div>
                          ))}
                          {a.faqs.length < 50 ? (
                            <button
                              type="button"
                              onClick={() => set("faqs", [...a.faqs, { question: "", answer: "" }])}
                              className="w-full rounded-xl border border-dashed border-surface-border py-3 text-sm font-medium text-brand-link transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-500/50 hover:bg-brand-500/5"
                            >
                              + Add another question
                            </button>
                          ) : null}
                        </div>
                      </Field>
                      <Field label="Policies" hint="Delivery, returns, refunds, cancellations, payment methods — anything customers ask about.">
                        <TextArea value={a.policies} onChange={(v) => set("policies", v)} rows={3} placeholder="Cancellations need 24 hours' notice. We accept EcoCash, card and cash." />
                      </Field>
                      <Field label="Documents" hint="Brochures, menus, price lists, FAQs — PDF, Word, Excel, PowerPoint, text or images. Up to 8 files, 10 MB each.">
                        <DropZone
                          files={documents}
                          accept=".pdf,.doc,.docx,.txt,.csv,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg"
                          multiple
                          onAdd={(added) => setDocuments((prev) => [...prev, ...added].slice(0, 8))}
                          onRemove={(i) => setDocuments((prev) => prev.filter((_, j) => j !== i))}
                        />
                      </Field>
                    </>
                  ) : null}

                  {step === 3 ? (
                    <>
                      <Field label="Anything it must never say or do?" hint="Topics to avoid, promises it mustn't make, competitors not to mention…">
                        <TextArea value={a.mustNotDo} onChange={(v) => set("mustNotDo", v)} rows={3} placeholder="Never give medical diagnoses. Never promise same-day appointments." />
                      </Field>
                      <Field label="When should it bring in a person?" hint="e.g. complaints, emergencies, large orders, anything it isn't sure about.">
                        <TextArea value={a.handoffWhen} onChange={(v) => set("handoffWhen", v)} rows={3} placeholder="Emergencies, complaints, or anyone asking to speak to the dentist." />
                      </Field>
                      <div className="grid gap-5 sm:grid-cols-2">
                        <Field label="Who gets those alerts?" hint="Name, email or phone.">
                          <Input value={a.handoffContact} onChange={(v) => set("handoffContact", v)} placeholder="Reception — 077 123 4567" />
                        </Field>
                        <Field label="Questions to ask new leads" hint="Optional — what you need to know about a potential customer.">
                          <Input value={a.leadQuestions} onChange={(v) => set("leadQuestions", v)} placeholder="Name, phone, preferred day" />
                        </Field>
                      </div>
                    </>
                  ) : null}

                  {step === 4 ? (
                    <>
                      <Field label="Your logo" hint="PNG, JPG, SVG or WebP — shown on your dashboard and chat.">
                        <label className="group flex cursor-pointer items-center gap-5 rounded-xl2 border border-dashed border-surface-border p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-500/50 hover:bg-brand-500/5 hover:shadow-glow">
                          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-foreground/[0.04] ring-1 ring-inset ring-surface-border transition-transform duration-300 group-hover:scale-105">
                            {logoPreview ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={logoPreview} alt="Your logo" className="h-full w-full object-contain p-1.5" />
                            ) : (
                              <span className="text-2xl opacity-40">🖼️</span>
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{logo ? logo.name : "Choose your logo"}</p>
                            <p className="mt-0.5 text-xs text-foreground/45">{logo ? "Click to change" : "Click to upload"}</p>
                          </div>
                          <input type="file" accept=".png,.jpg,.jpeg,.svg,.webp" className="hidden" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} />
                        </label>
                      </Field>
                      <div className="grid gap-5 sm:grid-cols-2">
                        <Field label="Name to show customers" hint="If different from your business name.">
                          <Input value={a.brandDisplayName} onChange={(v) => set("brandDisplayName", v)} placeholder={a.businessName || "Sunrise Dental"} />
                        </Field>
                        <Field label="Brand colour">
                          <div className="flex items-center gap-3">
                            <input
                              type="color"
                              value={/^#[0-9a-f]{6}$/i.test(a.brandColor) ? a.brandColor : "#12a5e0"}
                              onChange={(e) => set("brandColor", e.target.value)}
                              className="h-11 w-14 cursor-pointer rounded-lg border border-surface-border bg-transparent transition-transform hover:scale-105"
                            />
                            <Input value={a.brandColor} onChange={(v) => set("brandColor", v)} placeholder="#12a5e0" />
                          </div>
                        </Field>
                      </div>
                    </>
                  ) : null}

                  {step === 5 ? (
                    <>
                      <Field label="Where should customers reach your assistant?" required hint="We'll connect each one for you.">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                          {CHANNELS.map((c) => (
                            <ChoiceCard key={c.value} compact selected={a.channels.includes(c.value)} onClick={() => toggle("channels", c.value)} icon={c.icon} title={c.label} />
                          ))}
                        </div>
                      </Field>
                      {a.channels.includes("website") ? (
                        <>
                          <Field label="What is your website built with?">
                            <div className="flex flex-wrap gap-2">
                              {PLATFORMS.map((p) => (
                                <Pill key={p.value} selected={a.websitePlatform === p.value} onClick={() => set("websitePlatform", p.value)}>
                                  {p.label}
                                </Pill>
                              ))}
                            </div>
                          </Field>
                          <Field label="Adding the chat to your website">
                            <div className="grid gap-3 sm:grid-cols-3">
                              {INSTALLS.map((i) => (
                                <ChoiceCard key={i.value} compact selected={a.websiteInstall === i.value} onClick={() => set("websiteInstall", i.value)} title={i.label} hint={i.hint} />
                              ))}
                            </div>
                          </Field>
                        </>
                      ) : null}
                      <div className="grid gap-5 sm:grid-cols-2">
                        {a.channels.includes("whatsapp") ? (
                          <Field label="WhatsApp business number">
                            <Input value={a.whatsappNumber} onChange={(v) => set("whatsappNumber", v)} placeholder="+263 77 123 4567" />
                          </Field>
                        ) : null}
                        {a.channels.includes("facebook") ? (
                          <Field label="Facebook page link">
                            <Input value={a.facebookPage} onChange={(v) => set("facebookPage", v)} placeholder="facebook.com/yourbusiness" />
                          </Field>
                        ) : null}
                        {a.channels.includes("instagram") ? (
                          <Field label="Instagram handle">
                            <Input value={a.instagramHandle} onChange={(v) => set("instagramHandle", v)} placeholder="@yourbusiness" />
                          </Field>
                        ) : null}
                        {a.channels.includes("telegram") ? (
                          <Field label="Telegram" hint="Existing bot or channel, if any.">
                            <Input value={a.telegramNotes} onChange={(v) => set("telegramNotes", v)} placeholder="We'll create one for you if you don't have it" />
                          </Field>
                        ) : null}
                      </div>
                      {a.goals.includes("book_appointments") ? (
                        <Field label="Which calendar do you use for bookings?">
                          <div className="flex flex-wrap gap-2">
                            {CALENDARS.map((c) => (
                              <Pill key={c.value} selected={a.calendar === c.value} onClick={() => set("calendar", c.value)}>
                                {c.label}
                              </Pill>
                            ))}
                          </div>
                        </Field>
                      ) : null}
                      <Field label="Other tools you use" hint="Optional — e.g. a CRM, booking system or online shop.">
                        <Input value={a.otherTools} onChange={(v) => set("otherTools", v)} placeholder="HubSpot, WooCommerce…" />
                      </Field>
                    </>
                  ) : null}

                  {step === 6 ? (
                    <>
                      <div className="grid gap-5 sm:grid-cols-2">
                        <Field label="Your name" required>
                          <Input value={a.contactName} onChange={(v) => set("contactName", v)} placeholder="Tendai Moyo" />
                        </Field>
                        <Field label="Phone or WhatsApp" required>
                          <Input value={a.contactPhone} onChange={(v) => set("contactPhone", v)} placeholder="+263 77 123 4567" />
                        </Field>
                      </div>
                      <Field label="Email">
                        <Input value={a.contactEmail} onChange={(v) => set("contactEmail", v)} placeholder="you@yourbusiness.com" />
                      </Field>
                      <Field label="Anything else we should know?">
                        <TextArea value={a.notes} onChange={(v) => set("notes", v)} rows={3} placeholder="Busy seasons, special offers, how you like to talk to customers…" />
                      </Field>
                      <Review answers={a} documents={documents.length} logo={Boolean(logo)} onEdit={(s) => setStep(s)} />
                    </>
                  ) : null}
                </div>

                {error ? (
                  <p className="mt-5 animate-fade-up rounded-lg bg-danger/10 px-3.5 py-2.5 text-sm text-danger ring-1 ring-inset ring-danger/20">{error}</p>
                ) : null}

                <div className="mt-8 flex items-center justify-between gap-3">
                  {step > 0 ? (
                    <button type="button" onClick={back} className="rounded-xl px-4 py-2.5 text-sm font-medium text-foreground/55 transition-colors hover:bg-foreground/[0.05] hover:text-foreground">
                      ← Back
                    </button>
                  ) : (
                    <span className="text-xs text-foreground/35">Takes about 5 minutes · saved as you go</span>
                  )}
                  {step < STEPS.length - 1 ? (
                    <PrimaryButton onClick={next}>Continue →</PrimaryButton>
                  ) : (
                    <PrimaryButton onClick={submit} disabled={sending}>
                      {sending ? "Sending…" : "Send to our team ✨"}
                    </PrimaryButton>
                  )}
                </div>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Progress({ step, percent }: { step: number; percent: number }) {
  return (
    <div>
      <div className="h-2 overflow-hidden rounded-full bg-foreground/[0.07]">
        <div className="h-full rounded-full bg-brand-gradient shadow-glow transition-[width] duration-700 ease-out" style={{ width: `${Math.max(percent, 4)}%` }} />
      </div>
      <div className="mt-3 hidden justify-between sm:flex">
        {STEPS.map((s, i) => (
          <span
            key={s.title}
            className={`text-[11px] font-medium transition-colors duration-300 ${i === step ? "text-brand-link" : i < step ? "text-foreground/55" : "text-foreground/25"}`}
          >
            {i < step ? "✓ " : ""}
            {s.title}
          </span>
        ))}
      </div>
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground/80">
        {label}
        {required ? <span className="ml-1 text-brand-link">*</span> : null}
      </label>
      {hint ? <p className="mt-0.5 text-xs text-foreground/40">{hint}</p> : null}
      <div className="mt-2">{children}</div>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-foreground/10 bg-foreground/[0.04] px-3.5 py-2.5 text-sm text-foreground outline-none transition-all duration-200 placeholder:text-foreground/25 hover:border-brand-500/30 focus:border-brand-400 focus:bg-surface-raised focus:ring-4 focus:ring-brand-500/15";

function Input({ value, onChange, placeholder, className = "" }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`${inputClass} ${className}`} />;
}

function TextArea({ value, onChange, placeholder, rows = 3, className = "" }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; className?: string }) {
  return <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} className={`${inputClass} resize-y ${className}`} />;
}

function ChoiceCard({ selected, onClick, icon, title, hint, compact }: { selected: boolean; onClick: () => void; icon?: string; title: string; hint?: string; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`group relative flex w-full items-start gap-3 rounded-xl2 text-left ring-1 ring-inset transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-glow ${compact ? "flex-col gap-1.5 p-3.5" : "p-4"} ${
        selected ? "bg-brand-500/10 ring-brand-500/50 shadow-glow" : "bg-foreground/[0.03] ring-surface-border hover:bg-brand-500/5 hover:ring-brand-500/30"
      }`}
    >
      {icon ? <span className="text-xl transition-transform duration-300 group-hover:scale-125">{icon}</span> : null}
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        {hint ? <span className="mt-0.5 block text-xs text-foreground/45">{hint}</span> : null}
      </span>
      <span
        className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white transition-all duration-300 ${
          selected ? "scale-100 bg-brand-gradient opacity-100" : "scale-50 opacity-0"
        }`}
      >
        ✓
      </span>
    </button>
  );
}

function Pill({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-full px-4 py-2 text-sm font-medium ring-1 ring-inset transition-all duration-200 hover:-translate-y-0.5 ${
        selected ? "bg-brand-gradient text-white ring-transparent shadow-glow" : "bg-foreground/[0.03] text-foreground/65 ring-surface-border hover:text-foreground hover:ring-brand-500/40"
      }`}
    >
      {children}
    </button>
  );
}

function PrimaryButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group relative overflow-hidden rounded-xl bg-brand-gradient bg-[length:160%_auto] bg-left px-6 py-3 text-sm font-semibold text-white shadow-glow transition-all duration-500 hover:-translate-y-0.5 hover:bg-right hover:shadow-glow-lg disabled:translate-y-0 disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function DropZone({ files, accept, multiple, onAdd, onRemove }: { files: File[]; accept: string; multiple?: boolean; onAdd: (f: File[]) => void; onRemove: (i: number) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onAdd(Array.from(e.dataTransfer.files));
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl2 border border-dashed px-6 py-8 text-center transition-all duration-300 ${
          over ? "scale-[1.01] border-brand-500 bg-brand-500/10 shadow-glow" : "border-surface-border hover:-translate-y-0.5 hover:border-brand-500/50 hover:bg-brand-500/5"
        }`}
      >
        <span className={`text-3xl transition-transform duration-300 ${over ? "scale-125" : ""}`}>📄</span>
        <span className="mt-2 text-sm font-medium">Drop files here or click to choose</span>
        <span className="mt-0.5 text-xs text-foreground/40">{files.length ? `${files.length} added` : "Optional, but it really helps"}</span>
        <input type="file" accept={accept} multiple={multiple} className="hidden" onChange={(e) => onAdd(Array.from(e.target.files ?? []))} />
      </label>
      {files.length ? (
        <ul className="mt-3 space-y-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex animate-fade-up items-center justify-between rounded-lg bg-foreground/[0.03] px-3.5 py-2 text-sm ring-1 ring-inset ring-surface-border">
              <span className="truncate">{f.name}</span>
              <button type="button" onClick={() => onRemove(i)} className="ml-3 shrink-0 text-xs text-foreground/40 transition-colors hover:text-danger">
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Review({ answers: a, documents, logo, onEdit }: { answers: Answers; documents: number; logo: boolean; onEdit: (step: number) => void }) {
  const faqs = a.faqs.filter((f) => f.question.trim() && f.answer.trim()).length;
  const rows: { label: string; value: string; step: number }[] = [
    { label: "Business", value: a.businessName || "—", step: 0 },
    { label: "Assistant does", value: GOALS.filter((g) => a.goals.includes(g.value)).map((g) => g.label).join(", ") || "—", step: 1 },
    { label: "Knowledge", value: `${faqs} FAQ${faqs === 1 ? "" : "s"} · ${documents} document${documents === 1 ? "" : "s"}${a.productsAndPrices ? " · prices" : ""}`, step: 2 },
    { label: "Branding", value: logo ? "Logo added" : "No logo yet", step: 4 },
    { label: "Channels", value: CHANNELS.filter((c) => a.channels.includes(c.value)).map((c) => c.label).join(", ") || "—", step: 5 },
  ];
  return (
    <div className="rounded-xl2 bg-foreground/[0.03] p-4 ring-1 ring-inset ring-surface-border">
      <p className="text-xs font-semibold uppercase tracking-wider text-foreground/40">Quick check</p>
      <ul className="mt-2 divide-y divide-surface-border">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-4 py-2.5 text-sm">
            <span className="text-foreground/50">{r.label}</span>
            <span className="flex min-w-0 items-center gap-3">
              <span className="truncate text-right text-foreground/85">{r.value}</span>
              <button type="button" onClick={() => onEdit(r.step)} className="shrink-0 text-xs font-medium text-brand-link hover:underline">
                Edit
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Celebration({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="mt-10 animate-fade-up text-center">
      <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-brand-500/20" />
        <span className="relative flex h-24 w-24 items-center justify-center rounded-full bg-brand-gradient text-4xl text-white shadow-glow-lg">✓</span>
      </div>
      <h1 className="mt-8 text-3xl font-semibold tracking-tightest">You&apos;re all set! 🎉</h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-foreground/55">
        Our team has everything they need and is building your AI assistant now.
      </p>
      <div className="mx-auto mt-6 max-w-md rounded-xl2 bg-foreground/[0.03] p-5 text-left ring-1 ring-inset ring-surface-border">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500/60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-gradient" />
          </span>
          Waiting for configuration
        </p>
        <ul className="mt-3 space-y-2 text-sm text-foreground/60">
          <li>• We build your knowledge base, write your assistant&apos;s instructions and connect your channels.</li>
          <li>
            • We email you <span className="font-medium text-foreground/80">within 24 hours</span> when it&apos;s ready to try.
          </li>
          <li>• You approve it, then it goes live — and your 14-day free trial starts that day.</li>
        </ul>
      </div>
      <div className="mt-8 flex justify-center">
        <PrimaryButton onClick={onContinue}>Go to my dashboard →</PrimaryButton>
      </div>
    </div>
  );
}
