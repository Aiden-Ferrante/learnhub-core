/** Reading — the book on screen: chapter reader, guided reading, PDF view, narration.
 *
 *  This file is the surface's HUB: the only legal import surface from outside.
 *  Owns the reading surfaces + prefs/theme, read-along sync, reading progress,
 *  and the chapter learning-path rail. Embeds studying's panels (study drawer).
 *  Depends on: studying, concepts, library, gateways/, kit/. */

export { ChapterReader } from "@/surfaces/reading/chapter-reader"
export { GuidedReading } from "@/surfaces/reading/guided-reading"
export { PdfBookView } from "@/surfaces/reading/pdf-book-view"
export { ReadingThemeToggle } from "@/surfaces/reading/reading-theme-toggle"
export { MathText } from "@/surfaces/reading/markdown-reader"
export { SectionFigures } from "@/surfaces/reading/section-figures"
export { fetchReadingProgress, saveReadingPosition, type ReadingProgress } from "@/surfaces/reading/reading-progress"
