import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { serviceWorker } from "@voxolith/engine/vite";

export default defineConfig({
  // GitHub Pages serves project sites under /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? "/",
  // WebGPU needs a secure context; basic-ssl serves HTTPS on localhost + LAN so a
  // phone on the same network can play the dev build.
  // serviceWorker() emits sw.js (build only): the whole build is precached, plus the public
  // files the page and the manifest use, so the game plays offline after one visit.
  plugins: [
    basicSsl(),
    serviceWorker({
      name: "demolition-shot",
      include: [
        "manifest.webmanifest",
        "icons/icon-192.png",
        "icons/icon-512.png",
        "icons/icon-maskable-512.png",
        "favicon.svg",
        "favicon-32.png",
        "apple-touch-icon.png",
        "brand/logo-mark.svg",
        "brand/lockup.svg",
        "brand/lockup-dark.svg",
      ],
    }),
  ],
  // @voxolith/renderer ships raw TypeScript with `?raw` shader imports; it must be
  // compiled with the app rather than pre-bundled.
  optimizeDeps: { exclude: ["@voxolith/renderer"] },
  server: { host: true },
});
