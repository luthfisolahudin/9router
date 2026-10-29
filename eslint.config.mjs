import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

// React Compiler advisory rules. This app is not compiled with React Compiler,
// and upstream ships long-standing patterns they flag; downgrade them to
// warnings in the config object that owns the react-hooks plugin.
const COMPILER_RULES = new Set([
  "react-hooks/set-state-in-effect",
  "react-hooks/immutability",
  "react-hooks/purity",
  "react-hooks/refs",
]);

const nextVitalsAdjusted = nextVitals.map((config) => {
  if (!config.rules) return config;
  const rules = {};
  for (const [rule, severity] of Object.entries(config.rules)) {
    rules[rule] = COMPILER_RULES.has(rule) ? "warn" : severity;
  }
  return { ...config, rules };
});

const eslintConfig = defineConfig([
  ...nextVitalsAdjusted,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated CLI/standalone build output (also nested under cli/app).
    "**/.next-cli-build/**",
    "cli/app/**",
  ]),
]);

export default eslintConfig;
