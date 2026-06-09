import { supabase } from "../supabaseClient";

const ADMIN_USER_STATE_KEY = "reguideAdminUserState";
const SUPPORT_TICKETS_KEY = "reguideSupportTickets";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function isEmailLike(value) {
  const text = String(value || "").trim();
  return text.includes("@") && text.includes(".");
}

function isSellerRole(role) {
  return String(role || "").trim().toLowerCase() === "seller";
}

function resolveMergedRole(previousRole, nextRole) {
  if (isSellerRole(previousRole) || isSellerRole(nextRole)) {
    return "seller";
  }
  return String(nextRole || previousRole || "").trim().toLowerCase() || "user";
}

function isMissingColumnError(error, columnName) {
  if (!error) return false;
  const text = `${error.message || ""} ${error.details || ""}`.toLowerCase();
  return text.includes("column") && text.includes(String(columnName || "").toLowerCase());
}

function userKey(user) {
  return String(user?.id || normalizeEmail(user?.email) || normalizeName(user?.full_name || user?.name) || "");
}

function getStoredAdminUserState() {
  try {
    const raw = localStorage.getItem(ADMIN_USER_STATE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function setStoredAdminUserState(state) {
  localStorage.setItem(ADMIN_USER_STATE_KEY, JSON.stringify(state || {}));
}

function getStoredSupportTickets() {
  try {
    const raw = localStorage.getItem(SUPPORT_TICKETS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getComplaintCountByEmail() {
  const tickets = getStoredSupportTickets();
  return tickets.reduce((acc, ticket) => {
    const email = normalizeEmail(ticket?.email);
    if (!email) return acc;
    acc[email] = (acc[email] || 0) + 1;
    return acc;
  }, {});
}

function baseStateForUser(user, previous = {}) {
  const role = String(user?.role || "").toLowerCase();
  return {
    suspended: Boolean(previous?.suspended),
    manuallyFlagged: Boolean(previous?.manuallyFlagged),
    verificationStatus:
      previous?.verificationStatus ||
      (role === "seller" ? "pending" : "not_applicable"),
    updatedAt: previous?.updatedAt || null,
  };
}

function toAdminUserRecord(user, storedState, complaintCountByEmail) {
  const key = userKey(user);
  const previous = storedState[key] || {};
  const state = baseStateForUser(user, previous);
  const email = normalizeEmail(user?.email);
  const rawName = String(user?.full_name || user?.name || "").trim();
  const displayName = rawName && !isEmailLike(rawName) ? rawName : "Unknown User";
  const complaintCount = complaintCountByEmail[email] || 0;

  return {
    id: user?.id || null,
    key,
    name: displayName,
    email,
    role: String(user?.role || "user"),
    suspended: state.suspended,
    verificationStatus: state.verificationStatus,
    complaintCount,
    manuallyFlagged: Boolean(state.manuallyFlagged),
    flagged: complaintCount >= 3 || Boolean(state.manuallyFlagged),
    updatedAt: state.updatedAt,
  };
}

function mergeUsers(primaryUsers, fallbackUsers) {
  const merged = new Map();

  [...(fallbackUsers || []), ...(primaryUsers || [])].forEach((user) => {
    const key = userKey(user);
    if (!key) return;

    const previous = merged.get(key) || {};
    const nextRole = resolveMergedRole(previous?.role, user?.role);

    merged.set(key, {
      ...previous,
      ...user,
      id: user?.id || previous?.id || null,
      email: normalizeEmail(user?.email || previous?.email || ""),
      full_name: user?.full_name || previous?.full_name || "",
      name: user?.name || previous?.name || "",
      role: nextRole || "user",
    });
  });

  return Array.from(merged.values());
}

function collectUsersFromLocal() {
  const users = [];

  try {
    const storedUsers = JSON.parse(localStorage.getItem("reguideUsers") || "[]");
    if (Array.isArray(storedUsers)) {
      storedUsers.forEach((user) => users.push(user));
    }
  } catch {
    // Ignore malformed local users.
  }

  try {
    const currentUser = JSON.parse(localStorage.getItem("reguideUser") || "{}");
    if (currentUser && (currentUser?.id || currentUser?.email)) {
      users.push(currentUser);
    }
  } catch {
    // Ignore malformed current user.
  }

  try {
    const guides = JSON.parse(localStorage.getItem("reguideGuides") || "[]");
    if (Array.isArray(guides)) {
      guides.forEach((guide) => {
        if (guide?.seller_id || guide?.seller || guide?.seller_name) {
          users.push({
            id: guide?.seller_id || null,
            full_name: guide?.seller_name || guide?.seller || "Seller",
            role: "seller",
          });
        }
      });
    }
  } catch {
    // Ignore malformed local guides.
  }

  try {
    const orders = JSON.parse(localStorage.getItem("reguideOrders") || "[]");
    if (Array.isArray(orders)) {
      orders.forEach((order) => {
        users.push({
          id: order?.sellerId || null,
          full_name: order?.sellerName || order?.seller || "Seller",
          role: "seller",
        });
        users.push({
          id: null,
          full_name: order?.rentedBy || order?.buyerName || "User",
          email: order?.userEmail || "",
          role: "user",
        });
      });
    }
  } catch {
    // Ignore malformed local orders.
  }

  return users;
}

async function collectUsersFromDbFallback() {
  const users = [];

  try {
    const { data: guideRows, error: guideError } = await supabase
      .from("guides")
      .select("seller_id, seller_name")
      .not("seller_id", "is", null)
      .limit(500);

    if (!guideError && Array.isArray(guideRows)) {
      guideRows.forEach((row) => {
        users.push({
          id: row?.seller_id || null,
          full_name: row?.seller_name || "Seller",
          role: "seller",
        });
      });
    }
  } catch {
    // Ignore guides fallback fetch failures.
  }

  try {
    const { data: orderRows, error: orderError } = await supabase
      .from("orders")
      .select("buyer_id, buyer_email, buyer_name, seller_id, seller_name")
      .limit(500);

    if (!orderError && Array.isArray(orderRows)) {
      orderRows.forEach((row) => {
        users.push({
          id: row?.seller_id || null,
          full_name: row?.seller_name || "Seller",
          role: "seller",
        });
        users.push({
          id: row?.buyer_id || null,
          full_name: row?.buyer_name || "User",
          email: row?.buyer_email || "",
          role: "user",
        });
      });
    }
  } catch {
    // Ignore orders fallback fetch failures.
  }

  return users;
}

async function fetchProfilesForAdminList() {
  const primary = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .order("full_name", { ascending: true });

  if (!primary.error) {
    console.log(`[Admin Fetch] Found ${(primary.data || []).length} profiles from DB`);
    return (primary.data || []).map((user) => ({
      id: user?.id || null,
      full_name: user?.full_name || "",
      email: user?.email || "",
      role: user?.role || "user",
    }));
  }

  console.warn("[Admin Fetch] Primary profiles query error:", primary.error);

  if (isMissingColumnError(primary.error, "role")) {
    const withoutRole = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .order("full_name", { ascending: true });

    if (!withoutRole.error) {
      console.log(`[Admin Fetch] Found ${(withoutRole.data || []).length} profiles from DB (without role column)`);
      return (withoutRole.data || []).map((user) => ({
        id: user?.id || null,
        full_name: user?.full_name || "",
        email: user?.email || "",
        role: "user",
      }));
    }

    console.warn("[Admin Fetch] Profiles query without role failed:", withoutRole.error);
    throw withoutRole.error;
  }

  // Backward compatibility for profile schemas using `name` instead of `full_name`.
  if (isMissingColumnError(primary.error, "full_name")) {
    const legacy = await supabase
      .from("profiles")
      .select("id, name, email, role")
      .order("name", { ascending: true });

    if (!legacy.error) {
      console.log(`[Admin Fetch] Found ${(legacy.data || []).length} profiles (legacy schema) from DB`);
      return (legacy.data || []).map((user) => ({
        id: user?.id || null,
        full_name: user?.name || "",
        email: user?.email || "",
        role: user?.role || "user",
      }));
    }

    console.warn("[Admin Fetch] Legacy profiles query error:", legacy.error);
    throw legacy.error;
  }

  console.warn("[Admin Fetch] Primary query failed, forcing fallback collection");
  throw primary.error;
}

async function fetchSellerIdSetFromGuides() {
  try {
    const { data, error } = await supabase
      .from("guides")
      .select("seller_id")
      .not("seller_id", "is", null)
      .limit(5000);

    if (error || !Array.isArray(data)) {
      return new Set();
    }

    return new Set(
      data
        .map((row) => String(row?.seller_id || "").trim())
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

export async function getAdminManagedUsers() {
  const storedState = getStoredAdminUserState();
  const complaintCountByEmail = getComplaintCountByEmail();

  try {
    const sellerIdSet = await fetchSellerIdSetFromGuides();
    const profileUsers = (await fetchProfilesForAdminList())
      .filter((user) => String(user?.role || "").toLowerCase() !== "admin")
      .map((user) => {
        const userId = String(user?.id || "").trim();
        const roleFromProfile = String(user?.role || "user").toLowerCase();
        const hasUploadedGuides = Boolean(userId) && sellerIdSet.has(userId);

        return {
          ...user,
          role: hasUploadedGuides ? "seller" : roleFromProfile,
        };
      });

    console.log(`[Admin Fetch] Using ${profileUsers.length} users from profiles table (primary)`);

    const result = profileUsers.map((user) =>
      toAdminUserRecord(user, storedState, complaintCountByEmail)
    );

    console.log(`[Admin Fetch] Final DB user count: ${result.length}`);
    return result;
  } catch (primaryError) {
    console.warn("[Admin Fetch] Error from profiles table, returning empty DB-only list:", primaryError?.message);
    return [];
  }
}

function patchUserState(user, partial) {
  const state = getStoredAdminUserState();
  const key = userKey(user);
  if (!key) return;

  const next = {
    ...baseStateForUser(user, state[key] || {}),
    ...partial,
    updatedAt: new Date().toISOString(),
  };

  state[key] = next;
  setStoredAdminUserState(state);
}

export async function setSellerSuspended(user, suspended) {
  patchUserState(user, { suspended: Boolean(suspended) });
}

export async function setSellerVerificationStatus(user, verificationStatus) {
  patchUserState(user, { verificationStatus: verificationStatus || "pending" });
}

export async function setUserFlagged(user, flagged) {
  patchUserState(user, { manuallyFlagged: Boolean(flagged) });
}

export function isSellerSuspended(seller) {
  const key = userKey(seller);
  if (!key) return false;
  const state = getStoredAdminUserState();
  return Boolean(state?.[key]?.suspended);
}

export function getSellerVerificationStatus(seller) {
  const key = userKey(seller);
  if (!key) return "pending";
  const state = getStoredAdminUserState();
  return String(state?.[key]?.verificationStatus || "pending").toLowerCase();
}

export function isSellerVerified(seller) {
  return getSellerVerificationStatus(seller) === "verified";
}

export function recordSupportTicketLocally(ticket) {
  const safeTicket = {
    id: ticket?.id || `local-ticket-${Date.now()}`,
    email: normalizeEmail(ticket?.email),
    subject: String(ticket?.subject || ""),
    message: String(ticket?.message || ""),
    created_at: ticket?.created_at || new Date().toISOString(),
  };

  if (!safeTicket.email) {
    return;
  }

  const tickets = getStoredSupportTickets();
  tickets.unshift(safeTicket);
  localStorage.setItem(SUPPORT_TICKETS_KEY, JSON.stringify(tickets));
}
