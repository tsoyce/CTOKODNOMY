import type { GameState, Question } from "./types";

/** A game uses the six most frequent answers; statistics keep the full survey. */
export const GAME_ANSWER_LIMIT = 6;
export const MAX_QUESTION_ANSWERS = 500;

/** Return a new array; equal frequencies retain the organizer's supplied order. */
export function rankedAnswers<T extends { points: number }>(answers: T[]): T[] {
  return [...answers].sort((left, right) => right.points - left.points);
}

export function boardAnswers<T extends { points: number }>(answers: T[]): T[] {
  return rankedAnswers(answers).slice(0, GAME_ANSWER_LIMIT);
}
/** Game snapshots are already ranked; old games keep their original full layout. */
export function gameBoardAnswers(
  game: Pick<GameState, "boardAnswerLimit">,
  question: Pick<Question, "answers">,
) {
  return game.boardAnswerLimit === undefined
    ? question.answers
    : question.answers.slice(0, game.boardAnswerLimit);
}
