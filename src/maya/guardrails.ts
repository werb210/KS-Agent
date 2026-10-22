import { supportPhone } from "../licensee/brand.js";

// AGENT_GUARDRAILS_v1
// Maya sits on a public marketing site for a regulated activity. A reply that
// tells a visitor they are approved, funded, or guaranteed financing is a
// representation the licensee cannot make and did not authorise. The model is told not
// to in the system prompt; this catches it if the model does it anyway.

// KS_AGENT_v1_LICENSEE - no claims about fees or credit checks: those differ from licensee to licensee.
const SAFE_REPLY =
  "I cannot tell you whether financing will be approved - that decision sits with a lender after they review your file. What I can do is walk you through what is involved in applying, if that would help.";

// Assertions of a funding or approval outcome. Deliberately narrow: these match
// claims ABOUT the reader, not neutral descriptions of how underwriting works.
const OUTCOME_PATTERNS: RegExp[] = [
  /\byou(?:'| a)?re\s+(?:already\s+)?(?:approved|pre-?approved|pre-?qualified|guaranteed|funded)\b/i,
  /\byou(?:'ll|\s+(?:will|would|should|can expect to|are going to))\s+(?:be\s+)?(?:approved|funded|pre-?approved|qualify|get (?:the )?(?:funding|financing|money|loan))\b/i,
  /\b(?:guaranteed|assured|certain)\s+(?:approval|funding|financing)\b/i,
  /\bwe\s+(?:guarantee|can guarantee|promise)\b/i,
  /\byou\s+(?:definitely|certainly|absolutely)\s+(?:qualify|will qualify)\b/i,
  /\byou\s+(?:will|'ll)\s+(?:be\s+)?(?:declined|rejected|turned down)\b/i,
  /\byou\s+(?:do\s+not|don'?t)\s+qualify\b/i,
];

// Hedged or negated sentences are the CORRECT behaviour and must not be caught.
// "I cannot say whether you would be approved" contains an outcome phrase but
// asserts nothing.
const HEDGE = /\b(?:whether|cannot|can'?t|unable to|only the lender|the lender decides|up to the lender|no one can)\b/i;

export function assertsFundingOutcome(reply: string): boolean {
  if (typeof reply !== "string" || !reply) return false;
  return reply
    .split(/(?<=[.!?])\s+/)
    .some((sentence) => !HEDGE.test(sentence) && OUTCOME_PATTERNS.some((re) => re.test(sentence)));
}

export function applyGuardrails(reply: string): string {
  return assertsFundingOutcome(reply) ? SAFE_REPLY : reply;
}

export const GUARDRAIL_SAFE_REPLY = SAFE_REPLY;

// MAYA_v817 - numbers listed in ASSISTANT_PRIVATE_NUMBERS (comma-separated; e.g. a staff member's private cell)
// must never appear in anything the assistant says, whatever the model, the trained knowledge or another setting
// contains. KS_AGENT_v1_LICENSEE - any spelling of one becomes the licensee's support phone (or a neutral marker when
// none is set). The numbers live only in the setting, never in code.
function privateNumberPatterns(env: NodeJS.ProcessEnv = process.env): RegExp[] {
  return String(env.ASSISTANT_PRIVATE_NUMBERS ?? "")
    .split(",")
    .map((n) => n.replace(/\D/g, "").slice(-10))
    .filter((d) => d.length === 10)
    .map((d) => new RegExp(`(?:\\+?\\s*1[\\s.-]*)?\\(?\\s*${d.slice(0, 3)}\\s*\\)?[\\s.-]*${d.slice(3, 6)}[\\s.-]*${d.slice(6)}\\b`, "g"));
}
export const WITHHELD_NUMBER = "[number withheld]";
/** What a private number is replaced with: the licensee's support phone, unless that is itself private. */
function replacementNumber(patterns: RegExp[]): string {
  const phone = supportPhone();
  if (!phone) return WITHHELD_NUMBER;
  return patterns.some((re) => { re.lastIndex = 0; const hit = re.test(phone); re.lastIndex = 0; return hit; }) ? WITHHELD_NUMBER : phone;
}
export function scrubPrivateNumbers(text: string): string {
  if (typeof text !== "string" || !text) return text;
  const patterns = privateNumberPatterns();
  if (!patterns.length) return text;
  const replacement = replacementNumber(patterns);
  return patterns.reduce((t, re) => t.replace(re, replacement), text);
}
