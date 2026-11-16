/** Search, filter, image fallbacks, and responsive navigation for the archive. */
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
      const isVisible = categoryMatches && searchMatches;
      card.hidden = !isVisible;
      if (isVisible) visibleCount += 1;
    });

    if (emptyState) emptyState.classList.toggle("is-visible", visibleCount === 0);
  }

  searchInput?.addEventListener("input", updateCollectionView);

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeCategory = button.dataset.filter || "all";
      filterButtons.forEach((candidate) => {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      });
      updateCollectionView();
    });
  });

  document.querySelectorAll(".collection-photo").forEach((image) => {
    image.addEventListener("error", () => {
      image.closest(".collection-card")?.classList.add("is-image-missing");
    }, { once: true });
  });

  if (menuButton && siteNavigation) {
    menuButton.addEventListener("click", () => {
      const expanded = menuButton.getAttribute("aria-expanded") === "true";
      menuButton.setAttribute("aria-expanded", String(!expanded));
      siteNavigation.classList.toggle("is-open", !expanded);
    });
    siteNavigation.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        menuButton.setAttribute("aria-expanded", "false");
        siteNavigation.classList.remove("is-open");
      });
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        menuButton.setAttribute("aria-expanded", "false");
        siteNavigation.classList.remove("is-open");
        menuButton.focus();
      }
    });
  }
});
