import type { HTMLAttributes } from 'vue'

type GoaElementProps = HTMLAttributes & Record<string, unknown>

declare module 'vue' {
  interface GlobalComponents {
    [tag: `goa-${string}`]: GoaElementProps
  }
}

export {}
