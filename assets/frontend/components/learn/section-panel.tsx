/** The study mode driving the lesson view's active panel. Stages on the guided path map to
 *  these via PATH_STAGES (orient → learn → read → conceptQuiz → exam → lockin); `lesson`,
 *  `review`, and `listen` are reachable off the path. */
export type StudyMode =
  | "orient"
  | "learn"
  | "lesson"
  | "review"
  | "conceptQuiz"
  | "exam"
  | "read"
  | "listen"
  | "lockin"
  | null
