const statusNode = document.getElementById("order-status");
const sessionId = new URLSearchParams(location.search).get("session_id");
if (!sessionId || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
  statusNode.textContent = "No valid checkout session was supplied. Check your Stripe receipt for the latest payment status.";
} else {
  fetch("/api/order-status?session_id=" + encodeURIComponent(sessionId))
    .then(async (response) => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to look up this order.");
      statusNode.textContent = data.status === "paid" ? "Payment confirmed. Thank you for your order." : "Payment is still being confirmed. Your Stripe receipt is the source of truth.";
    })
    .catch(() => { statusNode.textContent = "Payment status is being processed. Please check your Stripe receipt for confirmation."; });
}
