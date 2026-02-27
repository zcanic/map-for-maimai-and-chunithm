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
