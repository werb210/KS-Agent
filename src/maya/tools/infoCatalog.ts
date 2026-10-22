// AGENT_BLOCK_v4_VISITOR_TOOLS_v1
// KS_AGENT_v1_LICENSEE - plain-language definitions of common business-financing products, with no amounts, terms,
// lenders or eligibility rules: each licensee brings its own lenders, so which products it offers and their ranges
// come from the licensee's server (info.products reads /api/maya/catalog-summary; lender.products reads
// /api/maya/staff/lender-products). Kept in-process so a definition never needs a network call.
export type ProductEntry = {
  key: string;
  name: string;
  /** Category codes the licensee's server uses for this kind of product. */
  categories: ReadonlyArray<string>;
  one_liner: string;
  who_its_for: string;
};

export const PRODUCTS: ReadonlyArray<ProductEntry> = [
  {
    key: "term_loan",
    name: "Term loan",
    categories: ["TERM", "TERM_LOAN"],
    one_liner: "Lump-sum financing repaid over a fixed term.",
    who_its_for: "Established businesses funding equipment, expansion, or acquisitions.",
  },
  {
    key: "line_of_credit",
    name: "Line of credit",
    categories: ["LOC", "LINE_OF_CREDIT"],
    one_liner: "Revolving access to working capital you draw on as needed.",
    who_its_for: "Businesses managing seasonal cash flow or covering receivables gaps.",
  },
  {
    key: "equipment_financing",
    name: "Equipment financing",
    categories: ["EQUIPMENT", "EQUIPMENT_FINANCE", "EQUIPMENT_FINANCING"],
    one_liner: "Loans or leases secured by the equipment itself.",
    who_its_for: "Trades, construction, manufacturing, fleet operators, and medical practices buying machinery or vehicles.",
  },
  {
    key: "commercial_real_estate",
    name: "Commercial real estate",
    categories: ["CRE", "COMMERCIAL_REAL_ESTATE", "REAL_ESTATE"],
    one_liner: "Mortgages, construction loans, and bridge financing on commercial property.",
    who_its_for: "Developers, landlords, and owner-occupiers buying or building commercial property.",
  },
  {
    key: "mca",
    name: "Merchant cash advance",
    categories: ["MCA", "MERCHANT_CASH_ADVANCE"],
    one_liner: "Short-term financing repaid as a percentage of sales, priced with a factor rate.",
    who_its_for: "High-volume retail, hospitality, and service businesses needing fast capital.",
  },
  {
    key: "factoring",
    name: "Invoice factoring",
    categories: ["FACTORING", "INVOICE_FACTORING"],
    one_liner: "Advance against unpaid customer invoices.",
    who_its_for: "B2B businesses with long customer payment cycles.",
  },
  {
    key: "abl",
    name: "Asset-based lending",
    categories: ["ABL", "ASSET_BASED_LENDING"],
    one_liner: "Credit secured against inventory, receivables, or fixed assets.",
    who_its_for: "Larger businesses with substantial collateral but uneven profitability.",
  },
];

export type QualificationEntry = {
  key: string;
  label: string;
  detail: string;
};

// KS_AGENT_v1_LICENSEE - what lenders generally look at; the licensee's own thresholds (months in business, revenue,
// credit checks, documents) come from its trained knowledge and lender.products, never from here.
export const QUALIFICATIONS: ReadonlyArray<QualificationEntry> = [
  {
    key: "time_in_business",
    label: "Time in business",
    detail: "Lenders look at how long the business has been operating; the minimum depends on the product and the lender. Only quote a specific minimum if the company knowledge gives one.",
  },
  {
    key: "annual_revenue",
    label: "Revenue",
    detail: "Lenders look at monthly or annual revenue and how steady it is; larger requests generally need more. Only quote a specific minimum if the company knowledge gives one.",
  },
  {
    key: "credit",
    label: "Personal credit",
    detail: "Lenders usually consider the owners' credit as part of their review. Whether and when credit is checked depends on the lender; only describe the company's own practice if the company knowledge states it.",
  },
  {
    key: "documents",
    label: "Documents we typically need",
    detail: "Usually recent business bank statements, basic details about the company, and roughly what you need and what it is for. Larger requests can need more, such as financial statements.",
  },
  {
    key: "use_of_funds",
    label: "Use of funds",
    detail: "Be specific. Lenders match products to purpose — working capital, equipment, real estate, acquisition, refinance, expansion.",
  },
];

export function getProduct(key: string): ProductEntry | null {
  const k = key.trim().toLowerCase();
  return PRODUCTS.find((p) => p.key === k || p.categories.some((c) => c.toLowerCase() === k)) ?? null;
}

/** The definition for a server category code (e.g. "LOC"), or null. */
export function productForCategory(category: string): ProductEntry | null {
  const c = category.trim().toUpperCase();
  return PRODUCTS.find((p) => p.categories.includes(c)) ?? null;
}

export function getQualification(key: string): QualificationEntry | null {
  const k = key.trim().toLowerCase();
  return QUALIFICATIONS.find((q) => q.key === k) ?? null;
}
