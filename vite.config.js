import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export const vitePort = 3000;

export default defineConfig(({ mode }) => {
  // Use relative paths for Electron, absolute for web
  const isElectron = process.env.ELECTRON === 'true';
  const base = isElectron ? './' : '/';
  
  return {
    // 1. TELL VITE WHERE YOUR APP LIVES
    root: 'client', 
    
    // 2. TELL VITE WHERE TO FIND .ENV FILES (Go up one level to root)
    envDir: '../',

    // 3. Base Path - relative for Electron, absolute for web
    base: base,
    
    plugins: [
      react(),
      {
        name: 'handle-source-map-requests',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url && req.url.endsWith('.map')) {
              const cleanUrl = req.url.split('?')[0];
              req.url = cleanUrl;
            }
            next();
          });
        },
      },
      {
        name: 'add-cors-headers',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
            if (req.method === 'OPTIONS') {
              res.statusCode = 200;
              res.end();
              return;
            }
            next();
          });
        },
      },
    ],
    resolve: {
      alias: {
        // 4. FIX ALIAS PATH (Point to client/src)
        '@': path.resolve(__dirname, './client/src'),
      },
    },
    build: {
      // 5. OUTPUT BACK TO ROOT DIST FOLDER (public subdirectory for Capacitor/Electron)
      outDir: '../dist/public',
      emptyOutDir: true, 
      sourcemap: true,
      minify: 'terser',
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
            'ui-vendor': ['@radix-ui/react-dialog', '@radix-ui/react-popover', '@radix-ui/react-select', '@radix-ui/react-switch', '@radix-ui/react-progress', '@radix-ui/react-checkbox', '@radix-ui/react-label', '@radix-ui/react-slider', '@radix-ui/react-toggle', '@radix-ui/react-tooltip'],
            'supabase-vendor': ['@supabase/supabase-js'],
            'utils-vendor': ['jszip', 'lucide-react', 'class-variance-authority', 'clsx', 'tailwind-merge'],
            'date-vendor': ['react-day-picker'],
            'cmd-vendor': ['cmdk'],
          },
          chunkFileNames: (chunkInfo) => {
            return `assets/[name]-[hash].js`;
          },
        },
      },
      chunkSizeWarningLimit: 1000,
    },
    clearScreen: false,
    server: {
      hmr: { overlay: false },
      host: true,
      port: vitePort,
      allowedHosts: true,
      cors: true,
      proxy: {
        '/api/': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});