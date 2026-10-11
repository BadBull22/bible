import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error no @types/node in this project
import process from "node:process";

// set by `tauri android dev`: the address the phone reaches this computer on
const host = process.env.TAURI_DEV_HOST;

// The same allowances as the desktop app's config for a project on a network share:
// the dependency cache on local disk, no realpath resolution, and polling for changes.
export default defineConfig(() => ({
  plugins: [react()],
  cacheDir: process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/bible-concordance-build/mobile-vite-cache` : undefined,
  clearScreen: false,
  resolve: { preserveSymlinks: true },
  server: {
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1431 } : undefined,
    watch: { ignored: ["**/src-tauri/**", "**/data/**", "**/dist/**"], usePolling: true, interval: 300 },
  },
}));
