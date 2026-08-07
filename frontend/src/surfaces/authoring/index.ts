/** Authoring — shaping a course, rather than studying one.
 *
 *  This file is the surface's HUB: the only legal import surface from outside.
 *  Owns the material editor: per-block editing of a course's text, with each save
 *  targeting either the BOOK (a fix every course cut from it inherits) or THIS
 *  course (copy-on-write). Editing invalidates what was extracted from the text, so
 *  the editor also surfaces which chapters are waiting on a rebuild.
 *  Depends on: gateways/, kit/. */

export { MaterialEditor } from "@/surfaces/authoring/material-editor"
