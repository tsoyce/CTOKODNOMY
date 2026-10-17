import { describe, expect, it } from "vitest";
import { answerStatistics, filterStatisticsAnswers } from "../shared/answerStatistics";

describe("survey answer statistics", () => {
  it("keeps full-survey shares and size scale while filtering complete phrases", () => {
    const result = answerStatistics([
      { position: 1, text: "Семья и друзья", points: 9, opened: true, onBoard: true },
      { position: 2, text: "Друзья рядом", points: 1, opened: false, onBoard: false },
    ]);
    const filtered = filterStatisticsAnswers(result.answers, "ДРУЗЬЯ", "outside");
    expect(result.totalWeight).toBe(10);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toMatchObject({ text: "Друзья рядом", share: 10, cloudWeight: 1 / 3 });
    expect(filterStatisticsAnswers(result.answers, "", "all")).toHaveLength(2);
  });

  it("handles empty surveys and zero, negative or invalid weights without NaN", () => {
    expect(answerStatistics([])).toEqual({ totalWeight: 0, answers: [] });
    const result = answerStatistics([0, -2, NaN, Infinity].map((points, index) => ({
      position: index + 1, text: String(index), points, opened: false,
    })));
    expect(result.totalWeight).toBe(0);
    expect(result.answers.every((answer) => answer.points === 0 && answer.share === 0 && answer.cloudWeight === 0)).toBe(true);
  });

  it("treats legacy missing board flags as board answers and ignores opened outside answers", () => {
    const original = [
      { position: 1, text: "Старый ответ", points: 2, opened: true },
      { position: 2, text: "Редкий ответ", points: 1, opened: true, onBoard: false },
    ];
    const result = answerStatistics(original);
    expect(filterStatisticsAnswers(result.answers, "", "board").map((answer) => answer.position)).toEqual([1]);
    expect(filterStatisticsAnswers(result.answers, "", "opened").map((answer) => answer.position)).toEqual([1]);
    expect(original[0]).not.toHaveProperty("onBoard");
  });
});
