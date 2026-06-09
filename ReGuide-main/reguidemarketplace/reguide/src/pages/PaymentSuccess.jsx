import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./PaymentSuccess.css";

function formatCurrency(value) {
  const amount = Number(value || 0);
  return `₹${amount.toLocaleString("en-IN")}`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function PaymentSuccess() {
  const location = useLocation();
  const navigate = useNavigate();

  const bill = location.state?.bill || null;

  const rows = useMemo(() => {
    if (!bill) return [];

    const items = [
      { label: bill.orderType === "rent" ? "Rental Amount" : "Purchase Amount", value: formatCurrency(bill.amount) },
    ];

    if (bill.orderType === "rent") {
      items.push({ label: "Refundable Deposit", value: formatCurrency(bill.deposit) });
      items.push({ label: "Duration", value: `${bill.duration || "-"} months` });
      items.push({ label: "Rental End Date", value: bill.endDate || "-" });
    }

    return items;
  }, [bill]);

  if (!bill) {
    return (
      <div className="payment-success-page">
        <div className="payment-card">
          <h1>Payment details not found</h1>
          <p>Please continue to your orders to view your latest purchase/rental.</p>
          <button type="button" className="primary-btn" onClick={() => navigate("/myorders", { replace: true })}>
            Show My Orders
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="payment-success-page">
      <div className="payment-card">
        <div className="success-badge" aria-label="payment success">
          Payment Successful 🙂 🎉
        </div>
        <h1 className="payment-title">Payment completed successfully</h1>
        <p className="subtitle">Your order has been placed. Please find your bill below.</p>

        <div className="bill-box">
          <div className="bill-header">
            <h2>Invoice</h2>
            <span className="invoice-status">Paid</span>
          </div>
          <div className="bill-row"><span>Order ID</span><strong>{bill.orderId}</strong></div>
          <div className="bill-row"><span>Guide</span><strong>{bill.guideTitle}</strong></div>
          <div className="bill-row"><span>Seller</span><strong>{bill.sellerName || "-"}</strong></div>
          <div className="bill-row"><span>Buyer</span><strong>{bill.buyerName || "-"}</strong></div>
          <div className="bill-row"><span>Buyer Email</span><strong>{bill.buyerEmail || "-"}</strong></div>
          <div className="bill-row"><span>Paid At</span><strong>{formatDateTime(bill.paidAt)}</strong></div>

          {rows.map((row) => (
            <div key={row.label} className="bill-row">
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </div>
          ))}

          <div className="bill-row total-row">
            <span>Total Paid</span>
            <strong>{formatCurrency(bill.total)}</strong>
          </div>
        </div>

        <div className="actions">
          <button
            type="button"
            className="primary-btn"
            onClick={() => navigate("/myorders", { replace: true, state: { success: true } })}
          >
            Show My Orders
          </button>
          <button type="button" className="secondary-btn" onClick={() => navigate("/browse")}>Continue Browsing</button>
        </div>
      </div>
    </div>
  );
}

export default PaymentSuccess;
