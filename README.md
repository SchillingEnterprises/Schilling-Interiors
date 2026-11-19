# Schilling Interiors — Six-Collection Photo Archive

A responsive, image-led static archive of six preserved brand collections from an earlier Schilling Interiors project.

## Browse the archive

The homepage presents all six collections as photographic preview cards, with instant search and category filters. Each collection opens a dedicated image or video archive:

- Alynn Neckwear — silk patterns and accessories
- Jonathan Charles Fine Furniture — original video reference with a thumbnail preview
- Juliska Dinnerware — kitchen and tabletop imagery
- Nina McLemore — Spring 2020 fashion references
- Rosanna — tabletop, gifting, and lifestyle references
- Toss Designs — accessories and gift references

The Carlisle Collection archive page and homepage listing have been removed.

## Run locally

From the repository root:

```bash
python -m http.server 8000
```

Open `http://localhost:8000` in a browser.

## Quality checks

Run the dependency-free test suite:

```bash
python -m unittest discover -s tests -v
node --check scripts/js/index.js
```

GitHub Actions runs these checks on pull requests and deploys the static archive to GitHub Pages after changes merge to `master`. In Settings → Pages, select **GitHub Actions** as the build source if it is not already selected.

## Important archive and image notes

- This is not a live shop, checkout, customer portal, or current representation of the listed brands.
- Photo previews and collection images are loaded from their original third-party sources; a source may block hotlinking, change its URL, or remove the image. A designed fallback is shown when a homepage preview fails.
- Images have intentionally not been copied into this repository. Usage rights and commercial permissions must be confirmed with the relevant rights holders.
- The static site does not collect customer information or offer authentication.
- GitHub Pages serves a branded `404.html` page for unknown routes; `robots.txt` permits indexing of the public archive.
- Personal contact metadata was removed from the public HTML.
- Verify all brand relationships, image permissions, contact details, and product availability before presenting this archive as a current business.
- No paid services, backend, or runtime package dependencies are required.

## Security

See [SECURITY.md](SECURITY.md) for this repository's security, privacy, and responsible-use guidance.
