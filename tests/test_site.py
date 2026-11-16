"""Dependency-free structural checks for the Schilling Interiors archive."""

from html.parser import HTMLParser
from pathlib import Path
import unittest
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
BRAND_PAGES = sorted((ROOT / "html").glob("*.html"))
EXPECTED_PAGES = {
    "Alynn-Neckwear.html",
    "Jonathan-Charles-Fine-Furniture.html",
    "Juliska-Dinnerware.html",
    "Nina-McLemore.html",
    "Rosanna.html",
    "Toss-Designs.html",
}


class DocumentParser(HTMLParser):
    """Collect local resources, images, semantic landmarks, and page forms."""

    def __init__(self):
        super().__init__()
        self.resources = []
        self.images_without_alt = []
        self.images = []
        self.external_blank_links = []
        self.landmarks = set()
        self.has_language = False

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        if tag == "html":
            self.has_language = bool(attributes.get("lang"))
        if tag in {"header", "main", "footer", "nav"}:
            self.landmarks.add(tag)
        for attribute in ("href", "src"):
            reference = attributes.get(attribute, "")
            parsed = urlparse(reference)
            if (
                reference
                and not parsed.scheme
                and not reference.startswith(("#", "data:"))
                and not reference.startswith("mailto:")
            ):
                self.resources.append(unquote(parsed.path))
        if tag == "img":
            self.images.append(attributes)
            if not attributes.get("alt", "").strip():
                self.images_without_alt.append(attributes.get("src", "(unnamed image)"))
        if tag == "a" and attributes.get("target") == "_blank":
            self.external_blank_links.append(attributes)


class StaticArchiveTests(unittest.TestCase):
    """Protect the six-collection static archive from regressions."""

    def setUp(self):
        self.html_files = [ROOT / "index.html", *BRAND_PAGES]

    def test_homepage_and_exactly_six_brand_pages_are_present(self):
        self.assertTrue((ROOT / "index.html").is_file())
        self.assertTrue((ROOT / "404.html").is_file())
        self.assertTrue((ROOT / "robots.txt").is_file())
        self.assertEqual({path.name for path in BRAND_PAGES}, EXPECTED_PAGES)
        self.assertFalse((ROOT / "html" / "Carlisle-Collection.html").exists())

    def test_every_html_document_has_language_and_semantic_landmarks(self):
        for document_path in self.html_files:
            with self.subTest(document=document_path.relative_to(ROOT)):
                parser = DocumentParser()
                parser.feed(document_path.read_text(encoding="utf-8"))
                self.assertTrue(parser.has_language)
                self.assertIn("main", parser.landmarks)
                self.assertIn("header", parser.landmarks)
                self.assertIn("footer", parser.landmarks)

    def test_all_local_references_resolve(self):
        missing = []
        for document_path in self.html_files:
            parser = DocumentParser()
            parser.feed(document_path.read_text(encoding="utf-8"))
            for reference in parser.resources:
                target = (document_path.parent / reference).resolve()
                if not target.exists():
                    missing.append(
                        f"{document_path.relative_to(ROOT)} -> {reference}"
                    )
        self.assertEqual(missing, [], f"Missing local files: {missing}")

    def test_all_images_have_descriptive_alt_text(self):
        failures = []
        for document_path in self.html_files:
            parser = DocumentParser()
            parser.feed(document_path.read_text(encoding="utf-8"))
            if parser.images_without_alt:
                failures.append(
                    f"{document_path.relative_to(ROOT)}: {parser.images_without_alt}"
                )
        self.assertEqual(failures, [])

    def test_homepage_has_six_real_photo_previews(self):
        homepage = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertEqual(homepage.count('class="collection-photo"'), 6)
        self.assertEqual(homepage.count('class="collection-card"'), 6)
        self.assertIn("photo-fallback", homepage)
        self.assertIn("is-image-missing", (ROOT / "scripts/js/index.js").read_text(encoding="utf-8"))
        self.assertNotIn("Carlisle", homepage)

    def test_homepage_links_to_each_preserved_brand_page(self):
        homepage = (ROOT / "index.html").read_text(encoding="utf-8")
        for page_name in EXPECTED_PAGES:
            with self.subTest(brand_page=page_name):
                self.assertIn(f"./html/{page_name}", homepage)

    def test_furniture_archive_has_a_still_image_and_original_video(self):
        furniture = (ROOT / "html" / "Jonathan-Charles-Fine-Furniture.html").read_text(encoding="utf-8")
        self.assertIn("video-still", furniture)
        self.assertIn("img.youtube.com/vi/82JFOL5tGiE", furniture)
        self.assertIn("youtube.com/embed/82JFOL5tGiE", furniture)

    def test_collection_images_use_lazy_loading_and_safe_referrer_policy(self):
        failures = []
        for document_path in self.html_files:
            parser = DocumentParser()
            parser.feed(document_path.read_text(encoding="utf-8"))
            for image in parser.images:
                if image.get("loading") != "lazy":
                    failures.append(f"{document_path.name}: missing lazy loading for {image.get('src')}")
                if image.get("decoding") != "async":
                    failures.append(f"{document_path.name}: missing async decoding for {image.get('src')}")
                if image.get("referrerpolicy") != "no-referrer":
                    failures.append(f"{document_path.name}: missing no-referrer policy for {image.get('src')}")
        self.assertEqual(failures, [])

    def test_new_tab_links_use_noopener_and_noreferrer(self):
        failures = []
        for document_path in self.html_files:
            parser = DocumentParser()
            parser.feed(document_path.read_text(encoding="utf-8"))
            for link in parser.external_blank_links:
                rel = set(link.get("rel", "").lower().split())
                if not {"noopener", "noreferrer"}.issubset(rel):
                    failures.append(f"{document_path.name}: unsafe target blank link {link.get('href')}")
        self.assertEqual(failures, [])

    def test_gallery_fallbacks_are_centralized_and_cover_all_image_pages(self):
        shared_script = (ROOT / "scripts/js/index.js").read_text(encoding="utf-8")
        self.assertIn(".collection-photo, .gallery-item img", shared_script)
        self.assertIn("image-fallback", shared_script)
        for document_path in BRAND_PAGES:
            html = document_path.read_text(encoding="utf-8")
            self.assertNotIn('document.querySelectorAll(".gallery-item img")', html)
            self.assertIn("../scripts/js/index.js", html)

    def test_pages_workflow_uploads_only_the_approved_public_artifact(self):
        workflow = (ROOT / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")
        self.assertIn("mkdir -p dist", workflow)
        self.assertIn("for page in index.html 404.html robots.txt", workflow)
        self.assertIn("for directory in html styles scripts", workflow)
        self.assertIn("path: dist", workflow)
        self.assertIn("test ! -e dist/.github", workflow)
        self.assertIn("test ! -e dist/tests", workflow)
        self.assertNotIn("path: .", workflow)

    def test_archive_search_and_filter_controls_are_present(self):
        homepage = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="collection-search"', homepage)
        self.assertIn('data-filter="all"', homepage)
        self.assertIn('aria-pressed="true"', homepage)


if __name__ == "__main__":
    unittest.main(verbosity=2)
