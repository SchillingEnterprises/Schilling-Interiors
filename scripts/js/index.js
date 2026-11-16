/** Shared archive behavior: search, navigation, and resilient imagery. */
document.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("collection-search");
  const cards = [...document.querySelectorAll(".collection-card")];
  const filterButtons = [...document.querySelectorAll("[data-filter]")];
  const emptyState = document.getElementById("empty-state");
  const menuButton = document.getElementById("menu-toggle");
  const siteNavigation = document.getElementById("site-nav");
  let activeCategory = "all";

  function updateCollectionView() {
    const query = (searchInput?.value || "").trim().toLowerCase();
    let visibleCount = 0;
    cards.forEach((card) => {
      const categoryMatches = activeCategory === "all" || card.dataset.category === activeCategory;
      const searchMatches = (card.dataset.search || "").toLowerCase().includes(query);
      const visible = categoryMatches && searchMatches;
      card.hidden = !visible;
      if (visible) visibleCount += 1;
    });
    if (emptyState) emptyState.classList.toggle("is-visible", visibleCount === 0);
  }

  function showGalleryFallback(image) {
    image.hidden = true;
    const fallback = image.nextElementSibling;
    if (fallback?.classList.contains("image-fallback")) fallback.hidden = false;
  }

  function bindImageFallback(image) {
    image.addEventListener("error", () => {
      if (image.matches(".collection-photo")) {
        image.closest(".collection-card")?.classList.add("is-image-missing");
      } else {
        showGalleryFallback(image);
      }
    }, { once: true });
    if (image.complete && image.naturalWidth === 0) {
      if (image.matches(".collection-photo")) {
        image.closest(".collection-card")?.classList.add("is-image-missing");
      } else {
        showGalleryFallback(image);
      }
    }
  }

  function setNavigationOpen(isOpen, { restoreFocus = false } = {}) {
    menuButton.setAttribute("aria-expanded", String(isOpen));
    menuButton.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
    siteNavigation.classList.toggle("is-open", isOpen);
    if (restoreFocus) menuButton.focus();
  }

  searchInput?.addEventListener("input", updateCollectionView);
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeCategory = button.dataset.filter || "all";
      filterButtons.forEach((candidate) =>
        candidate.setAttribute("aria-pressed", String(candidate === button))
      );
      updateCollectionView();
    });
  });

  document.querySelectorAll(".collection-photo, .gallery-item img").forEach(bindImageFallback);

  if (menuButton && siteNavigation) {
    menuButton.addEventListener("click", () => {
      const expanded = menuButton.getAttribute("aria-expanded") === "true";
      setNavigationOpen(!expanded);
    });
    siteNavigation.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => setNavigationOpen(false));
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
        setNavigationOpen(false, { restoreFocus: true });
      }
    });
  }
});
