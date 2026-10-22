// KS_AGENT_v1_LICENSEE - the licensee's names and contacts for every reply and prompt.
//
// Each Keystone copy belongs to one licensee and runs its own agent next to its own server. The company name, the
// assistant's name, support contacts and app addresses come from the licensee's server (GET {SERVER_URL}/api/licensee,
// public), loaded at startup and every 5 minutes. Prompts and canned replies are built per request from the values last
// loaded, so they never wait on the network. Before the first load (or when the server cannot be reached) the
// KS_COMPANY_NAME / KS_ASSISTANT_NAME / KS_SUPPORT_EMAIL / KS_SUPPORT_PHONE / CLIENT_URL settings apply, then neutral
// defaults. No name or number in this file belongs to any particular company.

export type LicenseeUrls = { server: string; portal: string; client: string; website: string };

export type Licensee = {
  company_name: string;
  assistant_name: string;
  support_email: string;
  support_phone: string;
  mailing_address: string;
  urls: LicenseeUrls;
};

export const LICENSEE_REFRESH_MS = 5 * 60 * 1000;
const LICENSEE_TIMEOUT_MS = 5_000;
export const DEFAULT_ASSISTANT_NAME = "Assistant";
/** Used in sentences when no company name is known ("the AI assistant for our company"). */
export const DEFAULT_COMPANY_REF = "our company";

const EMPTY_URLS: LicenseeUrls = { server: "", portal: "", client: "", website: "" };

let loaded: { at: number; value: Licensee } | null = null;

const clean = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const cleanUrl = (v: unknown): string => {
  const s = clean(v, 500).replace(/\/+$/, "");
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : "";
};

/** Reads the licensee out of the server's { ok, licensee } body (or a bare licensee object). Null when unusable. */
export function parseLicensee(body: unknown): Licensee | null {
  if (!body || typeof body !== "object") return null;
  const raw = ((body as Record<string, unknown>).licensee ?? body) as Record<string, unknown>;
  if (!raw || typeof raw !== "object") return null;
  const urls = raw.urls && typeof raw.urls === "object" ? (raw.urls as Record<string, unknown>) : {};
  const value: Licensee = {
    company_name: clean(raw.company_name),
    assistant_name: clean(raw.assistant_name, 60),
    support_email: clean(raw.support_email),
    support_phone: clean(raw.support_phone, 40),
    mailing_address: clean(raw.mailing_address, 300).replace(/\s*\n\s*/g, ", "),
    urls: {
      server: cleanUrl(urls.server),
      portal: cleanUrl(urls.portal),
      client: cleanUrl(urls.client),
      website: cleanUrl(urls.website),
    },
  };
  if (!value.company_name && !value.assistant_name) return null;
  return value;
}

/** The values last loaded from the server, or null before the first successful load. */
export function loadedLicensee(): Licensee | null {
  return loaded?.value ?? null;
}

/** Test hook and manual override: set (or with null, forget) the loaded values. */
export function setLicensee(value: Licensee | null, at = Date.now()): void {
  loaded = value ? { at, value } : null;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Loads GET {SERVER_URL}/api/licensee now. Never throws: on any failure the previous values (or the env fallbacks)
 * stay in place. Returns the values loaded, or null when the load failed.
 */
export async function refreshLicensee(env: NodeJS.ProcessEnv = process.env, fetchImpl: FetchLike = fetch): Promise<Licensee | null> {
  const base = clean(env.SERVER_URL || env.BASE_URL, 500).replace(/\/+$/, "");
  if (!base) return null;
  try {
    const res = await fetchImpl(`${base}/api/licensee`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(LICENSEE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(JSON.stringify({ msg: "licensee_load_failed", status: res.status }));
      return null;
    }
    const value = parseLicensee(await res.json().catch(() => null));
    if (!value) {
      console.warn(JSON.stringify({ msg: "licensee_load_failed", reason: "unreadable_body" }));
      return null;
    }
    setLicensee(value);
    return value;
  } catch (err) {
    console.warn(JSON.stringify({ msg: "licensee_load_failed", error: err instanceof Error ? err.message : String(err) }));
    return null;
  }
}

/** Loads now and every 5 minutes after (the timer does not keep the process alive). */
export function startLicenseeRefresh(
  everyMs = LICENSEE_REFRESH_MS,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
): { stop: () => void; ready: Promise<Licensee | null> } {
  const ready = refreshLicensee(env, fetchImpl);
  const timer = setInterval(() => { void refreshLicensee(env, fetchImpl); }, everyMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), ready };
}

const envValue = (name: string, env: NodeJS.ProcessEnv = process.env): string => clean(env[name]);

/** The licensee's trading name, or "" when neither the server nor KS_COMPANY_NAME gives one. */
export function companyNameOrEmpty(env: NodeJS.ProcessEnv = process.env): string {
  return loaded?.value.company_name || envValue("KS_COMPANY_NAME", env);
}

/** The licensee's trading name for sentences; "our company" when none is known. Never empty. */
export function companyName(env: NodeJS.ProcessEnv = process.env): string {
  return companyNameOrEmpty(env) || DEFAULT_COMPANY_REF;
}

/** The assistant's name: the server's, else KS_ASSISTANT_NAME, else "Assistant". Never empty. */
export function assistantName(env: NodeJS.ProcessEnv = process.env): string {
  return loaded?.value.assistant_name || envValue("KS_ASSISTANT_NAME", env) || DEFAULT_ASSISTANT_NAME;
}

/** The support email, or "" when the licensee has not set one. */
export function supportEmail(env: NodeJS.ProcessEnv = process.env): string {
  return loaded?.value.support_email || envValue("KS_SUPPORT_EMAIL", env);
}

/** The support phone as entered, or "" when the licensee has not set one. */
export function supportPhone(env: NodeJS.ProcessEnv = process.env): string {
  return loaded?.value.support_phone || envValue("KS_SUPPORT_PHONE", env);
}

/** The licensee's mailing address on one line, or "". */
export function mailingAddress(): string {
  return loaded?.value.mailing_address ?? "";
}

/** The client app's address (where applications start): the server's urls.client, else CLIENT_URL, else "". */
export function clientAppUrl(env: NodeJS.ProcessEnv = process.env): string {
  return loaded?.value.urls.client || cleanUrl(env.CLIENT_URL);
}

/** The licensee's public website address, or "". */
export function websiteUrl(): string {
  return loaded?.value.urls.website ?? "";
}

/** The licensee's app addresses as last loaded (empty strings when unknown). */
export function licenseeUrls(): LicenseeUrls {
  return loaded?.value.urls ?? { ...EMPTY_URLS };
}

/** "call 1-800-555-0100 or email help@acme.example" / "call ..." / "email ..." / "" - whichever contacts are set. */
export function contactLine(env: NodeJS.ProcessEnv = process.env): string {
  const phone = supportPhone(env);
  const email = supportEmail(env);
  if (phone && email) return `call ${phone} or email ${email}`;
  if (phone) return `call ${phone}`;
  if (email) return `email ${email}`;
  return "";
}

/** "the team at Acme Capital" / "our team" - who follows up with a person. */
export function teamRef(env: NodeJS.ProcessEnv = process.env): string {
  const name = companyNameOrEmpty(env);
  return name ? `the ${name} team` : "our team";
}

/** "Ava, the AI assistant for Acme Capital" / "Assistant, an AI assistant" - how the assistant introduces itself. */
export function assistantIntro(env: NodeJS.ProcessEnv = process.env): string {
  const company = companyNameOrEmpty(env);
  return company ? `${assistantName(env)}, the AI assistant for ${company}` : `${assistantName(env)}, an AI assistant`;
}
