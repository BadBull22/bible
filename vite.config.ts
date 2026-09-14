import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { execFileSync } from "node:child_process";
const host = process.env.TAURI_DEV_HOST;

// This project's public/ directory can end up with a stray `.msys<hex>` marker dir --
// MSYS2/Git Bash creates these as a near-zero-permission lock file and normally
// self-deletes them on clean process exit, but an abruptly-killed background shell (e.g.
// a dev server force-stopped from outside bash) can orphan one. Over this project's SMB
// network share, those Unix permission bits are enforced by the actual server (not just
// cosmetic on the Windows side), so *no* client-side tool -- Explorer, rm, PowerShell,
// takeown, even robocopy's own directory creation -- can remove it; "Access is denied"
// across the board. Vite's normal public-dir copy (a plain recursive file copy) aborts
// the whole build the moment it hits one unreadable entry, so public/ is copied with
// robocopy instead, in its own build step: robocopy skips what it can't touch and keeps
// going, and its /XD flag excludes the marker pattern outright rather than merely
// tolerating it.
function copyPublicDirWithRobocopy(): Plugin {
  return {
    name: "robocopy-public-dir",
    apply: "build",
    closeBundle() {
      try {
        // /XF excludes the Adams chart source scan: it is a single 218MB JPEG that the app
        // never loads (the Timeline panel reads the ~25MB tile pyramid under public/chart
        // instead), and copying it here would put all 218MB into dist/ and from there into
        // the installer. It stays in public/ only as the tiler's input.
        execFileSync(
          "robocopy",
          ["public", "dist", "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/XD", ".msys*", "/XF", "Adams_Synchronological_Chart,_1881.jpg"],
          { stdio: "inherit" },
        );
      } catch (e: unknown) {
        // robocopy's exit code is a bitmask, not a Unix-style 0/nonzero: 0-7 all mean
        // some success (1 = files copied, 2 = extras, etc.); only 8+ is a real failure.
        const status = (e as { status?: number }).status ?? 0;
        if (status >= 8) throw e;
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), copyPublicDirWithRobocopy()],

  build: {
    // see copyPublicDirWithRobocopy() above -- Vite's own copy can't skip the one
    // unreadable entry that sometimes ends up in public/, so it's disabled here and
    // done via robocopy (in its own plugin hook) instead.
    copyPublicDir: false,
  },

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
