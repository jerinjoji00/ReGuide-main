import { useEffect, useState } from "react";
import { Upload, X, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createGuideListing } from "../services/guideService";
import { getCurrentUserProfile } from "../services/userService";
import { isSellerSuspended } from "../services/adminUserService";
import "./SellGuide.css";

const PHOTO_SLOTS = [
  {
    key: "front",
    title: "Front Cover *",
    subtitle: "Main cover image",
    multiple: false,
  },
  {
    key: "back",
    title: "Back Cover *",
    subtitle: "Back side details",
    multiple: false,
  },
  {
    key: "index",
    title: "Index / Contents *",
    subtitle: "Table of contents pages - upload up to 5 images",
    multiple: true,
  },
];

const EMPTY_PHOTO_STATE = {
  front: null,
  back: null,
  index: [],
};

function Sellguide() {
  const navigate = useNavigate();
  const conditionOptions = [
    { title: "New", desc: "Never used" },
    { title: "Like New", desc: "Minimal use" },
    { title: "Good", desc: "Some markings" },
    { title: "Fair", desc: "Heavy wear" },
  ];

  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [author, setAuthor] = useState("");
  const [pages, setPages] = useState("");
  const [condition, setCondition] = useState("New");
  const [edition, setEdition] = useState("");
  const [year, setYear] = useState("");
  const [difficultyLevel, setDifficultyLevel] = useState("");  // ✅ NEW
  const [pricingType, setPricingType] = useState("purchase only");
  const [rentalPrice, setRentalPrice] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [guidePhotos, setGuidePhotos] = useState(EMPTY_PHOTO_STATE);
  const [photoPreviews, setPhotoPreviews] = useState(EMPTY_PHOTO_STATE);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const MAX_INDEX_IMAGES = 5;
  const [currentUser, setCurrentUser] = useState(null);
  const [isSuspended, setIsSuspended] = useState(false);

  useEffect(() => {
    const fetchUserData = async () => {
      const user = await getCurrentUserProfile();
      setCurrentUser(user);
      if (user) {
        const suspended = isSellerSuspended(user);
        setIsSuspended(suspended);
      }
    };
    fetchUserData();
  }, []);

  useEffect(() => {
    return () => {
      if (photoPreviews.front) URL.revokeObjectURL(photoPreviews.front);
      if (photoPreviews.back) URL.revokeObjectURL(photoPreviews.back);
      (photoPreviews.index || []).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [photoPreviews]);

  const resetForm = () => {
    setTitle("");
    setSubject("");
    setDescription("");
    setAuthor("");
    setPages("");
    setCondition("New");
    setEdition("");
    setYear("");
    setDifficultyLevel("");  // ✅ NEW
    setPricingType("purchase only");
    setRentalPrice("");
    setPurchasePrice("");
    if (photoPreviews.front) URL.revokeObjectURL(photoPreviews.front);
    if (photoPreviews.back) URL.revokeObjectURL(photoPreviews.back);
    (photoPreviews.index || []).forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
    setGuidePhotos(EMPTY_PHOTO_STATE);
    setPhotoPreviews(EMPTY_PHOTO_STATE);
  };

  const handleYearChange = (e) => {
    const numericYear = e.target.value.replace(/\D/g, "");
    setYear(numericYear);
  };

  const handleSubmit = async () => {
    if (isSuspended) {
      setErrors((prev) => ({
        ...prev,
        submit: "Your account has been suspended. You cannot list new guides. Please contact support for assistance.",
      }));
      return;
    }

    let newErrors = {};

    if (!title.trim()) newErrors.title = "Guide title is required.";
    if (!subject) newErrors.subject = "Subject is required.";
    if (!description.trim()) newErrors.description = "Description is required.";
    if (!pages || pages <= 0) newErrors.pages = "Enter valid number of pages.";
    if (!edition.trim()) newErrors.edition = "Edition is required.";
    if (!year.trim()) {
      newErrors.year = "Year is required.";
    } else if (!/^\d+$/.test(year.trim())) {
      newErrors.year = "Year must contain numbers only.";
    }
    if (!difficultyLevel) newErrors.difficultyLevel = "Difficulty level is required.";
    if (
      (pricingType === "renting only" || pricingType === "both renting and purchase") &&
      (!rentalPrice || rentalPrice <= 0)
    )
      newErrors.rentalPrice = "Enter a valid rental price.";
    if (
      (pricingType === "purchase only" ||
        pricingType === "renting only" ||
        pricingType === "both renting and purchase") &&
      (!purchasePrice || purchasePrice <= 0)
    )
      newErrors.purchasePrice = "Enter a valid purchase price.";
    if (!author.trim()) newErrors.author = "Author name is required.";
    if (!guidePhotos.front) newErrors.front = "Front cover image is required.";
    if (!guidePhotos.back) newErrors.back = "Back cover image is required.";
    if (!guidePhotos.index || guidePhotos.index.length === 0) newErrors.index = "At least one index/contents image is required.";

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setLoading(true);
    setSuccessMsg("");

    try {
      const result = await createGuideListing({
        title: title.trim(),
        subject,
        description: description.trim(),
        author: author.trim(),
        pages,
        condition,
        edition: edition.trim(),
        year,
        difficultyLevel,
        pricingType,
        rentalPrice,
        purchasePrice,
        frontCoverFile: guidePhotos.front,
        backCoverFile: guidePhotos.back,
        indexPageFiles: guidePhotos.index,
        guidePhotoFile: guidePhotos.front,
        photoUrl: photoPreviews.front,
      });

      resetForm();

      setSuccessMsg("your guide was listed successfully.Wait for admin approval");
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        submit: err?.message || "Failed to list guide. Please try again.",
      }));
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoUpload = (slotKey, e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";

    if (files.length === 0) return;

    const invalidFile = files.find(
      (file) => !file.type.startsWith("image/") || file.size > 5 * 1024 * 1024
    );

    if (invalidFile) {
      setErrors((prev) => ({
        ...prev,
        [slotKey]: invalidFile.type.startsWith("image/")
          ? "File size must be less than 5MB."
          : "Please upload a valid image file.",
      }));
      return;
    }

    if (slotKey === "index") {
      const remainingSlots = Math.max(MAX_INDEX_IMAGES - guidePhotos.index.length, 0);
      if (remainingSlots <= 0) {
        setErrors((prev) => ({ ...prev, [slotKey]: `Maximum ${MAX_INDEX_IMAGES} images allowed.` }));
        return;
      }

      const nextFiles = files.slice(0, remainingSlots);
      const previewUrls = nextFiles.map((file) => URL.createObjectURL(file));

      setGuidePhotos((prev) => ({
        ...prev,
        index: [...prev.index, ...nextFiles],
      }));

      setPhotoPreviews((prev) => ({
        ...prev,
        index: [...prev.index, ...previewUrls],
      }));

      if (files.length > nextFiles.length) {
        setErrors((prev) => ({
          ...prev,
          [slotKey]: `You can upload up to ${MAX_INDEX_IMAGES} images.`,
        }));
      } else {
        setErrors((prev) => ({ ...prev, [slotKey]: null }));
      }
    } else {
      const file = files[0];

      setGuidePhotos((prev) => ({
        ...prev,
        [slotKey]: file,
      }));

      const previewUrl = URL.createObjectURL(file);
      setPhotoPreviews((prev) => {
        if (prev[slotKey]) {
          URL.revokeObjectURL(prev[slotKey]);
        }
        return {
          ...prev,
          [slotKey]: previewUrl,
        };
      });

      setErrors((prev) => ({ ...prev, [slotKey]: null }));
    }
  };

  const removePhoto = (slotKey) => {
    if (slotKey === "index-all") {
      // Remove all index images
      setGuidePhotos((prev) => ({
        ...prev,
        index: [],
      }));
      setPhotoPreviews((prev) => {
        (prev.index || []).forEach((url) => {
          if (url) URL.revokeObjectURL(url);
        });
        return {
          ...prev,
          index: [],
        };
      });
    } else if (typeof slotKey === "object" && slotKey.key === "index") {
      // Remove specific index image by array index
      const imageIndex = slotKey.index;
      setGuidePhotos((prev) => {
        const newIndex = prev.index.filter((_, i) => i !== imageIndex);
        return {
          ...prev,
          index: newIndex,
        };
      });
      setPhotoPreviews((prev) => {
        if (prev.index[imageIndex]) {
          URL.revokeObjectURL(prev.index[imageIndex]);
        }
        const newIndex = prev.index.filter((_, i) => i !== imageIndex);
        return {
          ...prev,
          index: newIndex,
        };
      });
    } else {
      // Remove single image (front/back)
      setGuidePhotos((prev) => ({
        ...prev,
        [slotKey]: null,
      }));
      setPhotoPreviews((prev) => {
        if (prev[slotKey]) {
          URL.revokeObjectURL(prev[slotKey]);
        }
        return {
          ...prev,
          [slotKey]: null,
        };
      });
    }
  };

  return (
    <div className="sell-main">
      <div className="sell-header">
        <div>
          <h1>Sell a Guide</h1>
          <p className="page-subtitle">
            List your material with a clean summary, a cover photo, and clear pricing.
          </p>
        </div>
        <button
          type="button"
          className="my-guide-listings-btn"
          onClick={() => navigate("/guide-listings")}
        >
          My Guide Listings
        </button>
      </div>

      {isSuspended && (
        <div className="suspension-alert">
          <div className="suspension-alert-content">
            <AlertCircle size={20} />
            <div>
              <strong>Account Suspended</strong>
              <p>Your account has been suspended and you cannot list new guides at this time. Please contact support for assistance.</p>
            </div>
          </div>
        </div>
      )}

      {successMsg && <p className="success-message">{successMsg}</p>}
      {errors.submit && <p className="error submit-error">{errors.submit}</p>}

      <div className="sell-layout">
        <div className="sell-primary">

          {/* GUIDE INFO */}
          <div className="card sell-card">
            <div className="section-heading">
              <h2>Guide Info</h2>
              <p>Core details students need before ordering.</p>
            </div>

            <div className="form-grid">
              <div className="field-group field-span-2">
                <label>Guide Title *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="E.g., JEE Mains Complete Study Guide"
                />
                {errors.title && <p className="error">{errors.title}</p>}
              </div>

              <div className="field-group">
                <label>Subject/Exam *</label>
                <select value={subject} onChange={(e) => setSubject(e.target.value)}>
                  <option value="">Select subject</option>
                  <option>JEE</option>
                  <option>NEET</option>
                  <option>UPSC</option>
                  <option>GATE</option>
                  <option>CAT</option>
                  
                </select>
                {errors.subject && <p className="error">{errors.subject}</p>}
              </div>

              <div className="field-group">
                <label>Pages *</label>
                <input
                  type="number"
                  value={pages}
                  onChange={(e) => setPages(e.target.value)}
                  placeholder="250"
                />
                {errors.pages && <p className="error">{errors.pages}</p>}
              </div>

              <div className="field-group field-span-2">
                <label>Description *</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the contents, strengths, and what is included in the guide."
                ></textarea>
                {errors.description && <p className="error">{errors.description}</p>}
              </div>

              <div className="field-group">
                <label>Author *</label>
                <input
                  type="text"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="E.g., H. C. Verma"
                />
                {errors.author && <p className="error">{errors.author}</p>}
              </div>

              <div className="field-group">
                <label>Edition *</label>
                <input
                  type="text"
                  value={edition}
                  onChange={(e) => setEdition(e.target.value)}
                  placeholder="2024 Edition"
                />
                {errors.edition && <p className="error">{errors.edition}</p>}
              </div>

              <div className="field-group">
                <label>Year *</label>
                <input
                  type="text"
                  value={year}
                  onChange={handleYearChange}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="2024"
                />
                {errors.year && <p className="error">{errors.year}</p>}
              </div>

              {/* ✅ NEW — Difficulty Level field */}
              <div className="field-group field-span-2">
                <label>Difficulty Level *</label>
                <select
                  value={difficultyLevel}
                  onChange={(e) => setDifficultyLevel(e.target.value)}
                >
                  <option value="">Select difficulty level</option>
                  <option value="Beginner">Beginner — Introductory, foundational content</option>
                  <option value="Intermediate">Intermediate — Moderate depth, some prior knowledge needed</option>
                  <option value="Advanced">Advanced — In-depth, for serious preparation</option>
                  <option value="Revision">Revision — Concise summaries, quick review</option>
                  <option value="Mock Test Phase">Mock Test Phase — Practice papers, exam-pattern focused</option>
                </select>
                {errors.difficultyLevel && <p className="error">{errors.difficultyLevel}</p>}
              </div>

            </div>
          </div>

          {/* CONDITION */}
          <div className="card sell-card">
            <div className="section-heading">
              <h2>Condition</h2>
              <p>Choose the state of the guide and highlight wear clearly.</p>
            </div>

            <div className="condition-grid">
              {conditionOptions.map((item) => (
                <div
                  key={item.title}
                  className={`condition-option ${condition === item.title ? "selected" : ""}`}
                  onClick={() => setCondition(item.title)}
                >
                  <input
                    type="radio"
                    name="condition"
                    checked={condition === item.title}
                    readOnly
                  />
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="sell-sidebar">

          {/* PHOTO */}
          <div className="card sell-card sell-photo-card">
            <div className="section-heading">
              <h2>Guide Photos *</h2>
              <p>Upload front cover, back cover, and index/contents page.</p>
            </div>

            <div className="photo-slot-list">
              {PHOTO_SLOTS.map((slot) => (
                <div key={slot.key} className="photo-slot-item">
                  <p className="photo-slot-title">{slot.title}</p>
                  <p className="photo-slot-subtitle">{slot.subtitle}</p>

                  {slot.multiple ? (
                    // Multiple images for index slot
                    <div>
                      {photoPreviews.index && photoPreviews.index.length > 0 ? (
                        <div>
                          <div className="photo-grid-multiple">
                            {photoPreviews.index.map((url, idx) => (
                              <div key={idx} className="photo-grid-item">
                                <img src={url} alt={`Index page ${idx + 1}`} className="photo-preview-img-grid" />
                                <button
                                  className="remove-photo-btn-grid"
                                  onClick={() => removePhoto({ key: "index", index: idx })}
                                  type="button"
                                  title="Remove this image"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            ))}
                          </div>
                          {photoPreviews.index.length < MAX_INDEX_IMAGES && (
                            <label className="photo-upload-label-compact photo-upload-add-more">
                              <div className="photo-upload-box-compact">
                                <Upload size={22} className="upload-icon-compact" />
                                <p className="upload-text-compact">Add more images</p>
                                <span className="upload-meta">{MAX_INDEX_IMAGES - photoPreviews.index.length} remaining</span>
                              </div>
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={(e) => handlePhotoUpload(slot.key, e)}
                                style={{ display: "none" }}
                              />
                            </label>
                          )}
                        </div>
                      ) : (
                        <label className="photo-upload-label-compact">
                          <div className="photo-upload-box-compact">
                            <Upload size={22} className="upload-icon-compact" />
                            <p className="upload-text-compact">Upload first image</p>
                            <span className="upload-meta">PNG or JPG, up to 5MB each</span>
                          </div>
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={(e) => handlePhotoUpload(slot.key, e)}
                            style={{ display: "none" }}
                          />
                        </label>
                      )}
                    </div>
                  ) : (
                    // Single image for front/back
                    photoPreviews[slot.key] ? (
                      <div className="photo-preview-compact">
                        <img src={photoPreviews[slot.key]} alt={`${slot.title} preview`} className="photo-preview-img" />
                        <button
                          className="remove-photo-btn-compact"
                          onClick={() => removePhoto(slot.key)}
                          type="button"
                        >
                          <X size={14} /> Remove
                        </button>
                      </div>
                    ) : (
                      <label className="photo-upload-label-compact">
                        <div className="photo-upload-box-compact">
                          <Upload size={22} className="upload-icon-compact" />
                          <p className="upload-text-compact">Upload image</p>
                          <span className="upload-meta">PNG or JPG, up to 5MB</span>
                        </div>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handlePhotoUpload(slot.key, e)}
                          style={{ display: "none" }}
                        />
                      </label>
                    )
                  )}

                  {errors[slot.key] && <p className="error">{errors[slot.key]}</p>}
                </div>
              ))}
            </div>
          </div>

          {/* PRICING */}
          <div className="card sell-card sell-pricing-card">
            <div className="section-heading">
              <h2>Pricing</h2>
              <p style={{ color: "#dc2626" }}>
                Purchase price is required. If you add a rental price, you also need to add
                the purchase price. For rental, deposit is equal to purchase price.
              </p>
            </div>

            <div className="field-group">
              <label>Select Option *</label>
              <select
                value={pricingType}
                onChange={(e) => {
                  setPricingType(e.target.value);
                  setRentalPrice("");
                  setPurchasePrice("");
                  setErrors((prev) => ({
                    ...prev,
                    rentalPrice: null,
                    purchasePrice: null,
                    pricing: null,
                  }));
                }}
              >
                <option value="renting only">Renting Only</option>
                <option value="purchase only">Purchase Only</option>
                <option value="both renting and purchase">Both Renting and Purchase</option>
              </select>
            </div>

            <div className="pricing-grid">
              {(pricingType === "renting only" ||
                pricingType === "both renting and purchase") && (
                <div className="field-group">
                  <label>Rental Price *</label>
                  <input
                    type="number"
                    value={rentalPrice}
                    onChange={(e) => setRentalPrice(e.target.value)}
                    placeholder="199"
                  />
                  {errors.rentalPrice && <p className="error">{errors.rentalPrice}</p>}
                </div>
              )}

              {(pricingType === "purchase only" ||
                pricingType === "renting only" ||
                pricingType === "both renting and purchase") && (
                <div className="field-group">
                  <label>
                    Purchase Price *
                    {(pricingType === "renting only" ||
                      pricingType === "both renting and purchase")
                      ? " (deposit for rental)"
                      : ""}
                  </label>
                  <input
                    type="number"
                    value={purchasePrice}
                    onChange={(e) => setPurchasePrice(e.target.value)}
                    placeholder="499"
                  />
                  {errors.purchasePrice && <p className="error">{errors.purchasePrice}</p>}
                </div>
              )}
            </div>

            {errors.pricing && <p className="error pricing-error">{errors.pricing}</p>}

            <button 
              className="submit-btn" 
              onClick={handleSubmit} 
              disabled={loading || isSuspended}
              title={isSuspended ? "Your account is suspended" : ""}
            >
              {loading ? "Submitting..." : "Submit Guide"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Sellguide;