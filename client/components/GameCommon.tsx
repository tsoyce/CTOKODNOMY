import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Monitor, RefreshCw, Wifi, WifiOff, X } from "lucide-react";
import type { PublicGame, PublicTeam } from "../../shared/types";
import { ErrorMessage } from "./Common";

export const phases = {
  lobby: "Ожидание старта",
  playing: "Идёт раунд",
  steal: "Перехват",
  "round-result": "Раунд завершён",
  finished: "Игра завершена",
};
export function Connection({
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
export function GameUnavailable({
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
export function TeamScores({
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
export function Strikes({ count }: { count: number }) {
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
export function RoundMeta({ game, children }: { game: PublicGame; children?: ReactNode }) {
  return (
    <div className="round-meta">
      <span>
        Раунд {game.questionIndex + 1} / {game.totalRounds}
      </span>
      <span className="badge">×{game.multiplier} очки</span>
      {game.isDemo && (
        <span className="badge demo">Демонстрационный вопрос</span>
      )}
      {children}
    </div>
  );
}

