import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { assertPhoneVerified, getCurrentUserProfile } from "../services/userService";
import { createNotification, createNotificationForAdmins } from "../services/notificationService";
import "./Checkout.css";

const BACKEND_BASE_URL = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/$/, "");

function apiUrl(path) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (BACKEND_BASE_URL) return `${BACKEND_BASE_URL}${normalized}`;
  return normalized;
}

function getApiCandidates(path) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (BACKEND_BASE_URL) return [`${BACKEND_BASE_URL}${normalized}`];
  return [normalized, `http://localhost:5000${normalized}`];
}

async function parseApiErrorResponse(response) {
  const statusText = `${response.status} ${response.statusText}`.trim();
  const raw = await response.text();
  if (!raw) return `Request failed (${statusText}).`;

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error) return `${parsed.error}`;
    if (parsed?.message) return `${parsed.message}`;
  } catch {
    // Raw text fallback.
  }

  return `${raw} (${statusText})`;
}

function Checkout() {
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const type = query.get("type") || "rent"; // default to rent if missing
  const incomingGuide = location.state?.guide;

  const guide = incomingGuide ? {
    id: incomingGuide.id || Number(id) || 1,
    title: incomingGuide.title || "Guide",
    author: incomingGuide.author || incomingGuide.seller_name || "Unknown",
    rentPrice: Number(
      incomingGuide.rentalPrice ?? incomingGuide.rental_price ?? incomingGuide?.pricing?.rent?.price,
    ) || 0,
    buyPrice: Number(
      incomingGuide.buyPrice ?? incomingGuide.purchase_price ?? incomingGuide?.pricing?.buy?.price,
    ) || 0,
    deposit: Number(
      incomingGuide.refundableDeposit ?? incomingGuide.refundable_deposit ?? incomingGuide?.pricing?.rent?.deposit,
    ) || 0,
    sellerId: incomingGuide.seller_id ?? incomingGuide.sellerId ?? null,
    sellerEmail:
      incomingGuide.seller_email ??
      incomingGuide.sellerEmail ??
      incomingGuide.profile_email ??
      "",
    seller: incomingGuide.seller || incomingGuide.seller_name || "Unknown Seller",
  } : {
    id: Number(id) || 1,
    title: "Guide",
    author: "Unknown",
    rentPrice: 0,
    buyPrice: 0,
    deposit: 0,
    sellerId: null,
    sellerEmail: "",
    seller: "Unknown Seller",
  };

  // common state
  const [duration, setDuration] = useState(4);
  const rentalTotal = guide.rentPrice * duration;
  const rentalDeposit = type === "rent" ? guide.buyPrice : 0;
  const grandTotal = type === "rent" ? rentalTotal + rentalDeposit : guide.buyPrice;
  const [isPaying, setIsPaying] = useState(false);

  const loadRazorpayScript = () => {
    return new Promise((resolve) => {
      if (window.Razorpay) {
        resolve(true);
        return;
      }

      const existing = document.querySelector("script[data-razorpay-checkout='true']");
      if (existing) {
        existing.addEventListener("load", () => resolve(true), { once: true });
        existing.addEventListener("error", () => resolve(false), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.dataset.razorpayCheckout = "true";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const createRazorpayOrder = async ({ amount, guideId, orderType }) => {
    const body = JSON.stringify({
      amount,
      type: orderType,
      guide_id: guideId,
    });

    const candidates = getApiCandidates("/api/create-order");
    let lastError = "";

    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body,
        });

        if (!response.ok) {
          lastError = await parseApiErrorResponse(response);
          continue;
        }

        const data = await response.json().catch(() => ({}));
        if (!data?.order_id) {
          lastError = "Payment server responded without Razorpay order id.";
          continue;
        }

        return data;
      } catch {
        lastError = `Could not connect to ${candidate}`;
      }
    }

    throw new Error(
      lastError || "Cannot reach payment server. Start backend on port 5000 or set VITE_BACKEND_URL correctly."
    );
  };

  const verifyPaymentOnBackend = async ({ payment, currentUser, rentalMeta }) => {
    const body = JSON.stringify({
      razorpay_payment_id: payment.razorpay_payment_id,
      razorpay_order_id: payment.razorpay_order_id,
      razorpay_signature: payment.razorpay_signature,
      type,
      order_type: type,
      guide_id: guide.id,
      user_id: currentUser?.id || null,
      buyer_id: currentUser?.id || null,
      buyer_email: currentUser?.email || "",
      buyer_name: currentUser?.name || currentUser?.full_name || currentUser?.email || "User",
      seller_id: guide.sellerId || null,
      seller_name: guide.seller || "",
      guide_title: guide.title || "Guide",
      deposit: type === "rent" ? rentalMeta.deposit : 0,
      duration_months: type === "rent" ? rentalMeta.duration : null,
      end_date: type === "rent" ? rentalMeta.endDate : null,
    });

    const candidates = getApiCandidates("/api/verify-payment");
    let lastError = "";

    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body,
        });

        if (!response.ok) {
          lastError = await parseApiErrorResponse(response);
          continue;
        }

        const data = await response.json().catch(() => ({}));
        if (!data?.success) {
          lastError = data?.error || "Payment verification failed.";
          continue;
        }

        return data;
      } catch {
        lastError = `Could not connect to ${candidate}`;
      }
    }

    throw new Error(lastError || "Payment verification server is unreachable.");
  };

  const handleCheckout = async () => {
    if (isPaying) return;

    const currentUser = await getCurrentUserProfile();
    if (!currentUser) {
      alert("Please log in before placing an order.");
      navigate("/login");
      return;
    }

    try {
      assertPhoneVerified(currentUser, type === "rent" ? "rent guides" : "buy guides");
    } catch (error) {
      alert(error?.message || "Verify your phone number in Profile before making payments.");
      navigate("/profile");
      return;
    }

    if (
      String(currentUser?.id || "").trim() &&
      String(guide?.sellerId || "").trim() &&
      String(currentUser.id).trim() === String(guide.sellerId).trim()
    ) {
      alert(`You cannot ${type === "rent" ? "rent" : "buy"} your own guide.`);
      return;
    }

    const sdkLoaded = await loadRazorpayScript();
    if (!sdkLoaded) {
      alert("Razorpay SDK failed to load. Please check your internet and try again.");
      return;
    }

    const now = new Date();
    const orderDate = now.toISOString().split("T")[0];
    const rentalMeta = {
      duration,
      deposit: rentalDeposit,
      endDate: null,
    };

    if (type === "rent") {
      const end = new Date();
      end.setMonth(end.getMonth() + duration);
      rentalMeta.endDate = end.toISOString().split("T")[0];
    }

    try {
      setIsPaying(true);

      const amountRupees = type === "rent" ? grandTotal : guide.buyPrice;
      const createOrderResp = await createRazorpayOrder({
        amount: amountRupees,
        guideId: guide.id,
        orderType: type,
      });

      const paymentResult = await new Promise((resolve, reject) => {
        const options = {
          key: createOrderResp.key || import.meta.env.VITE_RAZORPAY_KEY_ID || "",
          amount: createOrderResp.amount,
          currency: createOrderResp.currency || "INR",
          name: "ReGuide",
          description: type === "rent" ? "Guide Rental Payment" : "Guide Purchase Payment",
          order_id: createOrderResp.order_id,
          prefill: {
            name: currentUser?.name || currentUser?.full_name || "",
            email: currentUser?.email || "",
          },
          notes: {
            guide_id: String(guide.id),
            order_type: type,
            buyer_id: currentUser?.id || "",
          },
          handler: (response) => resolve(response),
          modal: {
            ondismiss: () => reject(new Error("Payment cancelled.")),
          },
          theme: {
            color: "#4f46e5",
          },
        };

        if (!options.key) {
          reject(new Error("Razorpay key missing. Set VITE_RAZORPAY_KEY_ID or return key from backend."));
          return;
        }

        const razorpay = new window.Razorpay(options);
        razorpay.on("payment.failed", (resp) => {
          const reason =
            resp?.error?.description || resp?.error?.reason || "Payment failed. Please try again.";
          reject(new Error(reason));
        });
        razorpay.open();
      });

      const verifyResp = await verifyPaymentOnBackend({
        payment: paymentResult,
        currentUser,
        rentalMeta,
      });

      const backendOrder = verifyResp?.order || {};
      const finalOrderId = backendOrder.order_key || backendOrder.id || createOrderResp.order_id;

      await createNotification({
        recipientId: currentUser?.id || null,
        recipientEmail: currentUser?.email || "",
        actorId: guide.sellerId || null,
        actorName: guide.seller || "Seller",
        type: type === "rent" ? "rental_confirmed" : "purchase_confirmed",
        title: type === "rent" ? "Rental confirmed" : "Purchase confirmed",
        message:
          type === "rent"
            ? `${guide.title} rental is confirmed. Total paid: ₹${grandTotal}.`
            : `${guide.title} purchase is confirmed. Amount paid: ₹${guide.buyPrice}.`,
        link: "/myorders",
        metadata: {
          orderId: finalOrderId,
          guideId: guide.id,
          orderType: type,
        },
      }).catch((err) => {
        console.warn("Failed to notify buyer order confirmation:", err?.message || err);
      });

      await createNotification({
        recipientId: guide.sellerId || null,
        recipientEmail: guide.sellerEmail || "",
        actorId: currentUser?.id || null,
        actorName: currentUser?.name || currentUser?.full_name || currentUser?.email || "Buyer",
        type: type === "rent" ? "guide_rented" : "guide_purchased",
        title: type === "rent" ? "Guide rented" : "Guide purchased",
        message:
          type === "rent"
            ? `${currentUser?.email || "A user"} rented ${guide.title}. Rental: ₹${rentalTotal}, deposit: ₹${rentalDeposit}.`
            : `${currentUser?.email || "A user"} purchased ${guide.title} for ₹${guide.buyPrice}.`,
        link: "/guide-listings",
        metadata: {
          orderId: finalOrderId,
          guideId: guide.id,
          orderType: type,
        },
      }).catch((err) => {
        console.warn("Failed to notify seller about rent/purchase:", err?.message || err);
      });

      await createNotificationForAdmins({
        actorId: currentUser?.id || null,
        actorName: currentUser?.name || currentUser?.full_name || currentUser?.email || "Buyer",
        type: type === "rent" ? "guide_rented" : "guide_purchased",
        title: type === "rent" ? "Guide rented" : "Guide purchased",
        message:
          type === "rent"
            ? `${currentUser?.email || "A user"} rented ${guide.title}.`
            : `${currentUser?.email || "A user"} purchased ${guide.title}.`,
        link: "/admin-monitoring",
        metadata: {
          orderId: finalOrderId,
          guideId: guide.id,
          orderType: type,
          sellerId: guide.sellerId || null,
          buyerId: currentUser?.id || null,
        },
      }).catch((err) => {
        console.warn("Failed to notify admins about order activity:", err?.message || err);
      });

      if (type === "rent") {
        try {
          const lockSet = new Set(JSON.parse(localStorage.getItem("reguideRentedGuideLock") || "[]"));
          lockSet.add(String(guide.id));
          localStorage.setItem("reguideRentedGuideLock", JSON.stringify(Array.from(lockSet)));
          window.dispatchEvent(new Event("reguide-orders-updated"));
        } catch {
          // Local lock update is best-effort.
        }

        await createNotificationForAdmins({
          actorId: currentUser?.id || null,
          actorName: currentUser?.name || currentUser?.full_name || currentUser?.email || "Buyer",
          type: "rental_deposit_paid",
          title: "Rental deposit received",
          message: `Deposit of ₹${rentalDeposit} received for ${guide.title} (rental by ${currentUser?.email || "user"}).`,
          link: "/admin-monitoring",
          metadata: {
            orderId: finalOrderId,
            guideId: guide.id,
            sellerId: guide.sellerId || null,
            buyerId: currentUser?.id || null,
            deposit: rentalDeposit,
          },
        }).catch((err) => {
          console.warn("Failed to notify admins about rental deposit:", err?.message || err);
        });
      }

      navigate("/payment-success", {
        replace: true,
        state: {
          bill: {
            orderId: finalOrderId,
            orderType: type,
            guideTitle: guide.title,
            sellerName: guide.seller,
            buyerName: currentUser?.name || currentUser?.full_name || currentUser?.email || "User",
            buyerEmail: currentUser?.email || "",
            amount: type === "rent" ? rentalTotal : guide.buyPrice,
            deposit: type === "rent" ? rentalDeposit : 0,
            total: grandTotal,
            duration: type === "rent" ? duration : null,
            purchaseDate: type === "buy" ? orderDate : null,
            endDate: type === "rent" ? rentalMeta.endDate : null,
            paidAt: new Date().toISOString(),
          },
        },
      });
    } catch (error) {
      if (String(error?.message || "").toLowerCase() !== "payment cancelled.") {
        alert(error?.message || "Failed to place order. Please try again.");
      }
    } finally {
      setIsPaying(false);
    }
  };

  return (
    <div className="checkout-container">
      <div className="checkout-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} /> Back
        </button>
        <h1>{type === "rent" ? "Rent Guide" : "Buy Guide"}</h1>
        <div></div>
      </div>

      <div className="checkout-content">
        <div className="details-section">
          <h2>{guide.title}</h2>
          <p className="author">by {guide.author}</p>
          <p className="seller">Seller: {guide.seller}</p>

          {type === "rent" && (
            <>
              <div className="rent-options">
                <label>Duration (months):</label>
                <select value={duration} onChange={(e) => setDuration(+e.target.value)}>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={4}>4</option>
                  <option value={6}>6</option>
                  <option value={8}>8</option>
                  <option value={10}>10</option>
                  <option value={12}>12</option>
                </select>
              </div>
            </>
          )}

          {type === "buy" && (
            <div className="buy-options">
              {/* no delivery options needed */}
            </div>
          )}

          <div className="price-box">
            <span>
              Price: ₹{type === "rent" ? rentalTotal : guide.buyPrice}
            </span>
            {type === "rent" && <span>Deposit: ₹{rentalDeposit}</span>}
            <span className="grand-total">Grand Total: ₹{grandTotal}</span>
          </div>

          <button className="checkout-btn" onClick={handleCheckout} disabled={isPaying}>
            {isPaying ? "Processing..." : type === "rent" ? "Proceed to Rent" : "Proceed to Buy"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Checkout;
