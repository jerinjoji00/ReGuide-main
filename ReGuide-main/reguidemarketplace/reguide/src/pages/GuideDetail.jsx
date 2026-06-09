import { useState, useEffect } from "react";
import { Star, BookOpen, ZoomIn } from "lucide-react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { getOrCreateConversation, resolveContactableSellerId } from "../services/chatService";
import { getCurrentUserId } from "../services/userService";
import { isSellerVerified } from "../services/adminUserService";
import { fetchGuideReviews } from "../services/orderService";
import { supabase } from "../supabaseClient";
import "./GuideDetail.css";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value) => typeof value === "string" && UUID_REGEX.test(value);

const formatSellerDisplayName = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return "Unknown Seller";
  if (normalized.includes("@")) {
    const [username] = normalized.split("@");
    return username || "Unknown Seller";
  }
  return normalized;
};

function GuideDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: routeGuideId } = useParams();
  const [isContactingSellerLoading, setIsContactingSellerLoading] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [isZoomOpen, setIsZoomOpen] = useState(false);

  // ✅ starts empty — 0 reviews until real ones exist in Supabase
  const [guideReviews, setGuideReviews] = useState([]);

  const incomingGuide = location.state?.guide;

  // ✅ fetch reviews from Supabase — same data for all accounts
  useEffect(() => {
    const guideId = incomingGuide?.id || routeGuideId || null;
    if (!guideId) return;

    let isMounted = true;
    let subscription;

    async function loadReviews() {
      try {
        const reviews = await fetchGuideReviews(guideId);
        if (isMounted) setGuideReviews(reviews);

        // ✅ real-time updates when new review submitted
        subscription = supabase
          .channel(`guide-reviews-${guideId}`)
          .on("postgres_changes", {
            event: "UPDATE",
            schema: "public",
            table: "orders",
            filter: `guide_id=eq.${guideId}`,
          }, () => {
            fetchGuideReviews(guideId).then(newReviews => {
              if (isMounted) setGuideReviews(newReviews);
            });
          })
          .subscribe();
      } catch (error) {
        console.error("Error loading reviews:", error);
        if (isMounted) setGuideReviews([]);
      }
    }

    loadReviews();

    return () => {
      isMounted = false;
      if (subscription) supabase.removeChannel(subscription);
    };
  }, [incomingGuide?.id, routeGuideId]);

  useEffect(() => {
    setActiveImageIndex(0);
  }, [incomingGuide?.id, routeGuideId]);

  const guide = incomingGuide ? {
    ...incomingGuide,
    id: incomingGuide.id || 1,
    seller_id: incomingGuide.seller_id || "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    condition: incomingGuide.condition || incomingGuide.status || "Not specified",
    examTypeLabel: incomingGuide.examType || "General",
    examColor: "bg-blue",
    relevance: "High Relevance",
    totalPages: incomingGuide.totalPages || 180,
    lastUpdated: "January 2024",
    seller: formatSellerDisplayName(
      incomingGuide.seller ||
      incomingGuide.seller_name ||
      incomingGuide.sellerName ||
      "Unknown Seller"
    ),
    author: incomingGuide.author || incomingGuide.writer || "Unknown",
    relevanceFeatures: [
      "Covers ~98% of exam content",
      "Updated content: Yes",
    ],
    included: [
      "Complete chapter summaries & key concepts",
      "180+ practice problems with solutions",
      "Formula sheets and quick reference guides",
      "Previous exam questions analysis",
    ],
    importantInfo: [
      {
        title: "Rental Period",
        description: "Access guide for 4 months from the rental date. Extensions available for ₹100 per month.",
      },
      {
        title: "Digital Access",
        description: "All purchases and rentals include unlimited digital access.",
      },
      {
        title: "Money-Back Guarantee",
        description: "Not satisfied? Return within 14 days for a full refund.",
      },
    ],
    pricing: incomingGuide.pricing || {
      rent: { price: 1299, deposit: 1500, total: 2799, period: "per month" },
      buy: { price: 4999, discount: 8, sale: true },
    },
  } : null;

  const pricingType = String(
    guide?.pricingType || guide?.pricing_type || "both renting and purchase"
  ).trim().toLowerCase();

  const hasRent =
    typeof guide?.hasRent === "boolean"
      ? guide.hasRent
      : (pricingType === "renting only" || pricingType === "both renting and purchase");

  const hasBuy =
    typeof guide?.hasBuy === "boolean"
      ? guide.hasBuy
      : (pricingType === "purchase only" || pricingType === "both renting and purchase");

  const handleContactSeller = async () => {
    try {
      setIsContactingSellerLoading(true);

      const currentUserId = await getCurrentUserId();
      if (!currentUserId) {
        alert("Please log in to contact the seller");
        navigate("/login");
        return;
      }

      if (!isUuid(currentUserId)) {
        alert("Your account is missing a valid user id. Please sign in again.");
        navigate("/login");
        return;
      }

      if (String(guide?.seller_id || "").trim() === currentUserId) {
        alert("You cannot contact yourself for your own guide.");
        return;
      }

      const sellerId = await resolveContactableSellerId(guide.seller_id, currentUserId);

      if (currentUserId === sellerId) {
        alert("You cannot contact yourself");
        return;
      }

      const conversation = await getOrCreateConversation(
        currentUserId,
        sellerId,
        guide.id
      );

      navigate(`/chat?conversation=${conversation.id}`);
    } catch (error) {
      console.error("Error contacting seller:", error);
      alert(error?.message || "Failed to start conversation. Please try again.");
    } finally {
      setIsContactingSellerLoading(false);
    }
  };

  if (!guide) return <p>Guide not found</p>;

  // Construct image array including all index pages
  const allIndexImages = guide?.indexPageUrls && Array.isArray(guide.indexPageUrls) 
    ? guide.indexPageUrls.filter(url => typeof url === "string" && url)
    : (guide?.indexPageUrl ? [guide.indexPageUrl] : []);
  
  const guideImages = [
    guide?.frontCoverUrl || guide?.photoUrl || null,
    guide?.backCoverUrl || null,
    ...allIndexImages,
  ].filter((url, index, arr) => typeof url === "string" && url && arr.indexOf(url) === index);
  
  const safeActiveIndex = Math.min(activeImageIndex, Math.max(guideImages.length - 1, 0));
  const guidePhoto = guideImages[safeActiveIndex] || null;
  const shiftGuideImage = (direction) => {
    if (guideImages.length <= 1) return;
    setActiveImageIndex((prev) => (prev + direction + guideImages.length) % guideImages.length);
  };

  useEffect(() => {
    if (!isZoomOpen) return;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsZoomOpen(false);
      } else if (event.key === "ArrowLeft") {
        shiftGuideImage(-1);
      } else if (event.key === "ArrowRight") {
        shiftGuideImage(1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isZoomOpen, guideImages.length]);
  const sellerVerified = Boolean(guide?.sellerVerified) || isSellerVerified({
    id: guide?.seller_id || null,
    email: guide?.seller_email || guide?.sellerEmail || null,
    full_name: guide?.seller || guide?.seller_name || "",
  });

  // ✅ starts at 0 — updates only after real Supabase reviews exist
  const avgRating = guideReviews.length > 0
    ? (guideReviews.reduce((sum, r) => sum + Number(r.rating), 0) / guideReviews.length).toFixed(1)
    : 0;
  const displayRating = guideReviews.length > 0 ? avgRating : 0;
  const displayReviewCount = guideReviews.length;

  return (
    <div className="guide-detail-container">
      <div className="detail-header">
        <button onClick={() => navigate("/browse")}>
          ← Back to Search Results
        </button>
      </div>

      <div className="detail-content">
        <div className="content-wrapper">

          {/* LEFT SIDE */}
          <div className="detail-main">

            <div className="detail-cover">
              {guidePhoto ? (
                <>
                  <img
                    src={guidePhoto}
                    alt={guide.title}
                    className="detail-cover-image"
                    onClick={() => setIsZoomOpen(true)}
                    title="Click to zoom"
                  />
                  <button
                    type="button"
                    className="detail-zoom-trigger"
                    onClick={() => setIsZoomOpen(true)}
                    aria-label="Zoom image"
                    title="Zoom image"
                  >
                    <ZoomIn size={16} />
                  </button>
                  {guideImages.length > 1 && (
                    <>
                      <button
                        type="button"
                        className="detail-image-nav detail-image-nav-prev"
                        onClick={() => shiftGuideImage(-1)}
                        aria-label="Previous image"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        className="detail-image-nav detail-image-nav-next"
                        onClick={() => shiftGuideImage(1)}
                        aria-label="Next image"
                      >
                        ›
                      </button>
                    </>
                  )}
                </>
              ) : (
                <div className="detail-cover-placeholder">
                  <BookOpen size={50} />
                  <span>No cover image</span>
                </div>
              )}
            </div>

            {guideImages.length > 1 && (
              <div className="detail-cover-thumbnails">
                {guideImages.map((imageUrl, index) => (
                  <button
                    key={`${imageUrl}-${index}`}
                    type="button"
                    className={`detail-cover-thumb-btn ${safeActiveIndex === index ? "active" : ""}`}
                    onClick={() => setActiveImageIndex(index)}
                  >
                    <img src={imageUrl} alt={`Guide preview ${index + 1}`} className="detail-cover-thumb" />
                  </button>
                ))}
              </div>
            )}

            <h1>{guide.title}</h1>
            <p className="guide-author-line">Author: {guide.author || "Unknown"}</p>

            <div className="rating-badge">
              <div className="rating-stars-row">
                {[1,2,3,4,5].map(s => (
                  <Star
                    key={s}
                    size={16}
                    fill={s <= Math.round(displayRating) ? "#f59e0b" : "none"}
                    stroke="#f59e0b"
                  />
                ))}
              </div>
              <span className="rating-number">{displayRating}</span>
              <span className="rating-reviews-count">
                ({displayReviewCount} {displayReviewCount === 1 ? "review" : "reviews"})
              </span>
            </div>

            <p>{guide.description}</p>

            {/* PRICING SECTION */}
            <div className="pricing-section">
              <h2>Pricing Options</h2>

              {guide.marketPrice != null && (
                <div className="market-price-card">
                  <div className="market-price-title">📊 Market Price</div>
                  <div className="market-price-value">₹{guide.marketPrice}</div>
                  <div className="market-price-note">Typical marketplace value for this guide</div>
                </div>
              )}

              <div className="pricing-options">

                {hasRent && (
                  <div className="pricing-box rent-box">
                    <h3>Rent this Guide</h3>
                    <div className="price-display">
                      ₹{guide.pricing.rent.price} / month
                    </div>
                    <p>Refundable Deposit: ₹{guide.pricing.rent.deposit}</p>
                    <p style={{ color: "#16a34a", fontWeight: "700" }}>
                      Total: ₹{guide.pricing.rent.total}
                    </p>
                    <button
                      className="action-btn rent-btn"
                      onClick={() => {
                        const currentUser = JSON.parse(localStorage.getItem("reguideUser") || "{}");
                        if (String(currentUser?.id || "").trim() && String(currentUser?.id || "").trim() === String(guide?.seller_id || "").trim()) {
                          alert("You cannot rent your own guide.");
                          return;
                        }
                        navigate(`/checkout/${guide.id}?type=rent`, { state: { guide } });
                      }}
                    >
                      Rent for ₹{guide.pricing.rent.price} per month
                    </button>
                  </div>
                )}

                {hasBuy && (
                  <div className="pricing-box buy-box">
                    <h3>Buy this Guide</h3>
                    <div className="price-display">
                      ₹{guide.pricing.buy.price}
                    </div>
                    <button
                      className="action-btn buy-btn"
                      onClick={() => {
                        const currentUser = JSON.parse(localStorage.getItem("reguideUser") || "{}");
                        if (String(currentUser?.id || "").trim() && String(currentUser?.id || "").trim() === String(guide?.seller_id || "").trim()) {
                          alert("You cannot buy your own guide.");
                          return;
                        }
                        navigate(`/checkout/${guide.id}?type=buy`, { state: { guide } });
                      }}
                    >
                      Buy for ₹{guide.pricing.buy.price}
                    </button>
                  </div>
                )}

              </div>
            </div>

            {/* REVIEWS SECTION */}
            <div className="reviews-section">
              <h2>
                Customer Reviews{" "}
                {displayReviewCount > 0 && (
                  <span className="reviews-count">({displayReviewCount})</span>
                )}
              </h2>

              {displayReviewCount === 0 ? (
                <p className="no-reviews">
                  No reviews yet. Be the first to review after purchasing!
                </p>
              ) : (
                <div className="reviews-list">
                  {guideReviews.map((review, i) => (
                    <div key={i} className="review-card">
                      <div className="review-header">
                        <div className="review-stars">
                          {[1,2,3,4,5].map(s => (
                            <Star
                              key={s}
                              size={14}
                              fill={s <= review.rating ? "#f59e0b" : "none"}
                              stroke="#f59e0b"
                            />
                          ))}
                        </div>
                        {/* ✅ buyer_name from Supabase orders table */}
                        <span className="review-author">
                          Reviewed by {review.reviewedBy}
                        </span>
                      </div>
                      <p className="review-comment">{review.comment}</p>
                      {Array.isArray(review.photos) && review.photos.length > 0 && (
                        <div className="review-photo-grid">
                          {review.photos.map((photoUrl, photoIndex) => (
                            <a
                              key={`${photoUrl}-${photoIndex}`}
                              href={photoUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="review-photo-link"
                            >
                              <img
                                src={photoUrl}
                                alt={`Review photo ${photoIndex + 1}`}
                                className="review-photo"
                              />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

          {/* RIGHT SIDEBAR */}
          <aside className="detail-sidebar">
            <div className="seller-card">
              <h4>Seller</h4>
              <p className="seller-name">{guide.seller}</p>
              {sellerVerified ? <span className="verified-seller-chip">☑️ Verified Seller</span> : null}
              <button
                className="contact-seller"
                onClick={handleContactSeller}
                disabled={isContactingSellerLoading}
              >
                {isContactingSellerLoading ? "Starting Chat..." : "Contact Seller"}
              </button>
            </div>

            <div className="quick-stats">
              <p>Author: {guide.author || "Unknown"}</p>
              <p>Difficulty: {guide.difficultyLevel || guide.difficulty_level || "Not specified"}</p>
              <p>Edition: {guide.edition}</p>
              <p>Condition: {guide.condition || "Not specified"}</p>
              <p>Pages: {guide.totalPages}</p>
              <p>
                Rating: ⭐ {displayRating} ({displayReviewCount}{" "}
                {displayReviewCount === 1 ? "review" : "reviews"})
              </p>
            </div>
          </aside>

        </div>
      </div>

      {isZoomOpen && guidePhoto && (
        <div className="detail-lightbox" onClick={() => setIsZoomOpen(false)}>
          <div className="detail-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="detail-lightbox-close"
              aria-label="Close zoom"
              onClick={() => setIsZoomOpen(false)}
            >
              ×
            </button>

            <img src={guidePhoto} alt={`${guide.title} zoomed`} className="detail-lightbox-image" />

            {guideImages.length > 1 && (
              <>
                <button
                  type="button"
                  className="detail-lightbox-nav detail-lightbox-prev"
                  aria-label="Previous image"
                  onClick={() => shiftGuideImage(-1)}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="detail-lightbox-nav detail-lightbox-next"
                  aria-label="Next image"
                  onClick={() => shiftGuideImage(1)}
                >
                  ›
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default GuideDetail;