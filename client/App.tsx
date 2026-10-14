import { BrowserRouter, Route, Routes } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AppProvider } from "./lib";
import { Loading } from "./components/Common";
const publicPage = (name: keyof typeof import("./pages/Public")) =>
  lazy(async () => ({ default: (await import("./pages/Public"))[name] }));
const gamePage = (name: keyof typeof import("./pages/Game")) =>
  lazy(async () => ({ default: (await import("./pages/Game"))[name] }));
const adminPage = (name: keyof typeof import("./pages/Admin")) =>
  lazy(async () => ({ default: (await import("./pages/Admin"))[name] }));
const HomePage = publicPage("HomePage"),
  SetupPage = publicPage("SetupPage"),
  LoginPage = publicPage("LoginPage"),
  JoinPage = publicPage("JoinPage"),
  HelpPage = publicPage("HelpPage"),
  NotFoundPage = publicPage("NotFoundPage");
const BoardPage = gamePage("BoardPage"),
  TeamPage = gamePage("TeamPage"),
  HostPage = gamePage("HostPage");
const AdminLayout = adminPage("AdminLayout"),
  DashboardPage = adminPage("DashboardPage"),
  GamesPage = adminPage("GamesPage"),
  NewGamePage = adminPage("NewGamePage"),
  GameSettingsPage = adminPage("GameSettingsPage"),
  QuestionsPage = adminPage("QuestionsPage"),
  QuestionEditorPage = adminPage("QuestionEditorPage"),
  SettingsPage = adminPage("SettingsPage"),
  AccountPage = adminPage("AccountPage");
export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/join" element={<JoinPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/board/:gameId" element={<BoardPage />} />
            <Route path="/team/:gameId" element={<TeamPage />} />
            <Route path="/host/:gameId" element={<HostPage />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="games" element={<GamesPage />} />
              <Route path="games/new" element={<NewGamePage />} />
              <Route path="games/:gameId" element={<GameSettingsPage />} />
              <Route path="questions" element={<QuestionsPage />} />
              <Route path="questions/new" element={<QuestionEditorPage />} />
              <Route
                path="questions/:questionId"
                element={<QuestionEditorPage />}
              />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="account" element={<AccountPage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </AppProvider>
    </BrowserRouter>
  );
}
