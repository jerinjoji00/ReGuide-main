import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { User } from "lucide-react";
import { supabase } from "../supabaseClient";
import { ensureRentalDeadlineNotifications } from "../services/notificationService";
import Sidebar from "./Sidebar.jsx";
import "./Sidebar.css";

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const isChatRoute = location.pathname.startsWith("/chat");

  let profileLabel = "Profile";
  let avatarContent = <User size={18} />;

  try {
    const currentUser = JSON.parse(localStorage.getItem("reguideUser") || "{}");
    const displayName = currentUser.name || currentUser.full_name || currentUser.email || "Profile";
    profileLabel = displayName;
    if (currentUser.avatar) {
      avatarContent = (
        <img src={currentUser.avatar} alt={displayName} className="top-profile-image" />
      );
    } else if (displayName) {
      avatarContent = <span>{displayName.charAt(0).toUpperCase()}</span>;
    }
  } catch {
    // Ignore parse errors and keep fallback icon.
  }

  let currentRole = "";
  try {
    currentRole = String(JSON.parse(localStorage.getItem("reguideUser") || "{}")?.role || "").toLowerCase();
  } catch {
    currentRole = "";
  }

  useEffect(() => {
    let cancelled = false;

    const verifySession = async () => {
      const user = localStorage.getItem("reguideUser");
      if (!user) {
        navigate("/login");
        return;
      }

      let prof = {};
      try {
        prof = JSON.parse(user);
      } catch {
        localStorage.removeItem("reguideUser");
        navigate("/login");
        return;
      }

      // Block non-admin users from admin route.
      if (location.pathname.startsWith("/admin-") && prof.role !== "admin") {
        navigate("/dashboard");
        return;
      }

      // Block admin users from user-only pages.
      const userOnlyPaths = [
        "/dashboard",
        "/checkout",
        "/sell",
        "/myorders",
        "/payment-success",
        "/notifications",
        "/profile",
        "/contactsupport",
        "/guide-listings",
      ];
      if (prof.role === "admin" && userOnlyPaths.some((path) => location.pathname === path || location.pathname.startsWith(`${path}/`))) {
        navigate(location.pathname.startsWith("/notifications") ? "/admin-support" : "/admin-dashboard");
        return;
      }

      // All app flows require an active Supabase auth session.
      const { data, error } = await supabase.auth.getUser();
      if (cancelled) return;

      if (error || !data?.user?.id) {
        localStorage.removeItem("reguideUser");
        navigate("/login");
        return;
      }

      // Prevent stale local user data from another account.
      if (prof.id && prof.id !== data.user.id) {
        localStorage.removeItem("reguideUser");
        navigate("/login");
        return;
      }

      await ensureRentalDeadlineNotifications();
    };

    const refreshNotifications = () => {
      verifySession();
    };

    verifySession();
    window.addEventListener("reguide-orders-updated", refreshNotifications);

    return () => {
      cancelled = true;
      window.removeEventListener("reguide-orders-updated", refreshNotifications);
    };
  }, [navigate, location.pathname]);

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="app-content">
        {currentRole !== "admin" ? (
          <button
            type="button"
            className={`top-profile-button ${isChatRoute ? "top-profile-button-hidden" : ""}`}
            onClick={() => navigate("/profile")}
            aria-label="Go to profile"
            title={profileLabel}
          >
            {avatarContent}
          </button>
        ) : null}
        <Outlet />
      </main>
    </div>
  );
}
