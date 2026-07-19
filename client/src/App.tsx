import { Navigate, Route, Routes } from "react-router";
import { LoginPage } from "./LoginPage";
import { RequireAuth } from "./RequireAuth";
import { HomePage } from "./HomePage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<HomePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
