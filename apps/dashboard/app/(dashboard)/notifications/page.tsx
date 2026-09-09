"use client";

import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, Button } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

/**
 * Self-service escalation notification preferences. Only email is
 * actually sent today (see escalationNotificationSweep.ts) — SMS/push are
 * accepted and stored but shown here as "coming soon" so nobody thinks
 * toggling them does anything yet.
 */
export default function NotificationsPage() {
  const { user } = useAuth();
  const [email, setEmail] = useState(true);
  const [sms, setSms] = useState(false);
  const [push, setPush] = useState(false);
  const [phone, setPhone] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user) return;
    api
      .me()
      .then((d) => {
        setEmail(d.notifyEscalationEmail);
        setSms(d.notifyEscalationSms);
        setPush(d.notifyEscalationPush);
        setPhone(d.phoneNumber ?? "");
        setLoaded(true);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your preferences."));
  }, [user]);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.updateNotificationPreferences({
        notifyEscalationEmail: email,
        notifyEscalationSms: sms,
        notifyEscalationPush: push,
        phoneNumber: phone.trim() || null,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save your preferences.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Notifications</h1>
        <p className="mt-1 text-sm text-foreground/50">How you want to be alerted when a conversation needs a human.</p>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      <Card>
        <CardHeader title="Escalation alerts" subtitle="Sent when a conversation is handed off to a human and needs attention." />
        <CardBody className="space-y-4">
          <label className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-foreground">Email</div>
              <div className="text-xs text-foreground/40">Sent to your account email.</div>
            </div>
            <input type="checkbox" checked={email} disabled={!loaded} onChange={(e) => setEmail(e.target.checked)} className="h-4 w-4" />
          </label>
          <label className="flex items-center justify-between gap-4 opacity-60">
            <div>
              <div className="text-sm text-foreground">SMS <span className="text-xs text-foreground/35">(coming soon)</span></div>
              <div className="text-xs text-foreground/40">Stored now, not sent yet.</div>
            </div>
            <input type="checkbox" checked={sms} disabled={!loaded} onChange={(e) => setSms(e.target.checked)} className="h-4 w-4" />
          </label>
          <label className="flex items-center justify-between gap-4 opacity-60">
            <div>
              <div className="text-sm text-foreground">Push <span className="text-xs text-foreground/35">(coming soon)</span></div>
              <div className="text-xs text-foreground/40">Stored now, not sent yet.</div>
            </div>
            <input type="checkbox" checked={push} disabled={!loaded} onChange={(e) => setPush(e.target.checked)} className="h-4 w-4" />
          </label>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Phone number <span className="text-foreground/35">(for future SMS)</span></label>
            <input
              value={phone}
              disabled={!loaded}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 123 4567"
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <div className="flex items-center justify-end gap-3 pt-1">
            {saved ? <span className="text-xs text-success">Saved.</span> : null}
            <Button onClick={save} disabled={!loaded || saving}>
              {saving ? "Saving…" : "Save preferences"}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
