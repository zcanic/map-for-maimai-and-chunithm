#!/usr/bin/env python3
"""
Fast data fetcher - fetch locations without geocoding first,
then add geocoding for a sample, or all if time permits.
Outputs the JSON needed for the web dashboard.
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


def fetch_json(url, retries=3, timeout=20):
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Accept': 'application/json, */*'
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


def geocode_address(address):
    """Use AMap Geocoding API to get lat/lng."""
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
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        if data.get('status') == '1' and data.get('geocodes'):
            loc = data['geocodes'][0]['location']
            lng, lat = loc.split(',')
            return float(lng), float(lat)
    except Exception as e:
        pass
    return None, None


def main():
    os.makedirs("web/data", exist_ok=True)

    if not AMAP_KEY:
        print("WARNING: AMAP_KEY is not set. Geocoding will be skipped.", flush=True)

    print("Fetching Maimai DX locations...", flush=True)
    maimai_raw = fetch_json(MAIMAI_API)
    print(f"  Got {len(maimai_raw)} shops", flush=True)

    print("Fetching CHUNITHM locations...", flush=True)
    chunithm_raw = fetch_json(CHUNITHM_API)
    print(f"  Got {len(chunithm_raw)} shops", flush=True)

    # Build unified dict keyed by placeId for dedup
    # placeId is shared between games when same venue
    all_shops = {}  # placeId -> record

    for shop in maimai_raw:
        pid = shop.get('placeId') or shop.get('id')
        all_shops[pid] = {
            'id': shop.get('id', ''),
            'game': 'maimai',
            'name': shop.get('arcadeName', ''),
            'address': shop.get('address', ''),
            'province': shop.get('province', ''),
            'placeId': str(pid),
            'lng': None,
            'lat': None,
            'ratings': {},
        }

    for shop in chunithm_raw:
        pid = shop.get('placeId') or shop.get('id')
        if pid in all_shops:
            all_shops[pid]['game'] = 'both'
        else:
            all_shops[pid] = {
                'id': shop.get('id', ''),
                'game': 'chunithm',
                'name': shop.get('arcadeName', ''),
                'address': shop.get('address', ''),
                'province': shop.get('province', ''),
                'placeId': str(pid),
                'lng': None,
                'lat': None,
                'ratings': {},
            }

    locations = list(all_shops.values())
    print(f"\nTotal unique venues: {len(locations)}", flush=True)

    # Resume: load existing geocode results to skip already-done entries
    output_path = "web/data/locations.json"
    existing_coords = {}  # placeId -> (lng, lat)
    existing_ratings = {}  # placeId -> ratings dict
    if os.path.exists(output_path):
        try:
            with open(output_path, encoding='utf-8') as f:
                existing = json.load(f)
            for ex in existing:
                pid = ex.get('placeId', '')
                if ex.get('lng'):
                    existing_coords[pid] = (ex['lng'], ex['lat'])
                if ex.get('ratings'):
                    existing_ratings[pid] = ex['ratings']
            print(f"Resuming: {len(existing_coords)} already geocoded, {len(existing_ratings)} already rated.", flush=True)
        except Exception as e:
            print(f"Warning: could not load existing data: {e}", flush=True)

    # Apply existing coords / ratings
    for loc in locations:
        pid = loc['placeId']
        if pid in existing_coords:
            loc['lng'], loc['lat'] = existing_coords[pid]
        if pid in existing_ratings:
            loc['ratings'] = existing_ratings[pid]

    # Geocode only locations that don't yet have coordinates
    to_geocode = [loc for loc in locations if not loc.get('lng') and loc.get('address')]
    print(f"\nGeocoding {len(to_geocode)} remaining locations (skipping {len(existing_coords)} already done)...", flush=True)
    geocoded_count = 0
    failed_count = 0

    for i, loc in enumerate(to_geocode):
        if AMAP_KEY:
            lng, lat = geocode_address(loc['address'])
            loc['lng'] = lng
            loc['lat'] = lat
            if lng:
                geocoded_count += 1
                if (i + 1) % 50 == 0:
                    print(f"  [{i+1}/{len(to_geocode)}] geocoded {geocoded_count} so far...", flush=True)
            else:
                failed_count += 1
            # Save checkpoint every 100 to avoid losing progress
            if (i + 1) % 100 == 0:
                with open(output_path, 'w', encoding='utf-8') as f:
                    json.dump(locations, f, ensure_ascii=False, indent=2)
                print(f"  Checkpoint saved at {i+1}", flush=True)
            time.sleep(0.13)  # ~7.5 req/sec - conservative rate limit

    if AMAP_KEY:
        print(f"\nGeocoding complete: {geocoded_count} success, {failed_count} failed", flush=True)
    else:
        print("\nGeocoding skipped (AMAP_KEY missing)", flush=True)

    # Final save
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(locations, f, ensure_ascii=False, indent=2)

    print(f"Saved {len(locations)} locations to {output_path}", flush=True)

    # Print stats
    provinces = {}
    for loc in locations:
        p = loc['province']
        provinces[p] = provinces.get(p, 0) + 1
    
    print("\nTop 10 provinces by venue count:")
    for p, count in sorted(provinces.items(), key=lambda x: -x[1])[:10]:
        print(f"  {p}: {count}")


if __name__ == "__main__":
    main()
