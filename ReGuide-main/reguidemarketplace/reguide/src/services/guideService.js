import { supabase } from "../supabaseClient";
import {
  fetchAllOrders,
  getPurchasedGuideLockSet,
  fetchOrdersBySeller,
  getRentedGuideLockSet,
  markGuideRentalsReceivedBySeller,
  markGuideRentalsReturned,
} from "./orderService";
import { assertPhoneVerified, getCurrentUserProfile } from "./userService";
import { isSellerSuspended, isSellerVerified } from "./adminUserService";
import { getRemovedGuideIdSet } from "./adminGuideService";

const GUIDE_IMAGES_BUCKET = "guide-images";
const STATUS_COLUMN = "status";
const LEGACY_STATUS_COLUMN = "moderation_status";
const inMemoryGuides = [];
const inMemoryPricingTypeMap = {};

/* ---------------- HELPERS ---------------- */

function toNumberOrNull(value) {
  if (!value) return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function sanitizeFileName(name = "guide") {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isMissingColumnError(error, columnName) {
  if (!error) return false;
  const text = `${error.message || ""} ${error.details || ""}`.toLowerCase();
  return text.includes("column") && text.includes(columnName.toLowerCase());
}

async function dropUnsupportedGuideColumns(payload) {
  const optionalColumns = ["author", "difficulty_level", "front_cover_url", "back_cover_url", "index_page_url"];
  const nextPayload = { ...(payload || {}) };

  while (true) {
    const activeColumns = optionalColumns.filter((column) => Object.prototype.hasOwnProperty.call(nextPayload, column));
    if (activeColumns.length === 0) {
      break;
    }

    const { error } = await supabase
      .from("guides")
      .select(`id, ${activeColumns.join(", ")}`)
      .limit(1);

    if (!error) {
      break;
    }

    const missingColumn = activeColumns.find((column) => isMissingColumnError(error, column));
    if (!missingColumn) {
      break;
    }

    delete nextPayload[missingColumn];
  }

  return nextPayload;
}

function toLegacyStatusValue(value) {
  return String(value || "").toLowerCase();
}

function getCanonicalGuideStatus(guide) {
  const status = String(guide?.status || "").trim();
  if (status) return status.toLowerCase();
  return String(guide?.moderation_status || "").trim().toLowerCase();
}

async function resolveSeedGuidesWithRealSellers(seedGuides) {
  const seeds = Array.isArray(seedGuides) ? seedGuides : [];
  if (seeds.length === 0) return [];

  try {
    const { data: guideRows, error: guideError } = await supabase
      .from("guides")
      .select("seller_id, seller_name")
      .not("seller_id", "is", null)
      .limit(100);

    if (!guideError && Array.isArray(guideRows) && guideRows.length > 0) {
      const sellersFromGuides = Array.from(
        new Map(
          guideRows
            .filter((row) => row?.seller_id)
            .map((row) => [row.seller_id, { id: row.seller_id, full_name: row.seller_name || "Seller" }])
        ).values()
      );

      if (sellersFromGuides.length > 0) {
        return seeds.map((guide, index) => {
          const seller = sellersFromGuides[index % sellersFromGuides.length];
          return {
            ...guide,
            seller_id: seller.id,
            seller: seller.full_name || guide.seller,
          };
        });
      }
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name")
      .limit(50);

    if (error || !Array.isArray(data) || data.length === 0) return seeds;

    const sellers = data.filter((profile) => profile?.id);
    if (sellers.length === 0) return seeds;

    return seeds.map((guide, index) => {
      const seller = sellers[index % sellers.length];
      return {
        ...guide,
        seller_id: seller.id,
        seller: seller.full_name || guide.seller,
      };
    });
  } catch {
    return seeds;
  }
}

async function fetchGuidesByStatus(statusValue) {
  const normalizedStatus = String(statusValue || "").trim();
  const normalizedStatusLower = normalizedStatus.toLowerCase();
  const statusVariants = Array.from(new Set([
    normalizedStatus,
    normalizedStatus.toLowerCase(),
    normalizedStatus.toUpperCase(),
    normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1).toLowerCase(),
  ])).filter(Boolean);

  const matchesRequestedStatus = (guide) => {
    const canonicalStatus = getCanonicalGuideStatus(guide);
    return canonicalStatus === normalizedStatusLower;
  };

  const { data, error } = await supabase
    .from("guides")
    .select("*")
    .in(STATUS_COLUMN, statusVariants)
    .order("created_at", { ascending: false });

  if (!error) {
    // Some DBs keep moderation state in legacy column while `status` may be null.
    const { data: legacyData, error: legacyError } = await supabase
      .from("guides")
      .select("*")
      .in(LEGACY_STATUS_COLUMN, [toLegacyStatusValue(statusValue)])
      .order("created_at", { ascending: false });

    if (legacyError && !isMissingColumnError(legacyError, LEGACY_STATUS_COLUMN)) {
      // Keep the successful primary results instead of failing browse entirely.
      return (data || []).filter(matchesRequestedStatus);
    }

    const merged = Array.from(
      new Map([...(data || []), ...((legacyData || []))].map((guide) => [String(guide?.id), guide])).values()
    );

    return merged.filter(matchesRequestedStatus);
  }

  if (!isMissingColumnError(error, STATUS_COLUMN)) {
    // Fallback for intermittent PostgREST/RLS server errors on filtered queries.
    const { data: allData, error: allError } = await supabase
      .from("guides")
      .select("*")
      .order("created_at", { ascending: false });

    if (allError) throw allError;
    return (allData || []).filter(matchesRequestedStatus);
  }

  const { data: legacyData, error: legacyError } = await supabase
    .from("guides")
    .select("*")
    .eq(LEGACY_STATUS_COLUMN, toLegacyStatusValue(statusValue))
    .order("created_at", { ascending: false });

  if (legacyError) {
    if (
      isMissingColumnError(legacyError, LEGACY_STATUS_COLUMN) &&
      String(statusValue).toLowerCase() === "approved"
    ) {
      const { data: allData, error: allError } = await supabase
        .from("guides")
        .select("*")
        .order("created_at", { ascending: false });

      if (allError) throw allError;
      return allData || [];
    }
    throw legacyError;
  }

  return legacyData || [];
}

async function updateGuideStatus(id, statusValue) {
  const { error } = await supabase
    .from("guides")
    .update({ [STATUS_COLUMN]: statusValue })
    .eq("id", id);

  if (!error) return;

  if (!isMissingColumnError(error, STATUS_COLUMN)) throw error;

  const { error: legacyError } = await supabase
    .from("guides")
    .update({ [LEGACY_STATUS_COLUMN]: toLegacyStatusValue(statusValue) })
    .eq("id", id);

  if (legacyError) throw legacyError;
}

async function updateGuideMarketPrice(id, marketPrice) {
  const { error } = await supabase
    .from("guides")
    .update({ market_price: marketPrice })
    .eq("id", id);

  if (error) throw error;
}

/* ---------------- IMAGE UPLOAD ---------------- */

async function uploadGuidePhoto(file, sellerId) {
  if (!file) return null;

  const safeName = sanitizeFileName(file.name);
  const path = `${sellerId || "anonymous"}/${Date.now()}-${safeName}`;

  const { error } = await supabase.storage
    .from(GUIDE_IMAGES_BUCKET)
    .upload(path, file);

  if (error) throw error;

  const { data } = supabase.storage
    .from(GUIDE_IMAGES_BUCKET)
    .getPublicUrl(path);

  return data.publicUrl;
}

/* ---------------- LOCAL STORAGE ---------------- */

function getLocalGuides() {
  return [...inMemoryGuides];
}

function saveLocalGuides(guides) {
  inMemoryGuides.length = 0;
  inMemoryGuides.push(...(Array.isArray(guides) ? guides : []));
}

function getPricingTypeMap() {
  return { ...inMemoryPricingTypeMap };
}

function savePricingTypeMap(map) {
  Object.keys(inMemoryPricingTypeMap).forEach((key) => delete inMemoryPricingTypeMap[key]);
  Object.assign(inMemoryPricingTypeMap, map || {});
}

function storeGuidePricingType(guideId, pricingType) {
  if (!guideId || !pricingType) return;
  const map = getPricingTypeMap();
  map[String(guideId)] = pricingType;
  savePricingTypeMap(map);
}

function getStoredGuidePricingType(guideId) {
  if (!guideId) return "";
  const map = getPricingTypeMap();
  return map[String(guideId)] || "";
}

function toPriceNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function resolvePricingType(guide) {
  const raw = String(
    guide?.pricingType ||
    guide?.pricing_type ||
    getStoredGuidePricingType(guide?.id) ||
    ""
  ).trim().toLowerCase();

  if (
    raw === "renting only" ||
    raw === "purchase only" ||
    raw === "both renting and purchase"
  ) {
    return raw;
  }
  return "both renting and purchase";
}

function normalizeGuideForUI(guide) {
  const normalizedCondition =
    guide.condition ||
    guide.book_condition ||
    guide.status ||
    "Not specified";

  const pricingType = resolvePricingType(guide);
  const rentalPrice = toPriceNumber(guide.rentalPrice ?? guide.rental_price);
  const buyPrice = toPriceNumber(guide.buyPrice ?? guide.purchase_price);
  const hasRent =
    pricingType === "renting only" ||
    pricingType === "both renting and purchase";
  const hasBuy =
    pricingType === "purchase only" ||
    pricingType === "both renting and purchase";
  const refundableDeposit = hasRent ? buyPrice : 0;

  const marketPrice =
    guide.market_price != null
      ? Number(guide.market_price)
      : guide.marketPrice != null
      ? Number(guide.marketPrice)
      : null;

  const sellerVerified = isSellerVerified({
    id: guide?.seller_id || guide?.sellerId || null,
    email: guide?.seller_email || guide?.sellerEmail || null,
    full_name: guide?.seller_name || guide?.seller || "",
    name: guide?.seller_name || guide?.seller || "",
  });

  return {
    ...guide,
    sellerVerified,
    pricingType,
    hasRent,
    hasBuy,
    examType: guide.examType || guide.subject || "General",
    examColor: guide.examColor || "bg-blue",
    relevance: guide.relevance || "High Relevance",
    author: guide.author || guide.writer || guide.seller_name || "Unknown",
    difficultyLevel: guide.difficultyLevel || guide.difficulty_level || "",
    seller: guide.seller || guide.seller_name || "Unknown Seller",
    photoUrl: guide.front_cover_url || guide.photoUrl || guide.photo_url || null,
    frontCoverUrl: guide.front_cover_url || guide.frontCoverUrl || guide.photoUrl || guide.photo_url || null,
    backCoverUrl: guide.back_cover_url || guide.backCoverUrl || null,
    indexPageUrl: (() => {
      const raw = guide.index_page_url || guide.indexPageUrl;
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed[0] : raw;
      } catch {
        return raw;
      }
    })(),
    indexPageUrls: (() => {
      const raw = guide.index_page_url || guide.indexPageUrl;
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [raw];
      } catch {
        return [raw];
      }
    })(),
    totalPages: guide.totalPages || guide.pages || 0,
    condition: normalizedCondition,
    rentalPrice,
    buyPrice,
    refundableDeposit,
    marketPrice,
    status: guide.status || guide.moderation_status || "New",
    pricing: {
      rent: {
        price: rentalPrice,
        deposit: refundableDeposit,
        total: rentalPrice + refundableDeposit,
        period: "per month",
      },
      buy: {
        price: buyPrice,
        sale: false,
      },
    },
  };
}

/* ---------------- CREATE GUIDE ---------------- */

export async function createGuideListing(formData) {
  const seller = await getCurrentUserProfile();

  assertPhoneVerified(seller, "sell guides");

  // ✅ block admin from submitting guides
  if (seller?.role === "admin" || seller?.email === "admin@gmail.com") {
    throw new Error("Admin cannot list guides.");
  }

  if (isSellerSuspended(seller)) {
    throw new Error("Your seller account is suspended. You cannot list guides right now.");
  }

  const { data: authData } = await supabase.auth.getUser();
  const authUser = authData?.user || null;

  const sellerId = seller?.id || authUser?.id || null;
  const sellerName =
    seller?.name ||
    seller?.full_name ||
    seller?.email ||
    authUser?.user_metadata?.full_name ||
    authUser?.email ||
    "Unknown Seller";

  if (!sellerId) {
    const authError = new Error("Please log in again before listing a guide.");
    authError.code = "AUTH_REQUIRED";
    throw authError;
  }

  // Support both new format (indexPageFiles array) and legacy format (indexPageFile single)
  const indexFiles = formData?.indexPageFiles && Array.isArray(formData.indexPageFiles) 
    ? formData.indexPageFiles 
    : (formData?.indexPageFile ? [formData.indexPageFile] : []);

  if (!formData?.frontCoverFile || !formData?.backCoverFile || indexFiles.length === 0) {
    throw new Error("Front cover, back cover, and at least one index/contents image are required.");
  }

  let frontCoverUrl = null;
  let backCoverUrl = null;
  let indexPageUrls = [];

  try {
    frontCoverUrl = await uploadGuidePhoto(formData.frontCoverFile, sellerId);
    backCoverUrl = await uploadGuidePhoto(formData.backCoverFile, sellerId);
    
    for (const indexFile of indexFiles) {
      if (indexFile) {
        const url = await uploadGuidePhoto(indexFile, sellerId);
        if (url) indexPageUrls.push(url);
      }
    }
  } catch (e) {
    throw new Error("Guide image upload failed. Please try again.");
  }

  if (!frontCoverUrl || !backCoverUrl || indexPageUrls.length === 0) {
    throw new Error("All required guide images must be uploaded.");
  }

  const indexPageUrl = indexPageUrls[0];
  const indexPageUrlsJson = JSON.stringify(indexPageUrls);

  const rawPayload = {
    seller_id: sellerId,
    seller_name: sellerName,
    title: formData.title,
    author: formData.author || null,
    subject: formData.subject,
    description: formData.description,
    pages: toNumberOrNull(formData.pages),
    condition: formData.condition,
    edition: formData.edition || null,
    year: toNumberOrNull(formData.year),
    difficulty_level: formData.difficultyLevel || null,
    pricing_type: formData.pricingType || "both renting and purchase",
    rental_price: toNumberOrNull(formData.rentalPrice),
    purchase_price: toNumberOrNull(formData.purchasePrice),
    photo_url: frontCoverUrl,
    front_cover_url: frontCoverUrl,
    back_cover_url: backCoverUrl,
    index_page_url: indexPageUrlsJson,
    status: "Pending",
  };

  const payload = await dropUnsupportedGuideColumns(rawPayload);

  try {
    const { data, error } = await supabase
      .from("guides")
      .insert([payload])
      .select()
      .single();

    if (error && isMissingColumnError(error, "pricing_type")) {
      const { pricing_type, ...payloadWithoutPricingType } = payload;

      const { data: fallbackData, error: fallbackError } = await supabase
        .from("guides")
        .insert([payloadWithoutPricingType])
        .select()
        .single();

      if (fallbackError && isMissingColumnError(fallbackError, STATUS_COLUMN)) {
        const { status, ...payloadWithoutStatus } = payloadWithoutPricingType;

        const { data: legacyData, error: legacyError } = await supabase
          .from("guides")
          .insert([{ ...payloadWithoutStatus, moderation_status: "pending" }])
          .select()
          .single();

        if (!legacyError) {
          storeGuidePricingType(legacyData?.id, payload.pricing_type);
          window.dispatchEvent(new Event("reguide-guides-updated"));
          return legacyData;
        }

        if (!isMissingColumnError(legacyError, LEGACY_STATUS_COLUMN)) throw legacyError;

        const { data: noStatusData, error: noStatusError } = await supabase
          .from("guides")
          .insert([payloadWithoutStatus])
          .select()
          .single();

        if (noStatusError) throw noStatusError;

        storeGuidePricingType(noStatusData?.id, payload.pricing_type);
        window.dispatchEvent(new Event("reguide-guides-updated"));
        return noStatusData;
      }

      if (fallbackError) throw fallbackError;

      storeGuidePricingType(fallbackData?.id, payload.pricing_type);
      window.dispatchEvent(new Event("reguide-guides-updated"));
      return fallbackData;
    }

    if (error && isMissingColumnError(error, STATUS_COLUMN)) {
      const { status, ...payloadWithoutStatus } = payload;

      const { data: legacyData, error: legacyError } = await supabase
        .from("guides")
        .insert([{ ...payloadWithoutStatus, moderation_status: "pending" }])
        .select()
        .single();

      if (!legacyError) {
        storeGuidePricingType(legacyData?.id, payload.pricing_type);
        window.dispatchEvent(new Event("reguide-guides-updated"));
        return legacyData;
      }

      if (!isMissingColumnError(legacyError, LEGACY_STATUS_COLUMN)) throw legacyError;

      const { data: noStatusData, error: noStatusError } = await supabase
        .from("guides")
        .insert([payloadWithoutStatus])
        .select()
        .single();

      if (noStatusError) throw noStatusError;

      storeGuidePricingType(noStatusData?.id, payload.pricing_type);
      window.dispatchEvent(new Event("reguide-guides-updated"));
      return noStatusData;
    }

    if (error) throw error;

    storeGuidePricingType(data?.id, payload.pricing_type);
    window.dispatchEvent(new Event("reguide-guides-updated"));
    return data;

  } catch (err) {
    if (
      err?.code === "23502" &&
      String(err?.message || "").toLowerCase().includes("seller_id")
    ) {
      throw new Error("Please log in again before listing a guide.");
    }

    console.error("Supabase insert error", err);

    const localGuide = { id: `local-${Date.now()}`, ...payload };
    storeGuidePricingType(localGuide.id, payload.pricing_type);
    const local = getLocalGuides();
    saveLocalGuides([localGuide, ...local]);
    return localGuide;
  }
}

/* ---------------- FETCH APPROVED GUIDES ---------------- */

/* ---------------- FETCH APPROVED GUIDES ---------------- */

export async function getAllBrowseGuides(seedGuides = []) {
  const seeds = await resolveSeedGuidesWithRealSellers(seedGuides);

  /* ✅ GLOBAL ORDERS FETCH (FIXED FOR ALL USERS) */
  let orders = [];
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("*");

    if (error) throw error;
    orders = data || [];
  } catch (err) {
    console.error("Orders fetch error", err);
    orders = [];
  }

  const normalizedOrders = (orders || []).map((order) => ({
    ...order,
    resolvedOrderType: String(order?.order_type || order?.type || "").toLowerCase(),
    resolvedGuideId: String(order?.guide_id ?? order?.id ?? ""),
    resolvedReturned:
      order?.returned === true ||
      String(order?.returned || "").toLowerCase() === "true" ||
      Number(order?.returned || 0) === 1,
  }));

  const reviewStatsByGuideId = new Map();
  const reviewDetailsByGuideId = new Map();

  const pushUniqueReview = (map, key, review) => {
    if (!key) return;

    const existing = map.get(key) || [];

    const reviewKey = [
      Number(review?.rating || 0),
      String(review?.comment || "").trim().toLowerCase(),
      String(review?.reviewedBy || "").trim().toLowerCase(),
    ].join("|");

    const alreadyExists = existing.some((r) =>
      [
        Number(r?.rating || 0),
        String(r?.comment || "").trim().toLowerCase(),
        String(r?.reviewedBy || "").trim().toLowerCase(),
      ].join("|") === reviewKey
    );

    if (!alreadyExists) {
      map.set(key, [...existing, review]);
    }
  };

  /* ✅ BUILD GLOBAL REVIEWS */
  normalizedOrders.forEach((order) => {
    const guideId = String(order?.resolvedGuideId || "");
    if (!guideId) return;

    let reviewObj = null;

    if (typeof order?.review === "object") {
      reviewObj = order.review;
    } else {
      try {
        reviewObj = order?.review ? JSON.parse(order.review) : null;
      } catch {
        reviewObj = null;
      }
    }

    const rating = Number(order?.review_rating ?? reviewObj?.rating ?? 0);
    const comment = String(
      order?.review_comment ?? reviewObj?.comment ?? ""
    ).trim();

    if (!Number.isFinite(rating) || rating <= 0) return;

    const reviewDetail = {
      rating,
      comment,
      reviewedBy:
        order?.rentedBy ||
        order?.buyer_name ||
        "Anonymous",
    };

    pushUniqueReview(reviewDetailsByGuideId, guideId, reviewDetail);

    const existing = reviewStatsByGuideId.get(guideId) || {
      sum: 0,
      count: 0,
    };

    existing.sum += rating;
    existing.count += 1;

    reviewStatsByGuideId.set(guideId, existing);
  });

  /* ✅ ONLY RENTED ITEMS SHOULD BE UNAVAILABLE */
  const purchasedGuideIds = new Set(
    normalizedOrders
      .filter((order) => order?.resolvedOrderType === "buy")
      .map((order) => String(order?.resolvedGuideId))
  );

  const localPurchasedGuideIds = getPurchasedGuideLockSet();
  localPurchasedGuideIds.forEach((guideId) => {
    purchasedGuideIds.add(String(guideId));
  });

  /* ✅ ONLY RENTED ITEMS SHOULD BE UNAVAILABLE */
  const unavailableGuideIds = new Set(
    normalizedOrders
      .filter(
        (order) =>
          order?.resolvedOrderType === "rent" &&
          order?.resolvedReturned !== true
      )
      .map((order) => String(order?.resolvedGuideId))
  );

  /* ✅ INCLUDE LOCAL LOCKS */
  const localUnavailableGuideIds = getRentedGuideLockSet();
  localUnavailableGuideIds.forEach((guideId) => {
    unavailableGuideIds.add(String(guideId));
  });

  const removedGuideIdSet = getRemovedGuideIdSet();

  /* ✅ NORMALIZE */
  const normalizeForBrowse = (guides) =>
    (guides || [])
      .map((guide) => {
        const normalized = normalizeGuideForUI(guide);

        const guideId = String(normalized?.id || "");

        const stats = reviewStatsByGuideId.get(guideId) || {
          sum: 0,
          count: 0,
        };

        const reviewDetails =
          reviewDetailsByGuideId.get(guideId) || [];

        const averageRating =
          stats.count > 0
            ? Number((stats.sum / stats.count).toFixed(1))
            : 0;

        return {
          ...normalized,
          rating: averageRating,
          reviews: stats.count,
          reviewDetails,
          currentlyUnavailable:
            unavailableGuideIds.has(guideId),
        };
      })
      .filter(
        (guide) =>
          !removedGuideIdSet.has(String(guide?.id || ""))
      )
      .filter(
        (guide) =>
          !purchasedGuideIds.has(String(guide?.id || ""))
      );

  /* ✅ FETCH FROM DB */
  try {
    const data = await fetchGuidesByStatus("Approved");
    const dbGuides = Array.isArray(data) ? data : [];

    const mergedDbGuides = Array.from(
      new Map(
        [...dbGuides].map((guide) => [
          String(guide?.id),
          guide,
        ])
      ).values()
    );

    if (mergedDbGuides.length === 0) {
      return normalizeForBrowse(seeds);
    }

    return normalizeForBrowse([
      ...mergedDbGuides,
      ...seeds,
    ]);
  } catch (err) {
    console.error("Guide fetch error", err);
    return normalizeForBrowse(seeds);
  }
}

/* ---------------- MY GUIDE LISTINGS (Seller) ---------------- */

export async function markGuideAsAvailable(guideId, sellerId = null) {
  return markGuideRentalsReturned(guideId, sellerId);
}

export async function markGuideAsReceivedBySeller(guideId, sellerId = null) {
  return markGuideRentalsReceivedBySeller(guideId, sellerId);
}

// ✅ fixed — no duplicate returns
export async function getMyGuideListings() {
  const seller = await getCurrentUserProfile();
  const { data: authData } = await supabase.auth.getUser();
  const authUser = authData?.user || null;
  const sellerId = seller?.id || authUser?.id || null;

  if (!sellerId) return [];

  const allOrders = await fetchOrdersBySeller(sellerId).catch(() => []);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const withOrderActivity = (guides) => {
    return guides.map((guide) => {
      const normalizedGuide = normalizeGuideForUI(guide);

      const relatedOrders = allOrders
        .filter((order) => String(order?.id) === String(normalizedGuide?.id))
        .map((order) => {
          const dueDate = order?.endDate || null;
          const due = dueDate ? new Date(dueDate) : null;
          if (due) due.setHours(0, 0, 0, 0);
          const isOverdue = Boolean(!order?.returned && due && due < today);

          return {
            orderId: order?.orderId,
            type: order?.type || "buy",
            isActiveRent: order?.type === "rent" && order?.returned !== true,
            sellerReceived: Boolean(order?.seller_received),
            buyerReturned: Boolean(order?.buyer_returned),
            buyerId: order?.buyer_id || order?.buyerId || null,
            buyerName: order?.rentedBy || "Unknown User",
            buyerEmail: order?.userEmail || "-",
            orderDate: order?.purchaseDate || "-",
            rentalPeriod: order?.type === "rent" ? order?.duration || "-" : null,
            returnDate: order?.type === "rent" ? order?.endDate || "-" : null,
            overdueDays: isOverdue
              ? Math.ceil((today - due) / (1000 * 60 * 60 * 24))
              : 0,
          };
        });

      return {
        ...normalizedGuide,
        currentlyUnavailable: relatedOrders.some((o) => o.isActiveRent),
        sellerReceived: relatedOrders.some((o) => o.type === "rent" && o.sellerReceived),
        buyerReturned: relatedOrders.some((o) => o.type === "rent" && o.buyerReturned),
        totalOrders: relatedOrders.length,
        rentalOrders: relatedOrders.filter((o) => o.type === "rent").length,
        purchaseOrders: relatedOrders.filter((o) => o.type === "buy").length,
        orderActivity: relatedOrders,
      };
    });
  };

  const local = getLocalGuides().filter(
    (g) => String(g.seller_id) === String(sellerId)
  );

  try {
    const { data, error } = await supabase
      .from("guides")
      .select("*")
      .eq("seller_id", sellerId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const myGuides = (data || []).filter(
      (g) => String(g.seller_id) === String(sellerId)
    );

    return withOrderActivity(myGuides.length > 0 ? myGuides : local);
  } catch {
    return withOrderActivity(local);
  }
}

/* ---------------- ADMIN RENTAL MONITORING ---------------- */

export async function getAdminMonitoringRentals() {
  const orders = await fetchAllOrders().catch(() => []);
  const rentedOrders = (orders || []).filter((order) => order?.type === "rent");
  const dedupedRentedOrders = Array.from(
    new Map(
      rentedOrders.map((order, index) => {
        const key =
          String(order?.orderId || "").trim() ||
          [
            String(order?.id || ""),
            String(order?.userEmail || ""),
            String(order?.sellerId || ""),
            String(order?.endDate || ""),
            String(index),
          ].join("|");
        return [key, order];
      })
    ).values()
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return dedupedRentedOrders.map((order, index) => {
    const due = order.endDate ? new Date(order.endDate) : null;
    if (due) due.setHours(0, 0, 0, 0);

    const isReturned = order?.returned === true;
    const sellerStatus = order?.seller_received ? "Received" : "Pending";
    const buyerStatus = order?.buyer_returned ? "Returned" : "Pending";
    const status = isReturned
      ? "Returned"
      : due && due < today
      ? "Overdue"
      : "Active";

    return {
      id: order.orderId || `${order.id || "guide"}-${index}`,
      guideId: order.guide_id || order.id || null,
      orderId: order.orderId || "-",
      orderDate: order.purchaseDate || order.created_at || "-",
      duration: order.duration || "-",
      amount: Number(order.amount || 0),
      depositValue: Number(order.deposit || 0),
      guide: order.title || "Guide",
      buyerId: order.buyer_id || null,
      rentedBy: order.rentedBy || order.userName || "Unknown User",
      email: order.userEmail || "-",
      dueDate: order.endDate || "-",
      deposit: order.deposit ? `₹${order.deposit}` : "-",
      returnedAt: order.returned_at || "-",
      sellerId: order.sellerId || order.seller_id || null,
      sellerName: order.sellerName || "-",
      sellerStatus,
      buyerStatus,
      status,
    };
  });
}

/* ---------------- ADMIN MODERATION ---------------- */

export async function getPendingGuides() {
  return fetchGuidesByStatus("Pending");
}

export async function getAcceptedGuides() {
  return fetchGuidesByStatus("Approved");
}

export async function getRejectedGuides() {
  return fetchGuidesByStatus("Denied");
}

export async function approveGuide(id, marketPrice) {
  if (marketPrice !== undefined && marketPrice !== null) {
    await updateGuideMarketPrice(id, Number(marketPrice));
  }
  await updateGuideStatus(id, "Approved");
  window.dispatchEvent(new Event("reguide-guides-updated"));
}

export async function denyGuide(id) {
  await updateGuideStatus(id, "Denied");
  window.dispatchEvent(new Event("reguide-guides-updated"));
}