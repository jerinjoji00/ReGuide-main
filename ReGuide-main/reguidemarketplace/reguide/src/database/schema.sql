-- Conversations table to store chat conversations between users
CREATE TABLE IF NOT EXISTS conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user1_id UUID NOT NULL,
  user2_id UUID NOT NULL,
  guide_id BIGINT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT fk_user1 FOREIGN KEY (user1_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user2 FOREIGN KEY (user2_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  UNIQUE(user1_id, user2_id)
);

-- Messages table to store individual messages
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL,
  sender_id UUID NOT NULL,
  content TEXT NOT NULL,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT fk_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_sender FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_conversations_user1 ON conversations(user1_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user2 ON conversations(user2_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- Enable Row Level Security
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- RLS Policy for conversations - users can only see their own conversations
CREATE POLICY "Users can view their conversations" 
ON conversations FOR SELECT
USING (auth.uid() = user1_id OR auth.uid() = user2_id);

CREATE POLICY "Users can create conversations"
ON conversations FOR INSERT
WITH CHECK (auth.uid() = user1_id OR auth.uid() = user2_id);

CREATE POLICY "Users can update their conversations"
ON conversations FOR UPDATE
USING (auth.uid() = user1_id OR auth.uid() = user2_id);

-- RLS Policy for messages - users can only see messages from their conversations
CREATE POLICY "Users can view messages from their conversations"
ON messages FOR SELECT
USING (
  conversation_id IN (
    SELECT id FROM conversations 
    WHERE auth.uid() = user1_id OR auth.uid() = user2_id
  )
);

CREATE POLICY "Users can insert messages in their conversations"
ON messages FOR INSERT
WITH CHECK (
  sender_id = auth.uid() AND
  conversation_id IN (
    SELECT id FROM conversations 
    WHERE auth.uid() = user1_id OR auth.uid() = user2_id
  )
);

CREATE POLICY "Users can update messages in their conversations"
ON messages FOR UPDATE
USING (
  conversation_id IN (
    SELECT id FROM conversations
    WHERE auth.uid() = user1_id OR auth.uid() = user2_id
  )
)
WITH CHECK (
  conversation_id IN (
    SELECT id FROM conversations
    WHERE auth.uid() = user1_id OR auth.uid() = user2_id
  )
);

-- Notifications table for user activity updates
CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  recipient_email TEXT,
  actor_id UUID,
  actor_name TEXT,
  type TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notification_actor FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_email ON notifications(recipient_email);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their notifications"
ON notifications FOR SELECT
USING (
  auth.uid() = user_id OR lower(coalesce(auth.jwt() ->> 'email', '')) = lower(coalesce(recipient_email, ''))
);

CREATE POLICY "Authenticated users can create notifications"
ON notifications FOR INSERT
WITH CHECK (
  true
);

CREATE POLICY "Users can update their notifications"
ON notifications FOR UPDATE
USING (
  auth.uid() = user_id OR lower(coalesce(auth.jwt() ->> 'email', '')) = lower(coalesce(recipient_email, ''))
);

-- Guides table to store marketplace listings
CREATE TABLE IF NOT EXISTS guides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  seller_name TEXT,
  title TEXT NOT NULL,
  author TEXT,
  subject TEXT NOT NULL,
  description TEXT,
  pages INTEGER,
  condition TEXT DEFAULT 'New',
  edition TEXT,
  year INTEGER,
  difficulty_level TEXT,
  rental_price NUMERIC,
  purchase_price NUMERIC,
  photo_url TEXT,
  front_cover_url TEXT,
  back_cover_url TEXT,
  index_page_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE guides ADD COLUMN IF NOT EXISTS author TEXT;
ALTER TABLE guides ADD COLUMN IF NOT EXISTS difficulty_level TEXT;
ALTER TABLE guides ADD COLUMN IF NOT EXISTS front_cover_url TEXT;
ALTER TABLE guides ADD COLUMN IF NOT EXISTS back_cover_url TEXT;
ALTER TABLE guides ADD COLUMN IF NOT EXISTS index_page_url TEXT;

CREATE INDEX IF NOT EXISTS idx_guides_created_at ON guides(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guides_subject ON guides(subject);
CREATE INDEX IF NOT EXISTS idx_guides_seller_id ON guides(seller_id);

ALTER TABLE guides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view guides"
ON guides FOR SELECT
USING (true);

CREATE POLICY "Anyone can create guides"
ON guides FOR INSERT
WITH CHECK (true);

CREATE POLICY "Users can update their own guides"
ON guides FOR UPDATE
USING (auth.uid() = seller_id);

-- Orders table for purchase and rental records
CREATE TABLE IF NOT EXISTS orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_key TEXT,
  guide_id UUID,
  guide_title TEXT NOT NULL DEFAULT '',
  buyer_id UUID,
  buyer_email TEXT,
  buyer_name TEXT,
  seller_id UUID,
  seller_name TEXT,
  order_type TEXT NOT NULL DEFAULT 'buy',
  amount NUMERIC DEFAULT 0,
  deposit NUMERIC DEFAULT 0,
  duration_months INTEGER,
  end_date DATE,
  purchase_date DATE,
  payment_id TEXT,
  payment_status TEXT,
  razorpay_order_id TEXT,
  razorpay_signature TEXT,
  returned BOOLEAN NOT NULL DEFAULT FALSE,
  returned_at DATE,
  review JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT fk_orders_buyer FOREIGN KEY (buyer_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT fk_orders_seller FOREIGN KEY (seller_id) REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_signature TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_buyer_id ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_email ON orders(buyer_email);
CREATE INDEX IF NOT EXISTS idx_orders_seller_id ON orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_guide_id ON orders(guide_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_type ON orders(order_type);
CREATE INDEX IF NOT EXISTS idx_orders_payment_id ON orders(payment_id);
CREATE INDEX IF NOT EXISTS idx_orders_razorpay_order_id ON orders(razorpay_order_id);

-- Rentals table to store rental-specific lifecycle data
CREATE TABLE IF NOT EXISTS rentals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  guide_id UUID REFERENCES guides(id) ON DELETE SET NULL,
  amount NUMERIC DEFAULT 0,
  deposit NUMERIC DEFAULT 0,
  duration_months INTEGER,
  start_date DATE,
  end_date DATE,
  refund_status TEXT DEFAULT 'pending',
  refund_amount NUMERIC DEFAULT 0,
  refunded_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rentals_order_id ON rentals(order_id);
CREATE INDEX IF NOT EXISTS idx_rentals_user_id ON rentals(user_id);
CREATE INDEX IF NOT EXISTS idx_rentals_guide_id ON rentals(guide_id);

ALTER TABLE rentals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their rentals"
ON rentals FOR SELECT
USING (
  auth.uid() = user_id
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "Authenticated users can create rentals"
ON rentals FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Users and admins can update rentals"
ON rentals FOR UPDATE
USING (
  auth.uid() = user_id
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Profiles table to store user metadata
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE,
  full_name TEXT,
  role TEXT DEFAULT 'user',
  avatar_url TEXT,
  phone TEXT,
  phone_verified BOOLEAN DEFAULT FALSE,
  phone_verified_at TIMESTAMP,
  target_exam TEXT,
  prep_stage TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can view their own profile
CREATE POLICY "Users can view their own profile"
ON profiles FOR SELECT
USING (auth.uid() = id);

-- Authenticated users can view all profiles (filtering for admin happens in app layer)
CREATE POLICY "Authenticated users can view all profiles"
ON profiles FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Users can update their own profile
CREATE POLICY "Users can update their own profile"
ON profiles FOR UPDATE
USING (auth.uid() = id);

-- Authenticated users can insert their profile
CREATE POLICY "Users can insert their profile"
ON profiles FOR INSERT
WITH CHECK (auth.uid() = id);

CREATE POLICY "Buyers and sellers can view their orders"
ON orders FOR SELECT
USING (
  auth.uid() = buyer_id
  OR lower(coalesce(auth.jwt() ->> 'email', '')) = lower(coalesce(buyer_email, ''))
  OR auth.uid() = seller_id
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "Authenticated users can place orders"
ON orders FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Buyers and sellers can update their orders"
ON orders FOR UPDATE
USING (
  auth.uid() = buyer_id
  OR auth.uid() = seller_id
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Wallet transactions table to track deposits and locked funds
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  rental_id UUID REFERENCES rentals(id) ON DELETE SET NULL,
  transaction_type TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'locked',
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT fk_wallet_transactions_user FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id ON wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_order_id ON wallet_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_rental_id ON wallet_transactions(rental_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_type ON wallet_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created_at ON wallet_transactions(created_at);

ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their wallet transactions"
ON wallet_transactions FOR SELECT
USING (
  auth.uid() = user_id
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "Authenticated users can create wallet transactions"
ON wallet_transactions FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Users and admins can update wallet transactions"
ON wallet_transactions FOR UPDATE
USING (
  auth.uid() = user_id
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
)
WITH CHECK (
  auth.uid() = user_id
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
