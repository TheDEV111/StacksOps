import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "clarinet",
    environmentOptions: {
      clarinet: {
        manifestPath: "./Clarinet.toml",
        coverage: false,
        costs: false,
        initBeforeEach: true,
      },
    },
    setupFiles: [
      "./node_modules/@stacks/clarinet-sdk/vitest-helpers/src/vitest.setup.ts",
    ],
  },
});
