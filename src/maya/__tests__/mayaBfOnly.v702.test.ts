// AGENT_MAYA_BF_ONLY_v702 / KS_AGENT_v1 - Keystone is lending only.
import { describe, expect, it } from "vitest";
import { PRODUCTS } from "../tools/infoCatalog.js";
import { TOOL_REGISTRY } from "../toolRegistry.js";

describe("the assistant describes lending products only", () => {
  it("has no insurance product in its catalogue", () => {
    expect(PRODUCTS.map((p) => p.key)).not.toContain("pgi");
    expect(JSON.stringify(PRODUCTS)).not.toMatch(/Personal Guarantee Insurance|guaranteed loan amount/);
  });

  it("registers no insurance (PGI) tool", () => {
    expect(Object.keys(TOOL_REGISTRY).filter((t) => /pgi|insur/i.test(t))).toEqual([]);
    expect(JSON.stringify(Object.values(TOOL_REGISTRY).map((e) => e.descriptor))).not.toMatch(/\bPGI\b|Personal Guarantee Insurance/);
  });
  // The no-key insurance reply is checked on the live reply in src/api/__tests__/mayaRoute.v789.test.ts.
});
