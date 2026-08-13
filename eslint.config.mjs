import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output isn't only at the repo root — docker/.next/ is a copied standalone
    // bundle, and linting its minified chunks produced half of eslint's error count.
    "**/.next/**",
    "android/**",
    "mobile/dist/**",
  ]),
]);

export default eslintConfig;
