import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { BarChart3, Check, Cloud, ListOrdered, Trophy } from "lucide-react";
import type { PublicRoundStats, PublicTeam } from "../../shared/types";
import "./Statistics.css";

const number = new Intl.NumberFormat("ru-RU");
const percent = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

function surveyDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}

export function RoundStatistics({
  round,
  teams,
  compact = false,
  preferredView,
  preferenceRevision,
}: {
  round: PublicRoundStats;
  teams: PublicTeam[];
  compact?: boolean;
  preferredView?: "list" | "cloud";
  preferenceRevision?: number;
}) {
  const headingId = useId();
  const visualizationId = useId();
  const [order, setOrder] = useState<"popular" | "board">("popular");
  const [view, setView] = useState<"list" | "cloud">(preferredView ?? "list");
  // A repeated command from the host must also override a local selection.
  useEffect(() => {
    if (preferredView) setView(preferredView);
  }, [preferredView, preferenceRevision]);
  const answers = useMemo(
    () =>
      [...round.answers].sort((a, b) =>
        order === "popular"
          ? b.points - a.points || a.position - b.position
          : a.position - b.position,
      ),
    [round.answers, order],
  );
  // Older saved reports contain only board answers and do not have onBoard.
  const boardAnswers = round.answers.filter((answer) => answer.onBoard !== false);
  const boardAnswerCount = round.boardAnswerCount ?? boardAnswers.length;
  const guessed = boardAnswers.filter((answer) => answer.opened).length;
  const maxWeight = Math.max(0, ...round.answers.map((answer) => answer.points));
  const winner = teams.find((team) => team.id === round.winnerTeamId);
  const date = surveyDate(round.surveyDate);
  const restored = !round.completedAt;
  const outsideBoardLabel =
    boardAnswerCount === 6 ? "Вне ТОП-6" : "Не было на табло";

  return (
    <section
      className={`round-statistics${compact ? " round-statistics-compact" : ""}${round.answers.length > boardAnswerCount ? " round-statistics-full-survey" : ""}`}
      aria-labelledby={headingId}
    >
      <header className="statistics-header">
        <div>
          {compact ? (
            <h2 id={headingId}>Как отвечали на вопрос</h2>
          ) : (
            <>
              <p className="statistics-round-label">
                <BarChart3 size={16} aria-hidden="true" /> Вопрос{" "}
                {round.questionIndex + 1}
              </p>
              <h3 id={headingId}>{round.prompt}</h3>
            </>
          )}
        </div>
        <span className="statistics-guessed">
          <Check size={17} aria-hidden="true" />
          {restored ? "Сохранено открытий" : "Угадали"} {guessed} из{" "}
          {boardAnswerCount}
        </span>
      </header>

      <div className="statistics-summary">
        {winner ? (
          <p>
            <Trophy size={17} aria-hidden="true" />
            <span>
              Раунд забрала команда <strong>{winner.name}</strong>
            </span>
            <strong className="statistics-awarded">
              +{number.format(round.awardedPoints)} очков
            </strong>
          </p>
        ) : (
          <p>
            {round.completed
              ? "Детали начисления этого раунда не сохранились"
              : "Игра завершена досрочно · раунд не доигран"}
          </p>
        )}
        {round.multiplier !== 1 && <span>Множитель ×{round.multiplier}</span>}
      </div>

      <div className="statistics-chart-heading">
        <div className="statistics-chart-title">
          <strong>Все ответы опроса</strong>
          <span>
            Всего вариантов: {number.format(round.answers.length)} · На табло:{" "}
            {number.format(boardAnswerCount)}
          </span>
        </div>
        <div
          className="statistics-view-switch"
          role="group"
          aria-label="Вид статистики"
        >
          <button
            type="button"
            aria-pressed={view === "list"}
            aria-controls={visualizationId}
            onClick={() => setView("list")}
          >
            <BarChart3 size={17} aria-hidden="true" /> Список
          </button>
          <button
            type="button"
            aria-pressed={view === "cloud"}
            aria-controls={visualizationId}
            onClick={() => setView("cloud")}
          >
            <Cloud size={18} aria-hidden="true" /> Облако ответов
          </button>
        </div>
      </div>

      <div className="statistics-visualization" id={visualizationId}>
        {view === "cloud" ? (
          <>
            <p className="statistics-cloud-note">
              Популярные ответы крупнее. Число рядом — вес ответа в опросе;
              здесь есть и редкие варианты, которые не попали на игровое табло.
            </p>
            <ul
              className="statistics-answer-cloud"
              aria-label="Облако всех ответов опроса"
              tabIndex={0}
            >
              {[...round.answers]
                .sort((a, b) => b.points - a.points || a.position - b.position)
                .map((answer) => (
                  <li
                    key={answer.position}
                    className={`statistics-cloud-word${answer.onBoard === false ? " statistics-cloud-word-extra" : ""}`}
                    style={
                      {
                        "--cloud-weight":
                          maxWeight > 0
                            ? Math.sqrt(Math.max(0, answer.points) / maxWeight)
                            : 0,
                      } as CSSProperties
                    }
                  >
                    <span className="statistics-cloud-phrase">
                      {answer.text}
                    </span>
                    <span
                      className="statistics-cloud-count"
                      aria-label={`Вес ответа: ${number.format(answer.points)}`}
                    >
                      {number.format(answer.points)}
                    </span>
                    {answer.onBoard === false && (
                      <span className="statistics-cloud-status">
                        {outsideBoardLabel}
                      </span>
                    )}
                  </li>
                ))}
            </ul>
          </>
        ) : (
          <>
            <div className="statistics-list-heading">
              <span>Все ответы и их вес в опросе</span>
              <label>
                <ListOrdered size={16} aria-hidden="true" />
                <span className="sr-only">Порядок ответов</span>
                <select
                  aria-label="Порядок ответов"
                  value={order}
                  onChange={(event) =>
                    setOrder(event.target.value as "popular" | "board")
                  }
                >
                  <option value="popular">По популярности</option>
                  <option value="board">По порядку вариантов</option>
                </select>
              </label>
            </div>
            <ol
              className="statistics-answer-list"
              tabIndex={compact ? 0 : undefined}
              aria-label="Все ответы опроса"
            >
              {answers.map((answer) => {
                const share = Number.isFinite(answer.share)
                  ? Math.max(0, Math.min(100, answer.share))
                  : 0;
                return (
                  <li
                    className={
                      answer.onBoard !== false && answer.opened
                        ? "statistics-answer guessed"
                        : `statistics-answer${answer.onBoard === false ? " statistics-answer-extra" : ""}`
                    }
                    key={answer.position}
                  >
                    <span
                      className="statistics-answer-position"
                      aria-label={`Ответ ${answer.position}`}
                    >
                      {String(answer.position).padStart(2, "0")}
                    </span>
                    <div className="statistics-answer-main">
                      <div className="statistics-answer-caption">
                        <strong>{answer.text}</strong>
                        <span className="statistics-answer-weight">
                          {number.format(answer.points)} <small>вес</small>
                        </span>
                      </div>
                      <div className="statistics-bar-row">
                        <div className="statistics-bar-track" aria-hidden="true">
                          <div
                            className="statistics-bar"
                            style={{ width: `${share}%` }}
                          />
                        </div>
                        <span
                          className="statistics-answer-share"
                          aria-label={`${percent.format(share)} процентов суммы весов всех ответов`}
                        >
                          {percent.format(share)}%
                        </span>
                      </div>
                      <span className="statistics-answer-outcome">
                        {answer.onBoard === false ? (
                          outsideBoardLabel
                        ) : answer.opened ? (
                          <>
                            <Check size={14} aria-hidden="true" /> Угадали
                          </>
                        ) : restored ? (
                          "Открытие не сохранилось в истории"
                        ) : (
                          "Не открыли в игре"
                        )}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>

      <footer className="statistics-source">
        <p className="statistics-denominator">
          Проценты — доля суммы весов всех ответов опроса, а не доля опрошенных.
          {round.totalPoints === 0 && " Сумма весов равна нулю."}
        </p>
        {restored && (
          <p>
            Это ранее сыгранный раунд: часть сведений о ходе игры могла не
            сохраниться.
          </p>
        )}
        <div className="statistics-source-details">
          {round.isDemo && (
            <strong className="statistics-demo-label">
              Учебный вопрос · ответы условные
            </strong>
          )}
          <span>Источник: {round.source || "не указан"}</span>
          {date && <span>Дата опроса: {date}</span>}
          {round.respondentCount !== null && (
            <span>Опрошено: {number.format(round.respondentCount)}</span>
          )}
        </div>
      </footer>
    </section>
  );
}
