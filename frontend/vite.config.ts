import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  // GitHub Pages project sites are served from
  // https://<user>.github.io/<repo-name>/, so all asset URLs need that
  // repo-name prefix baked in at build time. Set this to "/" instead if you
  // deploy to a custom domain or to a GitHub *user/org* page
  // (https://<user>.github.io/), where the site is served from the root.
  base: '/acc-oil-lubrication-system/',
  server: { port: 5173 },
})
