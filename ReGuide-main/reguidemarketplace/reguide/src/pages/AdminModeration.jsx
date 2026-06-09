import React, { useEffect, useState } from "react";
import {
  getPendingGuides,
  getAcceptedGuides,
  getRejectedGuides,
  approveGuide,
  denyGuide,
} from "../services/guideService";
import {
  createNotification,
  createNotificationForAdmins,
  getNotificationsForCurrentUser,
} from "../services/notificationService";
import { fetchGuideReviews, getAllOrdersForAdmin } from "../services/orderService";
import {
  getGuideAdminStateMap,
  incrementGuideFlagCount,
} from "../services/adminGuideService";
import { supabase } from "../supabaseClient";
import "./AdminModeration.css";

function toGuideId(value) {
  if (value == null) return "";
  return String(value);
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

async function resolveGuideSellerRecipient(guide) {
  const sellerId = guide?.seller_id || guide?.sellerId || null;
  const existingEmail = String(
    guide?.seller_email || guide?.sellerEmail || guide?.sellerEmailAddress || ""
  )
    .trim()
    .toLowerCase();

  if (existingEmail) {
    return { recipientId: sellerId, recipientEmail: existingEmail };
  }

  if (sellerId) {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("email")
        .eq("id", sellerId)
        .maybeSingle();

      if (!error) {
        const email = String(data?.email || "").trim().toLowerCase();
        if (email) {
          return { recipientId: sellerId, recipientEmail: email };
        }
      }
    } catch {
      // Ignore lookup errors and continue with best-effort payload.
    }
  }

  return { recipientId: sellerId || null, recipientEmail: "" };
}

function doesOrderMatchGuide(order, guide) {
  const orderGuideId = toGuideId(order?.id);
  const guideId = toGuideId(guide?.id);

  if (orderGuideId && guideId && orderGuideId === guideId) {
    return true;
  }

  const orderTitle = normalizeText(order?.title);
  const guideTitle = normalizeText(guide?.title);
  if (!orderTitle || !guideTitle || orderTitle !== guideTitle) {
    return false;
  }

  const orderSellerId = toGuideId(order?.sellerId);
  const guideSellerId = toGuideId(guide?.seller_id || guide?.sellerId);
  if (orderSellerId && guideSellerId) {
    return orderSellerId === guideSellerId;
  }

  const orderSellerName = normalizeText(order?.seller || order?.sellerName);
  const guideSellerName = normalizeText(guide?.seller || guide?.seller_name);
  if (orderSellerName && guideSellerName) {
    return orderSellerName === guideSellerName;
  }

  return true;
}

function toReviewPayload(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function AdminModeration() {
  const [pendingGuides, setPendingGuides] = useState([]);
  const [acceptedGuides, setAcceptedGuides] = useState([]);
  const [rejectedGuides, setRejectedGuides] = useState([]);
  const [marketPrices, setMarketPrices] = useState({});
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState("");
  const [activeTab, setActiveTab] = useState("pending");
  const [allOrders, setAllOrders] = useState([]);
  const [selectedAcceptedGuide, setSelectedAcceptedGuide] = useState(null);
  const [selectedGuideInsights, setSelectedGuideInsights] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [guideAdminState, setGuideAdminState] = useState({});
  const [lastOrdersLoadedAt, setLastOrdersLoadedAt] = useState(0);

  useEffect(() => {
    if (!selectedAcceptedGuide) return undefined;

    const handleEsc = (event) => {
      if (event.key === "Escape") {
        setSelectedAcceptedGuide(null);
        setSelectedGuideInsights(null);
      }
    };

    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [selectedAcceptedGuide]);

  useEffect(() => {
    let isMounted = true;

    async function loadModerationGuides() {
      setLoading(true);
      setActionError("");
      try {
        const [pending, accepted, rejected] = await Promise.all([
          getPendingGuides(),
          getAcceptedGuides(),
          getRejectedGuides(),
        ]);

        if (!isMounted) return;

        setPendingGuides(pending || []);
        setAcceptedGuides(accepted || []);
        setRejectedGuides(rejected || []);
        setGuideAdminState(getGuideAdminStateMap());
        setMarketPrices(
          (pending || []).reduce((acc, guide) => {
            acc[guide.id] = guide.market_price ?? "";
            return acc;
          }, {})
        );
      } catch {
        if (isMounted) {
          setActionError("Failed to load moderation data from Supabase.");
          setPendingGuides([]);
          setAcceptedGuides([]);
          setRejectedGuides([]);
          setAllOrders([]);
          setGuideAdminState(getGuideAdminStateMap());
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadModerationGuides();

    const handleRefresh = () => loadModerationGuides();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") loadModerationGuides();
    };

    window.addEventListener("reguide-guides-updated", handleRefresh);
    window.addEventListener("reguide-orders-updated", handleRefresh);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted = false;
      window.removeEventListener("reguide-guides-updated", handleRefresh);
      window.removeEventListener("reguide-orders-updated", handleRefresh);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const handlePriceChange = (id, value) => {
    setMarketPrices((prev) => ({ ...prev, [id]: value }));
  };

  const handleApprove = async (id) => {
    const targetId = String(id);
    const enteredPrice = Number(marketPrices[id]);
    if (!Number.isFinite(enteredPrice) || enteredPrice <= 0) {
      setActionError("Please enter a valid market price before approving.");
      return;
    }
    try {
      setActionError("");
      const approvedGuide = pendingGuides.find((g) => String(g?.id) === targetId);
      await approveGuide(id, enteredPrice);

      if (approvedGuide) {
        const { recipientId, recipientEmail } = await resolveGuideSellerRecipient(approvedGuide);
        createNotification({
          recipientId,
          recipientEmail,
          actorName: "Admin",
          type: "guide_approved",
          title: "Guide approved",
          message: `${approvedGuide?.title || "Your guide"} was approved by admin and is now visible to buyers.`,
          link: "/guide-listings",
          metadata: {
            guideId: approvedGuide?.id || null,
            action: "guide_approved",
          },
        }).catch(() => {});
      }

      setPendingGuides((prev) => {
        const guide = prev.find((g) => String(g?.id) === targetId);
        if (guide) {
          setAcceptedGuides((acceptedPrev) => [
            { ...guide, market_price: enteredPrice, status: "Approved" },
            ...acceptedPrev,
          ]);
        }
        return prev.filter((g) => String(g?.id) !== targetId);
      });
    } catch {
      setActionError("Failed to approve guide. Please try again.");
    }
  };

  const handleDeny = async (id) => {
    const targetId = String(id);
    try {
      const deniedGuide = pendingGuides.find((g) => String(g?.id) === targetId);
      await denyGuide(id);

      if (deniedGuide) {
        const { recipientId, recipientEmail } = await resolveGuideSellerRecipient(deniedGuide);
        createNotification({
          recipientId,
          recipientEmail,
          actorName: "Admin",
          type: "guide_denied",
          title: "Guide denied",
          message: `${deniedGuide?.title || "Your guide"} was denied by admin. Please review and resubmit your listing.`,
          link: "/guide-listings",
          metadata: {
            guideId: deniedGuide?.id || null,
            action: "guide_denied",
          },
        }).catch(() => {});
      }

      setPendingGuides((prev) => {
        const guide = prev.find((g) => String(g?.id) === targetId);
        if (guide) {
          setRejectedGuides((rejectedPrev) => [
            { ...guide, status: "Denied" },
            ...rejectedPrev,
          ]);
        }
        return prev.filter((g) => String(g?.id) !== targetId);
      });
    } catch {
      setActionError("Failed to deny guide. Please try again.");
    }
  };

  const handleSelectAcceptedGuide = async (guide) => {
    setSelectedAcceptedGuide(guide);
    setDetailsLoading(true);

    try {
      let latestOrders = allOrders;
      if (!Array.isArray(latestOrders) || latestOrders.length === 0 || Date.now() - lastOrdersLoadedAt > 30000) {
        latestOrders = await getAllOrdersForAdmin();
        setAllOrders(latestOrders || []);
        setLastOrdersLoadedAt(Date.now());
      }

      const selectedGuideId = toGuideId(guide?.id);
      const guideOrders = (latestOrders || allOrders || []).filter((order) =>
        doesOrderMatchGuide(order, guide)
      );

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const rentalOrders = guideOrders.filter((order) => order?.type === "rent");
      const purchaseOrders = guideOrders.filter((order) => order?.type === "buy");

      const activeRentals = rentalOrders.filter((order) => !order?.returned).length;
      const returnedRentals = rentalOrders.filter((order) => Boolean(order?.returned)).length;
      const overdueRentals = rentalOrders.filter((order) => {
        if (order?.returned || !order?.endDate) return false;
        const due = new Date(order.endDate);
        due.setHours(0, 0, 0, 0);
        return due < today;
      }).length;

      const embeddedReviews = guideOrders
        .map((order) => ({
          rating: Number(toReviewPayload(order?.review)?.rating) || 0,
          comment: String(toReviewPayload(order?.review)?.comment || "").trim(),
          rentedBy: order?.rentedBy || "Anonymous",
        }))
        .filter((review) => review.rating > 0 || review.comment);

      let fetchedReviews = [];
      try {
        fetchedReviews = await fetchGuideReviews(guide?.id);
      } catch {
        fetchedReviews = [];
      }

      const normalizedFetchedReviews = (fetchedReviews || [])
        .map((review) => ({
          rating: Number(review?.rating) || 0,
          comment: String(review?.comment || "").trim(),
          rentedBy: review?.rentedBy || "Anonymous",
        }))
        .filter((review) => review.rating > 0 || review.comment);

      const mergedReviews = normalizedFetchedReviews.length > 0
        ? normalizedFetchedReviews
        : embeddedReviews;

      const reviewCount = mergedReviews.length;
      const averageRating = reviewCount > 0
        ? (mergedReviews.reduce((sum, review) => sum + (Number(review.rating) || 0), 0) / reviewCount).toFixed(1)
        : "0.0";
      const recentReviewComments = mergedReviews
        .filter((review) => review.comment)
        .slice(0, 3);

      let notifications = [];
      try {
        notifications = await getNotificationsForCurrentUser();
      } catch {
        notifications = [];
      }

      const paymentSuccessNotifications = (notifications || []).filter((item) =>
        item?.type === "payment_success" && toGuideId(item?.metadata?.guideId) === selectedGuideId
      );
      const paymentFailedNotifications = (notifications || []).filter((item) =>
        item?.type === "payment_failed" && toGuideId(item?.metadata?.guideId) === selectedGuideId
      );

      const paymentSuccessCount = Math.max(paymentSuccessNotifications.length, guideOrders.length);
      const paymentFailedCount = paymentFailedNotifications.length;

      const latestPaymentEvent = [...paymentSuccessNotifications, ...paymentFailedNotifications]
        .sort((a, b) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime())[0];

      setSelectedGuideInsights({
        totalOrders: guideOrders.length,
        purchaseOrders: purchaseOrders.length,
        rentalOrders: rentalOrders.length,
        activeRentals,
        overdueRentals,
        returnedRentals,
        paymentSuccessCount,
        paymentFailedCount,
        lastPaymentStatus: latestPaymentEvent
          ? (latestPaymentEvent.type === "payment_failed" ? "Failed" : "Success")
          : (guideOrders.length > 0 ? "Success" : "No payments"),
        lastPaymentTime: latestPaymentEvent?.created_at || guideOrders[0]?.purchaseDate || guideOrders[0]?.date || null,
        reviewCount,
        averageRating,
        recentReviewComments,
      });
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleCloseDetails = () => {
    setSelectedAcceptedGuide(null);
    setSelectedGuideInsights(null);
  };

  const handleFlagGuide = async (guide) => {
    const currentCount = Number(guideAdminState?.[String(guide?.id)]?.flagCount || 0);
    if (currentCount >= 4) return;

    const { flagCount, removedFromBrowse } = await incrementGuideFlagCount(guide?.id);
    const { recipientId, recipientEmail } = await resolveGuideSellerRecipient(guide);

    createNotification({
      recipientId,
      recipientEmail,
      actorName: "Admin",
      type: "guide_flagged",
      title: `Guide flagged (${flagCount}/4)`,
      message: "If guide flagged more than 3 times, it is removed from browse guides.",
      link: "/guide-listings",
      metadata: {
        guideId: guide?.id || null,
        guideTitle: guide?.title || "",
        flagCount,
        action: "flagged",
      },
    }).catch(() => {});

    createNotificationForAdmins({
      actorName: "Admin",
      type: "guide_flagged",
      title: `Guide flagged (${flagCount}/4)`,
      message: `${guide?.title || "A guide"} was flagged by moderation.`,
      link: "/admin-moderation",
      metadata: {
        guideId: guide?.id || null,
        guideTitle: guide?.title || "",
        flagCount,
        action: "flagged",
      },
    }).catch(() => {});

    if (removedFromBrowse) {
      createNotification({
        recipientId,
        recipientEmail,
        actorName: "Admin",
        type: "guide_removed",
        title: "Guide removed from browse",
        message: `${guide?.title || "Your guide"} was flagged more than three times and has been removed from the browse page.`,
        link: "/guide-listings",
        metadata: {
          guideId: guide?.id || null,
          guideTitle: guide?.title || "",
          flagCount,
          action: "removed_after_flags",
        },
      }).catch(() => {});

      createNotificationForAdmins({
        actorName: "Admin",
        type: "guide_removed",
        title: "Guide removed from browse",
        message: `${guide?.title || "A guide"} was removed after repeated flags.`,
        link: "/admin-moderation",
        metadata: {
          guideId: guide?.id || null,
          guideTitle: guide?.title || "",
          flagCount,
          action: "removed_after_flags",
        },
      }).catch(() => {});
    }

    setGuideAdminState((prev) => ({
      ...prev,
      [String(guide?.id)]: {
        ...(prev?.[String(guide?.id)] || {}),
        flagged: flagCount > 0,
        flagCount,
        removedFromBrowse,
        updatedAt: new Date().toISOString(),
      },
    }));
  };

  const isPendingTab = activeTab === "pending";
  const flaggedGuides = acceptedGuides.filter(
    (guide) => Number(guideAdminState?.[String(guide?.id)]?.flagCount || 0) > 0
  );
  const guidesToShow =
    activeTab === "accepted"
      ? acceptedGuides
      : activeTab === "flagged"
      ? flaggedGuides
      : activeTab === "rejected"
      ? rejectedGuides
      : pendingGuides;

  const emptyMessage =
    activeTab === "accepted"
      ? "No accepted guides yet."
      : activeTab === "flagged"
      ? "No flagged guides yet."
      : activeTab === "rejected"
      ? "No rejected guides yet."
      : "No guides pending review.";

  return (
    <div className="moderation-container">
      <div className="moderation-header">
        <h1>Guide Moderation</h1>
        <p>Review and moderate guide listings for relevance and compliance.</p>
      </div>

      <div className="moderation-tabs">
        <button
          type="button"
          className={`moderation-tab ${activeTab === "pending" ? "active" : ""}`}
          onClick={() => setActiveTab("pending")}
        >
          Pending ({pendingGuides.length})
        </button>
        <button
          type="button"
          className={`moderation-tab ${activeTab === "accepted" ? "active" : ""}`}
          onClick={() => setActiveTab("accepted")}
        >
          Accepted ({acceptedGuides.length})
        </button>
        <button
          type="button"
          className={`moderation-tab ${activeTab === "flagged" ? "active" : ""}`}
          onClick={() => setActiveTab("flagged")}
        >
          Flagged ({flaggedGuides.length})
        </button>
        <button
          type="button"
          className={`moderation-tab ${activeTab === "rejected" ? "active" : ""}`}
          onClick={() => setActiveTab("rejected")}
        >
          Rejected ({rejectedGuides.length})
        </button>
      </div>

      {actionError && <p className="moderation-error">{actionError}</p>}

      <div className="moderation-content-shell">
        {loading ? (
          <div className="moderation-empty-state">
            <p className="no-pending">Loading moderation guides...</p>
          </div>
        ) : (
          <div className="moderation-table-wrap">
            <table className="moderation-table">
            <thead>
              <tr>
                <th>Guide Name</th>
                <th>Edition Year</th>
                <th>Exam Type</th>
                <th>Listed Price</th>
                <th>Market Price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {guidesToShow.length === 0 ? (
                <tr className="moderation-no-data-row">
                  <td colSpan="6">{emptyMessage}</td>
                </tr>
              ) : (
                guidesToShow.map((guide) => (
                  <tr key={guide.id}>
                    <td>{guide.title}</td>
                    <td>{guide.year || "—"}</td>
                    <td>{guide.subject || "—"}</td>
                    <td>
                      {guide.rental_price ? `₹${guide.rental_price}/mo` : ""}
                      {guide.rental_price && guide.purchase_price ? " / " : ""}
                      {guide.purchase_price ? `₹${guide.purchase_price} buy` : ""}
                      {!guide.rental_price && !guide.purchase_price ? "—" : ""}
                    </td>
                    <td>
                      {isPendingTab ? (
                        <input
                          type="number"
                          min="1"
                          className="actual-price-input"
                          value={marketPrices[guide.id] ?? ""}
                          onChange={(e) => handlePriceChange(guide.id, e.target.value)}
                          placeholder="Set market price"
                        />
                      ) : guide.market_price ? (
                        `₹${guide.market_price}`
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="status-cell">
                      {isPendingTab ? (
                        <>
                          <span className="status-pending">Pending</span>
                          <div className="status-actions">
                            <button className="approve" onClick={() => handleApprove(guide.id)}>
                              Approve
                            </button>
                            <button className="deny" onClick={() => handleDeny(guide.id)}>
                              Deny
                            </button>
                          </div>
                        </>
                      ) : activeTab === "accepted" || activeTab === "flagged" ? (
                        <>
                          <div className="guide-admin-badges">
                            {Number(guideAdminState?.[String(guide.id)]?.flagCount || 0) > 0 ? (
                              <span className="status-denied">Flags: {Number(guideAdminState?.[String(guide.id)]?.flagCount || 0)}</span>
                            ) : null}
                            {guideAdminState?.[String(guide.id)]?.removedFromBrowse ? (
                              <span className="status-denied">Removed from browse</span>
                            ) : null}
                            {guideAdminState?.[String(guide.id)]?.suspended ? (
                              <span className="status-pending">Suspended</span>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            className="view-details"
                            onClick={() => handleSelectAcceptedGuide(guide)}
                          >
                            View details
                          </button>
                          <button
                            type="button"
                            className="view-details"
                            onClick={() => handleFlagGuide(guide)}
                            disabled={Number(guideAdminState?.[String(guide.id)]?.flagCount || 0) >= 4}
                          >
                            {Number(guideAdminState?.[String(guide.id)]?.flagCount || 0) >= 4 ? "Flag limit reached" : `Flag (${Number(guideAdminState?.[String(guide.id)]?.flagCount || 0)}/4)`}
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="status-denied">Rejected</span>
                          <div className="guide-admin-badges">
                            {Number(guideAdminState?.[String(guide.id)]?.flagCount || 0) > 0 ? (
                              <span className="status-denied">Flags: {Number(guideAdminState?.[String(guide.id)]?.flagCount || 0)}</span>
                            ) : null}
                            {guideAdminState?.[String(guide.id)]?.removedFromBrowse ? (
                              <span className="status-denied">Removed from browse</span>
                            ) : null}
                            {guideAdminState?.[String(guide.id)]?.suspended ? (
                              <span className="status-pending">Suspended</span>
                            ) : null}
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {activeTab === "accepted" && selectedAcceptedGuide ? (
        <div className="accepted-details-modal-backdrop" onClick={handleCloseDetails}>
          <div className="accepted-details-modal" onClick={(event) => event.stopPropagation()}>
            <div className="accepted-details-header">
              <div>
                <h2>{selectedAcceptedGuide.title}</h2>
                <p className="accepted-details-subtitle">Structured insights for accepted guide</p>
              </div>
              <div className="accepted-details-header-actions">
                <span className="status-approved">Accepted guide insights</span>
                <button type="button" className="details-close" onClick={handleCloseDetails}>
                  Close
                </button>
              </div>
            </div>

            {detailsLoading || !selectedGuideInsights ? (
              <p>Loading guide insights...</p>
            ) : (
              <>
                <div className="accepted-details-grid">
                  <div className="accepted-details-card">
                    <h3>Payments</h3>
                    <p>Successful: {selectedGuideInsights.paymentSuccessCount}</p>
                    <p>Failed: {selectedGuideInsights.paymentFailedCount}</p>
                    <p>Last status: {selectedGuideInsights.lastPaymentStatus}</p>
                  </div>
                  <div className="accepted-details-card">
                    <h3>Reviews</h3>
                    <p>Average rating: {selectedGuideInsights.averageRating}</p>
                    <p>Total reviews: {selectedGuideInsights.reviewCount}</p>
                  </div>
                  <div className="accepted-details-card">
                    <h3>Rental health</h3>
                    <p>Active: {selectedGuideInsights.activeRentals}</p>
                    <p>Overdue: {selectedGuideInsights.overdueRentals}</p>
                    <p>Returned: {selectedGuideInsights.returnedRentals}</p>
                  </div>
                  <div className="accepted-details-card">
                    <h3>Orders</h3>
                    <p>Total orders: {selectedGuideInsights.totalOrders}</p>
                    <p>Purchase orders: {selectedGuideInsights.purchaseOrders}</p>
                    <p>Rental orders: {selectedGuideInsights.rentalOrders}</p>
                  </div>
                </div>

                <div className="accepted-review-comments">
                  <h3>Recent review comments</h3>
                  {selectedGuideInsights.recentReviewComments.length === 0 ? (
                    <p>No review comments available.</p>
                  ) : (
                    <ul>
                      {selectedGuideInsights.recentReviewComments.map((review, index) => (
                        <li key={`${review.rentedBy}-${index}`}>
                          <strong>{review.rentedBy}</strong>: {review.comment}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default AdminModeration;