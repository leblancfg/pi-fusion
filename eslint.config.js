import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config({ ignores: ["node_modules/**", "dist/**", "coverage/**"] }, js.configs.recommended, ...tseslint.configs.recommended, {
  rules: {
    "no-undef": "off",
    "prefer-const": ["error", { ignoreReadBeforeAssign: true }],
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
  },
});
