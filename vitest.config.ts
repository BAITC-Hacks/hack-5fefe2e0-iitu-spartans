import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "db/**/*.test.ts"],
    environment: "node",
  },
});
