// KS_SHARED_HOSTING_v1 - the brokerage registry (table ks_tenants in database ks_control), read through
// KS_CONTROL_DATABASE_URL with the SELECT-only role ks_control_reader. The whole list is cached for 60 seconds; if a
// reload fails the previous list keeps serving (and the failure is logged). The agent never reads database_url_enc:
// it has no brokerage database of its own, only KS-server does.
import pg from "pg";
import { decryptTenantEnv } from "./crypto.js";

export const REGISTRY_TTL_MS = 60_000;
export const TENANT_CODE_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;

export type RegistryRow = {
  code: string;
  status: string | null;
  api_hosts: string[] | null;
  env_enc: string | null;
};

export type TenantRecord = {
  code: string;
  status: string;
  apiHosts: string[];
  /** Decrypted env_enc; null when it could not be decrypted (envError says why). */
  env: Record<string, string> | null;
  envError?: string;
};

export type RegistrySource = () => Promise<RegistryRow[]>;

let pool: pg.Pool | null = null;

const defaultSource: RegistrySource = async () => {
  const url = process.env.KS_CONTROL_DATABASE_URL;
  if (!url) throw new Error("KS_CONTROL_DATABASE_URL is not configured");
  if (!pool) {
    pool = new pg.Pool({ connectionString: url, max: 2, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
    pool.on("error", (err) => console.error(JSON.stringify({ msg: "ks_control_pool_error", error: err.message })));
  }
  const res = await pool.query<RegistryRow>("SELECT code, status, api_hosts, env_enc FROM ks_tenants");
  return res.rows;
};

let source: RegistrySource = defaultSource;
type Snapshot = { at: number; byCode: Map<string, TenantRecord>; byHost: Map<string, TenantRecord> };
let cache: Snapshot | null = null;
let inflight: Promise<Snapshot> | null = null;

/** Host as stored in api_hosts: lowercase, no scheme, no port. */
export function normalizeHost(host: string | undefined | null): string {
  let h = String(host ?? "").trim().toLowerCase();
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/\/.*$/, "");
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.replace(/:\d+$/, "").replace(/\.$/, "");
}

function toRecord(row: RegistryRow): TenantRecord {
  const rec: TenantRecord = {
    code: String(row.code),
    status: String(row.status ?? "provisioning"),
    apiHosts: (row.api_hosts ?? []).map(normalizeHost).filter(Boolean),
    env: null,
  };
  try {
    rec.env = decryptTenantEnv(row.env_enc);
  } catch (err) {
    rec.envError = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ msg: "ks_tenant_env_unreadable", code: rec.code, error: rec.envError }));
  }
  return rec;
}

async function reload(now: number): Promise<Snapshot> {
  const rows = await source();
  const byCode = new Map<string, TenantRecord>();
  const byHost = new Map<string, TenantRecord>();
  for (const row of rows) {
    const rec = toRecord(row);
    byCode.set(rec.code, rec);
    for (const h of rec.apiHosts) if (!byHost.has(h)) byHost.set(h, rec);
  }
  cache = { at: now, byCode, byHost };
  return cache;
}

async function registry(now: number = Date.now()): Promise<Snapshot> {
  if (cache && now - cache.at < REGISTRY_TTL_MS) return cache;
  if (!inflight) {
    inflight = reload(now)
      .catch((err) => {
        console.error(JSON.stringify({ msg: "ks_control_registry_load_failed", error: err instanceof Error ? err.message : String(err) }));
        if (cache) return cache; // keep serving the last good list
        throw err;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export async function findTenantByCode(code: string, now?: number): Promise<TenantRecord | null> {
  const c = String(code ?? "").trim().toLowerCase();
  if (!TENANT_CODE_RE.test(c)) return null;
  return (await registry(now)).byCode.get(c) ?? null;
}

export async function findTenantByHost(host: string, now?: number): Promise<TenantRecord | null> {
  const h = normalizeHost(host);
  if (!h) return null;
  return (await registry(now)).byHost.get(h) ?? null;
}

/** Every brokerage in the registry (cached). */
export async function listTenants(now?: number): Promise<TenantRecord[]> {
  return [...(await registry(now)).byCode.values()];
}

export function clearRegistryCache(): void {
  cache = null;
}

/** Test hook: read the registry from somewhere else (null restores the ks_control database). */
export function setRegistrySource(fn: RegistrySource | null): void {
  source = fn ?? defaultSource;
  cache = null;
  inflight = null;
}

export async function closeRegistry(): Promise<void> {
  const p = pool;
  pool = null;
  if (p) await p.end().catch(() => undefined);
}
