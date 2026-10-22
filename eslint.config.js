// KS_AGENT_v1_CI - lint for src/, test/ and scripts/. The recommended rule sets, minus the ones the inherited code
// base does not follow yet (explicit any and similar), so the lint step is a real gate from day one.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  {
    files: ["**/__tests__/**", "test/**", "tests/**", "**/*.test.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
  },
  {
    files: ["**/*.cjs", "scripts/**/*.js"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
