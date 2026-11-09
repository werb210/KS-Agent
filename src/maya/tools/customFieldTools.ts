// KS_AGENT_CUSTOM_EVERYWHERE_v1 - three read-only staff tools for the brokerage's own properties (custom fields) and
// the pipelines it created. Pass-throughs to KS-server /api/maya/staff/* (service JWT via callBFServer).
import { callBFServer } from "../../integrations/bfServerClient.js";

type Result = { ok: boolean; [k: string]: unknown };
const s = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const n = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
async function call(path: string, body: Record<string, unknown>): Promise<Result> {
  try {
    const r = await callBFServer<Result>(path, { method: "POST", body });
    return r && typeof r === "object" ? r : { ok: false, error: "empty_response" };
  } catch {
    return { ok: false, error: "request_failed" };
  }
}

export type CrmPropertiesArgs = { object?: string; id?: string; session_id?: string };
export async function crmProperties(args: CrmPropertiesArgs): Promise<Result> {
  return call("/api/maya/staff/properties", { object: s(args?.object), id: s(args?.id), session_id: s(args?.session_id) });
}
export const CRM_PROPERTIES_TOOL_DESCRIPTOR = {
  type: "function" as const,
  function: {
    name: "crm.properties",
    description:
      "The brokerage's own custom properties (fields it added to contacts, companies and deals, such as a licence number or equipment type) and the extra pipelines it created. With no id it lists every property (key like contact_cf_licence, company_cf_naics, deal_cf_equipment_type) and every pipeline with its stages. With object (contact, company or deal) and id it returns that record's property values with their labels. Read-only. Use it whenever staff ask about a field that is not a standard one, or about a pipeline other than the lending pipeline.",
    parameters: { type: "object", properties: {
      object: { type: "string", enum: ["contact", "company", "deal"], description: "Record type, when reading one record." },
      id: { type: "string", description: "The record's id, when reading one record." },
      session_id: { type: "string" },
    }, required: [] },
  },
};

export type FindByPropertyArgs = { field: string; value?: string; match?: string; limit?: number; session_id?: string };
export async function crmFindByProperty(args: FindByPropertyArgs): Promise<Result> {
  if (!s(args?.field)) return { ok: false, error: "field_required" };
  return call("/api/maya/staff/find-by-property", { field: s(args.field), value: s(args.value), match: s(args.match), limit: n(args.limit), session_id: s(args.session_id) });
}
export const CRM_FIND_BY_PROPERTY_TOOL_DESCRIPTOR = {
  type: "function" as const,
  function: {
    name: "crm.find_by_property",
    description:
      "Find contacts, companies or deals by one of the brokerage's own properties, e.g. every deal whose equipment type is Excavator, or every contact with a licence number filled in. field is the property key from crm.properties (contact_cf_<name>, company_cf_<name> or deal_cf_<name>). Leave value out to find records where the property is filled in. match=contains does a partial, case-insensitive text match; otherwise the match is exact (case-insensitive). Read-only.",
    parameters: { type: "object", properties: {
      field: { type: "string", description: "Property key, e.g. deal_cf_equipment_type." },
      value: { type: "string", description: "Value to match. Omit to find records where it is filled in." },
      match: { type: "string", enum: ["exact", "contains"] },
      limit: { type: "number", description: "At most this many (default 25, max 100)." },
      session_id: { type: "string" },
    }, required: ["field"] },
  },
};

export type PipelinesOverviewArgs = { pipeline?: string; stage?: string; session_id?: string };
export async function pipelinesOverview(args: PipelinesOverviewArgs): Promise<Result> {
  return call("/api/maya/staff/pipelines-overview", { pipeline: s(args?.pipeline), stage: s(args?.stage), session_id: s(args?.session_id) });
}
export const PIPELINES_OVERVIEW_TOOL_DESCRIPTOR = {
  type: "function" as const,
  function: {
    name: "pipelines.overview",
    description:
      "The pipelines the brokerage created beyond the lending pipeline (for example Renewals or Equipment vendors): deals, amount and weighted amount in each stage. Name a pipeline and a stage to also list the deals sitting in that stage. For the lending pipeline use pipeline.facts / pipeline.query instead. Read-only.",
    parameters: { type: "object", properties: {
      pipeline: { type: "string", description: "Pipeline name, to list the deals in one of its stages." },
      stage: { type: "string", description: "Stage name in that pipeline." },
      session_id: { type: "string" },
    }, required: [] },
  },
};
