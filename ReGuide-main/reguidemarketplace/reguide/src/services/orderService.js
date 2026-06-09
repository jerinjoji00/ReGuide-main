import { supabase } from "../supabaseClient";
import { assertPhoneVerified, getCurrentUserProfile } from "./userService";

const RENTAL_STATUS_KEY = "reguideRentalStatusByOrder";
const RENTED_GUIDE_LOCK_KEY = "reguideRentedGuideLock";
const PURCHASED_GUIDE_LOCK_KEY = "reguidePurchasedGuideLock";

function getStoredRentalStatusMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(RENTAL_STATUS_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function saveStoredRentalStatusMap(map) {
  localStorage.setItem(RENTAL_STATUS_KEY, JSON.stringify(map || {}));
}

function getStoredRentedGuideLockSet() {
  try {
    const raw = JSON.parse(localStorage.getItem(RENTED_GUIDE_LOCK_KEY) || "[]");
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.map((id) => String(id)));
  } catch {
    return new Set();
  }
}

function saveStoredRentedGuideLockSet(lockSet) {
  localStorage.setItem(RENTED_GUIDE_LOCK_KEY, JSON.stringify(Array.from(lockSet || [])));
}

function getStoredPurchasedGuideLockSet() {
  try {
    const raw = JSON.parse(localStorage.getItem(PURCHASED_GUIDE_LOCK_KEY) || "[]");
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.map((id) => String(id)));
  } catch {
    return new Set();
  }
}

function saveStoredPurchasedGuideLockSet(lockSet) {
  localStorage.setItem(PURCHASED_GUIDE_LOCK_KEY, JSON.stringify(Array.from(lockSet || [])));
}

function lockGuideAsPurchased(guideId) {
  const key = String(guideId || "").trim();
  if (!key) return;
  const lockSet = getStoredPurchasedGuideLockSet();
  lockSet.add(key);
  saveStoredPurchasedGuideLockSet(lockSet);
}

function lockGuideAsRented(guideId) {
  const key = String(guideId || "").trim();
  if (!key) return;
  const lockSet = getStoredRentedGuideLockSet();
  lockSet.add(key);
  saveStoredRentedGuideLockSet(lockSet);
}

function unlockGuideAsRented(guideId) {
  const key = String(guideId || "").trim();
  if (!key) return;
  const lockSet = getStoredRentedGuideLockSet();
  lockSet.delete(key);
  saveStoredRentedGuideLockSet(lockSet);
}

export function getRentedGuideLockSet() {
  return getStoredRentedGuideLockSet();
}

export function getPurchasedGuideLockSet() {
  return getStoredPurchasedGuideLockSet();
}

function getOrderKey(order) {
  return String(order?.orderId || order?.order_key || "").trim();
}

function applyStoredRentalStatuses(orders = []) {
  const statusMap = getStoredRentalStatusMap();
  return (orders || []).map((order) => {
    const key = getOrderKey(order);
    const localStatus = key ? statusMap[key] : null;
    return {
      ...order,
      seller_received: Boolean(order?.seller_received || order?.sellerReceived || localStatus?.sellerReceived),
      buyer_returned: Boolean(order?.buyer_returned || order?.buyerReturned || localStatus?.buyerReturned),
    };
  });
}

function setStoredRentalStatusForOrder(orderKey, patch = {}) {
  const key = String(orderKey || "").trim();
  if (!key) return;
  const current = getStoredRentalStatusMap();
  current[key] = {
    ...(current[key] || {}),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  saveStoredRentalStatusMap(current);
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "") return false;
  }
  return Boolean(value);
}

function getFriendlyOrderConflictMessage(orderType) {
  return orderType === "buy"
    ? "sorry guide is already purchased"
    : "guide is already rented";
}

async function insertWalletRows(rows = []) {
  const payload = (rows || []).filter(Boolean);
  if (payload.length === 0) return [];

  const { data, error } = await supabase
    .from("wallet_transactions")
    .insert(payload)
    .select("id");

  if (error) {
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("wallet_transactions") || message.includes("relation") || message.includes("does not exist")) {
      return [];
    }
    throw new Error(error.message || "Could not write wallet transactions.");
  }

  return data || [];
}

async function createWalletRowsForRentalOrder(orderRow) {
  if (!orderRow || String(orderRow?.order_type || orderRow?.type || "") !== "rent") return;

  const deposit = Number(orderRow?.deposit || 0);
  if (deposit <= 0) return;

  const orderId = orderRow?.id || null;
  const guideTitle = orderRow?.guide_title || orderRow?.title || "Guide";
  const buyerId = orderRow?.buyer_id || null;
  const sellerId = orderRow?.seller_id || null;

  const rows = [];
  if (buyerId) {
    rows.push({
      user_id: buyerId,
      order_id: orderId,
      transaction_type: "deposit_paid",
      amount: deposit,
      status: "locked",
      note: `Deposit paid for ${guideTitle}`,
    });
  }

  if (sellerId) {
    rows.push({
      user_id: sellerId,
      order_id: orderId,
      transaction_type: "locked_deposit",
      amount: deposit,
      status: "locked",
      note: `Deposit locked for ${guideTitle}`,
    });
  }

  await insertWalletRows(rows);
}

function normalizeOrder(row) {
  if (!row) return null;

  let review = null;
  if (row.review_rating && row.review_comment) {
    review = {
      rating: Number(row.review_rating),
      comment: String(row.review_comment),
    };
  } else if (row.review) {
    review = typeof row.review === "object"
      ? row.review
      : (() => { try { return JSON.parse(row.review); } catch { return null; } })();
  }

  return {
    ...row,
    orderId: row.order_key || row.id,
    id: row.guide_id || row.id,
    title: row.guide_title || row.title || "",
    type: row.order_type || row.type || "buy",
    amount: row.amount || 0,
    deposit: row.deposit || 0,
    userEmail: row.buyer_email || row.userEmail || "",
    rentedBy: row.buyer_name || row.rentedBy || "",
    sellerId: row.seller_id || row.sellerId || null,
    sellerName: row.seller_name || row.sellerName || "",
    endDate: row.end_date || row.endDate || null,
    purchaseDate: row.purchase_date || row.purchaseDate || null,
    duration: row.duration_months || row.duration || null,
    returned: toBoolean(row.returned),
    returned_at: row.returned_at || row.returnedAt || null,
    review,
    review_rating: row.review_rating || null,
    review_comment: row.review_comment || null,
    reviewed_by: row.reviewed_by || null,
  };
}

function getLocalOrdersFallback() {
  try {
    const raw = JSON.parse(localStorage.getItem("reguideOrders") || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeOrder).filter(Boolean);
  } catch {
    return [];
  }
}

async function enrichOrdersWithGuideDetails(orders) {
  const normalizedOrders = Array.isArray(orders) ? orders.filter(Boolean) : [];
  if (normalizedOrders.length === 0) return [];

  const guideIds = Array.from(
    new Set(
      normalizedOrders
        .map((order) => order.guide_id || order.id)
        .filter((guideId) => guideId !== null && guideId !== undefined)
    )
  );

  if (guideIds.length === 0) return normalizedOrders;

  const { data: guideRows, error } = await supabase
    .from("guides")
    .select("id, condition, edition, subject, description, pages, photo_url")
    .in("id", guideIds);

  if (error || !Array.isArray(guideRows) || guideRows.length === 0) {
    return normalizedOrders;
  }

  const guidesById = new Map(guideRows.map((guide) => [String(guide.id), guide]));

  return normalizedOrders.map((order) => {
    const key = String(order.guide_id || order.id || "");
    const guide = guidesById.get(key);
    if (!guide) return order;

    return {
      ...order,
      condition: order.condition || guide.condition || "Not specified",
      edition: order.edition || guide.edition || "Not specified",
      subject: order.subject || guide.subject || order.examType || "General",
      description: order.description || guide.description || "",
      totalPages: order.totalPages || guide.pages || 0,
      photoUrl: order.photoUrl || guide.photo_url || null,
    };
  });
}

export async function fetchMyOrders() {
  const profile = await getCurrentUserProfile();
  if (!profile) return [];

  const userId = profile?.id || "";
  const email = profile?.email || "";

  let query = supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (userId) {
    query = query.eq("buyer_id", userId);
  } else if (email) {
    query = query.eq("buyer_email", email);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message || "Could not fetch orders.");

  const normalizedOrders = applyStoredRentalStatuses((data || []).map(normalizeOrder));
  return enrichOrdersWithGuideDetails(normalizedOrders);
}

export async function fetchOrdersBySeller(sellerId) {
  if (!sellerId) return [];

  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message || "Could not fetch seller orders.");

  const normalizedOrders = applyStoredRentalStatuses((data || []).map(normalizeOrder));
  return enrichOrdersWithGuideDetails(normalizedOrders);
}

export async function fetchAllOrders() {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    // RLS can deny admin reads in some environments; fallback keeps monitoring usable.
    const localOrders = getLocalOrdersFallback();
    if (localOrders.length > 0) {
      return enrichOrdersWithGuideDetails(applyStoredRentalStatuses(localOrders));
    }
    throw new Error(error.message || "Could not fetch orders.");
  }

  const normalizedOrders = applyStoredRentalStatuses((data || []).map(normalizeOrder));
  return enrichOrdersWithGuideDetails(normalizedOrders);
}

export async function getAllOrdersForAdmin() {
  return fetchAllOrders();
}

export async function createOrder(order) {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error("Please log in before placing an order.");

  assertPhoneVerified(profile, "buy or rent guides");

  const orderType = order?.type || "buy";
  const guideId = order?.id || null;
  const currentUserId = String(profile?.id || "").trim();
  const currentUserEmail = String(profile?.email || "").trim().toLowerCase();
  const sellerId = String(order?.sellerId || "").trim();
  const sellerEmail = String(order?.sellerEmail || "").trim().toLowerCase();

  if (
    (currentUserId && sellerId && currentUserId === sellerId) ||
    (currentUserEmail && sellerEmail && currentUserEmail === sellerEmail)
  ) {
    throw new Error("You cannot buy or rent your own guide.");
  }

  if (guideId) {
    if (orderType === "buy") {
      const { data: existingBuy } = await supabase
        .from("orders")
        .select("id")
        .eq("guide_id", guideId)
        .eq("order_type", "buy")
        .limit(1);

      if (Array.isArray(existingBuy) && existingBuy.length > 0) {
        throw new Error(getFriendlyOrderConflictMessage("buy"));
      }
    }

    if (orderType === "rent") {
      const { data: existingRent } = await supabase
        .from("orders")
        .select("id")
        .eq("guide_id", guideId)
        .eq("order_type", "rent")
        .eq("returned", false)
        .limit(1);

      if (Array.isArray(existingRent) && existingRent.length > 0) {
        throw new Error(getFriendlyOrderConflictMessage("rent"));
      }
    }
  }

  const payload = {
    order_key: order.orderId || `order-${Date.now()}`,
    guide_id: order.id || null,
    guide_title: order.title || "",
    buyer_id: profile.id || null,
    buyer_email: order.userEmail || profile.email || "",
    buyer_name: order.rentedBy || profile.full_name || profile.name || profile.email || "Unknown",
    seller_id: order.sellerId || null,
    seller_name: order.sellerName || "",
    order_type: order.type || "buy",
    amount: order.amount || 0,
    deposit: order.deposit || 0,
    duration_months: order.duration || null,
    end_date: order.endDate || null,
    purchase_date: order.purchaseDate || null,
    returned: false,
    review: null,
    review_rating: null,
    review_comment: null,
    reviewed_by: null,
  };

  const { data, error } = await supabase
    .from("orders")
    .insert([payload])
    .select("*")
    .maybeSingle();

  if (error) {
    const message = String(error?.message || "").toLowerCase();
    const foreignKeyViolation =
      message.includes("foreign key") ||
      message.includes("fk_orders_seller") ||
      message.includes("violates");

    if (foreignKeyViolation) {
      throw new Error(getFriendlyOrderConflictMessage(orderType));
    }

    throw new Error(error.message || "Could not insert order.");
  }

  // ✅ also save to localStorage as backup
  const existing = JSON.parse(localStorage.getItem("reguideOrders") || "[]");
  const normalized = {
    ...normalizeOrder(data || payload),
    condition: (data || payload)?.condition || order?.condition || "Not specified",
    edition: (data || payload)?.edition || order?.edition || "Not specified",
    subject: (data || payload)?.subject || order?.subject || "General",
    description: (data || payload)?.description || order?.description || "",
    totalPages: (data || payload)?.pages || order?.totalPages || 0,
    photoUrl: (data || payload)?.photo_url || order?.photoUrl || null,
  };
  const key = getOrderKey(normalized);
  if (key) {
    setStoredRentalStatusForOrder(key, { sellerReceived: false, buyerReturned: false });
  }
  if (String(payload.order_type) === "rent" && payload.guide_id != null) {
    lockGuideAsRented(payload.guide_id);
  }
  if (String(payload.order_type) === "buy" && payload.guide_id != null) {
    lockGuideAsPurchased(payload.guide_id);
  }

  try {
    await createWalletRowsForRentalOrder(data || payload);
  } catch {
    // Wallet writes are best-effort and should not block order creation.
  }

  existing.push(normalized);
  localStorage.setItem("reguideOrders", JSON.stringify(existing));
  window.dispatchEvent(new Event("reguide-orders-updated"));

  return normalized;
}

export async function updateOrderReview(orderId, review, reviewedById) {
  if (!orderId) throw new Error("Order id is required to save review.");

  const payload = {
    review: review,
    review_rating: review?.rating ?? null,
    review_comment: review?.comment || "",
    reviewed_by: reviewedById || null,
  };

  for (const column of ["order_key", "id"]) {
    const { data, error } = await supabase
      .from("orders")
      .update(payload)
      .eq(column, orderId)
      .select("*");

    if (error) continue;

    if (Array.isArray(data) && data.length > 0) {
      const stored = JSON.parse(localStorage.getItem("reguideOrders") || "[]");
      const updated = stored.map(o =>
        (o.orderId === orderId || o.order_key === orderId)
          ? { ...o, review, review_rating: review.rating, review_comment: review.comment }
          : o
      );
      localStorage.setItem("reguideOrders", JSON.stringify(updated));
      window.dispatchEvent(new Event("reguide-orders-updated"));
      return normalizeOrder(data[0]);
    }
  }

  throw new Error("Could not update review in Supabase.");
}

// ✅ fetch reviews from Supabase only — same for all accounts
export async function fetchGuideReviews(guideId) {
  if (!guideId) return [];

  console.log("fetchGuideReviews called with:", guideId);

  const { data, error } = await supabase
    .from("orders")
    .select("review, review_rating, review_comment, buyer_name, created_at")
    .eq("guide_id", guideId)
    .not("review_rating", "is", null)
    .order("created_at", { ascending: false });

  console.log("Raw data from Supabase:", data);
  console.log("Error:", error);

  if (error) {
    console.warn("Could not fetch guide reviews:", error.message);
    return [];
  }

  const mapped = (data || [])
    .filter(row => Number(row.review_rating) > 0)
    .map(row => {
      const reviewObject = row?.review && typeof row.review === "object"
        ? row.review
        : (() => {
          try {
            return row?.review ? JSON.parse(row.review) : null;
          } catch {
            return null;
          }
        })();

      const photos = Array.isArray(reviewObject?.photos)
        ? reviewObject.photos.filter((url) => typeof url === "string" && url.trim())
        : Array.isArray(reviewObject?.images)
          ? reviewObject.images.filter((url) => typeof url === "string" && url.trim())
          : [];

      return {
        rating: Number(row.review_rating),
        comment: String(row.review_comment || "").trim(),
        reviewedBy: row.buyer_name || "Anonymous",
        createdAt: row.created_at,
        photos,
      };
    });

  console.log("Mapped reviews:", mapped);
  return mapped;
}

export async function markGuideRentalsReturned(guideId, sellerId = null) {
  if (!guideId) return 0;

  const returnedAt = new Date().toISOString().split("T")[0];

  let targetsQuery = supabase
    .from("orders")
    .select("id, buyer_id, seller_id, deposit, guide_title")
    .eq("guide_id", guideId)
    .eq("order_type", "rent")
    .eq("returned", false);

  if (sellerId) {
    targetsQuery = targetsQuery.eq("seller_id", sellerId);
  }

  const { data: targetsData } = await targetsQuery;
  const targetRows = Array.isArray(targetsData) ? targetsData : [];

  let query = supabase
    .from("orders")
    .update({
      returned: true,
      returned_at: returnedAt,
    })
    .eq("guide_id", guideId)
    .eq("order_type", "rent")
    .eq("returned", false);

  if (sellerId) {
    query = query.eq("seller_id", sellerId);
  }

  const { error, count } = await query;
  if (error) {
    throw new Error(error.message || "Could not mark rentals as returned.");
  }

  const updates = (targetRows || []).map((row) => {
    const orderId = row?.id || null;
    const deposit = Number(row?.deposit || 0);
    if (deposit <= 0) return [];
    const title = row?.guide_title || "Guide";
    return [
      row?.seller_id
        ? {
            user_id: row.seller_id,
            order_id: orderId,
            transaction_type: "deposit_unlocked",
            amount: deposit,
            status: "unlocked",
            note: `Deposit unlocked after return for ${title}`,
          }
        : null,
      row?.buyer_id
        ? {
            user_id: row.buyer_id,
            order_id: orderId,
            transaction_type: "deposit_refunded",
            amount: deposit,
            status: "refunded",
            note: `Deposit refunded for ${title}`,
          }
        : null,
    ];
  }).flat().filter(Boolean);

  try {
    if ((targetRows || []).length > 0) {
      const orderIds = targetRows.map((row) => row.id).filter(Boolean);
      if (orderIds.length > 0) {
        await supabase
          .from("wallet_transactions")
          .update({ status: "unlocked" })
          .in("order_id", orderIds)
          .eq("transaction_type", "locked_deposit")
          .eq("status", "locked");
      }
    }
    await insertWalletRows(updates);
  } catch {
    // Wallet writes are best-effort and should not block return operations.
  }

  try {
    const stored = JSON.parse(localStorage.getItem("reguideOrders") || "[]");
    if (Array.isArray(stored)) {
      const updated = stored.map((order) => {
        const sameGuide = String(order?.id || order?.guide_id || "") === String(guideId);
        const sameSeller = !sellerId || String(order?.sellerId || order?.seller_id || "") === String(sellerId);
        const isRent = String(order?.type || order?.order_type || "") === "rent";
        const isPendingReturn = order?.returned !== true;
        if (sameGuide && sameSeller && isRent && isPendingReturn) {
          return { ...order, returned: true, returned_at: returnedAt, returnedAt };
        }
        return order;
      });
      localStorage.setItem("reguideOrders", JSON.stringify(updated));
    }
  } catch {}

  unlockGuideAsRented(guideId);

  window.dispatchEvent(new Event("reguide-orders-updated"));
  return count || 0;
}

export async function markOrderAsReturnedByBuyer(orderId) {
  if (!orderId) throw new Error("Order id is required.");

  let matchedOrderKey = String(orderId || "").trim();

  for (const column of ["order_key", "id"]) {
    const { data, error } = await supabase
      .from("orders")
      .select("id,order_key")
      .eq(column, orderId)
      .limit(1);

    if (error) continue;
    if (Array.isArray(data) && data.length > 0) {
      matchedOrderKey = String(data[0]?.order_key || data[0]?.id || matchedOrderKey).trim();
      break;
    }
  }

  try {
    const stored = JSON.parse(localStorage.getItem("reguideOrders") || "[]");
    if (Array.isArray(stored)) {
      const updated = stored.map((order) => {
        const key = String(order?.orderId || order?.order_key || order?.id || "").trim();
        if (key !== String(orderId) && key !== matchedOrderKey) return order;
        return { ...order, buyer_returned: true, buyerReturned: true };
      });
      localStorage.setItem("reguideOrders", JSON.stringify(updated));
    }
  } catch {}

  setStoredRentalStatusForOrder(matchedOrderKey || orderId, { buyerReturned: true });
  window.dispatchEvent(new Event("reguide-orders-updated"));
  return true;
}

export async function markGuideRentalsReceivedBySeller(guideId, sellerId = null) {
  if (!guideId) return 0;

  let effectiveSellerId = sellerId;
  if (!effectiveSellerId) {
    const profile = await getCurrentUserProfile().catch(() => null);
    effectiveSellerId = profile?.id || null;
  }

  const sellerOrders = await fetchOrdersBySeller(effectiveSellerId).catch(() => []);
  const targetOrders = (sellerOrders || []).filter(
    (order) =>
      String(order?.id || "") === String(guideId) &&
      String(order?.type || "") === "rent" &&
      order?.returned !== true
  );

  targetOrders.forEach((order) => {
    const key = getOrderKey(order);
    if (key) {
      setStoredRentalStatusForOrder(key, { sellerReceived: true });
    }
  });

  window.dispatchEvent(new Event("reguide-orders-updated"));
  return targetOrders.length;
}