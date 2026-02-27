#!/usr/bin/env python3
"""
Fetch all maimai DX and CHUNITHM arcade locations from Wahlap API,
geocode them using AMap API, and save as JSON for the web dashboard.
"""

import sys
import json
import time
import urllib.request
import urllib.parse
import urllib.error
import os

reconfigure = getattr(sys.stdout, "reconfigure", None)
if callable(reconfigure):
    reconfigure(encoding="utf-8")

AMAP_KEY = os.getenv("AMAP_KEY", "")

MAIMAI_API = "https://sega-register.wahlap.net/api/sega/maidx/rest/location"
CHUNITHM_API = "https://sega-register.wahlap.net/api/sega/midtr/rest/location"

OUTPUT_FILE = "web/data/locations.json"


def fetch_json(url, retries=3, timeout=20):
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            })
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                return json.loads(raw.decode('utf-8'))
        except Exception as err:
            last_err = err
            wait = min(5 * attempt, 20)
            print(f"Fetch failed (attempt {attempt}/{retries}) for {url}: {err}", flush=True)
            if attempt < retries:
                time.sleep(wait)
    raise RuntimeError(f"Failed to fetch {url}: {last_err}")


def geocode_address(address, province=""):
    """Use AMap Geocoding API to get coordinates."""
    if not AMAP_KEY:
        return None, None

    params = urllib.parse.urlencode({
        'key': AMAP_KEY,
        'address': address,
        'output': 'JSON'
    })
    url = f"https://restapi.amap.com/v3/geocode/geo?{params}"

    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))

        if data.get('status') == '1' and data.get('geocodes'):
            loc = data['geocodes'][0]['location']
            lng, lat = loc.split(',')
            return float(lng), float(lat)
    except Exception as e:
        print(f"  Geocode error for '{address}': {e}", flush=True)

    return None, None


def build_location_record(shop, game_type, geocode=True):
    """Build a location record with optional geocoding."""
    record = {
        'id': shop.get('id', ''),
        'game': game_type,  # 'maimai' or 'chunithm'
        'name': shop.get('arcadeName', ''),
        'address': shop.get('address', ''),
        'province': shop.get('province', ''),
        'placeId': shop.get('placeId', ''),
        'lng': None,
        'lat': None,
    }

    if geocode and record['address']:
        lng, lat = geocode_address(record['address'])
        record['lng'] = lng
        record['lat'] = lat
        if lng:
            print(f"  ✓ {record['name'][:20]} -> ({lng:.4f}, {lat:.4f})", flush=True)
        else:
            print(f"  ✗ {record['name'][:20]} -> geocode failed", flush=True)
        time.sleep(0.12)  # ~8 req/sec, stay under AMap free tier limit

    return record


def main():
    import os
    os.makedirs("web/data", exist_ok=True)

    if not AMAP_KEY:
        print("WARNING: AMAP_KEY is not set. Geocoding will be skipped.", flush=True)

    print("=" * 60)
    print("Fetching Maimai DX locations...")
    print("=" * 60)
    maimai_raw = fetch_json(MAIMAI_API)
    print(f"Total Maimai DX shops: {len(maimai_raw)}")

    print("\n" + "=" * 60)
    print("Fetching CHUNITHM locations...")
    print("=" * 60)
    chunithm_raw = fetch_json(CHUNITHM_API)
    print(f"Total CHUNITHM shops: {len(chunithm_raw)}")

    # Merge: some shops have both games
    # Key by placeId for deduplication
    all_shops = {}

    print("\n" + "=" * 60)
    print("Processing Maimai DX shops...")
    print("=" * 60)
    for i, shop in enumerate(maimai_raw):
        pid = shop.get('placeId', shop.get('id', f'mai_{i}'))
        print(f"[{i+1}/{len(maimai_raw)}] {shop.get('arcadeName', '')[:30]}", flush=True)
        rec = build_location_record(shop, 'maimai', geocode=bool(AMAP_KEY))
        if pid in all_shops:
            all_shops[pid]['game'] = 'both'
        else:
            all_shops[pid] = rec

    print("\n" + "=" * 60)
    print("Processing CHUNITHM shops...")
    print("=" * 60)
    for i, shop in enumerate(chunithm_raw):
        pid = shop.get('placeId', shop.get('id', f'chu_{i}'))
        print(f"[{i+1}/{len(chunithm_raw)}] {shop.get('arcadeName', '')[:30]}", flush=True)

        if pid in all_shops:
            all_shops[pid]['game'] = 'both'
            print(f"  → Merged (already have as maimai)", flush=True)
        else:
            rec = build_location_record(shop, 'chunithm', geocode=bool(AMAP_KEY))
            all_shops[pid] = rec

    locations = list(all_shops.values())
    geocoded = sum(1 for loc in locations if loc['lng'] is not None)

    print(f"\nTotal unique locations: {len(locations)}")
    if AMAP_KEY:
        print(f"Successfully geocoded: {geocoded}")
    else:
        print("Geocoding skipped (AMAP_KEY missing)")

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(locations, f, ensure_ascii=False, indent=2)

    print(f"\nSaved to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
