import { supabase } from "../supabaseClient";
import { createNotification } from "./notificationService";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (value) => typeof value === "string" && UUID_REGEX.test(value);

const normalizeGuideIdForConversation = (guideId) => {
  if (guideId === null || guideId === undefined) return null;

  if (typeof guideId === "object") {
    const candidate =
      guideId.guide_id ??
      guideId.guideId ??
      guideId.id ??
      null;
    return normalizeGuideIdForConversation(candidate);
  }

  if (typeof guideId === "number" && Number.isFinite(guideId)) {
    return Math.trunc(guideId);
  }

  const normalized = String(guideId).trim();
  if (!normalized) return null;
  if (isUuid(normalized)) {
    return normalized;
  }
  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  return normalized;
};

const normalizeConversationUsers = (firstUserId, secondUserId) => {
  if (!isUuid(firstUserId) || !isUuid(secondUserId)) {
    throw new Error("Chat requires valid UUID user ids for both users");
  }

  return firstUserId.localeCompare(secondUserId) <= 0
    ? { user1Id: firstUserId, user2Id: secondUserId }
    : { user1Id: secondUserId, user2Id: firstUserId };
};

const enrichConversationsWithProfiles = async (conversations) => {
  const convs = Array.isArray(conversations) ? conversations : [];
  if (convs.length === 0) {
    return [];
  }

  const userIds = Array.from(
    new Set(
      convs
        .flatMap((conv) => [conv.user1_id, conv.user2_id])
        .filter((id) => isUuid(id))
    )
  );

  if (userIds.length === 0) {
    return convs;
  }

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", userIds);

  if (error) {
    // Keep chat functional even if profile lookup is blocked by RLS.
    return convs;
  }

  const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));

  return convs.map((conv) => ({
    ...conv,
    profile1: profileMap.get(conv.user1_id) || null,
    profile2: profileMap.get(conv.user2_id) || null,
  }));
};

export const resolveContactableSellerId = async (preferredSellerId, currentUserId) => {
  if (!isUuid(currentUserId)) {
    throw new Error("Current user id is invalid. Please sign in again.");
  }

  const { data: guideSellers, error: guideSellerError } = await supabase
    .from("guides")
    .select("seller_id")
    .not("seller_id", "is", null)
    .neq("seller_id", currentUserId)
    .limit(100);

  const validGuideSellerIds = Array.from(
    new Set(
      (Array.isArray(guideSellers) ? guideSellers : [])
        .map((row) => row?.seller_id)
        .filter((id) => isUuid(id))
    )
  );

  if (isUuid(preferredSellerId) && validGuideSellerIds.includes(preferredSellerId)) {
    return preferredSellerId;
  }

  if (validGuideSellerIds.length > 0) {
    return validGuideSellerIds[0];
  }

  if (isUuid(preferredSellerId) && preferredSellerId !== currentUserId) {
    const { data: preferred, error: preferredError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", preferredSellerId)
      .maybeSingle();

    if (!preferredError && preferred?.id) {
      return preferred.id;
    }
  }

  const { data: fallback, error: fallbackError } = await supabase
    .from("profiles")
    .select("id")
    .neq("id", currentUserId)
    .limit(1)
    .maybeSingle();

  if (fallbackError) {
    if (guideSellerError) {
      throw new Error("No valid seller found in guides. Please create one guide from another account first.");
    }
    throw new Error("Could not find a valid seller profile. Please create another account and try again.");
  }

  if (!fallback?.id) {
    throw new Error("No seller account is available yet. Register a second user account first.");
  }

  return fallback.id;
};

/**
 * Get or create a conversation between two users
 * @param {string} userId1 - First user ID (buyer)
 * @param {string} userId2 - Second user ID (seller)
 * @param {string} guideId - Guide ID (optional, for reference)
 * @returns {Promise} Conversation object
 */
export const getOrCreateConversation = async (userId1, userId2, guideId = null) => {
  if (!userId1 || !userId2) {
    throw new Error("Both userId1 and userId2 are required");
  }

  const normalizedUsers = normalizeConversationUsers(userId1, userId2);
  const normalizedGuideId = normalizeGuideIdForConversation(guideId);

  try {
    const conversationLookupFilter =
      `and(user1_id.eq.${userId1},user2_id.eq.${userId2}),` +
      `and(user1_id.eq.${userId2},user2_id.eq.${userId1})`;

    const { data: existingRows, error: checkError } = await supabase
      .from("conversations")
      .select("*")
      .or(conversationLookupFilter)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (checkError) {
      throw new Error(`Failed to check conversation: ${checkError.message}`);
    }

    const existing = Array.isArray(existingRows) ? existingRows[0] : null;

    if (existing) {
      if (normalizedGuideId != null && (existing.guide_id === null || existing.guide_id === undefined)) {
        const { data: updatedConversation, error: updateError } = await supabase
          .from("conversations")
          .update({ guide_id: normalizedGuideId, updated_at: new Date().toISOString() })
          .eq("id", existing.id)
          .select()
          .single();

        if (!updateError && updatedConversation) {
          console.log("Updated existing conversation with guide id:", updatedConversation);
          return updatedConversation;
        }
      }

      console.log("Found existing conversation:", existing);
      return existing;
    }

    const newConversation = {
      user1_id: normalizedUsers.user1Id,
      user2_id: normalizedUsers.user2Id,
      guide_id: normalizedGuideId,
      updated_at: new Date().toISOString(),
    };

    const { data: conversation, error: createError } = await supabase
      .from("conversations")
      .insert([newConversation])
      .select()
      .single();

    if (createError) {
      console.error("Create conversation error:", createError);
      throw new Error(`Failed to create conversation: ${createError.message}`);
    }

    console.log("Created new conversation:", conversation);
    return conversation;
  } catch (error) {
    console.error("Error in getOrCreateConversation:", error);
    throw error;
  }
};

/**
 * Get all conversations for a user
 * @param {string} userId - User ID
 * @returns {Promise} Array of conversations
 */
export const getUserConversations = async (userId) => {
  if (!userId) {
    throw new Error("userId is required");
  }

  if (!isUuid(userId)) {
    throw new Error("Chat requires a valid UUID user id");
  }

  try {
    const { data: conversations, error } = await supabase
      .from("conversations")
      .select("*")
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .order("updated_at", { ascending: false });

    if (error) {
      throw error;
    }

    const rawConversations = conversations || [];
    const dedupedByPair = new Map();

    rawConversations.forEach((conversation) => {
      const normalizedPair = normalizeConversationUsers(conversation.user1_id, conversation.user2_id);
      const pairKey = `${normalizedPair.user1Id}:${normalizedPair.user2Id}`;
      const existingConversation = dedupedByPair.get(pairKey);

      if (!existingConversation) {
        dedupedByPair.set(pairKey, conversation);
        return;
      }

      const existingTime = new Date(existingConversation.updated_at || 0).getTime();
      const candidateTime = new Date(conversation.updated_at || 0).getTime();
      if (candidateTime >= existingTime) {
        dedupedByPair.set(pairKey, conversation);
      }
    });

    return enrichConversationsWithProfiles(Array.from(dedupedByPair.values()));
  } catch (error) {
    console.error("Error fetching conversations:", error);
    throw error;
  }
};

/**
 * Get messages for a conversation
 * @param {string} conversationId - Conversation ID
 * @returns {Promise} Array of messages
 */
export const getConversationMessages = async (conversationId) => {
  if (!conversationId) {
    throw new Error("conversationId is required");
  }

  if (!isUuid(conversationId)) {
    throw new Error("conversationId must be a valid UUID");
  }

  try {
    const { data: messages, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      throw error;
    }

    return messages || [];
  } catch (error) {
    console.error("Error fetching messages:", error);
    throw error;
  }
};

/**
 * Mark unread incoming messages in a conversation as read for the viewer.
 * @param {string} conversationId - Conversation ID
 * @param {string} viewerId - Current viewer user ID
 * @returns {Promise<number>} Number of rows updated
 */
export const markConversationMessagesAsRead = async (conversationId, viewerId) => {
  if (!conversationId || !viewerId) {
    return 0;
  }

  if (!isUuid(conversationId) || !isUuid(viewerId)) {
    return 0;
  }

  const now = new Date().toISOString();

  try {
    const { data, error } = await supabase
      .from("messages")
      .update({ read_at: now })
      .eq("conversation_id", conversationId)
      .neq("sender_id", viewerId)
      .is("read_at", null)
      .select("id");

    if (error) {
      throw error;
    }

    return Array.isArray(data) ? data.length : 0;
  } catch (error) {
    console.error("Error marking messages as read:", error);
    return 0;
  }
};

/**
 * Send a message in a conversation
 * @param {string} conversationId - Conversation ID
 * @param {string} senderId - Sender user ID
 * @param {string} content - Message content
 * @returns {Promise} Message object
 */
export const sendMessage = async (conversationId, senderId, content) => {
  if (!conversationId || !senderId || !content) {
    throw new Error("conversationId, senderId, and content are required");
  }

  if (!isUuid(conversationId) || !isUuid(senderId)) {
    throw new Error("conversationId and senderId must be valid UUIDs");
  }

  try {
    const message = {
      conversation_id: conversationId,
      sender_id: senderId,
      content: content.trim(),
    };

    const { data: result, error } = await supabase
      .from("messages")
      .insert([message])
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Update conversation updated_at timestamp (best effort, should not break message send)
    try {
      const { error: updateConversationError } = await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId);

      if (updateConversationError) {
        console.warn("Could not update conversation timestamp:", updateConversationError.message);
      }
    } catch {
      // Keep chat send flow successful even if this auxiliary update fails.
    }

    try {
      const [{ data: conversation }, { data: senderProfile }] = await Promise.all([
        supabase
          .from("conversations")
          .select("id, user1_id, user2_id")
          .eq("id", conversationId)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("full_name, email")
          .eq("id", senderId)
          .maybeSingle(),
      ]);

      const recipientId = conversation?.user1_id === senderId
        ? conversation?.user2_id
        : conversation?.user1_id;

      if (recipientId) {
        await createNotification({
          recipientId,
          actorId: senderId,
          actorName: senderProfile?.full_name || senderProfile?.email || "New message",
          type: "chat_message",
          title: "New message",
          message: content.trim().length > 80 ? `${content.trim().slice(0, 80)}...` : content.trim(),
          link: `/chat?conversation=${conversationId}`,
          metadata: {
            conversationId,
            messageId: result.id,
          },
        });
      }
    } catch {
      // Keep chat usable if notification creation fails.
    }

    return result;
  } catch (error) {
    console.error("Error sending message:", error);
    throw error;
  }
};

/**
 * Subscribe to real-time messages in a conversation
 * @param {string} conversationId - Conversation ID
 * @param {function} callback - Function to call when messages change
 * @returns {function} Unsubscribe function
 */
export const subscribeToMessages = (conversationId, callback) => {
  if (!conversationId) {
    throw new Error("conversationId is required");
  }

  let subscription;

  try {
    subscription = supabase
      .channel(`messages:conversation_id=eq.${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          console.log("Message update received:", payload);
          callback(payload);
        }
      )
      .subscribe();

    console.log("Subscribed to messages for conversation:", conversationId);
  } catch (error) {
    console.error("Error subscribing to messages:", error);
    // Return no-op unsubscribe if subscription fails (localStorage fallback)
    return () => {};
  }

  return async () => {
    if (subscription) {
      try {
        await supabase.removeChannel(subscription);
      } catch (error) {
        console.error("Error unsubscribing:", error);
      }
    }
  };
};

/**
 * Subscribe to real-time conversation updates
 * @param {string} userId - User ID
 * @param {function} callback - Function to call when conversations change
 * @returns {function} Unsubscribe function
 */
export const subscribeToConversations = (userId, callback) => {
  if (!userId) {
    throw new Error("userId is required");
  }

  let subscription;

  try {
    subscription = supabase
      .channel(`conversations:user_id=eq.${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
        },
        (payload) => {
          console.log("Conversation update received:", payload);
          callback(payload);
        }
      )
      .subscribe();

    console.log("Subscribed to conversations for user:", userId);
  } catch (error) {
    console.error("Error subscribing to conversations:", error);
    // Return no-op unsubscribe if subscription fails (localStorage fallback)
    return () => {};
  }

  return async () => {
    if (subscription) {
      try {
        await supabase.removeChannel(subscription);
      } catch (error) {
        console.error("Error unsubscribing:", error);
      }
    }
  };
};

/**
 * Get the other user's information in a conversation
 * @param {object} conversation - Conversation object
 * @param {string} currentUserId - Current user ID
 * @returns {object} Other user's profile
 */
export const getOtherUser = (conversation, currentUserId) => {
  if (!conversation || !currentUserId) {
    return null;
  }

  return conversation.user1_id === currentUserId
    ? conversation.profile2
    : conversation.profile1;
};
