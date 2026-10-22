import { describe, expect, it, vi } from "vitest";
import { validateProductionEnv } from "../index.js";

describe("index production env validation", () => {
  it("warns and does not throw when neither AGENT_API_TOKEN nor JWT_SECRET is set in production", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(() =>
      validateProductionEnv({
        NODE_ENV: "production",
        AGENT_SHARED_SECRET: "shared-secret",
      } as any),
    ).not.toThrow();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("AGENT_API_TOKEN is not set or is test_token"));
    warnSpy.mockRestore();
  });

  // KS_AGENT_v1_CONFIG - SERVER_URL, JWT_SECRET, OPENAI_API_KEY and PORT are all the agent needs.
  it("does not warn when the four settings are present", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    validateProductionEnv({ NODE_ENV: "production", JWT_SECRET: "jwt-secret-123", SERVER_URL: "https://server.acme.example", OPENAI_API_KEY: "k", PORT: "8080" } as any);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
