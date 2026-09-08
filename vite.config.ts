import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 0. this project's root sits on a mapped network drive (X:\ -> \\...\Other\...).
  // Vite's internal fs.realpath-based resolution follows that mapping back to its
  // UNC form and mangles it (observed as "X:/<SERVER>/<SHARE>/Code/bible"), so every
  // disk-backed request (index.html, src/*) 404s even though the dev server itself
  // starts fine. preserveSymlinks stops Vite from resolving through realpath.
  resolve: {
    preserveSymlinks: true,
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`, the (large, slow-to-scan)
      // data pipeline sources/output, and env files
      ignored: ["**/src-tauri/**", "**/data-pipeline/**", "**/.env*"],
      // 4. native fs.watch fails with "UNKNOWN: unknown error, watch" on this
      // project's network-mapped drive (SMB doesn't support Windows change
      // notifications reliably) - fall back to polling.
      usePolling: true,
      interval: 300,
    },
  },
}));
