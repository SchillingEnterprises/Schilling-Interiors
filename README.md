# Schilling Interiors — Brand Archive

A responsive, static archive of seven brand collections preserved from an earlier Schilling Interiors project.

## Run locally

From the repository root:

```bash
python -m http.server 8000
```

Open `http://localhost:8000` in a browser.

## Browse the archive

The home page includes instant search and category filters. Each brand page contains the preserved third-party imagery or video references.

## Quality checks

Run the dependency-free test suite:

```bash
python -m unittest discover -s tests -v
node --check scripts/js/index.js
```

GitHub Actions runs these checks on pull requests and deploys the static archive to GitHub Pages after changes merge to `master`. In Settings → Pages, select **GitHub Actions** as the build source if it is not already selected.

## Important archive and privacy notes

- This is not a live shop, checkout, customer portal, or current representation of the listed brands.
- Existing brand pages and references are preserved, but the imagery is hosted by third parties and may disappear.
- The static site does not collect customer information or offer authentication.
- Personal contact metadata was removed from the public HTML.
- Verify all brand relationships, image permissions, contact details, and product availability before presenting this archive as a current business.
- No paid services, backend, or runtime package dependencies are required.
