import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { createPrismaClient, withPlatformContext } from "./client.js";

/**
 * Creates the platform's first `platform_admin`.
 *
 * This exists because nothing else can: `POST /v1/platform/staff` is gated
 * behind `requireStaff()`, so creating a staff account requires already
 * being one, and `/v1/auth/signup` only ever produces a `tenant_owner`.
 * A brand-new deployment therefore has no way in without this.
 *
 * Deliberately a CLI run by a human against a known database, not an
 * endpoint — a self-service "make me an admin" route would be a standing
 * privilege-escalation hole for the life of the platform, however well
 * guarded. Safe to re-run: an existing account is promoted rather than
 * duplicated, and the password is only changed when one is supplied.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' \
 *     pnpm --filter @chat-agent/db run create-admin
 */
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const displayName = process.env.ADMIN_NAME?.trim() || "Platform Admin";

  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  if (!email) throw new Error("ADMIN_EMAIL is required.");
  if (!email.includes("@")) throw new Error(`ADMIN_EMAIL doesn't look like an email address: ${email}`);

  const prisma = createPrismaClient(databaseUrl);

  await withPlatformContext(prisma, async (tx) => {
    const existing = await tx.user.findUnique({ where: { email } });

    if (existing) {
      if (!password && existing.role === "platform_admin" && existing.isActive) {
        console.log(`${email} is already an active platform_admin. Nothing to do.`);
        console.log("Pass ADMIN_PASSWORD to reset the password.");
        return;
      }
      // Password is only touched when one was supplied, so re-running this
      // to reactivate an account can't silently invalidate a working login.
      const hashed = password ? await bcrypt.hash(password, 12) : undefined;
      await tx.user.update({
        where: { email },
        data: {
          role: "platform_admin",
          isActive: true,
          // Staff are not scoped to a tenant — see the User.tenantId comment
          // in schema.prisma. Promoting a former client login would
          // otherwise leave it pinned to that client's tenant.
          tenantId: null,
          ...(hashed ? { passwordHash: hashed } : {}),
        },
      });
      console.log(`Promoted existing account ${email} to platform_admin${hashed ? " and reset its password" : ""}.`);
      return;
    }

    if (!password) throw new Error("ADMIN_PASSWORD is required when creating a new account.");
    if (password.length < 12) {
      // Longer than the API's 8-character minimum on purpose: this one
      // account can see and act on every tenant on the platform.
      throw new Error("ADMIN_PASSWORD must be at least 12 characters for a platform_admin account.");
    }

    await tx.user.create({
      data: {
        id: randomUUID(),
        email,
        passwordHash: await bcrypt.hash(password, 12),
        role: "platform_admin",
        displayName,
        tenantId: null,
      },
    });
    console.log(`Created platform_admin ${email}.`);
  });

  const total = await withPlatformContext(prisma, (tx) => tx.user.count({ where: { role: "platform_admin", isActive: true } }));
  console.log(`Active platform_admin accounts: ${total}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Failed to create admin:", err instanceof Error ? err.message : err);
  process.exit(1);
});
