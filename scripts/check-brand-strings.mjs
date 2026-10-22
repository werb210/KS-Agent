#!/usr/bin/env node
// KS_AGENT_v1_BRANDING - no previous-owner branding in text this agent sends or puts in a prompt.
//
// KS-Agent is a licensed copy of an assistant service built for another company. Every reply, prompt and tool
// description now names the licensee (src/licensee/brand.ts: companyName(), assistantName(), supportPhone(), ...).
// This check fails when a string literal under src/ (outside tests) mentions the previous owner again: its name or
// domains, its numbered company or street, its people, its old assistant's name, or its phone numbers.
// Comments and identifiers are not string literals, so they are not checked (the /api/maya/* server paths and the
// X-Maya-Context header keep their names: they are wire contracts with the licensee's server, never shown).
//
//   node scripts/check-brand-strings.mjs          check (exit 1 on a hit)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Names are matched case-sensitively ("Maya" as text; lower-case "maya" is the server's path segment).
const CASE_SENSITIVE_WORDS = /\b(?:Maya|Todd|Andrew)\b/;
const CASE_INSENSITIVE = /boreal|2630108|sparling|werboweski|866[\s.-]*631[\s.-]*8939/i;

/** True when a piece of text carries previous-owner branding. */
export function isBranded(text) {
  return CASE_INSENSITIVE.test(text) || CASE_SENSITIVE_WORDS.test(text);
}

// file (relative to the repo, forward slashes) -> substrings of literals that are allowed to stay. Keep it empty.
export const ALLOW = {};

const TEST_FILE = /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const SOURCE = /\.[cm]?[jt]sx?$/;

/** The string-literal contents in TypeScript source: quoted strings and template-literal text (via the compiler). */
export function stringLiterals(src) {
  const out = [];
  const sf = ts.createSourceFile("x.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = (node) => {
    switch (node.kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail:
        // An import/export path is not text.
        if (node.parent && (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent))) break;
        out.push(node.text);
        break;
      default:
        break;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The literals in one file's source that carry previous-owner branding and are not allowed. */
export function brandHits(src, allowed = []) {
  return stringLiterals(src).filter((s) => isBranded(s) && !allowed.some((a) => s.includes(a)));
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (SOURCE.test(e.name)) out.push(p);
  }
  return out;
}

/** Every disallowed literal under <root>/src, as { file, literal }. */
export function scanRepo(root) {
  const hits = [];
  for (const f of walk(path.join(root, "src"), [])) {
    const rel = path.relative(root, f).split(path.sep).join("/");
    if (TEST_FILE.test(rel)) continue;
    for (const literal of brandHits(fs.readFileSync(f, "utf8"), ALLOW[rel] ?? [])) hits.push({ file: rel, literal });
  }
  return hits;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hits = scanRepo(process.cwd());
  if (hits.length) {
    console.error(`::error::${hits.length} string literal(s) in src/ still carry the previous owner's branding. Use src/licensee/brand.ts (companyName(), assistantName(), supportPhone(), contactLine()) instead:`);
    for (const h of hits) console.error(`  ${h.file}: ${JSON.stringify(h.literal.slice(0, 160))}`);
    process.exit(1);
  }
  console.log("No previous-owner branding in src/ string literals. OK.");
}
