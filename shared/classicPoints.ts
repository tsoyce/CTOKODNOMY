import { boardAnswers } from "./questionAnswers";

/** Integer shares summing to 100 without modifying the recorded survey counts. */
export function classicPoints(answers: Array<{ points: number }>): number[] {
  const total = answers.reduce((sum, answer) => sum + answer.points, 0);
  if (!Number.isSafeInteger(total) || total <= 0) return answers.map(() => 0);
  const result = answers.map((answer) => Math.floor(answer.points * 100 / total));
  const order = answers.map((answer, index) => ({
    index, remainder: (answer.points * 100) % total,
  })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const remaining = 100 - result.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < remaining; i += 1) result[order[i]!.index]! += 1;
  return result;
}

/** Corresponds to the ranked first six answers, including stable tie order. */
export function classicBoardPoints(answers: Array<{ points: number }>): number[] {
  return classicPoints(boardAnswers(answers));
}
