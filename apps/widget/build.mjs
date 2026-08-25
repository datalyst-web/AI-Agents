import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const serve = process.argv.includes("--serve");

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["src/widget.ts"],
  bundle: true,
  minify: !watch,
  sourcemap: watch,
  outfile: "dist/widget.js",
  target: ["es2020"],
  format: "iife",
  // No framework runtime bundled — the whole point of a vanilla-TS widget
  // is a small client-site footprint (ARCHITECTURE.md monorepo layout note).
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  if (serve) {
    const { host, port } = await ctx.serve({ servedir: "dist", port: 5000 });
    console.log(`widget dev server: http://${host}:${port}/widget.js`);
  }
  console.log("watching apps/widget/src for changes...");
} else {
  await esbuild.build(options);
  console.log("built dist/widget.js");
}
