import { fileURLToPath, URL } from 'node:url'

import { defineConfig, createLogger } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'
import * as sfcCompiler from 'vue/compiler-sfc'

// Vue's compiler emits a benign "<thead> cannot be child of <goa-table>"
// tip because the GoA web component projects table semantics through a
// shadow-DOM <table>. The runtime is correct (the GoA component slots thead
// into its shadow <table>), but Vue's parser doesn't know that. We drop it
// at two layers so every consumer (dev server, build, vitest) is quiet:
//  1. Wrap compileTemplate so the tip never reaches plugin-vue's warn.
//  2. Drop the message at the logger as a fallback for any path that
//     bypasses compileTemplate (e.g. Rollup-style warnings during build).
const GOA_NESTING_WARNING = /cannot be child of <goa-/

const filteringCompiler: typeof sfcCompiler = {
  ...sfcCompiler,
  compileTemplate(options) {
    const result = sfcCompiler.compileTemplate(options)
    if (result.tips?.length) {
      result.tips = result.tips.filter((tip) => !GOA_NESTING_WARNING.test(tip))
    }
    return result
  },
}

function makeFilteredLogger() {
  const base = createLogger()
  const wrap = (orig: typeof base.warn): typeof base.warn => (msg, opts) => {
    if (typeof msg === 'string' && GOA_NESTING_WARNING.test(msg)) return
    orig(msg, opts)
  }
  return {
    ...base,
    warn: wrap(base.warn.bind(base)),
    warnOnce: wrap(base.warnOnce.bind(base)),
  }
}

// https://vite.dev/config/
export default defineConfig({
  customLogger: makeFilteredLogger(),
  plugins: [
    vue({
      compiler: filteringCompiler,
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag.startsWith('goa-'),
        },
      },
    }),
    vueDevTools(),
    tailwindcss(),
  ],
  build: {
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        if (GOA_NESTING_WARNING.test(warning.message)) return
        defaultHandler(warning)
      },
    },
  },
  server: {
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
})
