import { defineConfig } from "vitest/config";

// The recorder is a standalone package inside the repo. Without its own config
// vitest walks up and picks the Next app's config, which pulls in plugins that
// are not installed here.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
