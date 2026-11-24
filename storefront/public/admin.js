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
    node(detail, "small", "Fulfillment: " + (order.fulfillmentStatus || "unfulfilled"));
    if (order.trackingCarrier || order.trackingNumber) node(detail, "small", [order.trackingCarrier, order.trackingNumber].filter(Boolean).join(" · "));
    if (order.refundStatus && order.refundStatus !== "none") node(detail, "small", "Refund: " + order.refundStatus + (order.refundAmountCents ? " · " + money(order.refundAmountCents) : ""));
    node(row, "code", order.id);
    if (order.status === "paid" && order.refundStatus === "none") {
      const refund = node(row, "button", "Issue full test refund", "small-button"); refund.type = "button";
      refund.addEventListener("click", async () => {
        if (!window.confirm("Issue a full refund through the Stripe test-mode account for this order?")) return;
        refund.disabled = true;
        try {
          await api("/api/admin/orders/" + order.id + "/refund", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true }) });
          await load();
        } catch (error) {
          statusNode.textContent = error.message;
          refund.disabled = false;
          await load().catch(() => {});
        }
      });
    }
    if (order.status === "paid") {
      const addressButton = node(row, "button", "View shipping address", "small-button"); addressButton.type = "button";
      addressButton.addEventListener("click", async () => {
        addressButton.disabled = true;
        try {
          const result = await api("/api/admin/orders/" + order.id + "/shipping");
          const address = result.shipping;
          const lines = [address.name, address.line1, address.line2, [address.city, address.state, address.postalCode].filter(Boolean).join(", "), address.country].filter(Boolean);
          node(detail, "small", "Shipping address: " + lines.join(" · "));
          addressButton.textContent = "Shipping address loaded";
        } catch (error) {
          statusNode.textContent = error.message;
          addressButton.disabled = false;
        }
      });
    }
    if (order.status === "paid" && order.fulfillmentStatus === "unfulfilled") {
      const start = node(row, "button", "Start processing", "small-button"); start.type = "button";
      start.addEventListener("click", async () => {
        try { await api("/api/admin/orders/" + order.id + "/fulfillment", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ fulfillmentStatus: "processing" }) }); await load(); }
        catch (error) { statusNode.textContent = error.message; }
      });
    } else if (order.status === "paid" && order.fulfillmentStatus === "processing") {
      const shipping = document.createElement("form"); shipping.className = "admin-form";
      const fields = [["Carrier", "trackingCarrier"], ["Tracking number", "trackingNumber"], ["HTTPS tracking URL", "trackingUrl"]];
      for (const [label, key] of fields) {
        const input = document.createElement("input"); input.type = "text"; input.required = true; input.maxLength = key === "trackingCarrier" ? 80 : key === "trackingNumber" ? 120 : 2048; input.placeholder = label; input.setAttribute("aria-label", label); input.value = order[key] || ""; input.dataset.field = key; shipping.append(input);
      }
      const submit = node(shipping, "button", "Save tracking and mark shipped", "small-button"); submit.type = "submit";
      shipping.addEventListener("submit", async (event) => {
        event.preventDefault(); const body = { fulfillmentStatus: "shipped" };
        for (const input of shipping.querySelectorAll("input")) body[input.dataset.field] = input.value.trim();
        try { await api("/api/admin/orders/" + order.id + "/fulfillment", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); await load(); }
        catch (error) { statusNode.textContent = error.message; }
      });
      row.append(shipping);
    } else if (order.status === "paid" && order.fulfillmentStatus === "shipped") {
      const complete = node(row, "button", "Mark fulfilled", "small-button"); complete.type = "button";
      complete.addEventListener("click", async () => {
        try { await api("/api/admin/orders/" + order.id + "/fulfillment", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ fulfillmentStatus: "fulfilled" }) }); await load(); }
        catch (error) { statusNode.textContent = error.message; }
      });
    }
    row.append(detail); orderList.append(row);
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
  try { await load(); }
  catch (error) { token = ""; statusNode.textContent = error.message; }
});
tokenInput.value = "";
form.addEventListener("submit", async (event) => {
  event.preventDefault(); if (!token) { statusNode.textContent = "Connect with the admin token first."; return; }
  const id = document.getElementById("product-id").value;
  const input = { name: document.getElementById("name").value.trim(), slug: document.getElementById("slug").value.trim(), description: document.getElementById("description").value.trim(), collection: document.getElementById("collection").value, imageUrl: document.getElementById("image-url").value.trim(), priceCents: Math.round(Number(document.getElementById("price").value) * 100), inventoryQuantity: document.getElementById("inventory").value === "" ? null : Number(document.getElementById("inventory").value), shippingRequired: document.getElementById("shipping-required").checked, active: document.getElementById("active").checked };
  try { await api(id ? "/api/admin/products/" + id : "/api/admin/products", { method: id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }); clearForm(); await load(); }
  catch (error) { statusNode.textContent = error.message; }
});
document.getElementById("reset-form").addEventListener("click", clearForm);

