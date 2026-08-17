import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/* tailwind-merge has to be TOLD about the type scale, or it silently eats it.
 *
 * It resolves conflicts by parsing class names against a built-in map. It has
 * never heard of `text-meta`, so it files it under text-COLOUR — the other
 * thing `text-*` can mean — and then `cn("text-meta", "text-muted-foreground")`
 * looks like two colours fighting, last one wins, and the size is dropped. The
 * nav rendered at the 16px default this way: the class was in the source, in
 * the stylesheet, and gone from the DOM.
 *
 * Same trap for the uppercase-label tracking registers. Anything added to
 * fontSize/letterSpacing in tailwind.config.ts has to be repeated here.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["micro", "meta", "body", "title", "section", "page"] }],
      tracking: [{ tracking: ["label", "tile", "th"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Download a document file from the browser
 */
export function downloadDocument(file: File, filename?: string) {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = filename || file.name
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
