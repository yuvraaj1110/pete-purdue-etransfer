import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

/** Single-file build: TS entrypoints -> dist/, static assets copied. No plugins, no magic. */

mkdirSync("dist", { recursive: true });

await esbuild.build({
  entryPoints: [
    "src/background.ts",
    "src/content-script.ts",
    "src/popup.ts",
    "src/offscreen.ts",
  ],
  bundle: true,
  format: "iife", // MV3 classic scripts (service worker registered non-module)
  target: "chrome116",
  outdir: "dist",
  sourcemap: false,
  minify: false,
  logLevel: "info",
});

for (const f of ["manifest.json", "popup.html", "offscreen.html"]) {
  cpSync(`src/${f}`, `dist/${f}`);
}
cpSync("icons", "dist/icons", { recursive: true });
console.log("dist/ ready — load unpacked in chrome://extensions");
