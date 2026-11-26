const statusNode = document.getElementById("order-status");
const trackingNode = document.getElementById("tracking-status");
const sessionId = new URLSearchParams(location.search).get("session_id");
if (!sessionId || !/^cs_test_[A-Za-z0-9]+$/.test(sessionId)) {
  statusNode.textContent = "No valid test checkout session was supplied. Check your Stripe receipt for the latest payment status.";
} else {
  fetch("/api/order-status?session_id=" + encodeURIComponent(sessionId))
    .then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to look up this order.");
      statusNode.textContent = data.status === "paid"
        ? "Payment confirmed. Thank you for your order."
        : ["failed", "expired", "canceled"].includes(data.status)
          ? "Checkout ended without payment. No payment was confirmed. You can return to the shop and try again."
          : "Payment is still being confirmed. Your Stripe receipt is the source of truth.";
      if (data.tracking) {
        trackingNode.textContent = "Fulfillment: " + data.fulfillmentStatus + " · " + data.tracking.carrier + " · " + data.tracking.number + " ";
        const link = document.createElement("a");
        link.href = data.tracking.url;
        link.textContent = "Track shipment";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        trackingNode.append(link);
      } else if (data.status === "paid") {
        trackingNode.textContent = "Order fulfillment: " + data.fulfillmentStatus + ". Tracking will appear here after the order ships.";
      }
    })
    .catch(() => { statusNode.textContent = "Payment status is being processed. Please check your Stripe receipt for confirmation."; });
}
