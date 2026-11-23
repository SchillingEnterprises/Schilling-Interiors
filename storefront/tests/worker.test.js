import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { parseCart, validProductInput, verifyStripeSignature } from "../src/worker.js";
test("cart parser accepts bounded product lines", () => assert.deepEqual(parseCart([{slug:"linen-napkin",quantity:2}]), [{slug:"linen-napkin",quantity:2}]));
test("cart parser combines duplicate lines and enforces quantity caps", () => {
 assert.deepEqual(parseCart([{slug:"linen-napkin",quantity:2},{slug:"linen-napkin",quantity:3}]), [{slug:"linen-napkin",quantity:5}]);
 assert.equal(parseCart([{slug:"linen-napkin",quantity:6},{slug:"linen-napkin",quantity:5}]), null);
});
test("cart parser rejects malformed slugs and quantities", () => {
 assert.equal(parseCart([{slug:"../admin",quantity:1}]), null);
 assert.equal(parseCart([{slug:"valid-item",quantity:0}]), null);
 assert.equal(parseCart(Array.from({length:21},(_,i)=>({slug:"item-"+i,quantity:1}))), null);
});
test("product validation requires complete, safe catalog fields", () => {
 const p={name:"Linen Napkin",slug:"linen-napkin",description:"Soft washed linen.",collection:"objects",image_url:"https://images.example.test/linen.jpg",price_cents:1800};
 assert.equal(validProductInput(p),true);
 assert.equal(validProductInput({...p,image_url:"javascript:alert(1)"}),false);
 assert.equal(validProductInput({...p,price_cents:-1}),false);
 assert.equal(validProductInput({...p,collection:"unknown"}),false);
});
test("product validation permits only safe partial updates", () => {
 assert.equal(validProductInput({active:false},true),true);
 assert.equal(validProductInput({inventory_quantity:-1},true),false);
 assert.equal(validProductInput({active:"yes"},true),false);
});
test("Stripe webhook signature accepts any valid v1 signature during secret rotation", async () => {
 const secret = "whsec-test-secret";
 const timestamp = Math.floor(Date.now() / 1000);
 const payload = '{"id":"evt_test"}';
 const signature = createHmac("sha256", secret).update(timestamp + "." + payload).digest("hex");
 assert.equal(await verifyStripeSignature(payload, "t=" + timestamp + ",v1=invalid,v1=" + signature, secret), true);
});
test("Stripe webhook signature rejects stale timestamps and invalid signatures", async () => {
 const secret = "whsec-test-secret";
 const timestamp = Math.floor(Date.now() / 1000) - 600;
 const payload = '{"id":"evt_test"}';
 const signature = createHmac("sha256", secret).update(timestamp + "." + payload).digest("hex");
 assert.equal(await verifyStripeSignature(payload, "t=" + timestamp + ",v1=" + signature, secret), false);
 assert.equal(await verifyStripeSignature(payload, "t=" + Math.floor(Date.now() / 1000) + ",v1=not-valid", secret), false);
});