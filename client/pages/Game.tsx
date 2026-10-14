import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  Crown,
  ExternalLink,
  Flag,
  Maximize2,
  Monitor,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sun,
  Trophy,
  Undo2,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import type {
  HostCommand,
  HostGame,
  PublicGame,
  PublicTeam,
  TeamGame,
} from "../../shared/types";
import { api, ApiError, brandStyle, useLiveGame } from "../lib";
import { ErrorMessage, Loading } from "../components/Common";
import { useGameSound } from "../components/BoardSound";
import { RoundStatistics } from "../components/Statistics";
import { isLightBrand, projectorPalette } from "../theme";
import "./Game.css";

const phases = {
  lobby: "Ожидание старта",
  playing: "Идёт раунд",
  steal: "Перехват",
  "round-result": "Раунд завершён",
  finished: "Игра завершена",
};
function Connection({
  connected,
  error,
  refresh,
}: {
  connected: boolean;
  error: string;
  refresh: () => Promise<void>;
}) {
  return (
    <div
      className={`connection ${connected && !error ? "online" : "offline"}`}
      role="status"
    >
      {connected && !error ? (
        <>
          <Wifi size={14} />
          <span>На связи</span>
        </>
      ) : (
        <>
          <WifiOff size={15} />
          <span>
            {error ? "Не удалось обновить состояние" : "Восстанавливаем связь…"}
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            aria-label="Обновить состояние"
          >
            <RefreshCw size={14} />
          </button>
        </>
      )}
    </div>
  );
}
function GameUnavailable({
  error,
  refresh,
  children,
}: {
  error: string;
  refresh: () => Promise<void>;
  children?: ReactNode;
}) {
  return (
    <main className="container auth-page">
      <div className="card auth-card">
        <div className="feature-icon">
          <Monitor size={28} />
        </div>
        <h1>Игра пока недоступна</h1>
        <ErrorMessage message={error} />
        <p className="muted">
          Проверьте ссылку и подключение. Для закрытых экранов нужен вход с
          подходящей ролью.
        </p>
        <div className="button-row">
          <button className="button primary" onClick={() => void refresh()}>
            <RefreshCw size={16} /> Повторить
          </button>
          <Link className="button secondary" to="/">
            На главную
          </Link>
        </div>
        {children}
      </div>
    </main>
  );
}
function TeamScores({
  teams,
  activeTeamId,
  compact = false,
}: {
  teams: PublicTeam[];
  activeTeamId: string | null;
  compact?: boolean;
}) {
  return (
    <div className={`team-scores ${compact ? "compact" : ""}`}>
      {teams.map((team) => (
        <div
          className={`team-score ${team.id === activeTeamId ? "active" : ""}`}
          key={team.id}
          style={{ "--team-color": team.color } as CSSProperties}
        >
          <span className="team-score-name">
            <span className="team-color-dot" />
            {team.name}
            {team.id === activeTeamId && <small>Отвечает</small>}
          </span>
          <strong>{team.score}</strong>
          <span className="score-unit">очков</span>
        </div>
      ))}
    </div>
  );
}
function Strikes({ count }: { count: number }) {
  return (
    <div className="strikes" aria-label={`Ошибок: ${count} из 3`}>
      {[1, 2, 3].map((index) => (
        <span key={index} className={index <= count ? "strike used" : "strike"}>
          <X size={26} strokeWidth={3} />
        </span>
      ))}
    </div>
  );
}
function RoundMeta({ game }: { game: PublicGame }) {
  return (
    <div className="round-meta">
      <span>
        Раунд {game.questionIndex + 1} / {game.totalRounds}
      </span>
      <span className="badge">×{game.multiplier} очки</span>
      {game.isDemo && (
        <span className="badge demo">Демонстрационный вопрос</span>
      )}
    </div>
  );
}

export function BoardPage() {
  const { gameId } = useParams();
  const { game, loading, error, connected, refresh } = useLiveGame<PublicGame>(
    gameId,
    "public",
  );
  const [fullscreenError, setFullscreenError] = useState("");
  const [projector, setProjector] = useState(false);
  useEffect(() => {
    try {
      setProjector(
        localStorage.getItem(`ctokodnomy:projector:${gameId}`) === "1",
      );
    } catch {
      setProjector(false);
    }
  }, [gameId]);
  function toggleProjector() {
    const next = !projector;
    setProjector(next);
    try {
      localStorage.setItem(`ctokodnomy:projector:${gameId}`, next ? "1" : "0");
    } catch {
      /* The contrast control also works without browser storage. */
    }
  }
  const sound = useGameSound(game, connected, error);
  if (loading) return <Loading />;
  if (!game) return <GameUnavailable error={error} refresh={refresh} />;
  async function fullscreen() {
    setFullscreenError("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setFullscreenError(
        "Полноэкранный режим недоступен. Можно использовать полноэкранный режим самого браузера.",
      );
    }
  }
  const activeTeam = game.teams.find((team) => team.id === game.activeTeamId);
  const standings = [...game.teams].sort(
    (first, second) => second.score - first.score,
  );
  const tied =
    standings.length > 1 && standings[0].score === standings[1].score;
  const displayBrand = projector
    ? { ...game.brand, ...projectorPalette }
    : game.brand;
  return (
    <main
      className={`board-page phase-${game.phase}`}
      style={brandStyle(displayBrand)}
      data-theme={isLightBrand(displayBrand) ? "light" : "dark"}
      data-projector={projector ? "true" : undefined}
    >
      <header className="board-header">
        <Link className="board-brand" to="/">
          {game.brand.gameLogoUrl || game.brand.logoUrl ? (
            <img
              src={game.brand.gameLogoUrl || game.brand.logoUrl}
              alt={game.brand.title}
            />
          ) : null}
          <strong>{game.brand.title}</strong>
          {game.brand.organizer && <span>{game.brand.organizer}</span>}
        </Link>
        <div className="board-header-actions">
          <Connection connected={connected} error={error} refresh={refresh} />
          <button
            type="button"
            className="projector-toggle"
            aria-pressed={projector}
            onClick={toggleProjector}
            title="Светлый фон, чёрный текст и чёткие границы для проектора"
          >
            <Sun size={18} /> Для проектора
          </button>
          <button
            className="icon-button"
            disabled={sound.busy}
            onClick={() => void sound.toggle()}
            aria-label={sound.enabled ? "Выключить звук" : "Включить звук"}
            aria-pressed={sound.enabled}
            title={sound.enabled ? "Звук включён" : "Включить звуки табло"}
          >
            {sound.enabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
          <button
            className="icon-button"
            onClick={() => void fullscreen()}
            aria-label="Полноэкранный режим"
          >
            <Maximize2 size={20} />
          </button>
        </div>
      </header>
      <ErrorMessage message={fullscreenError} />
      <ErrorMessage message={sound.error} />
      {error && (
        <div className="board-reconnect-notice" role="alert">
          Показано последнее полученное состояние. Восстанавливаем соединение.
        </div>
      )}
      <div className="board-content">
        {game.phase === "lobby" ? (
          <section className="board-lobby">
            <p className="eyebrow">{game.title}</p>
            <div className="board-lobby-mark">
              {game.brand.gameLogoUrl ? (
                <img src={game.brand.gameLogoUrl} alt="Логотип игры" />
              ) : (
                <>
                  100<span>к</span>1
                </>
              )}
            </div>
            <h1>Собираем команды</h1>
            <p>
              Готовьте самые неожиданные ответы.
              <br />
              Ведущий скоро начнёт игру.
            </p>
            <TeamScores teams={game.teams} activeTeamId={null} />
            <p className="board-guest-note">
              Игроки входят по приглашению ведущего. Гости — болеют за своих!
            </p>
            {game.brand.partnerLogoUrls.length > 0 && (
              <div className="partner-logos">
                {game.brand.partnerLogoUrls.map((url, index) => (
                  <img
                    key={`${url}-${index}`}
                    src={url}
                    alt="Партнёр мероприятия"
                  />
                ))}
              </div>
            )}
          </section>
        ) : game.phase === "finished" ? (
          <section className="board-finale">
            <div className="finale-icon">
              <Trophy size={46} />
            </div>
            <p className="eyebrow">{game.title} · Финал</p>
            <h1>Игра завершена</h1>
            <h2>
              {tied ? "Победила дружба!" : `Победители — ${standings[0]?.name}`}
            </h2>
            <p>Спасибо за ваши идеи, азарт и командную работу.</p>
            <div className="final-standings">
              {standings.map((team, index) => (
                <div
                  className={`final-team ${index === 0 ? "winner" : ""}`}
                  key={team.id}
                  style={{ "--team-color": team.color } as CSSProperties}
                >
                  <span className="final-place">{tied ? "1" : index + 1}</span>
                  <span className="final-team-name">{team.name}</span>
                  <strong>
                    {team.score}
                    <small>очков</small>
                  </strong>
                </div>
              ))}
            </div>
            {game.brand.partnerLogoUrls.length > 0 && (
              <div className="partner-logos">
                {game.brand.partnerLogoUrls.map((url) => (
                  <img key={url} src={url} alt="Партнёр мероприятия" />
                ))}
              </div>
            )}
            <Link className="button secondary" to="/">
              К другим играм <ArrowRight size={18} />
            </Link>
            {game.resultsAvailable && (
              <Link className="button primary" to={`/results/${game.id}`}>
                Ответы и итоги <ArrowRight size={18} />
              </Link>
            )}
          </section>
        ) : (
          <>
            <RoundMeta game={game} />
            <h1 className="board-question">{game.prompt}</h1>
            {game.phase === "round-result" && game.roundStats ? (
              <div className="board-round-statistics">
                <div className="board-round-complete" role="status">
                  <Check size={22} /> Раунд завершён. Смотрим все ответы!
                </div>
                <RoundStatistics
                  round={game.roundStats}
                  teams={game.teams}
                  compact
                />
              </div>
            ) : (
              <>
                <div className="board-answer-grid">
                  {game.answers.map((answer) => (
                    <div
                      key={answer.position}
                      className={`board-answer ${answer.opened ? "opened" : "closed"}`}
                      aria-label={
                        answer.opened
                          ? `${answer.position}. ${answer.text}: ${answer.points} очков`
                          : `Ответ ${answer.position} скрыт`
                      }
                    >
                      <span className="board-answer-number">
                        {String(answer.position).padStart(2, "0")}
                      </span>
                      <span className="board-answer-text">
                        {answer.opened ? (
                          answer.text
                        ) : (
                          <span className="hidden-answer-label">
                            {answer.position}
                          </span>
                        )}
                      </span>
                      {answer.opened && (
                        <strong className="board-answer-points">
                          {answer.points}
                        </strong>
                      )}
                    </div>
                  ))}
                </div>
                <div className="board-round-status">
                  <div className="round-bank">
                    <span>
                      {game.phase === "round-result"
                        ? "Банк раунда"
                        : "В банке"}
                    </span>
                    <strong>{game.bank}</strong>
                  </div>
                  <Strikes count={game.strikes} />
                  <div className="round-turn">
                    <span>
                      {game.phase === "steal"
                        ? "Шанс на перехват"
                        : game.phase === "round-result"
                          ? "Банк получает"
                          : "Ход команды"}
                    </span>
                    <strong>{activeTeam?.name ?? "Решает ведущий"}</strong>
                  </div>
                </div>
              </>
            )}
            <TeamScores
              teams={game.teams}
              activeTeamId={
                game.phase === "round-result" ? null : game.activeTeamId
              }
            />
            {game.phase === "round-result" && !game.roundStats && (
              <div className="board-round-complete">
                <Check size={19} /> Раунд завершён. Готовимся к следующему!
              </div>
            )}
          </>
        )}
      </div>
      {game.paused && (
        <div className="board-pause" role="status">
          <div>
            <Pause size={38} />
            <p className="eyebrow">Небольшой перерыв</p>
            <h2>Игра на паузе</h2>
            <p>Сейчас вернёмся — всё самое интересное впереди.</p>
          </div>
        </div>
      )}
      <footer className="board-footer">
        <span className="board-organizer">
          {game.brand.logoUrl && (
            <img src={game.brand.logoUrl} alt="Логотип организатора" />
          )}
          {game.brand.organizer || game.title}
        </span>
        <span>
          {[game.brand.footerText, game.brand.title]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </footer>
    </main>
  );
}

function readDraft(key: string) {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function useDraft(key: string) {
  const [value, setValue] = useState(() => readDraft(key));
  useEffect(() => {
    setValue(readDraft(key));
  }, [key]);
  function change(next: string) {
    setValue(next);
    try {
      if (next) sessionStorage.setItem(key, next);
      else sessionStorage.removeItem(key);
    } catch {
      /* The form still works when browser storage is unavailable. */
    }
  }
  return [value, change] as const;
}
type PendingSend = {
  kind: "suggest" | "submit";
  text: string;
  requestId: string;
  revision: number;
};

export function TeamPage() {
  const { gameId } = useParams();
  const { game, loading, error, connected, refresh } = useLiveGame<TeamGame>(
    gameId,
    "team",
  );
  const phaseKey = `${gameId}:${game?.self.id ?? "anonymous"}:${game?.questionIndex ?? "lobby"}:${game?.phase ?? "loading"}`;
  const [draft, setDraft] = useDraft(`ctokodnomy:suggestion:${phaseKey}`);
  const [answer, setAnswer] = useDraft(`ctokodnomy:answer:${phaseKey}`);
  const [busy, setBusy] = useState<"suggest" | "submit" | null>(null);
  const [sendError, setSendError] = useState("");
  const [notice, setNotice] = useState("");
  const lastAttempt = useRef<PendingSend | null>(null);
  useEffect(() => {
    setNotice("");
    setSendError("");
    lastAttempt.current = null;
  }, [phaseKey]);
  if (loading) return <Loading />;
  if (!game)
    return (
      <GameUnavailable error={error} refresh={refresh}>
        <Link className="text-link" to="/join">
          Войти по приглашению команды <ArrowRight size={16} />
        </Link>
      </GameUnavailable>
    );
  const team = game.teams.find((team) => team.id === game.self.teamId);
  const activeTeam = game.teams.find((team) => team.id === game.activeTeamId);
  const captain = game.players.find((player) => player.role === "captain");
  const isCaptain = game.self.role === "captain";
  const ownTurn = game.activeTeamId === game.self.teamId;
  const canSend =
    (game.phase === "playing" || game.phase === "steal") &&
    ownTurn &&
    !game.paused &&
    connected &&
    !error;
  async function send(kind: "suggest" | "submit", text: string) {
    if (!game || !text.trim()) return;
    setBusy(kind);
    setSendError("");
    setNotice("");
    const last = lastAttempt.current;
    const attempt: PendingSend =
      last?.kind === kind && last.text === text.trim()
        ? last
        : {
            kind,
            text: text.trim(),
            requestId: crypto.randomUUID(),
            revision: game.revision,
          };
    lastAttempt.current = attempt;
    try {
      await api<TeamGame>(`/games/${game.id}/${kind}`, {
        method: "POST",
        body: JSON.stringify({
          text: attempt.text,
          requestId: attempt.requestId,
          revision: attempt.revision,
        }),
      });
      lastAttempt.current = null;
      if (kind === "suggest") {
        setDraft("");
        setNotice("Предложение добавлено. Капитан увидит ваш вариант.");
      } else {
        setAnswer("");
        setNotice("Ответ доставлен ведущему. Ждём решения.");
      }
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status < 500)
        lastAttempt.current = null;
      await refresh();
      setSendError(
        err instanceof ApiError && err.status === 409
          ? "Состояние игры изменилось. Мы обновили экран. Проверьте ход и повторите действие, если оно ещё нужно."
          : err instanceof Error
            ? err.message
            : "Отправка не подтверждена. Проверьте список ответов перед повторной попыткой.",
      );
    } finally {
      setBusy(null);
    }
  }
  const statusText = game.paused
    ? "Игра на паузе"
    : game.phase === "lobby"
      ? "Ждём начала игры"
      : game.phase === "finished"
        ? "Спасибо за игру!"
        : game.phase === "round-result"
          ? "Раунд завершён"
          : ownTurn
            ? game.phase === "steal"
              ? "Ваш шанс на перехват"
              : "Сейчас ваш ход"
            : `Отвечает ${activeTeam?.name ?? "другая команда"}`;
  return (
    <main
      className="team-page"
      style={brandStyle(game.brand)}
      data-theme={isLightBrand(game.brand) ? "light" : "dark"}
    >
      <header className="team-header container">
        <Link className="text-link" to="/">
          <ArrowLeft size={17} />
          {(game.brand.gameLogoUrl || game.brand.logoUrl) && (
            <img
              className="team-game-logo"
              src={game.brand.gameLogoUrl || game.brand.logoUrl}
              alt=""
            />
          )}
          {game.brand.title}
        </Link>
        <Connection connected={connected} error={error} refresh={refresh} />
      </header>
      <div className="container team-container">
        <div className="team-identity">
          <p className="eyebrow">{game.title}</p>
          <h1 style={{ "--team-color": team?.color } as CSSProperties}>
            <span className="team-color-dot" />
            {team?.name}
          </h1>
          <p>
            {game.self.name}{" "}
            <span className={`badge ${isCaptain ? "captain" : ""}`}>
              {isCaptain && <Crown size={14} />}
              {isCaptain ? "Капитан" : "Игрок"}
            </span>
          </p>
        </div>
        <ErrorMessage message={error} />
        <ErrorMessage message={sendError} />
        {notice && (
          <div className="success" role="status">
            <Check size={17} />
            {notice}
          </div>
        )}
        <section
          className={`team-turn-card card ${ownTurn && !game.paused ? "your-turn" : ""}`}
        >
          <div className="team-status">
            <span className="status-dot" />
            <strong>{statusText}</strong>
            {game.phase === "steal" && (
              <span className="badge">Одна попытка</span>
            )}
          </div>
          {game.phase === "lobby" ? (
            <>
              <h2>Знакомьтесь и готовьтесь</h2>
              <p>
                Участники предлагают варианты, капитан выбирает общий ответ.
                Ведущий скоро покажет первый вопрос.
              </p>
              <p className="form-hint">
                {captain
                  ? `Ваш капитан — ${captain.name}.`
                  : "Ведущий ещё не назначил капитана."}
              </p>
            </>
          ) : game.phase === "finished" ? (
            <>
              <h2>Вы сыграли вместе!</h2>
              <p>
                Итоги уже на общем экране. Спасибо за ваши предложения и
                командную работу.
              </p>
              <TeamScores teams={game.teams} activeTeamId={null} compact />
              <Link
                className="button primary"
                to={
                  game.resultsAvailable
                    ? `/results/${game.id}`
                    : `/board/${game.id}`
                }
              >
                {game.resultsAvailable ? "Ответы и итоги" : "Посмотреть табло"}{" "}
                <Trophy size={17} />
              </Link>
            </>
          ) : (
            <>
              <RoundMeta game={game} />
              <h2 className="team-question">{game.prompt}</h2>
              <div className="team-bank-row">
                <span>
                  Банк: <strong>{game.bank}</strong>
                </span>
                <span>
                  Ваш счёт: <strong>{team?.score ?? 0}</strong>
                </span>
              </div>
              <p className="form-hint">
                {game.paused
                  ? "Во время паузы отправка закрыта. Черновик сохранится в этой вкладке."
                  : game.phase === "round-result"
                    ? "Ведущий готовит следующий раунд."
                    : !ownTurn
                      ? "Вы сможете предлагать ответы, когда ход перейдёт вашей команде."
                      : isCaptain
                        ? "Посмотрите предложения команды и отправьте один итоговый ответ."
                        : "Напишите идею — капитан увидит её в списке предложений."}
              </p>
              {game.phase === "round-result" && game.roundStats && (
                <details className="team-round-statistics" open>
                  <summary>Все ответы на этот вопрос</summary>
                  <RoundStatistics
                    round={game.roundStats}
                    teams={game.teams}
                    compact
                  />
                </details>
              )}
            </>
          )}
        </section>
        {game.phase !== "finished" && game.phase !== "round-result" && (
          <div
            className={`team-room-grid ${isCaptain || game.pendingAnswer ? "with-captain" : "member-room"}`}
          >
            <section className="card team-ideas">
              <div className="section-title small">
                <h2>Идеи команды</h2>
                <span className="badge">{game.suggestions.length}</span>
              </div>
              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send("suggest", draft);
                }}
              >
                <label className="field">
                  Ваше предложение
                  <textarea
                    maxLength={200}
                    rows={2}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Как бы вы ответили на вопрос?"
                    disabled={game.phase === "lobby"}
                  />
                </label>
                <button
                  className="button secondary"
                  disabled={
                    !canSend || !!busy || !draft.trim() || !!game.pendingAnswer
                  }
                >
                  <Plus size={17} />
                  {busy === "suggest" ? "Добавляем…" : "Предложить ответ"}
                </button>
              </form>
              {game.suggestions.length ? (
                <ul className="suggestion-list">
                  {[...game.suggestions].reverse().map((suggestion) => (
                    <li key={suggestion.id}>
                      <div>
                        <strong>{suggestion.text}</strong>
                        <span>
                          {suggestion.authorName}
                          {suggestion.participantId === game.self.id
                            ? " · вы"
                            : ""}
                        </span>
                      </div>
                      {isCaptain && (
                        <button
                          className="button ghost small"
                          type="button"
                          disabled={!canSend || !!game.pendingAnswer || !!busy}
                          onClick={() => {
                            setAnswer(suggestion.text);
                            setNotice("");
                          }}
                        >
                          Выбрать <ChevronRight size={16} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="empty-state small">
                  <p>Пока нет предложений. Первая идея может быть вашей.</p>
                </div>
              )}
            </section>
            <div className="stack">
              {isCaptain && !game.pendingAnswer && (
                <section className="card captain-panel">
                  <div className="captain-panel-title">
                    <Crown size={22} />
                    <h2>Ваш общий ответ</h2>
                  </div>
                  <p className="muted">
                    Один ответ от команды. Выберите идею из списка или напишите
                    свою.
                  </p>
                  <form
                    className="stack"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void send("submit", answer);
                    }}
                  >
                    <label className="field">
                      Итоговый ответ
                      <input
                        maxLength={200}
                        value={answer}
                        onChange={(event) => setAnswer(event.target.value)}
                        placeholder="Ответ от всей команды"
                        disabled={game.phase === "lobby"}
                      />
                    </label>
                    <button
                      className="button primary"
                      disabled={
                        !canSend ||
                        !!busy ||
                        !answer.trim() ||
                        !!game.pendingAnswer
                      }
                    >
                      <Send size={17} />
                      {busy === "submit"
                        ? "Отправляем…"
                        : "Отправить ответ ведущему"}
                    </button>
                  </form>
                </section>
              )}
              {game.pendingAnswer && (
                <section className="card pending-team-answer" role="status">
                  <span className="badge">Доставлено ведущему</span>
                  <h3>{game.pendingAnswer.text}</h3>
                  <p>
                    Отправил капитан {game.pendingAnswer.authorName}. Ждём
                    решения.
                  </p>
                </section>
              )}
            </div>
          </div>
        )}
        <details className="card team-roster">
          <summary>
            <Users size={19} /> Ваша команда{" "}
            <span className="badge">{game.players.length}</span>
          </summary>
          <ul>
            {game.players.map((player) => (
              <li key={player.id}>
                <span>
                  {player.name}
                  {player.id === game.self.id && <small>вы</small>}
                </span>
                {player.role === "captain" && (
                  <span className="badge captain">
                    <Crown size={13} /> Капитан
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
        <footer className="team-footer">
          {game.brand.footerText && <span>{game.brand.footerText}</span>}
          <Link to="/help">Правила и помощь</Link>
          <Link
            to={`/board/${game.id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Общее табло <ExternalLink size={14} />
          </Link>
        </footer>
      </div>
    </main>
  );
}

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
  const dialogRef = useRef<HTMLElement>(null);
  const lastAttempt = useRef<HostAttempt | null>(null);
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
  const multiplier =
    game.rules.multipliers[game.questionIndex] ??
    game.rules.multipliers.at(-1) ??
    1;
  const roundLive =
    (game.phase === "playing" || game.phase === "steal") && !game.paused;
  const disabled = busy || !connected || !!error;
  const activeTeam = game.teams.find((team) => team.id === game.activeTeamId);
  async function command(next: HostCommand) {
    if (!game) return;
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
      setBusy(false);
    }
  }
  async function makeCaptain(participantId: string) {
    if (!game) return;
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
      setBusy(false);
    }
  }
  async function publishResults() {
    if (!game) return;
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
      style={brandStyle(game.brand)}
      data-theme={isLightBrand(game.brand) ? "light" : "dark"}
    >
      <div className="container host-container">
        <header className="host-header">
          <div>
            <Link className="text-link" to="/admin">
              <ArrowLeft size={16} /> Админка
            </Link>
            <p className="eyebrow">Пульт ведущего</p>
            <h1>{game.title}</h1>
          </div>
          <div className="host-header-actions">
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
        <ErrorMessage message={error} />
        <ErrorMessage message={commandError} />
        {notice && (
          <div className="success" role="status">
            <Check size={17} />
            {notice}
          </div>
        )}
        <div className="host-status-bar">
          <span className="badge">
            {game.paused ? "На паузе" : phases[game.phase]}
          </span>
          <span>
            Раунд {game.questionIndex + 1} / {game.questions.length}
          </span>
          <span>
            Банк: <strong>{game.bank}</strong>
          </span>
          <span>Множитель ×{multiplier}</span>
          <span>
            Ход: <strong>{activeTeam?.name ?? "Не выбран"}</strong>
          </span>
          <Strikes count={game.strikes} />
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
          <div className="stack host-main">
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
                  {question.answers.map((answer, index) => {
                    const opened = game.openedAnswerIds.includes(answer.id);
                    return (
                      <div
                        className={`host-answer ${opened ? "opened" : ""}`}
                        key={answer.id}
                      >
                        <span className="answer-number">
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
          <aside className="stack host-controls">
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
            <section className="card host-journal">
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
        <section className="host-rosters">
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
