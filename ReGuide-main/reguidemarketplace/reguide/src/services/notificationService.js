import { supabase } from "../supabaseClient";
import { fetchAllOrders, fetchMyOrders } from "./orderService";

const NOTIFICATION_UPDATED_EVENT = "reguide-notifications-updated";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LAST_DEADLINE_SCAN_KEY = "reguideLastDeadlineScanAt";
const DEADLINE_SCAN_THROTTLE_MS = 2 * 60 * 1000;

const ADMIN_VISIBLE_NOTIFICATION_TYPES = new Set([
  "rental_deposit_paid",
  "support",
  "guide_rented",
  "guide_purchased",
  "guide_returned",
  "seller_received_guide",
  "guide_flagged",
  "guide_removed",
  "seller_verified",
  "seller_suspended",
  "seller_reactivated",
]);

function isUuid(value) {
  return typeof value === "string" && UUID_REGEX.test(value);
}

function notifyNotificationsChanged() {
  window.dispatchEvent(new Event(NOTIFICATION_UPDATED_EVENT));
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeIdentity(user) {
  return {
    id: isUuid(user?.id) ? user.id : null,
    email: normalizeEmail(user?.email),
    role: String(user?.role || "").toLowerCase(),
    name: user?.full_name || user?.name || user?.email || "User",
  };
}

function notificationMatchesUser(notification, userIdentity) {
  if (!notification || !userIdentity) return false;

  if (userIdentity.id && notification.user_id === userIdentity.id) {
    return true;
  }

  return Boolean(
    userIdentity.email &&
      normalizeEmail(notification.recipient_email) === userIdentity.email
  );
}

function sortNewestFirst(notifications) {
  return [...notifications].sort(
    (a, b) =>
      new Date(b.created_at || 0).getTime() -
      new Date(a.created_at || 0).getTime()
  );
}

function filterAdminVisibleNotifications(notifications) {
  return (notifications || []).filter((n) =>
    ADMIN_VISIBLE_NOTIFICATION_TYPES.has(String(n?.type || ""))
  );
}

async function resolveRecipientEmailById(recipientId) {
  if (!isUuid(recipientId)) return "";

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", recipientId)
      .maybeSingle();

    if (error) return "";
    return normalizeEmail(data?.email);
  } catch {
    return "";
  }
}

export function getCurrentNotificationIdentity() {
  try {
    return normalizeIdentity(
      JSON.parse(localStorage.getItem("reguideUser") || "{}")
    );
  } catch {
    return normalizeIdentity(null);
  }
}

export async function createNotification({
  recipientId,
  recipientEmail,
  actorId,
  actorName,
  type,
  title,
  message,
  link,
  metadata,
}) {
  const normalizedRecipientId = isUuid(recipientId) ? recipientId : null;
  const normalizedRecipientEmail = normalizeEmail(recipientEmail);
  const resolvedRecipientEmail =
    normalizedRecipientEmail || (await resolveRecipientEmailById(normalizedRecipientId));

  if (!normalizedRecipientId && !resolvedRecipientEmail) {
    throw new Error("Notification recipient is missing id/email.");
  }

  const payload = {
    user_id: normalizedRecipientId,
    recipient_email: resolvedRecipientEmail,
    actor_id: isUuid(actorId) ? actorId : null,
    actor_name: actorName || null,
    type: type || "general",
    title: title || "Notification",
    message: message || "",
    link: link || null,
    metadata: metadata || {},
    is_read: false,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("notifications")
    .insert([payload]);

  if (error) {
    console.error("Failed to create notification:", error);
    throw error;
  }

  notifyNotificationsChanged();
  return true;
}

async function getAdminRecipients() {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,role")
      .eq("role", "admin");

    if (error) throw error;

    const unique = new Map();
    (data || []).forEach((row) => {
      const userId = isUuid(row?.id) ? row.id : null;
      const email = normalizeEmail(row?.email);
      if (!userId && !email) return;
      const key = userId || email;
      unique.set(key, {
        user_id: userId,
        recipient_email: email || null,
      });
    });

    const recipients = Array.from(unique.values());
    return recipients;
  } catch {
    return [];
  }
}

export async function createNotificationForAdmins({
  actorId,
  actorName,
  type,
  title,
  message,
  link,
  metadata,
}) {
  const recipients = await getAdminRecipients();
  if (!recipients.length) {
    return [];
  }

  const payloads = recipients.map((recipient) => ({
    user_id: recipient.user_id,
    recipient_email: normalizeEmail(recipient.recipient_email),
    actor_id: isUuid(actorId) ? actorId : null,
    actor_name: actorName || null,
    type: type || "general",
    title: title || "Notification",
    message: message || "",
    link: link || null,
    metadata: metadata || {},
    is_read: false,
    created_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("notifications")
    .insert(payloads);

  if (error) {
    console.error("Failed to create admin notifications:", error);
    throw error;
  }

  notifyNotificationsChanged();
  return true;
}

export async function getNotificationsForCurrentUser() {
  const identity = getCurrentNotificationIdentity();

  if (!identity.id && !identity.email) {
    return [];
  }

  try {
    let query = supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false });

    if (identity.id && identity.email) {
      query = query.or(
        `user_id.eq.${identity.id},recipient_email.eq.${identity.email}`
      );
    } else if (identity.id) {
      query = query.eq("user_id", identity.id);
    } else {
      query = query.eq("recipient_email", identity.email);
    }

    const { data, error } = await query;
    if (error) throw error;

    const remote =
      identity.role === "admin"
        ? filterAdminVisibleNotifications(data || [])
        : data || [];

    return sortNewestFirst(remote);
  } catch {
    return [];
  }
}

export async function markNotificationAsRead(id) {
  if (!id) return;

  try {
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id);
  } catch {}

  notifyNotificationsChanged();
}

export async function markAllNotificationsAsRead() {
  const identity = getCurrentNotificationIdentity();

  try {
    let query = supabase.from("notifications").update({ is_read: true });

    if (identity.id && identity.email) {
      query = query.or(
        `user_id.eq.${identity.id},recipient_email.eq.${identity.email}`
      );
    }

    await query;
  } catch {}

  notifyNotificationsChanged();
}

export async function getUnreadNotificationCount() {
  const notifications = await getNotificationsForCurrentUser();
  return (notifications || []).filter((item) => !item?.is_read).length;
}

export async function ensureRentalDeadlineNotifications() {
  try {
    const now = Date.now();
    const lastScan = Number(localStorage.getItem(LAST_DEADLINE_SCAN_KEY) || 0);
    if (now - lastScan < DEADLINE_SCAN_THROTTLE_MS) {
      return;
    }
    localStorage.setItem(LAST_DEADLINE_SCAN_KEY, String(now));

    const identity = getCurrentNotificationIdentity();
    const orders =
      identity.role === "admin"
        ? await fetchAllOrders().catch(() => [])
        : await fetchMyOrders().catch(() => []);

    if (!Array.isArray(orders) || orders.length === 0) {
      return;
    }

    const existingNotifications = await getNotificationsForCurrentUser();
    const existingKeys = new Set(
      (existingNotifications || []).map((n) => {
        const orderKey =
          n?.metadata?.orderId ||
          n?.metadata?.orderKey ||
          n?.metadata?.order_id ||
          "";
        const reminderStage = String(
          n?.metadata?.reminderStage ||
            n?.metadata?.stage ||
            "default"
        );
        return `${String(n?.type || "")}:${reminderStage}:${String(orderKey)}`;
      })
    );

    const oneDayMs = 24 * 60 * 60 * 1000;

    for (const order of orders) {
      if (!order || String(order.type) !== "rent") continue;
      if (!order.endDate) continue;
      if (order.returned) continue;

      const endTime = new Date(order.endDate).getTime();
      if (!Number.isFinite(endTime)) continue;

      const daysLeft = Math.ceil((endTime - now) / oneDayMs);
      let type = "";
      let reminderStage = "";
      if (daysLeft < 0) {
        type = "rental_overdue";
        reminderStage = "overdue";
      } else if (daysLeft === 0) {
        type = "rental_due_soon";
        reminderStage = "due-today";
      } else if (daysLeft === 3) {
        type = "rental_due_soon";
        reminderStage = "3-days-left";
      } else if (daysLeft === 10) {
        type = "rental_due_soon";
        reminderStage = "10-days-left";
      } else {
        continue;
      }

      const orderKey = String(order.orderId || order.order_key || order.id || "");
      const dedupeKey = `${type}:${reminderStage}:${orderKey}`;
      if (existingKeys.has(dedupeKey)) {
        continue;
      }

      const message =
        type === "rental_overdue"
          ? `${order.title || "Your guide"} rental is overdue. Please return it as soon as possible.`
          : daysLeft === 0
            ? `${order.title || "Your guide"} rental is due today. Return it by today to avoid overdue status.`
            : `${order.title || "Your guide"} rental is due in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`;

      const title =
        type === "rental_overdue"
          ? "Rental overdue"
          : daysLeft === 0
            ? "Rental due today"
            : "Rental due soon";

      if (identity.role === "admin") {
        await createNotificationForAdmins({
          type,
          title,
          message,
          link: "/admin-monitoring",
          metadata: {
            orderId: order.orderId || order.order_key || null,
            guideId: order.guide_id || order.id || null,
            sellerId: order.sellerId || order.seller_id || null,
            reminderStage,
          },
        });
      } else {
        await createNotification({
          recipientId: identity.id,
          recipientEmail: identity.email,
          type,
          title,
          message,
          link: "/myorders",
          metadata: {
            orderId: order.orderId || order.order_key || null,
            guideId: order.guide_id || order.id || null,
            orderType: "rent",
            reminderStage,
          },
        });
      }

      existingKeys.add(dedupeKey);
    }
  } catch {
    // Best-effort helper for non-blocking background notification checks.
  }
}

export function subscribeToNotificationChanges(callback) {
  if (typeof callback !== "function") return () => {};

  const handle = () => callback();

  window.addEventListener(NOTIFICATION_UPDATED_EVENT, handle);

  const interval = setInterval(callback, 5000); // fallback polling

  return () => {
    window.removeEventListener(NOTIFICATION_UPDATED_EVENT, handle);
    clearInterval(interval);
  };
}
