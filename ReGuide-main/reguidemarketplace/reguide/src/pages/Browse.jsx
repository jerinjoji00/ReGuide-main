import { useEffect, useState, useMemo } from "react";
import { BookOpen } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getAllBrowseGuides } from "../services/guideService";
import { calculateRelevanceScore } from "../util/relevanceScore";
import "./Browse.css";

function Browse() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [guides, setGuides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeImageIndexes, setActiveImageIndexes] = useState({});

  const [filters, setFilters] = useState({
    examType: "All Exams",
    relevanceScore: "All Levels",
    priceRange: "All Prices",
    condition: "All Conditions",
  });

  const currentUser = JSON.parse(localStorage.getItem("reguideUser") || "{}");
  const currentUserId = String(currentUser?.id || "").trim();
  const user = {
    target_exam: currentUser?.target_exam,
    prep_stage:  currentUser?.prep_stage,
  };

  const isOwnGuide = (guide) => {
    const sellerId = String(guide?.seller_id || guide?.sellerId || "").trim();
    return Boolean(currentUserId && sellerId && currentUserId === sellerId);
  };

  const getGuideImages = (guide) => {
    const allIndexImages = Array.isArray(guide?.indexPageUrls)
      ? guide.indexPageUrls.filter((url) => typeof url === "string" && url.trim())
      : guide?.indexPageUrl
      ? [guide.indexPageUrl]
      : [];

    return [
      guide?.frontCoverUrl || guide?.photoUrl || guide?.photo_url || null,
      guide?.backCoverUrl || null,
      ...allIndexImages,
    ].filter((url, index, arr) => typeof url === "string" && url && arr.indexOf(url) === index);
  };

  const shiftGuideImage = (guideId, totalImages, direction) => {
    if (!guideId || totalImages <= 1) return;

    setActiveImageIndexes((prev) => {
      const current = Number(prev[guideId] || 0);
      const nextIndex = (current + direction + totalImages) % totalImages;
      return { ...prev, [guideId]: nextIndex };
    });
  };

  const seedGuides = useMemo(() => [
    {
      id: "mock-1",
      title: "HC Verma Concept of Physics - Vol 1 & 2",
      author: "Dr. H.C. Verma",
      subject: "JEE",
      description: "Complete theory and solved/unsolved problems for JEE Physics preparation. Very good condition with no annotations.",
      condition: "Like New",
      pages: 450,
      rentalPrice: 80,
      buyPrice: 450,
      pricingType: "both renting and purchase",
      seller: "Aarav Sharma",
      seller_id: "mock-seller-1",
      sellerVerified: true,
      rating: 4.8,
      reviews: 12
    },
    {
      id: "mock-2",
      title: "Organic Chemistry for NEET",
      author: "M.S. Chouhan",
      subject: "NEET",
      description: "Excellent guide with detailed practice worksheets and pathways for organic reactions.",
      condition: "New",
      pages: 320,
      rentalPrice: 95,
      buyPrice: 550,
      pricingType: "both renting and purchase",
      seller: "Neha Gupta",
      seller_id: "mock-seller-2",
      sellerVerified: true,
      rating: 4.9,
      reviews: 8
    },
    {
      id: "mock-3",
      title: "Quantitative Aptitude for CAT",
      author: "Arun Sharma",
      subject: "CAT",
      description: "The definitive bible for CAT prep. Includes advanced level questions and short-cut tricks.",
      condition: "Good",
      pages: 800,
      rentalPrice: 120,
      buyPrice: 600,
      pricingType: "both renting and purchase",
      seller: "Rohan Mehta",
      seller_id: "mock-seller-3",
      sellerVerified: false,
      rating: 4.7,
      reviews: 20
    },
    {
      id: "mock-4",
      title: "GATE Computer Science & IT 2026",
      author: "Made Easy Team",
      subject: "GATE",
      description: "Brand new study material from Made Easy. Comprehensive coverage of all GATE topics.",
      condition: "New",
      pages: 650,
      rentalPrice: 150,
      buyPrice: 750,
      pricingType: "purchase only",
      seller: "Priya Nair",
      seller_id: "mock-seller-4",
      sellerVerified: true,
      rating: 4.6,
      reviews: 5
    },
    {
      id: "mock-5",
      title: "Indian Polity for UPSC Civil Services",
      author: "M. Laxmikanth",
      subject: "UPSC",
      description: "6th Edition Indian Polity. Essential for UPSC. Highlighted key sections for easy revision.",
      condition: "Fair",
      pages: 920,
      rentalPrice: 70,
      buyPrice: 350,
      pricingType: "renting only",
      seller: "Vikram Singh",
      seller_id: "mock-seller-5",
      sellerVerified: false,
      rating: 4.5,
      reviews: 15
    }
  ], []);

  useEffect(() => {
    let isMounted = true;

    async function loadGuides() {
      if (isMounted) setLoading(true);
      try {
        const allGuides = await getAllBrowseGuides(seedGuides);
        if (isMounted) {
          setGuides(allGuides);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadGuides();

    const refreshBrowse = () => loadGuides();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadGuides();
      }
    };

    window.addEventListener("reguide-orders-updated", refreshBrowse);
    window.addEventListener("reguide-guides-updated", refreshBrowse);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted = false;
      window.removeEventListener("reguide-orders-updated", refreshBrowse);
      window.removeEventListener("reguide-guides-updated", refreshBrowse);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [seedGuides]);

  const handleFilterChange = (type, value) => {
    setFilters({ ...filters, [type]: value });
  };

  // ✅ No relevance filter here — handled below using computed score
  const filteredGuides = guides.filter((guide) => {
    const matchesSearch =
      guide.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      guide.author.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesExam =
      filters.examType === "All Exams" || guide.examType === filters.examType;

    const matchesCondition =
      filters.condition === "All Conditions" ||
      String(guide.condition || "").toLowerCase() === String(filters.condition).toLowerCase();

    const rentalPrice = Number(guide.rentalPrice) || 0;
    const matchesPrice =
      filters.priceRange === "All Prices" ||
      (guide.hasRent && filters.priceRange === "₹ 0 - 100" && rentalPrice >= 0 && rentalPrice <= 100) ||
      (guide.hasRent && filters.priceRange === "₹ 100 - 200" && rentalPrice > 100 && rentalPrice <= 200) ||
      (guide.hasRent && filters.priceRange === "₹ 200+" && rentalPrice > 200);

    return matchesSearch && matchesExam && matchesCondition && matchesPrice;
  });

  // ✅ Sort by relevance score highest first
  const sortedGuides = [...filteredGuides].sort(
    (a, b) => calculateRelevanceScore(user, b) - calculateRelevanceScore(user, a)
  );

  // ✅ Relevance filter using computed score — BEFORE topScore
  const finalGuides = sortedGuides.filter((guide) => {
    if (filters.relevanceScore === "All Levels") return true;
    const score = calculateRelevanceScore(user, guide);
    if (filters.relevanceScore === "High Relevance")   return score >= 70;
    if (filters.relevanceScore === "Medium Relevance") return score >= 40 && score < 70;
    if (filters.relevanceScore === "Low Relevance")    return score < 40;
    return true;
  });

  // ✅ topScore computed from finalGuides — reflects what's actually visible
  const topScore = finalGuides.length > 0
    ? Math.max(...finalGuides.map((g) => calculateRelevanceScore(user, g)))
    : 0;

  return (
    <div className="browse-container">
      <div className="browse-header">
        <div className="header-top">
          <h1>ReGuide</h1>
          <span className="browse-label">Browse Marketplace</span>
        </div>
        <div className="search-bar">
          <input
            type="text"
            placeholder="Search guides by name, author or subject..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="browse-content">
        <aside className="filters-panel">
          <div className="filters-header">
            <h3>Filters</h3>
            <button
              className="clear-filters"
              onClick={() =>
                setFilters({
                  examType: "All Exams",
                  relevanceScore: "All Levels",
                  priceRange: "All Prices",
                  condition: "All Conditions",
                })
              }
            >
              Clear All
            </button>
          </div>

          <div className="filter-group">
            <label>Exam Type</label>
            <select value={filters.examType} onChange={(e) => handleFilterChange("examType", e.target.value)}>
              <option>All Exams</option>
              <option>JEE</option>
              
              <option>NEET</option>
              <option>CAT</option>
              <option>GATE</option>
              <option>UPSC</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Relevance Score</label>
            <select value={filters.relevanceScore} onChange={(e) => handleFilterChange("relevanceScore", e.target.value)}>
              <option>All Levels</option>
              <option>High Relevance</option>
              <option>Medium Relevance</option>
              <option>Low Relevance</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Price Range (Rental/Month)</label>
            <select value={filters.priceRange} onChange={(e) => handleFilterChange("priceRange", e.target.value)}>
              <option>All Prices</option>
              <option>₹ 0 - 100</option>
              <option>₹ 100 - 200</option>
              <option>₹ 200+</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Condition</label>
            <select value={filters.condition} onChange={(e) => handleFilterChange("condition", e.target.value)}>
              <option>All Conditions</option>
              <option>New</option>
              <option>Like New</option>
              <option>Good</option>
              <option>Fair</option>
            </select>
          </div>

          <div className="filter-info">
            <p>Showing {finalGuides.length} guides</p>
          </div>
        </aside>

        <main className="guides-content">
          <div className="guides-header">
            <h2>Available Guides</h2>
            <p>Browse and rent quality study materials       </p>
            
          </div>

          <div className="guides-grid">
            {loading ? (
              <div className="no-results">
                <p>Loading guides...</p>
              </div>
            ) : finalGuides.length > 0 ? (
              finalGuides.map((guide) => {
                const hasRent       = guide.hasRent === true;
                const hasBuy        = guide.hasBuy === true;
                const isUnavailable = guide.currentlyUnavailable === true;
                const score         = calculateRelevanceScore(user, guide);
                const isTopRec      = score === topScore && topScore > 0;
                const ownListing    = isOwnGuide(guide);
                  const guideImages = getGuideImages(guide);
                  const activeImageIndex = Number(activeImageIndexes[guide.id] || 0) % Math.max(guideImages.length || 1, 1);
                  const activeGuideImage = guideImages[activeImageIndex] || null;

                return (
                  <div
                    key={guide.id}
                    className={`guide-card ${isUnavailable ? "guide-card-unavailable" : ""} ${isTopRec ? "guide-card-top" : ""}`}
                    onClick={() => {
                      if (isUnavailable) return;
                      navigate(`/guide/${guide.id}`, { state: { guide } });
                    }}
                    style={{ cursor: isUnavailable ? "not-allowed" : "pointer" }}
                  >
                    <div className="book-icon">
                      {activeGuideImage ? (
                        <>
                          <img
                            src={activeGuideImage}
                            alt={guide.title}
                            className="guide-thumb"
                          />
                          {guideImages.length > 1 && (
                            <>
                              <button
                                type="button"
                                className="guide-thumb-nav guide-thumb-prev"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  shiftGuideImage(guide.id, guideImages.length, -1);
                                }}
                                aria-label="Previous image"
                              >
                                ‹
                              </button>
                              <button
                                type="button"
                                className="guide-thumb-nav guide-thumb-next"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  shiftGuideImage(guide.id, guideImages.length, 1);
                                }}
                                aria-label="Next image"
                              >
                                ›
                              </button>
                              <div className="guide-thumb-dots" onClick={(e) => e.stopPropagation()}>
                                {guideImages.map((_, imageIndex) => (
                                  <span
                                    key={`${guide.id}-dot-${imageIndex}`}
                                    className={`guide-thumb-dot ${imageIndex === activeImageIndex ? "active" : ""}`}
                                  />
                                ))}
                              </div>
                            </>
                          )}
                        </>
                      ) : (
                        <BookOpen size={48} />
                      )}
                    </div>

                    <div className="card-content">
                      <h3>{guide.title}</h3>
                      <p className="author">{guide.author}</p>
                      {ownListing && (
                        <p className="own-listing-badge">Your Listing</p>
                      )}
                      {guide.sellerVerified && (
                        <p className="verified-seller-note">☑️ Verified Seller</p>
                      )}

                      <p className="author" style={{ fontWeight: 600 }}>
                        ⭐ {Number(guide.rating || 0).toFixed(1)} ({Number(guide.reviews || 0)}{" "}
                        {Number(guide.reviews || 0) === 1 ? "review" : "reviews"})
                      </p>

                      {/* ✅ Relevance score */}
                      <div className="relevance-score-row">
                        <span className="relevance-score-label">Relevance Score:</span>
                        <span className={`relevance-score-val ${score >= 70 ? "score-high" : score >= 40 ? "score-mid" : "score-low"}`}>
                          {score} / 100
                        </span>
                      </div>

                      {/* ✅ Top Recommended — all guides matching top score */}
                      {isTopRec && (
                        <span className="top-recommended-badge">⭐ Top Recommended</span>
                      )}

                      {/* ✅ Best Match — score ≥ 70 but not top score */}
                      {score >= 70 && !isTopRec && (
                        <span className="best-match-badge">🔥 Best Match</span>
                      )}

                     

                      <div className="pricing">
                        {isUnavailable && (
                          <div className="unavailable-banner">Currently Unavailable</div>
                        )}

                        {hasRent && (
                          <div className="price-row">
                            <span style={{ color: "#16a34a", fontWeight: "bold" }}>Rental (per month)</span>
                            <span className="price" style={{ color: "#16a34a", fontWeight: "bold" }}>₹ {guide.rentalPrice}</span>
                          </div>
                        )}

                        {hasRent && (
                          <div className="price-row refundable">
                            <span>Deposit</span>
                            <span className="price">₹ {Number(guide.buyPrice)}</span>
                          </div>
                        )}

                        {hasBuy && (
                          <div className="price-row">
                            <span style={{ color: "#16a34a", fontWeight: "bold" }}>Buy Price</span>
                            <span className="price" style={{ color: "#16a34a", fontWeight: "bold" }}>₹ {guide.buyPrice}</span>
                          </div>
                        )}

                        {guide.marketPrice != null && (
                          <div className="price-row" style={{ borderTop: "1px dashed #dbe4ff", marginTop: "6px", paddingTop: "6px" }}>
                            <span style={{ color: "#6366f1", fontWeight: 700 }}>📊 Market Price</span>
                            <span className="price" style={{ color: "#6366f1" }}>₹ {guide.marketPrice}</span>
                          </div>
                        )}
                      </div>

                      <div className="action-buttons">
                        {hasRent && (
                          <button
                            className="rent-btn"
                            disabled={isUnavailable}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isUnavailable) return;
                              if (isOwnGuide(guide)) {
                                alert("You cannot rent your own guide.");
                                return;
                              }
                              navigate(`/checkout/${guide.id}?type=rent`, { state: { guide } });
                            }}
                          >
                            📅 Rent
                          </button>
                        )}
                        {hasBuy && (
                          <button
                            className="buy-btn"
                            disabled={isUnavailable}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isUnavailable) return;
                              if (isOwnGuide(guide)) {
                                alert("You cannot buy your own guide.");
                                return;
                              }
                              navigate(`/checkout/${guide.id}?type=buy`, { state: { guide } });
                            }}
                          >
                            🛒 Buy
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="no-results">
                <p>No guides found matching your criteria</p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default Browse;