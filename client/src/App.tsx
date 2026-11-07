import { Navigate, Route, Routes } from "react-router";
import { LoginPage } from "./LoginPage";
import { RequireAuth } from "./RequireAuth";
import { RequireAdmin } from "./RequireAdmin";
import { HomePage } from "./HomePage";
import { TicketDetailPage } from "./TicketDetailPage";
import { TicketsPage } from "./TicketsPage";
import { UsersPage } from "./UsersPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<HomePage />} />
        {/* Every signed-in user works tickets, so no RequireAdmin here. */}
        <Route path="/tickets" element={<TicketsPage />} />
        <Route path="/tickets/:id" element={<TicketDetailPage />} />
        {/* /users is the admin section: RequireAdmin guards it and every
            child route below, which render in its <Outlet />. Add new
            admin routes here as children (they live at /users/*). */}
        <Route path="/users" element={<RequireAdmin />}>
          <Route index element={<UsersPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
