import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export const vitePort = 3000;

export default defineConfig(({ mode }) => {
  return {
    base: mode === 'production' ? './' : '/',
    plugins: [
      react(),
      // Custom plugin to handle source map requests
      {
        name: 'handle-source-map-requests',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            // Check if the request is for a source map file
            if (req.url && req.url.endsWith('.map')) {
              // Rewrite the URL to remove the query string that's causing the issue
              const cleanUrl = req.url.split('?')[0];
              req.url = cleanUrl;
            }
            next();
          });
        },
      },
      // Custom plugin to add CORS headers
      {
        name: 'add-cors-headers',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            // Add CORS headers to all responses
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader(
              'Access-Control-Allow-Methods',
              'GET, POST, PUT, DELETE, PATCH, OPTIONS',
            );
            res.setHeader(
              'Access-Control-Allow-Headers',
              'Content-Type, Authorization, X-Requested-With',
            );

            // Handle OPTIONS requests
            if (req.method === 'OPTIONS') {
              res.statusCode = 204;
              return res.end();
            }

            next();
          });
        },
      },
    ].filter(Boolean),
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './client/src'),
      },
    },
    root: path.join(process.cwd(), 'client'),
    build: {
      outDir: path.join(process.cwd(), 'dist/public'),
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks: {
            // Vendor chunks
            'react-vendor': ['react', 'react-dom'],
            'ui-vendor': ['@radix-ui/react-dialog', '@radix-ui/react-popover', '@radix-ui/react-select', '@radix-ui/react-switch', '@radix-ui/react-progress', '@radix-ui/react-checkbox', '@radix-ui/react-label', '@radix-ui/react-slider', '@radix-ui/react-toggle', '@radix-ui/react-tooltip'],
            'supabase-vendor': ['@supabase/supabase-js'],
            'utils-vendor': ['jszip', 'lucide-react', 'class-variance-authority', 'clsx', 'tailwind-merge'],
            'date-vendor': ['react-day-picker'],
            'cmd-vendor': ['cmdk'],
          },
          chunkFileNames: (chunkInfo) => {
            const facadeModuleId = chunkInfo.facadeModuleId ? chunkInfo.facadeModuleId.split('/').pop() : 'chunk';
            return `assets/[name]-[hash].js`;
          },
        },
      },
      chunkSizeWarningLimit: 1000, // Increase warning limit to 1MB
    },
    clearScreen: false,
    server: {
      hmr: {
        overlay: false,
      },
      host: true,
      port: vitePort,
      allowedHosts: true,
      cors: true, // Enable CORS in the dev server
      proxy: {
        '/api/': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
    // Enable source maps for development
    css: {
      devSourcemap: true,
    },
    // Ensure source maps are properly generated
    esbuild: {
      sourcemap: true,
    },
  };
});
