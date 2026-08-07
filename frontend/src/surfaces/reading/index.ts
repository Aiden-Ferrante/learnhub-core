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
export { MathText, MarkdownReader } from "@/surfaces/reading/markdown-reader"
// The reading theme + prose prefs travel with the renderer: anything that wants to show
// text the way the learner will actually read it needs all three, or it is a lookalike.
export { useReadingTheme, type ReadingTheme } from "@/surfaces/reading/use-reading-theme"
export { useReadingPrefs, type ReadingPrefs } from "@/surfaces/reading/use-reading-prefs"
export { SectionFigures } from "@/surfaces/reading/section-figures"
export { fetchReadingProgress, saveReadingPosition, type ReadingProgress } from "@/surfaces/reading/reading-progress"
