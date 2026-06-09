import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { supabase } from "../supabaseClient";
import {
	getMyGuideListings,
	markGuideAsAvailable,
	markGuideAsReceivedBySeller,
} from "../services/guideService";
import { createNotification, createNotificationForAdmins } from "../services/notificationService";
import "./GuideListing.css";

function normalizeEmail(value) {
	return String(value || "").trim().toLowerCase();
}

async function resolveBuyerRecipient(order) {
	let buyerId = order?.buyerId || order?.buyer_id || null;
	let buyerEmail = normalizeEmail(order?.buyerEmail && order?.buyerEmail !== "-" ? order?.buyerEmail : "");
	const orderKey = String(order?.orderId || order?.order_key || order?.id || "").trim();

	if ((!buyerId || !buyerEmail) && orderKey) {
		const byOrderKey = await supabase
			.from("orders")
			.select("buyer_id,buyer_email")
			.eq("order_key", orderKey)
			.limit(1)
			.maybeSingle();

		if (!byOrderKey.error && byOrderKey.data) {
			buyerId = buyerId || byOrderKey.data.buyer_id || null;
			buyerEmail = buyerEmail || normalizeEmail(byOrderKey.data.buyer_email);
		} else {
			const byId = await supabase
				.from("orders")
				.select("buyer_id,buyer_email")
				.eq("id", orderKey)
				.limit(1)
				.maybeSingle();

			if (!byId.error && byId.data) {
				buyerId = buyerId || byId.data.buyer_id || null;
				buyerEmail = buyerEmail || normalizeEmail(byId.data.buyer_email);
			}
		}
	}

	return {
		buyerId: buyerId || null,
		buyerEmail,
	};
}

function GuideListing() {
	const navigate = useNavigate();
	const [guides, setGuides] = useState([]);
	const [loading, setLoading] = useState(true);
	const [updatingGuideId, setUpdatingGuideId] = useState(null);
	const [receivingGuideId, setReceivingGuideId] = useState(null);
	const [availabilityMessageGuideId, setAvailabilityMessageGuideId] = useState(null);
	const [activeImageIndexes, setActiveImageIndexes] = useState({});

	const getGuideImages = (guide) => {
		const allIndexImages = Array.isArray(guide?.indexPageUrls)
			? guide.indexPageUrls.filter((url) => typeof url === "string" && url.trim())
			: guide?.indexPageUrl
			? [guide.indexPageUrl]
			: [];

		return [
			guide?.frontCoverUrl || guide?.photoUrl || guide?.photo_url || null,
			guide?.backCoverUrl || null,
			...allIndexImages,
		].filter((url, index, arr) => typeof url === "string" && url && arr.indexOf(url) === index);
	};

	const shiftGuideImage = (guideId, totalImages, direction) => {
		if (!guideId || totalImages <= 1) return;

		setActiveImageIndexes((prev) => {
			const current = Number(prev[guideId] || 0);
			const nextIndex = (current + direction + totalImages) % totalImages;
			return { ...prev, [guideId]: nextIndex };
		});
	};

	const loadGuides = async (activeRef = { current: true }) => {
		try {
			const data = await getMyGuideListings();
			if (activeRef.current) setGuides(data || []);
		} finally {
			if (activeRef.current) setLoading(false);
		}
	};

	useEffect(() => {
		const activeRef = { current: true };
		loadGuides(activeRef);
		return () => {
			activeRef.current = false;
		};
	}, []);

	const handleMakeAvailable = async (e, guideId) => {
		e.stopPropagation();
		if (!guideId) return;

		setUpdatingGuideId(guideId);
		try {
			await markGuideAsAvailable(guideId);
			await loadGuides({ current: true });
			setAvailabilityMessageGuideId(guideId);
		} finally {
			setUpdatingGuideId(null);
		}
	};

	const handleGuideReceived = async (e, guideId) => {
		e.stopPropagation();
		if (!guideId) return;

		setReceivingGuideId(guideId);
		try {
			const selectedGuide = guides.find((g) => String(g?.id) === String(guideId));
			await markGuideAsReceivedBySeller(
				guideId,
				selectedGuide?.seller_id || selectedGuide?.sellerId || null
			);

			const rentalOrders = (selectedGuide?.orderActivity || []).filter(
				(order) => String(order?.type || "").trim().toLowerCase() === "rent"
			);

			await Promise.all(
				rentalOrders.map(async (order) => {
					const { buyerId, buyerEmail } = await resolveBuyerRecipient(order);
					if (!buyerId && !buyerEmail) {
						console.warn("Skipping seller received notification due to missing buyer recipient", order?.orderId || order?.id);
						return null;
					}

					return createNotification({
						recipientId: buyerId,
						recipientEmail: buyerEmail,
						actorName: selectedGuide?.seller || "Seller",
						type: "seller_received_guide",
						title: "Seller received the guide",
						message: `${selectedGuide?.seller || "Seller"} has received the guide return for ${selectedGuide?.title || "your rented guide"}.`,
						link: "/myorders",
						metadata: {
							guideId,
							orderId: order?.orderId || null,
							action: "seller_received",
						},
					}).catch((err) => {
						console.warn("Failed to notify buyer on seller received:", err?.message || err);
						return null;
					});
				})
			);

			await createNotificationForAdmins({
				actorId: selectedGuide?.seller_id || selectedGuide?.sellerId || null,
				actorName: selectedGuide?.seller || "Seller",
				type: "seller_received_guide",
				title: "Seller received returned guide",
				message: `${selectedGuide?.seller || "Seller"} marked ${selectedGuide?.title || "a rented guide"} as received.`,
				link: "/admin-monitoring",
				metadata: {
					guideId,
					sellerId: selectedGuide?.seller_id || selectedGuide?.sellerId || null,
					action: "seller_received",
				},
			}).catch((err) => {
				console.warn("Failed to notify admins on seller received:", err?.message || err);
				return null;
			});

			await loadGuides({ current: true });
		} finally {
			setReceivingGuideId(null);
		}
	};

	return (
		<div className="guide-listings-page">
			<div className="guide-listings-header">
				<div>
					<h1>My Guide Listings</h1>
					<p>Review the guides you have listed for sale or rent.</p>
				</div>
				<button type="button" className="guide-listings-back" onClick={() => navigate("/sell")}>
					Back to Sell Guide
				</button>
			</div>

			{loading ? (
				<div className="guide-listings-empty">Loading your listings...</div>
			) : guides.length === 0 ? (
				<div className="guide-listings-empty">You have not listed any guides yet.</div>
			) : (
				<div className="guide-listings-grid">
					{guides.map((guide) => {
						const hasRentalHistory = Number(guide.rentalOrders || 0) > 0;
						const isReceived = Boolean(guide?.sellerReceived);
						const showAvailabilityActions = guide.currentlyUnavailable || hasRentalHistory;
						const showAvailableMessage = availabilityMessageGuideId === guide.id && !guide.currentlyUnavailable;
						const guideImages = getGuideImages(guide);
						const activeImageIndex = Number(activeImageIndexes[guide.id] || 0) % Math.max(guideImages.length || 1, 1);
						const activeGuideImage = guideImages[activeImageIndex] || null;

						return (
							<div key={guide.id} className="guide-listing-card" onClick={() => navigate(`/guide/${guide.id}`, { state: { guide } })}>
								<div className="guide-listing-thumb">
									{activeGuideImage ? (
										<>
											<img src={activeGuideImage} alt={guide.title} className="guide-listing-image" />
											{guideImages.length > 1 && (
												<>
													<button
														type="button"
														className="guide-listing-thumb-nav guide-listing-thumb-prev"
														onClick={(e) => {
															e.stopPropagation();
															shiftGuideImage(guide.id, guideImages.length, -1);
														}}
														aria-label="Previous image"
													>
														‹
													</button>
													<button
														type="button"
														className="guide-listing-thumb-nav guide-listing-thumb-next"
														onClick={(e) => {
															e.stopPropagation();
															shiftGuideImage(guide.id, guideImages.length, 1);
														}}
														aria-label="Next image"
													>
														›
													</button>
													<div className="guide-listing-thumb-dots" onClick={(e) => e.stopPropagation()}>
														{guideImages.map((_, imageIndex) => (
															<span
																key={`${guide.id}-dot-${imageIndex}`}
																className={`guide-listing-thumb-dot ${imageIndex === activeImageIndex ? "active" : ""}`}
															/>
														))}
													</div>
												</>
										)}
									</>
									) : (
										<BookOpen size={40} />
									)}
								</div>
								<div className="guide-listing-body">
									<h3>{guide.title}</h3>
									<p>{guide.subject || guide.examType}</p>
									<div className="guide-listing-meta">
										<span>Status: {guide.status}</span>
										<span>
											Rental Status: {guide.currentlyUnavailable ? "Rented" : hasRentalHistory ? "Received" : "Available"}
										</span>
										{guide.hasRent && <span>Rent: ₹{guide.rentalPrice}</span>}
										{guide.hasBuy && <span>Buy: ₹{guide.buyPrice}</span>}
										<span>Purchases: {guide.purchaseOrders || 0}</span>
										<span>Rentals: {guide.rentalOrders || 0}</span>
									</div>

									{showAvailabilityActions && (
										<div className="guide-availability-block">
											<div className="guide-availability-row">
												<span className="guide-unavailable-pill">{guide.currentlyUnavailable ? "Currently Unavailable" : "Guide Available"}</span>
												<div className="guide-availability-actions">
													<button
														type="button"
														className="guide-received-btn"
														disabled={isReceived || receivingGuideId === guide.id || updatingGuideId === guide.id}
														onClick={(e) => handleGuideReceived(e, guide.id)}
													>
														{receivingGuideId === guide.id ? "Saving..." : isReceived ? "Received" : "Guide Received"}
													</button>
													<button
														type="button"
														className="make-available-btn"
														disabled={updatingGuideId === guide.id || receivingGuideId === guide.id}
														onClick={(e) => handleMakeAvailable(e, guide.id)}
													>
														{updatingGuideId === guide.id ? "Updating..." : "Make Available"}
													</button>
												</div>
											</div>
											<p className="guide-support-note">Go to contact support for further queries and complaints</p>
											{showAvailableMessage && <p className="guide-available-note">Guide available</p>}
										</div>
									)}

									<div className="guide-listing-orders">
										<h4>Orders ({guide.totalOrders || 0})</h4>
										{guide.orderActivity && guide.orderActivity.length > 0 ? (
											guide.orderActivity.map((order) => (
												<div key={order.orderId} className="guide-listing-order-item">
													<p><strong>{order.type === "rent" ? "Rental" : "Purchase"}</strong> by {order.buyerName}</p>
													<p>Order Date: {order.orderDate}</p>
													{order.type === "rent" && <p>Rental Period: {order.rentalPeriod} month(s)</p>}
													{order.type === "rent" && <p>Return Date: {order.returnDate}</p>}
													{order.type === "rent" && <p>Overdue Date: {order.overdueSince}</p>}
												</div>
											))
										) : (
											<p className="guide-listing-no-orders">No orders yet for this guide.</p>
										)}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

export default GuideListing;
