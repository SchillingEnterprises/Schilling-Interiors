"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add: (name) => values.add(name),
    contains: (name) => values.has(name),
    toggle: (name, force) => {
      const enabled = force === undefined ? !values.has(name) : force;
      if (enabled) values.add(name);
      else values.delete(name);
      return enabled;
    },
    has: (name) => values.has(name),
  };
}

function makeCard(category, search) {
  return {
    dataset: { category, search },
    hidden: false,
    classList: makeClassList(),
  };
}

function makeFilter(category) {
  const attributes = { "aria-pressed": category === "all" ? "true" : "false" };
  const listeners = {};
  return {
    dataset: { filter: category },
    attributes,
    listeners,
    addEventListener: (name, callback) => { listeners[name] = callback; },
    setAttribute: (name, value) => { attributes[name] = value; },
  };
}

function createArchiveHarness({ images = [] } = {}) {
  const documentListeners = {};
  const cards = [
    makeCard("fashion", "nina mclemore fashion"),
    makeCard("interiors", "jonathan charles fine furniture"),
    makeCard("objects", "juliska dinnerware tabletop"),
    makeCard("objects", "alynn neckwear accessories"),
  ];
  const filters = ["all", "fashion", "interiors", "objects"].map(makeFilter);
  const searchListeners = {};
  const searchInput = {
    value: "",
    addEventListener: (name, callback) => { searchListeners[name] = callback; },
  };
  const emptyClasses = makeClassList();
  const emptyState = { classList: emptyClasses };
  const menuButton = {
    getAttribute: () => "false",
    setAttribute: () => {},
    addEventListener: () => {},
  };
  const siteNavigation = {
    classList: { toggle: () => {} },
    querySelectorAll: () => [],
  };
  const document = {
    addEventListener: (name, callback) => { documentListeners[name] = callback; },
    getElementById: (id) => ({
      "collection-search": searchInput,
      "empty-state": emptyState,
      "menu-toggle": menuButton,
      "site-nav": siteNavigation,
    })[id] ?? null,
    querySelectorAll: (selector) => {
      if (selector === ".collection-card") return cards;
      if (selector === "[data-filter]") return filters;
      if (selector === ".collection-photo, .gallery-item img") return images;
      return [];
    },
  };

  const source = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "js", "index.js"),
    "utf8"
  );
  vm.runInNewContext(source, { document });
  documentListeners.DOMContentLoaded();

  return { cards, filters, searchInput, searchListeners, emptyClasses };
}

test("archive search matches collection names without case sensitivity", () => {
  const h = createArchiveHarness();
  h.searchInput.value = "NINA";
  h.searchListeners.input();

  assert.deepEqual(h.cards.map((card) => card.hidden), [false, true, true, true]);
  assert.equal(h.emptyClasses.has("is-visible"), false);
});

test("category filters and search combine instead of replacing each other", () => {
  const h = createArchiveHarness();
  const objects = h.filters.find((button) => button.dataset.filter === "objects");
  objects.listeners.click();

  assert.equal(objects.attributes["aria-pressed"], "true");
  assert.equal(h.filters[0].attributes["aria-pressed"], "false");
  assert.deepEqual(h.cards.map((card) => card.hidden), [true, true, false, false]);

  h.searchInput.value = "juliska";
  h.searchListeners.input();
  assert.deepEqual(h.cards.map((card) => card.hidden), [true, true, false, true]);
});

test("no matching search result announces the empty state", () => {
  const h = createArchiveHarness();
  h.searchInput.value = "not in this archive";
  h.searchListeners.input();

  assert.ok(h.cards.every((card) => card.hidden));
  assert.equal(h.emptyClasses.has("is-visible"), true);
});

test("a failed collection preview marks its card for the CSS fallback", () => {
  const card = makeCard("fashion", "nina");
  const listeners = {};
  const image = {
    complete: false,
    naturalWidth: 100,
    addEventListener: (name, callback) => { listeners[name] = callback; },
    matches: (selector) => selector === ".collection-photo",
    closest: (selector) => selector === ".collection-card" ? card : null,
  };
  createArchiveHarness({ images: [image] });
  listeners.error();

  assert.equal(card.classList.has("is-image-missing"), true);
});

test("a failed detail-gallery image reveals its adjacent fallback", () => {
  const listeners = {};
  const fallback = { hidden: true };
  const card = makeCard("interiors", "furniture");
  const image = {
    complete: false,
    naturalWidth: 100,
    hidden: false,
    nextElementSibling: {
      hidden: true,
      classList: { contains: (name) => name === "image-fallback" },
    },
    addEventListener: (name, callback) => { listeners[name] = callback; },
    matches: () => false,
    closest: () => card,
  };
  image.nextElementSibling = fallback;
  image.nextElementSibling.classList = { contains: (name) => name === "image-fallback" };
  createArchiveHarness({ images: [image] });
  listeners.error();

  assert.equal(image.hidden, true);
  assert.equal(fallback.hidden, false);
});

test("an already-failed gallery image is handled during initialization", () => {
  const fallback = { hidden: true, classList: { contains: (name) => name === "image-fallback" } };
  const image = {
    complete: true,
    naturalWidth: 0,
    hidden: false,
    nextElementSibling: fallback,
    addEventListener: () => {},
    matches: () => false,
    closest: () => null,
  };
  createArchiveHarness({ images: [image] });

  assert.equal(image.hidden, true);
  assert.equal(fallback.hidden, false);
});

test("the archive preserves exactly the six approved collections and excludes Carlisle", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const collectionCards = html.match(/<article class="collection-card"/g) || [];
  const approved = [
    "Alynn Neckwear",
    "Jonathan Charles Fine Furniture",
    "Juliska Dinnerware",
    "Nina McLemore",
    "Rosanna",
    "Toss Designs",
  ];

  assert.equal(collectionCards.length, 6);
  for (const name of approved) assert.ok(html.includes(name), `Missing approved collection: ${name}`);
  assert.equal(/Carlisle/i.test(html), false);
});
