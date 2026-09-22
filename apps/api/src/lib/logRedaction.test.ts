import { describe, expect, it } from "vitest";
import { redactUrl } from "./logRedaction.js";

describe("redactUrl", () => {
  it("blanks Meta's webhook verify token but keeps the harmless parts", () => {
    expect(redactUrl("/v1/channels/meta/webhook?hub.mode=subscribe&hub.challenge=1169306054&hub.verify_token=a2f4a39c")).toBe(
      "/v1/channels/meta/webhook?hub.mode=subscribe&hub.challenge=1169306054&hub.verify_token=[redacted]",
    );
  });

  it("blanks other secret-looking parameters, including URL-encoded names", () => {
    const out = redactUrl("/x?api_key=1&access%5Ftoken=2&password=3&code=4&sig=5&page=2");
    expect(out).toBe("/x?api_key=[redacted]&access%5Ftoken=[redacted]&password=[redacted]&code=[redacted]&sig=[redacted]&page=2");
  });

  it("leaves URLs without a query string alone", () => {
    expect(redactUrl("/v1/tenants/abc/agents")).toBe("/v1/tenants/abc/agents");
    expect(redactUrl("/healthz?")).toBe("/healthz?");
  });
});
