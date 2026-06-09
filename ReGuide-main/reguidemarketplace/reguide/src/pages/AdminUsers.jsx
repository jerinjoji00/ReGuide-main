import { useEffect, useMemo, useState } from "react";
import {
  getAdminManagedUsers,
  setSellerSuspended,
  setSellerVerificationStatus,
} from "../services/adminUserService";
import {
  getPendingGuides,
  getAcceptedGuides,
  getRejectedGuides,
} from "../services/guideService";
import { createNotification, createNotificationForAdmins } from "../services/notificationService";
import { getGuideAdminStateMap } from "../services/adminGuideService";
import "./AdminUsers.css";

function getGuideAdminCounts() {
  const state = getGuideAdminStateMap();
  const values = Object.values(state || {});
  const suspendedGuides = values.filter((item) => Boolean(item?.suspended)).length;
  const flaggedGuides = values.filter((item) => Boolean(item?.flagged)).length;
  return { suspendedGuides, flaggedGuides };
}

function getGuideStateRows(sourceGuides = []) {
  const state = getGuideAdminStateMap();

  let localGuides = [];
  try {
    const parsed = JSON.parse(localStorage.getItem("reguideGuides") || "[]");
    localGuides = Array.isArray(parsed) ? parsed : [];
  } catch {
    localGuides = [];
  }

  const allGuides = [...(localGuides || []), ...(Array.isArray(sourceGuides) ? sourceGuides : [])];
  const guideById = new Map(
    allGuides
      .filter((guide) => guide?.id != null)
      .map((guide) => [String(guide?.id), guide])
  );

  return Object.entries(state || {}).map(([guideId, value]) => {
    const guide = guideById.get(String(guideId)) || {};
    return {
      guideId: String(guideId),
      title: guide?.title || `Guide #${guideId}`,
      seller: guide?.seller_name || guide?.seller || "Unknown Seller",
      suspended: Boolean(value?.suspended),
      flagged: Boolean(value?.flagged),
      updatedAt: value?.updatedAt || null,
    };
  });
}

function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draftSearch, setDraftSearch] = useState("");
  const [searchText, setSearchText] = useState("");
  const [filter, setFilter] = useState("all");
  const [guideStats, setGuideStats] = useState({ suspendedGuides: 0, flaggedGuides: 0 });
  const [guideStateRows, setGuideStateRows] = useState([]);
  const [activeSummary, setActiveSummary] = useState("all-users");

  useEffect(() => {
    let isMounted = true;

    async function loadUsers() {
      setLoading(true);
      setError("");
      try {
        const [data, pendingGuides, acceptedGuides, rejectedGuides] = await Promise.all([
          getAdminManagedUsers(),
          getPendingGuides(),
          getAcceptedGuides(),
          getRejectedGuides(),
        ]);

        const mergedGuides = [
          ...(pendingGuides || []),
          ...(acceptedGuides || []),
          ...(rejectedGuides || []),
        ];

        if (!isMounted) return;
        setUsers(data || []);
        setGuideStats(getGuideAdminCounts());
        setGuideStateRows(getGuideStateRows(mergedGuides));
      } catch {
        if (!isMounted) return;
        setError("Failed to load users.");
        setUsers([]);
        setGuideStats(getGuideAdminCounts());
        setGuideStateRows(getGuideStateRows());
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadUsers();

    const handleGuideRefresh = async () => {
      if (!isMounted) return;
      let mergedGuides = [];
      try {
        const [pendingGuides, acceptedGuides, rejectedGuides] = await Promise.all([
          getPendingGuides(),
          getAcceptedGuides(),
          getRejectedGuides(),
        ]);
        mergedGuides = [
          ...(pendingGuides || []),
          ...(acceptedGuides || []),
          ...(rejectedGuides || []),
        ];
      } catch {
        mergedGuides = [];
      }
      setGuideStats(getGuideAdminCounts());
      setGuideStateRows(getGuideStateRows(mergedGuides));
    };
    window.addEventListener("reguide-guides-updated", handleGuideRefresh);

    return () => {
      isMounted = false;
      window.removeEventListener("reguide-guides-updated", handleGuideRefresh);
    };
  }, []);

  const filteredUsers = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return users.filter((user) => {
      const textMatch = !query ||
        String(user?.name || "").toLowerCase().includes(query) ||
        String(user?.email || "").toLowerCase().includes(query);

      if (!textMatch) return false;

      if (filter === "verified") return String(user?.verificationStatus || "") === "verified";
      if (filter === "suspended") return Boolean(user?.suspended);
      if (filter === "sellers") return String(user?.role || "").toLowerCase() === "seller";
      if (filter === "pending-verification") return String(user?.verificationStatus || "") === "pending";
      return true;
    });
  }, [users, searchText, filter]);

  const verifiedCount = users.filter((user) => String(user?.verificationStatus || "") === "verified").length;
  const suspendedCount = users.filter((user) => user?.suspended).length;

  const displayedUsers = useMemo(() => {
    if (activeSummary === "verified-users") {
      return filteredUsers.filter((user) => String(user?.verificationStatus || "") === "verified");
    }
    if (activeSummary === "suspended-users") {
      return filteredUsers.filter((user) => user?.suspended);
    }
    if (activeSummary === "all-users") {
      return filteredUsers;
    }
    return [];
  }, [activeSummary, filteredUsers]);

  const shouldShowUserTable =
    activeSummary === "all-users" ||
    activeSummary === "verified-users" ||
    activeSummary === "suspended-users";

  const shouldShowGuideTable = activeSummary === "suspended-guides";

  const getSummaryEmptyMessage = () => {
    if (activeSummary === "suspended-guides") return "No suspended guides to display.";
    return "No data to display.";
  };

  const displayedGuides = useMemo(() => {
    if (activeSummary === "suspended-guides") {
      return guideStateRows
        .filter((guide) => guide?.suspended)
        .sort((a, b) => String(b?.updatedAt || "").localeCompare(String(a?.updatedAt || "")));
    }
    return [];
  }, [activeSummary, guideStateRows]);

  const updateUserInState = (email, patch) => {
    setUsers((prev) => prev.map((user) =>
      String(user?.email || "") === String(email || "")
        ? { ...user, ...patch, updatedAt: new Date().toISOString() }
        : user
    ));
  };

  const handleToggleSuspension = async (user) => {
    const nextSuspended = !user?.suspended;
    await setSellerSuspended(user, nextSuspended);
    updateUserInState(user?.email, { suspended: nextSuspended });

    createNotification({
      recipientId: user?.id || null,
      recipientEmail: user?.email || "",
      actorName: "Admin",
      type: nextSuspended ? "seller_suspended" : "seller_reactivated",
      title: nextSuspended ? "Seller account suspended" : "Seller account reactivated",
      message: nextSuspended
        ? "Your seller account is suspended. You cannot list guides or receive new orders. Contact support to appeal."
        : "Your seller account has been reactivated. Your guides are visible again for new orders.",
      link: "/contactsupport",
      metadata: {
        action: nextSuspended ? "seller_suspended" : "seller_reactivated",
        userId: user?.id || null,
      },
    }).catch(() => {});

    createNotificationForAdmins({
      actorName: "Admin",
      type: nextSuspended ? "seller_suspended" : "seller_reactivated",
      title: nextSuspended ? "Seller suspended" : "Seller reactivated",
      message: `${user?.email || "Seller"} was ${nextSuspended ? "suspended" : "reactivated"}.`,
      link: "/admin-users",
      metadata: {
        action: nextSuspended ? "seller_suspended" : "seller_reactivated",
        userId: user?.id || null,
        userEmail: user?.email || "",
      },
    }).catch(() => {});
  };

  const handleToggleVerification = async (user) => {
    const nextStatus = user?.verificationStatus === "verified" ? "pending" : "verified";
    await setSellerVerificationStatus(user, nextStatus);
    updateUserInState(user?.email, { verificationStatus: nextStatus });

    if (nextStatus === "verified") {
      createNotification({
        recipientId: user?.id || null,
        recipientEmail: user?.email || "",
        actorName: "Admin",
        type: "seller_verified",
        title: "Seller verification approved",
        message: "Your seller profile has been verified by admin. You can now sell with a verified seller badge.",
        link: "/profile",
        metadata: {
          action: "seller_verified",
          userId: user?.id || null,
        },
      }).catch(() => {});

      createNotificationForAdmins({
        actorName: "Admin",
        type: "seller_verified",
        title: "Seller verification approved",
        message: `${user?.email || "Seller"} was marked as verified.`,
        link: "/admin-users",
        metadata: {
          action: "seller_verified",
          userId: user?.id || null,
          userEmail: user?.email || "",
        },
      }).catch(() => {});
    }
  };

  return (
    <div className="admin-users-container">
      <div className="admin-users-header">
        <h1>Admin User Management</h1>
        <p>Suspend or reactivate sellers, verify identity status, and flag repeated complaints.</p>
      </div>

      <div className="admin-users-summary">
        <button
          type="button"
          className={`summary-card clickable ${activeSummary === "all-users" ? "active" : ""}`}
          onClick={() => setActiveSummary("all-users")}
        >
          <strong>{users.length}</strong>
          <span>All users</span>
        </button>
        <button
          type="button"
          className={`summary-card clickable ${activeSummary === "verified-users" ? "active" : ""}`}
          onClick={() => setActiveSummary("verified-users")}
        >
          <strong>{verifiedCount}</strong>
          <span>Verified users</span>
        </button>
        <button
          type="button"
          className={`summary-card clickable ${activeSummary === "suspended-users" ? "active" : ""}`}
          onClick={() => setActiveSummary("suspended-users")}
        >
          <strong>{suspendedCount}</strong>
          <span>Suspended sellers</span>
        </button>
      </div>

      <div className="admin-users-toolbar">
        <input
          type="text"
          placeholder="Search user by name or email"
          value={draftSearch}
          onChange={(event) => setDraftSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setSearchText(draftSearch);
            }
          }}
        />
        <select value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">All users</option>
          <option value="sellers">Sellers only</option>
          <option value="verified">Verified users</option>
          <option value="suspended">Suspended sellers</option>
          <option value="pending-verification">Pending verification</option>
        </select>
        <button type="button" className="search-btn" onClick={() => setSearchText(draftSearch)}>
          Search
        </button>
      </div>

      {error ? <p className="admin-users-error">{error}</p> : null}

      <div className="admin-users-content-shell">
        {loading ? (
          <div className="admin-users-empty-panel">
            <p className="admin-users-loading">Loading users...</p>
          </div>
        ) : shouldShowUserTable ? (
          <div className="admin-users-table-wrap">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Verification</th>
                  <th>Suspension</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayedUsers.length === 0 ? (
                  <tr className="admin-users-no-data-row">
                    <td colSpan="6">No users found.</td>
                  </tr>
                ) : (
                  displayedUsers.map((user) => (
                    <tr key={user.key || user.email}>
                      <td>{user.name}</td>
                      <td>{user.email || "-"}</td>
                      <td>{user.role || "user"}</td>
                      <td>
                        <span className={`pill ${user.verificationStatus === "verified" ? "verified" : "pending"}`}>
                          {user.verificationStatus === "verified" ? "Verified" : "Pending"}
                        </span>
                      </td>
                      <td>
                        <span className={`pill ${user.suspended ? "suspended" : "active"}`}>
                          {user.suspended ? "Suspended" : "Active"}
                        </span>
                      </td>
                      <td className="actions-cell">
                        {String(user.role || "").toLowerCase() === "seller" ? (
                          <button
                            type="button"
                            className={user.suspended ? "reactivate" : "suspend"}
                            onClick={() => handleToggleSuspension(user)}
                          >
                            {user.suspended ? "Reactivate Seller" : "Suspend Seller"}
                          </button>
                        ) : (
                          <span className="action-muted">Not a seller</span>
                        )}
                        <button
                          type="button"
                          className="verify"
                          onClick={() => handleToggleVerification(user)}
                        >
                          {user.verificationStatus === "verified" ? "Mark Pending" : "Mark Verified"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : shouldShowGuideTable ? (
          <div className="admin-users-table-wrap">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>Guide</th>
                  <th>Seller</th>
                  <th>Flagged</th>
                  <th>Suspended</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {displayedGuides.length === 0 ? (
                  <tr className="admin-users-no-data-row">
                    <td colSpan="5">{getSummaryEmptyMessage()}</td>
                  </tr>
                ) : (
                  displayedGuides.map((guide) => (
                    <tr key={`guide-row-${guide.guideId}`}>
                      <td>{guide.title}</td>
                      <td>{guide.seller || "-"}</td>
                      <td>
                        <span className={`pill ${guide.flagged ? "flagged" : "active"}`}>
                          {guide.flagged ? "Yes" : "No"}
                        </span>
                      </td>
                      <td>
                        <span className={`pill ${guide.suspended ? "suspended" : "active"}`}>
                          {guide.suspended ? "Yes" : "No"}
                        </span>
                      </td>
                      <td>{guide.updatedAt ? new Date(guide.updatedAt).toLocaleString() : "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="admin-users-empty-panel">
            <p>{getSummaryEmptyMessage()}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminUsers;
