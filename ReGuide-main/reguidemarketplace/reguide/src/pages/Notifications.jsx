import { useEffect, useMemo, useState } from "react";
import { Bell, CheckCheck, MessageCircle, ShoppingBag, ShieldCheck, ShieldX, UploadCloud } from "lucide-react";
import {
  getNotificationsForCurrentUser,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  subscribeToNotificationChanges,
} from "../services/notificationService";
import "./Notifications.css";

const notificationTypeConfig = {
  chat_message: { icon: MessageCircle, accent: "teal" },
  rental_created: { icon: ShoppingBag, accent: "blue" },
  purchase_created: { icon: ShoppingBag, accent: "blue" },
  seller_rental_order: { icon: ShoppingBag, accent: "orange" },
  seller_purchase_order: { icon: ShoppingBag, accent: "orange" },
  guide_rented: { icon: ShoppingBag, accent: "orange" },
  guide_purchased: { icon: ShoppingBag, accent: "orange" },
  guide_returned: { icon: Bell, accent: "blue" },
  seller_received_guide: { icon: CheckCheck, accent: "green" },
  payment_success: { icon: ShieldCheck, accent: "green" },
  rental_deposit_paid: { icon: ShieldCheck, accent: "green" },
  payment_failed: { icon: ShieldX, accent: "red" },
  rental_due_soon: { icon: Bell, accent: "orange" },
  rental_overdue: { icon: Bell, accent: "red" },
  guide_submitted: { icon: UploadCloud, accent: "slate" },
  guide_approved: { icon: ShieldCheck, accent: "green" },
  guide_denied: { icon: ShieldX, accent: "red" },
  guide_suspended: { icon: ShieldX, accent: "red" },
  guide_reactivated: { icon: ShieldCheck, accent: "green" },
  seller_suspended: { icon: ShieldX, accent: "red" },
  seller_reactivated: { icon: ShieldCheck, accent: "green" },
  seller_verified: { icon: ShieldCheck, accent: "green" },
  guide_flagged: { icon: ShieldX, accent: "orange" },
  guide_removed: { icon: ShieldX, accent: "red" },
  support: { icon: Bell, accent: "blue" },
  general: { icon: Bell, accent: "slate" },
};

function parseNotificationDate(value) {
  if (!value) return null;

  // Supabase timestamp fields may come without timezone info.
  // Treat those as UTC to avoid local offset drift (e.g., +5h30m).
  const raw = String(value);
  const hasTimezone = /Z$|[+\-]\d{2}:\d{2}$/.test(raw);
  const parsed = new Date(hasTimezone ? raw : `${raw}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatNotificationTime(value) {
  if (!value) return "";

  const parsedDate = parseNotificationDate(value);
  if (!parsedDate) return "";

  const timestamp = parsedDate.getTime();
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(1, Math.floor(diffMs / (1000 * 60)));

  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return parsedDate.toLocaleDateString();
}

function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  const sortedNotifications = useMemo(() => {
    return [...notifications].sort((a, b) => {
      const aTime = parseNotificationDate(a?.created_at)?.getTime() || 0;
      const bTime = parseNotificationDate(b?.created_at)?.getTime() || 0;
      return bTime - aTime;
    });
  }, [notifications]);

  useEffect(() => {
    let active = true;

    const loadNotifications = async () => {
      const list = await getNotificationsForCurrentUser();
      if (active) {
        setNotifications(list);
        setLoading(false);
      }
    };

    loadNotifications();
    const unsubscribe = subscribeToNotificationChanges(loadNotifications);

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const unreadCount = sortedNotifications.filter((item) => !item?.is_read).length;

  const handleNotificationClick = async (notification) => {
    if (notification.is_read) return;
    
    await markNotificationAsRead(notification.id);
    setNotifications((prev) => prev.map((item) =>
      String(item.id) === String(notification.id) ? { ...item, is_read: true } : item
    ));
  };

  const handleMarkAllRead = async () => {
    await markAllNotificationsAsRead();
    setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })));
  };

  return (
    <div className="notifications-main">
      <div className="notifications-header-row">
        <div>
          <h1>Notifications</h1>
          <p className="notifications-subtitle">Orders, messages, and moderation updates appear here.</p>
        </div>
        <button
          type="button"
          className="mark-all-btn"
          onClick={handleMarkAllRead}
          disabled={unreadCount === 0}
        >
          <CheckCheck size={16} /> Mark all read
        </button>
      </div>

      <div className="notifications-summary-card">
        <div>
          <strong>{sortedNotifications.length}</strong>
          <span>Total notifications</span>
        </div>
        <div>
          <strong>{unreadCount}</strong>
          <span>Unread</span>
        </div>
      </div>

      <div className="notification-box inbox-mode">
        {loading ? (
          <p>Loading notifications...</p>
        ) : sortedNotifications.length === 0 ? (
          <div className="notifications-empty-state">
            <Bell size={50} className="bell-icon" />
            <p>No notifications yet</p>
          </div>
        ) : (
          <div className="notifications-list">
            {sortedNotifications.map((notification) => {
              const config = notificationTypeConfig[notification.type] || notificationTypeConfig.general;
              const Icon = config.icon;

              return (
                <button
                  type="button"
                  key={notification.id}
                  className={`notification-item ${notification.is_read ? "read" : "unread"}`}
                  onClick={() => handleNotificationClick(notification)}
                >
                  <span className={`notification-icon ${config.accent}`}>
                    <Icon size={18} />
                  </span>
                  <span className="notification-copy">
                    <span className="notification-top-row">
                      <span className="notification-title">{notification.title}</span>
                      <span className="notification-time">{formatNotificationTime(notification.created_at)}</span>
                    </span>
                    <span className="notification-message">{notification.message}</span>
                  </span>
                  {!notification.is_read ? <span className="unread-dot" /> : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default Notifications;
