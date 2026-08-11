import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/modules/**/tests/**/*.test.ts"],
  },
});
