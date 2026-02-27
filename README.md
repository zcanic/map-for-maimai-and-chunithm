# Arcade Map — maimai DX / CHUNITHM

Static web app for discovering maimai DX and CHUNITHM arcades across China.
Includes search, filters, map navigation, PWA metadata, and SEO-friendly
province pages.

## Features

- Map-based discovery with marker clustering
- Search and filters (game type, province, rating)
- Favorites and recent history
- Nearby location and multi-map navigation picker
- Province SEO pages + sitemap/robots
- PWA manifest for installable experience

## Project Structure

- `web/` static site (HTML/CSS/JS)
- `web/data/locations.js` bundled location dataset
- `web/provinces/` generated province landing pages
- `scripts/` data fetch and generation utilities

## Local Development

From the repo root:

```bash
cd web
python -m http.server 8765
```

Then open:

```
http://localhost:8765/
```

## Data Generation (Optional)

Data scripts live in `scripts/` and output to `web/data/`.
Most workflows require an AMap API key:

```bash
export AMAP_KEY=your_key
python scripts/fetch_all.py
python scripts/fetch_ratings.py
python scripts/gen_province_pages.py
```

## Deployment

This is a static site. Deploy the `web/` directory to any static host.
Be sure your host serves `robots.txt` and `sitemap.xml` from the root.
