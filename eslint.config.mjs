import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // The desktop recorder is a separate Electron package with its own
      // tsconfigs, its own vitest, and legitimate CommonJS (the preload script
      // must be CJS). Linting it under the Next app's rules is a category error.
      "recorder/**",
    ],
  },
];

export default eslintConfig;
