import { defineConfig } from "vite";

// Served from https://theilsanne.github.io/stoop/
export default defineConfig({
  base: "/stoop/",
  server: { port: 5173, fs: { allow: [".."] } }, // scoring.ts lives in ../supabase
  build: { target: "es2022" },
});
