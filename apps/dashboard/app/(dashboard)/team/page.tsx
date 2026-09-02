"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Card, CardBody, CardHeader, Badge, Button, Modal, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

type InvitableRole = "tenant_admin" | "tenant_agent_editor" | "tenant_viewer";

interface Member {
  id: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: string;
}
interface Invite {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
  expired: boolean;
}

const ROLE_LABEL: Record<string, string> = {
  tenant_owner: "Owner",
  tenant_admin: "Admin",
  tenant_agent_editor: "Agent editor",
  tenant_viewer: "Viewer",
};
const INVITABLE_ROLES: { value: InvitableRole; label: string }[] = [
  { value: "tenant_admin", label: "Admin — full access except billing/team removal" },
  { value: "tenant_agent_editor", label: "Agent editor — test agents, view/reply in conversations" },
  { value: "tenant_viewer", label: "Viewer — read-only" },
];

export default function TeamPage() {
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InvitableRole>("tenant_agent_editor");

  // Mirrors shared-types/rbac.ts ROLE_PERMISSIONS: team:invite is granted to
  // tenant_owner and tenant_admin, team:remove only to tenant_owner. The
  // server enforces this regardless — this only decides what to show.
  const canInvite = user?.role === "tenant_owner" || user?.role === "tenant_admin";
  const canRemove = user?.role === "tenant_owner";

  function refresh() {
    if (!user) return;
    api
      .getTeam(user.tenantId)
      .then((d) => {
        setMembers(d.members as Member[]);
        setInvites(d.invites as Invite[]);
      })
      .catch((err) => {
        setMembers([]);
        setInvites([]);
        setError(err instanceof ApiError ? err.message : "Could not load your team.");
      });
  }
  useEffect(refresh, [user]);

  async function sendInvite(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      await api.inviteTeamMember(user.tenantId, inviteEmail, inviteRole);
      setModalOpen(false);
      setInviteEmail("");
      setInviteRole("tenant_agent_editor");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send that invite.");
    } finally {
      setSaving(false);
    }
  }

  async function revokeInvite(inviteId: string) {
    if (!user) return;
    setBusyId(inviteId);
    setError(null);
    try {
      await api.revokeInvite(user.tenantId, inviteId);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not revoke that invite.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeMember(userId: string) {
    if (!user) return;
    setBusyId(userId);
    setError(null);
    try {
      await api.removeTeamMember(user.tenantId, userId);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove that teammate.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Team</h1>
          <p className="mt-1 text-sm text-foreground/50">Who has access to this dashboard, and what they can do here.</p>
        </div>
        {canInvite ? <Button onClick={() => setModalOpen(true)}>+ Invite teammate</Button> : null}
      </div>
      {error && !modalOpen ? <p className="text-xs text-danger">{error}</p> : null}

      <Card>
        <CardHeader title="Members" subtitle={members ? `${members.length} member${members.length === 1 ? "" : "s"}` : undefined} />
        {members === null ? (
          <CardRowSkeleton />
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {members.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-y-2 px-5 py-3.5 text-sm">
                <div>
                  <div className="text-foreground">{m.displayName}</div>
                  <div className="text-xs text-foreground/40">{m.email}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={m.role === "tenant_owner" ? "brand" : "neutral"}>{ROLE_LABEL[m.role] ?? m.role}</Badge>
                  {canRemove && m.id !== user?.id && m.role !== "tenant_owner" ? (
                    <button
                      onClick={() => removeMember(m.id)}
                      disabled={busyId === m.id}
                      className="text-xs font-medium text-foreground/30 transition-colors hover:text-danger disabled:opacity-50"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </CardBody>
        )}
      </Card>

      {invites === null || invites.length > 0 ? (
        <Card>
          <CardHeader title="Pending invites" subtitle={invites ? `${invites.length} pending` : undefined} />
          {invites === null ? (
            <CardRowSkeleton />
          ) : (
            <CardBody className="divide-y divide-surface-border p-0">
              {invites.map((i) => (
                <div key={i.id} className="flex flex-wrap items-center justify-between gap-y-2 px-5 py-3.5 text-sm">
                  <div>
                    <div className="text-foreground">{i.email}</div>
                    <div className="text-xs text-foreground/40">
                      {i.expired ? "Expired" : `Expires ${new Date(i.expiresAt).toLocaleDateString()}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={i.expired ? "warning" : "neutral"}>{ROLE_LABEL[i.role] ?? i.role}</Badge>
                    {canInvite ? (
                      <button
                        onClick={() => revokeInvite(i.id)}
                        disabled={busyId === i.id}
                        className="text-xs font-medium text-foreground/30 transition-colors hover:text-danger disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </CardBody>
          )}
        </Card>
      ) : null}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Invite a teammate" subtitle="They'll get an email with a link to join this dashboard.">
        <form onSubmit={sendInvite} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Email</label>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teammate@company.com"
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Role</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as InvitableRole)}
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
            >
              {INVITABLE_ROLES.map((r) => (
                <option key={r.value} value={r.value} className="bg-surface-overlay text-foreground">
                  {r.value}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] leading-relaxed text-foreground/35">
              {INVITABLE_ROLES.find((r) => r.value === inviteRole)?.label}
            </p>
          </div>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Sending..." : "Send invite"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
