import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, X } from "lucide-react";
import { supabase } from "../supabaseClient";
import ReGuideLogo from "./reguide-logo.jsx";
import "./Register.css";

// ✅ Terms Modal Component
function TermsModal({ onClose }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.5)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "18px",
          padding: "28px",
          maxWidth: "560px",
          width: "100%",
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 20px 60px rgba(15,23,42,0.15)",
          position: "relative",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: "16px",
            right: "16px",
            background: "#f1f5f9",
            border: "none",
            borderRadius: "50%",
            width: "32px",
            height: "32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <X size={16} />
        </button>

        <h2 style={{ margin: "0 0 4px", fontSize: "20px", color: "#0f172a" }}>
          Terms of Service & Privacy Policy
        </h2>
        <p style={{ margin: "0 0 20px", fontSize: "12px", color: "#64748b" }}>
          Last updated: March 2025
        </p>

        {/* Terms of Service */}
        <h3 style={{ fontSize: "15px", color: "#4338ca", margin: "0 0 8px" }}>
          📋 Terms of Service
        </h3>

        <p style={{ fontSize: "13px", color: "#374151", lineHeight: 1.6, margin: "0 0 10px" }}>
          Welcome to <strong>ReGuide</strong>. By creating an account, you agree to use this
          platform only for lawful purposes related to buying, selling, and renting study guides.
        </p>

        <ul style={{ fontSize: "13px", color: "#374151", lineHeight: 1.8, paddingLeft: "18px", margin: "0 0 16px" }}>
          <li>You must be at least 18 years old or have parental consent to use ReGuide.</li>
          <li>All guide listings must be accurate and not misleading.</li>
          <li>Sellers are responsible for the condition of guides they list.</li>
          <li>ReGuide reserves the right to remove listings that violate our policies.</li>
          <li>Rental deposits are refundable upon timely return of the guide in original condition.</li>
          <li>Any fraudulent activity will result in immediate account suspension.</li>
          <li>ReGuide acts as a marketplace and is not responsible for disputes between buyers and sellers.</li>
        </ul>

        {/* Privacy Policy */}
        <h3 style={{ fontSize: "15px", color: "#4338ca", margin: "0 0 8px" }}>
          🔒 Privacy & Security Policy
        </h3>

        <p style={{ fontSize: "13px", color: "#374151", lineHeight: 1.6, margin: "0 0 10px" }}>
          Your privacy is important to us. This section explains how ReGuide collects,
          uses, and protects your personal data.
        </p>

        <ul style={{ fontSize: "13px", color: "#374151", lineHeight: 1.8, paddingLeft: "18px", margin: "0 0 16px" }}>
          <li>We collect your name, email, and exam preferences to personalize your experience.</li>
          <li>Your password is encrypted and never stored in plain text.</li>
          <li>We do not sell or share your personal data with third parties.</li>
          <li>Guide photos are stored securely in our cloud storage.</li>
          <li>You may request deletion of your account and data at any time.</li>
          <li>We use cookies only for session management and authentication.</li>
          <li>All transactions are logged securely for dispute resolution purposes.</li>
        </ul>

        <h3 style={{ fontSize: "15px", color: "#4338ca", margin: "0 0 8px" }}>
          📦 Data We Store
        </h3>

        <ul style={{ fontSize: "13px", color: "#374151", lineHeight: 1.8, paddingLeft: "18px", margin: "0 0 20px" }}>
          <li>Account info: name, email, exam type, preparation stage.</li>
          <li>Listings: guide titles, descriptions, photos, pricing.</li>
          <li>Orders: rental and purchase history.</li>
          <li>Messages: chat conversations between buyers and sellers.</li>
        </ul>

        <button
          onClick={onClose}
          style={{
            width: "100%",
            padding: "11px",
            background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
            color: "#fff",
            border: "none",
            borderRadius: "10px",
            fontWeight: 700,
            fontSize: "14px",
            cursor: "pointer",
          }}
        >
          I Understand
        </button>
      </div>
    </div>
  );
}

function Register() {
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [targetExam, setTargetExam] = useState("");
  const [prepStage, setPrepStage] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [showTermsModal, setShowTermsModal] = useState(false); // ✅ modal state

  const nameRegex = /^[A-Za-z\s]+$/;
  const emailRegex =
    /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(com|ac\.in|edu\.ac\.in)$/;
  const passwordRegex =
    /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&]).{8,}$/;

  const validateField = (field, value) => {
    let message = "";
    if (field === "fullName" && value && !nameRegex.test(value))
      message = "Only letters allowed.";
    if (field === "email" && value && !emailRegex.test(value))
      message = "Invalid email format.";
    if (field === "password" && value && !passwordRegex.test(value))
      message = "Password must have 8 chars, letter, number & symbol";
    if (field === "confirmPassword" && value && value !== password)
      message = "Passwords do not match.";
    setErrors((prev) => ({ ...prev, [field]: message }));
  };

  const handleRegister = async () => {
    setMessage("");

    if (!fullName || !email || !password || !confirmPassword || !agreeTerms) {
      setMessage("Please fill all required fields.");
      return;
    }

    if (Object.values(errors).some((err) => err)) {
      setMessage("Please fix validation errors.");
      return;
    }

    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            target_exam: targetExam,
            prep_stage: prepStage,
          },
        },
      });

      if (error) throw error;

      if (data?.user?.id) {
        const { error: profileError } = await supabase
          .from("profiles")
          .upsert(
            {
              id: data.user.id,
              email,
              full_name: fullName,
              target_exam: targetExam,
              prep_stage: prepStage,
              role: "user",
            },
            { onConflict: "id" }
          );

        if (profileError) {
          console.warn("Profile creation skipped during register.", profileError);
        }
      }

      setMessage("Registration successful! Check your email.");
      navigate("/login");
    } catch (err) {
      console.error(err);
      setMessage(err.message);
    }
  };

  return (
    <div className="page">
      {/* ✅ Show modal when triggered */}
      {showTermsModal && (
        <TermsModal onClose={() => setShowTermsModal(false)} />
      )}

      <div className="auth-container">
        <div className="logo-wrapper">
          <Link to="/login">
            <ReGuideLogo size="lg" />
          </Link>
          <h1>ReGuide</h1>
        </div>

        <p className="subtitle1">Guide Selling Marketplace</p>

        <h2>Create Account</h2>
        {message && <p className="message-error">{message}</p>}

        <div className="input-group">
          <label>Full Name</label>
          <input
            type="text"
            placeholder="Enter your full name"
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              validateField("fullName", e.target.value);
            }}
          />
          {errors.fullName && <p className="error">{errors.fullName}</p>}
        </div>

        <div className="input-group">
          <label>Email Address</label>
          <input
            type="email"
            placeholder="Enter your email address"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              validateField("email", e.target.value);
            }}
          />
          {errors.email && <p className="error">{errors.email}</p>}
        </div>

        <div className="password-row">
          <div className="input-group">
            <label>Password</label>
            <div className="password-box">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Enter strong password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  validateField("password", e.target.value);
                }}
              />
              <span className="eye" onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </span>
            </div>
            {errors.password && <p className="error">{errors.password}</p>}
          </div>

          <div className="input-group">
            <label>Confirm Password</label>
            <div className="password-box">
              <input
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  validateField("confirmPassword", e.target.value);
                }}
              />
              <span
                className="eye"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </span>
            </div>
            {errors.confirmPassword && (
              <p className="error">{errors.confirmPassword}</p>
            )}
          </div>
        </div>

        <div className="input-group">
          <label>Target Exam</label>
          <select value={targetExam} onChange={(e) => setTargetExam(e.target.value)}>
            <option value="">Select Exam</option>
            <option value="NEET">NEET</option>
            <option value="JEE">JEE</option>
            <option value="CAT">CAT</option>
            <option value="GATE">GATE</option>
            <option value="UPSC">UPSC</option>
          </select>
        </div>

        <div className="input-group">
          <label>Preparation Stage</label>
          <select value={prepStage} onChange={(e) => setPrepStage(e.target.value)}>
            <option value="">Select Stage</option>
            <option value="Beginner">Beginner</option>
            <option value="Intermediate">Intermediate</option>
            <option value="Revision">Revision</option>
            <option value="Mock Test Phase">Mock Test Phase</option>
          </select>
        </div>

        <div className="terms">
          <input
            type="checkbox"
            checked={agreeTerms}
            onChange={(e) => setAgreeTerms(e.target.checked)}
          />
          <span>
            I agree to the{" "}
            {/* ✅ clicking opens the modal */}
            <strong
              style={{ color: "#4338ca", cursor: "pointer", textDecoration: "underline" }}
              onClick={() => setShowTermsModal(true)}
            >
              Terms of Service
            </strong>{" "}
            and{" "}
            <strong
              style={{ color: "#4338ca", cursor: "pointer", textDecoration: "underline" }}
              onClick={() => setShowTermsModal(true)}
            >
              Privacy Policy
            </strong>
          </span>
        </div>

        <button onClick={handleRegister}>Create Account</button>

        <p>
          Already have an account?
          <Link to="/login"> Sign in</Link>
        </p>
      </div>
    </div>
  );
}

export default Register;