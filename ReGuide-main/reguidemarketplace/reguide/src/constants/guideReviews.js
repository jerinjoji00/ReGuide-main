// ✅ Fixed review data - same for all accounts
export const GUIDE_REVIEWS_MAP = {
  1: {
    rating: 4.8,
    reviews: 24,
    details: [
      { rating: 5, comment: "Excellent guide! Very comprehensive and well-structured.", reviewedBy: "Arjun K." },
      { rating: 5, comment: "Helped me score 95 in physics. Highly recommended!", reviewedBy: "Priya M." },
      { rating: 4, comment: "Good content but could use more practice problems.", reviewedBy: "Raj P." },
    ]
  },
  2: {
    rating: 4.5,
    reviews: 18,
    details: [
      { rating: 5, comment: "Clear explanations of organic chemistry concepts.", reviewedBy: "Maya S." },
      { rating: 4, comment: "Very useful, some chapters could be expanded.", reviewedBy: "Anil K." },
    ]
  },
  3: {
    rating: 4.3,
    reviews: 15,
    details: [
      { rating: 4, comment: "Good for JEE preparation.", reviewedBy: "Sita N." },
      { rating: 5, comment: "Strong mathematical approach!", reviewedBy: "Dev M." },
    ]
  },
  4: {
    rating: 4.9,
    reviews: 32,
    details: [
      { rating: 5, comment: "Best NCERT guide I've found. Perfect for NEET.", reviewedBy: "Rohit S." },
      { rating: 5, comment: "Comprehensive and accurate.", reviewedBy: "Nisha R." },
      { rating: 5, comment: "Worth every rupee!", reviewedBy: "Vikram T." },
    ]
  },
  5: {
    rating: 4.6,
    reviews: 21,
    details: [
      { rating: 5, comment: "Excellent for biology preparation.", reviewedBy: "Ananya K." },
      { rating: 4, comment: "Well organized", reviewedBy: "Kabir L." },
    ]
  },
  6: {
    rating: 4.7,
    reviews: 19,
    details: [
      { rating: 5, comment: "Best quantitative aptitude book!", reviewedBy: "Harsh M." },
      { rating: 4, comment: "Good but challenging.", reviewedBy: "Simran P." },
    ]
  },
  7: {
    rating: 4.4,
    reviews: 12,
    details: [
      { rating: 4, comment: "Solid GATE prep material.", reviewedBy: "Suresh K." },
      { rating: 5, comment: "Mathematics concepts well explained.", reviewedBy: "Neha D." },
    ]
  },
  8: {
    rating: 4.9,
    reviews: 28,
    details: [
      { rating: 5, comment: "Must-have for UPSC aspirants.", reviewedBy: "Deepak B." },
      { rating: 5, comment: "Laxmikanth is always reliable!", reviewedBy: "Anjali V." },
      { rating: 5, comment: "Perfectly annotated.", reviewedBy: "Mohan R." },
    ]
  }
};

export function getGuideReviewData(guideId) {
  return GUIDE_REVIEWS_MAP[guideId] || { rating: 0, reviews: 0, details: [] };
}
