import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const devPort = Number(process.env.CANRUSH_DESKTOP_PORT ?? 1420);

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: devPort,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: devPort,
    strictPort: true,
  },
});
