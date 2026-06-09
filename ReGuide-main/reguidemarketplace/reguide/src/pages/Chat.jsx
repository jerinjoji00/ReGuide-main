import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, Send } from "lucide-react";
import {
  getUserConversations,
  getConversationMessages,
  markConversationMessagesAsRead,
  sendMessage,
  subscribeToMessages,
  getOtherUser,
} from "../services/chatService";
import "./Chat.css";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getChatUserIdentity(user) {
  if (!user) return null;
  if (typeof user.id === "string" && UUID_REGEX.test(user.id)) {
    return user.id;
  }
  return null;
}

function parseSupabaseTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  // Supabase `timestamp` can come without timezone; treat it as UTC.
  const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(raw);
  const normalized = hasTimezone ? raw : `${raw}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatShortTime(value) {
  const parsed = parseSupabaseTimestamp(value);
  if (!parsed) return "";
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatFriendlyDate(value) {
  const parsed = parseSupabaseTimestamp(value);
  if (!parsed) return "";
  return parsed.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function getAvatarLetter(nameOrId) {
  const normalized = String(nameOrId || "").trim();
  if (!normalized) return "U";
  return normalized.charAt(0).toUpperCase();
}

function getCurrentUserDisplayName(user) {
  return String(user?.name || user?.full_name || user?.email || "User").trim();
}

function Chat() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const conversationId = params.get("conversation");

  const [conversations, setConversations] = useState([]);
  const [current, setCurrent] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    const userJson = localStorage.getItem("reguideUser");
    if (!userJson) {
      navigate("/login");
      return;
    }

    const user = JSON.parse(userJson);
    const normalizedUser = {
      ...user,
      id: getChatUserIdentity(user),
    };
    setCurrentUser(normalizedUser);
  }, [navigate]);

  useEffect(() => {
    const loadConversations = async () => {
      if (!currentUser) return;

      if (!currentUser.id) {
        setConversations([]);
        setCurrent(null);
        setMessages([]);
        setLoading(false);
        setError("Chat requires a valid account id. Please sign out and sign in again.");
        return;
      }

      try {
        setLoading(true);
        setError("");

        const convs = await getUserConversations(currentUser.id);
        setConversations(convs);

        if (conversationId) {
          const selectedConv = convs.find((conv) => conv.id === conversationId);
          if (selectedConv) {
            setCurrent(selectedConv);
            const msgs = await getConversationMessages(conversationId);
            setMessages(msgs);
            await markConversationMessagesAsRead(conversationId, currentUser.id);
          } else {
            setError("Conversation not found");
          }
        } else if (convs.length > 0) {
          setCurrent(convs[0]);
          const msgs = await getConversationMessages(convs[0].id);
          setMessages(msgs);
          await markConversationMessagesAsRead(convs[0].id, currentUser.id);
        }
      } catch (err) {
        console.error("Error loading conversations:", err);
        setError("Failed to load conversations: " + err.message);
      } finally {
        setLoading(false);
      }
    };

    loadConversations();
  }, [currentUser, conversationId]);

  useEffect(() => {
    if (!current?.id || !currentUser?.id) return;

    let unsubscribe;

    try {
      unsubscribe = subscribeToMessages(current.id, (payload) => {
        if (payload.eventType === "INSERT") {
          if (payload.new?.sender_id && payload.new.sender_id !== currentUser.id) {
            markConversationMessagesAsRead(current.id, currentUser.id).then(() => {
              setMessages((prev) => prev.map((message) => {
                if (
                  message.conversation_id === current.id &&
                  message.sender_id !== currentUser.id &&
                  !message.read_at
                ) {
                  return {
                    ...message,
                    read_at: new Date().toISOString(),
                  };
                }

                return message;
              }));
            });
          }

          setMessages((prev) => {
            if (prev.some((message) => message.id === payload.new.id)) {
              return prev;
            }
            return [...prev, payload.new];
          });
        }
      });
    } catch (subscribeError) {
      console.error("Error subscribing to messages:", subscribeError);
    }

    return () => {
      if (unsubscribe && typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [current?.id, currentUser?.id]);

  const handleSelectConversation = async (conversation) => {
    try {
      setError("");
      setCurrent(conversation);
      const msgs = await getConversationMessages(conversation.id);
      setMessages(msgs);
      await markConversationMessagesAsRead(conversation.id, currentUser.id);
    } catch (err) {
      console.error("Error loading conversation:", err);
      setError("Failed to load conversation");
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();

    const trimmedMessage = newMessage.trim();
    if (!trimmedMessage || !current?.id || !currentUser?.id) return;

    const optimisticId = `temp-${Date.now()}`;
    const optimisticMessage = {
      id: optimisticId,
      conversation_id: current.id,
      sender_id: currentUser.id,
      content: trimmedMessage,
      created_at: new Date().toISOString(),
      read_at: null,
    };

    try {
      setError("");
      setIsSending(true);
      setNewMessage("");
      setMessages((prev) => [...prev, optimisticMessage]);

      const savedMessage = await sendMessage(current.id, currentUser.id, trimmedMessage);
      setMessages((prev) => prev.map((message) => (
        message.id === optimisticId ? savedMessage : message
      )));
      setError("");
    } catch (err) {
      console.error("Error sending message:", err);
      setMessages((prev) => prev.filter((message) => message.id !== optimisticId));
      setNewMessage(trimmedMessage);
      setError(err?.message || "Failed to send message");
    } finally {
      setIsSending(false);
    }
  };

  const handleComposerSubmit = (e) => {
    if (!current) {
      e.preventDefault();
      setError("Please select a conversation from the left to send a message.");
      return;
    }
    handleSendMessage(e);
  };

  const getConversationTitle = (conversation) => {
    const otherUser = getOtherUser(conversation, currentUser?.id);
    if (otherUser?.full_name) {
      return otherUser.full_name;
    }

    const otherId = conversation.user1_id === currentUser?.id
      ? conversation.user2_id
      : conversation.user1_id;
    return `Seller (${otherId?.substring(0, 8)}...)`;
  };

  const getLastMessagePreview = (id) => {
    if (current?.id === id && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      const preview = lastMsg?.content?.substring(0, 50) || "";
      return preview + (lastMsg?.content?.length > 50 ? "..." : "");
    }
    return "Tap to open chat";
  };

  const getLastMessageTimestamp = (conversation) => {
    if (!conversation?.updated_at) return "";
    return `${formatFriendlyDate(conversation.updated_at)} ${formatShortTime(conversation.updated_at)}`;
  };

  if (!currentUser) {
    return <div className="chat-container"><p>Loading...</p></div>;
  }

  const currentTitle = current ? getConversationTitle(current) : "Messages";
  const currentUserDisplayName = getCurrentUserDisplayName(currentUser);

  return (
    <div className="chat-container">
      <div className="chat-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={18} /> Back
        </button>
        <h1>Messages</h1>
        <div className="chat-header-meta" title={currentUserDisplayName} aria-label={currentUserDisplayName}>
          {currentUser.avatar ? (
            <img src={currentUser.avatar} alt={currentUserDisplayName} className="chat-header-avatar-img" />
          ) : (
            <span className="chat-header-avatar-letter">{getAvatarLetter(currentUserDisplayName)}</span>
          )}
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="chat-content">
        <aside className="chat-list">
          <div className="chat-list-head">
            <h3>Conversations</h3>
            <span>{conversations.length}</span>
          </div>

          {loading ? (
            <p className="chat-muted">Loading conversations...</p>
          ) : conversations.length === 0 ? (
            <div className="chat-empty-card">
              <p>No conversations yet</p>
              <small>Open any guide and click Contact Seller to start chatting.</small>
            </div>
          ) : (
            <ul>
              {conversations.map((conv) => {
                const title = getConversationTitle(conv);
                return (
                  <li
                    key={conv.id}
                    onClick={() => handleSelectConversation(conv)}
                    className={current?.id === conv.id ? "active" : ""}
                  >
                    <div className="conv-avatar">{getAvatarLetter(title)}</div>
                    <div className="conv-main">
                      <div className="conv-top-row">
                        <div className="conv-title">{title}</div>
                        <div className="conv-time">{getLastMessageTimestamp(conv)}</div>
                      </div>
                      <div className="conv-preview">{getLastMessagePreview(conv.id)}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <main className="chat-main">
          {loading ? (
            <div className="chat-empty-card large">
              <p>Loading chat window...</p>
            </div>
          ) : current ? (
            <div className="conversation-panel">
              <div className="chat-header-current">
                <div className="chat-thread-head">
                  <div className="chat-thread-avatar">{getAvatarLetter(currentTitle)}</div>
                  <div>
                    <h2>{currentTitle}</h2>
                    <p>Discuss guide details, availability, and delivery.</p>
                  </div>
                </div>
              </div>

              <div className="messages">
                {messages.length === 0 ? (
                  <p className="no-messages">No messages yet. Start the conversation!</p>
                ) : (
                  messages.map((msg) => {
                    const isMine = msg.sender_id === currentUser?.id;
                    return (
                      <div key={msg.id} className={`msg-row ${isMine ? "mine" : "theirs"}`}>
                        {!isMine && <div className="msg-avatar">{getAvatarLetter(currentTitle)}</div>}
                        <div className={`msg ${isMine ? "sent" : "received"}`}>
                          {!isMine && <div className="msg-author">{currentTitle}</div>}
                          <div className="msg-content">{msg.content}</div>
                          <div className="msg-time">{formatShortTime(msg.created_at)}</div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="chat-composer-wrap inside-conversation">
                <form onSubmit={handleSendMessage} className="chat-input">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type your message..."
                  />
                  <button type="submit" disabled={isSending || !newMessage.trim()}>
                    <Send size={18} />
                  </button>
                </form>
              </div>
            </div>
          ) : (
            <div className="no-conversation">
              <div className="chat-empty-card large">
                <p>Select a conversation from the left or navigate from a guide.</p>
                <button className="browse-btn" onClick={() => navigate("/browse")}>Browse Guides</button>
              </div>

              <div className="chat-composer-wrap inside-conversation disabled">
                <form className="chat-input" onSubmit={handleComposerSubmit}>
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type your message..."
                  />
                  <button type="submit" disabled={!newMessage.trim()}>
                    <Send size={18} />
                  </button>
                </form>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default Chat;
