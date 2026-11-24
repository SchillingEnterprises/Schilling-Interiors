from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class PagesArtifactBoundaryTests(unittest.TestCase):
    def test_legacy_pages_build_excludes_engineering_and_storefront_sources(self):
        config = (ROOT / "_config.yml").read_text(encoding="utf-8")
        excluded = {
            line.strip()[2:].strip().strip("\"'")
            for line in config.splitlines()
            if line.strip().startswith("- ")
        }
        self.assertTrue(
            {".github", ".gitignore", "README.md", "SECURITY.md", "storefront", "tests"}
            .issubset(excluded)
        )

    def test_jekyll_must_process_the_exclusion_configuration(self):
        self.assertFalse((ROOT / ".nojekyll").exists())
        self.assertTrue((ROOT / "_config.yml").is_file())

    def test_archive_pages_and_assets_remain_available(self):
        for path in (
            "index.html",
            "404.html",
            "robots.txt",
            "html/Alynn-Neckwear.html",
            "html/Jonathan-Charles-Fine-Furniture.html",
            "html/Juliska-Dinnerware.html",
            "html/Nina-McLemore.html",
            "html/Rosanna.html",
            "html/Toss-Designs.html",
            "styles/css/style.css",
            "scripts/js/index.js",
        ):
            with self.subTest(path=path):
                self.assertTrue((ROOT / path).is_file(), path)


if __name__ == "__main__":
    unittest.main()
