import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
export default defineConfig(({ command, isPreview }) => ({
  server: { host: "127.0.0.1", port: 8080, strictPort: true },
  preview: { host: "127.0.0.1", port: 8081, strictPort: true },
  resolve: { tsconfigPaths: true },
  optimizeDeps: {
    exclude: [
      "@napi-rs/canvas",
      "pdfjs-dist",
      "tesseract.js",
      "mammoth",
      "@electric-sql/pglite",
      "@aws-sdk/client-s3",
      "pg",
    ],
  },
  ssr: {
    external: [
      "@napi-rs/canvas",
      "pdfjs-dist",
      "tesseract.js",
      "mammoth",
      "@electric-sql/pglite",
      "@aws-sdk/client-s3",
      "pg",
    ],
  },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    ...(command === "build" || isPreview
      ? [
          nitro({
            preset: "node_server",
            serverDir: false,
            rollupConfig: {
              external: [
                /^@electric-sql\/pglite(?:\/|$)/,
                /^pdfjs-dist(?:\/|$)/,
                /^tesseract.js(?:\/|$)/,
                /^@napi-rs\/canvas(?:\/|$)/,
                /^mammoth(?:\/|$)/,
              ],
            },
          }),
        ]
      : []),
    viteReact(),
  ],
}));
