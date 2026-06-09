import { Package, CheckCircle, Calendar, Clock, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { jsPDF } from "jspdf";
import { supabase } from "../supabaseClient";
import { fetchMyOrders, markOrderAsReturnedByBuyer, updateOrderReview } from "../services/orderService";
import { createNotification, createNotificationForAdmins } from "../services/notificationService";
import { getCurrentUserId } from "../services/userService";
import "./Myorders.css";

const REVIEW_IMAGES_BUCKET = "guide-images";
const MAX_REVIEW_IMAGES = 4;
const MAX_REVIEW_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function formatInr(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

function sanitizeFileName(name = "review-image") {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function resolveSellerRecipient(order) {
  let sellerId = order?.sellerId || order?.seller_id || null;
  let sellerEmail = normalizeEmail(order?.sellerEmail || order?.seller_email || "");
  const orderKey = String(order?.orderId || order?.order_key || order?.id || "").trim();

  if (!sellerId && orderKey) {
    const byOrderKey = await supabase
      .from("orders")
      .select("seller_id")
      .eq("order_key", orderKey)
      .limit(1)
      .maybeSingle();

    if (!byOrderKey.error && byOrderKey.data?.seller_id) {
      sellerId = byOrderKey.data.seller_id;
    } else {
      const byId = await supabase
        .from("orders")
        .select("seller_id")
        .eq("id", orderKey)
        .limit(1)
        .maybeSingle();

      if (!byId.error && byId.data?.seller_id) {
        sellerId = byId.data.seller_id;
      }
    }
  }

  if (!sellerEmail && sellerId) {
    const profile = await supabase
      .from("profiles")
      .select("email")
      .eq("id", sellerId)
      .maybeSingle();

    if (!profile.error) {
      sellerEmail = normalizeEmail(profile.data?.email);
    }
  }

  return {
    sellerId: sellerId || null,
    sellerEmail,
  };
}

function Myorders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState("all");
  const [reviewOpen, setReviewOpen] = useState({});
  const [reviewData, setReviewData] = useState({});
  const [submittingReview, setSubmittingReview] = useState({});
  const [returningOrderId, setReturningOrderId] = useState(null);
  const [returnedOrderState, setReturnedOrderState] = useState({});
  const [downloadingBillByOrder, setDownloadingBillByOrder] = useState({});
  const location = useLocation();
  const navigate = useNavigate();
  const success = location.state?.success;

  useEffect(() => {
    async function loadOrders() {
      setLoading(true);
      try {
        const data = await fetchMyOrders();
        setOrders(data || []);
      } catch (error) {
        console.error("Error loading orders:", error);
        setOrders([]);
      } finally {
        setLoading(false);
      }
    }
    loadOrders();
  }, []);

  const clearReviewDraft = (orderId) => {
    setReviewData((prev) => {
      const draft = prev?.[orderId];
      (draft?.images || []).forEach((image) => {
        if (image?.previewUrl) {
          URL.revokeObjectURL(image.previewUrl);
        }
      });

      const next = { ...prev };
      delete next[orderId];
      return next;
    });
  };

  const uploadReviewImages = async (orderId, images, reviewedById) => {
    const files = Array.isArray(images) ? images : [];
    if (files.length === 0) return [];

    const uploadedUrls = [];

    for (let index = 0; index < files.length; index += 1) {
      const image = files[index];
      const file = image?.file;
      if (!file) continue;

      const safeOrderKey = String(orderId || "unknown-order").replace(/[^a-zA-Z0-9_-]/g, "_");
      const safeName = sanitizeFileName(file.name || `review-${index + 1}.jpg`);
      const path = `reviews/${reviewedById || "anonymous"}/${safeOrderKey}/${Date.now()}-${index}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from(REVIEW_IMAGES_BUCKET)
        .upload(path, file, { upsert: false, cacheControl: "3600" });

      if (uploadError) {
        throw new Error(uploadError.message || "Failed to upload a review image.");
      }

      const { data: publicUrlData } = supabase.storage
        .from(REVIEW_IMAGES_BUCKET)
        .getPublicUrl(path);

      if (publicUrlData?.publicUrl) {
        uploadedUrls.push(publicUrlData.publicUrl);
      }
    }

    return uploadedUrls;
  };

  const calculateDaysRemaining = (endDate) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);
    return Math.ceil((end - today) / (1000 * 60 * 60 * 24));
  };

  const handleViewDetails = (order) => {
    const orderType = order.type || order.order_type || "buy";
    const durationMonths = Math.max(
      Number(order.duration || order.duration_months || 1),
      1
    );
    const totalAmount = Number(order.amount || 0);
    const depositAmount = Number(order.deposit || 0);
    const derivedRentPrice =
      orderType === "rent"
        ? Number((totalAmount / durationMonths).toFixed(2))
        : Number(order.rentPrice || order.rentalPrice || 0);
    const derivedBuyPrice =
      orderType === "buy"
        ? totalAmount
        : Number(order.buyPrice || depositAmount || 0);

    const resolvedGuideId = order.guide_id || order.id || Math.random();

    navigate(`/guide/${resolvedGuideId}`, {
      state: {
        guide: {
          id: resolvedGuideId,
          title: order.title,
          examType: order.subject || "General",
          author: order.seller || order.sellerName || "Unknown",
          edition: order.edition || "Not specified",
          condition: order.condition || "Not specified",
          totalPages: order.totalPages || order.pages || 0,
          photoUrl: order.photoUrl || order.photo_url || null,
          seller_id: order.sellerId || order.seller_id || null,
          seller: order.sellerName || order.seller || "Unknown Seller",
          review: order.review || null,
          rentedBy: order.rentedBy || order.buyer_name || "Anonymous",
          pricingType: orderType === "rent" ? "renting only" : "purchase only",
          description: order.description || "",
          pricing: {
            rent: {
              price: derivedRentPrice,
              deposit: depositAmount,
              total: totalAmount + depositAmount,
              period: "per month",
            },
            buy: { price: derivedBuyPrice },
          },
        }
      }
    });
  };

  const filteredOrders = filterType === "all"
    ? orders
    : orders.filter(order => (order.type || order.order_type) === filterType);

  const toggleReview = (orderId) => {
    setReviewOpen((prev) => {
      const willOpen = !prev[orderId];
      if (!willOpen) {
        clearReviewDraft(orderId);
      }
      return { ...prev, [orderId]: willOpen };
    });
  };

  const handleReviewChange = (orderId, field, value) => {
    setReviewData(prev => ({
      ...prev,
      [orderId]: { ...prev[orderId], [field]: value },
    }));
  };

  const handleReviewImagesChange = (orderId, fileList) => {
    const selectedFiles = Array.from(fileList || []);
    if (selectedFiles.length === 0) return;

    const nonImages = selectedFiles.filter((file) => !String(file?.type || "").startsWith("image/"));
    if (nonImages.length > 0) {
      alert("Only image files are allowed for review photos.");
      return;
    }

    const oversized = selectedFiles.find((file) => Number(file?.size || 0) > MAX_REVIEW_IMAGE_SIZE_BYTES);
    if (oversized) {
      alert("Each review image must be 5MB or smaller.");
      return;
    }

    setReviewData((prev) => {
      const existingImages = prev?.[orderId]?.images || [];
      const remainingSlots = Math.max(MAX_REVIEW_IMAGES - existingImages.length, 0);

      if (remainingSlots <= 0) {
        alert(`You can upload up to ${MAX_REVIEW_IMAGES} review photos.`);
        return prev;
      }

      const filesToAdd = selectedFiles.slice(0, remainingSlots);
      if (selectedFiles.length > remainingSlots) {
        alert(`Only ${MAX_REVIEW_IMAGES} photos are allowed per review.`);
      }

      const mapped = filesToAdd.map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
        name: file.name,
      }));

      return {
        ...prev,
        [orderId]: {
          ...prev[orderId],
          images: [...existingImages, ...mapped],
        },
      };
    });
  };

  const removeReviewImage = (orderId, imageIndex) => {
    setReviewData((prev) => {
      const existingImages = prev?.[orderId]?.images || [];
      const target = existingImages[imageIndex];
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }

      const nextImages = existingImages.filter((_, idx) => idx !== imageIndex);
      return {
        ...prev,
        [orderId]: {
          ...prev[orderId],
          images: nextImages,
        },
      };
    });
  };

  const submitReview = async (orderId) => {
    const review = reviewData[orderId];
    if (!review?.rating || !review?.comment?.trim()) {
      alert("Please provide a rating and a comment.");
      return;
    }

    const reviewedById = await getCurrentUserId();

    setSubmittingReview(prev => ({ ...prev, [orderId]: true }));

    try {
      const uploadedPhotoUrls = await uploadReviewImages(orderId, review?.images || [], reviewedById);

      const payload = {
        rating: review.rating,
        comment: review.comment.trim(),
        photos: uploadedPhotoUrls,
      };

      // ✅ save review to Supabase orders table
      await updateOrderReview(orderId, payload, reviewedById);

      // ✅ update local state so UI reflects "Reviewed"
      setOrders(prev =>
        prev.map(o =>
          (o.orderId === orderId || o.order_key === orderId)
            ? { ...o, review: payload }
            : o
        )
      );
      setReviewOpen(prev => ({ ...prev, [orderId]: false }));
      clearReviewDraft(orderId);

    } catch (err) {
      console.error("Review submission error:", err);
      alert("Failed to submit review. Please try again.");
    } finally {
      setSubmittingReview(prev => ({ ...prev, [orderId]: false }));
    }
  };

  const handleGuideReturned = async (order) => {
    const orderId = order.orderId || order.order_key || order.id;
    if (!orderId || returningOrderId === orderId) return;

    setReturningOrderId(orderId);
    try {
      await markOrderAsReturnedByBuyer(orderId);

      setOrders((prev) =>
        prev.map((item) => {
          const itemOrderId = item.orderId || item.order_key || item.id;
          if (String(itemOrderId) !== String(orderId)) return item;
          const today = new Date().toISOString().split("T")[0];
          return { ...item, returned: true, returned_at: today, returnedAt: today };
        })
      );

      setReturnedOrderState((prev) => ({ ...prev, [orderId]: true }));

      const { sellerId, sellerEmail } = await resolveSellerRecipient(order);

      await createNotification({
        recipientId: sellerId,
        recipientEmail: sellerEmail,
        actorName: "Buyer",
        type: "guide_returned",
        title: "Guide returned by buyer",
        message: "The buyer has returned the guide. If not, contact admin through customer support.",
        link: "/guide-listings",
        metadata: {
          orderId,
          guideId: order?.id || null,
          action: "guide_returned",
        },
      }).catch((err) => {
        console.warn("Failed to notify seller about guide return:", err?.message || err);
      });

      await createNotificationForAdmins({
        actorName: "Buyer",
        type: "guide_returned",
        title: "Guide returned by buyer",
        message: `Buyer returned ${order?.title || "a rented guide"}.`,
        link: "/admin-monitoring",
        metadata: {
          orderId,
          guideId: order?.id || null,
          sellerId,
          action: "guide_returned",
        },
      }).catch((err) => {
        console.warn("Failed to notify admins about guide return:", err?.message || err);
      });
    } catch (error) {
      alert(error?.message || "Failed to mark guide as returned.");
    } finally {
      setReturningOrderId(null);
    }
  };

  const downloadBillPdf = async (order) => {
    const orderId = String(order?.orderId || order?.order_key || order?.id || "").trim();
    if (!orderId) {
      alert("Order ID not found for this bill.");
      return;
    }

    setDownloadingBillByOrder((prev) => ({ ...prev, [orderId]: true }));

    try {
      const doc = new jsPDF();
      const orderType = String(order?.type || order?.order_type || "buy").toLowerCase();
      const isRental = orderType === "rent";
      const issueDate = formatDate(new Date().toISOString());
      const billNo = `BILL-${orderId.slice(0, 10).toUpperCase()}`;

      const guideTitle = order?.title || order?.guide_title || "Guide";
      const sellerName = order?.sellerName || order?.seller_name || order?.seller || "Unknown Seller";
      const buyerName = order?.rentedBy || order?.buyer_name || "Buyer";
      const buyerEmail = order?.userEmail || order?.buyer_email || "";
      const purchaseDate = formatDate(order?.purchaseDate || order?.purchase_date || order?.created_at);
      const rentalEnd = formatDate(order?.endDate || order?.end_date);

      const totalAmount = Number(order?.amount || 0);
      const deposit = Number(order?.deposit || 0);

      let y = 20;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text("ReGuide Marketplace", 14, y);
      y += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.text("Order Bill / Invoice", 14, y);
      y += 10;

      doc.setLineWidth(0.4);
      doc.line(14, y, 196, y);
      y += 8;

      doc.setFont("helvetica", "bold");
      doc.text("Bill No:", 14, y);
      doc.setFont("helvetica", "normal");
      doc.text(billNo, 38, y);
      doc.setFont("helvetica", "bold");
      doc.text("Issue Date:", 125, y);
      doc.setFont("helvetica", "normal");
      doc.text(issueDate, 155, y);
      y += 8;

      doc.setFont("helvetica", "bold");
      doc.text("Order ID:", 14, y);
      doc.setFont("helvetica", "normal");
      doc.text(orderId, 38, y);
      doc.setFont("helvetica", "bold");
      doc.text("Order Type:", 125, y);
      doc.setFont("helvetica", "normal");
      doc.text(isRental ? "Rental" : "Purchase", 155, y);
      y += 10;

      doc.setFont("helvetica", "bold");
      doc.text("Buyer:", 14, y);
      doc.setFont("helvetica", "normal");
      doc.text(`${buyerName}${buyerEmail ? ` (${buyerEmail})` : ""}`, 38, y);
      y += 8;

      doc.setFont("helvetica", "bold");
      doc.text("Seller:", 14, y);
      doc.setFont("helvetica", "normal");
      doc.text(sellerName, 38, y);
      y += 12;

      doc.setFont("helvetica", "bold");
      doc.text("Guide Details", 14, y);
      y += 8;

      doc.setFont("helvetica", "normal");
      doc.text(`Title: ${guideTitle}`, 14, y);
      y += 7;
      doc.text(`Subject: ${order?.subject || "General"}`, 14, y);
      y += 7;
      doc.text(`Condition: ${order?.condition || "Not specified"}`, 14, y);
      y += 7;
      doc.text(`Edition: ${order?.edition || "Not specified"}`, 14, y);
      y += 10;

      doc.setFont("helvetica", "bold");
      doc.text("Payment Summary", 14, y);
      y += 8;

      doc.setFont("helvetica", "normal");
      doc.text(`Base Amount: ${formatInr(totalAmount)}`, 14, y);
      y += 7;
      if (isRental) {
        doc.text(`Refundable Deposit: ${formatInr(deposit)}`, 14, y);
        y += 7;
        doc.text(`Rental End Date: ${rentalEnd}`, 14, y);
        y += 7;
      } else {
        doc.text(`Purchase Date: ${purchaseDate}`, 14, y);
        y += 7;
      }

      doc.setFont("helvetica", "bold");
      doc.text(`Total Paid: ${formatInr(totalAmount)}`, 14, y);
      y += 12;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("This is a system-generated invoice from ReGuide Marketplace.", 14, y);
      y += 5;
      doc.text("Keep this bill for future reference.", 14, y);

      const safeOrderId = orderId.replace(/[^a-zA-Z0-9_-]/g, "_");
      doc.save(`reguide-bill-${safeOrderId}.pdf`);
    } catch (error) {
      console.error("Failed to generate bill PDF:", error);
      alert("Could not generate bill PDF. Please try again.");
    } finally {
      setDownloadingBillByOrder((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  return (
    <div className="myorders-wrapper">
      <div className="myorders-container">
        <div className="myorders-header">
          <h1>My Orders</h1>
          <p className="orders-count">Total Orders: <strong>{orders.length}</strong></p>
        </div>

        {success && (
          <div className="myorders-success-box">
            <CheckCircle size={24} className="success-icon" />
            <p>Payment complete! Your order has been added.</p>
          </div>
        )}

        {loading ? (
          <div className="myorders-empty"><p>Loading your orders...</p></div>
        ) : orders.length === 0 ? (
          <div className="myorders-empty">
            <Package size={60} className="empty-icon" />
            <h2>No Orders Yet</h2>
            <p>Start browsing guides and place your first order!</p>
          </div>
        ) : (
          <>
            <div className="myorders-filter">
              <button
                className={`filter-btn ${filterType === "all" ? "active" : ""}`}
                onClick={() => setFilterType("all")}
              >
                All Orders ({orders.length})
              </button>
              <button
                className={`filter-btn ${filterType === "rent" ? "active" : ""}`}
                onClick={() => setFilterType("rent")}
              >
                Rentals ({orders.filter(o => (o.type || o.order_type) === "rent").length})
              </button>
              <button
                className={`filter-btn ${filterType === "buy" ? "active" : ""}`}
                onClick={() => setFilterType("buy")}
              >
                Purchases ({orders.filter(o => (o.type || o.order_type) === "buy").length})
              </button>
            </div>

            <div className="myorders-list">
              {filteredOrders.map((order, idx) => {
                const orderId = order.orderId || order.order_key || order.id;
                const orderType = order.type || order.order_type || "buy";
                const isReturned = Boolean(order?.returned || order?.buyer_returned || order?.buyerReturned);
                const returnedSuccess = Boolean(returnedOrderState[orderId]);
                const rentalDaysRemaining =
                  orderType === "rent"
                    ? calculateDaysRemaining(order.endDate || order.end_date)
                    : null;
                const isOverdueRental =
                  orderType === "rent" && !isReturned && Number(rentalDaysRemaining) < 0;

                return (
                  <div
                    key={idx}
                    className={`order-card order-${orderType}`}
                    onClick={() => handleViewDetails(order)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleViewDetails(order);
                      }
                    }}
                  >
                    <div className="order-card-header">
                      <div className="order-title-section">
                        <h3>{order.title || order.guide_title}</h3>
                        <span className={`order-badge ${orderType}`}>
                          {orderType === "rent" ? "Rental" : "Purchase"}
                        </span>
                        {isOverdueRental && (
                          <span className="order-status-badge overdue">Overdue</span>
                        )}
                      </div>
                    </div>

                    <div className="order-amount">₹{order.amount}</div>

                    <div className="order-details-grid">
                      {orderType === "rent" ? (
                        <>
                          <div className="order-detail-item">
                            <Calendar size={18} className="detail-icon" />
                            <div>
                              <p className="detail-label">Rental Until</p>
                              <p className="detail-value">{order.endDate || order.end_date}</p>
                            </div>
                          </div>
                          <div className="order-detail-item">
                            <Clock size={18} className="detail-icon" />
                            <div>
                              <p className="detail-label">Time Remaining</p>
                              <p className="detail-value">
                                {isOverdueRental
                                  ? `Overdue by ${Math.abs(Number(rentalDaysRemaining))} day${Math.abs(Number(rentalDaysRemaining)) === 1 ? "" : "s"}`
                                  : `${rentalDaysRemaining} days`}
                              </p>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="order-detail-item full-width">
                          <Calendar size={18} className="detail-icon" />
                          <div>
                            <p className="detail-label">Purchased On</p>
                            <p className="detail-value">{order.purchaseDate || order.purchase_date}</p>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="order-actions">
                      <button
                        className="order-btn secondary bill-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadBillPdf(order);
                        }}
                        disabled={Boolean(downloadingBillByOrder[orderId])}
                      >
                        {downloadingBillByOrder[orderId] ? "Preparing..." : "Download Bill"}
                      </button>
                      {orderType === "rent" && (
                        <button
                          className={`order-btn returned-btn ${isReturned || returnedSuccess ? "done" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleGuideReturned(order);
                          }}
                          disabled={isReturned || returnedSuccess || returningOrderId === orderId}
                        >
                          {returningOrderId === orderId
                            ? "Submitting..."
                            : isReturned || returnedSuccess
                              ? "guide returned sucessfully"
                              : "Guide Returned"}
                        </button>
                      )}
                      {!order.review ? (
                        <button
                          className="order-btn review-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleReview(orderId);
                          }}
                        >
                          {reviewOpen[orderId] ? "Cancel" : "Add Review"}
                        </button>
                      ) : (
                        <div className="review-submitted">
                          <span className="review-stars">
                            {[1,2,3,4,5].map(s => (
                              <Star
                                key={s}
                                size={12}
                                fill={s <= order.review.rating ? "#f59e0b" : "none"}
                                stroke="#f59e0b"
                              />
                            ))}
                          </span>
                          <span className="review-done-label">Reviewed</span>
                        </div>
                      )}
                    </div>

                    {reviewOpen[orderId] && !order.review && (
                      <div className="review-form" onClick={(e) => e.stopPropagation()}>
                        <p className="review-form-title">
                          Rate &amp; Review <strong>{order.title || order.guide_title}</strong>
                        </p>
                        <div className="review-stars-input">
                          {[1,2,3,4,5].map(s => (
                            <Star
                              key={s}
                              size={22}
                              fill={s <= (reviewData[orderId]?.rating || 0) ? "#f59e0b" : "none"}
                              stroke="#f59e0b"
                              style={{ cursor: "pointer" }}
                              onClick={() => handleReviewChange(orderId, "rating", s)}
                            />
                          ))}
                        </div>
                        <textarea
                          className="review-textarea"
                          placeholder="Write your review here..."
                          rows={3}
                          value={reviewData[orderId]?.comment || ""}
                          onChange={e => handleReviewChange(orderId, "comment", e.target.value)}
                        />
                        <div className="review-image-tools">
                          <label className="review-image-upload-label">
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              onChange={(e) => {
                                handleReviewImagesChange(orderId, e.target.files);
                                e.target.value = "";
                              }}
                            />
                            Add Photos
                          </label>
                          <span className="review-image-hint">Up to 4 images (max 5MB each)</span>
                        </div>
                        {(reviewData[orderId]?.images || []).length > 0 && (
                          <div className="review-image-preview-grid">
                            {(reviewData[orderId]?.images || []).map((image, imageIndex) => (
                              <div key={`${image?.name || "img"}-${imageIndex}`} className="review-image-preview-item">
                                <img src={image.previewUrl} alt={`Review upload ${imageIndex + 1}`} />
                                <button
                                  type="button"
                                  className="review-image-remove"
                                  onClick={() => removeReviewImage(orderId, imageIndex)}
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <button
                          className="order-btn submit-review-btn"
                          onClick={() => submitReview(orderId)}
                          disabled={submittingReview[orderId]}
                        >
                          {submittingReview[orderId] ? "Submitting..." : "Submit Review"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Myorders;