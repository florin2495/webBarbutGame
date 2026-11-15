import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests only (`*.test.ts` under src). Maps the `@/` import alias of tsconfig.json, so modules like
// src/lib/server/room.ts can be imported in tests. Playwright files are `*.e2e.ts` and never picked up.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
