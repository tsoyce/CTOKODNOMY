import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createGame,
  gameResults,
  GameRuleError,
  normalizeGameState,
  publicView,
  resetGame,
  teamView,
} from "../server/game";
import { defaultBrand } from "../shared/types";
import { boardAnswers, GAME_ANSWER_LIMIT, rankedAnswers } from "../shared/questionAnswers";
import type {
  GameCommand,
  GameState,
  Participant,
  Question,
} from "../shared/types";

function question(id: string, points: number[]): Question {
  return {
    id,
    prompt: `Вопрос ${id}?`,
    answers: points.map((value, index) => ({
      id: `${id}-${index}`,
      text: `Скрытый ответ ${id}-${index}`,
      points: value,
      aliases: [`секретный синоним ${id}-${index}`],
      originals: [`исходная личная формулировка ${id}-${index}`],
    })),
    source: "Внутренний источник",
    surveyDate: "2026-10-01",
    respondentCount: 100,
    notes: "Секретная заметка ведущего",
    isDemo: true,
    pack: "Демонстрация",
  };
}

function makeGame(
  overrides: Parameters<typeof createGame>[0]["rules"] = undefined,
): GameState {
  return createGame({
    id: "game",
    title: "День социолога",
    brand: defaultBrand,
    questions: [
      question("q1", [40, 35, 25]),
      question("q2", [20, 30]),
      question("q3", [10, 20]),
    ],
    teams: [
      { id: "a", name: "Социологи", color: "#7559ff", joinCode: "SECRET-A" },
      { id: "b", name: "Гости", color: "#edff7a", joinCode: "SECRET-B" },
    ],
    rules: overrides,
  });
}

function playing(rules?: Parameters<typeof createGame>[0]["rules"]): GameState {
  return applyCommand(makeGame(rules), { type: "start", teamId: "a" });
}

function commands(game: GameState, ...steps: GameCommand[]): GameState {
  return steps.reduce(applyCommand, game);
}

function steal(rules?: Parameters<typeof createGame>[0]["rules"]): GameState {
  return commands(
    playing(rules),
    { type: "reveal", answerId: "q1-0" },
    { type: "strike" },
    { type: "strike" },
    { type: "strike" },
  );
}

const suggestion = (teamId = "a", text = "Мой вариант"): GameCommand => ({
  type: "suggest",
  teamId,
  participantId: `player-${teamId}`,
  authorName: "Участник",
  text,
});
const submission = (teamId = "a"): GameCommand => ({
  type: "submit",
  teamId,
  participantId: `captain-${teamId}`,
  authorName: "Капитан",
  text: "Итоговый вариант",
});

describe("Создание партии", () => {
  it("создаёт собственные снимки вопросов и бренда и уникальные приглашения", () => {
    const questions = [question("custom", [5])];
    const brand = structuredClone(defaultBrand);
    const game = createGame({
      title: "Игра",
      brand,
      questions,
      teams: [
        { name: "Один", color: "#000000" },
        { name: "Два", color: "#ffffff" },
      ],
    });
    expect(game.phase).toBe("lobby");
    expect(game.rules).toEqual({
      multipliers: [1, 2, 3],
      stealAddsPoints: true,
    });
    expect(game.teams[0]!.id).not.toBe(game.teams[1]!.id);
    expect(game.teams[0]!.joinCode).not.toBe(game.teams[1]!.joinCode);
    questions[0]!.answers[0]!.text = "Изменённый вопрос библиотеки";
    brand.title = "Изменённый бренд";
    expect(game.questions[0]!.answers[0]!.text).toBe("Скрытый ответ custom-0");
    expect(game.brand.title).toBe(defaultBrand.title);
  });

  it("отклоняет отсутствующие вопросы, повторяющиеся ответы и неверные множители", () => {
    const input = {
      title: "Игра",
      brand: defaultBrand,
      questions: [],
      teams: [
        { name: "Один", color: "#000000" },
        { name: "Два", color: "#ffffff" },
      ],
    };
    expect(() => createGame(input)).toThrow(GameRuleError);
    const repeated = question("repeated", [1, 2]);
    repeated.answers[1]!.id = repeated.answers[0]!.id;
    expect(() => createGame({ ...input, questions: [repeated] })).toThrow(
      /уникальными/,
    );
    expect(() => makeGame({ multipliers: [0] })).toThrow(/Множители/);
    expect(() => makeGame({ multipliers: [1.5] })).toThrow(/Множители/);
  });
});

describe("Шесть ответов на табло и полная статистика опроса", () => {
  function surveyGame(points: number[]): GameState {
    return createGame({
      title: "Опрос",
      brand: defaultBrand,
      questions: [question("survey", points), question("future", [10, 1])],
      teams: [
        { id: "a", name: "А", color: "#000000" },
        { id: "b", name: "Б", color: "#ffffff" },
      ],
    });
  }

  it("выбирает самые частые ответы и сохраняет порядок равных частот без изменения исходника", () => {
    const source = question("rank", [1, 7, 7, 3, 2, 5, 4, 7]).answers;
    const before = structuredClone(source);
    expect(rankedAnswers(source).map((answer) => answer.id)).toEqual([
      "rank-1", "rank-2", "rank-7", "rank-5", "rank-6", "rank-3", "rank-4", "rank-0",
    ]);
    expect(boardAnswers(source).map((answer) => answer.id)).toEqual([
      "rank-1", "rank-2", "rank-7", "rank-5", "rank-6", "rank-3",
    ]);
    expect(source).toEqual(before);
    const game = surveyGame([1, 7, 7, 3, 2, 5, 4, 7]);
    expect(game.boardAnswerLimit).toBe(GAME_ANSWER_LIMIT);
    expect(game.questions[0]!.answers.map((answer) => answer.points)).toEqual([
      7, 7, 7, 5, 4, 3, 2, 1,
    ]);
  });

  it("не принимает редкий вариант, а открытие ровно шести лучших завершает раунд", () => {
    let game = applyCommand(surveyGame([2, 8, 7, 7, 6, 5, 4, 1]), {
      type: "start", teamId: "a",
    });
    const before = structuredClone(game);
    try {
      applyCommand(game, { type: "reveal", answerId: "survey-0" });
      throw new Error("Rare answer was accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(GameRuleError);
      expect((error as GameRuleError).statusCode).toBe(400);
    }
    expect(game).toEqual(before);
    for (const answerId of ["survey-1", "survey-2", "survey-3", "survey-4", "survey-5"])
      game = applyCommand(game, { type: "reveal", answerId });
    expect(game.phase).toBe("playing");
    expect(game.bank).toBe(33);
    game = applyCommand(game, { type: "reveal", answerId: "survey-6" });
    expect(game.phase).toBe("round-result");
    expect(game.teams.map((team) => team.score)).toEqual([37, 0]);
    expect(publicView(game).answers).toHaveLength(6);
    expect(publicView(game).roundStats).toMatchObject({
      boardAnswerCount: 6, totalPoints: 40, awardedPoints: 37,
    });
    expect(publicView(game).roundStats!.answers.filter((answer) => !answer.onBoard)).toEqual([
      expect.objectContaining({ text: "Скрытый ответ survey-0", points: 2, opened: false }),
      expect.objectContaining({ text: "Скрытый ответ survey-7", points: 1, opened: false }),
    ]);
  });

  it("редкий ответ не завершает перехват и не изменяет банк", () => {
    const game = commands(
      surveyGame([8, 7, 6, 5, 4, 3, 2]),
      { type: "start", teamId: "a" },
      { type: "reveal", answerId: "survey-0" },
      { type: "strike" }, { type: "strike" }, { type: "strike" },
    );
    expect(game.phase).toBe("steal");
    expect(() => applyCommand(game, { type: "reveal", answerId: "survey-6" })).toThrow(GameRuleError);
    expect(game.bank).toBe(8);
    expect(game.teams.map((team) => team.score)).toEqual([0, 0]);
    expect(applyCommand(game, { type: "reveal", answerId: "survey-1" }).teams[1]!.score).toBe(15);
  });

  it("раскрывает все 17 вариантов после раунда и считает доли от полного опроса", () => {
    const self: Participant = {
      id: "player", gameId: "", teamId: "a", name: "Анна", role: "player",
    };
    const game = commands(
      surveyGame(Array.from({ length: 17 }, () => 1)),
      { type: "start", teamId: "a" },
      { type: "reveal", answerId: "survey-0" },
    );
    self.gameId = game.id;
    for (const view of [publicView(game), teamView(game, self, [self])]) {
      expect(view.answers).toHaveLength(6);
      expect(view.roundStats).toBeNull();
      expect(JSON.stringify(view)).not.toContain("Скрытый ответ survey-6");
      expect(JSON.stringify(view)).not.toContain("Скрытый ответ future");
    }
    const ended = applyCommand(game, { type: "award", teamId: "a" });
    const stats = publicView(ended).roundStats!;
    expect(stats.answers).toHaveLength(17);
    expect(stats.totalPoints).toBe(17);
    expect(stats.boardAnswerCount).toBe(6);
    expect(stats.answers.filter((answer) => answer.onBoard)).toHaveLength(6);
    expect(stats.answers.filter((answer) => answer.opened)).toHaveLength(1);
    for (const answer of stats.answers) expect(answer.share).toBeCloseTo(100 / 17);
    expect(teamView(ended, self, [self]).roundStats).toEqual(stats);
    const finished = applyCommand(ended, { type: "finish" });
    const results = gameResults(finished);
    expect(results.rounds[0]!.answers).toHaveLength(17);
    for (const privateValue of ["секретный синоним", "исходная личная формулировка", "Секретная заметка", "Скрытый ответ future"])
      expect(JSON.stringify(results)).not.toContain(privateValue);
    const next = applyCommand(ended, { type: "next" });
    expect(publicView(next).roundStats).toBeNull();
    expect(JSON.stringify(publicView(next))).not.toContain("Скрытый ответ survey-6");
  });

  it("не помечает вариант вне табло открытым даже при старой ошибочной записи результата", () => {
    const ended = commands(
      surveyGame([8, 7, 6, 5, 4, 3, 2]),
      { type: "start", teamId: "a" },
      { type: "award", teamId: "a" },
    );
    ended.roundResults[0]!.openedAnswerIds.push("survey-6");
    expect(publicView(ended).roundStats!.answers[6]).toMatchObject({ onBoard: false, opened: false });
  });

  it("сохраняет порядок и все строки старой партии; сброс создаёт новое табло из шести", () => {
    const originalQuestion = question("legacy", [1, 8, 3, 4, 2, 7, 6, 5]);
    const legacy = surveyGame([1]);
    legacy.questions = [structuredClone(originalQuestion)];
    delete legacy.boardAnswerLimit;
    const normalized = normalizeGameState(legacy);
    expect(normalized.boardAnswerLimit).toBeUndefined();
    expect(normalized.questions[0]!.answers).toEqual(originalQuestion.answers);
    let game = applyCommand(normalized, { type: "start", teamId: "a" });
    expect(publicView(game).answers).toHaveLength(8);
    game = applyCommand(game, { type: "reveal", answerId: "legacy-0" });
    expect(publicView(game).answers[0]).toMatchObject({ opened: true, points: 1 });
    for (const answer of originalQuestion.answers.slice(1, 6))
      game = applyCommand(game, { type: "reveal", answerId: answer.id });
    expect(game.phase).toBe("playing");
    for (const answer of originalQuestion.answers.slice(6))
      game = applyCommand(game, { type: "reveal", answerId: answer.id });
    expect(game.phase).toBe("round-result");
    expect(publicView(game).roundStats!.boardAnswerCount).toBe(8);
    expect(publicView(game).roundStats!.answers.every((answer) => answer.onBoard)).toBe(true);
    expect(publicView(game).roundStats!.answers.map((answer) => answer.points)).toEqual([1, 8, 3, 4, 2, 7, 6, 5]);
    const restarted = resetGame(game);
    expect(restarted.boardAnswerLimit).toBe(6);
    expect(restarted.questions[0]!.answers.map((answer) => answer.points)).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    expect(publicView(applyCommand(restarted, { type: "start", teamId: "a" })).answers).toHaveLength(6);
  });
});

describe("Банк и счёт", () => {
  it("начисляет банк один раз после всех ответов и сохраняет исходное состояние", () => {
    const original = playing();
    const game = commands(
      original,
      { type: "reveal", answerId: "q1-0" },
      { type: "reveal", answerId: "q1-1" },
      { type: "reveal", answerId: "q1-2" },
    );
    expect(original.bank).toBe(0);
    expect(original.openedAnswerIds).toEqual([]);
    expect(game.bank).toBe(100);
    expect(game.teams.map((team) => team.score)).toEqual([100, 0]);
    expect(game.phase).toBe("round-result");
    expect(() => applyCommand(game, { type: "award", teamId: "a" })).toThrow(
      GameRuleError,
    );
    expect(game.teams[0]!.score).toBe(100);
  });

  it("повтор уже открытого ответа не меняет ни банк, ни ревизию", () => {
    const game = applyCommand(playing(), { type: "reveal", answerId: "q1-0" });
    const before = structuredClone(game);
    expect(() =>
      applyCommand(game, { type: "reveal", answerId: "q1-0" }),
    ).toThrow(/уже открыт/);
    expect(game).toEqual(before);
    expect(() =>
      applyCommand(game, { type: "reveal", answerId: "q2-0" }),
    ).toThrow(/текущему вопросу/);
    expect(game).toEqual(before);
  });

  it("проводит три раунда с множителями ×1, ×2 и ×3 и завершает партию", () => {
    let game = commands(
      playing(),
      { type: "reveal", answerId: "q1-0" },
      { type: "reveal", answerId: "q1-1" },
      { type: "reveal", answerId: "q1-2" },
      { type: "next", teamId: "b" },
    );
    expect(game.bank).toBe(0);
    expect(game.openedAnswerIds).toEqual([]);
    expect(publicView(game).multiplier).toBe(2);
    game = commands(
      game,
      { type: "reveal", answerId: "q2-0" },
      { type: "reveal", answerId: "q2-1" },
      { type: "next", teamId: "a" },
    );
    expect(game.teams.map((team) => team.score)).toEqual([100, 100]);
    expect(publicView(game).multiplier).toBe(3);
    game = commands(
      game,
      { type: "reveal", answerId: "q3-0" },
      { type: "reveal", answerId: "q3-1" },
      { type: "next" },
    );
    expect(game.teams.map((team) => team.score)).toEqual([190, 100]);
    expect(game.phase).toBe("finished");
    expect(game.teams.every((team) => !team.joinOpen)).toBe(true);
    expect(() => applyCommand(game, { type: "next" })).toThrow(GameRuleError);
  });

  it("применяет последний заданный множитель к дальнейшим раундам", () => {
    const game = commands(
      playing({ multipliers: [2] }),
      { type: "reveal", answerId: "q1-0" },
      { type: "award", teamId: "a" },
      { type: "next", teamId: "b" },
      { type: "reveal", answerId: "q2-0" },
    );
    expect(game.teams[0]!.score).toBe(80);
    expect(game.bank).toBe(40);
    expect(publicView(game).multiplier).toBe(2);
  });

  it("позволяет ведущему завершить неполный раунд присуждением банка", () => {
    const game = commands(
      playing(),
      { type: "reveal", answerId: "q1-0" },
      { type: "award", teamId: "b" },
    );
    expect(game.teams.map((team) => team.score)).toEqual([0, 40]);
    expect(game.activeTeamId).toBe("b");
    expect(game.phase).toBe("round-result");
  });
});

describe("Ошибки и перехват", () => {
  it("после трёх ошибок даёт сопернику ровно одну попытку", () => {
    const game = steal();
    expect(game.phase).toBe("steal");
    expect(game.strikes).toBe(3);
    expect(game.activeTeamId).toBe("b");
    expect(game.originTeamId).toBe("a");
    expect(game.bank).toBe(40);
    expect(() => applyCommand(game, { type: "turn", teamId: "a" })).toThrow(
      /перехвата/,
    );
    expect(() => applyCommand(game, submission("a"))).toThrow(/другая команда/);
    expect(applyCommand(game, submission("b")).pendingAnswer?.teamId).toBe("b");
  });

  it("успешный перехват присуждает сопернику банк вместе с очками ответа", () => {
    const game = applyCommand(steal(), { type: "reveal", answerId: "q1-1" });
    expect(game.teams.map((team) => team.score)).toEqual([0, 75]);
    expect(game.bank).toBe(75);
    expect(game.phase).toBe("round-result");
    expect(game.activeTeamId).toBe("b");
    expect(() =>
      applyCommand(game, { type: "reveal", answerId: "q1-2" }),
    ).toThrow(GameRuleError);
  });

  it("настраиваемое правило позволяет перехват без очков за новый ответ", () => {
    const game = applyCommand(steal({ stealAddsPoints: false }), {
      type: "reveal",
      answerId: "q1-1",
    });
    expect(game.openedAnswerIds).toContain("q1-1");
    expect(game.teams.map((team) => team.score)).toEqual([0, 40]);
    expect(game.bank).toBe(40);
  });

  it("неудачный перехват отдаёт банк исходной команде без повторного начисления", () => {
    const game = applyCommand(steal(), { type: "strike" });
    expect(game.phase).toBe("round-result");
    expect(game.activeTeamId).toBe("a");
    expect(game.teams.map((team) => team.score)).toEqual([40, 0]);
    expect(() => applyCommand(game, { type: "strike" })).toThrow(GameRuleError);
    expect(game.teams[0]!.score).toBe(40);
  });

  it("передача хода сохраняет банк и меняет исходную команду нового перехвата", () => {
    let game = commands(
      playing(),
      { type: "reveal", answerId: "q1-0" },
      { type: "strike" },
      submission("a"),
      { type: "turn", teamId: "b" },
    );
    expect(game.bank).toBe(40);
    expect(game.strikes).toBe(0);
    expect(game.pendingAnswer).toBeNull();
    game = commands(
      game,
      { type: "strike" },
      { type: "strike" },
      { type: "strike" },
      { type: "strike" },
    );
    expect(game.teams.map((team) => team.score)).toEqual([0, 40]);
  });
});

describe("Фазы, пауза и предложения", () => {
  it("запрещает игровые действия до начала и переход до итогов", () => {
    for (const command of [
      suggestion(),
      submission(),
      { type: "reveal", answerId: "q1-0" },
      { type: "strike" },
      { type: "next" },
      { type: "award", teamId: "a" },
    ] as GameCommand[]) {
      expect(() => applyCommand(makeGame(), command)).toThrow(GameRuleError);
    }
    expect(() =>
      applyCommand(playing(), { type: "start", teamId: "a" }),
    ).toThrow(GameRuleError);
    expect(() => applyCommand(playing(), { type: "next" })).toThrow(
      GameRuleError,
    );
  });

  it("сохраняет ожидающий ответ на паузе и блокирует игровые действия до продолжения", () => {
    const before = applyCommand(playing(), submission());
    const paused = applyCommand(before, { type: "pause" });
    expect(paused.phase).toBe("playing");
    expect(paused.pendingAnswer).toEqual(before.pendingAnswer);
    for (const command of [
      suggestion(),
      submission(),
      { type: "reveal", answerId: "q1-0" },
      { type: "strike" },
      { type: "turn", teamId: "b" },
      { type: "award", teamId: "a" },
    ] as GameCommand[]) {
      expect(() => applyCommand(paused, command)).toThrow(/паузе/);
    }
    expect(() => applyCommand(paused, { type: "pause" })).toThrow(
      GameRuleError,
    );
    const resumed = applyCommand(paused, { type: "resume" });
    expect(resumed.pendingAnswer).toEqual(before.pendingAnswer);
    expect(
      applyCommand(resumed, { type: "reveal", answerId: "q1-0" }).bank,
    ).toBe(40);
    expect(() => applyCommand(resumed, { type: "resume" })).toThrow(
      GameRuleError,
    );
  });

  it("разрешает предложения только команде хода и один ожидающий итоговый ответ", () => {
    expect(() => applyCommand(playing(), suggestion("b"))).toThrow(
      /другая команда/,
    );
    expect(() => applyCommand(playing(), suggestion("a", "   "))).toThrow(
      GameRuleError,
    );
    const game = commands(
      playing(),
      suggestion("a", "  Мой вариант  "),
      submission(),
    );
    expect(game.suggestions[0]!.text).toBe("Мой вариант");
    expect(game.pendingAnswer?.text).toBe("Итоговый вариант");
    expect(() => applyCommand(game, submission())).toThrow(/ожидает решения/);
    expect(applyCommand(game, { type: "strike" }).pendingAnswer).toBeNull();
    expect(
      applyCommand(game, { type: "reveal", answerId: "q1-0" }).suggestions,
    ).toEqual([]);
    expect(game.pendingAnswer).not.toBeNull();
  });

  it("завершение закрывает приглашения, но не зачисляет незавершённый банк", () => {
    const game = commands(
      playing(),
      { type: "reveal", answerId: "q1-0" },
      submission(),
      { type: "pause" },
      { type: "finish" },
    );
    expect(game.phase).toBe("finished");
    expect(game.paused).toBe(false);
    expect(game.pendingAnswer).toBeNull();
    expect(game.teams.map((team) => team.score)).toEqual([0, 0]);
    expect(game.teams.every((team) => !team.joinOpen)).toBe(true);
    expect(() =>
      applyCommand(game, { type: "join-toggle", teamId: "a", open: true }),
    ).toThrow(GameRuleError);
    expect(() => applyCommand(game, { type: "finish" })).toThrow(GameRuleError);
  });

  it("закрытие входа в одну команду не закрывает другую", () => {
    const game = applyCommand(makeGame(), {
      type: "join-toggle",
      teamId: "a",
      open: false,
    });
    expect(game.teams.map((team) => team.joinOpen)).toEqual([false, true]);
    expect(() =>
      applyCommand(game, { type: "join-toggle", teamId: "a", open: false }),
    ).toThrow(GameRuleError);
  });
});

describe("Отмена и журнал", () => {
  it("отменяет начисление банка и восстанавливает ожидавший ответ без снижения ревизии", () => {
    const before = commands(
      playing(),
      { type: "reveal", answerId: "q1-0" },
      { type: "reveal", answerId: "q1-1" },
      submission(),
    );
    const awarded = applyCommand(before, { type: "reveal", answerId: "q1-2" });
    const undone = applyCommand(awarded, { type: "undo" });
    expect(undone.teams.map((team) => team.score)).toEqual([0, 0]);
    expect(undone.phase).toBe("playing");
    expect(undone.bank).toBe(75);
    expect(undone.openedAnswerIds).toEqual(["q1-0", "q1-1"]);
    expect(undone.pendingAnswer).toEqual(before.pendingAnswer);
    expect(undone.revision).toBe(awarded.revision + 1);
    expect(undone.events.at(-1)?.type).toBe("undo");
    expect(
      applyCommand(undone, { type: "reveal", answerId: "q1-2" }).teams[0]!
        .score,
    ).toBe(100);
  });

  it("предложения и итоговый ответ не заполняют историю решений ведущего", () => {
    const game = commands(playing(), suggestion(), suggestion(), submission());
    expect(game.history).toHaveLength(1);
    expect(game.revision).toBe(4);
    const undo = applyCommand(game, { type: "undo" });
    expect(undo.phase).toBe("lobby");
    expect(undo.suggestions).toEqual([]);
    expect(undo.pendingAnswer).toBeNull();
    expect(() => applyCommand(undo, { type: "undo" })).toThrow(/Нет решений/);
  });

  it("проверяет причину и корректность ручного изменения счёта и позволяет отмену", () => {
    const base = makeGame();
    expect(() =>
      applyCommand(base, {
        type: "adjust",
        teamId: "a",
        delta: 10,
        reason: " ",
      }),
    ).toThrow(GameRuleError);
    expect(() =>
      applyCommand(base, {
        type: "adjust",
        teamId: "a",
        delta: -1,
        reason: "Исправление",
      }),
    ).toThrow(GameRuleError);
    expect(() =>
      applyCommand(base, {
        type: "adjust",
        teamId: "a",
        delta: 1.5,
        reason: "Исправление",
      }),
    ).toThrow(GameRuleError);
    const adjusted = applyCommand(base, {
      type: "adjust",
      teamId: "a",
      delta: 15,
      reason: "Решение жюри",
    });
    expect(adjusted.teams[0]!.score).toBe(15);
    expect(adjusted.events.at(-1)?.message).toContain("Решение жюри");
    expect(applyCommand(adjusted, { type: "undo" }).teams[0]!.score).toBe(0);
  });

  it("ограничивает накопление предложений, истории и событий", () => {
    let game = playing();
    for (let index = 0; index < 220; index += 1)
      game = applyCommand(game, suggestion("a", `Вариант ${index}`));
    expect(game.suggestions).toHaveLength(100);
    expect(game.suggestions[0]!.text).toBe("Вариант 120");
    expect(game.events).toHaveLength(200);
    expect(game.history).toHaveLength(1);
    for (let index = 0; index < 60; index += 1) {
      game = applyCommand(game, { type: index % 2 === 0 ? "pause" : "resume" });
    }
    expect(game.history).toHaveLength(50);
    expect(game.events).toHaveLength(200);
    expect(new Set(game.events.map((event) => event.id)).size).toBe(200);
  });
});

describe("Представления для гостей и команд", () => {
  it("не отправляет текущий вопрос гостям, пока игра находится в лобби", () => {
    const view = publicView(makeGame());
    expect(view.prompt).toBe("");
    expect(view.answers).toEqual([]);
  });

  it("отправляет гостям исключительно открытые тексты и очки", () => {
    const game = commands(
      playing(),
      suggestion("a", "Секрет команды"),
      submission(),
      { type: "reveal", answerId: "q1-0" },
    );
    const view = publicView(game);
    expect(view.answers).toEqual([
      { position: 1, opened: true, text: "Скрытый ответ q1-0", points: 40 },
      { position: 2, opened: false },
      { position: 3, opened: false },
    ]);
    for (const key of [
      "questions",
      "history",
      "events",
      "suggestions",
      "pendingAnswer",
      "rules",
      "originTeamId",
    ]) {
      expect(view).not.toHaveProperty(key);
    }
    const json = JSON.stringify(view);
    for (const secret of [
      "SECRET-A",
      "SECRET-B",
      "Скрытый ответ q1-1",
      "Скрытый ответ q2-0",
      "секретный синоним",
      "Секретная заметка",
      "Итоговый вариант",
      "Секрет команды",
      "Внутренний источник",
    ]) {
      expect(json).not.toContain(secret);
    }
    expect(view.teams[0]).not.toHaveProperty("joinCode");
    view.teams[0]!.score = 999;
    view.brand.title = "Другой бренд";
    expect(game.teams[0]!.score).toBe(0);
    expect(game.brand.title).toBe(defaultBrand.title);
  });

  it("показывает участнику только предложения, игроков и ожидающий ответ своей команды", () => {
    const game = commands(playing(), suggestion(), submission());
    const a: Participant = {
      id: "player-a",
      gameId: game.id,
      teamId: "a",
      name: "Анна",
      role: "player",
    };
    const b: Participant = {
      id: "player-b",
      gameId: game.id,
      teamId: "b",
      name: "Борис",
      role: "player",
    };
    const outsider: Participant = {
      ...a,
      id: "outsider",
      gameId: "other-game",
    };
    const own = teamView(game, a, [a, b, outsider]);
    expect(own.players.map((person) => person.id)).toEqual(["player-a"]);
    expect(own.suggestions).toHaveLength(1);
    expect(own.pendingAnswer?.teamId).toBe("a");
    const other = teamView(game, b, [a, b]);
    expect(other.suggestions).toEqual([]);
    expect(other.pendingAnswer).toBeNull();
    expect(JSON.stringify(other)).not.toContain("Итоговый вариант");
    expect(() => teamView(game, outsider, [outsider])).toThrow(GameRuleError);
  });
});

describe("Статистика раундов и новая партия", () => {
  it("показывает все ответы только после раунда и фиксирует начисление банка", () => {
    const active = applyCommand(playing(), {
      type: "reveal",
      answerId: "q1-0",
    });
    expect(publicView(active).roundStats).toBeNull();
    const ended = applyCommand(active, { type: "award", teamId: "b" });
    const stats = publicView(ended).roundStats!;
    expect(stats).toMatchObject({
      questionId: "q1",
      questionIndex: 0,
      source: "Внутренний источник",
      surveyDate: "2026-10-01",
      respondentCount: 100,
      totalPoints: 100,
      multiplier: 1,
      winnerTeamId: "b",
      awardedPoints: 40,
      strikes: 0,
      completed: true,
    });
    expect(stats.answers).toEqual([
      {
        position: 1,
        text: "Скрытый ответ q1-0",
        points: 40,
        opened: true,
        onBoard: true,
        share: 40,
      },
      {
        position: 2,
        text: "Скрытый ответ q1-1",
        points: 35,
        opened: false,
        onBoard: true,
        share: 35,
      },
      {
        position: 3,
        text: "Скрытый ответ q1-2",
        points: 25,
        opened: false,
        onBoard: true,
        share: 25,
      },
    ]);
    expect(Number.isNaN(Date.parse(stats.completedAt))).toBe(false);
    expect(ended.roundResults).toHaveLength(1);
    expect(active.roundResults).toEqual([]);
    const next = applyCommand(ended, { type: "next" });
    expect(publicView(next).roundStats).toBeNull();
    expect(next.roundResults).toEqual(ended.roundResults);
  });

  it("запоминает банк при перехвате отдельно от суммы весов ответов", () => {
    const ended = applyCommand(steal({ stealAddsPoints: false }), {
      type: "reveal",
      answerId: "q1-1",
    });
    expect(publicView(ended).roundStats).toMatchObject({
      totalPoints: 100,
      awardedPoints: 40,
      winnerTeamId: "b",
      strikes: 3,
    });
    expect(
      publicView(ended).roundStats!.answers.filter((answer) => answer.opened),
    ).toHaveLength(2);
  });

  it("публикует в итогах только сыгранные вопросы без служебных полей", () => {
    const finished = commands(
      playing(),
      { type: "reveal", answerId: "q1-0" },
      { type: "award", teamId: "a" },
      { type: "finish" },
    );
    finished.resultsPublished = true;
    const results = gameResults(finished);
    expect(results.published).toBe(true);
    expect(publicView(finished).resultsAvailable).toBe(true);
    expect(results.totalRounds).toBe(3);
    expect(results.rounds).toHaveLength(1);
    expect(results.rounds[0]!.answers).toHaveLength(3);
    expect(results.teams[0]).not.toHaveProperty("joinCode");
    for (const privateValue of [
      "SECRET-A",
      "SECRET-B",
      "Секретная заметка",
      "секретный синоним",
      "Скрытый ответ q2-0",
      "Скрытый ответ q3-0",
    ])
      expect(JSON.stringify(results)).not.toContain(privateValue);
    results.rounds[0]!.answers[0]!.text = "Изменено";
    results.brand.title = "Изменено";
    expect(finished.questions[0]!.answers[0]!.text).toBe("Скрытый ответ q1-0");
    expect(finished.brand.title).toBe(defaultBrand.title);
    expect(() => gameResults(playing())).toThrow(/после завершения/);
  });

  it("отмечает прерванный раунд и не зачисляет банк; нулевые веса дают нулевые доли", () => {
    const game = createGame({
      title: "Нулевые веса",
      brand: defaultBrand,
      questions: [question("zero", [0, 0]), question("future", [50])],
      teams: [
        { id: "a", name: "А", color: "#000000" },
        { id: "b", name: "Б", color: "#ffffff" },
      ],
    });
    const finished = commands(
      game,
      { type: "start", teamId: "a" },
      { type: "reveal", answerId: "zero-0" },
      { type: "finish" },
    );
    const results = gameResults(finished);
    expect(results.rounds).toHaveLength(1);
    expect(results.rounds[0]).toMatchObject({
      completed: false,
      winnerTeamId: null,
      awardedPoints: 0,
      totalPoints: 0,
    });
    expect(results.rounds[0]!.answers.map((answer) => answer.share)).toEqual([
      0, 0,
    ]);
    expect(results.teams.map((team) => team.score)).toEqual([0, 0]);
    expect(publicView(finished).roundStats).toBeNull();
    expect(JSON.stringify(results)).not.toContain("Скрытый ответ future");
  });

  it("не раскрывает первый вопрос при завершении игры прямо из лобби", () => {
    const finished = applyCommand(makeGame(), { type: "finish" });
    expect(gameResults(finished).rounds).toEqual([]);
    expect(publicView(finished)).toMatchObject({
      prompt: "",
      answers: [],
      roundStats: null,
    });
    expect(JSON.stringify(gameResults(finished))).not.toContain("Вопрос q1");
  });

  it("отмена изменения счёта не публикует скрытые итоги заново", () => {
    const finished = applyCommand(playing(), { type: "finish" });
    finished.resultsPublished = true;
    const adjusted = applyCommand(finished, {
      type: "adjust",
      teamId: "a",
      delta: 10,
      reason: "Исправление",
    });
    adjusted.resultsPublished = false;
    const undone = applyCommand(adjusted, { type: "undo" });
    expect(undone.phase).toBe("finished");
    expect(undone.teams[0]!.score).toBe(0);
    expect(undone.resultsPublished).toBe(false);
    expect(publicView(undone).resultsAvailable).toBe(false);
  });

  it("отмена убирает итог раунда и публикацию при возврате к игре", () => {
    const ended = commands(
      playing(),
      { type: "reveal", answerId: "q1-0" },
      { type: "award", teamId: "a" },
    );
    expect(ended.roundResults).toHaveLength(1);
    const active = applyCommand(ended, { type: "undo" });
    expect(active.roundResults).toEqual([]);
    expect(publicView(active).roundStats).toBeNull();
    const finished = applyCommand(active, { type: "finish" });
    finished.resultsPublished = true;
    const resumed = applyCommand(finished, { type: "undo" });
    expect(resumed.phase).toBe("playing");
    expect(resumed.roundResults).toEqual([]);
    expect(resumed.resultsPublished).toBe(false);
    expect(publicView(resumed).resultsAvailable).toBe(false);
  });

  it("восстанавливает старые раунды из истории без изменения сохранённого состояния", () => {
    const state = commands(
      playing(),
      { type: "reveal", answerId: "q1-0" },
      { type: "award", teamId: "b" },
      { type: "next", teamId: "a" },
    );
    const old = legacy(state);
    const normalized = normalizeGameState(old);
    expect(normalized.roundResults).toHaveLength(1);
    expect(normalized.roundResults[0]).toMatchObject({
      questionIndex: 0,
      winnerTeamId: "b",
      awardedPoints: 40,
      openedAnswerIds: ["q1-0"],
      completed: true,
    });
    expect(normalized.resultsPublished).toBe(false);
    expect(
      normalized.history.every(
        (item) =>
          Array.isArray(item.roundResults) && item.resultsPublished === false,
      ),
    ).toBe(true);
    expect(old).not.toHaveProperty("roundResults");
    const beforeNext = applyCommand(old, { type: "undo" });
    expect(beforeNext.phase).toBe("round-result");
    expect(publicView(beforeNext).roundStats!.winnerTeamId).toBe("b");
    const beforeAward = applyCommand(beforeNext, { type: "undo" });
    expect(beforeAward.phase).toBe("playing");
    expect(beforeAward.roundResults).toEqual([]);
  });

  it("при усечённой старой истории не выдумывает победителя, очки и открытые ответы", () => {
    const old = legacy(
      commands(playing(), { type: "award", teamId: "b" }, { type: "next" }),
    );
    old.history = [];
    const normalized = normalizeGameState(old);
    expect(normalized.roundResults).toEqual([
      {
        questionIndex: 0,
        winnerTeamId: null,
        awardedPoints: 0,
        openedAnswerIds: [],
        strikes: 0,
        multiplier: 1,
        completed: true,
        completedAt: "",
      },
    ]);
    expect(
      normalizeGameState(legacy(applyCommand(makeGame(), { type: "finish" })))
        .roundResults,
    ).toEqual([]);
  });

  it("сохраняет восстановленный результат старой завершённой игры после исправлений счёта", () => {
    const old = legacy(
      commands(
        playing(),
        { type: "reveal", answerId: "q1-0" },
        { type: "award", teamId: "b" },
        { type: "finish" },
        { type: "adjust", teamId: "a", delta: 5, reason: "Жюри" },
      ),
    );
    expect(gameResults(old).rounds[0]).toMatchObject({
      completed: true,
      winnerTeamId: "b",
      awardedPoints: 40,
    });
    expect(gameResults(old).teams.map((team) => team.score)).toEqual([5, 40]);
  });

  it("сбрасывает партию с новыми приглашениями и сохраняет подготовленные вопросы", () => {
    const old = commands(
      playing(),
      suggestion(),
      { type: "reveal", answerId: "q1-0" },
      { type: "award", teamId: "b" },
      { type: "finish" },
    );
    old.resultsPublished = true;
    const before = structuredClone(old);
    const brand = { ...defaultBrand, title: "Новый бренд" };
    const reset = resetGame(old, brand);
    expect(reset).toMatchObject({
      id: old.id,
      title: old.title,
      createdAt: old.createdAt,
      phase: "lobby",
      paused: false,
      questionIndex: 0,
      bank: 0,
      strikes: 0,
      activeTeamId: null,
      originTeamId: null,
      revision: old.revision + 1,
      openedAnswerIds: [],
      pendingAnswer: null,
      suggestions: [],
      roundResults: [],
      resultsPublished: false,
      history: [],
      events: [],
    });
    expect(reset.questions).toEqual(old.questions);
    expect(reset.rules).toEqual(old.rules);
    expect(reset.brand.title).toBe("Новый бренд");
    expect(
      reset.teams.map(({ id, name, color, score, joinOpen }) => ({
        id,
        name,
        color,
        score,
        joinOpen,
      })),
    ).toEqual(
      old.teams.map(({ id, name, color }) => ({
        id,
        name,
        color,
        score: 0,
        joinOpen: true,
      })),
    );
    const oldCodes = new Set(old.teams.map((team) => team.joinCode));
    expect(reset.teams.every((team) => !oldCodes.has(team.joinCode))).toBe(
      true,
    );
    expect(new Set(reset.teams.map((team) => team.joinCode)).size).toBe(2);
    reset.questions[0]!.prompt = "Изменено";
    brand.title = "Изменено";
    expect(old).toEqual(before);
    expect(reset.brand.title).toBe("Новый бренд");
  });
});

function legacy(state: GameState): GameState {
  const old = structuredClone(state);
  for (const item of [old, ...old.history]) {
    delete (item as Partial<typeof item>).roundResults;
    delete (item as Partial<typeof item>).resultsPublished;
  }
  return old;
}

describe("Управление статистикой с пульта", () => {
  it("меняет представление доски без пересчёта очков и возвращает прежний вид по отмене", () => {
    const round = commands(
      playing(),
      { type: "reveal", answerId: "q1-0" },
      { type: "award", teamId: "a" },
    );
    const before = structuredClone(round);
    const cloud = applyCommand(round, { type: "statistics-view", view: "cloud" });
    expect(round).toEqual(before);
    expect(cloud.revision).toBe(round.revision + 1);
    expect(cloud.events.at(-1)?.type).toBe("statistics-view");
    expect(cloud.history.at(-1)?.statisticsView).toBe("list");
    expect(publicView(cloud)).toEqual({
      ...publicView(round),
      statisticsView: "cloud",
      revision: round.revision + 1,
    });
    expect(cloud.questions).toEqual(round.questions);
    expect(cloud.teams).toEqual(round.teams);
    expect(cloud.openedAnswerIds).toEqual(round.openedAnswerIds);
    expect(cloud.roundResults).toEqual(round.roundResults);
    const self: Participant = {
      id: "player-a", gameId: round.id, teamId: "a", name: "Игрок", role: "player",
    };
    expect(teamView(cloud, self, [self]).statisticsView).toBe("cloud");
    const audience = JSON.stringify(publicView(cloud));
    for (const hidden of ["исходная личная формулировка", "секретный синоним", "Секретная заметка", "SECRET-A", "Вопрос q2?"])
      expect(audience).not.toContain(hidden);
    const restored = applyCommand(cloud, { type: "undo" });
    expect(restored.statisticsView).toBe("list");
    expect(restored.roundResults).toEqual(round.roundResults);
    expect(restored.teams).toEqual(round.teams);
  });

  it("не показывает статистику в лобби, активном раунде и перехвате, даже при старых результатах", () => {
    const later = commands(playing(), { type: "award", teamId: "a" }, { type: "next" });
    for (const game of [makeGame(), playing(), steal(), later, applyCommand(makeGame(), { type: "finish" })]) {
      expect(() => applyCommand(game, { type: "statistics-view", view: "cloud" })).toThrow(GameRuleError);
      expect(game.statisticsView).toBe("list");
    }
    const malformed = playing();
    malformed.phase = "round-result";
    expect(() => applyCommand(malformed, { type: "statistics-view", view: "cloud" })).toThrow(GameRuleError);
  });

  it("поддерживает итоги, паузу после раунда и прерванный сыгранный раунд, но отклоняет неизвестный вид", () => {
    const round = commands(playing(), { type: "award", teamId: "a" });
    const paused = applyCommand(round, { type: "pause" });
    expect(applyCommand(paused, { type: "statistics-view", view: "cloud" }).paused).toBe(true);
    for (const finished of [applyCommand(round, { type: "finish" }), applyCommand(playing(), { type: "finish" })]) {
      const changed = applyCommand(finished, { type: "statistics-view", view: "cloud" });
      expect(changed.statisticsView).toBe("cloud");
      expect(changed.teams).toEqual(finished.teams);
      expect(changed.phase).toBe("finished");
    }
    expect(() => applyCommand(round, { type: "statistics-view", view: "private-source" } as unknown as GameCommand))
      .toThrow("Выберите список или облако ответов.");
  });

  it("нормализует старые и повреждённые сохранения, включая историю, и сбрасывает вид новой попытки", () => {
    const round = commands(playing(), { type: "award", teamId: "a" });
    const cloud = applyCommand(round, { type: "statistics-view", view: "cloud" });
    expect(resetGame(cloud).statisticsView).toBe("list");
    delete round.statisticsView;
    for (const item of round.history) delete item.statisticsView;
    expect(publicView(round).statisticsView).toBe("list");
    expect(applyCommand(round, { type: "undo" }).statisticsView).toBe("list");
    const corrupted = structuredClone(cloud);
    for (const item of [corrupted, ...corrupted.history])
      (item as unknown as Record<string, unknown>).statisticsView = { secret: "private-value" };
    const normalized = normalizeGameState(corrupted);
    expect(normalized.statisticsView).toBe("list");
    expect(normalized.history.every((item) => item.statisticsView === "list")).toBe(true);
    expect(publicView(corrupted).statisticsView).toBe("list");
    expect(JSON.stringify(publicView(corrupted))).not.toContain("private-value");
  });
});
