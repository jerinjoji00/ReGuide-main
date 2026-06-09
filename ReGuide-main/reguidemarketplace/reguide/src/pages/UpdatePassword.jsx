import { useState } from "react";
import { supabase } from "../supabaseClient";
import { useNavigate } from "react-router-dom";
import "./Login.css";

function UpdatePassword() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setMessage("");

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError("Failed to update password. Try requesting a new link.");
    } else {
      setMessage("Password updated successfully!");
      setTimeout(() => navigate("/login"), 2000);
    }
  }

  return (
    <div className="page">
      <div className="login-box">
        <h2>Set New Password</h2>
        <p>Enter your new password below</p>

        {error && <p className="error">{error}</p>}
        {message && <p className="success">{message}</p>}

        <form onSubmit={handleSubmit}>
          <label>New Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit">Update Password</button>
        </form>
      </div>
    </div>
  );
}

export default UpdatePassword;
