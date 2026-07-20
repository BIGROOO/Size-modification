import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "/Size-modification/",
  root: fileURLToPath(new URL("./github-pages", import.meta.url)),
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  resolve: {
    alias: {
      "tesseract.js": "tesseract.js/dist/tesseract.esm.min.js",
    },
  },
  plugins: [react()],
  build: {
    emptyOutDir: true,
    outDir: fileURLToPath(new URL("./dist-pages", import.meta.url)),
  },
  css: {
    postcss: projectRoot,
  },
});
