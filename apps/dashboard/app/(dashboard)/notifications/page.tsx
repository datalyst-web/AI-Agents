"use client";

import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, Button } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

/**
 * Self-service escalation notification preferences. All three channels
 * are wired to a real provider (see escalationNotificationSweep.ts) — but
 * SMS/push only actually deliver on a deployment that's configured them
 * (Twilio env vars; a VAPID key pair). Push additionally needs this
 * specific browser/device to grant permission and subscribe, which is
 * what the "Enable on this device" button below does.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

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

  const [pushPublicKey, setPushPublicKey] = useState<string | null>(null);
  const [deviceSubscribed, setDeviceSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const pushSupported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;

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
    api.getPushPublicKey().then((r) => setPushPublicKey(r.publicKey)).catch(() => setPushPublicKey(null));
    if (pushSupported) {
      navigator.serviceWorker.getRegistration("/sw.js").then(async (reg) => {
        const sub = await reg?.pushManager.getSubscription();
        setDeviceSubscribed(Boolean(sub));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function enablePushOnThisDevice() {
    if (!pushPublicKey) return;
    setPushBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Notification permission was denied — enable it in your browser's site settings to use push.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(pushPublicKey) });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await api.savePushSubscription({ endpoint: json.endpoint, keys: json.keys });
      setDeviceSubscribed(true);
      setPush(true);
      await api.updateNotificationPreferences({ notifyEscalationPush: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not enable push notifications on this device.");
    } finally {
      setPushBusy(false);
    }
  }

  async function disablePushOnThisDevice() {
    setPushBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api.deletePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setDeviceSubscribed(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not disable push notifications on this device.");
    } finally {
      setPushBusy(false);
    }
  }

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
          <label className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-foreground">SMS</div>
              <div className="text-xs text-foreground/40">Sent to the phone number below.</div>
            </div>
            <input type="checkbox" checked={sms} disabled={!loaded} onChange={(e) => setSms(e.target.checked)} className="h-4 w-4" />
          </label>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Phone number</label>
            <input
              value={phone}
              disabled={!loaded}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 123 4567"
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-foreground">Push</div>
              <div className="text-xs text-foreground/40">
                {!pushSupported
                  ? "This browser doesn't support push notifications."
                  : !pushPublicKey
                    ? "Not configured on this deployment yet."
                    : deviceSubscribed
                      ? "Enabled on this device."
                      : "Requires enabling on each device you want alerts on."}
              </div>
            </div>
            <input
              type="checkbox"
              checked={push}
              disabled={!loaded || !pushSupported || !pushPublicKey}
              onChange={(e) => setPush(e.target.checked)}
              className="h-4 w-4"
            />
          </div>
          {pushSupported && pushPublicKey ? (
            <div className="flex justify-end">
              {deviceSubscribed ? (
                <Button variant="secondary" onClick={disablePushOnThisDevice} disabled={pushBusy}>
                  {pushBusy ? "Working…" : "Disable on this device"}
                </Button>
              ) : (
                <Button variant="secondary" onClick={enablePushOnThisDevice} disabled={pushBusy}>
                  {pushBusy ? "Working…" : "Enable on this device"}
                </Button>
              )}
            </div>
          ) : null}

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
