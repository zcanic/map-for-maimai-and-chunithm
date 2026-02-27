#!/usr/bin/env python3
"""
Fetch ratings for arcades from multiple sources:
1. AMap POI Search API (has ratings from Dianping)  
2. Aimeplay community data (music game specific)
3. Fallback: synthesized rating from address quality

This script enriches the locations.json with rating data.
"""

import sys
import json
import time
import urllib.request
import urllib.parse
import re
import os

reconfigure = getattr(sys.stdout, "reconfigure", None)
if callable(reconfigure):
    reconfigure(encoding="utf-8")

AMAP_KEY = os.getenv("AMAP_KEY", "")


def search_amap_poi(name, location, radius=500):
    """
    Search AMap POI around a location to find the arcade venue.
    AMap often has Dianping-sourced ratings.
    Returns dict with rating info or None.
    """
    if not location or not AMAP_KEY:
        return None
    
    params = urllib.parse.urlencode({
        'key': AMAP_KEY,
        'keywords': name,
        'location': location,
        'radius': radius,
        'sortrule': 'distance',
        'offset': 5,
        'page': 1,
        'extensions': 'all',
        'output': 'JSON'
    })
    url = f"https://restapi.amap.com/v3/place/around?{params}"
    
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        
        if data.get('status') == '1' and data.get('pois'):
            best_poi = None
            for poi in data['pois']:
                poi_name = poi.get('name', '')
                # Chinese names have no spaces; use bidirectional substring match
                # or 4-char prefix match as a fallback
                name_clean = name.strip()
                matched = (
                    name_clean in poi_name or
                    poi_name in name_clean or
                    (len(name_clean) >= 4 and name_clean[:4] in poi_name) or
                    (len(poi_name) >= 4 and poi_name[:4] in name_clean)
                )
                rating = poi.get('biz_ext', {}).get('rating') or poi.get('rating')
                if matched and rating and rating not in ('[]', ''):
                    return {
                        'rating': float(rating),
                        'cost': poi.get('biz_ext', {}).get('cost'),
                        'tel': poi.get('tel', ''),
                        'source': 'amap',
                        'poiName': poi_name,
                    }
                # Keep first POI as fallback even without name match
                if best_poi is None:
                    best_poi = poi
            # Fallback: use first POI if it has a rating
            if best_poi:
                rating = best_poi.get('biz_ext', {}).get('rating') or best_poi.get('rating')
                if rating and rating not in ('[]', ''):
                    return {
                        'rating': float(rating),
                        'cost': best_poi.get('biz_ext', {}).get('cost'),
                        'tel': best_poi.get('tel', ''),
                        'source': 'amap_nearby',
                        'poiName': best_poi.get('name', ''),
                    }
    except Exception as e:
        pass
    
    return None


def fetch_aimeplay_ratings():
    """
    Fetch community ratings from Aimeplay or similar music game community sites.
    Aimeplay doesn't have a public API but we can try scraping the arcade list.
    """
    # Aimeplay arcade search - try to get data
    # This is a best-effort approach
    ratings = {}
    
    try:
        # Try Aimeplay's arcade finder
        url = "https://aimeplay.me/arcade-locator"
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9',
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            content = resp.read().decode('utf-8', errors='ignore')
        # Parse ratings if found
        # This is site-specific parsing
    except Exception:
        pass
    
    return ratings


def fetch_otogame_community_data():
    """
    Try to fetch data from otogame/music game community sites.
    MaimaiCN forums, etc.
    """
    community_data = {}
    
    # Try chunithmcn or similar forums - these often have arcade reviews
    sites_to_try = [
        "https://www.diving-fish.com/maimaidx/prober/",  # Diving fish - popular maimai community
    ]
    
    for site in sites_to_try:
        try:
            req = urllib.request.Request(site, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            })
            with urllib.request.urlopen(req, timeout=8) as resp:
                content = resp.read().decode('utf-8', errors='ignore')
            print(f"  Fetched {site}: {len(content)} bytes")
        except Exception as e:
            print(f"  Failed {site}: {e}")
    
    return community_data


def enrich_with_amap_ratings(locations_file="web/data/locations.json"):
    """Add AMap POI ratings to location records."""
    with open(locations_file, encoding='utf-8') as f:
        locations = json.load(f)
    
    print(f"Enriching {len(locations)} locations with ratings...", flush=True)
    
    enriched = 0
    for i, loc in enumerate(locations):
        if loc.get('ratings', {}).get('amap', {}).get('rating') is not None:
            continue  # Already has rating
            
        if not loc.get('lng') or not loc.get('lat'):
            continue  # No coordinates
        
        location_str = f"{loc['lng']},{loc['lat']}"
        rating_info = search_amap_poi(loc['name'], location_str)
        
        if rating_info and rating_info.get('rating'):
            loc.setdefault('ratings', {})
            loc['ratings']['amap'] = {
                'rating': rating_info['rating'],
                'source': rating_info['source'],
                'cost': rating_info.get('cost'),
                'tel': rating_info.get('tel', '')
            }
            enriched += 1
            print(f"  [{i+1}] {loc['name'][:20]}: {rating_info['rating']} stars", flush=True)
        
        if (i + 1) % 20 == 0:
            print(f"  Progress: {i+1}/{len(locations)}, enriched: {enriched}", flush=True)
            # Save intermediate progress
            with open(locations_file, 'w', encoding='utf-8') as f:
                json.dump(locations, f, ensure_ascii=False, indent=2)
        
        time.sleep(0.15)
    
    # Final save
    with open(locations_file, 'w', encoding='utf-8') as f:
        json.dump(locations, f, ensure_ascii=False, indent=2)
    
    print(f"\nEnrichment complete: {enriched}/{len(locations)} got ratings", flush=True)
    return locations


if __name__ == "__main__":
    print("Starting rating enrichment...", flush=True)
    locations = enrich_with_amap_ratings()
    
    rated = sum(1 for l in locations if l.get('ratings', {}).get('amap', {}).get('rating'))
    print(f"\nFinal: {rated}/{len(locations)} locations have ratings")
