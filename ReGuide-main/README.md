ReGuide — Guide Selling & Rental Marketplace.

ReGuide is a full-stack marketplace platform where users can buy, sell, and rent study guides with secure payments, deposits, and verification features.

Built with a modern web stack and deployed across cloud platforms, this project simulates a real-world production system.

---

Live Demo

- Frontend (Vercel): https://your-vercel-url.vercel.app
- Backend (Render): https://your-render-url.onrender.com

---

Features

👤 User Features

- User authentication (Supabase)
- Profile management
- Phone number verification (OTP via Twilio)
- Browse and search guides
- Buy or rent guides
- Deposit-based rental system

📚 Marketplace

- List guides for sale or rent
- Upload guide images (front/back/index)
- Pricing system (buy + rent)

💳 Payments

- Razorpay integration (test mode)
- Secure payment verification
- Rental deposit collection

💬 Communication

- Real-time chat between users
- Contact seller feature
- Support system (email-based)

🛠 Admin Panel

- Guide moderation (approve/reject)
- User management
- Rental monitoring

---

🏗 Tech Stack

Frontend

- React (Vite)
- Tailwind CSS
- Deployed on Vercel

Backend

- Flask (Python)
- Gunicorn (production server)
- Deployed on Render

Database & Auth

- Supabase (PostgreSQL + Auth)

External Services

- Razorpay (Payments)
- Twilio (SMS OTP)

---

⚙️ Project Structure

ReGuide/
├── reguidemarketplace/
│   ├── backend/
│   │   ├── app.py
│   │   ├── requirements.txt
│   │   └── .env.example
│   │
│   ├── reguide/   (frontend)
│   │   ├── src/
│   │   ├── index.html
│   │   ├── package.json
│   │   └── vite.config.js
│   │
│   └── README.md

---

🔐 Environment Variables

Backend (.env)

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
TWILIO_VERIFY_SERVICE_SID=

FRONTEND_ORIGIN=

---

Frontend (.env)

VITE_BACKEND_URL=

---

🚀 Running Locally

1. Clone repo

git clone https://github.com/your-username/ReGuide.git
cd ReGuide

---

2. Backend setup

cd reguidemarketplace/backend
pip install -r requirements.txt
python app.py

---

3. Frontend setup

cd ../reguide
npm install
npm run dev

---

☁️ Deployment

Frontend (Vercel)

- Root directory: "reguidemarketplace/reguide"
- Build command: "npm run build"
- Output directory: "dist"
- Set "VITE_BACKEND_URL"
- Keep the `vercel.json` rewrite so React Router routes work on refresh

Backend (Render)

- Root directory: "reguidemarketplace/backend"
- Build: "pip install -r requirements.txt"
- Start:

gunicorn app:app --bind 0.0.0.0:$PORT
