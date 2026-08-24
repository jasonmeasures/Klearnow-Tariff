import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3000,
    fs: { allow: [".."] },
    proxy: {
      "/v1": { target: "http://localhost:8080", timeout: 180_000 },
      "/health": "http://localhost:8080",
    },
  },
  build: {
    outDir: "dist",
  },
});
