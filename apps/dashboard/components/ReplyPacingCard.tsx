"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardBody, Button } from "@chat-agent/ui";

/**
 * Staff control for how quickly an agent answers on messaging channels.
 * Mirrors ReplyPacingSchema in packages/shared-types (the API validates the
 * same bounds) and apps/api/src/engine/replyPacing.ts's timing maths, so the
 * preview here matches what customers actually get.
 */

export type PacingChannel = "WHATSAPP" | "TELEGRAM" | "FACEBOOK_MESSENGER" | "INSTAGRAM";
export interface ReplyPacing {
  mode: "instant" | "fixed" | "humanlike";
  delaySeconds: number;
  minSeconds: number;
  maxSeconds: number;
  mergeBurst: boolean;
  typingIndicator: boolean;
  urgentBypass: boolean;
  channels: PacingChannel[];
}

const ALL_CHANNELS: { id: PacingChannel; label: string }[] = [
  { id: "WHATSAPP", label: "WhatsApp" },
  { id: "TELEGRAM", label: "Telegram" },
  { id: "FACEBOOK_MESSENGER", label: "Messenger" },
  { id: "INSTAGRAM", label: "Instagram" },
];

const DEFAULTS: ReplyPacing = {
  mode: "instant",
  delaySeconds: 60,
  minSeconds: 3,
  maxSeconds: 40,
  mergeBurst: true,
  typingIndicator: true,
  urgentBypass: true,
  channels: ALL_CHANNELS.map((c) => c.id),
};

type Preset = { key: string; label: string; hint: string; apply: (p: ReplyPacing) => ReplyPacing };
const PRESETS: Preset[] = [
  { key: "instant", label: "Instant", hint: "As soon as it's ready", apply: (p) => ({ ...p, mode: "instant" }) },
  { key: "10", label: "10 sec", hint: "Feels attentive", apply: (p) => ({ ...p, mode: "fixed", delaySeconds: 10 }) },
  { key: "30", label: "30 sec", hint: "Considered", apply: (p) => ({ ...p, mode: "fixed", delaySeconds: 30 }) },
  { key: "60", label: "1 min", hint: "Like a busy person", apply: (p) => ({ ...p, mode: "fixed", delaySeconds: 60 }) },
  { key: "120", label: "2 min", hint: "Relaxed", apply: (p) => ({ ...p, mode: "fixed", delaySeconds: 120 }) },
  { key: "300", label: "5 min", hint: "Unhurried", apply: (p) => ({ ...p, mode: "fixed", delaySeconds: 300 }) },
  { key: "humanlike", label: "Human-like", hint: "Reads, then types", apply: (p) => ({ ...p, mode: "humanlike" }) },
  { key: "custom", label: "Custom", hint: "Any time up to 15 min", apply: (p) => ({ ...p, mode: "fixed" }) },
];
const FIXED_PRESET_SECONDS = new Set([10, 30, 60, 120, 300]);

function activePreset(p: ReplyPacing): string {
  if (p.mode === "instant") return "instant";
  if (p.mode === "humanlike") return "humanlike";
  return FIXED_PRESET_SECONDS.has(p.delaySeconds) ? String(p.delaySeconds) : "custom";
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s ? `${m} min ${s} sec` : `${m} min`;
}

/** Same maths as the API's computeDelayMs, without the random variation. */
function humanlikeSeconds(p: ReplyPacing, chars: number): number {
  const lo = Math.min(p.minSeconds, p.maxSeconds);
  const hi = Math.min(Math.max(p.minSeconds, p.maxSeconds), 900);
  return Math.min(hi, Math.max(lo, 2 + chars / 20 + 4));
}

function Toggle({ checked, onChange, title, detail }: { checked: boolean; onChange: (v: boolean) => void; title: string; detail: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3.5 py-3 transition-colors hover:bg-foreground/[0.05]">
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-5 w-9 rounded-full bg-foreground/15 transition-colors peer-checked:bg-brand-500 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/50" />
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-surface-raised shadow transition-transform peer-checked:translate-x-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-foreground/50">{detail}</span>
      </span>
    </label>
  );
}

export function ReplyPacingCard({
  value,
  isLive,
  onSave,
}: {
  value: Partial<ReplyPacing> | undefined;
  isLive: boolean;
  onSave: (pacing: ReplyPacing) => Promise<void>;
}) {
  const [p, setP] = useState<ReplyPacing>({ ...DEFAULTS, ...value });
  const [customUnit, setCustomUnit] = useState<"sec" | "min">((value?.delaySeconds ?? 60) % 60 === 0 ? "min" : "sec");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setP({ ...DEFAULTS, ...value }), [value]);

  const preset = activePreset(p);
  const customValue = customUnit === "min" ? p.delaySeconds / 60 : p.delaySeconds;
  const valid =
    p.channels.length > 0 &&
    p.delaySeconds >= 1 &&
    p.delaySeconds <= 900 &&
    p.minSeconds >= 0 &&
    p.maxSeconds >= 1 &&
    p.maxSeconds <= 900 &&
    p.minSeconds <= p.maxSeconds;

  const channelNames = ALL_CHANNELS.filter((c) => p.channels.includes(c.id)).map((c) => c.label);
  const preview =
    p.mode === "instant"
      ? "Replies arrive as soon as they're ready — usually a few seconds."
      : p.mode === "fixed"
        ? `Replies arrive ${formatDuration(p.delaySeconds)} after the customer's ${p.mergeBurst ? "last" : ""} message${p.typingIndicator ? ", with “typing…” showing just before" : ""}.`
        : `A quick “Hi” gets a reply in about ${formatDuration(humanlikeSeconds(p, 2))}; a long paragraph in about ${formatDuration(humanlikeSeconds(p, 400))}${p.typingIndicator ? ", plus a moment of “typing…”" : ""}.`;

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await onSave({ ...p, delaySeconds: Math.round(p.delaySeconds) });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Reply timing"
        subtitle="How quickly the assistant answers on messaging channels. A short, natural pause can feel more personal than an instant bot reply."
      />
      <CardBody className="space-y-5">
        <div>
          <span className="mb-1.5 block text-xs font-medium text-foreground/60">Reply after</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PRESETS.map((pr) => {
              const active = preset === pr.key;
              return (
                <button
                  key={pr.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setSaved(false);
                    setP(pr.apply(p));
                    if (pr.key === "custom" && FIXED_PRESET_SECONDS.has(p.delaySeconds)) setP({ ...p, mode: "fixed", delaySeconds: 90 });
                  }}
                  className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    active
                      ? "border-brand-500/50 bg-brand-500/15 text-foreground"
                      : "border-foreground/10 bg-foreground/5 text-foreground/70 hover:text-foreground"
                  }`}
                >
                  <span className="block text-sm font-medium">{pr.label}</span>
                  <span className="block text-[11px] text-foreground/45">{pr.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        {preset === "custom" ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground/60">Custom delay</span>
              <input
                type="number"
                min={1}
                max={customUnit === "min" ? 15 : 900}
                step={customUnit === "min" ? 0.5 : 1}
                value={Number.isFinite(customValue) ? customValue : ""}
                onChange={(e) => {
                  setSaved(false);
                  const n = Number(e.target.value);
                  setP({ ...p, mode: "fixed", delaySeconds: Math.round(customUnit === "min" ? n * 60 : n) });
                }}
                className="w-28 rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-sm text-foreground outline-none focus:border-brand-500"
              />
            </label>
            <select
              value={customUnit}
              onChange={(e) => setCustomUnit(e.target.value as "sec" | "min")}
              className="rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-sm text-foreground outline-none focus:border-brand-500"
            >
              <option value="sec" className="bg-surface-raised text-foreground">seconds</option>
              <option value="min" className="bg-surface-raised text-foreground">minutes</option>
            </select>
            {p.delaySeconds > 900 || p.delaySeconds < 1 ? <span className="pb-2 text-xs text-danger">Choose between 1 second and 15 minutes.</span> : null}
          </div>
        ) : null}

        {p.mode === "humanlike" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(
              [
                ["minSeconds", "Never quicker than (seconds)"],
                ["maxSeconds", "Never slower than (seconds)"],
              ] as const
            ).map(([field, label]) => (
              <label key={field} className="block">
                <span className="mb-1 block text-xs font-medium text-foreground/60">{label}</span>
                <input
                  type="number"
                  min={field === "minSeconds" ? 0 : 1}
                  max={900}
                  value={p[field]}
                  onChange={(e) => {
                    setSaved(false);
                    setP({ ...p, [field]: Math.round(Number(e.target.value)) });
                  }}
                  className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-sm text-foreground outline-none focus:border-brand-500"
                />
              </label>
            ))}
            {p.minSeconds > p.maxSeconds ? <p className="text-xs text-danger sm:col-span-2">The quickest time can&apos;t be longer than the slowest.</p> : null}
          </div>
        ) : null}

        {p.mode !== "instant" ? (
          <>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
              <Toggle
                checked={p.mergeBurst}
                onChange={(v) => setP({ ...p, mergeBurst: v })}
                title="Let them finish"
                detail="If the customer sends several quick messages, wait for the last one and answer them all in one reply."
              />
              <Toggle
                checked={p.typingIndicator}
                onChange={(v) => setP({ ...p, typingIndicator: v })}
                title="Show “typing…”"
                detail="Marks the message as read and shows typing just before the reply lands, where the channel allows it."
              />
              <Toggle
                checked={p.urgentBypass}
                onChange={(v) => setP({ ...p, urgentBypass: v })}
                title="Skip the wait when urgent"
                detail="Answers at once when a customer says it's urgent or an emergency."
              />
            </div>

            <div>
              <span className="mb-1.5 block text-xs font-medium text-foreground/60">Apply on</span>
              <div className="flex flex-wrap gap-2">
                {ALL_CHANNELS.map((c) => {
                  const on = p.channels.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setSaved(false);
                        setP({ ...p, channels: on ? p.channels.filter((x) => x !== c.id) : [...p.channels, c.id] });
                      }}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        on ? "border-brand-500/50 bg-brand-500/15 text-foreground" : "border-foreground/10 bg-foreground/5 text-foreground/50 hover:text-foreground/80"
                      }`}
                    >
                      {on ? "✓ " : ""}
                      {c.label}
                    </button>
                  );
                })}
              </div>
              {p.channels.length === 0 ? <p className="mt-1.5 text-xs text-danger">Choose at least one channel, or pick Instant.</p> : null}
            </div>
          </>
        ) : null}

        <div className="rounded-lg bg-brand-500/10 px-3.5 py-3 text-xs leading-relaxed text-foreground/70 ring-1 ring-inset ring-brand-500/20">
          <span className="font-semibold text-foreground">What customers get{p.mode !== "instant" && channelNames.length ? ` on ${channelNames.join(", ")}` : ""}: </span>
          {preview} The website chat always answers straight away. A conversation your team has taken over is never delayed.
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={saving || !valid}>
            {saving ? "Saving…" : "Save reply timing"}
          </Button>
          {saved ? (
            <span className="text-xs text-success">
              Saved{isLive ? " — customers get it once the client approves and it's published." : "."}
            </span>
          ) : null}
          {error ? <span className="text-xs text-danger">{error}</span> : null}
        </div>
      </CardBody>
    </Card>
  );
}
