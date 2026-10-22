// AGENT_BLOCK_v4_VISITOR_TOOLS_v1
import { describe, it, expect, vi, beforeEach } from "vitest";

const callMock = vi.fn();
vi.mock("../../integrations/bfServerClient.js", () => ({
  callBFServer: (...args: unknown[]) => callMock(...args),
}));

import {
  infoProducts,
  INFO_PRODUCTS_TOOL_DESCRIPTOR,
  infoQualifications,
  INFO_QUALIFICATIONS_TOOL_DESCRIPTOR,
} from "../tools/info.js";
import {
  leadCapture,
  LEAD_CAPTURE_TOOL_DESCRIPTOR,
  applyStartUrl,
  APPLY_START_URL_TOOL_DESCRIPTOR,
} from "../tools/leadCapture.js";
import { PRODUCTS, QUALIFICATIONS } from "../tools/infoCatalog.js";
import { setLicensee } from "../../licensee/brand.js";

// KS_AGENT_v1_LICENSEE - the licensee's own catalog, as POST /api/maya/catalog-summary returns it.
const CATALOG = {
  ok: true, lenders: 12, products: 30,
  categories: [
    { category: "TERM", count: 20, min_amount: 25000, max_amount: 2000000, term_min: 12, term_max: 60, term_unit: "months", rate_min: 8, rate_max: 21 },
    { category: "FACTORING", count: 10, min_amount: 10000, max_amount: 500000, term_min: null, term_max: null, term_unit: null, rate_min: null, rate_max: null },
  ],
};

describe("AGENT_BLOCK_v4 — info.products", () => {
  beforeEach(() => { callMock.mockReset(); callMock.mockResolvedValue(CATALOG); });

  it("lists what the licensee offers, from its own catalog, without counts", async () => {
    const r = await infoProducts({});
    expect(r.ok).toBe(true);
    expect(callMock).toHaveBeenCalledWith("/api/maya/catalog-summary", { method: "POST", body: {} });
    expect(r.offered?.map((o) => o.category)).toEqual(["TERM", "FACTORING"]);
    expect(r.offered?.[0]).toMatchObject({ name: "Term loan", min_amount: 25000, max_amount: 2000000, rate_min: 8, rate_max: 21 });
    expect(r.summary).toContain("We currently offer: Term loan, Invoice factoring.");
    expect(JSON.stringify(r)).not.toMatch(/"count"|"lenders"|"products":30/);
    expect(r.products?.length).toBe(PRODUCTS.length);
  });

  it("says whether a product is offered", async () => {
    expect((await infoProducts({ product_key: "factoring" })).summary).toContain("We offer this.");
    expect((await infoProducts({ product_key: "mca" })).summary).toContain("not on our current product list");
  });

  it("falls back to definitions only when the licensee's catalog cannot be read", async () => {
    callMock.mockRejectedValue(new Error("down"));
    const r = await infoProducts({});
    expect(r.ok).toBe(true);
    expect(r.offered).toBeUndefined();
    expect(r.summary).toContain("could not be loaded");
  });

  it("the built-in definitions carry no amounts, terms or previous-owner products", () => {
    const text = JSON.stringify(PRODUCTS);
    expect(text).not.toMatch(/\$|CSBFP|Canada Small Business|typical_range/);
  });

  it("returns a specific product when key matches", async () => {
    const r = await infoProducts({ product_key: "term_loan" });
    expect(r.ok).toBe(true);
    expect(r.product?.key).toBe("term_loan");
    expect(r.summary).toContain("Term loan");
  });

  it("falls back to full list when key unknown", async () => {
    const r = await infoProducts({ product_key: "made_up" });
    expect(r.ok).toBe(true);
    expect(r.products?.length).toBe(PRODUCTS.length);
    expect(r.summary).toContain('No product matches "made_up"');
  });

  it("does not describe PGI - lending only (AGENT_MAYA_BF_ONLY_v702)", async () => {
    expect(PRODUCTS.some((p) => p.key === "pgi")).toBe(false);
  });

  it("descriptor advertises name and no required args", () => {
    expect(INFO_PRODUCTS_TOOL_DESCRIPTOR.function.name).toBe("info.products");
    expect((INFO_PRODUCTS_TOOL_DESCRIPTOR.function.parameters as any).required).toBeUndefined();
  });
});

describe("AGENT_BLOCK_v4 — info.qualifications", () => {
  it("lists all qualification topics when no key", async () => {
    const r = await infoQualifications({});
    expect(r.ok).toBe(true);
    expect(r.qualifications?.length).toBe(QUALIFICATIONS.length);
  });

  it("returns a specific topic when key matches", async () => {
    const r = await infoQualifications({ key: "annual_revenue" });
    expect(r.qualification?.key).toBe("annual_revenue");
  });

  it("descriptor advertises name", () => {
    expect(INFO_QUALIFICATIONS_TOOL_DESCRIPTOR.function.name).toBe("info.qualifications");
  });
});

describe("AGENT_BLOCK_v4 — lead.capture", () => {
  beforeEach(() => callMock.mockReset());

  it("rejects when neither email nor phone given", async () => {
    const r = await leadCapture({ name: "Jane" });
    expect(r.ok).toBe(false);
    expect(callMock).not.toHaveBeenCalled();
  });

  it("rejects when email looks invalid", async () => {
    const r = await leadCapture({ email: "not-an-email" });
    expect(r.ok).toBe(false);
    expect(callMock).not.toHaveBeenCalled();
  });

  it("forwards a valid lead to BF-Server", async () => {
    callMock.mockResolvedValueOnce({});
    const r = await leadCapture({
      name: "Jane Doe",
      email: "jane@example.com",
      company_name: "Acme",
      utm_source: "google",
    });
    expect(r.ok).toBe(true);
    expect(callMock).toHaveBeenCalledWith(
      "/api/crm/startup-waitlist",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          email: "jane@example.com",
          name: "Jane Doe",
          companyName: "Acme",
          channel: "website",
          source: "assistant_visitor_tool",
          utm_source: "google",
        }),
      }),
    );
    expect(r.summary).toContain("jane@example.com");
  });

  it("accepts phone-only leads", async () => {
    callMock.mockResolvedValueOnce({});
    const r = await leadCapture({ phone: "+14165551234" });
    expect(r.ok).toBe(true);
  });

  it("returns ok=false on transport error", async () => {
    callMock.mockRejectedValueOnce(new Error("network"));
    const r = await leadCapture({ email: "jane@example.com" });
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("lead_capture_failed");
  });

  it("descriptor advertises name", () => {
    expect(LEAD_CAPTURE_TOOL_DESCRIPTOR.function.name).toBe("lead.capture");
  });
});

describe("AGENT_BLOCK_v4 — apply.start_url", () => {
  it("returns the licensee's client app URL", async () => {
    setLicensee({ company_name: "Acme Capital", assistant_name: "Ava", support_email: "", support_phone: "", mailing_address: "", urls: { server: "", portal: "", client: "https://client.acme.example", website: "" } });
    const r = await applyStartUrl();
    setLicensee(null);
    expect(r.ok).toBe(true);
    expect(r.url).toBe("https://client.acme.example/");
    expect(r.summary).toContain(r.url);
  });

  it("falls back to CLIENT_URL, and says so when there is no link at all", async () => {
    const prev = process.env.CLIENT_URL;
    process.env.CLIENT_URL = "https://apply.acme.example/";
    expect((await applyStartUrl()).url).toBe("https://apply.acme.example/");
    delete process.env.CLIENT_URL;
    const none = await applyStartUrl();
    expect(none.ok).toBe(false);
    expect(none.url).toBe("");
    if (prev !== undefined) process.env.CLIENT_URL = prev;
  });

  it("descriptor advertises name", () => {
    expect(APPLY_START_URL_TOOL_DESCRIPTOR.function.name).toBe("apply.start_url");
  });
});
