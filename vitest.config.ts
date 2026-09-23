import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "db/**/*.test.ts", "apps/web/lib/**/*.test.ts"],
    environment: "node",
  },
});
