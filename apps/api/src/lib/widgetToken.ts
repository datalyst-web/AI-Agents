import jwt from "jsonwebtoken";
import { env } from "../env.js";

export interface WidgetTokenClaim {
  tenantId: string;
  agentId: string;
}

const WIDGET_TOKEN_AUDIENCE = "chat-widget";
const WIDGET_TOKEN_TTL = "1h";

/**
 * Short-lived token the widget embed script exchanges its public agentId
 * for (see routes/widgetConfig.routes.ts), then attaches to every chat
 * message as a Bearer token. Deliberately a *separate* signing audience
 * from the staff/dashboard JWT (routes/auth.routes.ts) — a leaked widget
 * token can only ever act as "anonymous customer of this one agent", never
 * as a tenant user, and it carries no role/permission claims at all.
 */
export function signWidgetToken(claim: WidgetTokenClaim): string {
  return jwt.sign(claim, env.JWT_SECRET, {
    issuer: env.JWT_ISSUER,
    audience: WIDGET_TOKEN_AUDIENCE,
    expiresIn: WIDGET_TOKEN_TTL,
  });
}

export function verifyWidgetToken(token: string): WidgetTokenClaim | undefined {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: WIDGET_TOKEN_AUDIENCE,
    }) as jwt.JwtPayload & WidgetTokenClaim;
    return { tenantId: decoded.tenantId, agentId: decoded.agentId };
  } catch {
    return undefined;
  }
}
