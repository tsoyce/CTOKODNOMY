import type { Question } from "./types";

export const MAX_QUESTION_BATCH = 500;

export interface QuestionPackGroup {
  name: string;
  questions: Question[];
}

/** Existing pack names remain the grouping keys; question order is preserved. */
export function questionPacks(questions: readonly Question[]): QuestionPackGroup[] {
  const groups = new Map<string, Question[]>();
  for (const question of questions) {
    const name = question.pack || "";
    const group = groups.get(name) ?? [];
    group.push(question);
    groups.set(name, group);
  }
  return [...groups].map(([name, questions]) => ({ name, questions })).sort(
    (first, second) => !first.name ? 1 : !second.name ? -1 : first.name.localeCompare(second.name, "ru"),
  );
}
