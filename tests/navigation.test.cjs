"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createNavigationHarness() {
  const documentListeners = {};
  const buttonListeners = {};
  const navigationListeners = {};
  const attributes = { "aria-expanded": "false", "aria-label": "Open navigation" };
  const classes = new Set();
  let focusCount = 0;

  const menuButton = {
    addEventListener: (name, callback) => { buttonListeners[name] = callback; },
    getAttribute: (name) => attributes[name] ?? null,
    setAttribute: (name, value) => { attributes[name] = value; },
    focus: () => { focusCount += 1; },
  };
  const link = {
    addEventListener: (name, callback) => { navigationListeners[name] = callback; },
  };
  const siteNavigation = {
    classList: {
      toggle: (name, force) => {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
    querySelectorAll: () => [link],
  };
  const document = {
    addEventListener: (name, callback) => { documentListeners[name] = callback; },
    getElementById: (id) => ({
      "menu-toggle": menuButton,
      "site-nav": siteNavigation,
    })[id] ?? null,
    querySelectorAll: () => [],
  };

  const source = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "js", "index.js"),
    "utf8"
  );
  vm.runInNewContext(source, { document });
  documentListeners.DOMContentLoaded();

  return {
    attributes,
    classes,
    buttonListeners,
    navigationListeners,
    documentListeners,
    get focusCount() { return focusCount; },
  };
}

test("mobile navigation updates expanded state and accessible label", () => {
  const h = createNavigationHarness();
  h.buttonListeners.click();
  assert.equal(h.attributes["aria-expanded"], "true");
  assert.equal(h.attributes["aria-label"], "Close navigation");
  assert.equal(h.classes.has("is-open"), true);

  h.buttonListeners.click();
  assert.equal(h.attributes["aria-expanded"], "false");
  assert.equal(h.attributes["aria-label"], "Open navigation");
  assert.equal(h.classes.has("is-open"), false);
});

test("Escape closes navigation and restores focus to the toggle", () => {
  const h = createNavigationHarness();
  h.buttonListeners.click();
  h.documentListeners.keydown({ key: "Escape" });
  assert.equal(h.attributes["aria-expanded"], "false");
  assert.equal(h.attributes["aria-label"], "Open navigation");
  assert.equal(h.classes.has("is-open"), false);
  assert.equal(h.focusCount, 1);
});

test("selecting a navigation link closes the menu without stealing focus", () => {
  const h = createNavigationHarness();
  h.buttonListeners.click();
  h.navigationListeners.click();
  assert.equal(h.attributes["aria-expanded"], "false");
  assert.equal(h.classes.has("is-open"), false);
  assert.equal(h.focusCount, 0);
});
