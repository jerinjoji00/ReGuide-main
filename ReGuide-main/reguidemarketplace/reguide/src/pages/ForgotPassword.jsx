import { useState } from "react";
import { supabase } from "../supabaseClient";
import "./Login.css"; // reuse existing styles

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setMessage("");

  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
  redirectTo: 'http://localhost:5174/update-password'
  });
    setMessage("If that address is registered, a reset link has been sent.");
  }

  return (
    <div className="page">
      <div className="login-box">
        <h2>Forgot Password</h2>
        <p>Enter the email associated with your account</p>

        {error && <p className="error">{error}</p>}
        {message && <p className="success">{message}</p>}

        <form onSubmit={handleSubmit}>
          <label>Email Address</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <button type="submit">Send reset link</button>
        </form>
      </div>
    </div>
  );
}

export default ForgotPassword;