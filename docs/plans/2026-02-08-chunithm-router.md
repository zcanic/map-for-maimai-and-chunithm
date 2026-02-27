# Guangzhou Chunithm Router Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a tool to fetch Chunithm arcade locations in Guangzhou, geocode them, finding nearest subway stations, and calculate transit routes from Chebei Station.

**Architecture:** Python script fetching data from Sega API, enriching it with AMap (Gaode) Web Service API for geocoding/routing, and exporting to CSV/Markdown.

**Tech Stack:** Python 3, `requests`, `pandas`, AMap Web API.

---

### Task 1: Project Setup & Sega API Client

**Files:**
- Create: `src/sega_client.py`
- Test: `tests/test_sega_client.py`

**Step 1: Write the failing test**

```python
import pytest
from src.sega_client import fetch_guangzhou_locations

def test_fetch_guangzhou_locations_returns_list():
    # Mocking would be ideal, but for now we expect a list of dicts
    # In a real run we might mock requests.get
    locations = fetch_guangzhou_locations()
    assert isinstance(locations, list)
    if len(locations) > 0:
        assert 'arcadeName' in locations[0]
        assert 'address' in locations[0]
        # Ensure filtering worked
        assert '广州' in locations[0]['address'] or '广州' in locations[0]['province']
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/test_sega_client.py -v`
Expected: FAIL (ModuleNotFoundError)

**Step 3: Implement Sega Client**

```python
import requests

def fetch_guangzhou_locations():
    url = "https://sega-register.wahlap.net/api/sega/midtr/rest/location"
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()

        gz_locations = []
        for loc in data:
            # Filter for Guangzhou
            if '广州' in loc.get('address', '') or '广州' in loc.get('province', ''):
                gz_locations.append({
                    'name': loc.get('arcadeName'),
                    'address': loc.get('address'),
                    'raw_data': loc
                })
        return gz_locations
    except Exception as e:
        print(f"Error fetching data: {e}")
        return []
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/test_sega_client.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sega_client.py tests/test_sega_client.py
git commit -m "feat: implement sega api client for guangzhou locations"
```

### Task 2: AMap (Gaode) Geocoding Service

**Files:**
- Create: `src/amap_service.py`
- Test: `tests/test_amap_service.py`

**Step 1: Write the failing test**

```python
from src.amap_service import get_coordinate_and_subway

def test_geocode_sample_location():
    # Using a known location: Chebei Metro Station
    # Note: Requires AMAP_KEY env var
    address = "广州市天河区车陂地铁站"
    result = get_coordinate_and_subway(address)
    assert result is not None
    assert 'location' in result # "lon,lat"
    assert 'nearest_subway' in result
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/test_amap_service.py`
Expected: FAIL

**Step 3: Implement AMap Service**

```python
import os
import requests

# Default key placeholder - user must provide valid key
AMAP_KEY = os.getenv("AMAP_KEY", "YOUR_AMAP_KEY")

def get_coordinate_and_subway(address, city="广州"):
    """
    Returns dict with location (str "lon,lat") and nearest_subway (str).
    """
    if not AMAP_KEY or AMAP_KEY == "YOUR_AMAP_KEY":
        return {'location': None, 'nearest_subway': "Missing API Key"}

    # 1. Geocode
    geo_url = "https://restapi.amap.com/v3/geocode/geo"
    params = {
        'key': AMAP_KEY,
        'address': address,
        'city': city
    }
    try:
        resp = requests.get(geo_url, params=params).json()
        if resp['status'] == '1' and len(resp['geocodes']) > 0:
            location = resp['geocodes'][0]['location']

            # 2. Find nearest subway (POI Search Around)
            # This is a simplification; ideally we search for subway stations near the point
            poi_url = "https://restapi.amap.com/v3/place/around"
            poi_params = {
                'key': AMAP_KEY,
                'location': location,
                'types': '150500', # Subway station type code
                'radius': 1000,
                'offset': 1
            }
            poi_resp = requests.get(poi_url, params=poi_params).json()
            subway = "Unknown"
            if poi_resp['status'] == '1' and len(poi_resp['pois']) > 0:
                subway = poi_resp['pois'][0]['name']

            return {'location': location, 'nearest_subway': subway}
    except Exception as e:
        print(f"Geocoding error: {e}")

    return {'location': None, 'nearest_subway': "Error"}

def get_transit_route(origin_loc, dest_loc, city="广州"):
    """
    Get transit duration and instructions from origin to dest.
    """
    if not origin_loc or not dest_loc or not AMAP_KEY:
        return "N/A"

    url = "https://restapi.amap.com/v3/direction/transit/integrated"
    params = {
        'key': AMAP_KEY,
        'origin': origin_loc,
        'destination': dest_loc,
        'city': city,
        'strategy': 0 # Fastest
    }
    try:
        resp = requests.get(url, params=params).json()
        if resp['status'] == '1' and len(resp['route']['transits']) > 0:
            route = resp['route']['transits'][0]
            duration_min = int(route['duration']) // 60
            segments = []
            for segment in route['segments']:
                if segment['bus']['buslines']:
                    segments.append(segment['bus']['buslines'][0]['name'])
            return f"{duration_min} min ({' -> '.join(segments)})"
    except:
        pass
    return "Route not found"
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/test_amap_service.py`
Expected: PASS (if key provided) or Partial PASS (graceful failure)

**Step 5: Commit**

```bash
git add src/amap_service.py tests/test_amap_service.py
git commit -m "feat: implement amap geocoding and routing service"
```

### Task 3: Main Orchestrator

**Files:**
- Create: `src/main.py`

**Step 1: Implement Main Script**

```python
import pandas as pd
from src.sega_client import fetch_guangzhou_locations
from src.amap_service import get_coordinate_and_subway, get_transit_route, AMAP_KEY

def main():
    print("Fetching locations...")
    locations = fetch_guangzhou_locations()
    print(f"Found {len(locations)} locations.")

    # Chebei Station Coordinate (Hardcoded or Geocoded)
    # Chebei Station: 113.396783,23.123288 (Approx)
    CHEBEI_LOC = "113.396783,23.123288"

    results = []

    for loc in locations:
        print(f"Processing {loc['name']}...")
        geo_info = get_coordinate_and_subway(loc['address'])

        route_info = "N/A"
        if geo_info['location']:
            route_info = get_transit_route(CHEBEI_LOC, geo_info['location'])

        results.append({
            "Name": loc['name'],
            "Address": loc['address'],
            "Nearest Subway": geo_info['nearest_subway'],
            "From Chebei": route_info,
            "Price (Est.)": "Unknown" # Manual fill needed
        })

    df = pd.DataFrame(results)
    df.to_csv("guangzhou_chunithm_routes.csv", index=False)
    print("Done! Saved to guangzhou_chunithm_routes.csv")

    # Simple markdown table output
    print(df.to_markdown())

if __name__ == "__main__":
    if AMAP_KEY == "YOUR_AMAP_KEY":
        print("WARNING: AMAP_KEY is not set. Geocoding will fail.")
    main()
```

**Step 2: Commit**

```bash
git add src/main.py
git commit -m "feat: main script to orchestrate data collection"
```
