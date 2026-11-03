// KS_SHARED_HOSTING_v1 - which brokerage the current request belongs to.
//
// Single-brokerage mode (KS_CONTROL_DATABASE_URL unset): there is never a brokerage context and nothing here changes
// behaviour; the agent reads its own App Service settings exactly as before.
//
// Multi-brokerage mode (KS_CONTROL_DATABASE_URL set): every request (except health checks) runs inside
// runInTenant({ code, status, env }), where env is the brokerage's decrypted env_enc. Three things follow from it:
//   - process.env reads of a brokerage key return that brokerage's value (installEnvOverlay). Per-brokerage keys
//     (PER_BROKERAGE_KEYS) never fall back to the shared app's own settings, so one brokerage can never pick up a
//     secret or a name that is not its own; other keys (OPENAI_API_KEY, budgets, ...) fall back to the shared value.
//   - every outgoing KS-server call carries X-KS-Tenant and a service JWT signed with the brokerage's JWT_SECRET.
//   - every in-memory store the agent keeps (history, pending confirmations, handoff limits, token budgets, the
//     resolved application id, the licensee's names) is keyed by the brokerage code (tenantKey).
import { AsyncLocalStorage } from "node:async_hooks";

export const TENANT_HEADER = "x-ks-tenant";

export type TenantContext = {
  code: string;
  status: string;
  /** The brokerage's own settings (decrypted env_enc). */
  env: Readonly<Record<string, string>>;
};

const als = new AsyncLocalStorage<TenantContext>();

/** True when the agent serves many brokerages (KS_CONTROL_DATABASE_URL is set on the shared app). */
export function isMultiBrokerage(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.KS_CONTROL_DATABASE_URL?.trim());
}

export function runInTenant<T>(tenant: TenantContext, fn: () => T): T {
  return als.run(tenant, fn);
}

export function currentTenant(): TenantContext | undefined {
  return als.getStore();
}

export class NoBrokerageContextError extends Error {
  constructor() {
    super("no_brokerage_context");
    this.name = "NoBrokerageContextError";
  }
}

/** The current brokerage, or throws no_brokerage_context in multi-brokerage mode. Undefined in single mode. */
export function requireTenantInMultiMode(): TenantContext | undefined {
  const t = currentTenant();
  if (!t && isMultiBrokerage()) throw new NoBrokerageContextError();
  return t;
}

/** A store key scoped to the current brokerage. Unchanged in single-brokerage mode (no context). */
export function tenantKey(key: string): string {
  if (!key) return key;
  const t = currentTenant();
  return t ? `${t.code}::${key}` : key;
}

/** The current brokerage's code, or "" (single-brokerage mode / no context). */
export function tenantCode(): string {
  return currentTenant()?.code ?? "";
}

/** Headers every KS-server call carries: X-KS-Tenant in multi-brokerage mode, nothing in single mode. */
export function tenantHeaders(): Record<string, string> {
  const t = requireTenantInMultiMode();
  return t ? { "X-KS-Tenant": t.code } : {};
}

// The values that sit in a brokerage's own settings (contract "Per-brokerage env"), plus the agent's own
// per-brokerage settings. On the shared app these come only from the brokerage's env_enc.
const PER_BROKERAGE_EXACT = new Set([
  "JWT_SECRET",
  "AGENT_SERVICE_JWT_SECRET",
  "AGENT_API_TOKEN",
  "OTP_HASH_SALT",
  "KS_LICENSEE_ID",
  "KS_OPS_KEY",
  "KS_OPS_URL",
  "KS_PLAN",
  "KS_SERVER_URL",
  "KS_PORTAL_URL",
  "KS_CLIENT_URL",
  "CLIENT_URL",
  "PUBLIC_BASE_URL",
  "PUBLIC_SERVER_URL",
  "MAYA_URL",
  "KS_OAUTH_BROKER_URL",
  "SENDGRID_FROM",
  "SENDGRID_REPLY_TO",
  "KS_COMPANY_NAME",
  "KS_ASSISTANT_NAME",
  "KS_SUPPORT_EMAIL",
  "KS_SUPPORT_PHONE",
  "ASSISTANT_PRIVATE_NUMBERS",
]);
const PER_BROKERAGE_PREFIXES = ["QBO_", "TWILIO_", "KS_M365_", "KS_GOOGLE_", "SIGNNOW_"];

export function isPerBrokerageKey(key: string): boolean {
  return PER_BROKERAGE_EXACT.has(key) || PER_BROKERAGE_PREFIXES.some((p) => key.startsWith(p));
}

/** What process.env[key] reads as for this brokerage (or for no brokerage, in multi-brokerage mode). */
export function overlayValue(shared: NodeJS.ProcessEnv, key: string, tenant: TenantContext | undefined): string | undefined {
  if (tenant && Object.prototype.hasOwnProperty.call(tenant.env, key)) return tenant.env[key];
  if (isPerBrokerageKey(key)) return undefined;
  return shared[key];
}

let realEnv: NodeJS.ProcessEnv | null = null;

/**
 * Multi-brokerage mode only: makes process.env read the current brokerage's values (installed once at startup).
 * Writes still go to the real environment. A no-op when already installed.
 */
export function installEnvOverlay(): void {
  if (realEnv) return;
  const target = process.env;
  realEnv = target;
  process.env = new Proxy(target, {
    get(t, key, receiver) {
      if (typeof key !== "string") return Reflect.get(t, key, receiver);
      return overlayValue(t, key, currentTenant());
    },
    has(t, key) {
      if (typeof key !== "string") return Reflect.has(t, key);
      return overlayValue(t, key, currentTenant()) !== undefined;
    },
    ownKeys(t) {
      const tenant = currentTenant();
      const keys = new Set(Reflect.ownKeys(t).filter((k) => typeof k !== "string" || !isPerBrokerageKey(k)));
      for (const k of Object.keys(tenant?.env ?? {})) keys.add(k);
      return [...keys];
    },
    getOwnPropertyDescriptor(t, key) {
      if (typeof key !== "string") return Reflect.getOwnPropertyDescriptor(t, key);
      const value = overlayValue(t, key, currentTenant());
      return value === undefined ? undefined : { value, writable: true, enumerable: true, configurable: true };
    },
  }) as NodeJS.ProcessEnv;
}

/** Test hook: puts the real process.env back. */
export function _uninstallEnvOverlay(): void {
  if (!realEnv) return;
  process.env = realEnv;
  realEnv = null;
}

/**
 * A per-brokerage setting read explicitly (used for secrets, so it does not depend on the overlay): the current
 * brokerage's value; in multi-brokerage mode with no brokerage, undefined; in single mode, the app's own setting.
 */
export function brokerageValue(key: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const t = currentTenant();
  if (t) return t.env[key];
  if (isMultiBrokerage(env)) return undefined;
  return env[key];
}
