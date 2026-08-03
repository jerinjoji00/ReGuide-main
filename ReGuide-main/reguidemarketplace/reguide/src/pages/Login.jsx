import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";

import { supabase } from "../supabaseClient";
import { isAdminProfile } from "../services/userService";

import ReGuideLogo from "./reguide-logo.jsx";
import "./Login.css";

function Login() {

  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!password) {
      setError("Please enter your password");
      return;
    }

    const { data, error: authError } =
      await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      if (String(authError.message || "").toLowerCase().includes("email not confirmed")) {
        setError("Please confirm your email before logging in.");
        return;
      }

      setError(authError.message || "Invalid email or password");
      return;
    }

    // Fetch profile from Supabase
    const { data: profile, error: profileError } =
      await supabase
        .from("profiles")
        .select("*")
        .eq("id", data.user.id)
        .maybeSingle();

    let finalProfile = profile;

    if (profileError) {
      console.warn("Profile fetch failed. Falling back to auth metadata.", profileError);
    }

    if (!finalProfile) {
      const meta = data.user.user_metadata || {};
      finalProfile = {
        id:          data.user.id,
        email:       data.user.email || email,
        full_name:   meta.full_name || "",
        target_exam: meta.target_exam || "",
        prep_stage:  meta.prep_stage || "",
        role:        meta.role || "user",
      };

      // Best-effort sync to profiles table
      const { error: upsertError } = await supabase
        .from("profiles")
        .upsert(
          {
            id:          finalProfile.id,
            email:       finalProfile.email,
            full_name:   finalProfile.full_name,
            target_exam: finalProfile.target_exam,
            prep_stage:  finalProfile.prep_stage,
            role:        finalProfile.role,
          },
          { onConflict: "id" }
        );

      if (upsertError) {
        console.warn("Profile upsert skipped.", upsertError);
      }
    }

    const shouldBeAdmin = isAdminProfile(finalProfile);
    if (shouldBeAdmin && finalProfile.role !== "admin") {
      finalProfile = { ...finalProfile, role: "admin" };

      // Ensure database role aligns with app admin detection so RLS policies work.
      const { error: roleSyncError } = await supabase
        .from("profiles")
        .upsert(
          {
            id: finalProfile.id,
            email: finalProfile.email,
            full_name: finalProfile.full_name || "",
            target_exam: finalProfile.target_exam || "",
            prep_stage: finalProfile.prep_stage || "",
            role: "admin",
          },
          { onConflict: "id" }
        );

      if (roleSyncError) {
        console.warn("Admin role sync failed.", roleSyncError);
      }
    }

    // ✅ Save full profile to localStorage — needed for relevance score
    localStorage.setItem("reguideUser", JSON.stringify({
      id:          finalProfile.id,
      email:       finalProfile.email,
      full_name:   finalProfile.full_name || finalProfile.name || "",
      target_exam: finalProfile.target_exam || finalProfile.exam || "",
      prep_stage:  finalProfile.prep_stage || finalProfile.stage || "",
      role:        finalProfile.role || "user",
    }));

    navigate(shouldBeAdmin ? "/admin-dashboard" : "/dashboard");
  }

  return (
    <div className="page">
      <div className="auth-logo-watermark auth-logo-watermark-left" aria-hidden="true">
        <img src="/reguide-logo.svg" alt="" />
      </div>
      <div className="auth-logo-watermark auth-logo-watermark-right" aria-hidden="true">
        <img src="/reguide-logo.svg" alt="" />
      </div>
      <div className="login-box">
        <div className="logo-wrapper">
          <ReGuideLogo size="lg" />
          <h1>ReGuide</h1>
        </div>
        <p className="subtitle1">Guide Selling Marketplace</p>

        <h2>Sign In</h2>
        <p className="subtitle">
          Enter your credentials to access your account
        </p>

        {error && <p className="error">{error}</p>}

        <form onSubmit={handleSubmit}>
          <label>Email Address</label>
          <input
            type="email"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label>Password</label>
          <div className="password-box">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <span
              className="eye"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </span>
          </div>

          <div className="forgot">
            <Link to="/forgot-password">Forgot password?</Link>
          </div>

          <button type="submit">Sign In</button>
        </form>

        <div className="or">OR</div>

        <p className="register-text">
          Don't have an account?
          <Link to="/register"> Create new account</Link>
        </p>
      </div>
    </div>
  );
}

export default Login;