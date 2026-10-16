import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Cloud,
  Copy,
  Crown,
  ExternalLink,
  Flag,
  Keyboard,
  List,
  Monitor,
  Pause,
  Play,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Trophy,
  Undo2,
  Users,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { gameBoardAnswers } from "../../shared/questionAnswers";
import type {
  HostCommand,
  HostGame,
} from "../../shared/types";
import { api, ApiError, brandStyle, useAppearance, useLiveGame } from "../lib";
import { ErrorMessage, Loading } from "../components/Common";
import { ThemeToggle } from "../components/ThemeToggle";
import { isLightBrand } from "../theme";
import "./Game.css";
import "./Host.css";

import { Connection, GameUnavailable, TeamScores, Strikes, phases } from "../components/GameCommon";
type HostAttempt = {
  signature: string;
  requestId: string;
  revision: number;
  command: HostCommand;
};
function Invitation({ code, teamName }: { code: string; teamName: string }) {
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const url = `${location.origin}/join?code=${encodeURIComponent(code)}`;
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(url, {
      margin: 2,
      width: 180,
      color: { dark: "#111222", light: "#ffffff" },
    })
      .then((value) => {
        if (active) setQr(value);
      })
      .catch(() => {
        if (active) setQr("");
      });
    return () => {
      active = false;
    };
  }, [url]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setCopyError("");
    } catch {
      setCopyError(
        "Копирование недоступно. Выделите ссылку и скопируйте вручную.",
      );
    }
  }
  return (
    <div className="invitation">
      <div>
        <span className="muted">Код команды</span>
        <strong className="invite-code">{code}</strong>
        <button className="button ghost small" onClick={() => void copy()}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Ссылка скопирована" : "Скопировать приглашение"}
        </button>
        <a
          className="invite-link"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {url}
        </a>
        {copyError && <p className="form-hint">{copyError}</p>}
      </div>
      {qr && (
        <img
          src={qr}
          className="invite-qr"
          alt={`QR-код приглашения в команду ${teamName}`}
        />
      )}
    </div>
  );
}

export function HostPage() {
  const { resolveAppearance } = useAppearance();
  const { gameId } = useParams();
  const { game, loading, error, connected, refresh } = useLiveGame<HostGame>(
    gameId,
    "host",
  );
  const [busy, setBusy] = useState(false);
  const [commandError, setCommandError] = useState("");
  const [notice, setNotice] = useState("");
  const [firstTeamId, setFirstTeamId] = useState("");
  const [adjustTeamId, setAdjustTeamId] = useState("");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState<HostCommand | null>(null);
  const [shortcutsEnabled, setShortcutsEnabled] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const lastAttempt = useRef<HostAttempt | null>(null);
  const operationInFlight = useRef(false);
  const shortcutAction = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    if (!shortcutsEnabled) return;
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey ||
        document.querySelector('[role="dialog"], dialog[open]') ||
        (event.target instanceof Element && event.target.closest(
          'input, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
        ))
      ) return;
      shortcutAction.current(event);
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [shortcutsEnabled]);
  useEffect(() => {
    if (game) {
      setFirstTeamId((previous) => previous || game.teams[0]?.id || "");
      setAdjustTeamId((previous) => previous || game.teams[0]?.id || "");
    }
  }, [game?.id]);
  useEffect(() => {
    if (!confirmation) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setConfirmation(null);
      }
      if (event.key !== "Tab") return;
      const buttons = [
        ...(dialogRef.current?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ) ?? []),
      ];
      const first = buttons[0];
      const last = buttons.at(-1);
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [confirmation]);
  shortcutAction.current = () => {};
  if (loading) return <Loading />;
  if (!game)
    return (
      <GameUnavailable error={error} refresh={refresh}>
        <Link
          className="text-link"
          to={`/login?returnTo=${encodeURIComponent(`/host/${gameId}`)}`}
        >
          Войти ведущему <ArrowRight size={16} />
        </Link>
      </GameUnavailable>
    );
  const question = game.questions[game.questionIndex];
  const currentBoardAnswers = question ? gameBoardAnswers(game, question) : [];
  const boardAnswerIds = new Set(currentBoardAnswers.map((answer) => answer.id));
  const statisticsOnlyAnswers = question?.answers.filter((answer) => !boardAnswerIds.has(answer.id)) ?? [];
  const multiplier =
    game.rules.multipliers[game.questionIndex] ??
    game.rules.multipliers.at(-1) ??
    1;
  const roundLive =
    (game.phase === "playing" || game.phase === "steal") && !game.paused;
  const disabled = busy || !connected || !!error;
  const activeTeam = game.teams.find((team) => team.id === game.activeTeamId);
  const displayBrand = resolveAppearance(game.brand);
  const showStatisticsControls =
    game.phase === "round-result" &&
    game.roundResults.some((round) => round.questionIndex === game.questionIndex && round.completed);
  const nextStep = !connected || error
    ? "Ждём подключения. Управление станет доступно, когда связь восстановится."
    : game.paused
      ? "Игра на паузе. Продолжите её, чтобы принимать ответы."
      : game.phase === "lobby"
        ? "Выберите первую команду и начните игру. Вопрос появится на общей доске."
        : game.phase === "round-result"
          ? game.questionIndex + 1 >= game.questions.length
            ? "Последний раунд завершён. Обсудите ответы и перейдите к итогам."
            : "Обсудите все ответы с гостями, затем начните следующий раунд."
          : game.phase === "finished"
            ? "Игра завершена. Проверьте итоги и откройте их для гостей."
            : game.phase === "steal"
              ? `${activeTeam?.name ?? "Команда"} перехватывает банк: откройте совпавший ответ или отметьте неудачу.`
              : game.pendingAnswer
                ? "Капитан отправил ответ. Откройте совпавший вариант или отметьте ошибку."
                : "Выслушайте команду. Откройте совпавший вариант или отметьте ошибку.";
  shortcutAction.current = (event) => {
    if (disabled || operationInFlight.current || confirmation) return;
    if ((event.code === "KeyP" || event.key.toLowerCase() === "p") && game.phase !== "finished") {
      event.preventDefault();
      void command({ type: game.paused ? "resume" : "pause" });
      return;
    }
    if (game.paused) return;
    if ((event.code === "KeyU" || event.key.toLowerCase() === "u") && game.history.length) {
      event.preventDefault();
      setConfirmation({ type: "undo" });
      return;
    }
    if (!roundLive || !/^[1-6]$/.test(event.key)) return;
    const answer = currentBoardAnswers[Number(event.key) - 1];
    if (!answer || game.openedAnswerIds.includes(answer.id)) return;
    event.preventDefault();
    void command({ type: "reveal", answerId: answer.id });
  };
  async function command(next: HostCommand) {
    if (!game || operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true);
    setCommandError("");
    setNotice("");
    setConfirmation(null);
    const signature = JSON.stringify(next);
    const attempt: HostAttempt =
      lastAttempt.current?.signature === signature
        ? lastAttempt.current
        : {
            signature,
            command: next,
            requestId: crypto.randomUUID(),
            revision: game.revision,
          };
    lastAttempt.current = attempt;
    try {
      await api<HostGame>(`/games/${game.id}/commands`, {
        method: "POST",
        body: JSON.stringify({
          requestId: attempt.requestId,
          revision: attempt.revision,
          command: attempt.command,
        }),
      });
      lastAttempt.current = null;
      await refresh();
      setNotice("Решение сохранено. Экраны обновляются.");
    } catch (err) {
      if (err instanceof ApiError && err.status < 500)
        lastAttempt.current = null;
      await refresh();
      setCommandError(
        err instanceof ApiError && err.status === 409
          ? "Другой экран уже изменил игру. Состояние обновлено: проверьте его перед повторным действием."
          : err instanceof Error
            ? err.message
            : "Не удалось подтвердить действие. Проверьте журнал перед повторной попыткой.",
      );
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  }
  async function makeCaptain(participantId: string) {
    if (!game || operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true);
    setCommandError("");
    setNotice("");
    try {
      await api<HostGame>(`/games/${game.id}/captain`, {
        method: "POST",
        body: JSON.stringify({ participantId }),
      });
      await refresh();
      setNotice("Капитан назначен. Роль на телефонах обновляется.");
    } catch (err) {
      setCommandError(
        err instanceof Error ? err.message : "Не удалось назначить капитана.",
      );
      await refresh();
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  }
  async function publishResults() {
    if (!game || operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true);
    setCommandError("");
    setNotice("");
    try {
      await api<HostGame>(`/games/${game.id}/results/publication`, {
        method: "POST",
        body: JSON.stringify({
          published: !game.resultsPublished,
          revision: game.revision,
        }),
      });
      await refresh();
      setNotice(
        game.resultsPublished
          ? "Итоги скрыты. Общая ссылка больше не открывается для гостей."
          : "Итоги опубликованы. Поделитесь ссылкой с игроками и гостями.",
      );
    } catch (err) {
      await refresh();
      setCommandError(
        err instanceof ApiError && err.status === 409
          ? "Игра уже обновилась. Проверьте состояние итогов и повторите действие."
          : err instanceof Error
            ? err.message
            : "Не удалось изменить публикацию итогов.",
      );
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  }
  async function copyResultsLink() {
    if (!game) return;
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/results/${game.id}`,
      );
      setNotice("Ссылка на итоги скопирована.");
      setCommandError("");
    } catch {
      setCommandError(
        "Не удалось скопировать ссылку. Откройте итоги и скопируйте адрес из строки браузера.",
      );
    }
  }
  function adjust(event: FormEvent) {
    event.preventDefault();
    const value = Number(delta);
    if (!Number.isSafeInteger(value) || value === 0) {
      setCommandError("Укажите целое ненулевое изменение счёта.");
      return;
    }
    void command({
      type: "adjust",
      teamId: adjustTeamId,
      delta: value,
      reason: reason.trim(),
    });
  }
  const confirmationText =
    confirmation?.type === "finish"
      ? "Завершить игру? Не присуждённый банк не будет добавлен к счёту команд."
      : confirmation?.type === "undo"
        ? "Отменить последнее решение ведущего? Табло и счёт вернутся к предыдущему состоянию."
        : confirmation?.type === "award"
          ? `Присудить банк команде «${game.teams.find((team) => team.id === confirmation.teamId)?.name}» и завершить раунд?`
          : confirmation?.type === "turn"
            ? `Передать ход команде «${game.teams.find((team) => team.id === confirmation.teamId)?.name}»? Ошибки сбросятся, банк сохранится.`
            : "";
  return (
    <main
      className="host-page"
      style={brandStyle(displayBrand)}
      data-theme={isLightBrand(displayBrand) ? "light" : "dark"}
    >
      <div className="container host-container">
        <header className="host-header">
          <div>
            <div className="host-breadcrumbs">
              <Link className="text-link" to="/admin/games">
                <ArrowLeft size={16} /> Все игры
              </Link>
              <Link className="text-link" to={`/admin/games/${game.id}`}>
                <SlidersHorizontal size={15} /> Настройки игры
              </Link>
            </div>
            <p className="eyebrow">Пульт ведущего</p>
            <h1>{game.title}</h1>
          </div>
          <div className="host-header-actions">
            <ThemeToggle />
            <Connection connected={connected} error={error} refresh={refresh} />
            <Link
              className="button secondary"
              to={`/board/${game.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Monitor size={17} /> Общее табло <ExternalLink size={14} />
            </Link>
          </div>
        </header>
        <nav className="host-section-nav" aria-label="Разделы пульта">
          <a href="#host-play"><Monitor size={18} /><span>Раунд</span></a>
          <a href="#host-controls"><SlidersHorizontal size={18} /><span>Действия</span></a>
          <a href="#host-teams"><Users size={18} /><span>Команды</span></a>
          <a href="#host-journal"><ScrollText size={18} /><span>Журнал</span></a>
        </nav>
        <ErrorMessage message={error} />
        <ErrorMessage message={commandError} />
        {notice && (
          <div className="success" role="status">
            <Check size={17} />
            {notice}
          </div>
        )}
        <section className={`host-cockpit ${game.paused ? "is-paused" : ""}`} aria-label="Состояние раунда">
          <div className="host-status-bar">
            <div className="host-phase">
              <span className="badge">{game.paused ? "На паузе" : phases[game.phase]}</span>
              <span>Раунд {game.questionIndex + 1} / {game.questions.length}</span>
            </div>
            <div className="host-turn"><span>Сейчас отвечает</span><strong>{activeTeam?.name ?? "Выберите команду"}</strong></div>
            <div className="host-bank"><span>Банк <small>×{multiplier}</small></span><strong>{game.bank}</strong></div>
            <div className="host-mistakes"><span>Ошибки</span><Strikes count={game.strikes} /></div>
          </div>
          <p className="host-next-step" role="status">{nextStep}</p>
        </section>
        <div className="host-keyboard-toolbar">
          <label className="host-shortcut-toggle">
            <input type="checkbox" checked={shortcutsEnabled} onChange={(event) => setShortcutsEnabled(event.target.checked)} />
            <Keyboard size={17} aria-hidden="true" /> Горячие клавиши
          </label>
          {shortcutsEnabled && <p className="form-hint"><kbd>1</kbd>–<kbd>6</kbd> открыть ответ · <kbd>P</kbd> пауза · <kbd>U</kbd> отмена с подтверждением</p>}
        </div>
        {(game.phase === "lobby" || game.phase === "round-result") && (
          <section className="card host-start-panel">
            <div>
              <p className="eyebrow">
                {game.phase === "lobby"
                  ? "Всё готово к игре"
                  : "Раунд завершён"}
              </p>
              <h2>
                {game.phase === "lobby"
                  ? "Кто отвечает первым?"
                  : game.questionIndex + 1 >= game.questions.length
                    ? "Пора подвести итоги"
                    : "Готовы к следующему вопросу?"}
              </h2>
              <p className="muted">
                {game.phase === "lobby"
                  ? "Выберите команду. Первый вопрос появится на табло после старта."
                  : game.questionIndex + 1 >= game.questions.length
                    ? "Все раунды сыграны. Завершите игру, чтобы открыть страницу результатов."
                    : "Ответы и статистика остаются на табло, пока вы не продолжите игру."}
              </p>
            </div>
            <div className="host-start-actions">
              {(game.phase === "lobby" ||
                game.questionIndex + 1 < game.questions.length) && (
                <label className="field">
                  Первой отвечает
                  <select
                    value={firstTeamId}
                    onChange={(event) => setFirstTeamId(event.target.value)}
                  >
                    {game.teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                className="button primary"
                disabled={disabled || game.paused || !firstTeamId}
                onClick={() =>
                  void command(
                    game.phase === "lobby"
                      ? { type: "start", teamId: firstTeamId }
                      : { type: "next", teamId: firstTeamId },
                  )
                }
              >
                <Play size={18} />
                {game.phase === "lobby"
                  ? "Начать игру"
                  : game.questionIndex + 1 >= game.questions.length
                    ? "Завершить по итогам раундов"
                    : "Следующий раунд"}
              </button>
            </div>
          </section>
        )}
        <TeamScores
          teams={game.teams}
          activeTeamId={game.activeTeamId}
          compact
        />
        {showStatisticsControls && (
          <section className="card host-statistics-controls" aria-label="Статистика на общем табло">
            <div>
              <p className="eyebrow">Все ответы опроса</p>
              <h2>Что увидят гости?</h2>
              <p className="muted">Переключите вид статистики на общей доске.</p>
            </div>
            <div className="button-row">
              <button className={`button ${(game.statisticsView ?? "list") === "list" ? "primary" : "secondary"}`} disabled={disabled || game.paused} aria-pressed={(game.statisticsView ?? "list") === "list"} onClick={() => void command({ type: "statistics-view", view: "list" })}>
                <List size={18} /> Список на табло
              </button>
              <button className={`button ${game.statisticsView === "cloud" ? "primary" : "secondary"}`} disabled={disabled || game.paused} aria-pressed={game.statisticsView === "cloud"} onClick={() => void command({ type: "statistics-view", view: "cloud" })}>
                <Cloud size={18} /> Облако на табло
              </button>
            </div>
          </section>
        )}
        {game.phase === "finished" && (
          <section className="card host-results-panel">
            <div>
              <p className="eyebrow">Ответы, команды и результаты</p>
              <h2>
                {game.resultsPublished
                  ? "Итоги доступны всем"
                  : "Поделитесь итогами игры"}
              </h2>
              <p className="muted">
                {game.resultsPublished
                  ? "Игроки и гости могут открыть общую страницу с ответами и инфографикой."
                  : "Посмотрите страницу результатов. Когда всё готово, откройте её для игроков и гостей."}
              </p>
            </div>
            <div className="host-results-actions">
              <Link className="button secondary" to={`/results/${game.id}`}>
                <Trophy size={18} /> Посмотреть итоги
              </Link>
              <button
                className={`button ${game.resultsPublished ? "secondary" : "primary"}`}
                disabled={disabled}
                onClick={() => void publishResults()}
              >
                {game.resultsPublished ? "Скрыть итоги" : "Опубликовать итоги"}
              </button>
              {game.resultsPublished && (
                <button
                  className="button ghost"
                  onClick={() => void copyResultsLink()}
                >
                  <Copy size={17} /> Скопировать ссылку
                </button>
              )}
            </div>
          </section>
        )}
        <div className="host-grid">
          <div className="stack host-main" id="host-play">
            <section
              className={`card host-answer-decision ${game.pendingAnswer ? "has-pending" : ""}`}
            >
              <div className="section-title small">
                <h2>Ответ капитана</h2>
                <span className="badge">
                  {game.pendingAnswer ? "Нужна оценка" : "Ожидание"}
                </span>
              </div>
              {game.pendingAnswer ? (
                <div className="host-pending">
                  <p>
                    {
                      game.teams.find(
                        (team) => team.id === game.pendingAnswer!.teamId,
                      )?.name
                    }{" "}
                    · {game.pendingAnswer.authorName}
                  </p>
                  <h3>{game.pendingAnswer.text}</h3>
                  <p className="muted">
                    Откройте совпавший ответ в списке ниже или отметьте ошибку.
                    Решение очистит текущие предложения.
                  </p>
                </div>
              ) : (
                <p className="muted">
                  Капитан может отправить ответ с телефона. При устной игре
                  принимайте решение кнопками пульта.
                </p>
              )}
              <button
                className="button danger"
                disabled={disabled || !roundLive}
                onClick={() => void command({ type: "strike" })}
              >
                <X size={18} />
                {game.phase === "steal"
                  ? "Перехват не удался"
                  : "Отметить ошибку"}
              </button>
            </section>
            <section className="card host-question">
              <div className="section-title small">
                <p className="eyebrow">Вопрос и ответы · Только ведущему</p>
                {question?.isDemo && (
                  <span className="badge demo">Демонстрационный</span>
                )}
              </div>
              <h2>{question?.prompt ?? "Нет вопроса"}</h2>
              {question?.notes && (
                <p className="host-notes">Заметка: {question.notes}</p>
              )}
              {question && (
                <div className="host-answer-list">
                  {currentBoardAnswers.map((answer, index) => {
                    const opened = game.openedAnswerIds.includes(answer.id);
                    return (
                      <div
                        className={`host-answer ${opened ? "opened" : ""}`}
                        key={answer.id}
                      >
                        <span className="answer-number" title={shortcutsEnabled && index < 6 ? `Клавиша ${index + 1}` : undefined}>
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <strong>{answer.text}</strong>
                          {answer.aliases.length > 0 && (
                            <small>Также: {answer.aliases.join(" · ")}</small>
                          )}
                        </div>
                        <span className="answer-points">{answer.points}</span>
                        <button
                          className={`button ${opened ? "ghost" : "primary"} small`}
                          disabled={disabled || !roundLive || opened}
                          onClick={() =>
                            void command({
                              type: "reveal",
                              answerId: answer.id,
                            })
                          }
                        >
                          {opened ? (
                            <>
                              <Check size={15} /> Открыт
                            </>
                          ) : (
                            "Открыть"
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {statisticsOnlyAnswers.length > 0 && (
                <details className="host-survey-tail">
                  <summary>Остальные ответы опроса · {statisticsOnlyAnswers.length}</summary>
                  <p className="form-hint">
                    Эти варианты появятся в статистике после раунда. В игре открывается только ТОП-6.
                  </p>
                  <ul>
                    {statisticsOnlyAnswers.map((answer) => (
                      <li key={answer.id}>
                        <span>{answer.text}</span>
                        <strong>{answer.points}</strong>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {question?.source && (
                <p className="form-hint">
                  Источник: {question.source}
                  {question.respondentCount
                    ? ` · ${question.respondentCount} респондентов`
                    : ""}
                  {question.surveyDate ? ` · ${question.surveyDate}` : ""}
                </p>
              )}
            </section>
            <details className="card host-ideas">
              <summary>
                Предложения команд{" "}
                <span className="badge">{game.suggestions.length}</span>
              </summary>
              {game.suggestions.length ? (
                <ul className="suggestion-list host-suggestions">
                  {[...game.suggestions].reverse().map((suggestion) => (
                    <li key={suggestion.id}>
                      <div>
                        <strong>{suggestion.text}</strong>
                        <span>
                          {
                            game.teams.find(
                              (team) => team.id === suggestion.teamId,
                            )?.name
                          }{" "}
                          · {suggestion.authorName}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  Предложения появятся здесь во время хода команды.
                </p>
              )}
            </details>
          </div>
          <aside className="stack host-controls" id="host-controls">
            <section className="card host-round-controls">
              <h2>Управление раундом</h2>
              <p className="host-current-step">
                {game.phase === "lobby"
                  ? "Выберите команду — и можно начинать."
                  : game.phase === "round-result"
                    ? game.questionIndex + 1 >= game.questions.length
                      ? "Все раунды сыграны. Перейдите к итогам."
                      : "Все ответы открыты на табло. Начните следующий раунд, когда готовы."
                    : game.phase === "finished"
                      ? "Спасибо за игру!"
                      : game.paused
                        ? "Продолжите игру, чтобы принимать ответы."
                        : "Откройте совпавший ответ или отметьте ошибку."}
              </p>
              {game.phase === "lobby" || game.phase === "round-result" ? (
                <p className="form-hint">
                  Кнопка продолжения — над вопросом. Сначала можно обсудить
                  ответы с гостями.
                </p>
              ) : game.phase === "finished" ? (
                <div className="notice">
                  <Trophy size={23} />
                  <p>Игра завершена. Итоги показаны на общем табло.</p>
                </div>
              ) : (
                <div className="stack">
                  {game.teams.map((team) => (
                    <div className="host-team-actions" key={team.id}>
                      <strong>{team.name}</strong>
                      <div className="button-row">
                        <button
                          className="button secondary small"
                          disabled={
                            disabled ||
                            !roundLive ||
                            game.phase === "steal" ||
                            game.activeTeamId === team.id
                          }
                          onClick={() =>
                            setConfirmation({ type: "turn", teamId: team.id })
                          }
                        >
                          Передать ход
                        </button>
                        <button
                          className="button ghost small"
                          disabled={disabled || !roundLive}
                          onClick={() =>
                            setConfirmation({ type: "award", teamId: team.id })
                          }
                        >
                          Присудить банк
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="auth-divider" />
              <div className="host-global-actions">
                <button
                  className="button secondary"
                  disabled={disabled || game.phase === "finished"}
                  onClick={() =>
                    void command({ type: game.paused ? "resume" : "pause" })
                  }
                >
                  {game.paused ? <Play size={17} /> : <Pause size={17} />}
                  {game.paused ? "Продолжить игру" : "Пауза"}
                </button>
                <button
                  className="button ghost"
                  disabled={disabled || !game.history.length}
                  onClick={() => setConfirmation({ type: "undo" })}
                >
                  <Undo2 size={17} /> Отменить последнее
                </button>
                <button
                  className="button ghost danger-text"
                  disabled={disabled || game.phase === "finished"}
                  onClick={() => setConfirmation({ type: "finish" })}
                >
                  <Flag size={17} /> Завершить игру
                </button>
              </div>
            </section>
            <details className="card adjustment-panel">
              <summary>Исправить счёт</summary>
              <form className="stack" onSubmit={adjust}>
                <p className="form-hint">
                  Исправление с причиной попадёт в журнал. Для отмены последнего
                  решения используйте отдельную кнопку.
                </p>
                <label className="field">
                  Команда
                  <select
                    value={adjustTeamId}
                    onChange={(event) => setAdjustTeamId(event.target.value)}
                  >
                    {game.teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Изменение очков
                  <input
                    required
                    type="number"
                    step="1"
                    value={delta}
                    onChange={(event) => setDelta(event.target.value)}
                    placeholder="Например, -10 или 15"
                  />
                </label>
                <label className="field">
                  Причина исправления
                  <input
                    required
                    maxLength={300}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <button
                  className="button secondary"
                  disabled={disabled || !reason.trim()}
                >
                  Сохранить исправление
                </button>
              </form>
            </details>
            <section className="card host-journal" id="host-journal">
              <h2>Журнал решений</h2>
              {game.events.length ? (
                <ol>
                  {[...game.events]
                    .reverse()
                    .slice(0, 12)
                    .map((event) => (
                      <li key={event.id}>
                        <span>
                          {new Date(event.createdAt).toLocaleTimeString(
                            "ru-RU",
                            { hour: "2-digit", minute: "2-digit" },
                          )}
                        </span>
                        <p>{event.message}</p>
                      </li>
                    ))}
                </ol>
              ) : (
                <p className="muted">Решения ведущего будут записаны здесь.</p>
              )}
            </section>
          </aside>
        </div>
        <section className="host-rosters" id="host-teams">
          <div className="section-title">
            <div>
              <p className="eyebrow">Участники и приглашения</p>
              <h2>Команды в сборе</h2>
            </div>
            <Link className="text-link" to={`/admin/games/${game.id}`}>
              Настройка партии <ArrowRight size={16} />
            </Link>
          </div>
          <div className="card-grid">
            {game.teams.map((team) => (
              <section className="card" key={team.id}>
                <div className="section-title small">
                  <h3>{team.name}</h3>
                  <span className="badge">
                    {
                      game.players.filter((player) => player.teamId === team.id)
                        .length
                    }{" "}
                    игроков
                  </span>
                </div>
                <Invitation code={team.joinCode} teamName={team.name} />
                <button
                  className="button secondary small"
                  disabled={disabled || game.phase === "finished"}
                  onClick={() =>
                    void command({
                      type: "join-toggle",
                      teamId: team.id,
                      open: !team.joinOpen,
                    })
                  }
                >
                  {team.joinOpen
                    ? "Закрыть вход в команду"
                    : "Открыть вход в команду"}
                </button>
                <p className="form-hint">
                  {team.joinOpen
                    ? "Участники могут войти по приглашению."
                    : "Вход новых участников закрыт."}
                </p>
                <ul className="host-player-list">
                  {game.players
                    .filter((player) => player.teamId === team.id)
                    .map((player) => (
                      <li key={player.id}>
                        <span>{player.name}</span>
                        {player.role === "captain" ? (
                          <span className="badge captain">
                            <Crown size={13} /> Капитан
                          </span>
                        ) : (
                          <button
                            className="button ghost small"
                            disabled={disabled || game.phase === "finished"}
                            onClick={() => void makeCaptain(player.id)}
                          >
                            Назначить капитаном
                          </button>
                        )}
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </div>
        </section>
        {confirmation && (
          <div className="modal-backdrop">
            <section
              ref={dialogRef}
              className="card confirm-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-title"
              aria-describedby="confirm-description"
            >
              <ShieldCheck size={28} />
              <h2 id="confirm-title">Подтвердите решение</h2>
              <p id="confirm-description">{confirmationText}</p>
              <div className="button-row">
                <button
                  autoFocus
                  className="button secondary"
                  onClick={() => setConfirmation(null)}
                >
                  Отмена
                </button>
                <button
                  className="button primary"
                  disabled={disabled}
                  onClick={() => void command(confirmation)}
                >
                  Подтвердить
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
