import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The status page is served from the root of a custom domain (status.honch.io),
// so the default base ("/") is correct.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    // Published straight to GitHub Pages; keep the output lean and predictable.
    outDir: "dist",
    emptyOutDir: true,
  },
});
