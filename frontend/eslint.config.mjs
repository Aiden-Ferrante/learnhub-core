// Next's recommended rules (core-web-vitals + TypeScript), through the flat-config shim.
import { dirname } from "path"
import { fileURLToPath } from "url"
import { FlatCompat } from "@eslint/eslintrc"

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) })

export default [
  { ignores: [".next/**", "node_modules/**", "public/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // The codebase drops keys by destructuring (`{ _id, ...rest }`, `{ node, ...props }`)
    // and names unused parameters with a leading underscore.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
]
