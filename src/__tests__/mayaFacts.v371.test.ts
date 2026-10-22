// AGENT_MAYA_FACTS_v371 + AGENT_MAYA_SITE_FACTS_v371 + AGENT_MAYA_CLIENT_v371 + AGENT_MAYA_TOOL_LOOP_v371
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const bfTool = vi.hoisted(() => ({ calls: [] as Array<{ path: string; body: any }> }));
vi.mock("../integrations/bfServerClient.js", async (orig) => {
  const real: any = await orig();
  return { ...real, callBFServer: async (path: string, opts: any) => {
    bfTool.calls.push({ path, body: opts?.body ?? null });
    if (path.includes("/pipeline-facts")) return { ok: true, active_count: 9, funded_this_month: 0, by_stage: { "Documents Required": { count: 1, applications: [{ name: "BIBUSA CN LLC" }] } } };
    if (path.includes("/application-summary")) return { ok: true, summary: { name: "BIBUSA CN LLC" } };
    return { ok: true };
  } };
});
import express from "express";
import type { AddressInfo } from "node:net";
import http from "node:http";
import jwt from "jsonwebtoken";

process.env.OPENAI_API_KEY = "test-key";
process.env.JWT_SECRET = "test-secret-at-least-10";
const { mayaRouter } = await import("../api/maya.js");
const { TOOLS_BY_AUDIENCE } = await import("../maya/audience.js");
const { infoQualifications } = await import("../maya/tools/info.js");
const { setLicensee } = await import("../licensee/brand.js");

// KS_AGENT_v1_LICENSEE - the licensee as GET /api/licensee returns it.
const LICENSEE = {
  company_name: "Acme Capital", assistant_name: "Ava", support_email: "help@acme.example", support_phone: "1-800-555-0100",
  mailing_address: "100 Main St, Calgary AB", urls: { server: "https://server.acme.example", portal: "https://staff.acme.example", client: "https://client.acme.example", website: "https://acme.example" },
};

const realFetch = globalThis.fetch;
const openaiBodies: any[] = [];
const bfCalls: Array<{ url: string; body: any }> = [];
let openaiScript: any[] = [];
let base = "";
let server: any;

beforeAll(async () => {
  setLicensee(LICENSEE);
  const app = express(); app.use(express.json()); app.use(mayaRouter);
  server = app.listen(0); base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (url.includes("api.openai.com")) {
      openaiBodies.push(JSON.parse(init.body));
      const msg = openaiScript.shift() ?? { role: "assistant", content: "" };
      return new Response(JSON.stringify({ choices: [{ message: msg }] }), { status: 200 });
    }
    bfCalls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (url.includes("/pipeline-facts")) return new Response(JSON.stringify({ ok: true, active_count: 9, funded_this_month: 0, by_stage: { "Documents Required": { count: 1, applications: [{ name: "BIBUSA CN LLC", id: "app-1" }] } } }), { status: 200 });
    if (url.includes("/application-summary")) return new Response(JSON.stringify({ ok: true, summary: { name: "BIBUSA CN LLC" } }), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as any;
});
afterAll(() => { globalThis.fetch = realFetch; server?.close(); setLicensee(null); });

// node:http rather than fetch: the shared test setup fakes a browser window, which breaks fetch reads of a local server.
// v784 - identity travels in a signed X-Maya-Context, not the audience header or body.
const ask = (body: any, audience: string): Promise<any> => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const claims: any = { kind: "maya_context", audience };
  if (audience === "staff") claims.staff = { id: "staff-1", ...(body.staff ?? {}) };
  if (audience === "client" && body.phone) claims.phone = body.phone;
  const context = jwt.sign(claims, process.env.JWT_SECRET as string, { algorithm: "HS256", expiresIn: "5m" });
  const req = http.request(base + "/api/maya/message", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), "x-maya-context": context } }, (res) => {
    let t = ""; res.setEncoding("utf8"); res.on("data", (c) => { t += c; }); res.on("end", () => { try { resolve(JSON.parse(t || "{}")); } catch (e) { reject(e); } });
  });
  req.on("error", reject); req.end(data);
});

describe("staff assistant", () => {
  it("can chain tools (find, then summarise) and answers from them", async () => {
    openaiBodies.length = 0; bfCalls.length = 0;
    openaiScript = [
      { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "pipeline_facts", arguments: "{}" } }] },
      { role: "assistant", content: null, tool_calls: [{ id: "t2", type: "function", function: { name: "application_summary", arguments: JSON.stringify({ name: "BIBUSA" }) } }] },
      { role: "assistant", content: "BIBUSA CN LLC is in Documents Required." },
    ];
    const r = await ask({ message: "Who is in Documents Required and what's the detail on it?", staff: { name: "Sam", role: "Admin" }, screen_context: { silo: "BF" } }, "staff");
    expect(r.reply).toBe("BIBUSA CN LLC is in Documents Required.");
    expect(r.executedTools).toEqual(["pipeline.facts", "application.summary"]);
    const facts = bfTool.calls.find((c) => c.path.includes("/pipeline-facts"))!;
    expect(facts.body.role).toBe("Admin");
    expect(facts.body.silo).toBe("BF");
    expect(bfTool.calls.find((c) => c.path.includes("/application-summary"))!.body.name).toBe("BIBUSA");
    expect(openaiBodies[1].tools?.length).toBeGreaterThan(0);
    const sys = openaiBodies[0].messages[0].content as string;
    expect(sys).toContain("You are Ava, the AI assistant for Acme Capital.");
    expect(sys).toContain("COMPANY: you work for Acme Capital (mailing address: 100 Main St, Calgary AB)");
    expect(sys).not.toMatch(/Boreal|Maya|Alberta Ltd|Sparling|Werboweski/);
    expect(sys).toContain("call pipeline.facts first");
    expect(sys).toContain("Never estimate or make up a number");
  });
  it("never returns a blank reply", async () => {
    openaiScript = [
      { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "pipeline_facts", arguments: "{}" } }] },
      { role: "assistant", content: "" },
    ];
    const r = await ask({ message: "Summarize the last 30 days", staff: { role: "Admin" } }, "staff");
    expect(r.reply.length).toBeGreaterThan(10);
  });
});

describe("website assistant uses the licensee's facts", () => {
  it("takes company facts only from the licensee's data and no longer offers the tools that leaked internal counts", async () => {
    openaiBodies.length = 0;
    openaiScript = [{ role: "assistant", content: "A lender reviews your file." }];
    await ask({ message: "Will applying hurt my credit?" }, "visitor");
    const sys = openaiBodies[0].messages[0].content as string;
    for (const fact of ["COMPANY FACTS: you represent Acme Capital", "come ONLY from tool results", "Never give a lender or product count a tool did not give you", "Never promise same-day funding", "Never say whether applying affects their credit unless the company knowledge says so", "Acme Capital handles the lenders", "do not offer insurance products", "Talk to a Human button", "waitlist.join", "https://client.acme.example"]) expect(sys).toContain(fact);
    // the previous owner's site facts are gone
    for (const gone of ["80+ lenders", "$10K to $100M+", "as little as 3-4 days", "2% fee agreement", "Personal Guarantee Insurance", "1-866", "Boreal"]) expect(sys).not.toContain(gone);
    expect(TOOLS_BY_AUDIENCE.visitor).not.toContain("info.lenders");
    expect(TOOLS_BY_AUDIENCE.visitor).not.toContain("catalog.summary");
    expect(sys).toContain("Never end a reply with 'Would you like to proceed?'");
  });
});

describe("client assistant", () => {
  it("sees the full application profile and follows the client rules", async () => {
    openaiBodies.length = 0;
    openaiScript = [{ role: "assistant", content: "ok" }];
    const prev = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      if (String(input).includes("/applications-by-phone")) {
        return new Response(JSON.stringify({ ok: true, contactName: "Sam", applications: [{ shortId: "61AE", name: "TEST - Sam's Grocery Store", productCategory: "SBA", stage: "Off to Lender",
          business: { street: "1 Main", employees: 12 }, financialProfile: { useOfFunds: "Expansion", existingDebt: 0 }, documents: { missing: [], received: ["Lease"], accepted: ["Bank statements"] } }], offers: [] }), { status: 200 });
      }
      return (prev as any)(input, init);
    }) as any;
    await ask({ message: "What do you have on my business?", phone: "+15875550100" }, "client");
    globalThis.fetch = prev;
    const sys = openaiBodies[0].messages[0].content as string;
    expect(sys).toContain('"shortId":"61AE"');
    expect(sys).toContain('"useOfFunds":"Expansion"');
    expect(sys).toContain('"received":["Lease"]');
    expect(sys).toContain("Off to Lender - your file is with lenders");
    expect(sys).toContain("Never say which lenders, or how many lenders, have their file");
    expect(sys).toContain("FACTOR RATE");
  });
});

describe("qualifications are general guidance", () => {
  it("quotes no thresholds of its own - the licensee's come from its knowledge", async () => {
    // AGENT_v789: checked on what info.qualifications actually answers, not on the source text.
    const cat = JSON.stringify(await infoQualifications({}));
    for (const gone of ["Mid-600s", "never pulls your credit", "6 months", "$10,000", "Boreal"]) expect(cat).not.toContain(gone);
    expect(cat).toContain("Only quote a specific minimum if the company knowledge gives one");
  });
});
