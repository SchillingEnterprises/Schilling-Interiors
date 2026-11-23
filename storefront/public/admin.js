const tokenInput = document.getElementById("admin-token");
const connectButton = document.getElementById("connect");
const statusNode = document.getElementById("admin-status");
const productList = document.getElementById("product-list");
const orderList = document.getElementById("order-list");
const form = document.getElementById("product-form");
let token = ""; let products = [];
const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
function node(parent, tag, value, cls) { const item = document.createElement(tag); item.textContent = value; if (cls) item.className = cls; parent.append(item); return item; }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { authorization: "Bearer " + token, ...(options.headers || {}) } });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || "Admin request failed."); return data;
}
async function load() {
  const results = await Promise.all([api("/api/admin/products"), api("/api/admin/orders")]);
  products = results[0].products || []; renderProducts(); renderOrders(results[1].orders || []);
  statusNode.textContent = "Connected. " + products.length + " products loaded.";
}
function renderProducts() {
  productList.replaceChildren(); if (!products.length) node(productList, "p", "No products yet. Add only products you are authorized to sell.");
  for (const product of products) {
    const row = document.createElement("div"); row.className = "admin-row"; const title = document.createElement("div");
    node(title, "strong", product.name); node(title, "small", money(product.priceCents) + " · " + (product.active ? "Published" : "Draft") + " · " + (product.inventoryQuantity === null ? "Unlimited stock" : product.inventoryQuantity + " in stock"));
    const actions = document.createElement("div"); const edit = node(actions, "button", "Edit", "small-button"); edit.type = "button"; edit.addEventListener("click", () => editProduct(product));
    const toggle = node(actions, "button", product.active ? "Unpublish" : "Publish", "small-button"); toggle.type = "button";
    toggle.addEventListener("click", async () => {
      try { await api("/api/admin/products/" + product.id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...product, active: !product.active, inventoryQuantity: product.inventoryQuantity, imageUrl: product.imageUrl, priceCents: product.priceCents, shippingRequired: Boolean(product.shippingRequired) }) }); await load(); }
      catch (error) { statusNode.textContent = error.message; }
    });
    row.append(title, actions); productList.append(row);
  }
}
function renderOrders(orders) {
  orderList.replaceChildren(); if (!orders.length) node(orderList, "p", "No orders have been placed.");
  for (const order of orders) {
    const row = document.createElement("div"); row.className = "admin-row"; const detail = document.createElement("div");
    node(detail, "strong", order.status.toUpperCase() + " · " + money(order.amountTotalCents ?? order.subtotalCents));
    node(detail, "small", order.createdAt + " · " + order.items.map((item) => item.quantity + " × " + item.name).join(", "), "order-items");
    node(row, "code", order.id); row.append(detail); orderList.append(row);
  }
}
function editProduct(product) {
  document.getElementById("product-id").value = product.id; document.getElementById("name").value = product.name;
  document.getElementById("slug").value = product.slug; document.getElementById("description").value = product.description;
  document.getElementById("collection").value = product.collection; document.getElementById("image-url").value = product.imageUrl;
  document.getElementById("price").value = (product.priceCents / 100).toFixed(2); document.getElementById("inventory").value = product.inventoryQuantity ?? "";
  document.getElementById("shipping-required").checked = Boolean(product.shippingRequired); document.getElementById("active").checked = Boolean(product.active);
  document.getElementById("product-form-heading").textContent = "Edit a product"; form.scrollIntoView({ behavior: "smooth", block: "start" });
}
function clearForm() { form.reset(); document.getElementById("product-id").value = ""; document.getElementById("product-form-heading").textContent = "Add a product"; document.getElementById("shipping-required").checked = true; }
connectButton.addEventListener("click", async () => {
  token = tokenInput.value.trim();
  try { await load(); sessionStorage.setItem("schilling-admin-token", token); }
  catch (error) { token = ""; statusNode.textContent = error.message; }
});
tokenInput.value = sessionStorage.getItem("schilling-admin-token") || "";
form.addEventListener("submit", async (event) => {
  event.preventDefault(); if (!token) { statusNode.textContent = "Connect with the admin token first."; return; }
  const id = document.getElementById("product-id").value;
  const input = { name: document.getElementById("name").value.trim(), slug: document.getElementById("slug").value.trim(), description: document.getElementById("description").value.trim(), collection: document.getElementById("collection").value, imageUrl: document.getElementById("image-url").value.trim(), priceCents: Math.round(Number(document.getElementById("price").value) * 100), inventoryQuantity: document.getElementById("inventory").value === "" ? null : Number(document.getElementById("inventory").value), shippingRequired: document.getElementById("shipping-required").checked, active: document.getElementById("active").checked };
  try { await api(id ? "/api/admin/products/" + id : "/api/admin/products", { method: id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }); clearForm(); await load(); }
  catch (error) { statusNode.textContent = error.message; }
});
document.getElementById("reset-form").addEventListener("click", clearForm);
if (tokenInput.value) connectButton.click();
