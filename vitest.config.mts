import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // `.tsx` p/ testes de render de componente (react-dom/server, sem DOM).
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
