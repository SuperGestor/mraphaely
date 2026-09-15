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
      // Gerados pelo Serwist no build: não são código nosso.
      "public/sw.js",
      "public/swe-worker-*.js",
    ],
  },
  {
    // D33: back/ é só de servidor. components/ e lib/ são código de cliente, então não
    // importam back/, nem de passagem. Rotas, páginas de servidor, middleware e
    // instrumentation podem importar.
    files: ["components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@back/*", "../back/*", "../../back/*"],
              message: "back/ é só de servidor (D33): importe em rota, página de servidor ou middleware.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
