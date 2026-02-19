/**
 * esbuild config: Bundle the MCP entry point into a single ESM file.
 * Inlines MCP dependencies (SDK, zod, gray-matter, markdown-it, ws, etc.)
 * so Node resolves ONE file instead of walking dozens of node_modules dirs.
 *
 * The HTTP server (Express + plugins) is kept external — it loads via
 * dynamic import() AFTER MCP stdio is already connected.
 */

import esbuild from 'esbuild';

// Plugin to keep the HTTP server dynamic import external
const externalHttpServer = {
  name: 'external-http-server',
  setup(build) {
    // Keep the dynamic import of server/index.js external
    build.onResolve({ filter: /\.\/server\/index\.js$|\.\.\/server\/index\.js$/ }, (args) => {
      return { path: args.path, external: true };
    });
    // Keep mcp-client.js external too (client mode, rare path)
    build.onResolve({ filter: /mcp-client\.js$/ }, (args) => {
      return { path: args.path, external: true };
    });
    // Keep install-skill.js external (subcommand, rare path)
    build.onResolve({ filter: /install-skill\.js$/ }, (args) => {
      return { path: args.path, external: true };
    });
  },
};

await esbuild.build({
  entryPoints: ['bin/pad.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/bin/pad.mjs',
  // Inject CJS require shim for bundled CJS deps (gray-matter, etc.)
  banner: {
    js: "import { createRequire as __esbuild_createRequire } from 'module';\nconst require = __esbuild_createRequire(import.meta.url);",
  },
  plugins: [externalHttpServer],

  // Platform-specific deps that can't be bundled
  external: [
    'open',
    'trash',
  ],
});
