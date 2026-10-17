export type AnswerFilter = "all" | "board" | "outside" | "opened";

interface StatisticsAnswer {
  position: number;
  text: string;
  points: number;
  opened: boolean;
  onBoard?: boolean;
}

/** Derive every weight from the complete survey before applying a display filter. */
export function answerStatistics<T extends StatisticsAnswer>(answers: readonly T[]) {
  const weight = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
  const totalWeight = answers.reduce((total, answer) => total + weight(answer.points), 0);
  const maxWeight = answers.reduce((max, answer) => Math.max(max, weight(answer.points)), 0);
  return {
    totalWeight,
    answers: answers.map((answer) => ({
      ...answer,
      onBoard: answer.onBoard !== false,
      points: weight(answer.points),
      share: totalWeight > 0 ? weight(answer.points) / totalWeight * 100 : 0,
      cloudWeight: maxWeight > 0 ? Math.sqrt(weight(answer.points) / maxWeight) : 0,
    })),
  };
}

export function filterStatisticsAnswers<T extends StatisticsAnswer>(
  answers: readonly T[], query: string, filter: AnswerFilter,
): T[] {
  const normalized = query.trim().toLocaleLowerCase("ru");
  return answers.filter((answer) => {
    const board = answer.onBoard !== false;
    return (!normalized || answer.text.toLocaleLowerCase("ru").includes(normalized)) &&
      (filter === "all" || filter === "board" && board ||
        filter === "outside" && !board || filter === "opened" && board && answer.opened);
  });
}
