import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createGame,
  GameRuleError,
  publicView,
  teamView,
} from "../server/game";
import { defaultBrand } from "../shared/types";
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
