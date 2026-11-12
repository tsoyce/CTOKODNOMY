export interface Brand {
  title: string;
  description: string;
  organizer: string;
  heroTitle: string;
  heroNote: string;
  footerText: string;
  primary: string;
  accent: string;
  background: string;
  textColor: string;
  logoUrl: string;
  gameLogoUrl: string;
  faviconUrl: string;
  partnerLogoUrls: string[];
  soundCorrectUrl: string;
  soundWrongUrl: string;
  soundBankUrl: string;
  soundRepeatUrl: string;
  soundStartUrl: string;
  soundRoundUrl: string;
  soundBuzzUrl: string;
  soundStealUrl: string;
  soundTimerUrl: string;
  soundTimeUpUrl: string;
  soundFinishUrl: string;
  soundPrizeUrl: string;
}
export const defaultBrand: Brand = {
  title: "100 к 1",
  description:
    "Один вопрос. Множество мнений. Соберите команду и угадайте самые популярные ответы.",
  organizer: "",
  heroTitle: "Вместе знаем больше.",
  heroNote: "Для игроков и гостей. Прямо в браузере.",
  footerText: "Играем вместе",
  primary: "#7559ff",
  accent: "#edff7a",
  background: "#111222",
  textColor: "#f4f3ff",
  logoUrl: "",
  gameLogoUrl: "",
  faviconUrl: "",
  partnerLogoUrls: [],
  soundCorrectUrl: "",
  soundWrongUrl: "",
  soundBankUrl: "",
  soundRepeatUrl: "",
  soundStartUrl: "",
  soundRoundUrl: "",
  soundBuzzUrl: "",
  soundStealUrl: "",
  soundTimerUrl: "",
  soundTimeUpUrl: "",
  soundFinishUrl: "",
  soundPrizeUrl: "",
};
export interface Answer {
  id: string;
  text: string;
  points: number;
  aliases: string[];
  /** Private source phrases for the organizer; never included in public statistics. */
  originals?: string[];
}
export interface Question {
  id: string;
  prompt: string;
  answers: Answer[];
  source: string;
  surveyDate: string;
  respondentCount: number | null;
  notes: string;
  isDemo: boolean;
  pack: string;
}
export interface Team {
  id: string;
  name: string;
  color: string;
  score: number;
  joinCode: string;
  joinOpen: boolean;
}
export interface Participant {
  id: string;
  gameId: string;
  teamId: string;
  name: string;
  role: "player" | "captain";
}
export interface Suggestion {
  id: string;
  teamId: string;
  participantId: string;
  authorName: string;
  text: string;
  createdAt: string;
}
export interface OfficialAnswer extends Suggestion {}
export type Phase = "lobby" | "playing" | "steal" | "round-result" | "finished";
export interface Rules {
  multipliers: number[];
  stealAddsPoints: boolean;
  /** Older games omit mode and retain the original flexible rules. */
  mode?: "standard" | "classic";
  /** Classic big final: two players, one player, or no final. Absent means two. */
  finalPlayers?: 0 | 1 | 2;
}
export interface ClassicFinalEntry {
  text: string;
  answerId: string | null;
  points: number;
}
export interface ClassicState {
  stage: "duel" | "play" | "reverse" | "tiebreak" | "final";
  /** Position 1–5 of the next player in an ordinary round. */
  activePlayerIndex?: number | null;
  duel: {
    firstTeamId: string | null;
    awaitingTeamId: string | null;
    firstAnswerPosition: number | null;
    attempts: number;
    /** Position 1–5 of the player currently answering at the button. */
    playerIndex?: number;
  } | null;
  reverse: {
    firstTeamId: string;
    attempts: number;
    deadlineAt?: number | null;
    remainingMs?: number | null;
    /** Awards already decided in this reverse round; absent in early saved states. */
    awards?: Array<{ teamId: string; points: number }>;
  } | null;
  final: {
    teamId: string;
    player: 1 | 2;
    attemptId?: string;
    phase: "ready" | "answering" | "review" | "complete";
    deadlineAt: number | null;
    remainingMs: number | null;
    entries: [Array<ClassicFinalEntry | null>, Array<ClassicFinalEntry | null>];
    score: number;
    /** Number of finalists; absent in games saved before the setting existed. */
    players?: 1 | 2;
    /** Points needed for the super prize; absent means 200. */
    target?: number;
  } | null;
}
/** What the public board should signal for the latest host decision. */
export type SoundCue =
  | "reveal" | "strike" | "repeat" | "buzz" | "start" | "round"
  | "steal" | "timer" | "finish" | "prize";
export interface GameEvent {
  id: string;
  type: string;
  message: string;
  cue?: SoundCue;
  createdAt: string;
}
export interface RoundResult {
  questionIndex: number;
  winnerTeamId: string | null;
  awardedPoints: number;
  /** Reverse play can award both teams; null means the historical breakdown is unknown. */
  teamAwards?: Array<{ teamId: string; points: number }> | null;
  openedAnswerIds: string[];
  strikes: number;
  multiplier: number;
  completed: boolean;
  completedAt: string;
}
export interface GameSnapshot {
  teams: Team[];
  questionIndex: number;
  phase: Phase;
  paused: boolean;
  activeTeamId: string | null;
  originTeamId: string | null;
  bank: number;
  strikes: number;
  openedAnswerIds: string[];
  pendingAnswer: OfficialAnswer | null;
  suggestions: Suggestion[];
  roundResults: RoundResult[];
  resultsPublished: boolean;
  /** Missing in older saved games; shown as a list until the host changes it. */
  statisticsView?: "list" | "cloud";
  classic?: ClassicState;
}
export interface GameState extends GameSnapshot {
  id: string;
  title: string;
  brand: Brand;
  questions: Question[];
  /** Absent in older games, whose original board layout must remain intact. */
  boardAnswerLimit?: number;
  rules: Rules;
  revision: number;
  events: GameEvent[];
  history: GameSnapshot[];
  createdAt: string;
}
export interface PublicTeam {
  id: string;
  name: string;
  color: string;
  score: number;
}
export interface PublicAnswer {
  position: number;
  opened: boolean;
  text?: string;
  points?: number;
}
export interface PublicRoundStats {
  questionId: string;
  questionIndex: number;
  prompt: string;
  source: string;
  surveyDate: string;
  respondentCount: number | null;
  isDemo: boolean;
  boardAnswerCount: number;
  answers: Array<{
    position: number;
    text: string;
    points: number;
    opened: boolean;
    onBoard: boolean;
    /** Percentage of answer weights; not necessarily a population percentage. */
    share: number;
  }>;
  totalPoints: number;
  multiplier: number;
  winnerTeamId: string | null;
  awardedPoints: number;
  teamAwards?: Array<{ teamId: string; points: number }> | null;
  strikes: number;
  completed: boolean;
  completedAt: string;
}
export interface PublicGame {
  id: string;
  title: string;
  brand: Brand;
  teams: PublicTeam[];
  revision: number;
  lastAction?: SoundCue | null;
  lastActionEventId?: string;
  phase: Phase;
  paused: boolean;
  activeTeamId: string | null;
  bank: number;
  strikes: number;
  questionIndex: number;
  totalRounds: number;
  multiplier: number;
  prompt: string;
  answers: PublicAnswer[];
  isDemo: boolean;
  roundStats: PublicRoundStats | null;
  statisticsView: "list" | "cloud";
  resultsAvailable: boolean;
  /** Public progress only; unrevealed final answers never leave the host. */
  classic?: {
    stage: ClassicState["stage"];
    activePlayerIndex?: number | null;
    duel: ClassicState["duel"];
    reverse: ClassicState["reverse"];
    final: (Pick<NonNullable<ClassicState["final"]>, "teamId" | "player" | "phase" | "deadlineAt" | "remainingMs" | "score"> & {
      players: 1 | 2;
      target: number;
      /** Five rows of the finalists' answers as the host marks them. */
      rows: Array<[PublicFinalCell | null, PublicFinalCell | null]>;
    }) | null;
  };
}
/** A marked final answer; the first finalist's cells are masked while the second plays. */
export type PublicFinalCell = { hidden: true } | { hidden?: false; text: string; points: number };
export interface PublicGameResults {
  id: string;
  title: string;
  brand: Brand;
  teams: PublicTeam[];
  revision: number;
  createdAt: string;
  published: boolean;
  rounds: PublicRoundStats[];
  totalRounds: number;
  completedRounds?: number;
  /** Present only when the classic final was completed; no player responses. */
  classicFinal?: {
    teamId: string;
    score: number;
    target: number;
    superPrize: boolean;
    questions: PublicFinalQuestion[];
  };
}
export interface PublicFinalQuestion {
  questionId: string;
  /** Zero-based position within the five final questions. */
  questionIndex: number;
  prompt: string;
  source: string;
  surveyDate: string;
  respondentCount: number | null;
  isDemo: boolean;
  answers: Array<{ position: number; text: string; points: number; share: number }>;
}
export interface HostGame extends GameState {
  players: Participant[];
}
export interface TeamGame extends PublicGame {
  self: Participant;
  players: Participant[];
  suggestions: Suggestion[];
  pendingAnswer: OfficialAnswer | null;
}
export type HostCommand =
  | { type: "start"; teamId: string }
  | { type: "reveal"; answerId: string }
  | { type: "strike" }
  | { type: "next"; teamId?: string }
  | { type: "award"; teamId: string }
  | { type: "turn"; teamId: string }
  | { type: "rename-team"; teamId: string; name: string }
  | { type: "pause" | "resume" | "undo" | "finish" }
  | { type: "adjust"; teamId: string; delta: number; reason: string }
  | { type: "statistics-view"; view: "list" | "cloud" }
  | { type: "join-toggle"; teamId: string; open: boolean }
  | { type: "classic-buzz"; teamId: string }
  | { type: "classic-tiebreak-winner"; teamId: string }
  | { type: "classic-final-start" }
  | { type: "classic-final-stop" }
  | { type: "classic-final-repeat" }
  /** Mark what the finalist said: a survey answer, or null for "not in the survey". */
  | { type: "classic-final-pick"; questionIndex: number; answerId: string | null }
  | { type: "classic-final-clear"; questionIndex: number }
  /** `complete` ends the final after the current finalist. */
  | { type: "classic-final-next"; complete?: boolean }
  | { type: "classic-final-skip" };
export type GameCommand =
  | HostCommand
  | {
      type: "suggest";
      participantId: string;
      teamId: string;
      authorName: string;
      text: string;
    }
  | {
      type: "submit";
      participantId: string;
      teamId: string;
      authorName: string;
      text: string;
    };
export interface GameSummary {
  id: string;
  title: string;
  phase: Phase;
  teams: PublicTeam[];
  createdAt: string;
  revision: number;
  resultsAvailable: boolean;
}
export interface SiteInfo {
  initialized: boolean;
  brand: Brand;
  games: GameSummary[];
}
export interface Me {
  admin: { id: string; username: string } | null;
  participant: Participant | null;
}
export interface CommandRequest {
  requestId: string;
  revision: number;
  command: HostCommand;
}
