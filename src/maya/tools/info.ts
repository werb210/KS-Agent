// AGENT_BLOCK_v4_VISITOR_TOOLS_v1
// Visitor-audience tools. info.products lists or describes the products the licensee offers;
// info.qualifications explains what lenders typically look for.
// KS_AGENT_v1_LICENSEE - which products the company offers, and their amount / term / rate ranges, come from the
// licensee's own server (POST /api/maya/catalog-summary over its own lenders). The in-process catalog only explains
// what each kind of product is. Lender and product counts are never passed to visitors.
import { callBFServer } from "../../integrations/bfServerClient.js";
import { PRODUCTS, QUALIFICATIONS, getProduct, getQualification, productForCategory, type ProductEntry, type QualificationEntry } from "./infoCatalog.js";

export type InfoProductsArgs = {
  product_key?: string;
};

/** One category the licensee offers, with the ranges across its own lending partners (no counts, no lenders). */
export type OfferedCategory = {
  category: string;
  name: string;
  one_liner: string | null;
  min_amount: number | null;
  max_amount: number | null;
  term_min: number | null;
  term_max: number | null;
  term_unit: string | null;
  rate_min: number | null;
  rate_max: number | null;
};

export type InfoProductsResult = {
  ok: boolean;
  /** What the company offers right now, from its server; absent when the server could not be reached. */
  offered?: ReadonlyArray<OfferedCategory>;
  products?: ReadonlyArray<ProductEntry>;
  product?: ProductEntry;
  summary?: string;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The licensee's offered categories from /api/maya/catalog-summary, or null when it cannot be read. */
export async function offeredCategories(): Promise<OfferedCategory[] | null> {
  try {
    const r = await callBFServer<{ ok?: boolean; categories?: unknown; byCategory?: unknown }>("/api/maya/catalog-summary", { method: "POST", body: {} });
    const rows = Array.isArray(r?.categories) ? r.categories : Array.isArray(r?.byCategory) ? r.byCategory : null;
    if (!rows) return null;
    return rows
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && Boolean(str((row as Record<string, unknown>).category)))
      .map((row) => {
        const category = String(row.category).trim();
        const def = productForCategory(category);
        return {
          category,
          name: def?.name ?? category.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()),
          one_liner: def?.one_liner ?? null,
          min_amount: num(row.min_amount),
          max_amount: num(row.max_amount),
          term_min: num(row.term_min),
          term_max: num(row.term_max),
          term_unit: str(row.term_unit),
          rate_min: num(row.rate_min),
          rate_max: num(row.rate_max),
        };
      });
  } catch {
    return null;
  }
}

export async function infoProducts(args: InfoProductsArgs): Promise<InfoProductsResult> {
  const key = typeof args?.product_key === "string" ? args.product_key.trim() : "";
  const offered = await offeredCategories();
  const offeredNote = offered
    ? offered.length
      ? `We currently offer: ${offered.map((o) => o.name).join(", ")}. Quote amounts, terms and rates only from "offered" (or lender.products).`
      : "No products are listed right now; offer to connect them with the team."
    : "The current product list could not be loaded; describe products in general terms only and use lender.products for ranges.";
  if (key) {
    const p = getProduct(key);
    if (!p) {
      return { ok: true, ...(offered ? { offered } : {}), products: PRODUCTS, summary: `No product matches "${key}". ${offeredNote}` };
    }
    const match = offered?.find((o) => p.categories.includes(o.category.toUpperCase())) ?? null;
    const availability = offered ? (match ? "We offer this." : "This is not on our current product list.") : "";
    return { ok: true, ...(match ? { offered: [match] } : {}), product: p, summary: `${p.name}: ${p.one_liner} ${availability}`.trim() };
  }
  return {
    ok: true,
    ...(offered ? { offered } : {}),
    products: PRODUCTS,
    summary: offeredNote,
  };
}

export const INFO_PRODUCTS_TOOL_DESCRIPTOR = {
  type: "function" as const,
  function: {
    name: "info.products",
    description:
      "List or describe the company's financing products. Call with no arguments to get what the company currently offers (with amount, term and rate ranges across its lending partners) plus plain-language definitions; call with product_key (e.g. 'term_loan', 'line_of_credit', 'equipment_financing', 'commercial_real_estate', 'mca', 'factoring', 'abl') to get detail on one and whether it is offered.",
    parameters: {
      type: "object",
      properties: {
        product_key: {
          type: "string",
          description: "Optional product identifier. Omit to list all products.",
        },
      },
    },
  },
};

export type InfoQualificationsArgs = {
  key?: string;
};

export type InfoQualificationsResult = {
  ok: boolean;
  qualifications?: ReadonlyArray<QualificationEntry>;
  qualification?: QualificationEntry;
  summary?: string;
};

export async function infoQualifications(args: InfoQualificationsArgs): Promise<InfoQualificationsResult> {
  const key = typeof args?.key === "string" ? args.key.trim() : "";
  if (key) {
    const q = getQualification(key);
    if (!q) {
      return {
        ok: true,
        qualifications: QUALIFICATIONS,
        summary: `No qualification topic matches "${key}". Available: ${QUALIFICATIONS.map((x) => x.key).join(", ")}.`,
      };
    }
    return { ok: true, qualification: q, summary: `${q.label}: ${q.detail}` };
  }
  return {
    ok: true,
    qualifications: QUALIFICATIONS,
    summary: `Common qualification topics: ${QUALIFICATIONS.map((x) => x.label).join(", ")}.`,
  };
}

export const INFO_QUALIFICATIONS_TOOL_DESCRIPTOR = {
  type: "function" as const,
  function: {
    name: "info.qualifications",
    description:
      "Explain what lenders typically look for in a financing application (general guidance; the company's own thresholds come from its knowledge). Topics: time_in_business, annual_revenue, credit, documents, use_of_funds. Call with no arguments for the full list; call with a key for detail on one topic.",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Optional qualification topic key. Omit to list all topics.",
        },
      },
    },
  },
};
