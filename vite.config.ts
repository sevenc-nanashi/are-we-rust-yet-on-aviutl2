import { cloudflare } from "@cloudflare/vite-plugin";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: mode === "test" ? [vue()] : [vue(), cloudflare()],
  test: {
    include: ["server/**/*.test.ts"],
  },
}));
