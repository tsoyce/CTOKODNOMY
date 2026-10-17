import { describe, expect, it } from "vitest";
import { gameAnalytics } from "../shared/gameAnalytics";
import type { PublicGameResults, PublicRoundStats } from "../shared/types";

function round(
  questionIndex: number,
  overrides: Partial<PublicRoundStats> = {},
): PublicRoundStats {
  return {
    questionId: `question-${questionIndex}`,
    questionIndex,
    prompt: `Вопрос ${questionIndex + 1}`,
    source: "",
    surveyDate: "",
    respondentCount: null,
    isDemo: false,
    boardAnswerCount: 6,
    answers: [],
    totalPoints: 100,
    multiplier: 1,
    winnerTeamId: "a",
    awardedPoints: 40,
    strikes: 3,
    completed: true,
    completedAt: "2026-10-17T12:00:00.000Z",
    ...overrides,
  };
}

function report(
  rounds: PublicRoundStats[],
  scores = [40, 0],
  totalRounds = 5,
): Pick<PublicGameResults, "rounds" | "teams" | "totalRounds"> {
  return {
    rounds,
    teams: [
      { id: "a", name: "Первая", color: "#7559ff", score: scores[0] },
      { id: "b", name: "Вторая", color: "#d64e77", score: scores[1] },
    ],
    totalRounds,
  };
}

describe("public game analytics", () => {
  it("separates confirmed banks, round wins and final score adjustments", () => {
    const source = report([
      round(0),
      round(1, { winnerTeamId: "b", awardedPoints: 60 }),
      round(2, { awardedPoints: 10 }),
    ], [55, 57]);
    const before = structuredClone(source);
    const result = gameAnalytics(source);
    expect(result.completeHistory).toBe(true);
    expect(result.teams).toMatchObject([
      { bankPoints: 50, roundWins: 2, scoreAdjustment: 5 },
      { bankPoints: 60, roundWins: 1, scoreAdjustment: -3 },
    ]);
    expect(result.rounds.map((item) => item.cumulativeBanks)).toEqual([
      { a: 40, b: 0 }, { a: 40, b: 60 }, { a: 50, b: 60 },
    ]);
    expect(source).toEqual(before);
    expect(result.teams[0]).not.toHaveProperty("strikes");
  });

  it("keeps zero banks and zero-point wins as real recorded results", () => {
    const result = gameAnalytics(report([
      round(0, { winnerTeamId: null, awardedPoints: 0 }),
      round(1, { awardedPoints: 0 }),
    ], [0, 0]));
    expect(result.completeHistory).toBe(true);
    expect(result.teams).toMatchObject([
      { bankPoints: 0, roundWins: 1, scoreAdjustment: 0 },
      { bankPoints: 0, roundWins: 0, scoreAdjustment: 0 },
    ]);
    expect(result.rounds[1].cumulativeBanks).toEqual({ a: 0, b: 0 });
  });

  it("never awards an unfinished round, including stale legacy fields", () => {
    const result = gameAnalytics(report([
      round(0),
      round(1, { completed: false, completedAt: "", awardedPoints: 999 }),
    ]));
    expect(result.completeHistory).toBe(false);
    expect(result.teams[0]).toMatchObject({ bankPoints: 40, roundWins: 1, scoreAdjustment: null });
    expect(result.rounds[1]).toMatchObject({
      completed: false,
      awardedPoints: 0,
      winnerTeamId: null,
      cumulativeBanks: { a: 40, b: 0 },
    });
  });

  it("does not present reconstructed legacy banks as confirmed zeroes", () => {
    const result = gameAnalytics(report([
      round(0, { completedAt: "", awardedPoints: 0, winnerTeamId: null }),
      round(1, { winnerTeamId: "b", awardedPoints: 20 }),
    ], [0, 20]));
    expect(result.completeHistory).toBe(false);
    expect(result.rounds[0].awardedPoints).toBeNull();
    expect(result.rounds.map((item) => item.cumulativeBanks)).toEqual([
      { a: null, b: null }, { a: null, b: null },
    ]);
    expect(result.teams).toMatchObject([
      { bankPoints: 0, roundWins: 0, scoreAdjustment: null },
      { bankPoints: 20, roundWins: 1, scoreAdjustment: null },
    ]);
  });

  it("detects missing earlier rounds but keeps later known subtotals", () => {
    const result = gameAnalytics(report([round(0), round(2)]));
    expect(result.completeHistory).toBe(false);
    expect(result.teams[0].bankPoints).toBe(80);
    expect(result.rounds[0].cumulativeBanks.a).toBe(40);
    expect(result.rounds[1].cumulativeBanks.a).toBeNull();
    expect(result.teams[0].scoreAdjustment).toBeNull();
  });

  it("does not double count duplicate round indices", () => {
    const result = gameAnalytics(report([round(0), round(0), round(1)]));
    expect(result.completeHistory).toBe(false);
    expect(result.teams[0]).toMatchObject({ bankPoints: 40, roundWins: 1 });
    expect(result.rounds.every((item) => item.cumulativeBanks.a === null)).toBe(true);
  });

  it("rejects an unknown winner or a bank without a winner", () => {
    for (const override of [
      { winnerTeamId: "missing", awardedPoints: 0 },
      { winnerTeamId: null, awardedPoints: 50 },
    ]) {
      const result = gameAnalytics(report([round(0, override), round(1)]));
      expect(result.completeHistory).toBe(false);
      expect(result.rounds[0].awardKnown).toBe(false);
      expect(result.rounds[1].cumulativeBanks.a).toBeNull();
      expect(result.teams[0].bankPoints).toBe(40);
      expect(result.teams[0].scoreAdjustment).toBeNull();
    }
  });

  it("allows early finish without treating future unplayed questions as gaps", () => {
    const result = gameAnalytics(report([
      round(0), round(1, { completed: false }),
    ], [45, 0], 20));
    expect(result.completeHistory).toBe(true);
    expect(result.rounds).toHaveLength(2);
    expect(result.teams[0].scoreAdjustment).toBe(5);
  });

  it("retains negative final scores and tied standings", () => {
    const result = gameAnalytics(report([round(0)], [-10, -10]));
    expect(result.teams.map((team) => team.score)).toEqual([-10, -10]);
    expect(result.teams.map((team) => team.scoreAdjustment)).toEqual([-50, -10]);
  });

  it("supports a game finished before its first question without invented rounds", () => {
    const result = gameAnalytics(report([], [0, 0], 20));
    expect(result.completeHistory).toBe(true);
    expect(result.rounds).toEqual([]);
    expect(result.teams).toMatchObject([
      { bankPoints: 0, roundWins: 0, scoreAdjustment: 0 },
      { bankPoints: 0, roundWins: 0, scoreAdjustment: 0 },
    ]);
  });
});
