import { Link } from "react-router-dom";
import { ArrowRight, ShieldCheck, Sparkles, Users } from "lucide-react";

import ReGuideLogo from "./reguide-logo.jsx";
import "./LandingPage.css";

function LandingPage() {
  return (
    <main className="landing-page">
      <div className="landing-bg landing-bg-one" />
      <div className="landing-bg landing-bg-two" />

      <section className="landing-card">
        <div className="hero-copy">
          <div className="hero-badge">
            <Sparkles size={14} />
            <span>Trusted guide marketplace</span>
          </div>

          <div className="hero-logo-wrap" aria-label="ReGuide logo">
            <ReGuideLogo size="lg" />
          </div>

          <h1>ReGuide</h1>
          <p className="hero-subtitle">
            A simple place to discover, sell, and manage quality guides in one
            clean marketplace.
          </p>

          <p className="hero-note">
            Find the right guide faster, or sign in to continue where you left
            off.
          </p>

          <div className="hero-actions">
            <Link to="/login" className="primary-action">
              Login to continue
              <ArrowRight size={18} />
            </Link>
            <Link to="/register" className="secondary-action">
              Create account
            </Link>
          </div>

          <div className="hero-stats">
            <div className="stat-item">
              <Users size={16} />
              <span>Built for buyers and sellers</span>
            </div>
            <div className="stat-item">
              <ShieldCheck size={16} />
              <span>Secure sign-in and account flow</span>
            </div>
          </div>
        </div>

        <aside className="hero-panel">
          <div className="panel-image">
            <ReGuideLogo size="lg" />
          </div>
          <div className="panel-text">
            <span className="panel-kicker">Get started</span>
            <h2>Guide selling, simplified.</h2>
            <p>
              Explore the marketplace, manage your profile, and jump into your
              dashboard after login.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}

export default LandingPage;