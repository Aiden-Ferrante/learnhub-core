/** Authoring — shaping a course, rather than studying one.
 *
 *  This file is the surface's HUB: the only legal import surface from outside.
 *  Owns the course editor, in two halves. OUTLINE: the chapters, their nesting and
 *  order, and which of the book's material sits under each — deleting a section
 *  unplaces its blocks rather than losing them. MATERIAL: per-block text editing,
 *  each save targeting either the BOOK (a fix every course cut from it inherits) or
 *  THIS course (copy-on-write). Editing invalidates what was extracted from the
 *  text, so the editor also surfaces which chapters are waiting on a rebuild.
 *  Depends on: gateways/, kit/. */

export { CourseEditor } from "@/surfaces/authoring/course-editor"
