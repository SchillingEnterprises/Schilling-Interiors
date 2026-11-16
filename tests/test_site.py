"""Dependency-free structural checks for the Schilling Interiors archive."""

from html.parser import HTMLParser
from pathlib import Path
import unittest
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
BRAND_PAGES = sorted((ROOT / "html").glob("*.html"))


class DocumentParser(HTMLParser):
    """Collect local resources, images, semantic landmarks, and page forms."""

    def __init__(self):
        super().__init__()
        self.resources = []
        self.images_without_alt = []
        self.landmarks = set()
        self.forms = []
        self.has_language = False

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        if tag == "html":
            self.has_language = bool(attributes.get("lang"))
        if tag in {"header", "main", "footer", "nav"}:
            self.landmarks.add(tag)
        if tag == "form":
            self.forms.append(attributes)
        for attribute in ("href", "src"):
            reference = attributes.get(attribute, "")
            parsed = urlparse(reference)
            if (
                reference
                and not parsed.scheme
                and not reference.startswith(("#", "data:"))
                and not reference.startswith("mailto:")
            ):
                self.resources.append(unquote(reference.split("?", 1)[0]))
        if tag == "img" and not attributes.get("alt", "").strip():
            self.images_without_alt.append(attributes.get("src", "(unnamed image)"))


class StaticArchiveTests(unittest.TestCase):
    """Protect all static pages from broken local resources and regressions."""

    def setUp(self):
        self.html_files = [ROOT / "index.html", *BRAND_PAGES]

    def test_homepage_and_all_seven_brand_pages_are_present(self):
        self.assertTrue((ROOT / "index.html").is_file())
        self.assertEqual(len(BRAND_PAGES), 7)

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

    def test_archive_does_not_publish_personal_contact_metadata_or_fake_login(self):
        for document_path in self.html_files:
            html = document_path.read_text(encoding="utf-8").lower()
            self.assertNotIn("<address", html)
            self.assertNotIn("tel:", html)
            self.assertNotIn('type="password"', html)
            self.assertNotIn("login__submit", html)

    def test_homepage_links_to_each_preserved_brand_page(self):
        homepage = (ROOT / "index.html").read_text(encoding="utf-8")
        for document_path in BRAND_PAGES:
            relative_path = f"./html/{document_path.name}"
            with self.subTest(brand_page=relative_path):
                self.assertIn(relative_path, homepage)

    def test_archive_search_and_filter_controls_are_present(self):
        homepage = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="collection-search"', homepage)
        self.assertIn('data-filter="all"', homepage)
        self.assertIn('aria-pressed="true"', homepage)


if __name__ == "__main__":
    unittest.main(verbosity=2)
