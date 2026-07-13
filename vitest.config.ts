import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Mirror the tsconfig "@/*" → "./*" path alias so unit tests can import any
// module (some pure functions live in files that also import "@/lib/db").
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // `server-only` throws outside an RSC bundler; no-op it so server modules
      // with pure logic (crypto, oauth state) stay unit-testable.
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/__tests__/**/*.test.ts", "**/*.test.ts"],
  },
});
