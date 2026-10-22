// KS_AGENT_v1_LICENSEE - the licensee's names load from GET {SERVER_URL}/api/licensee at startup and every 5 minutes,
// fall back to KS_COMPANY_NAME / KS_ASSISTANT_NAME and then to neutral defaults, and every prompt and reply uses them.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assistantIntro, assistantName, clientAppUrl, companyName, contactLine, LICENSEE_REFRESH_MS, loadedLicensee, parseLicensee,
  refreshLicensee, setLicensee, startLicenseeRefresh, supportPhone, teamRef,
} from "../brand.js";
import { createBfServerFake, openaiScript } from "../../../test/bfServerFake.js";
import { LICENSEE } from "../../../test/fixtures/bfServer.v789.js";
import { ask, post, startMayaRouter, type Started } from "../../../test/mayaHarness.js";
import { mayaContext } from "../../../test/mayaContext.js";
import { budgetFallbackReply, FAILOVER_REPLIES } from "../../api/maya.js";
import { descriptorsForAudience } from "../../maya/toolRegistry.js";
import { _resetTokenBudgets } from "../../maya/tokenBudget.js";
import { _clearHandoffState } from "../../maya/handoff.js";
import { _clearAllSessions } from "../../maya/sessionHistory.js";
// @ts-expect-error - plain ESM script without types
import { brandHits, isBranded, scanRepo } from "../../../scripts/check-brand-strings.mjs";

// Anything that would show the previous owner (its names, domains, numbered company, street, people or number).
const PREVIOUS_OWNER = /boreal|2630108|sparling|werboweski|\bTodd\b|\bAndrew\b|\bMaya\b|866\D?631\D?8939/i;

const realFetch = globalThis.fetch;
const ENV_KEYS = ["KS_COMPANY_NAME", "KS_ASSISTANT_NAME", "KS_SUPPORT_EMAIL", "KS_SUPPORT_PHONE", "CLIENT_URL", "SERVER_URL"] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  for (const k of ENV_KEYS) if (k !== "SERVER_URL") delete process.env[k];
  setLicensee(null);
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  setLicensee(null);
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

describe("loading the licensee", () => {
  it("reads GET {SERVER_URL}/api/licensee and uses its names", async () => {
    const fake = createBfServerFake();
    const loaded = await refreshLicensee({ SERVER_URL: "https://server.acme.example/" }, fake.fetch);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ method: "GET", url: "https://server.acme.example/api/licensee" });
    expect(loaded?.company_name).toBe("Acme Capital");
    expect(companyName()).toBe("Acme Capital");
    expect(assistantName()).toBe("Ava");
    expect(supportPhone()).toBe("1-800-555-0100");
    expect(clientAppUrl()).toBe("https://client.acme.example");
    expect(loadedLicensee()?.mailing_address).toBe("100 Main St, Calgary AB");
    expect(assistantIntro()).toBe("Ava, the AI assistant for Acme Capital");
    expect(contactLine()).toBe("call 1-800-555-0100 or email help@acme.example");
    expect(teamRef()).toBe("the Acme Capital team");
  });

  it("keeps the last values when the server fails, answers non-2xx, or sends something unreadable", async () => {
    setLicensee(parseLicensee(LICENSEE));
    for (const answer of [new Response("down", { status: 503 }), new Response("not json", { status: 200 }), new Response(JSON.stringify({ ok: true, licensee: {} }), { status: 200 })]) {
      const fake = createBfServerFake({ overrides: { "/api/licensee": answer } });
      expect(await refreshLicensee({ SERVER_URL: "https://server.acme.example" }, fake.fetch)).toBeNull();
      expect(companyName()).toBe("Acme Capital");
    }
    const throwing = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    expect(await refreshLicensee({ SERVER_URL: "https://server.acme.example" }, throwing)).toBeNull();
    expect(assistantName()).toBe("Ava");
  });

  it("does not call anything without SERVER_URL", async () => {
    const fake = createBfServerFake();
    expect(await refreshLicensee({}, fake.fetch)).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  it("falls back to KS_COMPANY_NAME / KS_ASSISTANT_NAME before the first load, then to neutral defaults", () => {
    expect(assistantName()).toBe("Assistant");
    expect(companyName()).toBe("our company");
    expect(assistantIntro()).toBe("Assistant, an AI assistant");
    expect(teamRef()).toBe("our team");
    expect(contactLine()).toBe("");
    process.env.KS_COMPANY_NAME = "Birch Lending";
    process.env.KS_ASSISTANT_NAME = "Remy";
    process.env.KS_SUPPORT_PHONE = "1-877-555-0142";
    expect(companyName()).toBe("Birch Lending");
    expect(assistantName()).toBe("Remy");
    expect(assistantIntro()).toBe("Remy, the AI assistant for Birch Lending");
    expect(contactLine()).toBe("call 1-877-555-0142");
    // the server's values win over the settings once loaded
    setLicensee(parseLicensee(LICENSEE));
    expect(companyName()).toBe("Acme Capital");
    expect(assistantName()).toBe("Ava");
  });

  it("an empty assistant name from the server falls back to the setting, then to Assistant", () => {
    setLicensee(parseLicensee({ licensee: { ...LICENSEE.licensee, assistant_name: "" } }));
    expect(assistantName()).toBe("Assistant");
    process.env.KS_ASSISTANT_NAME = "Remy";
    expect(assistantName()).toBe("Remy");
  });

  it("parseLicensee drops unusable bodies and non-http URLs", () => {
    expect(parseLicensee(null)).toBeNull();
    expect(parseLicensee({ ok: true })).toBeNull();
    const p = parseLicensee({ licensee: { company_name: "Acme Capital", urls: { client: "javascript:alert(1)", portal: "https://staff.acme.example/" } } });
    expect(p?.urls.client).toBe("");
    expect(p?.urls.portal).toBe("https://staff.acme.example");
  });

  it("refreshes every 5 minutes after the startup load", async () => {
    vi.useFakeTimers();
    const fake = createBfServerFake();
    const r = startLicenseeRefresh(LICENSEE_REFRESH_MS, { SERVER_URL: "https://server.acme.example" }, fake.fetch);
    await r.ready;
    expect(fake.calls).toHaveLength(1);
    expect(LICENSEE_REFRESH_MS).toBe(300_000);
    await vi.advanceTimersByTimeAsync(LICENSEE_REFRESH_MS);
    expect(fake.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(LICENSEE_REFRESH_MS * 2);
    expect(fake.calls).toHaveLength(4);
    r.stop();
    await vi.advanceTimersByTimeAsync(LICENSEE_REFRESH_MS * 2);
    expect(fake.calls).toHaveLength(4);
  });
});

describe("prompts and replies carry the licensee's names, never the previous owner's", () => {
  let maya: Started;
  const VISITOR = { audience: "visitor", sub: "v-1" };
  const CLIENT = { audience: "client", phone: "+17805550111" };
  const STAFF = { audience: "staff", staff: { id: "u-7", name: "Dana Staff", email: "dana@acme.example", role: "Admin" } };
  beforeAll(async () => { process.env.JWT_SECRET = "brand-test-secret"; maya = await startMayaRouter(); });
  afterAll(async () => { await maya.close(); });
  beforeEach(() => { process.env.OPENAI_API_KEY = "test-key"; _resetTokenBudgets(); _clearHandoffState(); _clearAllSessions(); });

  it("every audience's system prompt names the licensee's assistant and company", async () => {
    await refreshLicensee({ SERVER_URL: "https://server.acme.example" }, createBfServerFake().fetch);
    for (const claims of [VISITOR, CLIENT, STAFF]) {
      const r = await ask(maya.base, { message: "hello" }, claims, [{ role: "assistant", content: "Hi there." }]);
      expect(r.status).toBe(200);
      expect(r.system, claims.audience).toContain("You are Ava, the AI assistant for Acme Capital.");
      expect(r.system, claims.audience).toContain("Acme Capital");
      expect(r.system, claims.audience).not.toMatch(PREVIOUS_OWNER);
      expect(JSON.stringify(r.openai[0]), claims.audience).not.toMatch(PREVIOUS_OWNER);
    }
  });

  it("with no licensee loaded and no settings, the prompt is neutral", async () => {
    const r = await ask(maya.base, { message: "hello" }, VISITOR, [{ role: "assistant", content: "Hi." }]);
    expect(r.system).toContain("You are Assistant, an AI assistant.");
    expect(r.system).not.toMatch(PREVIOUS_OWNER);
  });

  it("follows a rename on the next refresh", async () => {
    await refreshLicensee({ SERVER_URL: "https://server.acme.example" }, createBfServerFake().fetch);
    const renamed = createBfServerFake({ overrides: { "/api/licensee": { ok: true, licensee: { ...LICENSEE.licensee, company_name: "Acme Lending", assistant_name: "Juniper" } } } });
    await refreshLicensee({ SERVER_URL: "https://server.acme.example" }, renamed.fetch);
    const r = await ask(maya.base, { message: "hello" }, VISITOR, [{ role: "assistant", content: "Hi." }]);
    expect(r.system).toContain("You are Juniper, the AI assistant for Acme Lending.");
    expect(r.system).not.toContain("Ava");
  });

  it("outage, budget and no-key replies use the licensee's team and contacts", async () => {
    setLicensee(parseLicensee(LICENSEE));
    expect(FAILOVER_REPLIES.notified).toContain("the Acme Capital team");
    expect(FAILOVER_REPLIES.staff).toBe("Ava is having trouble reaching the model right now. Please try again in a minute.");
    expect(budgetFallbackReply("website")).toContain("call 1-800-555-0100 or email help@acme.example");
    for (const s of ["website", "client_widget", "client_portal_chat", "staff", "unknown"] as const) {
      expect(budgetFallbackReply(s)).not.toMatch(PREVIOUS_OWNER);
      expect(FAILOVER_REPLIES.failed(s)).not.toMatch(PREVIOUS_OWNER);
    }
    delete process.env.OPENAI_API_KEY;
    globalThis.fetch = createBfServerFake().fetch;
    for (const message of ["hi", "who are you?", "do you do equipment loans?", "what are your hours?", "something else"]) {
      for (const claims of [VISITOR, CLIENT]) {
        const r = await post(maya.base, "/api/maya/message", { message }, { "x-maya-context": mayaContext(claims) });
        expect(r.body.reply, message).not.toMatch(PREVIOUS_OWNER);
      }
    }
    const who = await post(maya.base, "/api/maya/message", { message: "who are you?" }, { "x-maya-context": mayaContext(VISITOR) });
    expect(who.body.reply).toContain("I'm Ava, the AI assistant for Acme Capital");
  });

  it("an OpenAI outage hands off with the licensee's assistant name on the note", async () => {
    setLicensee(parseLicensee(LICENSEE));
    const fake = createBfServerFake({ openai: () => new Response("down", { status: 500 }) });
    globalThis.fetch = fake.fetch;
    const r = await post(maya.base, "/api/maya/message", { message: "status?" }, { "x-maya-context": mayaContext(CLIENT) });
    expect(r.body.reply).toBe(FAILOVER_REPLIES.notified);
    const esc = fake.calls.find((c) => c.path === "/api/maya/escalate");
    expect(esc?.body.message).toBe("[Ava unavailable] status?");
  });

  it("no tool description offered to any audience names the previous owner, insurance or another silo", () => {
    for (const audience of ["visitor", "client", "staff"] as const) {
      const text = JSON.stringify(descriptorsForAudience(audience, { includeConfirm: true }));
      expect(text, audience).not.toMatch(PREVIOUS_OWNER);
      expect(text, audience).not.toMatch(/\bPGI\b|\bBI\b|\bSLF\b|silo/);
    }
  });

  it("the model's own mention of the previous owner is not added by the agent (sanity: the openai script is echoed as-is)", async () => {
    setLicensee(parseLicensee(LICENSEE));
    const openai = openaiScript([{ role: "assistant", content: "Welcome to Acme Capital." }]);
    globalThis.fetch = createBfServerFake({ openai }).fetch;
    const r = await post(maya.base, "/api/maya/message", { message: "hi" }, { "x-maya-context": mayaContext(VISITOR) });
    expect(r.body.reply).toBe("Welcome to Acme Capital.");
  });
});

describe("scripts/check-brand-strings.mjs", () => {
  it("flags previous-owner text in string literals but not in comments, identifiers or server paths", () => {
    const src = [
      "// a comment about Boreal is fine",
      "const path = \"/api/maya/message\";",
      "const header = \"x-maya-context\";",
      "const ok = `You are ${name}, the assistant`;",
      "const bad1 = \"Welcome to Boreal Financial\";",
      "const bad2 = `I'm Maya, your guide`;",
      "const bad3 = 'call 1-866-631-8939';",
    ].join("\n");
    expect(brandHits(src)).toEqual(["Welcome to Boreal Financial", "I'm Maya, your guide", "call 1-866-631-8939"]);
    expect(isBranded("server.boreal.financial")).toBe(true);
    expect(isBranded("Acme Capital")).toBe(false);
  });

  it("finds nothing under src/", () => {
    expect(scanRepo(process.cwd())).toEqual([]);
  });
});
