import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { defineConfig } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  root,
  appType: 'mpa',
  define: {
    'process.env.NEXT_PUBLIC_DEPLOYMENT_TARGET': JSON.stringify('vercel'),
  },
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react()],
  resolve: { alias: { '@': root } },
  server: { host: '127.0.0.1', port: 4173, strictPort: true,
    watch: { ignored: ['**/.treehouse/**', '**/outputs/**'] } },
});
