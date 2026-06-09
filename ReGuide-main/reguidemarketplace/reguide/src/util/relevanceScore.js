// utils/relevanceScore.js
// Fields from Browse.jsx:   guide.examType, guide.year, guide.status, guide.rating, guide.reviews, guide.difficulty_level
// Fields from Register.jsx: user.target_exam, user.prep_stage

const CONDITION_SCORE = {
  "new":       10,
  "like new":   8,
  "good":       5,
  "fair":       2,
  "used":       3,
  "amended":    2,
};

/**
 * Compute a 0–100 relevance score for a guide against a user profile.
 *
 * @param {object} user  - { target_exam, prep_stage }
 * @param {object} guide - { examType, year, status, rating, reviews, difficulty_level }
 * @returns {number} score 0–100
 */
export function calculateRelevanceScore(user, guide) {
  let score = 0;

  // ── 1. Exam match — 50 pts ───────────────────────────────────────────────
  // Most critical factor. Full 50 pts only if exam matches exactly.
  const userExam  = String(user?.target_exam || "").trim().toUpperCase();
  const guideExam = String(guide?.examType || guide?.subject || "").trim().toUpperCase();

  if (userExam && guideExam && userExam === guideExam) {
    score += 50;
  }

  // ── 2. Prep stage vs guide difficulty level — up to 25 pts ──────────────
  // Now we directly compare user's prep stage against the guide's
  // difficulty level set by the seller.
  //
  // Exact match       → 25 pts
  // 1 stage apart     → 12 pts
  // 2 stages apart    → 5 pts
  // 3+ stages apart   → 0 pts
  // Only one side set → 5 pts (partial credit)

  const prepStage       = String(user?.prep_stage        || "").trim().toLowerCase();
  const guideDifficulty = String(
    guide?.difficulty_level || guide?.difficultyLevel || ""
  ).trim().toLowerCase();

  const STAGES = ["beginner", "intermediate", "advanced", "revision", "mock test phase"];

  if (prepStage && guideDifficulty) {
    if (prepStage === guideDifficulty) {
      score += 25;  // perfect match
    } else {
      const userIdx  = STAGES.indexOf(prepStage);
      const guideIdx = STAGES.indexOf(guideDifficulty);

      if (userIdx !== -1 && guideIdx !== -1) {
        const gap = Math.abs(userIdx - guideIdx);
        if      (gap === 1) score += 12;
        else if (gap === 2) score += 5;
        // gap >= 3 → 0 pts
      }
    }
  } else if (prepStage || guideDifficulty) {
    // only one side has data
    score += 5;
  }

  // ── 3. Recency (year of publish) — up to 10 pts ──────────────────────────
  // Reduced from 15 to 10 since difficulty level now carries more weight.
  const currentYear = new Date().getFullYear();
  const publishYear = parseInt(guide?.year, 10) || 0;

  if (publishYear) {
    const age = currentYear - publishYear;
    if      (age <= 1)  score += 10;
    else if (age <= 3)  score += 8;
    else if (age <= 5)  score += 5;
    else if (age <= 10) score += 3;
    else                score += 1;
  }

  // ── 4. Condition — up to 10 pts ──────────────────────────────────────────
  // guide.status is the condition field in Browse.jsx
  // (New, Like New, Good, Fair, Used, Amended)
  const condition = String(guide?.status || guide?.condition || "").trim().toLowerCase();
  score += CONDITION_SCORE[condition] ?? 0;

  // ── 5. Review rating — multiplier ±10% ───────────────────────────────────
  // Only applied if the guide actually has reviews.
  // Neutral at 3.0 → no change. 5.0 → +10%. 1.0 → −10%.
  const rating     = parseFloat(guide?.rating || guide?.avg_rating || 0);
  const hasReviews = parseInt(guide?.reviews || guide?.review_count || 0) > 0;

  if (hasReviews && rating > 0) {
    const multiplier = 1 + ((rating - 3.0) / 2.0) * 0.10;
    score = score * multiplier;
  }

  // ── Cap 0–100, round to 1 decimal ────────────────────────────────────────
  return Math.round(Math.min(Math.max(score, 0), 100) * 10) / 10;
}