/** Raw document titles can be whole filenames ("Title -- Author -- year -- isbn…"); keep the
 *  part before the first separator so one line stays one line. */
export function shortTitle(title: string): string {
  return title.split(/\s+--\s+|[:–—]/)[0].trim().slice(0, 40)
}
