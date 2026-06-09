import React, { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { createNotification } from "../services/notificationService"; // ✅ IMPORTANT
import "./Adminsupportinbox.css";

const STATUS_LABELS = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
};

const STATUS_COLORS = {
  open: "status-open",
  in_progress: "status-inprogress",
  resolved: "status-resolved",
};

function isActiveTicketStatus(status) {
  return status !== "resolved";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function resolveTicketRecipient(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return { recipientId: null, recipientEmail: "" };
  }

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (error) {
      return { recipientId: null, recipientEmail: normalizedEmail };
    }

    return {
      recipientId: data?.id || null,
      recipientEmail: normalizeEmail(data?.email || normalizedEmail),
    };
  } catch {
    return { recipientId: null, recipientEmail: normalizedEmail };
  }
}

function AdminSupportInbox() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    fetchTickets();
  }, []);

  const fetchTickets = async () => {
    setLoading(true);
    setError("");
    setInfo("");
    try {
      const { data, error } = await supabase
        .from("support_messages")
        .select("*")
        .neq("status", "resolved")
        .order("created_at", { ascending: false });

      if (error) throw error;

      setTickets(
        (data || []).map((ticket) => ({
          ...ticket,
          status: ticket.status || "open",
          is_read: Boolean(ticket.is_read),
        }))
      );
    } catch (err) {
      setError(err?.message || "Failed to load support tickets.");
    } finally {
      setLoading(false);
    }
  };

  // ✅ FULLY FIXED FUNCTION (LOCAL + DB SAFE)
  const updateStatus = async (id, newStatus) => {
    setUpdating(true);
    try {
      const ticket = tickets.find((t) => t.id === id);

      const { error: updateError } = await supabase
        .from("support_messages")
        .update({
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (updateError) throw updateError;

      // Notify user through notifications table.
      if ((newStatus === "in_progress" || newStatus === "resolved") && ticket?.email) {
        const { recipientId, recipientEmail } = await resolveTicketRecipient(ticket.email);
        const statusTitle =
          newStatus === "in_progress"
            ? "Support Ticket In Progress"
            : "Support Ticket Resolved";
        const statusMessage =
          newStatus === "in_progress"
            ? `Your support request "${ticket.subject}" is now being worked on by our team.`
            : `Your support request "${ticket.subject}" has been resolved.`;

        await createNotification({
          recipientId,
          recipientEmail,
          actorName: "Support Team",
          type: "support",
          title: statusTitle,
          message: statusMessage,
          metadata: {
            ticketId: ticket.id,
            status: newStatus,
          },
        });
      }

      setTickets((prev) => {
        if (!isActiveTicketStatus(newStatus)) {
          return prev.filter((t) => t.id !== id);
        }

        return prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t));
      });

      if (selected?.id === id) {
        if (!isActiveTicketStatus(newStatus)) {
          setSelected(null);
        } else {
          setSelected((prev) => ({ ...prev, status: newStatus }));
        }
      }
    } catch (err) {
      alert(err?.message || "Failed to update status.");
    } finally {
      setUpdating(false);
    }
  };

  const markRead = async (ticket) => {
    if (ticket.is_read) return;

    const { error } = await supabase
      .from("support_messages")
      .update({
        is_read: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ticket.id);

    if (!error) {
      setTickets((prev) =>
        prev.map((t) =>
          t.id === ticket.id ? { ...t, is_read: true } : t
        )
      );
    }
  };

  const openTicket = (ticket) => {
    setSelected(ticket);
    markRead(ticket);
  };

  const filtered =
    filter === "all" ? tickets : tickets.filter((t) => t.status === filter);

  const counts = {
    all: tickets.length,
    open: tickets.filter((t) => t.status === "open").length,
    in_progress: tickets.filter((t) => t.status === "in_progress").length,
    resolved: 0,
  };

  const unread = tickets.filter((t) => !t.is_read).length;

  const formatDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="admin-dashboard">
      <div className="inbox-header">
        <div>
          <h1>
            Support Inbox
            {unread > 0 && (
              <span className="unread-badge">{unread} new</span>
            )}
          </h1>
          <p className="inbox-subtitle">
            Manage and respond to customer & seller support queries
          </p>
        </div>
        <button className="refresh-btn" onClick={fetchTickets}>
          ↻ Refresh
        </button>
      </div>

      <div className="stats-grid" style={{ marginBottom: "1.5rem" }}>
        {[
          { label: "Active Tickets", value: counts.all },
          { label: "Open", value: counts.open },
          { label: "In Progress", value: counts.in_progress },
        ].map((s) => (
          <div key={s.label} className="stat-box">
            <h2>{s.value}</h2>
            <p>{s.label}</p>
          </div>
        ))}
      </div>

      <div className="filter-tabs">
        {["all", "open", "in_progress"].map((f) => (
          <button
            key={f}
            className={`filter-tab ${filter === f ? "active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : STATUS_LABELS[f]}
            <span className="tab-count">{counts[f]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="inbox-loading">Loading tickets...</div>
      ) : error ? (
        <div className="inbox-error">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="inbox-empty">
          <span>📭</span>
          <p>No tickets found.</p>
        </div>
      ) : (
        <div className="inbox-layout">
          <div className="ticket-list">
            {filtered.map((ticket) => (
              <div
                key={ticket.id}
                className={`ticket-item ${
                  selected?.id === ticket.id ? "selected" : ""
                } ${!ticket.is_read ? "unread" : ""}`}
                onClick={() => openTicket(ticket)}
              >
                <div className="ticket-item-top">
                  <span className="ticket-sender">
                    {ticket.name || ticket.email || "Anonymous"}
                  </span>
                  <span
                    className={`status-badge ${
                      STATUS_COLORS[ticket.status]
                    }`}
                  >
                    {STATUS_LABELS[ticket.status]}
                  </span>
                </div>
                <div className="ticket-subject">{ticket.subject}</div>
                <div className="ticket-preview">
                  {ticket.message?.slice(0, 80)}
                </div>
                <div className="ticket-date">
                  {formatDate(ticket.created_at)}
                </div>
                {!ticket.is_read && <span className="unread-dot" />}
              </div>
            ))}
          </div>

          <div className="ticket-detail">
            {selected ? (
              <>
                <div className="detail-header">
                  <h3>{selected.subject}</h3>
                  <span
                    className={`status-badge ${
                      STATUS_COLORS[selected.status]
                    }`}
                  >
                    {STATUS_LABELS[selected.status]}
                  </span>
                </div>

                <div className="detail-meta">
                  <div>
                    <span className="meta-label">From</span>
                    <span>{selected.name || "—"}</span>
                  </div>
                  <div>
                    <span className="meta-label">Email</span>
                    <span>{selected.email || "—"}</span>
                  </div>
                  <div>
                    <span className="meta-label">Ticket ID</span>
                    <span className="ticket-id-text">{selected.id}</span>
                  </div>
                  <div>
                    <span className="meta-label">Received</span>
                    <span>{formatDate(selected.created_at)}</span>
                  </div>
                </div>

                <div className="detail-message">
                  <p className="meta-label">Message</p>
                  <p className="message-body">{selected.message}</p>
                </div>

                <div className="detail-actions">
                  <p className="meta-label">Update Status</p>
                  <div className="action-btns">
                    <button
                      className="action-btn open-btn"
                      disabled={updating || selected.status === "open"}
                      onClick={() => updateStatus(selected.id, "open")}
                    >
                      Mark Open
                    </button>
                    <button
                      className="action-btn progress-btn"
                      disabled={updating || selected.status === "in_progress"}
                      onClick={() =>
                        updateStatus(selected.id, "in_progress")
                      }
                    >
                      In Progress
                    </button>
                    <button
                      className="action-btn resolve-btn"
                      disabled={updating || selected.status === "resolved"}
                      onClick={() =>
                        updateStatus(selected.id, "resolved")
                      }
                    >
                      Mark Resolved ✓
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="detail-empty">
                <span>💬</span>
                <p>Select a ticket to view details</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminSupportInbox;
