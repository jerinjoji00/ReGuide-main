import { useState, useEffect, useRef } from "react";
import { supabase } from "../supabaseClient";
import { isSellerVerified } from "../services/adminUserService";
import "./Profile.css";

const PROFILE_IMAGES_BUCKET = "profile-images";
const BACKEND_BASE_URL = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/$/, "");

function getApiCandidates(path) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (BACKEND_BASE_URL) return [`${BACKEND_BASE_URL}${normalized}`];
  return [normalized, `http://localhost:5000${normalized}`];
}

function toE164Phone(rawPhone) {
  const value = String(rawPhone || "").trim();
  if (!value) return "";

  if (value.startsWith("+")) {
    const digits = value.slice(1).replace(/\D/g, "");
    return digits ? `+${digits}` : "";
  }

  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length >= 11) return `+${digits}`;
  return "";
}

async function postWithFallback(path, payload) {
  const candidates = getApiCandidates(path);
  let lastError = "";

  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        lastError = data?.error || `${response.status} ${response.statusText}`;
        continue;
      }

      return data;
    } catch {
      lastError = `Could not connect to ${url}`;
    }
  }

  throw new Error(lastError || "Request failed.");
}

function sanitizeFileName(name = "profile") {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function normalizeUserToProfileForm(user = {}) {
  return {
    id: user.id || "",
    role: user.role || "user",
    name: user.name || user.full_name || "",
    email: user.email || "",
    phone: user.phone || user.phone_number || user.mobile || "",
    exam: user.exam || user.target_exam || "",
    stage: user.stage || user.prep_stage || "",
    avatar: user.avatar || user.avatar_url || user.profile_photo || user.photo_url || "",
    phoneVerified: Boolean(user.phoneVerified || user.phone_verified),
    phoneVerifiedAt: user.phoneVerifiedAt || user.phone_verified_at || null,
  };
}

function getErrorText(error) {
  return `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
}

function isMissingVerificationColumnError(error) {
  const text = getErrorText(error);
  return (
    text.includes("phone_verified") &&
    (text.includes("schema cache") || text.includes("could not find") || text.includes("column"))
  );
}

async function getAuthenticatedUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) {
    return null;
  }
  return data.user.id;
}

async function uploadProfileImage(file, userId) {
  if (!file) return null;

  const safeName = sanitizeFileName(file.name || "profile-image");
  const path = `${userId}/${Date.now()}-${safeName}`;

  const { error } = await supabase.storage
    .from(PROFILE_IMAGES_BUCKET)
    .upload(path, file, { upsert: false });

  if (error) {
    throw error;
  }

  const { data } = supabase.storage
    .from(PROFILE_IMAGES_BUCKET)
    .getPublicUrl(path);

  return data?.publicUrl || null;
}

function getStoragePathFromPublicUrl(publicUrl, bucketName) {
  if (!publicUrl) return null;

  try {
    const url = new URL(publicUrl);
    const marker = `/storage/v1/object/public/${bucketName}/`;
    const markerIndex = url.pathname.indexOf(marker);

    if (markerIndex === -1) {
      return null;
    }

    const storagePath = url.pathname.slice(markerIndex + marker.length);
    return storagePath ? decodeURIComponent(storagePath) : null;
  } catch {
    return null;
  }
}

async function deleteProfileImageByUrl(publicUrl) {
  const storagePath = getStoragePathFromPublicUrl(publicUrl, PROFILE_IMAGES_BUCKET);
  if (!storagePath) {
    return;
  }

  const { error } = await supabase.storage
    .from(PROFILE_IMAGES_BUCKET)
    .remove([storagePath]);

  if (error) {
    throw error;
  }
}

function Profile() {
  const [editMode, setEditMode] = useState(false);
  const [profile, setProfile] = useState({
    name: "",
    email: "",
    phone: "",
    exam: "",
    stage: "",
    avatar: "",
  });
  const [originalEmail, setOriginalEmail] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [otpInput, setOtpInput] = useState("");
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletRows, setWalletRows] = useState([]);
  const [walletError, setWalletError] = useState("");
  const [walletSummary, setWalletSummary] = useState({
    depositPaid: 0,
    lockedDeposit: 0,
  });
  const phoneRegex = /^[0-9]{10}$/;
  const saveTimerRef = useRef(null);
  const role = String(profile.role || "user").toLowerCase();
  const sellerVerified = role === "seller" && isSellerVerified(profile);
  const profileRoleLabel = sellerVerified
    ? "☑️ Verified Seller"
    : role === "seller"
    ? "Seller"
    : "User";

  const formatCurrency = (amount) => {
    const value = Number(amount || 0);
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatDateTime = (value) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const persistProfileLocally = (nextProfile) => {
    const currentUser = JSON.parse(localStorage.getItem("reguideUser") || "{}");
    const mergedProfile = {
      ...currentUser,
      ...nextProfile,
      id: nextProfile.id || currentUser.id || "",
      role: nextProfile.role || currentUser.role || "user",
      name: nextProfile.name || "",
      full_name: nextProfile.name || "",
      target_exam: nextProfile.exam || "",
      prep_stage: nextProfile.stage || "",
      avatar_url: nextProfile.avatar || "",
    };

    delete mergedProfile.phone_verified;
    delete mergedProfile.phone_verified_at;

    localStorage.setItem("reguideUser", JSON.stringify(mergedProfile));

    // Keep compatibility with existing local users cache.
    try {
      const users = JSON.parse(localStorage.getItem("reguideUsers")) || [];
      const idx = users.findIndex(
        (u) =>
          (mergedProfile?.id && u.id === mergedProfile.id) ||
          u.email === originalEmail ||
          u.email === mergedProfile.email,
      );
      if (idx !== -1) {
        users[idx] = { ...users[idx], ...mergedProfile };
      } else {
        users.push(mergedProfile);
      }
      localStorage.setItem("reguideUsers", JSON.stringify(users));
    } catch {
      // Ignore storage errors.
    }
  };

  const syncProfileToDatabase = async (nextProfile, options = {}) => {
    const authenticatedUserId = await getAuthenticatedUserId();
    if (!authenticatedUserId) {
      throw new Error("No authenticated session found.");
    }

    const includeVerification = Boolean(options.includeVerification);

    const basePayload = {
      email: nextProfile.email || null,
      full_name: nextProfile.name || null,
      target_exam: nextProfile.exam || null,
      prep_stage: nextProfile.stage || null,
    };

    if (includeVerification) {
      basePayload.phone_verified = Boolean(nextProfile.phoneVerified);
      basePayload.phone_verified_at = nextProfile.phoneVerifiedAt || null;
    }

    const normalizedPhone = nextProfile.phone ? String(nextProfile.phone).trim() : null;
    const normalizedAvatar = nextProfile.avatar ? String(nextProfile.avatar).trim() : null;

    const payloadVariants = [
      {
        ...basePayload,
        phone: normalizedPhone,
        avatar_url: normalizedAvatar,
      },
      {
        ...basePayload,
        phone: normalizedPhone,
      },
      {
        ...basePayload,
        avatar_url: normalizedAvatar,
      },
      basePayload,
    ];

    let lastError = null;

    for (const payload of payloadVariants) {
      const { error: updateError, count } = await supabase
        .from("profiles")
        .update(payload, { count: "exact" })
        .eq("id", authenticatedUserId);

      if (!updateError && typeof count === "number" && count > 0) {
        return;
      }

      if (updateError) {
        lastError = updateError;
      }

      const { error: upsertError } = await supabase
        .from("profiles")
        .upsert([{ id: authenticatedUserId, ...payload }], { onConflict: "id" });

      if (!upsertError) {
        return;
      }

      lastError = upsertError;
    }

    if (includeVerification && isMissingVerificationColumnError(lastError)) {
      return syncProfileToDatabase(nextProfile, { includeVerification: false });
    }

    throw lastError || new Error("Failed to persist profile to database.");
  };

  const queueProfileSync = (nextProfile) => {
    persistProfileLocally(nextProfile);

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    setSaveStatus("Saving...");

    saveTimerRef.current = setTimeout(async () => {
      try {
        await syncProfileToDatabase(nextProfile);
        setSaveStatus("Saved");
      } catch (error) {
        const message = error?.message || "DB sync failed";
        setSaveStatus(`Saved locally (${message})`);
      }
    }, 450);
  };

  useEffect(() => {
    let isMounted = true;

    const loadProfile = async () => {
      const user = JSON.parse(localStorage.getItem("reguideUser") || "{}");
      const { data: authData } = await supabase.auth.getUser();
      const authUser = authData?.user || null;
      const authMeta = authUser?.user_metadata || {};

      const normalizedLocal = normalizeUserToProfileForm({
        ...user,
        phone_verified: authMeta.phone_verified === true || user.phone_verified === true,
        phone_verified_at: authMeta.phone_verified_at || user.phone_verified_at || null,
      });
      normalizedLocal.phoneVerified = false;
      normalizedLocal.phoneVerifiedAt = null;

      if (isMounted) {
        setProfile(normalizedLocal);
        setOriginalEmail(normalizedLocal.email || "");
      }

      const authenticatedUserId = await getAuthenticatedUserId();
      const profileId = authenticatedUserId || normalizedLocal.id;

      if (!profileId) {
        return;
      }

      const { data: dbProfile, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", profileId)
        .maybeSingle();

      if (error || !dbProfile || !isMounted) {
        return;
      }

      const normalizedDb = normalizeUserToProfileForm({
        ...normalizedLocal,
        ...dbProfile,
        phone_verified:
          typeof dbProfile?.phone_verified === "boolean"
            ? dbProfile.phone_verified
            : authMeta.phone_verified === true,
        phone_verified_at: dbProfile?.phone_verified_at || authMeta.phone_verified_at || null,
      });

      setProfile(normalizedDb);
      setOriginalEmail(normalizedDb.email || "");
      persistProfileLocally(normalizedDb);
    };

    loadProfile();

    return () => {
      isMounted = false;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadWallet = async () => {
      if (!profile?.id) {
        if (isMounted) {
          setWalletRows([]);
          setWalletSummary({ depositPaid: 0, lockedDeposit: 0 });
          setWalletLoading(false);
        }
        return;
      }

      setWalletLoading(true);
      setWalletError("");

      const { data, error } = await supabase
        .from("wallet_transactions")
        .select("id, transaction_type, amount, status, note, created_at, order_id")
        .eq("user_id", profile.id)
        .order("created_at", { ascending: false });

      if (!isMounted) return;

      if (error) {
        setWalletError(error?.message || "Failed to load wallet history.");
        setWalletRows([]);
        setWalletSummary({ depositPaid: 0, lockedDeposit: 0 });
        setWalletLoading(false);
        return;
      }

      const rows = Array.isArray(data) ? data : [];
      const depositPaid = rows
        .filter((row) => {
          const t = String(row?.transaction_type || "").toLowerCase();
          return t === "deposit_paid" || t === "deposit";
        })
        .reduce((sum, row) => sum + Number(row?.amount || 0), 0);
      const lockedDeposit = rows
        .filter(
          (row) =>
            (String(row?.transaction_type || "").toLowerCase() === "locked_deposit" ||
              String(row?.transaction_type || "").toLowerCase() === "deposit_locked") &&
            String(row?.status || "locked") === "locked",
        )
        .reduce((sum, row) => sum + Number(row?.amount || 0), 0);

      setWalletRows(rows);
      setWalletSummary({ depositPaid, lockedDeposit });
      setWalletLoading(false);
    };

    loadWallet();

    return () => {
      isMounted = false;
    };
  }, [profile.id]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    // enforce digits & max length on phone field
    if (name === "phone") {
      if (value && !/^\d*$/.test(value)) return;
      if (value.length > 10) return;
      setPhoneError(value && !phoneRegex.test(value) ? "Phone must be 10 digits." : "");
      setOtpSent(false);
      setOtpInput("");
    }
    const nextProfile = {
      ...profile,
      [name]: value,
      ...(name === "phone" ? { phoneVerified: false, phoneVerifiedAt: null } : {}),
    };
    setProfile(nextProfile);
    queueProfileSync(nextProfile);

    if (name === "phone") {
      void supabase.auth.updateUser({
        data: { phone_verified: false, phone_verified_at: null },
      });
    }
  };

  const handleSendPhoneOtp = () => {
    (async () => {
      const normalizedPhone = String(profile.phone || "").replace(/\D/g, "");
      if (!phoneRegex.test(normalizedPhone)) {
        setPhoneError("Phone must be 10 digits.");
        return;
      }

      const userId = await getAuthenticatedUserId();
      if (!userId) {
        alert("Please log in again before phone verification.");
        return;
      }

      const phoneE164 = toE164Phone(normalizedPhone);
      if (!phoneE164) {
        alert("Invalid phone number format.");
        return;
      }

      try {
        setIsSendingOtp(true);
        await postWithFallback("/api/phone/send-otp", {
          user_id: userId,
          phone: phoneE164,
        });
        setOtpSent(true);
        setOtpInput("");
        setSaveStatus("OTP sent. Enter the code to verify your phone.");
      } catch (error) {
        alert(error?.message || "Failed to send OTP.");
      } finally {
        setIsSendingOtp(false);
      }
    })();
  };

  const handleVerifyPhoneOtp = () => {
    (async () => {
      if (!otpSent) {
        alert("Send OTP first.");
        return;
      }

      if (!otpInput.trim()) {
        alert("Enter the OTP.");
        return;
      }

      const userId = await getAuthenticatedUserId();
      if (!userId) {
        alert("Please log in again before phone verification.");
        return;
      }

      const phoneE164 = toE164Phone(profile.phone);
      if (!phoneE164) {
        alert("Invalid phone number format.");
        return;
      }

      try {
        setIsVerifyingOtp(true);
        await postWithFallback("/api/phone/verify-otp", {
          user_id: userId,
          phone: phoneE164,
          otp: otpInput.trim(),
        });

        const verifiedAt = new Date().toISOString();
        const nextProfile = {
          ...profile,
          phoneVerified: true,
          phoneVerifiedAt: verifiedAt,
        };

        setProfile(nextProfile);
        setOtpInput("");
        setOtpSent(false);

        try {
          await supabase.auth.updateUser({
            data: { phone_verified: true, phone_verified_at: verifiedAt },
          });
        } catch {
          // Keep going: the profile table sync is the primary persistence path.
        }

        try {
          await syncProfileToDatabase(nextProfile, { includeVerification: true });
          persistProfileLocally(nextProfile);
          setSaveStatus("Phone number verified.");
        } catch (error) {
          const message = error?.message || "DB sync failed";
          setSaveStatus(`Phone verified locally, but DB sync failed (${message})`);
        }
      } catch (error) {
        alert(error?.message || "Invalid OTP.");
      } finally {
        setIsVerifyingOtp(false);
      }
    })();
  };

  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setSaveStatus("Image upload failed: select a valid image file.");
      return;
    }

    const authenticatedUserId = await getAuthenticatedUserId();
    if (!authenticatedUserId) {
      setSaveStatus("Image upload failed: no authenticated session found.");
      return;
    }

    setIsUploadingAvatar(true);
    setSaveStatus("Uploading image...");

    try {
      const previousAvatarUrl = profile.avatar || "";
      const publicUrl = await uploadProfileImage(file, authenticatedUserId);
      if (!publicUrl) {
        throw new Error("No public URL returned from storage.");
      }

      const nextProfile = { ...profile, avatar: publicUrl };
      setProfile(nextProfile);
      persistProfileLocally(nextProfile);
      await syncProfileToDatabase(nextProfile);

      if (previousAvatarUrl && previousAvatarUrl !== publicUrl) {
        try {
          await deleteProfileImageByUrl(previousAvatarUrl);
        } catch {
          // Keep the new avatar even if cleanup of the previous file fails.
        }
      }

      setSaveStatus("Saved");

      e.target.value = "";
    } catch (error) {
      const message = error?.message || "Upload failed";
      setSaveStatus(`Image upload failed: ${message}`);
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleSave = () => {
    if (profile.phone && !phoneRegex.test(profile.phone)) {
      alert("Phone number must be exactly 10 digits.");
      return;
    }
    persistProfileLocally(profile);
    setOriginalEmail(profile.email || "");

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    (async () => {
      try {
        setSaveStatus("Saving...");
        await syncProfileToDatabase(profile);
        setSaveStatus("Saved");
      } catch (error) {
        const message = error?.message || "DB sync failed";
        setSaveStatus(`Saved locally (${message})`);
      }
    })();

    setEditMode(false);
  };

  return (
    <div className="profile-container">
      <h1>My Profile</h1>

      <div className="profile-card">
        <div className="left-card">
          <div className="profile-avatar">
            {profile.avatar ? (
              <img className="profile-avatar-img" src={profile.avatar} alt="profile" />
            ) : (
              <span>{profile.name?.[0]?.toUpperCase() || "U"}</span>
            )}
          </div>

          <h3>{profile.name || "User"}</h3>
          <p className={sellerVerified ? "profile-role verified" : "profile-role"}>{profileRoleLabel}</p>
        </div>

        <div className="right-card">
          {saveStatus && <p className="subtitle">{saveStatus}</p>}
          {!editMode ? (
            <>
              <div className="header">
                <h2>Profile Details</h2>
                <button onClick={() => setEditMode(true)}>Edit Profile</button>
              </div>

              <div className="details">
                <p><b>Full Name</b><br />{profile.name || "-"}</p>
                <p><b>Email</b><br />{profile.email || "-"}</p>
                <p><b>Phone</b><br />{profile.phone || "-"}</p>
                <p><b>Phone Verification</b><br />{profile.phoneVerified ? "Verified" : "Not Verified"}</p>
                <p><b>Target Exam</b><br />{profile.exam || "-"}</p>
                <p><b>Stage</b><br />{profile.stage || "-"}</p>
              </div>
            </>
          ) : (
            <>
              <h2>Edit Profile</h2>

              <label>Profile Picture</label>
              <input type="file" accept="image/*" onChange={handleImageChange} disabled={isUploadingAvatar} />

              <label>Full Name</label>
              <input name="name" value={profile.name} onChange={handleChange} />

              <label>Email</label>
              <input name="email" value={profile.email} onChange={handleChange} />

              <label>Phone</label>
              <input
                name="phone"
                value={profile.phone}
                onChange={handleChange}
                placeholder="10-digit number"
                maxLength={10}
              />
              {phoneError && <p className="error">{phoneError}</p>}

              <label>Phone Verification</label>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: profile.phoneVerified ? "#16a34a" : "#b45309" }}>
                  {profile.phoneVerified ? "Verified" : "Not Verified"}
                </span>
                <button type="button" onClick={handleSendPhoneOtp} disabled={!phoneRegex.test(String(profile.phone || ""))}>
                  {isSendingOtp ? "Sending..." : "Send OTP"}
                </button>
              </div>
              {!profile.phoneVerified && (
                <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                  <input
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="Enter 6-digit OTP"
                    inputMode="numeric"
                    maxLength={6}
                    style={{ maxWidth: "180px" }}
                  />
                  <button type="button" onClick={handleVerifyPhoneOtp} disabled={!otpSent || isVerifyingOtp}>
                    {isVerifyingOtp ? "Verifying..." : "Verify Phone"}
                  </button>
                </div>
              )}

              <label>Target Exam</label>
              <select name="exam" value={profile.exam} onChange={handleChange}>
                <option value="">Select</option>
                <option value="jee">JEE</option>
                <option value="neet">NEET</option>
                 <option value="upsc">UPSC</option>
                <option value="gate">GATE</option>
              </select>

              <label>Stage</label>
              <select name="stage" value={profile.stage} onChange={handleChange}>
                <option value="">Select</option>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>

              <div className="btn-group">
                <button className="save" onClick={handleSave}>Save</button>
                <button className="cancel" onClick={() => setEditMode(false)}>Cancel</button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="wallet-section">
        <div className="wallet-metrics-panel">
          <div className="wallet-metric-tile">
            <p className="wallet-metric-label">Deposit Paid</p>
            <p className="wallet-metric-value">{formatCurrency(walletSummary.depositPaid)}</p>
            <p className="wallet-metric-help">Buyer deposit paid during rentals</p>
          </div>

          <div className="wallet-metric-tile">
            <p className="wallet-metric-label">Locked Deposit</p>
            <p className="wallet-metric-value">{formatCurrency(walletSummary.lockedDeposit)}</p>
            <p className="wallet-metric-help">Seller deposit locked until rental ends</p>
          </div>
        </div>

        <div className="wallet-history-panel">
          <div className="wallet-history-head">
            <h3>Transaction History</h3>
          </div>

          <div className="wallet-history-list">
            {walletLoading && <p className="wallet-history-empty">Loading transactions...</p>}

            {!walletLoading && walletError && <p className="wallet-history-empty">{walletError}</p>}

            {!walletLoading && !walletError && walletRows.length === 0 && (
              <p className="wallet-history-empty">No transactions yet.</p>
            )}

            {!walletLoading && !walletError && walletRows.map((row) => (
              <div key={row.id} className="wallet-history-item">
                <div>
                  <p className="wallet-history-type">{String(row.transaction_type || "-").replace(/_/g, " ")}</p>
                  <p className="wallet-history-meta">{formatDateTime(row.created_at)}</p>
                  {row.note ? <p className="wallet-history-note">{row.note}</p> : null}
                </div>
                <div className="wallet-history-right">
                  <p className="wallet-history-amount">{formatCurrency(row.amount)}</p>
                  <p className="wallet-history-status">{row.status || "-"}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Profile;

