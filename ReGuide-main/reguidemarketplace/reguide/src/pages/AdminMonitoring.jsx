import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAdminMonitoringRentals } from "../services/guideService";
import { getOrCreateConversation } from "../services/chatService";
import { getCurrentUserId } from "../services/userService";
import "./AdminMonitoring.css";

function formatDate(value) {
  if (!value || value === "-") return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "₹0";
  return `₹${amount.toLocaleString("en-IN")}`;
}

function formatDurationMonths(value) {
  const months = Number(value || 0);
  if (!Number.isFinite(months) || months <= 0) return "-";
  return `${months} month${months === 1 ? "" : "s"}`;
}

function AdminMonitoring() {
  const navigate = useNavigate();
  const [rentals, setRentals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedRental, setSelectedRental] = useState(null);

  const [filter, setFilter] = useState("All");

  useEffect(() => {
    let isMounted = true;

    async function loadRentals() {
      setLoading(true);
      setError("");
      try {
        const data = await getAdminMonitoringRentals();
        if (!isMounted) return;
        setRentals(data || []);
      } catch {
        if (!isMounted) return;
        setError("Failed to load rental monitoring data.");
        setRentals([]);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadRentals();

    const handleRefresh = () => {
      loadRentals();
    };

    window.addEventListener("reguide-orders-updated", handleRefresh);

    return () => {
      isMounted = false;
      window.removeEventListener("reguide-orders-updated", handleRefresh);
    };
  }, []);

  // Count values
  const activeCount = rentals.filter(r => r.status === "Active").length;
  const overdueCount = rentals.filter(r => r.status === "Overdue").length;
  const returnedCount = rentals.filter(r => r.status === "Returned").length;

  // Filter table
  const filteredRentals =
    filter === "All"
      ? rentals
      : rentals.filter(r => r.status === filter);

  const handleChat = async (item) => {
    try {
      const adminUserId = await getCurrentUserId();
      if (!adminUserId) {
        alert("Please log in to open chat.");
        return;
      }

      if (item?.buyerId) {
        const conversation = await getOrCreateConversation(adminUserId, item.buyerId, item?.guideId || null);
        navigate(`/chat?conversation=${conversation.id}`);
        return;
      }

      const guidePart = item?.guideId ? `?guide=${item.guideId}` : "";
      navigate(`/chat${guidePart}`);
    } catch (error) {
      alert(error?.message || "Unable to open chat right now.");
    }
  };

  return (
    <div className="admin-container">
      <div className="monitoring-header">
        <h1>Admin Rental Monitoring</h1>
        <p>View and manage active guide rentals and deposit statuses.</p>
      </div>

      {error && <p className="monitoring-error">{error}</p>}

      {/* Tabs */}
      <div className="tabs">
        <button
          type="button"
          className={`monitor-tab ${filter === "All" ? "active" : ""}`}
          onClick={() => setFilter("All")}
        >
          All ({rentals.length})
        </button>

        <button
          type="button"
          className={`monitor-tab ${filter === "Active" ? "active" : ""}`}
          onClick={() => setFilter("Active")}
        >
          Active ({activeCount})
        </button>

        <button
          type="button"
          className={`monitor-tab overdue ${filter === "Overdue" ? "active" : ""}`}
          onClick={() => setFilter("Overdue")}
        >
          Overdue ({overdueCount})
        </button>

        <button
          type="button"
          className={`monitor-tab ${filter === "Returned" ? "active" : ""}`}
          onClick={() => setFilter("Returned")}
        >
          Returned ({returnedCount})
        </button>

      </div>

      <div className="monitoring-content-shell">
        {loading ? (
          <div className="monitoring-empty-state">
            <p>Loading rentals...</p>
          </div>
        ) : (
          <div className="monitor-table-wrap">
            <table className="monitor-table">
              <thead>
                <tr>
                  <th>Guide</th>
                  <th>Rented By</th>
                  <th>Due Date</th>
                  <th>Deposit</th>
                  <th>Seller Status</th>
                  <th>Buyer Status</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredRentals.length === 0 ? (
                  <tr className="monitor-no-data-row">
                    <td colSpan="7">No rented guides found.</td>
                  </tr>
                ) : filteredRentals.map((item, index) => (
                  <tr key={index}>
                    <td>{item.guide}</td>

                    <td>
                      {item.rentedBy}
                      <br />
                      <small>{item.email}</small>
                    </td>

                    <td>{item.dueDate}</td>
                    <td>{item.deposit}</td>

                    <td>
                      <span className={`status ${item.sellerStatus === "Received" ? "received" : "pending"}`}>
                        {item.sellerStatus || "Pending"}
                      </span>
                    </td>

                    <td>
                      <span className={`status ${item.buyerStatus === "Returned" ? "active" : "pending"}`}>
                        {item.buyerStatus || "Pending"}
                      </span>
                    </td>

                    <td>
                      <div className="monitor-actions">
                        <button
                          type="button"
                          className="monitor-view-details"
                          onClick={() => setSelectedRental(item)}
                        >
                          View Details
                        </button>
                        <button
                          type="button"
                          className="monitor-chat-btn"
                          onClick={() => handleChat(item)}
                        >
                          Chat
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedRental ? (
        <div className="monitor-modal-backdrop" onClick={() => setSelectedRental(null)}>
          <div className="monitor-modal" onClick={(event) => event.stopPropagation()}>
            <div className="monitor-modal-header">
              <h2>{selectedRental.guide}</h2>
              <button
                type="button"
                className="monitor-close"
                onClick={() => setSelectedRental(null)}
              >
                Close
              </button>
            </div>

            <div className="monitor-details-grid">
              <div className="monitor-detail-card">
                <h3>Order</h3>
                <p>Order ID: {selectedRental.orderId || "-"}</p>
                <p>Order Date: {formatDate(selectedRental.orderDate)}</p>
                <p>Duration: {formatDurationMonths(selectedRental.duration)}</p>
              </div>
              <div className="monitor-detail-card">
                <h3>Financials</h3>
                <p>Amount: {formatCurrency(selectedRental.amount)}</p>
                <p>Deposit: {formatCurrency(selectedRental.depositValue)}</p>
                <p>Status: {selectedRental.status}</p>
                <p>Seller: {selectedRental.sellerStatus || "Pending"}</p>
                <p>Buyer: {selectedRental.buyerStatus || "Pending"}</p>
              </div>
              <div className="monitor-detail-card">
                <h3>Renter</h3>
                <p>Name: {selectedRental.rentedBy || "-"}</p>
                <p>Email: {selectedRental.email || "-"}</p>
              </div>
              <div className="monitor-detail-card">
                <h3>Timeline</h3>
                <p>Due Date: {formatDate(selectedRental.dueDate)}</p>
                <p>Returned At: {formatDate(selectedRental.returnedAt)}</p>
                <p>Seller: {selectedRental.sellerName || "-"}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}

export default AdminMonitoring;
