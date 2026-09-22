import type { FastifyRequest } from "fastify";

/**
 * Query parameters whose values must never reach the logs. Webhook
 * providers put shared secrets in the URL (Meta's hub.verify_token is
 * what exposed this), and the default request log line prints the full
 * URL — so every such request copied the secret into Railway's log store.
 */
const SENSITIVE_PARAM = /token|secret|key|password|passwd|signature|sig|code|auth|credential/i;

export function redactUrl(url: string): string {
  const q = url.indexOf("?");
  if (q === -1) return url;
  const params = url
    .slice(q + 1)
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) return pair;
      const name = decodeURIComponentSafe(pair.slice(0, eq));
      return SENSITIVE_PARAM.test(name) ? `${pair.slice(0, eq)}=[redacted]` : pair;
    });
  return `${url.slice(0, q)}?${params.join("&")}`;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Same fields as Fastify's default request serializer, with the URL redacted. */
export function redactingRequestSerializer(request: FastifyRequest) {
  return {
    method: request.method,
    url: redactUrl(request.url),
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  };
}
