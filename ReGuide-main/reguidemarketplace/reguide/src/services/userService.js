import { supabase } from "../supabaseClient";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function hasAdminIdentity(profile) {
  const email = normalizeEmail(profile?.email);
  const role = String(profile?.role || "").trim().toLowerCase();
  return role === "admin" || email === "admin@gmail.com" || email.startsWith("admin@");
}

function normalizeProfile(authUser, dbProfile) {
  const meta = authUser?.user_metadata || {};
  const mergedEmail = authUser?.email || dbProfile?.email || "";
  const merged = {
    ...(dbProfile || {}),
    id: authUser?.id || dbProfile?.id || "",
    email: mergedEmail,
    full_name: dbProfile?.full_name || meta?.full_name || "",
    target_exam: dbProfile?.target_exam || meta?.target_exam || "",
    prep_stage: dbProfile?.prep_stage || meta?.prep_stage || "",
    role: dbProfile?.role || meta?.role || (hasAdminIdentity({ email: mergedEmail }) ? "admin" : "user"),
    avatar_url: dbProfile?.avatar_url || meta?.avatar_url || "",
    phone: dbProfile?.phone || dbProfile?.phone_number || "",
    phone_verified:
      typeof dbProfile?.phone_verified === "boolean"
        ? dbProfile.phone_verified
        : meta?.phone_verified === true,
    phone_verified_at: dbProfile?.phone_verified_at || meta?.phone_verified_at || null,
  };

  return {
    ...merged,
    name: merged.full_name || "",
    exam: merged.target_exam || "",
    stage: merged.prep_stage || "",
    avatar: merged.avatar_url || "",
    phoneVerified: Boolean(merged.phone_verified),
  };
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "").trim();
}

export function isPhoneVerified(profile) {
  return Boolean(profile?.phoneVerified || profile?.phone_verified);
}

export function hasVerifiedPhone(profile) {
  const normalizedPhone = normalizePhone(profile?.phone || profile?.phone_number);
  return normalizedPhone.length === 10 && isPhoneVerified(profile);
}

export function assertPhoneVerified(profile, actionLabel = "continue") {
  if (!profile) {
    throw new Error("Please log in to continue.");
  }

  const normalizedPhone = normalizePhone(profile?.phone || profile?.phone_number);
  if (normalizedPhone.length !== 10) {
    throw new Error("Add a valid 10-digit phone number in Profile before you can continue.");
  }

  if (!isPhoneVerified(profile)) {
    throw new Error(`Verify your phone number in Profile before you can ${actionLabel}.`);
  }
}

export async function getCurrentUserProfile() {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user?.id) {
    return null;
  }

  const authUser = authData.user;

  const { data: dbProfile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", authUser.id)
    .maybeSingle();

  return normalizeProfile(authUser, dbProfile || null);
}

export async function getCurrentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) return null;
  return data.user.id;
}

export function isAdminProfile(profile) {
  if (!profile) return false;
  return hasAdminIdentity(profile);
}

export async function signOutCurrentUser() {
  await supabase.auth.signOut();
}