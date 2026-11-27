import { lazy, Suspense } from "react";
import { useLocation } from "react-router-dom";
import AppBootstrap from "./app-shell/AppBootstrap";
import AppShell from "./app-shell/AppShell";
import LoginPage from "./pages/LoginPage";
import PublicSharePage from "./pages/PublicSharePage";
import { isPublicSharePath } from "./publicSharePath";
import { useAuthBootstrap } from "./useAuthBootstrap";
const RoomPage = lazy(() => import("./pages/RoomPage"));

function AuthenticatedApp() {
  const auth = useAuthBootstrap();
  const room = /^\/room(\/|$)/.test(useLocation().pathname); // A wall tablet's full-screen page, outside the app's shell.
  if (!auth) return <AppBootstrap />;
  if (!auth.authenticated) return <LoginPage status={auth} />;
  if (room) return <Suspense fallback={<AppBootstrap />}><RoomPage /></Suspense>;
  return <AppShell isAdmin={Boolean(auth.is_admin)} />;
}

export default function App() {
  if (isPublicSharePath(window.location.pathname)) return <PublicSharePage />;
  return <AuthenticatedApp />;
}
