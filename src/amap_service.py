import requests
import os

AMAP_KEY = os.getenv("AMAP_KEY", "")

def get_coordinate_and_subway(address, city="广州"):
    """
    Returns dict with location (str "lon,lat") and nearest_subway (str).
    """
    if not AMAP_KEY:
        return {'location': None, 'nearest_subway': "Missing API Key"}

    # 1. Geocode
    geo_url = "https://restapi.amap.com/v3/geocode/geo"
    params = {
        'key': AMAP_KEY,
        'address': address,
        'city': city
    }

    try:
        resp = requests.get(geo_url, params=params, timeout=10).json()

        if resp.get('status') == '1' and len(resp.get('geocodes', [])) > 0:
            location = resp['geocodes'][0]['location']

            # 2. Find nearest subway (POI Search Around)
            poi_url = "https://restapi.amap.com/v3/place/around"
            poi_params = {
                'key': AMAP_KEY,
                'location': location,
                'types': '150500', # Subway station type code
                'radius': 1000,
                'offset': 1
            }

            poi_resp = requests.get(poi_url, params=poi_params, timeout=10).json()
            subway = "Unknown"
            if poi_resp.get('status') == '1' and len(poi_resp.get('pois', [])) > 0:
                subway = poi_resp['pois'][0]['name']

            return {'location': location, 'nearest_subway': subway}
        else:
             print(f"Geocode failed for {address}: {resp}")

    except Exception as e:
        print(f"Geocoding error for {address}: {e}")

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
        resp = requests.get(url, params=params, timeout=10).json()

        if resp.get('status') == '1' and resp.get('route') and len(resp['route'].get('transits', [])) > 0:
            route = resp['route']['transits'][0]
            duration_min = int(route['duration']) // 60

            segments_list = []
            for segment in route.get('segments', []):
                if segment.get('bus') and segment['bus'].get('buslines'):
                    # It's a bus or subway
                    line_name = segment['bus']['buslines'][0]['name']
                    # Cleanup name often includes redundant info like "Line 5(Jiaokou--Wenchong)"
                    # We'll just keep it as is for now or split by '('
                    line_name = line_name.split('(')[0]
                    segments_list.append(line_name)

            route_str = " -> ".join(segments_list)
            return f"{duration_min} min ({route_str})"

    except Exception as e:
        print(f"Routing error: {e}")
        pass

    return "Route not found"
