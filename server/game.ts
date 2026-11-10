import { randomBytes, randomUUID } from "node:crypto";
import {
  GAME_ANSWER_LIMIT,
  MAX_QUESTION_ANSWERS,
  gameBoardAnswers,
  rankedAnswers,
} from "../shared/questionAnswers";
import { classicBoardPoints, classicPoints } from "../shared/classicPoints";
import type {
  Brand,
  ClassicState,
  GameCommand,
  GameSnapshot,
  GameState,
  Participant,
  PublicGame,
  PublicGameResults,
  PublicRoundStats,
  Question,
  RoundResult,
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
      question.answers.length <= MAX_QUESTION_ANSWERS,
      `У вопроса может быть не больше ${MAX_QUESTION_ANSWERS} ответов.`,
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
  const classicMode = input.rules?.mode === "classic";
  if (classicMode) {
    requireRule(input.questions.length === 9 || input.questions.length === 10,
      "Для классической игры выберите 9 вопросов и при желании десятый для тай-брейка.", 400);
    requireRule(new Set(input.questions.map((question) => question.id)).size === input.questions.length,
      "Вопросы классической игры должны быть разными.", 400);
  }
  const rules: Rules = {
    multipliers: classicMode ? [1, 2, 3, 1, 1, 1, 1, 1, 1, 1] : [...(input.rules?.multipliers ?? [1, 2, 3])],
    stealAddsPoints: classicMode ? true : (input.rules?.stealAddsPoints ?? true),
    ...(input.rules?.mode ? { mode: input.rules.mode } : {}),
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
    questions: structuredClone(input.questions).map((question) => ({
      ...question,
      answers: rankedAnswers(question.answers),
    })),
    boardAnswerLimit: GAME_ANSWER_LIMIT,
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
    roundResults: [],
    resultsPublished: false,
    statisticsView: "list",
    ...(classicMode ? { classic: { stage: "duel" as const, duel: null, reverse: null, final: null } } : {}),
    revision: 0,
    events: [],
    history: [],
    createdAt: new Date().toISOString(),
  };
}

function snapshot(game: GameState): GameSnapshot {
  const saved = structuredClone({
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
    roundResults: game.roundResults,
    resultsPublished: game.resultsPublished,
    statisticsView: game.statisticsView,
    ...(game.classic ? { classic: game.classic } : {}),
  });
  // In history, remember the actual remaining time at this decision. The
  // deadline itself is an absolute clock value and becomes stale after undo.
  if (saved.classic?.stage === "reverse" && saved.classic.reverse?.deadlineAt != null)
    saved.classic.reverse.remainingMs = Math.max(0, saved.classic.reverse.deadlineAt - Date.now());
  if (saved.classic?.final?.phase === "answering" && saved.classic.final.deadlineAt !== null)
    saved.classic.final.remainingMs = Math.max(0, saved.classic.final.deadlineAt - Date.now());
  return saved;
}

/** Fill legacy JSON snapshots without treating unplayed questions as results. */
export function normalizeGameState(state: GameState): GameState {
  const game = structuredClone(state);
  const previous: GameSnapshot[] = [];
  for (const old of game.history) {
    normalizeSnapshot(old, previous, game);
    previous.push(old);
  }
  normalizeSnapshot(game, previous, game);
  return game;
}

function normalizeSnapshot(
  state: GameSnapshot,
  previous: GameSnapshot[],
  game: GameState,
): void {
  if (!Array.isArray(state.roundResults)) {
    const results: RoundResult[] = [];
    const roundCount = Math.min(state.questionIndex, game.questions.length);
    for (let index = 0; index < roundCount; index += 1) {
      const witness = previous.findLast(
        (item) => item.questionIndex === index && item.phase === "round-result",
      );
      const known = previous
        .findLast((item) =>
          item.roundResults.some((result) => result.questionIndex === index),
        )
        ?.roundResults.find((result) => result.questionIndex === index);
      results.push(
        known
          ? structuredClone(known)
          : legacyResult(index, witness, game, true),
      );
    }
    if (state.questionIndex < game.questions.length) {
      if (state.phase === "round-result") {
        results.push(legacyResult(state.questionIndex, state, game, true));
      } else if (state.phase === "finished") {
        const known = previous
          .findLast((item) =>
            item.roundResults.some(
              (result) => result.questionIndex === state.questionIndex,
            ),
          )
          ?.roundResults.find(
            (result) => result.questionIndex === state.questionIndex,
          );
        const witness = previous.findLast(
          (item) => item.questionIndex === state.questionIndex,
        );
        if (known) {
          results.push(structuredClone(known));
        } else if (witness?.phase === "round-result") {
          results.push(legacyResult(state.questionIndex, witness, game, true));
        } else if (
          witness?.phase === "playing" ||
          witness?.phase === "steal" ||
          state.openedAnswerIds.length > 0 ||
          state.bank > 0
        ) {
          results.push(legacyResult(state.questionIndex, state, game, false));
        }
      }
    }
    state.roundResults = results;
  }
  state.resultsPublished =
    state.phase === "finished" && state.resultsPublished === true;
  state.statisticsView = state.statisticsView === "cloud" ? "cloud" : "list";
}

function legacyResult(
  questionIndex: number,
  state: GameSnapshot | undefined,
  game: GameState,
  completed: boolean,
): RoundResult {
  const wasAwarded = completed && state?.phase === "round-result";
  return {
    questionIndex,
    winnerTeamId: wasAwarded ? state.activeTeamId : null,
    awardedPoints: wasAwarded ? state.bank : 0,
    openedAnswerIds: [...(state?.openedAnswerIds ?? [])],
    strikes: state?.strikes ?? 0,
    multiplier: multiplierForRound(game, questionIndex),
    completed,
    // Older snapshots did not record completion times.
    completedAt: "",
  };
}

function teamById(game: GameState, id: string | null): Team {
  const team = game.teams.find((candidate) => candidate.id === id);
  requireRule(team, "Команда не найдена.", 400);
  return team;
}

function multiplier(game: GameState): number {
  return multiplierForRound(game, game.questionIndex);
}

function multiplierForRound(game: GameState, questionIndex: number): number {
  return game.rules.multipliers[
    Math.min(questionIndex, game.rules.multipliers.length - 1)
  ]!;
}

function recordRound(
  game: GameState,
  winnerTeamId: string | null,
  awardedPoints: number,
  completed: boolean,
  teamAwards?: Array<{ teamId: string; points: number }> | null,
): void {
  const result: RoundResult = {
    questionIndex: game.questionIndex,
    winnerTeamId,
    awardedPoints,
    ...(teamAwards !== undefined ? { teamAwards: structuredClone(teamAwards) } : {}),
    openedAnswerIds: [...game.openedAnswerIds],
    strikes: game.strikes,
    multiplier: multiplier(game),
    completed,
    completedAt: new Date().toISOString(),
  };
  game.roundResults = game.roundResults.filter(
    (item) => item.questionIndex !== game.questionIndex,
  );
  game.roundResults.push(result);
  game.roundResults.sort(
    (left, right) => left.questionIndex - right.questionIndex,
  );
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
  recordRound(game, team.id, game.bank, true);
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

function beginDuel(game: GameState, tieBreak = false): void {
  requireRule(game.classic, "Классический режим недоступен.");
  game.classic.stage = tieBreak ? "tiebreak" : "duel";
  game.classic.activePlayerIndex = null;
  game.classic.duel = { firstTeamId: null, awaitingTeamId: null, firstAnswerPosition: null, attempts: 0,
    playerIndex: tieBreak ? 1 : (game.questionIndex % 5) + 1 };
  game.classic.reverse = null;
  game.phase = "playing";
  game.activeTeamId = null;
  game.originTeamId = null;
  game.bank = 0;
  game.strikes = 0;
  game.openedAnswerIds = [];
  clearAnswers(game);
}

function beginClassicFinal(game: GameState, teamId: string): void {
  const classic = game.classic!;
  teamById(game, teamId);
  classic.stage = "final";
  classic.activePlayerIndex = null;
  classic.duel = null;
  classic.reverse = null;
  classic.final = {
    teamId, player: 1, phase: "ready", deadlineAt: null, remainingMs: null,
    entries: [Array(5).fill(null), Array(5).fill(null)], score: 0,
  };
  game.questionIndex = 4;
  game.phase = "playing";
  game.activeTeamId = teamId;
  game.originTeamId = teamId;
  game.openedAnswerIds = [];
  game.bank = 0;
  game.strikes = 0;
  clearAnswers(game);
}

function otherTeamId(game: GameState, teamId: string): string {
  teamById(game, teamId);
  return game.teams.find((team) => team.id !== teamId)!.id;
}

/** Resolve a face-off without counting its misses as round strikes. */
function classicDuelAttempt(game: GameState, answerPosition: number | null): void {
  const classic = game.classic!;
  const duel = classic.duel!;
  const responding = duel.awaitingTeamId;
  requireRule(responding, "Дождитесь нажатия кнопки одной из команд.");
  if (classic.stage === "tiebreak") {
    if (answerPosition !== null) beginClassicFinal(game, responding);
    else {
      duel.awaitingTeamId = otherTeamId(game, responding);
      game.activeTeamId = duel.awaitingTeamId;
    }
    return;
  }
  duel.attempts += 1;
  if (duel.attempts === 1) {
    duel.firstTeamId = responding;
    duel.firstAnswerPosition = answerPosition;
    if (answerPosition === 0) {
      classic.stage = "play";
      classic.activePlayerIndex = ((duel.playerIndex ?? 1) % 5) + 1;
      game.activeTeamId = responding;
      game.originTeamId = responding;
      duel.awaitingTeamId = null;
    } else {
      duel.awaitingTeamId = otherTeamId(game, responding);
      game.activeTeamId = duel.awaitingTeamId;
    }
    return;
  }
  if (duel.firstAnswerPosition === null && answerPosition === null) {
    // Both missed: subsequent players alternate until any valid answer.
    if (duel.attempts % 2 === 0) duel.playerIndex = ((duel.playerIndex ?? 1) % 5) + 1;
    duel.awaitingTeamId = otherTeamId(game, responding);
    game.activeTeamId = duel.awaitingTeamId;
    return;
  }
  const winner = duel.firstAnswerPosition === null ||
      (answerPosition !== null && answerPosition < duel.firstAnswerPosition)
    ? responding : duel.firstTeamId!;
  classic.stage = "play";
  classic.activePlayerIndex = ((duel.playerIndex ?? 1) % 5) + 1;
  duel.awaitingTeamId = null;
  game.activeTeamId = winner;
  game.originTeamId = winner;
}

function classicReverseAttempt(game: GameState, answerPosition: number | null): void {
  const classic = game.classic!;
  const reverse = classic.reverse!;
  const team = teamById(game, game.activeTeamId);
  if (!reverse.awards && reverse.attempts === 0) reverse.awards = [];
  if (answerPosition !== null) {
    const amount = [15, 30, 60, 120, 180, 240][answerPosition]!;
    requireRule(Number.isSafeInteger(team.score + amount), "Счёт выходит за допустимые пределы.", 400);
    team.score += amount;
    reverse.awards?.push({ teamId: team.id, points: amount });
  }
  reverse.attempts += 1;
  clearAnswers(game);
  if (reverse.attempts === 1) {
    game.activeTeamId = otherTeamId(game, team.id);
    reverse.deadlineAt = Date.now() + 20_000;
    reverse.remainingMs = null;
  }
  else {
    reverse.deadlineAt = null;
    reverse.remainingMs = null;
    recordRound(game, null, 0, true, reverse.awards ?? null);
    game.phase = "round-result";
    game.activeTeamId = null;
  }
}

function endGame(game: GameState): void {
  if ((game.phase === "playing" || game.phase === "steal") &&
    game.classic?.stage !== "final" && game.classic?.stage !== "tiebreak")
    recordRound(game, null, 0, false);
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
  const normalized = normalizeGameState(state);
  const game = structuredClone(normalized);
  let message: string;
  switch (command.type) {
    case "start": {
      requireRule(
        game.phase === "lobby" && !game.paused,
        "Начать можно только игру в лобби без паузы.",
      );
      teamById(game, command.teamId);
      if (game.classic) {
        beginDuel(game);
        message = "Игра началась. Команды разыгрывают право хода.";
      } else {
        beginRound(game, command.teamId);
        message = `Игра началась. Отвечает команда «${teamById(game, command.teamId).name}».`;
      }
      break;
    }
    case "reveal": {
      requireLiveRound(game);
      requireRule(game.classic?.stage !== "final", "Финальные ответы проверяются отдельно.");
      const question = game.questions[game.questionIndex]!;
      const board = gameBoardAnswers(game, question);
      const answer = question.answers.find(
        (candidate) => candidate.id === command.answerId,
      );
      requireRule(answer, "Ответ не принадлежит текущему вопросу.", 400);
      requireRule(
        board.some((candidate) => candidate.id === answer.id),
        "Этот ответ не входит в игровое табло.",
        400,
      );
      requireRule(
        !game.openedAnswerIds.includes(answer.id),
        "Этот ответ уже открыт.",
      );
      const position = board.findIndex((candidate) => candidate.id === answer.id);
      if (game.classic?.stage === "duel" || game.classic?.stage === "tiebreak") {
        requireRule(game.classic.duel?.awaitingTeamId, "Дождитесь нажатия кнопки одной из команд.");
        if (game.classic.stage === "duel") {
          game.openedAnswerIds.push(answer.id);
          game.bank += classicBoardPoints(question.answers)[position]! * multiplier(game);
        }
        classicDuelAttempt(game, position);
        if ((game.classic as ClassicState).stage === "play" && board.every((candidate) => game.openedAnswerIds.includes(candidate.id)))
          awardBank(game, teamById(game, game.activeTeamId).id);
        message = "Ответ на дуэли открыт.";
        break;
      }
      if (game.classic?.stage === "reverse") {
        requireRule(game.classic.reverse?.deadlineAt == null || Date.now() <= game.classic.reverse.deadlineAt,
          "Время команды вышло. Отметьте ошибку, чтобы продолжить.");
        game.openedAnswerIds.push(answer.id);
        classicReverseAttempt(game, position);
        message = "Ответ в игре наоборот открыт.";
        break;
      }
      game.openedAnswerIds.push(answer.id);
      const answerWeight = game.classic ? classicBoardPoints(question.answers)[position]! : answer.points;
      const addsPoints = game.phase === "playing" || game.rules.stealAddsPoints;
      if (addsPoints)
        game.bank += answerWeight * multiplier(game);
      requireRule(
        Number.isSafeInteger(game.bank),
        "Банк выходит за допустимые пределы.",
        400,
      );
      clearAnswers(game);
      if (game.classic?.stage === "play" && game.phase === "playing")
        game.classic.activePlayerIndex = ((game.classic.activePlayerIndex ?? 1) % 5) + 1;
      message = addsPoints
        ? `Открыт ответ «${answer.text}»: ${answerWeight} × ${multiplier(game)}.`
        : `Открыт ответ «${answer.text}»: перехват без дополнительных очков.`;
      if (
        game.phase === "steal" ||
        board.every((candidate) => game.openedAnswerIds.includes(candidate.id))
      ) {
        awardBank(game, teamById(game, game.activeTeamId).id);
        message += ` Банк ${game.bank} получает команда «${teamById(game, game.activeTeamId).name}».`;
      }
      break;
    }
    case "strike": {
      requireLiveRound(game);
      requireRule(game.classic?.stage !== "final", "Финальные ответы проверяются отдельно.");
      clearAnswers(game);
      if (game.classic?.stage === "duel" || game.classic?.stage === "tiebreak") {
        requireRule(game.classic.duel?.awaitingTeamId, "Дождитесь нажатия кнопки одной из команд.");
        classicDuelAttempt(game, null);
        message = "Ответ на дуэли не найден.";
      } else if (game.classic?.stage === "reverse") {
        classicReverseAttempt(game, null);
        message = "Ответ в игре наоборот не найден.";
      } else if (game.phase === "steal") {
        awardBank(game, teamById(game, game.originTeamId).id);
        message = `Перехват не удался. Банк ${game.bank} получает команда «${teamById(game, game.activeTeamId).name}».`;
      } else {
        game.strikes += 1;
        if (game.classic?.stage === "play")
          game.classic.activePlayerIndex = ((game.classic.activePlayerIndex ?? 1) % 5) + 1;
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
      if (game.classic && game.questionIndex < 3) {
        game.questionIndex += 1;
        if (game.questionIndex < 3) {
          beginDuel(game);
          message = `Раунд ${game.questionIndex + 1}: розыгрыш права хода.`;
        } else {
          const [first, second] = game.teams;
          const firstId = first!.score === second!.score
            ? command.teamId
            : first!.score < second!.score ? first!.id : second!.id;
          requireRule(firstId, "При равном счёте выберите первую команду для игры наоборот.", 400);
          beginRound(game, firstId);
          game.classic.stage = "reverse";
          game.classic.activePlayerIndex = null;
          game.classic.duel = null;
          game.classic.reverse = { firstTeamId: firstId, attempts: 0, deadlineAt: Date.now() + 20_000, remainingMs: null, awards: [] };
          message = "Началась игра наоборот.";
        }
      } else if (game.classic && game.questionIndex === 3) {
        const [first, second] = game.teams;
        if (first!.score === second!.score) {
          if (game.questions.length === 10) {
            game.questionIndex = 9;
            beginDuel(game, true);
            message = "Ничья. Начался тай-брейк.";
          } else {
            game.classic.stage = "tiebreak";
            game.classic.duel = null;
            game.phase = "playing";
            game.activeTeamId = null;
            message = "Ничья. Проведите дополнительный вопрос и укажите победителя.";
          }
        } else {
          beginClassicFinal(game, first!.score > second!.score ? first!.id : second!.id);
          message = "Команда определена. Подготовка большого финала.";
        }
      } else if (game.questionIndex + 1 >= game.questions.length) {
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
      requireRule(!game.classic || game.classic.stage === "play", "В этой стадии нельзя вручную присудить банк.");
      awardBank(game, command.teamId);
      message = `Ведущий присудил банк ${game.bank} команде «${teamById(game, command.teamId).name}».`;
      break;
    }
    case "turn": {
      requireLiveRound(game);
      requireRule(!game.classic || game.classic.stage === "play", "В этой стадии нельзя передать ход вручную.");
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
    case "rename-team": {
      const team = teamById(game, command.teamId);
      const name = cleanText(command.name, 80, "Название команды");
      const previousName = team.name;
      requireRule(name !== previousName, "Название команды не изменилось.", 400);
      team.name = name;
      // Rename is a durable setting, not a round decision. Keep earlier undo
      // snapshots in sync so undoing a score or strike cannot restore an old name.
      for (const item of game.history) {
        const savedTeam = item.teams.find((candidate) => candidate.id === team.id);
        if (savedTeam) savedTeam.name = name;
      }
      message = `Команда «${previousName}» переименована в «${name}».`;
      break;
    }
    case "pause": {
      requireRule(
        game.phase !== "finished" && !game.paused,
        "Нельзя поставить эту игру на паузу.",
      );
      game.paused = true;
      if (game.classic?.final?.phase === "answering" && game.classic.final.deadlineAt !== null) {
        game.classic.final.remainingMs = Math.max(0, game.classic.final.deadlineAt - Date.now());
        game.classic.final.deadlineAt = null;
      }
      if (game.classic?.stage === "reverse" && game.phase === "playing" && game.classic.reverse?.deadlineAt != null) {
        game.classic.reverse.remainingMs = Math.max(0, game.classic.reverse.deadlineAt - Date.now());
        game.classic.reverse.deadlineAt = null;
      }
      message = "Игра поставлена на паузу.";
      break;
    }
    case "resume": {
      requireRule(
        game.paused && game.phase !== "finished",
        "Игра не находится на паузе.",
      );
      game.paused = false;
      if (game.classic?.final?.phase === "answering" && game.classic.final.remainingMs !== null) {
        game.classic.final.deadlineAt = Date.now() + game.classic.final.remainingMs;
        game.classic.final.remainingMs = null;
      }
      if (game.classic?.stage === "reverse" && game.phase === "playing" && game.classic.reverse?.remainingMs != null) {
        game.classic.reverse.deadlineAt = Date.now() + game.classic.reverse.remainingMs;
        game.classic.reverse.remainingMs = null;
      }
      message = "Игра продолжена.";
      break;
    }
    case "undo": {
      const previous = game.history.pop();
      requireRule(previous, "Нет решений ведущего для отмены.");
      const currentClassic = game.classic;
      const restoreReverse = previous.classic?.stage === "reverse" ? previous.classic.reverse : null;
      const currentReverse = currentClassic?.stage === "reverse" ? currentClassic.reverse : null;
      if (!previous.paused && restoreReverse?.deadlineAt != null && restoreReverse.remainingMs != null) {
        let remaining = restoreReverse.remainingMs;
        if (currentReverse && currentReverse.attempts === restoreReverse.attempts) {
          const currentRemaining = currentReverse.deadlineAt != null
            ? Math.max(0, currentReverse.deadlineAt - Date.now()) : currentReverse.remainingMs;
          if (currentRemaining != null) remaining = Math.min(remaining, currentRemaining);
        }
        restoreReverse.deadlineAt = Date.now() + remaining;
        restoreReverse.remainingMs = null;
      }
      const restoreFinal = previous.classic?.final;
      const currentFinal = currentClassic?.final;
      if (!previous.paused && restoreFinal?.phase === "answering" && restoreFinal.deadlineAt !== null && restoreFinal.remainingMs !== null) {
        let remaining = restoreFinal.remainingMs;
        if (currentFinal && currentFinal.player === restoreFinal.player && currentFinal.phase === "answering") {
          const currentRemaining = currentFinal.deadlineAt !== null
            ? Math.max(0, currentFinal.deadlineAt - Date.now()) : currentFinal.remainingMs;
          if (currentRemaining !== null) remaining = Math.min(remaining, currentRemaining);
        }
        restoreFinal.deadlineAt = Date.now() + remaining;
        restoreFinal.remainingMs = null;
      }
      const published = game.resultsPublished;
      Object.assign(game, structuredClone(previous));
      // Publication is a separate choice: undoing a score adjustment must
      // never expose a report which the organizer explicitly hid.
      game.resultsPublished = game.phase === "finished" && published;
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
    case "statistics-view": {
      requireRule(
        command.view === "list" || command.view === "cloud",
        "Выберите список или облако ответов.",
        400,
      );
      requireRule(
        (game.phase === "round-result" &&
          game.roundResults.some(
            (result) => result.questionIndex === game.questionIndex && result.completed,
          )) ||
          (game.phase === "finished" && game.roundResults.length > 0),
        "Вид статистики можно изменить после сыгранного раунда.",
      );
      game.statisticsView = command.view;
      message = command.view === "cloud"
        ? "На доске показано облако ответов."
        : "На доске показан список ответов.";
      break;
    }
    case "classic-buzz": {
      requireLiveRound(game);
      const classic = game.classic;
      requireRule(classic && (classic.stage === "duel" || classic.stage === "tiebreak") && classic.duel,
        "Сейчас нет розыгрыша кнопки.");
      teamById(game, command.teamId);
      requireRule(classic.duel.firstTeamId === null && classic.duel.awaitingTeamId === null,
        "Кнопка уже нажата.");
      classic.duel.firstTeamId = command.teamId;
      classic.duel.awaitingTeamId = command.teamId;
      game.activeTeamId = command.teamId;
      message = `Первой нажала команда «${teamById(game, command.teamId).name}».`;
      break;
    }
    case "classic-tiebreak-winner": {
      requireLiveRound(game);
      requireRule(game.classic?.stage === "tiebreak" && game.classic.duel === null,
        "Ручной выбор доступен только при ничьей без вопроса для тай-брейка.");
      beginClassicFinal(game, command.teamId);
      message = `В финал прошла команда «${teamById(game, command.teamId).name}».`;
      break;
    }
    case "classic-final-start": {
      requireLiveRound(game);
      const final = game.classic?.final;
      requireRule(game.classic?.stage === "final" && final?.phase === "ready", "Финалист не готов к старту.");
      final.phase = "answering";
      final.attemptId = randomUUID();
      final.deadlineAt = Date.now() + (final.player === 1 ? 15_000 : 20_000);
      final.remainingMs = null;
      message = `Начался этап финалиста ${final.player}.`;
      break;
    }
    case "classic-final-stop": {
      requireLiveRound(game);
      const final = game.classic?.final;
      requireRule(game.classic?.stage === "final" && final?.phase === "answering", "Сейчас таймер финала не идёт.");
      final.phase = "review";
      final.deadlineAt = null;
      final.remainingMs = null;
      message = `Ответы финалиста ${final.player} готовы к проверке.`;
      break;
    }
    case "classic-final-repeat": {
      requireLiveRound(game);
      const final = game.classic?.final;
      requireRule(game.classic?.stage === "final" && final?.player === 2 &&
        (final.phase === "answering" || final.phase === "review"),
        "Сигнал повтора доступен только во время ответа второго финалиста.");
      message = "Повтор ответа в финале.";
      break;
    }
    case "classic-final-answer": {
      requireLiveRound(game);
      const final = game.classic?.final;
      requireRule(game.classic?.stage === "final" && final && (final.phase === "answering" || final.phase === "review"),
        "Ответы доступны только во время финала или проверки.");
      requireRule(final.phase !== "answering" || (final.deadlineAt !== null && Date.now() <= final.deadlineAt),
        "Время вышло. Остановите таймер и проверьте ответы.");
      requireRule(Number.isInteger(command.questionIndex) && command.questionIndex >= 0 && command.questionIndex < 5,
        "В финале пять вопросов.", 400);
      const text = cleanText(command.text, 200, "Ответ");
      const question = game.questions[4 + command.questionIndex]!;
      const index = command.answerId ? question.answers.findIndex((answer) => answer.id === command.answerId) : -1;
      requireRule(!command.answerId || index >= 0, "Ответ не принадлежит вопросу финала.", 400);
      if (final.player === 2) {
        const first = final.entries[0][command.questionIndex];
        const normalizedText = (s: string) => s.trim().toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/\s+/g, " ");
        const pass = ["пас", "пропуск"].includes(normalizedText(text));
        requireRule(!first || pass ||
          (normalizedText(first.text) !== normalizedText(text) && (!command.answerId || command.answerId !== first.answerId)),
          "Ответ повторяет ответ первого финалиста. Назовите другой вариант.");
      }
      final.entries[final.player - 1]![command.questionIndex] = {
        text, answerId: command.answerId ?? null,
        points: index >= 0 ? classicPoints(question.answers)[index]! : 0,
      };
      final.score = final.entries.flat().reduce((sum, entry) => sum + (entry?.points ?? 0), 0);
      message = `Обновлён ответ финалиста ${final.player} на вопрос ${command.questionIndex + 1}.`;
      break;
    }
    case "classic-final-next": {
      requireLiveRound(game);
      const final = game.classic?.final;
      requireRule(game.classic?.stage === "final" && final?.phase === "review", "Сначала остановите таймер и проверьте ответы.");
      if (final.player === 1) {
        final.player = 2;
        final.phase = "ready";
        message = "Первый финалист закончил. Пригласите второго.";
      } else {
        final.phase = "complete";
        game.phase = "round-result";
        endGame(game);
        message = final.score >= 200 ? `Большая игра завершена: ${final.score} очков, суперприз!` : `Большая игра завершена: ${final.score} очков.`;
      }
      break;
    }
    case "suggest":
    case "submit": {
      requireLiveRound(game);
      requireRule(!game.classic || game.classic.stage === "reverse" ||
        (game.classic.stage === "play" && game.phase === "steal"),
        "В классическом раунде игроки отвечают по очереди без совещания.");
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
    command.type !== "rename-team" &&
    command.type !== "suggest" &&
    command.type !== "submit"
  ) {
    game.history.push(snapshot(normalized));
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
  game = normalizeGameState(game);
  const result = game.roundResults.find(
    (item) => item.questionIndex === game.questionIndex,
  );
  const question =
    game.phase === "lobby" || game.classic?.stage === "final" || (game.phase === "finished" && !result)
      ? undefined
      : game.questions[game.questionIndex];
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
    lastAction: game.events.at(-1)?.type === "reveal" ? "reveal"
      : game.events.at(-1)?.type === "strike" ? "strike"
      : game.events.at(-1)?.type === "classic-final-repeat" ? "repeat" : null,
    ...(game.events.at(-1) ? { lastActionEventId: game.events.at(-1)!.id } : {}),
    phase: game.phase,
    paused: game.paused,
    activeTeamId: game.activeTeamId,
    bank: game.bank,
    strikes: game.strikes,
    questionIndex: game.questionIndex,
    totalRounds: game.classic ? 5 : game.questions.length,
    multiplier: multiplier(game),
    prompt: question?.prompt ?? "",
    isDemo: question?.isDemo ?? false,
    roundStats:
      result?.completed &&
      (game.phase === "round-result" || game.phase === "finished")
        ? roundStats(game, result)
        : null,
    resultsAvailable: game.phase === "finished" && game.resultsPublished,
    statisticsView: game.statisticsView ?? "list",
    ...(game.classic ? { classic: {
      stage: game.classic.stage,
      activePlayerIndex: game.classic.activePlayerIndex ?? null,
      duel: structuredClone(game.classic.duel),
      reverse: structuredClone(game.classic.reverse),
      final: game.classic.final ? (({ teamId, player, phase, deadlineAt, remainingMs, score }) =>
        ({ teamId, player, phase, deadlineAt, remainingMs, score }))(game.classic.final) : null,
    } } : {}),
    answers:
      (question ? gameBoardAnswers(game, question) : []).map((answer, index) =>
        (game.openedAnswerIds.includes(answer.id) || (game.classic && game.phase === "round-result"))
          ? {
              position: index + 1,
              opened: true,
              text: answer.text,
              points: game.classic?.stage === "reverse"
                ? [15, 30, 60, 120, 180, 240][index]!
                : game.classic ? classicBoardPoints(question!.answers)[index]! : answer.points,
            }
          : { position: index + 1, opened: false },
      ),
  };
}

function roundStats(game: GameState, result: RoundResult): PublicRoundStats {
  const question = game.questions[result.questionIndex]!;
  const board = gameBoardAnswers(game, question);
  const boardIds = new Set(board.map((answer) => answer.id));
  const totalPoints = question.answers.reduce(
    (sum, answer) => sum + answer.points,
    0,
  );
  return {
    questionId: question.id,
    questionIndex: result.questionIndex,
    prompt: question.prompt,
    source: question.source,
    surveyDate: question.surveyDate,
    respondentCount: question.respondentCount,
    isDemo: question.isDemo,
    boardAnswerCount: board.length,
    answers: question.answers.map((answer, index) => ({
      position: index + 1,
      text: answer.text,
      points: answer.points,
      opened: boardIds.has(answer.id) && result.openedAnswerIds.includes(answer.id),
      onBoard: boardIds.has(answer.id),
      share: totalPoints > 0 ? (answer.points / totalPoints) * 100 : 0,
    })),
    totalPoints,
    multiplier: result.multiplier,
    winnerTeamId: result.winnerTeamId,
    awardedPoints: result.awardedPoints,
    ...(result.teamAwards !== undefined ? { teamAwards: structuredClone(result.teamAwards) } : {}),
    strikes: result.strikes,
    completed: result.completed,
    completedAt: result.completedAt,
  };
}

/** The API decides whether this finished game's allowlisted results are public. */
export function gameResults(state: GameState): PublicGameResults {
  const game = normalizeGameState(state);
  requireRule(
    game.phase === "finished",
    "Статистика всей игры доступна после завершения.",
  );
  const final = game.classic?.final;
  return {
    id: game.id,
    title: game.title,
    brand: structuredClone(game.brand),
    teams: game.teams.map(({ id, name, color, score }) => ({
      id,
      name,
      color,
      score,
    })),
    revision: game.revision,
    createdAt: game.createdAt,
    published: game.resultsPublished,
    rounds: game.roundResults.map((result) => roundStats(game, result)),
    ...(final?.phase === "complete" ? {
      classicFinal: {
        teamId: final.teamId,
        score: final.score,
        superPrize: final.score >= 200,
        questions: game.questions.slice(4, 9).map((question, questionIndex) => {
          const total = question.answers.reduce((sum, answer) => sum + answer.points, 0);
          return {
            questionId: question.id,
            questionIndex,
            prompt: question.prompt,
            source: question.source,
            surveyDate: question.surveyDate,
            respondentCount: question.respondentCount,
            isDemo: question.isDemo,
            answers: question.answers.map((answer, index) => ({
              position: index + 1,
              text: answer.text,
              points: answer.points,
              share: total > 0 ? answer.points / total * 100 : 0,
            })),
          };
        }),
      },
    } : {}),
    totalRounds: game.classic ? 5 : game.questions.length,
    ...(game.classic ? { completedRounds: game.roundResults.filter((round) => round.completed).length +
      (game.classic.final?.phase === "complete" ? 1 : 0) } : {}),
  };
}

/** Start the same prepared game afresh; the API invalidates old player sessions. */
export function resetGame(state: GameState, brand = state.brand): GameState {
  const game = createGame({
    id: state.id,
    title: state.title,
    brand,
    questions: state.questions,
    rules: state.rules,
    teams: state.teams.map(({ id, name, color }) => ({ id, name, color })),
  });
  const allocatedCodes = new Set(state.teams.map((team) => team.joinCode));
  for (const team of game.teams) {
    while (allocatedCodes.has(team.joinCode))
      team.joinCode = randomBytes(6).toString("hex").toUpperCase();
    allocatedCodes.add(team.joinCode);
  }
  game.revision = state.revision + 1;
  game.createdAt = state.createdAt;
  return game;
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
