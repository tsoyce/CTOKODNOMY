import { useId, useMemo, useState } from "react";
import { BarChart3, Check, ListOrdered, Trophy } from "lucide-react";
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
}: {
  round: PublicRoundStats;
  teams: PublicTeam[];
  compact?: boolean;
}) {
  const headingId = useId();
  const [order, setOrder] = useState<"popular" | "board">("popular");
  const answers = useMemo(
    () =>
      [...round.answers].sort((a, b) =>
        order === "popular"
          ? b.points - a.points || a.position - b.position
          : a.position - b.position,
      ),
    [round.answers, order],
  );
  const guessed = round.answers.filter((answer) => answer.opened).length;
  const winner = teams.find((team) => team.id === round.winnerTeamId);
  const date = surveyDate(round.surveyDate);
  const restored = !round.completedAt;

  return (
    <section
      className={`round-statistics${compact ? " round-statistics-compact" : ""}`}
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
          {round.answers.length}
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
        <span>Ответы и их вес на табло</span>
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
            <option value="board">Как на табло</option>
          </select>
        </label>
      </div>

      <ol className="statistics-answer-list">
        {answers.map((answer) => {
          const share = Number.isFinite(answer.share)
            ? Math.max(0, Math.min(100, answer.share))
            : 0;
          return (
            <li
              className={
                answer.opened
                  ? "statistics-answer guessed"
                  : "statistics-answer"
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
                    {number.format(answer.points)} <small>очков</small>
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
                    aria-label={`${percent.format(share)} процентов суммы очков ответов`}
                  >
                    {percent.format(share)}%
                  </span>
                </div>
                <span className="statistics-answer-outcome">
                  {answer.opened ? (
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

      <footer className="statistics-source">
        <p className="statistics-denominator">
          Проценты — доля суммы очков ответов на табло, а не доля опрошенных.
          {round.totalPoints === 0 && " Сумма очков равна нулю."}
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
