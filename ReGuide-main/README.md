# ReGuide - Guide Selling and Rental Marketplace

ReGuide is a full-stack marketplace for buying, selling, and renting study guides. It combines a React frontend, a Flask backend, and Supabase for authentication and database storage.

## Live Demo

- Frontend: https://reguide.vercel.app
- Backend: your Render service URL

## Features

### User Features

- Supabase authentication
- Profile management
- Browse and search guides
- Buy or rent guides
- Rental deposit flow
- Phone verification with OTP

### Marketplace

- Create guide listings
- Upload guide images
- Buy and rent pricing flows
- Contact seller support

### Payments and Support

- Razorpay payment integration
- Payment verification on the backend
- Email-based support requests

### Admin Panel

- Guide moderation
- User management
- Rental monitoring
- Admin support inbox

## Tech Stack

### Frontend

- React 18
- Vite
- React Router
- Supabase JS client

### Backend

- Flask
- Gunicorn
- Requests
- Razorpay SDK

### Database and Auth

- Supabase Postgres
- Supabase Auth

### Deployment

- Vercel for frontend
- Render for backend

## Project Structure

```text
ReGuide-main/
├── README.md
└── reguidemarketplace/
	├── backend/
	│   ├── app.py
	│   ├── requirements.txt
	│   └── .env.example
	└── reguide/
		├── index.html
		├── package.json
		├── vercel.json
		└── src/
			├── App.jsx
			├── main.jsx
			├── supabaseClient.js
			├── components/
			├── pages/
			├── services/
			├── constants/
			├── database/
			└── util/
```

## Environment Variables

### Frontend (.env)

Set these in Vercel and locally if needed:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-or-publishable-key
VITE_BACKEND_URL=https://your-render-backend.onrender.com
```

### Backend (.env)

Set these in Render and locally if needed:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

RAZORPAY_KEY_ID=your-razorpay-key-id
RAZORPAY_KEY_SECRET=your-razorpay-key-secret

TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_PHONE_NUMBER=your-twilio-phone-number
TWILIO_VERIFY_SERVICE_SID=your-twilio-verify-service-sid

SMTP_USER=your-email@example.com
SMTP_PASSWORD=your-email-app-password
SUPPORT_TO_EMAIL=support@example.com

FRONTEND_ORIGIN=https://reguide.vercel.app
PORT=5000
```

Do not commit real secrets to GitHub.

## Run Locally

### 1. Clone the repo

```bash
git clone https://github.com/jerinjoji00/reguide.git
cd ReGuide-main/reguidemarketplace
```

### 2. Backend

```bash
cd backend
pip install -r requirements.txt
python app.py
```

The backend runs on `http://localhost:5000` by default.

### 3. Frontend

Open a new terminal:

```bash
cd reguide
npm install
npm run dev
```

The frontend runs on `http://localhost:5173` by default.

## Deploy to Vercel

1. Import the GitHub repository into Vercel.
2. Set the root directory to `reguidemarketplace/reguide`.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Add these environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_BACKEND_URL`
6. Keep `vercel.json` so React Router routes work on refresh.
7. Redeploy.

## Deploy to Render

1. Create a new Web Service on Render.
2. Connect the same GitHub repo.
3. Set the root directory to `reguidemarketplace/backend`.
4. Build command: `pip install -r requirements.txt`.
5. Start command: `gunicorn app:app --bind 0.0.0.0:$PORT`.
6. Add all backend environment variables.
7. Deploy and copy the live backend URL into `VITE_BACKEND_URL` in Vercel.

## Important Notes

- Supabase can be used directly from the frontend for auth and database access.
- The Flask backend is required for payment verification and other server-side API flows.
- Free Supabase projects may pause after inactivity.
- Free Render web services can also sleep when unused.

## Troubleshooting

- If login shows `Failed to fetch`, check `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and Supabase Auth URL settings.
- If backend requests fail, confirm the Render service is running and `VITE_BACKEND_URL` points to the live service.
- If React routes show 404 on refresh, make sure `vercel.json` is deployed.

## Security

- Never expose the Supabase service role key in the frontend.
- Use only the Supabase anon/publishable key in `VITE_SUPABASE_ANON_KEY`.
- Keep secrets in Vercel and Render environment variables, not in Git.

