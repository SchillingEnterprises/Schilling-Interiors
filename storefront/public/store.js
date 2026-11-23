const grid = document.getElementById("product-grid");
const catalogStatus = document.getElementById("catalog-status");
const emptyCatalog = document.getElementById("empty-catalog");
const cartContainer = document.getElementById("cart-items");
const cartCount = document.getElementById("cart-count");
const subtotalNode = document.getElementById("cart-subtotal");
const checkoutForm = document.getElementById("checkout-form");
const checkoutButton = document.getElementById("checkout-button");
const checkoutMessage = document.getElementById("checkout-message");
let products = []; let config = { checkoutEnabled: false, turnstileSiteKey: "" }; let captchaToken = ""; let widgetId = null;
let cart = loadCart();
function loadCart() {
  try { const value = JSON.parse(localStorage.getItem("schilling-store-cart") || "[]"); return Array.isArray(value) ? value.filter((item) => typeof item.id === "string" && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 10) : []; }
  catch { return []; }
}
function saveCart() { localStorage.setItem("schilling-store-cart", JSON.stringify(cart)); renderCart(); }
function money(cents) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }
function addText(parent, tag, value, className) {
  const item = document.createElement(tag); item.textContent = value; if (className) item.className = className; parent.append(item); return item;
}
function addToCart(id) {
  const found = cart.find((item) => item.id === id);
  if (found) found.quantity = Math.min(10, found.quantity + 1); else cart.push({ id, quantity: 1 });
  saveCart(); checkoutMessage.textContent = "Added to your bag.";
}
function renderProducts() {
  grid.replaceChildren(); emptyCatalog.hidden = products.length > 0;
  for (const product of products) {
    const article = document.createElement("article"); article.className = "product-card";
    const image = document.createElement("img"); image.className = "product-image"; image.src = product.imageUrl; image.alt = product.name; image.loading = "lazy"; image.referrerPolicy = "no-referrer"; article.append(image);
    const copy = document.createElement("div"); copy.className = "product-copy";
    addText(copy, "p", product.collection.toUpperCase(), "eyebrow"); addText(copy, "h3", product.name); addText(copy, "p", product.description);
    const bottom = document.createElement("div"); bottom.className = "product-bottom"; addText(bottom, "span", money(product.priceCents), "price");
    const button = addText(bottom, "button", product.inventoryQuantity === 0 ? "Sold out" : "Add to bag", "small-button");
    button.type = "button"; button.disabled = product.inventoryQuantity === 0; button.addEventListener("click", () => addToCart(product.id));
    copy.append(bottom); article.append(copy); grid.append(article);
  }
}
function renderCart() {
  cartContainer.replaceChildren(); let count = 0; let subtotal = 0;
  for (const item of cart) {
    const product = products.find((entry) => entry.id === item.id); if (!product) continue;
    const quantity = Math.min(item.quantity, product.inventoryQuantity === null ? 10 : Math.max(0, product.inventoryQuantity)); if (!quantity) continue;
    count += quantity; subtotal += quantity * product.priceCents;
    const row = document.createElement("div"); row.className = "cart-row"; const detail = document.createElement("div");
    addText(detail, "strong", product.name); addText(detail, "small", money(product.priceCents));
    const controls = document.createElement("div"); controls.className = "quantity-control";
    const minus = addText(controls, "button", "−"); minus.type = "button"; minus.setAttribute("aria-label", "Remove one " + product.name); minus.addEventListener("click", () => changeQuantity(item.id, -1));
    addText(controls, "span", String(quantity));
    const plus = addText(controls, "button", "+"); plus.type = "button"; plus.setAttribute("aria-label", "Add one " + product.name); plus.disabled = quantity >= 10 || (product.inventoryQuantity !== null && quantity >= product.inventoryQuantity); plus.addEventListener("click", () => changeQuantity(item.id, 1));
    const remove = addText(row, "button", "Remove", "remove"); remove.type = "button"; remove.addEventListener("click", () => { cart = cart.filter((entry) => entry.id !== item.id); saveCart(); });
    row.append(detail, controls, remove); cartContainer.append(row);
  }
  if (!count) addText(cartContainer, "p", "Your bag is currently empty.", "muted");
  cartCount.textContent = String(count); subtotalNode.textContent = money(subtotal); checkoutButton.disabled = !config.checkoutEnabled || !count || !captchaToken;
}
function changeQuantity(id, delta) {
  cart = cart.map((item) => item.id === id ? { ...item, quantity: Math.max(0, Math.min(10, item.quantity + delta)) } : item).filter((item) => item.quantity > 0); saveCart();
}
async function initialize() {
  try {
    const responses = await Promise.all([fetch("/api/config"), fetch("/api/products")]);
    if (responses.some((response) => !response.ok)) throw new Error("The store service is not connected yet.");
    config = await responses[0].json(); const data = await responses[1].json(); products = Array.isArray(data.products) ? data.products : [];
    catalogStatus.textContent = products.length + " products available"; renderProducts(); renderCart();
    if (!config.checkoutEnabled) checkoutMessage.textContent = "Checkout is not activated yet. The catalogue is available for browsing.";
    else if (!config.turnstileSiteKey) checkoutMessage.textContent = "The anti-bot service is not configured.";
    if (config.checkoutEnabled && config.turnstileSiteKey && window.turnstile) {
      widgetId = window.turnstile.render("#turnstile-widget", { sitekey: config.turnstileSiteKey, callback: (value) => { captchaToken = value; renderCart(); }, "expired-callback": () => { captchaToken = ""; renderCart(); }, "error-callback": () => { captchaToken = ""; renderCart(); } });
    }
    if (new URLSearchParams(location.search).get("cancelled") === "1") checkoutMessage.textContent = "Checkout was cancelled. Your bag is still here.";
  } catch (error) { catalogStatus.textContent = "Store service not connected"; checkoutMessage.textContent = error.message; checkoutButton.disabled = true; }
}
checkoutForm.addEventListener("submit", async (event) => {
  event.preventDefault(); if (!config.checkoutEnabled || !captchaToken || !cart.length) return;
  checkoutButton.disabled = true; checkoutMessage.textContent = "Preparing secure checkout…";
  try {
    const response = await fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: cart, email: document.getElementById("email").value.trim(), turnstileToken: captchaToken }) });
    const data = await response.json(); if (!response.ok || !data.url) throw new Error(data.error || "Checkout could not be started.");
    location.assign(data.url);
  } catch (error) {
    checkoutMessage.textContent = error.message; if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId); captchaToken = ""; renderCart();
  }
});
initialize();
