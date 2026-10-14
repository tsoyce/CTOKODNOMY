import { randomBytes, randomUUID } from "node:crypto";
import type {
  Brand,
  GameCommand,
  GameSnapshot,
  GameState,
  Participant,
  PublicGame,
  Question,
  Rules,
  Team,
  TeamGame,
} from "../shared/types";

const HISTORY_LIMIT = 50;
const EVENT_LIMIT = 200;
const SUGGESTION_LIMIT = 100;

export class GameRuleError extends Error {
  readonly code = "GAME_RULE";
  constructor(
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
    this.name = "GameRuleError";
  }
}

export interface CreateGameInput {
  id?: string;
  title: string;
  brand: Brand;
  questions: Question[];
  teams: Array<
    Pick<Team, "name" | "color"> &
      Partial<Pick<Team, "id" | "joinCode" | "joinOpen">>
  >;
  rules?: Partial<Rules>;
}

function requireRule(
  condition: unknown,
  message: string,
  statusCode = 409,
): asserts condition {
  if (!condition) throw new GameRuleError(message, statusCode);
}

function cleanText(value: string, limit: number, label: string): string {
  requireRule(typeof value === "string", `${label}: нужен текст.`, 400);
  const text = value.trim();
  requireRule(
    text.length > 0 && text.length <= limit,
    `${label}: от 1 до ${limit} символов.`,
    400,
  );
  return text;
}

export function createGame(input: CreateGameInput): GameState {
  requireRule(
    input.teams.length === 2,
    "Для игры нужны ровно две команды.",
    400,
  );
  requireRule(input.questions.length > 0, "Добавьте хотя бы один вопрос.", 400);
  for (const question of input.questions) {
    requireRule(
      question.prompt.trim() && question.answers.length > 0,
      "У вопроса должны быть формулировка и ответы.",
      400,
    );
    requireRule(
      new Set(question.answers.map((answer) => answer.id)).size ===
        question.answers.length,
      "Идентификаторы ответов вопроса должны быть уникальными.",
      400,
    );
    for (const answer of question.answers) {
      requireRule(
        answer.id &&
          answer.text.trim() &&
          Number.isSafeInteger(answer.points) &&
          answer.points >= 0,
        "У ответа должны быть идентификатор, текст и целое неотрицательное число очков.",
        400,
      );
    }
  }
  const rules: Rules = {
    multipliers: [...(input.rules?.multipliers ?? [1, 2, 3])],
    stealAddsPoints: input.rules?.stealAddsPoints ?? true,
  };
  requireRule(
    rules.multipliers.length > 0 &&
      rules.multipliers.every(
        (value) => Number.isSafeInteger(value) && value > 0,
      ),
    "Множители должны быть положительными целыми числами.",
    400,
  );
  const teams: Team[] = input.teams.map((team) => ({
    id: team.id ?? randomUUID(),
    name: cleanText(team.name, 80, "Название команды"),
    color: team.color,
    score: 0,
    joinCode: team.joinCode ?? randomBytes(6).toString("hex").toUpperCase(),
    joinOpen: team.joinOpen ?? true,
  }));
  requireRule(
    new Set(teams.map((team) => team.id)).size === 2,
    "Идентификаторы команд должны быть различными.",
    400,
  );
  requireRule(
    teams.every((team) => team.id && team.joinCode) &&
      new Set(teams.map((team) => team.joinCode)).size === 2,
    "Коды приглашения команд должны быть непустыми и различными.",
    400,
  );
  return {
    id: input.id ?? randomUUID(),
    title: cleanText(input.title, 120, "Название игры"),
    brand: structuredClone(input.brand),
    questions: structuredClone(input.questions),
    rules,
    teams,
    questionIndex: 0,
    phase: "lobby",
    paused: false,
    activeTeamId: null,
    originTeamId: null,
    bank: 0,
    strikes: 0,
    openedAnswerIds: [],
    pendingAnswer: null,
    suggestions: [],
    revision: 0,
    events: [],
    history: [],
    createdAt: new Date().toISOString(),
  };
}

function snapshot(game: GameState): GameSnapshot {
  return structuredClone({
    teams: game.teams,
    questionIndex: game.questionIndex,
    phase: game.phase,
    paused: game.paused,
    activeTeamId: game.activeTeamId,
    originTeamId: game.originTeamId,
    bank: game.bank,
    strikes: game.strikes,
    openedAnswerIds: game.openedAnswerIds,
    pendingAnswer: game.pendingAnswer,
    suggestions: game.suggestions,
  });
}

function teamById(game: GameState, id: string | null): Team {
  const team = game.teams.find((candidate) => candidate.id === id);
  requireRule(team, "Команда не найдена.", 400);
  return team;
}

function multiplier(game: GameState): number {
  return game.rules.multipliers[
    Math.min(game.questionIndex, game.rules.multipliers.length - 1)
  ]!;
}

function clearAnswers(game: GameState): void {
  game.pendingAnswer = null;
  game.suggestions = [];
}

function requireLiveRound(game: GameState): void {
  requireRule(!game.paused, "Игра на паузе. Сначала продолжите её.");
  requireRule(
    game.phase === "playing" || game.phase === "steal",
    "Сейчас нет активного раунда.",
  );
}

function awardBank(game: GameState, teamId: string): void {
  const team = teamById(game, teamId);
  requireRule(
    Number.isSafeInteger(team.score + game.bank),
    "Счёт выходит за допустимые пределы.",
    400,
  );
  team.score += game.bank;
  game.phase = "round-result";
  game.activeTeamId = team.id;
  clearAnswers(game);
}

function beginRound(game: GameState, teamId: string): void {
  teamById(game, teamId);
  game.phase = "playing";
  game.activeTeamId = teamId;
  game.originTeamId = teamId;
  game.bank = 0;
  game.strikes = 0;
  game.openedAnswerIds = [];
  clearAnswers(game);
}

function endGame(game: GameState): void {
  game.phase = "finished";
  game.paused = false;
  clearAnswers(game);
  for (const team of game.teams) team.joinOpen = false;
}

/** Apply one accepted command without changing the supplied state. Role checks belong to the API. */
export function applyCommand(
  state: GameState,
  command: GameCommand,
): GameState {
  const game = structuredClone(state);
  let message: string;
  switch (command.type) {
    case "start": {
      requireRule(
        game.phase === "lobby" && !game.paused,
        "Начать можно только игру в лобби без паузы.",
      );
      beginRound(game, command.teamId);
      message = `Игра началась. Отвечает команда «${teamById(game, command.teamId).name}».`;
      break;
    }
    case "reveal": {
      requireLiveRound(game);
      const answer = game.questions[game.questionIndex]!.answers.find(
        (candidate) => candidate.id === command.answerId,
      );
      requireRule(answer, "Ответ не принадлежит текущему вопросу.", 400);
      requireRule(
        !game.openedAnswerIds.includes(answer.id),
        "Этот ответ уже открыт.",
      );
      game.openedAnswerIds.push(answer.id);
      if (game.phase === "playing" || game.rules.stealAddsPoints)
        game.bank += answer.points * multiplier(game);
      requireRule(
        Number.isSafeInteger(game.bank),
        "Банк выходит за допустимые пределы.",
        400,
      );
      clearAnswers(game);
      message = `Открыт ответ «${answer.text}»: ${answer.points} × ${multiplier(game)}.`;
      if (
        game.phase === "steal" ||
        game.openedAnswerIds.length ===
          game.questions[game.questionIndex]!.answers.length
      ) {
        awardBank(game, teamById(game, game.activeTeamId).id);
        message += ` Банк ${game.bank} получает команда «${teamById(game, game.activeTeamId).name}».`;
      }
      break;
    }
    case "strike": {
      requireLiveRound(game);
      clearAnswers(game);
      if (game.phase === "steal") {
        awardBank(game, teamById(game, game.originTeamId).id);
        message = `Перехват не удался. Банк ${game.bank} получает команда «${teamById(game, game.activeTeamId).name}».`;
      } else {
        game.strikes += 1;
        message = `Ошибка ${game.strikes} из 3.`;
        if (game.strikes === 3) {
          const origin = teamById(game, game.activeTeamId);
          game.originTeamId = origin.id;
          game.activeTeamId = game.teams.find(
            (team) => team.id !== origin.id,
          )!.id;
          game.phase = "steal";
          message += ` Попытка перехвата у команды «${teamById(game, game.activeTeamId).name}».`;
        }
      }
      break;
    }
    case "next": {
      requireRule(
        game.phase === "round-result" && !game.paused,
        "Следующий раунд доступен после подведения итогов без паузы.",
      );
      if (command.teamId !== undefined) teamById(game, command.teamId);
      if (game.questionIndex + 1 >= game.questions.length) {
        endGame(game);
        message = "Все раунды сыграны. Игра завершена.";
      } else {
        game.questionIndex += 1;
        beginRound(game, command.teamId ?? game.teams[0]!.id);
        message = `Начат раунд ${game.questionIndex + 1}, множитель ×${multiplier(game)}.`;
      }
      break;
    }
    case "award": {
      requireLiveRound(game);
      awardBank(game, command.teamId);
      message = `Ведущий присудил банк ${game.bank} команде «${teamById(game, command.teamId).name}».`;
      break;
    }
    case "turn": {
      requireLiveRound(game);
      requireRule(
        game.phase === "playing",
        "Во время перехвата нельзя передать ход.",
      );
      const team = teamById(game, command.teamId);
      requireRule(team.id !== game.activeTeamId, "Эта команда уже отвечает.");
      game.activeTeamId = team.id;
      game.originTeamId = team.id;
      game.strikes = 0;
      clearAnswers(game);
      message = `Ход передан команде «${team.name}». Ошибки сброшены, банк сохранён.`;
      break;
    }
    case "pause": {
      requireRule(
        game.phase !== "finished" && !game.paused,
        "Нельзя поставить эту игру на паузу.",
      );
      game.paused = true;
      message = "Игра поставлена на паузу.";
      break;
    }
    case "resume": {
      requireRule(
        game.paused && game.phase !== "finished",
        "Игра не находится на паузе.",
      );
      game.paused = false;
      message = "Игра продолжена.";
      break;
    }
    case "undo": {
      const previous = game.history.pop();
      requireRule(previous, "Нет решений ведущего для отмены.");
      Object.assign(game, structuredClone(previous));
      message = "Последнее решение ведущего отменено.";
      break;
    }
    case "finish": {
      requireRule(game.phase !== "finished", "Игра уже завершена.");
      endGame(game);
      message =
        "Ведущий завершил игру. Незачисленный банк не добавлен к общему счёту.";
      break;
    }
    case "adjust": {
      const team = teamById(game, command.teamId);
      const reason = cleanText(command.reason, 300, "Причина изменения счёта");
      requireRule(
        Number.isSafeInteger(command.delta) && command.delta !== 0,
        "Укажите целое ненулевое изменение счёта.",
        400,
      );
      requireRule(
        Number.isSafeInteger(team.score + command.delta) &&
          team.score + command.delta >= 0,
        "Общий счёт должен быть целым неотрицательным числом.",
        400,
      );
      team.score += command.delta;
      message = `Счёт команды «${team.name}» изменён на ${command.delta > 0 ? "+" : ""}${command.delta}. Причина: ${reason}`;
      break;
    }
    case "join-toggle": {
      const team = teamById(game, command.teamId);
      requireRule(
        typeof command.open === "boolean",
        "Укажите состояние входа в команду.",
        400,
      );
      requireRule(
        !command.open || game.phase !== "finished",
        "Нельзя открыть вход в завершённую игру.",
      );
      requireRule(
        team.joinOpen !== command.open,
        "Вход уже находится в этом состоянии.",
      );
      team.joinOpen = command.open;
      message = `Вход в команду «${team.name}» ${command.open ? "открыт" : "закрыт"}.`;
      break;
    }
    case "suggest":
    case "submit": {
      requireLiveRound(game);
      const team = teamById(game, command.teamId);
      requireRule(
        team.id === game.activeTeamId,
        "Сейчас отвечает другая команда.",
      );
      const text = cleanText(command.text, 200, "Ответ");
      const authorName = cleanText(command.authorName, 80, "Имя участника");
      requireRule(command.participantId, "Участник не найден.", 400);
      const answer = {
        id: randomUUID(),
        teamId: team.id,
        participantId: command.participantId,
        authorName,
        text,
        createdAt: new Date().toISOString(),
      };
      if (command.type === "submit") {
        requireRule(
          !game.pendingAnswer,
          "Один ответ уже ожидает решения ведущего.",
        );
        game.pendingAnswer = answer;
        message = `Капитан команды «${team.name}» отправил итоговый ответ.`;
      } else {
        game.suggestions.push(answer);
        game.suggestions = game.suggestions.slice(-SUGGESTION_LIMIT);
        message = `Участник команды «${team.name}» предложил ответ.`;
      }
      break;
    }
    default:
      throw new GameRuleError("Неизвестная команда.", 400);
  }
  if (
    command.type !== "undo" &&
    command.type !== "suggest" &&
    command.type !== "submit"
  ) {
    game.history.push(snapshot(state));
    game.history = game.history.slice(-HISTORY_LIMIT);
  }
  game.revision = state.revision + 1;
  game.events.push({
    id: randomUUID(),
    type: command.type,
    message,
    createdAt: new Date().toISOString(),
  });
  game.events = game.events.slice(-EVENT_LIMIT);
  return game;
}

/** An explicit allowlist prevents unplayed answers and invitation codes reaching the audience. */
export function publicView(game: GameState): PublicGame {
  const question =
    game.phase === "lobby" ? undefined : game.questions[game.questionIndex];
  return {
    id: game.id,
    title: game.title,
    brand: structuredClone(game.brand),
    teams: game.teams.map((team) => ({
      id: team.id,
      name: team.name,
      color: team.color,
      score: team.score,
    })),
    revision: game.revision,
    phase: game.phase,
    paused: game.paused,
    activeTeamId: game.activeTeamId,
    bank: game.bank,
    strikes: game.strikes,
    questionIndex: game.questionIndex,
    totalRounds: game.questions.length,
    multiplier: multiplier(game),
    prompt: question?.prompt ?? "",
    isDemo: question?.isDemo ?? false,
    answers:
      question?.answers.map((answer, index) =>
        game.openedAnswerIds.includes(answer.id)
          ? {
              position: index + 1,
              opened: true,
              text: answer.text,
              points: answer.points,
            }
          : { position: index + 1, opened: false },
      ) ?? [],
  };
}

function participantView(person: Participant): Participant {
  return {
    id: person.id,
    gameId: person.gameId,
    teamId: person.teamId,
    name: person.name,
    role: person.role,
  };
}

export function teamView(
  game: GameState,
  self: Participant,
  players: Participant[],
): TeamGame {
  requireRule(
    self.gameId === game.id &&
      game.teams.some((team) => team.id === self.teamId),
    "Участник не принадлежит этой игре.",
    403,
  );
  return {
    ...publicView(game),
    self: participantView(self),
    players: players
      .filter(
        (person) => person.gameId === game.id && person.teamId === self.teamId,
      )
      .map(participantView),
    suggestions: structuredClone(
      game.suggestions.filter((answer) => answer.teamId === self.teamId),
    ),
    pendingAnswer:
      game.pendingAnswer?.teamId === self.teamId
        ? structuredClone(game.pendingAnswer)
        : null,
  };
}
