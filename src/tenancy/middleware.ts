// KS_SHARED_HOSTING_v1 - finds the brokerage for every request in multi-brokerage mode:
//   1. X-KS-Tenant: <code> (KS-server's proxy and server-to-server calls), otherwise
//   2. the Host header (lowercased, port removed) against ks_tenants.api_hosts.
//   no match → 404 {"error":"unknown_brokerage"}; status cancelled → 410 {"error":"brokerage_closed"}.
// Health checks answer without a brokerage. A suspended brokerage is let through: KS-server (which every Maya answer
// comes from) applies its own suspended behaviour. In single-brokerage mode this middleware does nothing.
import type { NextFunction, Request, Response } from "express";
import { isMultiBrokerage, runInTenant, TENANT_HEADER, type TenantContext } from "./context.js";
import { findTenantByCode, findTenantByHost, type TenantRecord } from "./registry.js";

export const HEALTH_PATHS: ReadonlySet<string> = new Set(["/", "/health", "/api/health", "/healthz", "/ready"]);

export type Resolution =
  | { ok: true; tenant: TenantRecord }
  | { ok: false; status: number; error: string };

export async function resolveTenant(headerCode: string | undefined, host: string | undefined): Promise<Resolution> {
  let tenant: TenantRecord | null;
  try {
    const code = headerCode?.trim();
    tenant = code ? await findTenantByCode(code) : await findTenantByHost(host ?? "");
  } catch {
    return { ok: false, status: 503, error: "registry_unavailable" };
  }
  if (!tenant) return { ok: false, status: 404, error: "unknown_brokerage" };
  if (tenant.status === "cancelled") return { ok: false, status: 410, error: "brokerage_closed" };
  if (!tenant.env) return { ok: false, status: 503, error: "brokerage_unavailable" };
  return { ok: true, tenant };
}

export type TenantMiddlewareOptions = {
  /** Runs inside the brokerage's context before the request continues (e.g. load its names on first use). */
  onTenant?: (tenant: TenantContext) => Promise<void> | void;
};

export function tenantMiddleware(options: TenantMiddlewareOptions = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isMultiBrokerage()) return next();
    if (HEALTH_PATHS.has(req.path)) return next();
    void (async () => {
      const r = await resolveTenant(req.header(TENANT_HEADER), req.header("host"));
      if (!r.ok) {
        // A CORS preflight cannot carry X-KS-Tenant; let it through without a brokerage (it reads no data).
        if (req.method === "OPTIONS" && r.status === 404) return next();
        res.status(r.status).json({ error: r.error });
        return;
      }
      const ctx: TenantContext = { code: r.tenant.code, status: r.tenant.status, env: Object.freeze({ ...r.tenant.env }) };
      res.locals.ksTenant = ctx.code;
      runInTenant(ctx, () => {
        Promise.resolve(options.onTenant?.(ctx))
          .catch((err) => console.warn(JSON.stringify({ msg: "ks_tenant_prepare_failed", code: ctx.code, error: err instanceof Error ? err.message : String(err) })))
          .then(() => next(), next);
      });
    })().catch(next);
  };
}
