"use strict";
localStorage.removeItem("schilling-store-cart");
const status = document.querySelector("#order-status");
fetch("/api/health").then((response) => { if (!response.ok) throw new Error(); status.textContent = "If you have questions about your order, use the store contact details supplied at checkout."; }).catch(() => { status.textContent = "Your payment provider handles the receipt. You can safely close this page."; });