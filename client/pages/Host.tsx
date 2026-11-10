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
  ChevronDown,
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
import { classicBoardPoints, classicPoints } from "../../shared/classicPoints";
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

function ClassicFinalPanel({ game, disabled, command }: {
  game: HostGame;
  disabled: boolean;
  command: (next: HostCommand) => Promise<void>;
}) {
  const final = game.classic!.final!;
  const playerIndex = final.player - 1;
  // Keep unsaved answers in this tab across a reload, never on the public board.
  // Each server-issued attempt ID gives a replay after undo its own draft.
  const startEvent = [...game.events].reverse().find((event) => event.type === "classic-final-start" && event.message === `Начался этап финалиста ${final.player}.`);
  const draftKey = `ctokodnomy:final-draft:${game.id}:${final.player}:${final.attemptId ?? startEvent?.id ?? "legacy"}`;
  const loadDraft = () => {
    const fallback = {
      texts: final.entries[playerIndex].map((entry) => entry?.text ?? ""),
      matches: final.entries[playerIndex].map((entry) => entry?.answerId ?? ""),
    };
    if (final.phase === "ready") return fallback;
    try {
      const stored = sessionStorage.getItem(draftKey);
      if (!stored) return fallback;
      const draft: unknown = JSON.parse(stored);
      if (!draft || typeof draft !== "object") return fallback;
      const { texts, matches } = draft as { texts?: unknown; matches?: unknown };
      if (!Array.isArray(texts) || !Array.isArray(matches) || texts.length !== 5 || matches.length !== 5 ||
        !texts.every((item) => typeof item === "string" && item.length <= 200) ||
        !matches.every((item) => typeof item === "string")) return fallback;
      return { texts: texts as string[], matches: matches as string[] };
    } catch {
      return fallback;
    }
  };
  const [initialDraft] = useState(loadDraft);
  const [texts, setTexts] = useState(initialDraft.texts);
  const [matches, setMatches] = useState(initialDraft.matches);
  const textsRef = useRef(texts);
  const matchesRef = useRef(matches);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [draftError, setDraftError] = useState(false);
  const [now, setNow] = useState(Date.now);
  function saveDraft(nextTexts: string[], nextMatches: string[]) {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ texts: nextTexts, matches: nextMatches }));
      setDraftError(false);
    } catch {
      setDraftError(true);
    }
  }
  useEffect(() => {
    if (final.phase !== "answering" || !final.deadlineAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [final.phase, final.deadlineAt]);
  const remaining = final.deadlineAt === null
    ? final.remainingMs
    : Math.max(0, final.deadlineAt - now);
  const review = final.phase === "review";
  const canEnterText = final.phase === "answering" && !game.paused && !disabled && final.deadlineAt !== null && final.deadlineAt > now;
  const team = game.teams.find((item) => item.id === final.teamId);
  const entries = final.entries[playerIndex];
  const repeated = texts.map((text, index) => {
    if (final.player !== 2) return false;
    const normalize = (value: string) => value.trim().toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/\s+/g, " ");
    const value = normalize(text ?? "");
    const first = final.entries[0][index];
    return !!value && !["пас", "пропуск"].includes(value) && !!first &&
      (value === normalize(first.text) || (!!matches[index] && matches[index] === first.answerId));
  });
  const unsaved = entries.some((entry, index) => entry
    ? entry.text !== texts[index]?.trim() || (entry.answerId ?? "") !== matches[index]
    : !!texts[index]?.trim() || !!matches[index]);
  return (
    <section className="card host-final" aria-label="Большая игра" data-final-phase={final.phase}>
      <div className="host-final-toolbar">
      <div className="host-final-heading">
        <div>
          <h2>Большая игра · игрок {final.player}</h2>
          <p className="muted">{team?.name ?? "Команда"} · {final.score} из 200 очков</p>
        </div>
        {remaining !== null && <strong className="host-final-clock" aria-label={`Осталось секунд: ${Math.ceil(remaining / 1000)}`}>{Math.ceil(remaining / 1000)} с</strong>}
      </div>
      {final.phase === "ready" && (
        <div className="host-final-instructions">
          <p>Задайте пять вопросов. После старта записывайте ответы; затем остановите таймер и проверьте совпадения.</p>
          <button className="button primary" disabled={disabled || game.paused} onClick={() => void command({ type: "classic-final-start" })}>
            <Play size={18} /> Начать: {final.player === 1 ? "15" : "20"} секунд
          </button>
        </div>
      )}
      {final.phase === "answering" && (
        <div className="host-final-instructions">
          <p>{game.paused ? "Пауза. Продолжите игру для записи." : remaining !== null && remaining <= 0 ? "Время вышло. Проверьте ответы." : "Записывайте ответы до сигнала."}</p>
          <button className="button secondary" disabled={disabled || game.paused} onClick={() => void command({ type: "classic-final-stop" })}>
            <Pause size={18} /> Остановить и проверить
          </button>
        </div>
      )}
      {draftError && <p className="host-final-repeat" role="alert">Браузер не сохранил черновик. До завершения проверки не обновляйте эту страницу.</p>}
      {final.player === 2 && (final.phase === "answering" || final.phase === "review") && (
        <div className="host-final-repeat-control">
          <p className="form-hint">Если второй игрок повторил ответ первого, подайте сигнал и попросите другой вариант.</p>
          <button type="button" className="button secondary" disabled={disabled || game.paused} onClick={() => void command({ type: "classic-final-repeat" })}>Сигнал повтора</button>
        </div>
      )}
      </div>
      {final.phase === "ready" && (
        <ol className="host-final-preview" aria-label="Вопросы финала">
          {game.questions.slice(4, 9).map((question) => <li key={question.id}>{question.prompt}</li>)}
        </ol>
      )}
      {review && <p className="form-hint">Для каждого ответа выберите совпавший вариант опроса или оставьте «Нет совпадения». Сохраните заполненные ответы; пустые поля считаются пропуском.</p>}
      {final.phase !== "ready" && game.questions.slice(4, 9).map((question, index) => {
        const saved = entries[index];
        const dirty = saved ? saved.text !== texts[index]?.trim() || (saved.answerId ?? "") !== matches[index] : !!texts[index]?.trim() || !!matches[index];
        const points = classicPoints(question.answers);
        return (
          <form className="host-final-answer" key={question.id} onSubmit={(event) => {
            event.preventDefault();
            if (review && dirty) void command({ type: "classic-final-answer", questionIndex: index, text: texts[index]?.trim() ?? "", answerId: matches[index] || null });
          }}>
            <h3><span>{index + 1}.</span> {question.prompt}</h3>
            <label className="field"><span className={review ? undefined : "sr-only"}>Ответ игрока</span>
              <input ref={(element) => { inputRefs.current[index] = element; }} enterKeyHint="next" maxLength={200} value={texts[index] ?? ""} disabled={!canEnterText} onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing || review) return;
                event.preventDefault();
                inputRefs.current[index + 1]?.focus();
              }} onChange={(event) => {
                // React's interval updates the display, but the event handler checks
                // the server deadline again so the last fraction of a second is safe.
                if (!canEnterText || final.deadlineAt === null || Date.now() >= final.deadlineAt) return;
                const next = textsRef.current.map((item, i) => i === index ? event.target.value : item);
                textsRef.current = next;
                setTexts(next);
                saveDraft(next, matchesRef.current);
              }} placeholder="Ответ или пустое поле для пропуска" />
            </label>
            {repeated[index] && <div className="host-final-repeat" role="alert">
              <p>{review || !canEnterText ? "Повторный ответ не засчитывается." : "Этот ответ уже назвал первый игрок. Попросите другой вариант."}</p>
              {(review || !canEnterText) && <button type="button" className="button secondary small" disabled={disabled || game.paused} onClick={() => {
                const nextTexts = textsRef.current.map((item, i) => i === index ? "" : item);
                const nextMatches = matchesRef.current.map((item, i) => i === index ? "" : item);
                textsRef.current = nextTexts;
                matchesRef.current = nextMatches;
                setTexts(nextTexts);
                setMatches(nextMatches);
                saveDraft(nextTexts, nextMatches);
              }}>Засчитать пропуск</button>}
            </div>}
            {review && <label className="field">Совпадение в опросе
              <select value={matches[index] ?? ""} disabled={disabled || game.paused} onChange={(event) => {
                const next = matchesRef.current.map((item, i) => i === index ? event.target.value : item);
                matchesRef.current = next;
                setMatches(next);
                saveDraft(textsRef.current, next);
              }}>
                <option value="">Нет совпадения · 0 очков</option>
                {question.answers.map((answer, answerIndex) => <option key={answer.id} value={answer.id} disabled={final.player === 2 && answer.id === final.entries[0][index]?.answerId}>{answer.text} · {points[answerIndex]} очков</option>)}
              </select>
            </label>}
            {review && <div className="host-final-answer-actions">
              <span className="form-hint">{saved && !dirty ? `Сохранено · ${saved.points} очков` : dirty ? "Не сохранено" : "Пропуск"}</span>
              <button className="button secondary small" disabled={disabled || game.paused || !dirty || repeated[index] || (!!matches[index] && !texts[index]?.trim())}>Сохранить ответ</button>
            </div>}
          </form>
        );
      })}
      {review && <div className="host-final-next">
        {unsaved && <p className="form-hint">Сохраните заполненные ответы перед продолжением.</p>}
        <button className="button primary" disabled={disabled || game.paused || unsaved} onClick={() => void command({ type: "classic-final-next" })}>
          {final.player === 1 ? "Следующий игрок" : "Завершить большую игру"} <ArrowRight size={18} />
        </button>
      </div>}
    </section>
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
  const [clockNow, setClockNow] = useState(Date.now);
  const [turnMenuOpen, setTurnMenuOpen] = useState(false);
  const turnMenuRef = useRef<HTMLDivElement>(null);
  const turnMenuButtonRef = useRef<HTMLButtonElement>(null);
  const undoButtonRef = useRef<HTMLButtonElement>(null);
  const confirmationReturnFocus = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const lastAttempt = useRef<HostAttempt | null>(null);
  const operationInFlight = useRef(false);
  const shortcutAction = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    if (game?.classic?.stage !== "reverse" || game.paused) return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [game?.classic?.stage, game?.paused]);
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
    if (!turnMenuOpen) return;
    const closeOutside = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !turnMenuRef.current?.contains(event.target)) {
        setTurnMenuOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setTurnMenuOpen(false);
      turnMenuButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
      document.removeEventListener("keydown", escape);
    };
  }, [turnMenuOpen]);
  useEffect(() => {
    if (!confirmation) return;
    const previousFocus = confirmationReturnFocus.current ?? document.activeElement;
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
      const fallback = confirmation.type === "turn" || confirmation.type === "award"
        ? turnMenuButtonRef.current : undoButtonRef.current;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected && !previousFocus.matches(":disabled") && previousFocus.getClientRects().length) {
        previousFocus.focus();
      } else if (fallback && !fallback.disabled) fallback.focus();
      confirmationReturnFocus.current = null;
    };
  }, [confirmation]);
  function askConfirmation(next: HostCommand, trigger?: HTMLElement | null) {
    confirmationReturnFocus.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setTurnMenuOpen(false);
    setConfirmation(next);
  }
  useEffect(() => {
    if (game?.paused || (game?.phase !== "playing" && game?.phase !== "steal")) setTurnMenuOpen(false);
  }, [game?.paused, game?.phase]);
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
  const openedCount = currentBoardAnswers.filter((answer) => game.openedAnswerIds.includes(answer.id)).length;
  const boardAnswerIds = new Set(currentBoardAnswers.map((answer) => answer.id));
  const statisticsOnlyAnswers = question?.answers.filter((answer) => !boardAnswerIds.has(answer.id)) ?? [];
  const multiplier =
    game.rules.multipliers[game.questionIndex] ??
    game.rules.multipliers.at(-1) ??
    1;
  const roundLive =
    (game.phase === "playing" || game.phase === "steal") && !game.paused;
  const classic = game.classic;
  const isClassicFinal = classic?.stage === "final";
  const isManualTiebreak = classic?.stage === "tiebreak" && !classic.duel;
  const isDuel = (classic?.stage === "duel" || classic?.stage === "tiebreak") && !!classic.duel;
  const waitingForBuzz = isDuel && !classic?.duel?.awaitingTeamId;
  const reverse = classic?.stage === "reverse" ? classic.reverse : null;
  const reverseRemaining = reverse?.remainingMs != null ? reverse.remainingMs : reverse?.deadlineAt != null ? Math.max(0, reverse.deadlineAt - clockNow) : null;
  const canDecideAnswer = roundLive && !isClassicFinal && !isManualTiebreak && !waitingForBuzz;
  const canRevealAnswer = canDecideAnswer && !(reverseRemaining !== null && reverseRemaining <= 0);
  const canManageBank = roundLive && (!classic || classic.stage === "play");
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
        ? classic ? "Начните игру: команды разыграют право хода." : "Выберите первую команду и начните игру. Вопрос появится на общей доске."
        : game.phase === "round-result"
          ? game.questionIndex + 1 >= game.questions.length
            ? "Последний раунд завершён. Обсудите ответы и перейдите к итогам."
            : "Обсудите все ответы с гостями, затем начните следующий раунд."
          : game.phase === "finished"
            ? "Игра завершена. Проверьте итоги и откройте их для гостей."
            : isClassicFinal
              ? "Проведите большую игру: запишите ответы двух игроков и проверьте их по опросу."
              : isManualTiebreak
                ? "Счёт равный. Проведите дополнительный вопрос и выберите победившую команду."
                : waitingForBuzz
                  ? "Ждём сигнала капитана. При необходимости выберите команду вручную."
                  : isDuel
                    ? `${activeTeam?.name ?? "Команда"} отвечает на дуэли. Откройте вариант или отметьте ошибку.`
                    : classic?.stage === "reverse"
                      ? `${activeTeam?.name ?? "Команда"} выбирает ответ в игре наоборот.`
            : game.phase === "steal"
              ? `${activeTeam?.name ?? "Команда"} перехватывает банк: откройте совпавший ответ или отметьте неудачу.`
              : game.pendingAnswer
                ? "Капитан отправил ответ. Откройте совпавший вариант или отметьте ошибку."
                : "Выслушайте команду. Откройте совпавший вариант или отметьте ошибку.";
  shortcutAction.current = (event) => {
    if (disabled || operationInFlight.current || confirmation || turnMenuOpen) return;
    if ((event.code === "KeyP" || event.key.toLowerCase() === "p") && game.phase !== "finished") {
      event.preventDefault();
      void command({ type: game.paused ? "resume" : "pause" });
      return;
    }
    if (game.paused) return;
    if ((event.code === "KeyU" || event.key.toLowerCase() === "u") && game.history.length) {
      event.preventDefault();
      askConfirmation({ type: "undo" }, undoButtonRef.current);
      return;
    }
    if (!canRevealAnswer || !/^[1-6]$/.test(event.key)) return;
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
    setTurnMenuOpen(false);
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
      data-final-phase={isClassicFinal ? classic?.final?.phase : undefined}
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
        <section className={`host-cockpit ${game.paused ? "is-paused" : ""}`} aria-label="Состояние раунда">
          <div className="host-status-bar">
            <div className="host-phase">
              <span className="badge">{game.paused ? "На паузе" : phases[game.phase]}</span>
              <span>{classic ? isClassicFinal ? "Большая игра · раунд 5 / 5" : classic.stage === "tiebreak" ? "Тай-брейк" : `Раунд ${Math.min(game.questionIndex + 1, 4)} / 5` : `Раунд ${game.questionIndex + 1} / ${game.questions.length}`}</span>
            </div>
              <div className="host-turn"><span>Сейчас отвечает</span><strong>{activeTeam?.name ?? "Выберите команду"}</strong>{classic?.stage === "play" && game.phase === "playing" && classic.activePlayerIndex && <small>Игрок {classic.activePlayerIndex}</small>}{isDuel && classic?.duel?.playerIndex && <small>Игрок {classic.duel.playerIndex}</small>}</div>
            <div className="host-bank"><span>Банк <small>×{multiplier}</small></span><strong>{game.bank}</strong></div>
            <div className="host-mistakes"><span>Ошибки</span><Strikes count={game.strikes} /></div>
          </div>
          {game.pendingAnswer && !game.paused ? (
            <p className="host-next-step host-pending" role="status">
              <span>Ответ капитана · {game.pendingAnswer.authorName}: </span>
              <strong>{game.pendingAnswer.text}</strong>
            </p>
          ) : <p className="host-next-step" role="status">{nextStep}</p>}
        </section>
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
                  ? classic ? "Готовы начать?" : "Кто отвечает первым?"
                  : !classic && game.questionIndex + 1 >= game.questions.length
                    ? "Пора подвести итоги"
                    : "Готовы к следующему вопросу?"}
              </h2>
              <p className="muted">
                {game.phase === "lobby"
                  ? classic ? "После старта капитаны разыграют право первого хода." : "Выберите команду. Первый вопрос появится на табло после старта."
                  : classic && game.questionIndex === 3
                    ? "Продолжите игру, чтобы определить финалиста."
                  : !classic && game.questionIndex + 1 >= game.questions.length
                    ? "Все раунды сыграны. Завершите игру, чтобы открыть страницу результатов."
                    : "Ответы и статистика остаются на табло, пока вы не продолжите игру."}
              </p>
            </div>
            <div className="host-start-actions">
              {(!classic || (game.phase === "round-result" && game.questionIndex === 2 && game.teams[0]?.score === game.teams[1]?.score)) && (game.phase === "lobby" ||
                game.questionIndex + 1 < game.questions.length) && (
                <label className="field">
                  {classic ? "При ничьей первой отвечает" : "Первой отвечает"}
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
            </div>
          </section>
        )}
        <TeamScores
          teams={game.teams}
          activeTeamId={game.activeTeamId}
          compact
        />
        {isDuel && !game.paused && (
          <section className="card host-classic-step" aria-label="Розыгрыш права хода">
            <div>
              <p className="eyebrow">{classic?.stage === "tiebreak" ? "Тай-брейк" : "Розыгрыш хода"}</p>
              <h2>{waitingForBuzz ? "Кто нажал первым?" : `Отвечает ${activeTeam?.name ?? "команда"}`}</h2>
              <p className="muted">{waitingForBuzz ? "Капитан может нажать кнопку на телефоне. Если это неудобно, выберите команду вручную." : "Выслушайте ответ и откройте совпадающий вариант. Если ответа нет, отметьте ошибку."}</p>
            </div>
            {waitingForBuzz && <div className="button-row">
              {game.teams.map((team) => <button key={team.id} className="button secondary" disabled={disabled || !roundLive} onClick={() => void command({ type: "classic-buzz", teamId: team.id })}>{team.name} нажала первой</button>)}
            </div>}
          </section>
        )}
        {isManualTiebreak && !game.paused && (
          <section className="card host-classic-step" aria-label="Тай-брейк">
            <h2>Счёт равный</h2>
            <p className="muted">Проведите дополнительный вопрос и укажите, какая команда первой ответила верно.</p>
            <div className="button-row">{game.teams.map((team) => <button key={team.id} className="button secondary" disabled={disabled || !roundLive} onClick={() => void command({ type: "classic-tiebreak-winner", teamId: team.id })}>{team.name} выходит в финал</button>)}</div>
          </section>
        )}
        {classic?.stage === "reverse" && game.phase === "playing" && (
          <section className="card host-classic-step" aria-label="Игра наоборот">
            <div>
              <p className="eyebrow">Игра наоборот</p>
              <h2>Отвечает {activeTeam?.name ?? "команда"}</h2>
              <p className="muted">Команда совещается и называет один ответ. Откройте его или отметьте «Нет ответа».</p>
            </div>
            {reverseRemaining !== null && <strong className="host-classic-clock" role="timer" aria-label={`Осталось ${Math.ceil(reverseRemaining / 1000)} секунд`}>{Math.ceil(reverseRemaining / 1000)} с</strong>}
            {reverseRemaining !== null && reverseRemaining <= 0 && <p className="form-hint">Время вышло. Отметьте «Нет ответа».</p>}
          </section>
        )}
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
            {isClassicFinal && classic?.final ? <ClassicFinalPanel key={`${game.id}-${classic.final.player}-${classic.final.attemptId ?? "ready"}`} game={game} disabled={disabled} command={command} /> : !isManualTiebreak && <section className="card host-question">
              <div className="section-title small">
                <p className="eyebrow">Вопрос и ответы · Только ведущему</p>
                <div className="host-question-meta">
                  {question && <span className="host-reveal-progress" role="status">Открыто {openedCount} из {currentBoardAnswers.length}</span>}
                  {question?.isDemo && <span className="badge demo">Демонстрационный</span>}
                </div>
              </div>
              <h2>{question?.prompt ?? "Нет вопроса"}</h2>
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
                            <details className="host-answer-aliases">
                              <summary>Другие формулировки · {answer.aliases.length}</summary>
                              <small>{answer.aliases.join(" · ")}</small>
                            </details>
                          )}
                        </div>
                        <span className="answer-points">{classic?.stage === "reverse" ? [15, 30, 60, 120, 180, 240][index] : classic ? classicBoardPoints(question.answers)[index] : answer.points}</span>
                        <button
                          className={`button ${opened ? "ghost" : "primary"} small`}
                          disabled={disabled || !canRevealAnswer || opened}
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
              {(question?.notes || question?.source) && (
                <details className="host-question-details">
                  <summary>Заметки и источник</summary>
              {question?.notes && (
                <p className="host-notes">Заметка: {question.notes}</p>
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
                </details>
              )}
            </section>}
            {!game.pendingAnswer && !isClassicFinal && !isManualTiebreak && <p className="host-captain-hint">Ответы можно принимать устно или с телефона капитана. Кнопка ошибки всегда внизу экрана.</p>}
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
            <details className="card host-round-controls">
              <summary>Дополнительные действия</summary>
              <p className="host-current-step">Основные действия доступны на плавающей панели внизу экрана.</p>
              <div className="host-keyboard-toolbar">
                <label className="host-shortcut-toggle">
                  <input type="checkbox" checked={shortcutsEnabled} onChange={(event) => setShortcutsEnabled(event.target.checked)} />
                  <Keyboard size={17} aria-hidden="true" /> Горячие клавиши
                </label>
                {shortcutsEnabled && <p className="form-hint"><kbd>1</kbd>–<kbd>6</kbd> открыть ответ · <kbd>P</kbd> пауза · <kbd>U</kbd> отмена с подтверждением</p>}
              </div>
              <button
                className="button ghost danger-text"
                disabled={disabled || game.phase === "finished"}
                onClick={(event) => askConfirmation({ type: "finish" }, event.currentTarget)}
              >
                <Flag size={17} /> Завершить игру
              </button>
            </details>
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
            <details className="card host-journal" id="host-journal">
              <summary>Журнал решений <span className="badge">{game.events.length}</span></summary>
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
            </details>
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
                {classic && <p className="form-hint">В классической игре капитан — №1, остальные занимают места №2–5 по порядку подключения. При смене капитана номера пересчитываются.</p>}
                <ul className="host-player-list">
                  {game.players
                    .filter((player) => player.teamId === team.id)
                    .map((player, _index, roster) => {
                      const position = player.role === "captain" ? 1 : roster.filter((member) => member.role !== "captain").findIndex((member) => member.id === player.id) + 2;
                      return (
                      <li key={player.id}>
                        <span>{classic && (position <= 5 ? `№${position} · ` : "Вне пятёрки · ")}{player.name}</span>
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
                    ); })}
                </ul>
              </section>
            ))}
          </div>
        </section>
        <section className="host-action-dock" aria-label="Быстрые действия ведущего">
          <div className="host-dock-actions">
            {game.phase === "lobby" || game.phase === "round-result" ? (
              <button
                className="button primary"
                disabled={disabled || game.paused || !firstTeamId}
                onClick={() => void command(game.phase === "lobby" ? { type: "start", teamId: firstTeamId } : { type: "next", teamId: firstTeamId })}
              >
                <Play size={18} />
                <span>{game.phase === "lobby" ? "Начать игру" : classic && game.questionIndex === 3 ? "Определить финалиста" : !classic && game.questionIndex + 1 >= game.questions.length ? "Завершить по итогам раундов" : "Следующий раунд"}</span>
              </button>
            ) : game.phase === "finished" ? (
              <button className="button secondary" disabled>
                <Trophy size={18} /><span>Игра завершена</span>
              </button>
            ) : isClassicFinal || isManualTiebreak ? (
              <button className="button secondary" disabled><Trophy size={18} /><span>{isClassicFinal ? "Управление финалом выше" : "Выберите победителя выше"}</span></button>
            ) : (
              <button className="button danger" disabled={disabled || !canDecideAnswer} onClick={() => void command({ type: "strike" })}>
                <X size={18} /><span>{game.phase === "steal" ? "Перехват не удался" : classic?.stage === "reverse" ? "Нет ответа" : "Отметить ошибку"}</span>
              </button>
            )}
            <button className="button secondary" disabled={disabled || game.phase === "finished"} onClick={() => void command({ type: game.paused ? "resume" : "pause" })}>
              {game.paused ? <Play size={18} /> : <Pause size={18} />}<span>{game.paused ? "Продолжить игру" : "Пауза"}</span>
            </button>
            <button ref={undoButtonRef} className="button ghost" disabled={disabled || !game.history.length} onClick={(event) => askConfirmation({ type: "undo" }, event.currentTarget)}>
              <Undo2 size={18} /><span>Отменить последнее</span>
            </button>
            <div className="host-dock-menu" ref={turnMenuRef}>
              <button ref={turnMenuButtonRef} className={`button secondary ${turnMenuOpen ? "is-active" : ""}`} disabled={disabled || !canManageBank} aria-expanded={turnMenuOpen} aria-controls="host-turn-bank-panel" onClick={() => setTurnMenuOpen((open) => !open)}>
                <Users size={18} /><span>Ход и банк</span><ChevronDown size={16} />
              </button>
              {turnMenuOpen && (
                <div className="host-turn-bank-panel" id="host-turn-bank-panel" role="region" aria-label="Ход и банк">
                  <div className="host-dock-panel-heading"><strong>Кому передать ход или банк?</strong><button className="button ghost small" aria-label="Закрыть действия с командами" onClick={() => { setTurnMenuOpen(false); turnMenuButtonRef.current?.focus(); }}><X size={18} /></button></div>
                  {game.teams.map((team) => (
                    <div className="host-team-actions" key={team.id}>
                      <strong>{team.name}{game.activeTeamId === team.id ? " · сейчас отвечает" : ""}</strong>
                      <div className="button-row">
                        <button className="button secondary small" disabled={disabled || !roundLive || game.phase === "steal" || game.activeTeamId === team.id} onClick={() => askConfirmation({ type: "turn", teamId: team.id }, turnMenuButtonRef.current)}>Передать ход</button>
                        <button className="button primary small" disabled={disabled || !roundLive} onClick={() => askConfirmation({ type: "award", teamId: team.id }, turnMenuButtonRef.current)}>Присудить банк</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <p className={`host-dock-status ${commandError ? "has-error" : notice ? "has-success" : ""}`} role={commandError ? "alert" : "status"}>
            {busy ? "Сохраняем решение…" : commandError || notice || (!connected || error ? "Нет связи. Дождитесь подключения." : "Действия обновляют табло и телефоны команд.")}
          </p>
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
