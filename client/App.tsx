import { BrowserRouter, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { lazy, Suspense, useLayoutEffect } from "react";
import { AppProvider } from "./lib";
import { Loading } from "./components/Common";
const publicPage = (name: keyof typeof import("./pages/Public")) =>
  lazy(async () => ({ default: (await import("./pages/Public"))[name] }));
const gamePage = (name: keyof typeof import("./pages/Game")) =>
  lazy(async () => ({ default: (await import("./pages/Game"))[name] }));
const adminPage = (name: keyof typeof import("./pages/Admin")) =>
  lazy(async () => ({ default: (await import("./pages/Admin"))[name] }));
const ResultsPage = lazy(() => import("./pages/Results"));
const QuestionImportPage = lazy(() => import("./pages/QuestionImport"));
const QuestionsPage = lazy(async () => ({
  default: (await import("./pages/Questions")).QuestionsPage,
}));
const HomePage = publicPage("HomePage"),
  SetupPage = publicPage("SetupPage"),
  LoginPage = publicPage("LoginPage"),
  JoinPage = publicPage("JoinPage"),
  HelpPage = publicPage("HelpPage"),
  NotFoundPage = publicPage("NotFoundPage");
const BoardPage = gamePage("BoardPage"),
  TeamPage = gamePage("TeamPage"),
  HostPage = lazy(async () => ({ default: (await import("./pages/Host"))["HostPage"] }));
const AdminLayout = adminPage("AdminLayout"),
  DashboardPage = adminPage("DashboardPage"),
  GamesPage = adminPage("GamesPage"),
  NewGamePage = adminPage("NewGamePage"),
  GameSettingsPage = adminPage("GameSettingsPage"),
  QuestionEditorPage = adminPage("QuestionEditorPage"),
  SettingsPage = adminPage("SettingsPage"),
  AccountPage = adminPage("AccountPage");

function PageScroll() {
  const { pathname, search, hash, key } = useLocation();
  const navigationType = useNavigationType();
  useLayoutEffect(() => {
    // New sections start at their heading; the browser owns history and anchors.
    if (navigationType !== "POP" && !hash)
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname, search, hash, key, navigationType]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <PageScroll />
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
            <Route path="/results/:gameId" element={<ResultsPage />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="games" element={<GamesPage />} />
              <Route path="games/new" element={<NewGamePage />} />
              <Route path="games/:gameId" element={<GameSettingsPage />} />
              <Route path="questions" element={<QuestionsPage />} />
              <Route path="questions/import" element={<QuestionImportPage />} />
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
