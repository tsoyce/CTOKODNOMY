import { afterEach, describe, expect, it, vi } from "vitest";
import { applyCommand, createGame, gameResults, publicView, resetGame } from "../server/game";
import { classicBoardPoints, classicPoints } from "../shared/classicPoints";
import { defaultBrand, type GameCommand, type GameState, type Question } from "../shared/types";

function question(index: number): Question {
  return {
    id: `q${index}`, prompt: `Вопрос ${index}`,
    answers: [50, 30, 20].map((points, i) => ({ id: `q${index}-${i}`, text: `Ответ ${index}-${i}`, points, aliases: [] })),
    source: "", surveyDate: "", respondentCount: 100, notes: "", isDemo: false, pack: "",
  };
}

function classic(count = 10): GameState {
  return createGame({ title: "Классика", brand: defaultBrand,
    questions: Array.from({ length: count }, (_, index) => question(index + 1)),
    teams: [
      { id: "a", name: "А", color: "#111111", joinCode: "A" },
      { id: "b", name: "Б", color: "#222222", joinCode: "B" },
    ],
    rules: { mode: "classic", multipliers: [1, 2, 3], stealAddsPoints: true },
  });
}

function play(game: GameState, ...commands: GameCommand[]) {
  return commands.reduce((value, command) => applyCommand(value, command), game);
}

afterEach(() => vi.useRealTimers());

describe("Классические правила", () => {
  it("пересчитывает очки без потери исходных частот, учитывая редкие ответы в финале", () => {
    const answers = [40, 25, 10, 8, 5, 3, 2, 1].map((points) => ({ points }));
    const before = structuredClone(answers);
    expect(classicBoardPoints(answers)).toHaveLength(6);
    expect(classicBoardPoints(answers).reduce((a, b) => a + b, 0)).toBe(100);
    expect(classicPoints(answers).reduce((a, b) => a + b, 0)).toBe(100);
    expect(answers).toEqual(before);
    expect(classicBoardPoints([{ points: 0 }])).toEqual([0]);
  });

  it("показывает в журнале фактически начисленный вес классического ответа", () => {
    const game = classic();
    game.questions[0]!.answers = [50, 30, 20, 5, 4, 3, 2].map((points, index) => ({
      id: `q1-${index}`, text: `Ответ 1-${index}`, points, aliases: [],
    }));
    const weights = classicBoardPoints(game.questions[0]!.answers);
    expect(weights[1]).not.toBe(game.questions[0]!.answers[1]!.points);
    const result = play(game, { type: "start", teamId: "a" }, { type: "classic-buzz", teamId: "a" },
      { type: "reveal", answerId: "q1-0" }, { type: "reveal", answerId: "q1-1" });
    expect(result.bank).toBe(weights[0]! + weights[1]!);
    expect(result.events.at(-1)?.message).toContain(`${weights[1]} × 1`);
  });

  it("не обещает в журнале дополнительные очки при выключенном начислении за перехват", () => {
    const game = createGame({
      title: "Свободная игра", brand: defaultBrand, questions: [question(1)],
      teams: [
        { id: "a", name: "А", color: "#111111", joinCode: "A" },
        { id: "b", name: "Б", color: "#222222", joinCode: "B" },
      ],
      rules: { mode: "standard", multipliers: [1], stealAddsPoints: false },
    });
    const result = play(game, { type: "start", teamId: "a" },
      { type: "reveal", answerId: "q1-0" }, { type: "strike" }, { type: "strike" },
      { type: "strike" }, { type: "reveal", answerId: "q1-1" });
    expect(result.teams.map((team) => team.score)).toEqual([0, 50]);
    expect(result.events.at(-1)?.message).toContain("перехват без дополнительных очков");
  });

  it("ведёт дуэль по очереди, не записывает промахи в раунд и не допускает совещания во время обычной игры", () => {
    let game = play(classic(), { type: "start", teamId: "a" }, { type: "classic-buzz", teamId: "b" });
    expect(game.classic?.duel?.playerIndex).toBe(1);
    game = play(game, { type: "strike" }, { type: "strike" });
    expect(game.classic?.duel).toMatchObject({ attempts: 2, awaitingTeamId: "b", playerIndex: 2 });
    expect(game.strikes).toBe(0);
    game = play(game, { type: "reveal", answerId: "q1-1" });
    expect(game.classic).toMatchObject({ stage: "play", activePlayerIndex: 3 });
    expect(game.activeTeamId).toBe("b");
    expect(() => play(game, { type: "suggest", teamId: "b", participantId: "p", authorName: "Имя", text: "Вариант" })).toThrow(/по очереди/);
    game = play(game, { type: "reveal", answerId: "q1-2" }, { type: "strike" });
    expect(game.classic?.activePlayerIndex).toBe(5);
    game = play(game, { type: "strike" }, { type: "strike" });
    expect(game.phase).toBe("steal");
    expect(() => play(game, { type: "suggest", teamId: "a", participantId: "p", authorName: "Имя", text: "Вариант" })).not.toThrow();
  });

  it("проходит обычные раунды, игру наоборот и финал, не раскрывая закрытые ответы", () => {
    let game = play(classic(), { type: "start", teamId: "a" }, { type: "classic-buzz", teamId: "a" },
      { type: "reveal", answerId: "q1-0" }, { type: "reveal", answerId: "q1-1" },
      { type: "strike" }, { type: "strike" }, { type: "strike" }, { type: "reveal", answerId: "q1-2" });
    expect(game.teams[1]!.score).toBe(100);
    expect(game.phase).toBe("round-result");
    game = play(game, { type: "next" }, { type: "classic-buzz", teamId: "b" },
      { type: "reveal", answerId: "q2-1" }, { type: "reveal", answerId: "q2-2" }, { type: "reveal", answerId: "q2-0" });
    expect(game.teams[1]!.score).toBe(300);
    game = play(game, { type: "next" }, { type: "classic-buzz", teamId: "a" },
      { type: "reveal", answerId: "q3-0" }, { type: "strike" }, { type: "strike" }, { type: "strike" }, { type: "strike" });
    expect(game.teams[0]!.score).toBe(150);
    game = play(game, { type: "next" });
    expect(game.classic?.stage).toBe("reverse");
    expect(game.activeTeamId).toBe("a");
    game = play(game, { type: "reveal", answerId: "q4-2" }, { type: "reveal", answerId: "q4-1" }, { type: "next" });
    expect(game.teams.map((team) => team.score)).toEqual([210, 330]);
    expect(game.classic?.final?.teamId).toBe("b");
    expect(JSON.stringify(publicView(game))).not.toContain("Ответ 5-0");
    game = play(game, { type: "classic-final-start" }, { type: "classic-final-stop" });
    for (let index = 0; index < 5; index++)
      game = play(game, { type: "classic-final-answer", questionIndex: index, text: `Ответ ${index}`, answerId: `q${index + 5}-0` });
    expect(game.classic?.final?.score).toBe(250);
    game = play(game, { type: "classic-final-next" }, { type: "classic-final-start" }, { type: "classic-final-stop" });
    const beforeRepeat = structuredClone(game.classic?.final);
    game = play(game, { type: "classic-final-repeat" });
    expect(game.classic?.final).toEqual(beforeRepeat);
    expect(publicView(game).lastAction).toBe("repeat");
    expect(publicView(game).lastActionEventId).toBeTruthy();
    expect(JSON.stringify(publicView(game))).not.toContain("Ответ 5-0");
    expect(() => play(game, { type: "classic-final-answer", questionIndex: 0, text: "Ответ 0", answerId: "q5-0" })).toThrow(/повторяет/);
    for (let index = 0; index < 5; index++)
      game = play(game, { type: "classic-final-answer", questionIndex: index, text: `Второй ${index}`, answerId: `q${index + 5}-1` });
    game = play(game, { type: "classic-final-next" });
    expect(game.classic?.final?.score).toBe(400);
    expect(game.phase).toBe("finished");
    expect(gameResults(game).rounds).toHaveLength(4);
    expect(gameResults(game).totalRounds).toBe(5);
    expect(gameResults(game).completedRounds).toBe(5);
    expect(gameResults(game).rounds[3]?.teamAwards).toEqual([
      { teamId: "a", points: 60 }, { teamId: "b", points: 30 },
    ]);
    expect(resetGame(game).phase).toBe("lobby");
    expect(resetGame(game).classic?.stage).toBe("duel");
  });

  it("ограничивает обратную игру 20 секундами на команду и сохраняет остаток на паузе", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    let game = classic();
    game.questionIndex = 2;
    game.phase = "round-result";
    game = play(game, { type: "next", teamId: "a" });
    expect(game.classic?.reverse?.deadlineAt).toBe(Date.now() + 20_000);
    vi.advanceTimersByTime(5_000);
    game = play(game, { type: "pause" });
    expect(game.classic?.reverse?.remainingMs).toBe(15_000);
    vi.advanceTimersByTime(30_000);
    game = play(game, { type: "resume" });
    expect(game.classic?.reverse?.deadlineAt).toBe(Date.now() + 15_000);
    vi.advanceTimersByTime(15_001);
    expect(() => play(game, { type: "reveal", answerId: "q4-0" })).toThrow(/Время команды вышло/);
    game = play(game, { type: "strike" });
    expect(game.activeTeamId).toBe("b");
    expect(game.classic?.reverse?.deadlineAt).toBe(Date.now() + 20_000);
    game = play(game, { type: "reveal", answerId: "q4-1" });
    expect(game.phase).toBe("round-result");
    expect(game.teams[1]!.score).toBe(30);
  });

  it("раскрывает оставшиеся строки после неудачного перехвата без дополнительных очков", () => {
    const game = play(classic(), { type: "start", teamId: "a" }, { type: "classic-buzz", teamId: "a" },
      { type: "reveal", answerId: "q1-0" }, { type: "strike" }, { type: "strike" },
      { type: "strike" }, { type: "strike" });
    expect(game.phase).toBe("round-result");
    expect(game.teams.map((team) => team.score)).toEqual([50, 0]);
    expect(game.openedAnswerIds).toEqual(["q1-0"]);
    const view = publicView(game);
    expect(view.answers.every((answer) => answer.opened)).toBe(true);
    expect(view.answers.map((answer) => answer.points)).toEqual([50, 30, 20]);
    expect(view.roundStats?.answers.map((answer) => answer.opened)).toEqual([true, false, false]);
    expect(view.roundStats?.awardedPoints).toBe(50);
  });

  it("при отмене решения восстанавливает остаток таймера без добавления времени", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    let game = classic();
    game.questionIndex = 2;
    game.phase = "round-result";
    game = play(game, { type: "next", teamId: "a" });
    vi.advanceTimersByTime(5_000);
    game = play(game, { type: "reveal", answerId: "q4-0" });
    vi.advanceTimersByTime(30_000);
    game = play(game, { type: "undo" });
    expect(game.activeTeamId).toBe("a");
    expect(game.classic?.reverse?.deadlineAt).toBe(Date.now() + 15_000);
    vi.advanceTimersByTime(3_000);
    game = play(game, { type: "pause" });
    vi.advanceTimersByTime(60_000);
    game = play(game, { type: "undo" });
    expect(game.classic?.reverse?.deadlineAt).toBe(Date.now() + 12_000);
    vi.advanceTimersByTime(2_000);
    game = play(game, { type: "join-toggle", teamId: "a", open: false });
    vi.advanceTimersByTime(3_000);
    game = play(game, { type: "undo" });
    expect(game.classic?.reverse?.deadlineAt).toBe(Date.now() + 7_000);
  });

  it("сохраняет остаток финального таймера при undo и не считает незавершённый финал сыгранным", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    let game = classic();
    game.questionIndex = 3;
    game.phase = "round-result";
    game.classic!.stage = "reverse";
    game.teams[0]!.score = 100;
    game = play(game, { type: "next" }, { type: "classic-final-start" });
    const firstAttempt = game.classic?.final?.attemptId;
    expect(firstAttempt).toBeTruthy();
    vi.advanceTimersByTime(4_000);
    game = play(game, { type: "classic-final-stop" });
    vi.advanceTimersByTime(60_000);
    game = play(game, { type: "undo" });
    expect(game.classic?.final?.deadlineAt).toBe(Date.now() + 11_000);
    expect(game.classic?.final?.attemptId).toBe(firstAttempt);
    game = play(game, { type: "finish" });
    expect(gameResults(game).completedRounds).toBe(0);
    expect(gameResults(game).rounds).toEqual([]);
    expect(JSON.stringify(gameResults(game))).not.toContain("Ответ 5-0");
  });

  it("при ничьей использует дополнительный вопрос и скрывает его до дуэли", () => {
    let game = classic();
    game.questionIndex = 3;
    game.phase = "round-result";
    game.classic!.stage = "reverse";
    game = play(game, { type: "next" });
    expect(game.classic?.stage).toBe("tiebreak");
    expect(game.questionIndex).toBe(9);
    expect(JSON.stringify(publicView(game))).not.toContain("Ответ 10-0");
    game = play(game, { type: "classic-buzz", teamId: "a" }, { type: "strike" }, { type: "reveal", answerId: "q10-1" });
    expect(game.classic?.final?.teamId).toBe("b");
  });

  it("публикует вопросы финала только после полного завершения, не раскрывая частные ответы", () => {
    let game = classic();
    game.questionIndex = 3;
    game.phase = "round-result";
    game.classic!.stage = "reverse";
    game.teams[0]!.score = 1;
    game.questions[4]!.answers[0]!.originals = ["Секретная фраза респондента"];
    game.questions[4]!.answers[0]!.aliases = ["Закрытый синоним"];
    game.questions[4]!.notes = "Закрытая заметка";
    game = play(game, { type: "next" });
    expect(() => gameResults(game)).toThrow(/после завершения/);
    expect(JSON.stringify(publicView(game))).not.toContain("Вопрос 5");
    const interrupted = play(game, { type: "finish" });
    expect(gameResults(interrupted).classicFinal).toBeUndefined();
    expect(JSON.stringify(gameResults(interrupted))).not.toContain("Вопрос 5");
    game = play(game, { type: "classic-final-start" }, { type: "classic-final-stop" },
      { type: "classic-final-next" }, { type: "classic-final-start" }, { type: "classic-final-stop" },
      { type: "classic-final-next" });
    const results = gameResults(game);
    expect(results.classicFinal).toMatchObject({ teamId: "a", score: 0, superPrize: false });
    expect(results.classicFinal!.questions).toHaveLength(5);
    expect(results.classicFinal!.questions[0]!.answers.map((answer) => answer.share)).toEqual([50, 30, 20]);
    expect(JSON.stringify(results)).not.toContain("Секретная фраза респондента");
    expect(JSON.stringify(results)).not.toContain("Закрытый синоним");
    expect(JSON.stringify(results)).not.toContain("Закрытая заметка");
  });
});
