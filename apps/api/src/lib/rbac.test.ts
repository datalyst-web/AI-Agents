import { describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { requireTenantMatch } from "./rbac.js";

const TENANT = "3f2b7c1e-8a4d-4e6f-9b1a-2c3d4e5f6a7b";

function run(role: string, routeTenantId: string, userTenantId?: string) {
  const request = { params: { tenantId: routeTenantId }, authUser: { sub: "u1", role, tenantId: userTenantId } } as unknown as FastifyRequest;
  const send = vi.fn();
  const reply = { code: vi.fn(() => ({ send })) } as unknown as FastifyReply;
  return requireTenantMatch()(request, reply).then(() => ({
    status: (reply.code as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as number | undefined,
    body: send.mock.calls[0]?.[0],
    ctx: (request as unknown as { tenantCtx?: { tenantId: string } }).tenantCtx,
  }));
}

describe("requireTenantMatch", () => {
  it("404s a malformed tenant id before it reaches the database, even for platform_admin", async () => {
    for (const bad of ["null", "undefined", "not-a-uuid", `${TENANT}x`]) {
      expect(await run("platform_admin", bad)).toMatchObject({ status: 404, body: { error: "tenant_not_found" } });
    }
  });

  it("still lets platform_admin address a real tenant id", async () => {
    expect(await run("platform_admin", TENANT)).toMatchObject({ status: undefined, ctx: { tenantId: TENANT } });
  });

  it("still refuses a client acting on another tenant", async () => {
    const other = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    expect(await run("tenant_owner", other, TENANT)).toMatchObject({ status: 403, body: { error: "forbidden_tenant_mismatch" } });
    expect(await run("tenant_owner", TENANT, TENANT)).toMatchObject({ status: undefined, ctx: { tenantId: TENANT } });
  });
});
