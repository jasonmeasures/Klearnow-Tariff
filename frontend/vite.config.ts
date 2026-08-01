import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      "/v1": "http://localhost:8080",
      "/health": "http://localhost:8080",
    },
  },
  build: {
    outDir: "dist",
  },
});
