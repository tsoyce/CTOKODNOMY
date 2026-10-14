import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Check,
  CheckCheck,
  Clipboard,
  Eye,
  HelpCircle,
  RefreshCw,
  Sparkles,
  Trophy,
} from "lucide-react";
import { defaultBrand, type PublicGameResults } from "../../shared/types";
import { ApiError, api, brandStyle } from "../lib";
import { Loading } from "../components/Common";
import { RoundStatistics } from "../components/Statistics";
import { isLightBrand } from "../theme";
import "./Results.css";

const number = new Intl.NumberFormat("ru-RU");

function useResults(id: string | undefined) {
  const [report, setReport] = useState<PublicGameResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let stopped = false;
    let sequence = 0;
    let controller: AbortController | undefined;
    setReport(null);
    setLoading(true);
    setError("");
    setUnavailable(false);

    const update = async () => {
      if (!id) {
        setLoading(false);
        setUnavailable(true);
        return;
      }
      const current = ++sequence;
      controller?.abort();
      controller = new AbortController();
      try {
        const next = await api<PublicGameResults>(
          `/games/${encodeURIComponent(id)}/results`,
          { signal: controller.signal },
        );
        if (stopped || current !== sequence) return;
        setReport({ ...next, brand: { ...defaultBrand, ...next.brand } });
        setUnavailable(false);
        setError("");
      } catch (cause) {
        if (stopped || current !== sequence) return;
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        if (
          cause instanceof ApiError &&
          [401, 403, 404].includes(cause.status)
        ) {
          // Remove every answer when publication is withdrawn or a game is reset/deleted.
          setReport(null);
          setUnavailable(true);
          setError("");
        } else {
          setError(
            cause instanceof Error
              ? cause.message
              : "Не удалось обновить итоги. Попробуйте ещё раз.",
          );
        }
      } finally {
        if (!stopped && current === sequence) setLoading(false);
      }
    };
    refreshRef.current = () => void update();
    const visible = () => {
      if (document.visibilityState === "visible") void update();
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void update();
    }, 15000);
    document.addEventListener("visibilitychange", visible);
    void update();
    return () => {
      stopped = true;
      sequence += 1;
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      refreshRef.current = () => {};
    };
  }, [id]);

  return { report, loading, error, unavailable, refresh };
}

export default function ResultsPage() {
  const { gameId } = useParams();
  const { report, loading, error, unavailable, refresh } = useResults(gameId);
  const [question, setQuestion] = useState("all");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    setQuestion("all");
    setCopied(false);
    setCopyError("");
    return () => clearTimeout(copyTimer.current);
  }, [gameId]);

  if (loading) return <Loading />;
  if (!report) {
    return (
      <main className="results-unavailable container">
        <div className="results-empty-icon" aria-hidden="true">
          {unavailable ? <Eye size={32} /> : <RefreshCw size={32} />}
        </div>
        <p className="eyebrow">Итоги игры</p>
        <h1>
          {unavailable ? "Итоги пока недоступны" : "Не удалось загрузить итоги"}
        </h1>
        <p>
          {unavailable
            ? "После игры организатор сможет открыть эту страницу для всех. Если ссылка уже работала, публикация могла быть закрыта."
            : error || "Проверьте соединение и попробуйте ещё раз."}
        </p>
        <div className="results-empty-actions">
          <Link to="/" className="button secondary">
            <ArrowLeft size={17} /> На главную
          </Link>
          <button className="button primary" onClick={refresh}>
            <RefreshCw size={17} /> Проверить ещё раз
          </button>
        </div>
      </main>
    );
  }

  const teams = [...report.teams].sort((a, b) => b.score - a.score);
  const topScore = teams[0]?.score ?? 0;
  const winners = teams.filter((team) => team.score === topScore);
  const completed = report.rounds.filter((round) => round.completed);
  const guessed = report.rounds.reduce(
    (total, round) =>
      total + round.answers.filter((answer) => answer.opened).length,
    0,
  );
  const answers = report.rounds.reduce(
    (total, round) => total + round.answers.length,
    0,
  );
  const restored = report.rounds.some((round) => !round.completedAt);
  const bestRound = completed
    .filter((round) => round.winnerTeamId !== null)
    .sort((a, b) => b.awardedPoints - a.awardedPoints)[0];
  const visibleRounds =
    question === "all"
      ? report.rounds
      : report.rounds.filter(
          (round) => String(round.questionIndex) === question,
        );
  const partial = report.rounds.some((round) => !round.completed);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/results/${encodeURIComponent(report.id)}`,
      );
      setCopied(true);
      setCopyError("");
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopyError(
        "Не удалось скопировать ссылку. Её можно скопировать из адресной строки браузера.",
      );
    }
  };

  return (
    <div
      className="results-page"
      data-theme={isLightBrand(report.brand) ? "light" : "dark"}
      style={brandStyle(report.brand)}
    >
      <header className="results-navigation container">
        <Link to="/" className="results-brand" aria-label="На главную">
          {report.brand.gameLogoUrl || report.brand.logoUrl ? (
            <img
              src={report.brand.gameLogoUrl || report.brand.logoUrl}
              alt=""
            />
          ) : (
            <span className="results-brand-symbol">
              <Sparkles size={20} aria-hidden="true" />
            </span>
          )}
          <span>
            {report.brand.title}
            {report.brand.organizer && <small>{report.brand.organizer}</small>}
          </span>
        </Link>
        <Link className="button secondary small" to="/">
          <ArrowLeft size={16} /> На главную
        </Link>
      </header>

      <main className="container results-main">
        {!report.published && (
          <div className="results-preview-note" role="status">
            <Eye size={19} aria-hidden="true" />
            <span>
              <strong>Предпросмотр</strong> · итоги ещё не опубликованы. Гости
              пока не видят эту страницу.
            </span>
            <Link to={`/admin/games/${report.id}`}>
              Настроить публикацию <ArrowUpRight size={15} />
            </Link>
          </div>
        )}
        {error && (
          <div className="results-refresh-error" role="alert">
            <span>
              Не удалось обновить данные. Показаны последние загруженные итоги.
            </span>
            <button onClick={refresh}>
              <RefreshCw size={16} /> Повторить
            </button>
          </div>
        )}

        <section className="results-intro" aria-labelledby="results-heading">
          <div>
            <p className="results-kicker">
              <BarChart3 size={17} aria-hidden="true" /> Игра окончена. Ответы
              остаются.
            </p>
            <h1 id="results-heading">Итоги игры</h1>
            <p className="results-game-title">{report.title}</p>
            <p className="results-intro-description">
              Счёт команд, неожиданные ответы и вся картина по каждому вопросу.
            </p>
          </div>
          {report.published && (
            <div className="results-share">
              <button
                className="button primary"
                onClick={() => void copyLink()}
              >
                {copied ? <Check size={17} /> : <Clipboard size={17} />}
                {copied ? "Ссылка скопирована" : "Поделиться итогами"}
              </button>
              {copyError && <p role="alert">{copyError}</p>}
            </div>
          )}
        </section>

        <section
          className="results-scoreboard"
          aria-labelledby="results-score-heading"
        >
          <div className="results-scoreboard-title">
            <span className="results-trophy">
              <Trophy size={28} aria-hidden="true" />
            </span>
            <div>
              <p className="eyebrow">Финальный счёт</p>
              <h2 id="results-score-heading">
                {winners.length > 1
                  ? "Победила дружба — ничья!"
                  : "Есть победитель!"}
              </h2>
            </div>
          </div>
          <ol className="results-team-list">
            {teams.map((team, index) => (
              <li
                className={`results-team${team.score === topScore ? " results-team-winner" : ""}`}
                key={team.id}
              >
                <span
                  className="results-team-place"
                  aria-label={`${index === 0 || team.score !== teams[index - 1].score ? index + 1 : teams.findIndex((entry) => entry.score === team.score) + 1} место`}
                >
                  {teams.findIndex((entry) => entry.score === team.score) + 1}
                </span>
                <span className="results-team-name">
                  <strong>{team.name}</strong>
                  {team.score === topScore && (
                    <small>
                      {winners.length > 1
                        ? "Разделённое первое место"
                        : "Победитель игры"}
                    </small>
                  )}
                </span>
                <span className="results-team-score">
                  <strong>{number.format(team.score)}</strong>
                  <small>очков</small>
                </span>
              </li>
            ))}
          </ol>
        </section>

        {restored && (
          <p className="results-history-note">
            Показаны сохранённые сведения о ранее сыгранной партии. Данные об
            открытых ответах и начислении банка могут быть неполными.
          </p>
        )}
        <section className="results-metrics" aria-label="Игра в цифрах">
          <div className="results-metric">
            <BarChart3 size={21} aria-hidden="true" />
            <strong>
              {number.format(completed.length)}{" "}
              <small>из {number.format(report.totalRounds)}</small>
            </strong>
            <span>раундов завершено</span>
          </div>
          <div className="results-metric">
            <CheckCheck size={21} aria-hidden="true" />
            <strong>
              {number.format(guessed)}{" "}
              <small>из {number.format(answers)}</small>
            </strong>
            <span>
              {restored
                ? "открытий сохранилось в истории"
                : "ответов открыли в игре"}
            </span>
          </div>
          <div className="results-metric">
            <Trophy size={21} aria-hidden="true" />
            <strong>
              {restored && !bestRound
                ? "—"
                : number.format(bestRound?.awardedPoints ?? 0)}{" "}
              <small>очков</small>
            </strong>
            <span>
              {bestRound && bestRound.awardedPoints > 0
                ? `самый результативный раунд · № ${bestRound.questionIndex + 1}`
                : restored && !bestRound
                  ? "банк раундов не сохранился"
                  : "максимум за завершённый раунд"}
            </span>
          </div>
        </section>

        <section
          className="results-questions"
          aria-labelledby="results-questions-heading"
        >
          <header className="results-questions-heading">
            <div>
              <p className="eyebrow">За каждым ответом — мнение</p>
              <h2 id="results-questions-heading">Как отвечали на вопросы</h2>
              <p>
                Здесь открыты все ответы на сыгранные вопросы, включая те, что
                команды не угадали.
              </p>
            </div>
            {report.rounds.length > 1 && (
              <label className="results-question-filter">
                <span>Выбрать вопрос</span>
                <select
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                >
                  <option value="all">
                    Все вопросы · {report.rounds.length}
                  </option>
                  {report.rounds.map((round) => (
                    <option
                      key={round.questionIndex}
                      value={String(round.questionIndex)}
                    >
                      Вопрос {round.questionIndex + 1}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </header>
          {partial && (
            <div className="results-partial-note">
              <HelpCircle size={18} aria-hidden="true" />
              <p>
                Игра завершилась досрочно. Незавершённый раунд отмечен отдельно;
                вопросы, до которых не дошли, здесь не раскрываются.
              </p>
            </div>
          )}
          <div className="results-rounds">
            {visibleRounds.map((round) => (
              <RoundStatistics
                key={round.questionId}
                round={round}
                teams={report.teams}
              />
            ))}
            {report.rounds.length === 0 && (
              <div className="results-no-rounds">
                <BarChart3 size={30} aria-hidden="true" />
                <h3>В этой игре ещё не было вопросов</h3>
                <p>Игра завершилась до начала первого раунда.</p>
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="results-footer container">
        <div>
          {report.brand.logoUrl && (
            <img src={report.brand.logoUrl} alt="Логотип организатора" />
          )}
          <span>
            {[report.brand.organizer, report.brand.footerText]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        {report.brand.partnerLogoUrls.length > 0 && (
          <div className="results-partners" aria-label="Партнёры мероприятия">
            {report.brand.partnerLogoUrls.map((url, index) => (
              <img
                src={url}
                key={`${url}-${index}`}
                alt={`Логотип партнёра ${index + 1}`}
              />
            ))}
          </div>
        )}
        <Link to="/help">
          Как играть <ArrowUpRight size={14} />
        </Link>
      </footer>
    </div>
  );
}
