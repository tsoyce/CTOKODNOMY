import type { PublicGameResults, PublicTeam } from "./types";

export interface TeamAnalytics extends PublicTeam {
  /** Only awards and wins confirmed by a recorded round are included. */
  bankPoints: number;
  roundWins: number;
  /** The final-score difference is meaningful only with a complete history. */
  scoreAdjustment: number | null;
}

export interface RoundAnalytics {
  questionId: string;
  questionIndex: number;
  prompt: string;
  completed: boolean;
  recorded: boolean;
  awardKnown: boolean;
  winnerTeamId: string | null;
  awardedPoints: number | null;
  cumulativeBanks: Record<string, number | null>;
}

export interface GameAnalytics {
  teams: TeamAnalytics[];
  rounds: RoundAnalytics[];
  completeHistory: boolean;
}

/**
 * Analyse the public report only. Manual score changes have no public timeline;
 * final scores must never be presented as if they were per-round bank awards.
 */
export function gameAnalytics(
  report: Pick<PublicGameResults, "teams" | "rounds" | "totalRounds">,
): GameAnalytics {
  const teams: TeamAnalytics[] = report.teams.map((team) => ({
    ...team,
    bankPoints: 0,
    roundWins: 0,
    scoreAdjustment: null,
  }));
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const indexCounts = new Map<number, number>();
  for (const round of report.rounds)
    indexCounts.set(
      round.questionIndex,
      (indexCounts.get(round.questionIndex) ?? 0) + 1,
    );

  const ordered = [...report.rounds].sort(
    (left, right) => left.questionIndex - right.questionIndex,
  );
  let completeHistory = true;
  let knownPrefix = true;
  let expectedIndex = 0;
  const running = Object.fromEntries(teams.map((team) => [team.id, 0]));
  const rounds = ordered.map((round): RoundAnalytics => {
    const validIndex =
      Number.isInteger(round.questionIndex) &&
      round.questionIndex >= 0 &&
      round.questionIndex < report.totalRounds &&
      indexCounts.get(round.questionIndex) === 1;
    if (!validIndex || round.questionIndex !== expectedIndex) {
      knownPrefix = false;
      completeHistory = false;
    }
    expectedIndex = round.questionIndex + 1;

    const recorded = Boolean(round.completedAt);
    const winner = round.winnerTeamId
      ? teamById.get(round.winnerTeamId)
      : undefined;
    const validAward =
      Number.isFinite(round.awardedPoints) &&
      round.awardedPoints >= 0 &&
      (Boolean(winner) ||
        (round.winnerTeamId === null && round.awardedPoints === 0));
    // An unfinished round awards nothing, even if a stale saved field disagrees.
    const awardKnown =
      !round.completed || (recorded && validIndex && validAward);
    if (!recorded || !awardKnown) completeHistory = false;
    if (round.completed && !awardKnown) knownPrefix = false;

    if (round.completed && awardKnown && winner) {
      winner.bankPoints += round.awardedPoints;
      winner.roundWins += 1;
      running[winner.id] += round.awardedPoints;
    }

    return {
      questionId: round.questionId,
      questionIndex: round.questionIndex,
      prompt: round.prompt,
      completed: round.completed,
      recorded,
      awardKnown,
      winnerTeamId:
        round.completed && awardKnown ? round.winnerTeamId : null,
      awardedPoints: awardKnown
        ? round.completed
          ? round.awardedPoints
          : 0
        : null,
      cumulativeBanks: Object.fromEntries(
        teams.map((team) => [team.id, knownPrefix ? running[team.id] : null]),
      ),
    };
  });

  // totalRounds also includes questions that were never played. Their absence
  // is not a gap and must not expose their prompts or answers in this report.
  if (completeHistory)
    for (const team of teams)
      team.scoreAdjustment = team.score - team.bankPoints;

  return { teams, rounds, completeHistory };
}
