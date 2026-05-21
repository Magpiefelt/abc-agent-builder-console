/**
 * Safe markdown rendering helper.
 *
 * Every site that needs to render LLM- or user-authored markdown must go
 * through this so DOMPurify is always applied before v-html. Never use v-html
 * with raw marked output.
 */

import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

export function renderMarkdown(input: string | null | undefined): string {
  if (!input) return ''
  const html = marked.parse(input, { async: false }) as string
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}
