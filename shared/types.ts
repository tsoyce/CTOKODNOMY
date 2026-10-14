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
};
export interface Answer {
  id: string;
  text: string;
  points: number;
  aliases: string[];
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
}
export interface GameEvent {
  id: string;
  type: string;
  message: string;
  createdAt: string;
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
}
export interface GameState extends GameSnapshot {
  id: string;
  title: string;
  brand: Brand;
  questions: Question[];
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
export interface PublicGame {
  id: string;
  title: string;
  brand: Brand;
  teams: PublicTeam[];
  revision: number;
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
  | { type: "pause" | "resume" | "undo" | "finish" }
  | { type: "adjust"; teamId: string; delta: number; reason: string }
  | { type: "join-toggle"; teamId: string; open: boolean };
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
