import { useState } from "react";
import "./Contactsupport.css";
import { Mail } from "lucide-react";
import { supabase } from "../supabaseClient";

const supportEmail = "reguidemarketplace@gmail.com";

function ContactSupport() {
  const [submitted, setSubmitted] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [ticketId, setTicketId] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  let user = {};
  try {
    user = JSON.parse(localStorage.getItem("reguideUser") || "{}");
  } catch {
    user = {};
  }

  const senderName = user.name || user.full_name || "";
  const senderEmail = user.email || "";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!subject.trim() || !message.trim()) {
      setError("Please enter both subject and message.");
      return;
    }

    try {
      setIsSending(true);
      setTicketId("");

      // ✅ INSERT ONLY (NO .select())
      const { error: insertError } = await supabase
        .from("support_messages")
        .insert([
          {
            name: senderName || null,
            email: senderEmail || null,
            subject: subject.trim(),
            message: message.trim(),
            status: "open",
            is_read: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]);

      if (insertError) throw insertError;

      // ✅ Generate simple ticket ID (since we removed select)
      const fakeId = "TKT-" + Date.now();
      setTicketId(fakeId);

      setSubmitted(true);
      setSubject("");
      setMessage("");

      setTimeout(() => {
        setSubmitted(false);
        setTicketId("");
      }, 5000);

    } catch (submitError) {
      setError(
        submitError?.message || "Could not send message right now. Please try again."
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="support-page">
      <h1>Contact Support</h1>
      <p>We're here to help. Reach out to our support team with any questions or issues.</p>

      <div className="support-grid">
        {/* LEFT CARD */}
        <div className="support-left">
          <h3>Get in Touch</h3>

          <p><b>Email Support</b></p>
          <p className="email">
            <Mail size={18} />
            <a href={`mailto:${supportEmail}`} className="blue-email">
              {supportEmail}
            </a>
          </p>

          <p className="label">Response Time</p>
          <p>We typically respond within 24–48 hours.</p>

          <p className="label">Support Hours</p>
          <p>Monday – Friday, 9:00 AM – 6:00 PM IST</p>
        </div>

        {/* RIGHT CARD */}
        <div className="support-right">
          {!submitted ? (
            <form onSubmit={handleSubmit}>
              <h3>Send us a Message</h3>

              {error && <p className="error-message">{error}</p>}

              <label>Subject</label>
              <input
                placeholder="How can we help you?"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
                disabled={isSending}
              />

              <label>Message</label>
              <textarea
                rows="5"
                placeholder="Please describe your issue..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                disabled={isSending}
              ></textarea>

              <button type="submit" disabled={isSending}>
                {isSending ? "Sending..." : "Send Message"}
              </button>

              <p className="email">
                Or email us directly at{" "}
                <a href={`mailto:${supportEmail}`} className="blue-email">
                  {supportEmail}
                </a>
              </p>
            </form>
          ) : (
            <div className="success-box">
              <div className="icon">📩</div>
              <h2>Thank You!</h2>
              <p>Your message has been received.</p>

              {ticketId && (
                <p>
                  Ticket ID: <b>{ticketId}</b>
                </p>
              )}

              <span>Expected response time: 24–48 hours</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ContactSupport;
