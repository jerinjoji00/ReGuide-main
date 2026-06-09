import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAdminManagedUsers } from "../services/adminUserService";
import {
  getAcceptedGuides,
  getAdminMonitoringRentals,
  getPendingGuides,
  getRejectedGuides,
} from "../services/guideService";
import { getGuideAdminStateMap } from "../services/adminGuideService";
import "./AdminDashboard.css";

function AdminDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState([
    { title: "Total Users", value: "-" },
    { title: "Active Rentals", value: "-" },
    { title: "Listed Guides", value: "-" },
    { title: "Flagged Listings", value: "-" },
  ]);

  useEffect(() => {
    let isMounted = true;

    const loadStats = async () => {
      try {
        const [users, rentals, pending, accepted, rejected] = await Promise.all([
          getAdminManagedUsers().catch(() => []),
          getAdminMonitoringRentals().catch(() => []),
          getPendingGuides().catch(() => []),
          getAcceptedGuides().catch(() => []),
          getRejectedGuides().catch(() => []),
        ]);

        if (!isMounted) return;

        const activeRentals = (rentals || []).filter((item) => item?.status === "Active").length;
        const listedGuides = (pending?.length || 0) + (accepted?.length || 0) + (rejected?.length || 0);
        const flaggedListings = Object.values(getGuideAdminStateMap() || {}).filter(
          (item) => Number(item?.flagCount || 0) > 0 || Boolean(item?.flagged)
        ).length;

        setStats([
          { title: "Total Users", value: String(users?.length || 0) },
          { title: "Active Rentals", value: String(activeRentals) },
          { title: "Listed Guides", value: String(listedGuides) },
          { title: "Flagged Listings", value: String(flaggedListings) },
        ]);
      } catch {
        if (!isMounted) return;
        setStats([
          { title: "Total Users", value: "0" },
          { title: "Active Rentals", value: "0" },
          { title: "Listed Guides", value: "0" },
          { title: "Flagged Listings", value: "0" },
        ]);
      }
    };

    loadStats();

    const refreshStats = () => loadStats();
    window.addEventListener("reguide-guides-updated", refreshStats);
    window.addEventListener("reguide-orders-updated", refreshStats);

    return () => {
      isMounted = false;
      window.removeEventListener("reguide-guides-updated", refreshStats);
      window.removeEventListener("reguide-orders-updated", refreshStats);
    };
  }, []);

  return (
    <div className="admin-dashboard">
      <h1>Admin Dashboard</h1>
      <div className="stats-grid">
        {stats.map((s) => (
          <div key={s.title} className="stat-box">
            <h2>{s.value}</h2>
            <p>{s.title}</p>
          </div>
        ))}
      </div>
      <div className="admin-cards-grid">
        <div className="admin-card">
          <h3>Guide Moderation</h3>
          <p>
            View, approve, and flag guide listings from vendors. Ensure
            content quality and compliance with ReGuide standards before they
            go live on the marketplace.
          </p>
          <button onClick={() => navigate("/admin-moderation")}>Manage →</button>
        </div>
        <div className="admin-card">
          <h3>Rental Monitoring</h3>
          <p>
            View and manage active guide rentals, track delivery statuses, and
            monitor deposit balances for active rental agreements across the
            platform.
          </p>
          <button onClick={() => navigate("/admin-monitoring")}>Manage →</button>
        </div>
        <div className="admin-card">
          <h3>User Management</h3>
          <p>
            Suspend or reactivate sellers, verify identity status, and watch
            repeated complaints across users from a single admin panel.
          </p>
          <button onClick={() => navigate("/admin-users")}>Manage →</button>
        </div>
        {/* NEW CARD */}
        <div className="admin-card">
          <h3>Support Inbox</h3>
          <p>
            View and manage support queries submitted by customers and sellers.
            Mark tickets as open, in progress, or resolved from a unified inbox.
          </p>
          <button onClick={() => navigate("/admin-support")}>View Inbox →</button>
        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;
