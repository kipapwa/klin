import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Regra do usuário: nenhuma caixa do sistema. Use a caixa do app
// (useConfirm em src/components/ui/confirm.tsx) e o useLeaveGuard.
const SYSTEM_DIALOG = "Use a caixa do próprio app: useConfirm (src/components/ui/confirm.tsx).";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "confirm", message: SYSTEM_DIALOG },
        { name: "alert", message: SYSTEM_DIALOG },
        { name: "prompt", message: SYSTEM_DIALOG },
      ],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "confirm", message: SYSTEM_DIALOG },
        { object: "window", property: "alert", message: SYSTEM_DIALOG },
        { object: "window", property: "prompt", message: SYSTEM_DIALOG },
        { object: "window", property: "onbeforeunload", message: "Use useLeaveGuard (src/lib/leave-guard.ts)." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='addEventListener'][arguments.0.value='beforeunload']",
          message: "O aviso de fechar a página é caixa do sistema. Use useLeaveGuard (src/lib/leave-guard.ts).",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
