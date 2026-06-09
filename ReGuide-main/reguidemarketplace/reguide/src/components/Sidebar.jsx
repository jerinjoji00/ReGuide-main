import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Home, BookOpen, Upload, Repeat, Bell, User, Mail, LogOut, Shield, MessageCircle } from "lucide-react";
import ReGuideLogo from "../pages/reguide-logo.jsx";
import { getUnreadNotificationCount, subscribeToNotificationChanges } from "../services/notificationService";
import "./Sidebar.css";

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let active = true;

    const loadUnreadCount = async () => {
      const count = await getUnreadNotificationCount();
      if (active) {
        setUnreadCount(count);
      }
    };

    loadUnreadCount();
    const unsubscribe = subscribeToNotificationChanges(loadUnreadCount);

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("reguideUser");
    navigate("/login");
  };

  // determine user role from storage
  let isAdmin = false;
  try {
    const stored = localStorage.getItem("reguideUser");
    if (stored) {
      const usr = JSON.parse(stored);
      isAdmin = usr.role === "admin";
    }
  } catch (_) {
    // ignore parse errors
  }

  const isActive = (path) => location.pathname === path;
  const logoTarget = isAdmin ? "/admin-dashboard" : "/dashboard";

  return (
    <aside className="sidebar">
      {/* LOGO */}
      <div className="logo-box">
        <Link to={logoTarget} className="logo-link">
          <ReGuideLogo size="lg" />
        </Link>
        <h1>ReGuide</h1>
        <p className="subtitle">Guide Selling Marketplace</p>
      </div>

      {!isAdmin ? (
        <div
          className={`sidebar-title ${isActive("/dashboard") ? "active" : ""}`}
          onClick={() => navigate("/dashboard")}
          style={{ cursor: "pointer" }}
        >
          <Home size={18} /> Dashboard
        </div>
      ) : (
        <div
          className={`sidebar-title ${isActive("/admin-dashboard") ? "active" : ""}`}
          onClick={() => navigate("/admin-dashboard")}
          style={{ cursor: "pointer" }}
        >
          <Shield size={18} /> Admin Dashboard
        </div>
      )}

      {!isAdmin ? (
        <ul>
          <li className={isActive("/browse") ? "active" : ""}
           onClick={() => navigate("/browse")}
            style={{ cursor: "pointer" }}>
            <BookOpen size={18} /> Browse Guides
          </li>
          <li className={isActive("/sell") ? "active" : ""} onClick={() => navigate("/sell")}
            style={{ cursor: "pointer" }}>
            <Upload size={18} /> Sell a Guide
          </li>
          <li className={isActive("/myorders") ? "active" : ""}
           onClick={() => navigate("/myorders")}
            style={{ cursor: "pointer" }}>
            <Repeat size={18} /> My Orders
          </li>
          <li className={isActive("/chat") ? "active" : ""}
            onClick={() => navigate("/chat")}
            style={{ cursor: "pointer" }}>
            <MessageCircle size={18} /> Chat
          </li>
          <li
            className={`${isActive("/notifications") ? "active" : ""}`}
            onClick={() => navigate("/notifications")}
            style={{ cursor: "pointer" }}
          >
            <Bell size={18} /> Notifications {unreadCount > 0 ? <span className="sidebar-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
          </li>
          <li
            className={` ${isActive("/profile") ? "active" : ""}`}
            onClick={() => navigate("/profile")}
            style={{ cursor: "pointer" }}
          >
            <User size={18} /> Profile
          </li>

          <li className={isActive("/contactsupport") ? "active" : ""}
           onClick={() => navigate("/contactsupport")}
            style={{ cursor: "pointer" }}>
            <Mail size={18} /> Contact Support
          </li>
          <li
            className="menu-bottom"
            onClick={handleLogout}
            style={{ cursor: "pointer", color: "red" }}
          >
            <LogOut size={18} /> Logout
          </li>
        </ul>
      ) : (
        <ul>
          <li
            className={isActive("/admin-dashboard") ? "active" : ""}
            onClick={() => navigate("/admin-dashboard")}
            style={{ cursor: "pointer" }}
          >
            <Home size={18} /> Overview
          </li>
          <li
            className={isActive("/browse") ? "active" : ""}
            onClick={() => navigate("/browse")}
            style={{ cursor: "pointer" }}
          >
            <BookOpen size={18} /> Browse Guides
          </li>
          <li
            className={isActive("/admin-moderation") ? "active" : ""}
            onClick={() => navigate("/admin-moderation")}
            style={{ cursor: "pointer" }}
          >
            <Shield size={18} /> Guide Moderation
          </li>
          <li
            className={isActive("/admin-monitoring") ? "active" : ""}
            onClick={() => navigate("/admin-monitoring")}
            style={{ cursor: "pointer" }}
          >
            <Repeat size={18} /> Rental Monitoring
          </li>
          <li
            className={isActive("/admin-users") ? "active" : ""}
            onClick={() => navigate("/admin-users")}
            style={{ cursor: "pointer" }}
          >
            <User size={18} /> User Management
          </li>
          <li
            className={`${isActive("/admin-support") ? "active" : ""}`}
            onClick={() => navigate("/admin-support")}
            style={{ cursor: "pointer" }}
          >
            <Mail size={18} /> Support Inbox
          </li>
          <li
            className="menu-bottom"
            onClick={handleLogout}
            style={{ cursor: "pointer", color: "red" }}
          >
            <LogOut size={18} /> Logout
          </li>
        </ul>
      )}
    </aside>
  );
}
