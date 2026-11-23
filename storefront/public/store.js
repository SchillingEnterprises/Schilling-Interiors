"use strict";
const $ = (selector) => document.querySelector(selector);
const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
let products = [];
let cart = loadCart();
function loadCart() {
  try { const value = JSON.parse(localStorage.getItem("schilling-store-cart") || "[]"); return Array.isArray(value) ? value.filter((line) => line && typeof line.slug === "string" && Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 10) : []; }
  catch { return []; }
}
function saveCart() { localStorage.setItem("schilling-store-cart", JSON.stringify(cart)); renderCart(); }
function renderProducts() {
  const query = $("#product-search").value.trim().toLowerCase();
  const visible = products.filter((p) => (p.name + " " + p.description + " " + p.collection).toLowerCase().includes(query));
  $("#product-grid").innerHTML = visible.map((p) => {
    const available = p.inventory_quantity === null;
    const count = cart.find((line) => line.slug === p.slug)?.quantity || 0;
    return '<article class="product-card"><img src="' + escapeHtml(p.image_url) + '" alt="' + escapeHtml(p.name) + '" loading="lazy"><div class="product-copy"><p class="eyebrow">' + escapeHtml(p.collection) + '</p><h3>' + escapeHtml(p.name) + '</h3><p>' + escapeHtml(p.description) + '</p><p class="price">' + money(p.price_cents) + '</p><button class="add-button" type="button" data-add="' + escapeHtml(p.slug) + '"' + (!available ? " disabled" : "") + '>' + (!available ? "Temporarily unavailable" : count ? "Add another (" + count + ")" : "Add to bag") + '</button></div></article>';
  }).join("");
  if (!visible.length) $("#product-grid").innerHTML = '<p class="status">No products are available in this view yet.</p>';
}
function renderCart() {
  $("#cart-lines").innerHTML = cart.map((line) => {
    const p = products.find((item) => item.slug === line.slug);
    return p ? '<div class="cart-line"><div><strong>' + escapeHtml(p.name) + '</strong><p>' + line.quantity + ' × ' + money(p.price_cents) + '</p></div><button type="button" data-remove="' + escapeHtml(p.slug) + '">Remove</button></div>' : "";
  }).join("") || "<p>Your bag is empty.</p>";
  const total = cart.reduce((sum, line) => sum + (products.find((p) => p.slug === line.slug)?.price_cents || 0) * line.quantity, 0);
  $("#cart-subtotal").textContent = money(total);
  $("#cart-count").textContent = cart.reduce((sum, line) => sum + line.quantity, 0);
  $("#checkout").disabled = !cart.length;
}
function setCartOpen(open) {
  $("#cart-panel").classList.toggle("is-open", open);
  $("#cart-panel").setAttribute("aria-hidden", String(!open));
  $("#cart-open").setAttribute("aria-expanded", String(open));
  $("#cart-scrim").hidden = !open;
}
async function start() {
  try {
    const response = await fetch("/api/products", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error();
    const data = await response.json();
    products = Array.isArray(data.products) ? data.products : [];
    cart = cart.filter((line) => products.some((p) => p.slug === line.slug));
    saveCart(); renderProducts();
    $("#store-status").textContent = products.length ? "A considered edit, updated as products become available." : "The storefront is being prepared. Products will appear once the catalog is approved and published.";
  } catch { $("#store-status").textContent = "The shop is temporarily unavailable. Please try again later."; }
}
$("#product-search").addEventListener("input", renderProducts);
$("#product-grid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-add]"); if (!button) return;
  const slug = button.dataset.add, line = cart.find((item) => item.slug === slug);
  if (line) { if (line.quantity >= 10) return; line.quantity += 1; } else cart.push({ slug, quantity: 1 });
  saveCart(); renderProducts();
});
$("#cart-lines").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]"); if (!button) return;
  cart = cart.filter((line) => line.slug !== button.dataset.remove); saveCart(); renderProducts();
});
$("#cart-open").addEventListener("click", () => setCartOpen(true));
$("#cart-close").addEventListener("click", () => setCartOpen(false));
$("#cart-scrim").addEventListener("click", () => setCartOpen(false));
$("#checkout").addEventListener("click", async () => {
  const button = $("#checkout"), status = $("#checkout-status"); button.disabled = true; status.textContent = "Connecting to secure checkout…";
  try {
    const response = await fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ items: cart }) });
    const result = await response.json();
    if (!response.ok || !result.url) throw new Error(result.error || "Checkout is not available.");
    window.location.assign(result.url);
  } catch (error) { status.textContent = error.message || "Checkout could not be started."; button.disabled = false; }
});
start();