// KS_SHARED_HOSTING_v1 - one shared agent for many brokerages: how a request finds its brokerage, that brokerages
// never share state or secrets, the headers every KS-server call carries, and that single-brokerage mode is unchanged.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import { createApp } from "../../app.js";
import { listen, post, toolCall, type Started } from "../../../test/mayaHarness.js";
import { createBfServerFake, openaiScript, type FakeCall } from "../../../test/bfServerFake.js";
import { mayaContext } from "../../../test/mayaContext.js";
import { decryptTenantEnv, decryptTenantValue, encryptTenantValue } from "../crypto.js";
import { clearRegistryCache, findTenantByCode, findTenantByHost, normalizeHost, REGISTRY_TTL_MS, setRegistrySource, type RegistryRow } from "../registry.js";
import { resolveTenant } from "../middleware.js";
import { _uninstallEnvOverlay, installEnvOverlay, runInTenant, tenantHeaders, type TenantContext } from "../context.js";
import { callBFServer } from "../../integrations/bfServerClient.js";
import { appendSessionTurn, getSessionHistory, _clearAllSessions } from "../../maya/sessionHistory.js";
import { getPendingAction, storePendingAction, _clearAllPendingActions } from "../../maya/pendingActions.js";
import { checkBudget, recordUsage, _resetTokenBudgets } from "../../maya/tokenBudget.js";
import { claimHandoff, getProvidedContact, rememberProvidedContact, _clearHandoffState } from "../../maya/handoff.js";
import { getResolvedApplicationId, rememberResolvedApplicationId } from "../../maya/dispatch.js";
import { assistantName, setLicensee, _clearAllLicensees } from "../../licensee/brand.js";
import { serviceTokenSecret } from "../../lib/serviceToken.js";

const KEY = "test-tenant-key";
const realFetch = globalThis.fetch;
const saved = { ...process.env };

const envFor = (code: string) => ({ JWT_SECRET: `${code}-jwt-secret`, KS_COMPANY_NAME: `${code} capital`, KS_LICENSEE_ID: `lic-${code}` });
const row = (code: string, status: string, hosts: string[]): RegistryRow => ({
  code,
  status,
  api_hosts: hosts,
  env_enc: encryptTenantValue(JSON.stringify(envFor(code)), KEY),
});
const ROWS: RegistryRow[] = [
  row("north", "active", ["north.api.ks.test"]),
  row("south", "trial", ["south.api.ks.test", "api.southcapital.ca"]),
  row("closed", "cancelled", ["closed.api.ks.test"]),
  row("paused", "suspended", ["paused.api.ks.test"]),
];
let loads = 0;

const ctx = (code: string): TenantContext => ({ code, status: "active", env: envFor(code) });
const inTenant = <T>(code: string, fn: () => T): T => runInTenant(ctx(code), fn);

function multiMode() {
  process.env.KS_CONTROL_DATABASE_URL = "postgres://reader@ks-shared-pg.test/ks_control";
  process.env.KS_TENANT_KEY = KEY;
  delete process.env.JWT_SECRET;
  delete process.env.AGENT_SERVICE_JWT_SECRET;
}

beforeEach(() => {
  loads = 0;
  setRegistrySource(async () => { loads += 1; return ROWS; });
  _clearAllSessions();
  _clearAllPendingActions();
  _resetTokenBudgets();
  _clearHandoffState();
  _clearAllLicensees();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  _uninstallEnvOverlay();
  for (const k of ["KS_CONTROL_DATABASE_URL", "KS_TENANT_KEY", "JWT_SECRET", "AGENT_SERVICE_JWT_SECRET", "OPENAI_API_KEY", "NODE_ENV"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
afterAll(() => setRegistrySource(null));

describe("registry encryption (v1 AES-256-GCM, key SHA-256(KS_TENANT_KEY))", () => {
  it("round-trips in the shared format and refuses the wrong key", () => {
    const enc = encryptTenantValue("postgres://ks_north_app:pw@host/ks_north", KEY);
    expect(enc).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(Buffer.from(enc.split(":")[1], "base64")).toHaveLength(12);
    expect(decryptTenantValue(enc, KEY)).toBe("postgres://ks_north_app:pw@host/ks_north");
    expect(() => decryptTenantValue(enc, "another-key")).toThrow();
    expect(() => decryptTenantValue("v2:a:b:c", KEY)).toThrow(/unsupported/);
  });

  it("env_enc decrypts to an object of strings; empty means {}", () => {
    expect(decryptTenantEnv(encryptTenantValue(JSON.stringify({ JWT_SECRET: "s", KS_PLAN: "pro" }), KEY), KEY)).toEqual({ JWT_SECRET: "s", KS_PLAN: "pro" });
    expect(decryptTenantEnv("", KEY)).toEqual({});
    expect(() => decryptTenantEnv(encryptTenantValue("[1]", KEY), KEY)).toThrow();
  });
});

describe("brokerage resolution", () => {
  beforeEach(() => { process.env.KS_TENANT_KEY = KEY; });

  it("matches the Host lowercased with the port removed against api_hosts", async () => {
    expect(normalizeHost("North.API.ks.test:443")).toBe("north.api.ks.test");
    expect((await findTenantByHost("North.API.ks.test:8080"))?.code).toBe("north");
    expect((await findTenantByHost("API.SouthCapital.ca"))?.code).toBe("south");
    expect(await findTenantByHost("unknown.example")).toBeNull();
    expect((await findTenantByCode("SOUTH"))?.env?.JWT_SECRET).toBe("south-jwt-secret");
    expect(await findTenantByCode("../etc")).toBeNull();
  });

  it("X-KS-Tenant wins over Host; no match is 404, cancelled is 410, suspended is let through", async () => {
    expect(await resolveTenant("south", "north.api.ks.test")).toMatchObject({ ok: true, tenant: { code: "south" } });
    expect(await resolveTenant(undefined, "north.api.ks.test:443")).toMatchObject({ ok: true, tenant: { code: "north" } });
    expect(await resolveTenant("nobody", "north.api.ks.test")).toEqual({ ok: false, status: 404, error: "unknown_brokerage" });
    expect(await resolveTenant(undefined, "elsewhere.test")).toEqual({ ok: false, status: 404, error: "unknown_brokerage" });
    expect(await resolveTenant(undefined, "closed.api.ks.test")).toEqual({ ok: false, status: 410, error: "brokerage_closed" });
    expect(await resolveTenant("paused", undefined)).toMatchObject({ ok: true, tenant: { code: "paused" } });
  });

  it("caches the registry for 60 seconds and keeps the last good list when a reload fails", async () => {
    const t0 = 1_000_000;
    await findTenantByCode("north", t0);
    await findTenantByCode("south", t0 + REGISTRY_TTL_MS - 1);
    await findTenantByHost("north.api.ks.test", t0 + 30_000);
    expect(loads).toBe(1);
    await findTenantByCode("north", t0 + REGISTRY_TTL_MS + 1);
    expect(loads).toBe(2);
    setRegistrySource(async () => { throw new Error("db down"); });
    expect(await resolveTenant("north", undefined)).toEqual({ ok: false, status: 503, error: "registry_unavailable" });
    let fail = false;
    setRegistrySource(async () => { if (fail) throw new Error("db down"); return ROWS; });
    await findTenantByCode("north", t0);
    fail = true;
    expect((await findTenantByCode("north", t0 + REGISTRY_TTL_MS + 5))?.code).toBe("north");
    clearRegistryCache();
  });

  it("a row whose env_enc cannot be decrypted answers 503, not another brokerage's settings", async () => {
    setRegistrySource(async () => [{ code: "broken", status: "active", api_hosts: ["broken.api.ks.test"], env_enc: encryptTenantValue("{}", "wrong-key") }]);
    expect(await resolveTenant(undefined, "broken.api.ks.test")).toEqual({ ok: false, status: 503, error: "brokerage_unavailable" });
  });
});

describe("per-brokerage state is isolated", () => {
  it("history, pending confirmations, handoff limits, contacts and resolved application ids never cross brokerages", () => {
    const key = "client|+17805550111|sess-1";
    inTenant("north", () => {
      appendSessionTurn(key, "north question", "north answer");
      storePendingAction(key, { kind: "marketing.send_campaign", path: "/x", payload: {}, token: "tok-north", tokenField: "pending_action_id", preview: "p", requestId: "r1", createdAt: Date.now() });
      expect(claimHandoff(key).allowed).toBe(true);
      rememberProvidedContact(key, { name: "Dana", phone: "780-555-0100" });
      rememberResolvedApplicationId(key, "app-north");
    });
    inTenant("south", () => {
      expect(getSessionHistory(key)).toEqual([]);
      expect(getPendingAction(key)).toBeNull();
      expect(claimHandoff(key).allowed).toBe(true);
      expect(getProvidedContact(key)).toEqual({ name: null, phone: null, email: null });
      expect(getResolvedApplicationId(key)).toBeNull();
    });
    inTenant("north", () => {
      expect(getSessionHistory(key).map((m) => m.content)).toEqual(["north question", "north answer"]);
      expect(getPendingAction(key)?.token).toBe("tok-north");
      expect(claimHandoff(key).allowed).toBe(false);
      expect(getResolvedApplicationId(key)).toBe("app-north");
    });
    // Single-brokerage mode (no context) has its own, unprefixed store.
    expect(getSessionHistory(key)).toEqual([]);
  });

  it("each brokerage has its own daily token budget", () => {
    process.env.ASSISTANT_DAILY_TOKEN_BUDGET = "1000";
    try {
      inTenant("north", () => recordUsage("s", 1000));
      inTenant("north", () => expect(checkBudget("other")).toEqual({ ok: false, scope: "global" }));
      inTenant("south", () => expect(checkBudget("s")).toEqual({ ok: true }));
    } finally {
      delete process.env.ASSISTANT_DAILY_TOKEN_BUDGET;
    }
  });

  it("each brokerage has its own loaded names", () => {
    const L = (name: string) => ({ company_name: `${name} Co`, assistant_name: name, support_email: "", support_phone: "", mailing_address: "", urls: { server: "", portal: "", client: "", website: "" } });
    inTenant("north", () => setLicensee(L("Nora")));
    inTenant("south", () => setLicensee(L("Sol")));
    expect(inTenant("north", () => assistantName())).toBe("Nora");
    expect(inTenant("south", () => assistantName())).toBe("Sol");
  });

  it("the env overlay gives each brokerage its own settings and never the shared app's per-brokerage ones", () => {
    multiMode();
    process.env.JWT_SECRET = "shared-app-leftover";
    process.env.OPENAI_API_KEY = "shared-openai";
    installEnvOverlay();
    expect(inTenant("north", () => process.env.JWT_SECRET)).toBe("north-jwt-secret");
    expect(inTenant("south", () => process.env.KS_COMPANY_NAME)).toBe("south capital");
    expect(inTenant("south", () => process.env.OPENAI_API_KEY)).toBe("shared-openai");
    expect(process.env.JWT_SECRET).toBeUndefined();
    expect(inTenant("north", () => serviceTokenSecret())).toBe("north-jwt-secret");
    expect(serviceTokenSecret()).toBeUndefined();
  });
});

describe("outgoing KS-server calls", () => {
  it("carry X-KS-Tenant and a service JWT signed with that brokerage's JWT_SECRET", async () => {
    multiMode();
    const fake = createBfServerFake();
    globalThis.fetch = fake.fetch;
    await inTenant("north", () => callBFServer("/api/telephony/presence", { method: "GET" }));
    await inTenant("south", () => callBFServer("/api/telephony/presence", { method: "GET" }));
    const [n, s] = fake.calls;
    expect(n.headers["x-ks-tenant"]).toBe("north");
    expect(s.headers["x-ks-tenant"]).toBe("south");
    const bearer = (c: FakeCall) => c.headers.authorization.replace(/^Bearer /, "");
    expect(jwt.verify(bearer(n), "north-jwt-secret", { issuer: "agent", audience: "bf-server" })).toBeTruthy();
    expect(() => jwt.verify(bearer(n), "south-jwt-secret")).toThrow();
    expect(jwt.verify(bearer(s), "south-jwt-secret", { issuer: "agent", audience: "bf-server" })).toBeTruthy();
  });

  it("refuse to run outside a brokerage in multi-brokerage mode", async () => {
    multiMode();
    const fake = createBfServerFake();
    globalThis.fetch = fake.fetch;
    await expect(callBFServer("/api/telephony/presence", { method: "GET" })).rejects.toThrow("no_brokerage_context");
    expect(fake.calls).toHaveLength(0);
  });

  it("single-brokerage mode is unchanged: no X-KS-Tenant, signed with the app's own JWT_SECRET", async () => {
    delete process.env.KS_CONTROL_DATABASE_URL;
    process.env.JWT_SECRET = "single-secret";
    const fake = createBfServerFake();
    globalThis.fetch = fake.fetch;
    expect(tenantHeaders()).toEqual({});
    await callBFServer("/api/telephony/presence", { method: "GET" });
    expect(fake.calls[0].headers["x-ks-tenant"]).toBeUndefined();
    expect(jwt.verify(fake.calls[0].headers.authorization.replace(/^Bearer /, ""), "single-secret")).toBeTruthy();
  });
});

describe("the shared app end to end", () => {
  let app: Started;
  const STAFF = { audience: "staff", silo: "BF", staff: { id: "u-7", name: "Sam", email: "sam@north.example", role: "Admin" } };

  beforeAll(async () => {
    multiMode();
    process.env.OPENAI_API_KEY = "test-key";
    app = await listen(createApp().app);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { multiMode(); process.env.OPENAI_API_KEY = "test-key"; });

  function script() {
    const openai = openaiScript([toolCall("t1", "pipeline.facts"), { role: "assistant", content: "12 live deals" }]);
    const fake = createBfServerFake({ openai });
    globalThis.fetch = fake.fetch;
    return fake;
  }

  it("answers a brokerage's staff with that brokerage's data, tenant header and secret", async () => {
    const fake = script();
    const r = await post(app.base, "/api/maya/message", { message: "how many deals?", session_id: "s1" }, {
      "x-ks-tenant": "north",
      "x-maya-context": mayaContext(STAFF, "north-jwt-secret"),
    });
    expect(r.status).toBe(200);
    const ks = fake.calls.filter((c) => !c.url.includes("api.openai.com"));
    expect(ks.map((c) => c.path)).toEqual(expect.arrayContaining(["/api/licensee", "/api/maya/staff/pipeline-facts"]));
    for (const c of ks) expect(c.headers["x-ks-tenant"]).toBe("north");
    const facts = ks.find((c) => c.path === "/api/maya/staff/pipeline-facts")!;
    expect(jwt.verify(facts.headers.authorization.replace(/^Bearer /, ""), "north-jwt-secret")).toBeTruthy();
  });

  it("finds the brokerage by Host when there is no X-KS-Tenant", async () => {
    const fake = script();
    const r = await post(app.base, "/api/maya/message", { message: "how many deals?", session_id: "s1" }, {
      host: "API.SouthCapital.ca",
      "x-maya-context": mayaContext(STAFF, "south-jwt-secret"),
    });
    expect(r.status).toBe(200);
    expect(fake.calls.filter((c) => !c.url.includes("api.openai.com")).every((c) => c.headers["x-ks-tenant"] === "south")).toBe(true);
  });

  it("refuses a context signed by another brokerage", async () => {
    const fake = script();
    const r = await post(app.base, "/api/maya/message", { message: "hi", session_id: "s1" }, {
      "x-ks-tenant": "north",
      "x-maya-context": mayaContext(STAFF, "south-jwt-secret"),
    });
    expect(r.status).toBe(401);
    expect(fake.calls.filter((c) => c.path.startsWith("/api/maya/"))).toHaveLength(0);
  });

  it("unknown brokerage → 404, cancelled → 410, health answers without a brokerage", async () => {
    globalThis.fetch = createBfServerFake().fetch;
    expect(await post(app.base, "/api/maya/message", {}, { host: "nobody.example" })).toEqual({ status: 404, body: { error: "unknown_brokerage" } });
    expect(await post(app.base, "/api/maya/message", {}, { "x-ks-tenant": "closed" })).toEqual({ status: 410, body: { error: "brokerage_closed" } });
    const health = await new Promise<number>((resolve, reject) => {
      import("node:http").then((http) => http.get(`${app.base}/health`, { headers: { host: "nobody.example" } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); }).on("error", reject));
    });
    expect(health).toBe(200);
  });
});
