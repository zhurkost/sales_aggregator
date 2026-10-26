import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';

// The VPS serves the same client component as Sites, without a build tool at runtime.
export default defineConfig({
  root: fileURLToPath(new URL('./vps/client', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  plugins: [react()],
  build: {outDir: '../../dist-vps/client', emptyOutDir: true, sourcemap: false},
});
