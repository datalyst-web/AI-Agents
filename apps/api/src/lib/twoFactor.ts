import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@chat-agent/db";
import { withPlatformContext } from "@chat-agent/db";
import type { EmailProvider } from "@chat-agent/email";

/**
 * Email two-factor for dashboard logins. Both the password and Google
 * paths end here rather than issuing a session directly: proving you know
 * the password (or hold the Google account) gets you a *challenge*, and
 * only a code delivered to the account's own mailbox exchanges that for a
 * real token.
 *
 * Guarding both paths is the whole point. Protecting only one leaves the
 * other as an unguarded way in, which is worse than useless — it looks
 * like security while an attacker simply uses the other form.
 */
export const TWO_FACTOR_CODE_TTL_MINUTES = 10;
export const TWO_FACTOR_MAX_ATTEMPTS = 5;

/** Six digits, uniformly distributed. randomInt is CSPRNG-backed; Math.random is not. */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export interface TwoFactorIssueResult {
  sent: boolean;
  /** Surfaced to the caller so a mail failure never strands someone at a code prompt they can't satisfy. */
  error?: string;
}

/**
 * Generates a code, stores only its hash against the user, and emails the
 * plaintext. Any previously outstanding code is overwritten, so requesting
 * a new one invalidates the old rather than leaving several live at once.
 */
export async function issueTwoFactorCode(
  prisma: PrismaClient,
  email: EmailProvider,
  user: { id: string; email: string; displayName: string },
): Promise<TwoFactorIssueResult> {
  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + TWO_FACTOR_CODE_TTL_MINUTES * 60_000);

  await withPlatformContext(prisma, (tx) =>
    tx.user.update({
      where: { id: user.id },
      data: { twoFactorCodeHash: codeHash, twoFactorExpiresAt: expiresAt, twoFactorAttempts: 0 },
    }),
  );

  const result = await email.send({
    to: user.email,
    subject: `Your sign-in code: ${code}`,
    text:
      `Your sign-in code is ${code}\n\n` +
      `It expires in ${TWO_FACTOR_CODE_TTL_MINUTES} minutes and can only be used once.\n\n` +
      `If you didn't just try to sign in, someone may have your password — change it now.`,
    html:
      `<p>Your sign-in code is:</p>` +
      `<p style="font-size:28px;font-weight:700;letter-spacing:0.18em;margin:16px 0">${code}</p>` +
      `<p>It expires in ${TWO_FACTOR_CODE_TTL_MINUTES} minutes and can only be used once.</p>` +
      `<p style="color:#666">If you didn't just try to sign in, someone may have your password — change it now.</p>`,
  });

  if (!result.sent) {
    // Clear the code we just stored. Leaving it live would mean a user
    // who never received it still has a valid outstanding challenge.
    await withPlatformContext(prisma, (tx) =>
      tx.user.update({
        where: { id: user.id },
        data: { twoFactorCodeHash: null, twoFactorExpiresAt: null, twoFactorAttempts: 0 },
      }),
    );
    return { sent: false, error: result.error ?? "could_not_send_code" };
  }
  return { sent: true };
}

export type TwoFactorVerifyOutcome = "ok" | "invalid" | "expired" | "too_many_attempts" | "no_challenge";

/**
 * Checks a submitted code and, on success, clears it so it can't be
 * replayed. A wrong code burns an attempt; exhausting them voids the
 * challenge entirely rather than merely refusing that guess, so an
 * attacker can't keep hammering the same 6 digits.
 */
export async function verifyTwoFactorCode(
  prisma: PrismaClient,
  userId: string,
  submittedCode: string,
): Promise<TwoFactorVerifyOutcome> {
  return withPlatformContext(prisma, async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { twoFactorCodeHash: true, twoFactorExpiresAt: true, twoFactorAttempts: true },
    });
    if (!user?.twoFactorCodeHash || !user.twoFactorExpiresAt) return "no_challenge";

    const clear = { twoFactorCodeHash: null, twoFactorExpiresAt: null, twoFactorAttempts: 0 };

    if (user.twoFactorExpiresAt.getTime() < Date.now()) {
      await tx.user.update({ where: { id: userId }, data: clear });
      return "expired";
    }
    if (user.twoFactorAttempts >= TWO_FACTOR_MAX_ATTEMPTS) {
      await tx.user.update({ where: { id: userId }, data: clear });
      return "too_many_attempts";
    }

    if (!(await bcrypt.compare(submittedCode, user.twoFactorCodeHash))) {
      const attempts = user.twoFactorAttempts + 1;
      await tx.user.update({
        where: { id: userId },
        data: attempts >= TWO_FACTOR_MAX_ATTEMPTS ? clear : { twoFactorAttempts: attempts },
      });
      return attempts >= TWO_FACTOR_MAX_ATTEMPTS ? "too_many_attempts" : "invalid";
    }

    await tx.user.update({ where: { id: userId }, data: clear });
    return "ok";
  });
}
