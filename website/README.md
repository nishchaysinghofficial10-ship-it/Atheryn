# ATHERYN website

A single static page, `index.html`, with no build step and no dependencies
beyond Google Fonts.

Preview it locally:

```bash
python -m http.server --directory website 8000
# open http://localhost:8000
```

Every figure on the page comes from `docs/reports/FLAGSHIP_EVALUATION.md`,
`CHANGELOG.md`, `README.md` or the shipped missions in `examples/`. If one of
those changes, update the page in the same commit.

## Deploying

`.github/workflows/pages.yml` publishes this directory to GitHub Pages on every
push to `main` that touches `website/`. Enable it once under
**Settings → Pages → Build and deployment → Source: GitHub Actions**.
