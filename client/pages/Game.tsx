import {
  useEffect,
  useCallback,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Crown,
  ExternalLink,
  HelpCircle,
  Maximize2,
  Minimize2,
  Monitor,
  Pause,
  Plus,
  Send,
  Sun,
  Trophy,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import type {
  PublicGame,
  TeamGame,
} from "../../shared/types";
import { api, ApiError, brandStyle, useAppearance, useLiveGame } from "../lib";
import { ErrorMessage, Loading } from "../components/Common";
import { useGameSound } from "../components/BoardSound";
import { RoundStatistics } from "../components/Statistics";
import { ThemeToggle } from "../components/ThemeToggle";
import { isLightBrand, projectorPalette } from "../theme";
import { filterTeamIdeas, groupTeamIdeas, sortTeamIdeas, type TeamIdeaOrder } from "../../shared/teamIdeas";
import "./Game.css";
import "./TeamRoom.css";

import { Connection, GameUnavailable, TeamScores, Strikes, RoundMeta } from "../components/GameCommon";
export function BoardPage() {
  const { gameId } = useParams();
  const { game, loading, error, connected, refresh } = useLiveGame<PublicGame>(
    gameId,
    "public",
  );
  const [fullscreenError, setFullscreenError] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [projector, setProjector] = useState(false);
  const fullscreen = useCallback(async () => {
    setFullscreenError("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setFullscreenError(
        "Полноэкранный режим недоступен. Можно использовать полноэкранный режим самого браузера.",
      );
    }
  }, []);
  useEffect(() => {
    function syncFullscreen() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    function handleShortcut(event: KeyboardEvent) {
      const target = event.target;
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.code !== "KeyF" && event.key.toLowerCase() !== "f") ||
        (target instanceof HTMLElement &&
          target.closest("input, textarea, select, [contenteditable], [role='textbox']"))
      ) return;
      event.preventDefault();
      void fullscreen();
    }
    syncFullscreen();
    document.addEventListener("fullscreenchange", syncFullscreen);
    document.addEventListener("keydown", handleShortcut);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreen);
      document.removeEventListener("keydown", handleShortcut);
    };
  }, [fullscreen]);
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
            type="button"
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
            type="button"
            onClick={() => void fullscreen()}
            aria-label={isFullscreen ? "Выйти из полноэкранного режима" : "Развернуть на весь экран"}
            aria-pressed={isFullscreen}
            title={isFullscreen ? "Выйти из полноэкранного режима · F" : "На весь экран · F"}
          >
            {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
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
            <RoundMeta game={game}>
              <span className={`board-phase-pill ${game.phase === "steal" ? "steal" : ""}`}>
                {game.paused ? "Пауза" : game.phase === "steal" ? "Перехват" : game.phase === "round-result" ? "Раунд завершён" : "Идёт раунд"}
              </span>
              <span className="board-reveal-count">
                Открыто {game.answers.filter((answer) => answer.opened).length} из {game.answers.length}
              </span>
            </RoundMeta>
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
                  preferredView={game.statisticsView}
                  preferenceRevision={game.revision}
                />
              </div>
            ) : (
              <>
                <div className="board-answer-grid" role="list" aria-label="Ответы на табло">
                  {game.answers.map((answer) => (
                    <div
                      key={answer.position}
                      className={`board-answer ${answer.opened ? "opened" : "closed"}`}
                      role="listitem"
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
                            Ответ скрыт
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
                  <div className="board-errors">
                    <span>Ошибки</span>
                    <Strikes count={game.strikes} />
                  </div>
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
  const { resolveAppearance } = useAppearance();
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
  const sendInFlight = useRef(false);
  const captainForm = useRef<HTMLFormElement>(null);
  const [ideaSearch, setIdeaSearch] = useState("");
  const [ideaOrder, setIdeaOrder] = useState<TeamIdeaOrder>("newest");
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
  const players = game.players.filter((player) => player.teamId === game.self.teamId).sort((a, b) =>
    Number(b.role === "captain") - Number(a.role === "captain") ||
    Number(b.id === game.self.id) - Number(a.id === game.self.id) ||
    a.name.localeCompare(b.name, "ru"),
  );
  const captain = players.find((player) => player.role === "captain");
  const suggestions = game.suggestions.filter((suggestion) => suggestion.teamId === game.self.teamId);
  const ideaGroups = groupTeamIdeas(suggestions);
  const visibleIdeas = sortTeamIdeas(filterTeamIdeas(ideaGroups, ideaSearch), ideaOrder);
  const isCaptain = game.self.role === "captain";
  const ownTurn = game.activeTeamId === game.self.teamId;
  const canSend =
    (game.phase === "playing" || game.phase === "steal") &&
    ownTurn &&
    !game.paused &&
    connected &&
    !error;
  async function send(kind: "suggest" | "submit", text: string) {
    if (!game || !text.trim() || !canSend || game.pendingAnswer || sendInFlight.current) return;
    sendInFlight.current = true;
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
      sendInFlight.current = false;
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
  const displayBrand = resolveAppearance(game.brand);
  return (
    <main
      className="team-page"
      style={brandStyle(displayBrand)}
      data-theme={isLightBrand(displayBrand) ? "light" : "dark"}
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
        <div className="team-header-actions">
          <Connection connected={connected} error={error} refresh={refresh} />
          <ThemeToggle />
        </div>
      </header>
      <div className="container team-container">
        <nav className="team-room-nav" aria-label="Навигация игрока">
          <span aria-current="page"><Users size={17} /> Моя команда</span>
          <Link to={`/board/${game.id}`} target="_blank" rel="noopener noreferrer">
            <Monitor size={17} /> Общее табло <ExternalLink size={13} />
          </Link>
          <Link to="/help"><HelpCircle size={17} /> Правила</Link>
        </nav>
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
                <span className="badge" aria-label={`Предложений: ${suggestions.length}`}>{suggestions.length}</span>
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
              {suggestions.length > 0 && (
                <div className="team-idea-tools">
                  <label className="field">
                    Поиск идей команды
                    <input
                      type="search"
                      value={ideaSearch}
                      onChange={(event) => setIdeaSearch(event.target.value)}
                      placeholder="Идея или имя участника"
                    />
                  </label>
                  <label className="field">
                    Порядок идей
                    <select value={ideaOrder} onChange={(event) => setIdeaOrder(event.target.value as TeamIdeaOrder)}>
                      <option value="newest">Сначала новые</option>
                      <option value="frequent">Сначала частые</option>
                    </select>
                  </label>
                  {ideaSearch && (
                    <button className="button ghost small" type="button" onClick={() => setIdeaSearch("")}>
                      Очистить поиск идей
                    </button>
                  )}
                  <p className="form-hint team-idea-hint">Одинаковые идеи собраны вместе. Частота — число сообщений, а не голоса.</p>
                </div>
              )}
              {visibleIdeas.length ? (
                <ul className="suggestion-list">
                  {visibleIdeas.map((group) => (
                    <li className="team-idea-group" key={group.key}>
                      <div className="team-idea-main">
                        <strong>{group.latest.text}</strong>
                        <span className="team-idea-authors">
                          {group.authorNames.join(", ")}
                          {group.suggestions.some((suggestion) => suggestion.participantId === game.self.id) ? " · есть ваша идея" : ""}
                        </span>
                        {group.suggestions.length > 1 && (
                          <details className="team-idea-originals">
                            <summary>Все предложения этой идеи · {group.suggestions.length}</summary>
                            <ul>
                              {group.suggestions.map((suggestion) => (
                                <li key={suggestion.id}>
                                  <p>{suggestion.text}</p>
                                  <span>{suggestion.authorName}{suggestion.participantId === game.self.id ? " · вы" : ""}</span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                      {isCaptain && (
                        <button
                          className="button ghost small"
                          type="button"
                          disabled={!canSend || !!game.pendingAnswer || !!busy}
                          onClick={() => {
                            setAnswer(group.latest.text);
                            setNotice("");
                            captainForm.current?.scrollIntoView({
                              behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                              block: "nearest",
                            });
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
                  <p>{suggestions.length ? "Ничего не найдено. Попробуйте другое слово или имя." : "Пока нет предложений. Первая идея может быть вашей."}</p>
                </div>
              )}
            </section>
            {(isCaptain || game.pendingAnswer) && <div className="stack team-captain-column">
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
                    ref={captainForm}
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
            </div>}
          </div>
        )}
        <details className="card team-roster">
          <summary>
            <Users size={19} /> Ваша команда{" "}
            <span className="badge">{players.length}</span>
          </summary>
          <ul>
            {players.map((player) => (
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
          <span>{game.brand.organizer || game.brand.title}</span>
        </footer>
      </div>
    </main>
  );
}
