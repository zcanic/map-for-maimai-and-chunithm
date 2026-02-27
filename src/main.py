import pandas as pd
import sys
import os

# Ensure src is in path so we can import modules if running from root
# We add the parent directory of 'src' (which is project root) to sys.path
# This allows 'from src.sega_client import ...'
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

try:
    from src.sega_client import fetch_guangzhou_locations
    from src.amap_service import get_coordinate_and_subway, get_transit_route, AMAP_KEY
except ImportError:
    # Fallback if running directly inside src/
    sys.path.append(os.path.dirname(__file__))
    from sega_client import fetch_guangzhou_locations
    from amap_service import get_coordinate_and_subway, get_transit_route, AMAP_KEY

def main():
    print("Fetching locations from Sega API...")
    locations = fetch_guangzhou_locations()
    print(f"Found {len(locations)} locations in Guangzhou.")

    # Chebei Station Coordinate (Hardcoded)
    CHEBEI_LOC = "113.396783,23.123288"

    results = []

    # Limit to first 5 for testing if list is huge? No, user wants results.
    # But let's print progress.
    count = 0
    for loc in locations:
        count += 1
        name = loc['name']
        address = loc['address']
        print(f"[{count}/{len(locations)}] Processing: {name}...")

        # 1. Geocode and find nearest subway
        geo_info = get_coordinate_and_subway(address)

        # 2. Route from Chebei
        route_info = "N/A"
        if geo_info['location']:
            # Note: AMap transit route expects origin, destination
            route_info = get_transit_route(CHEBEI_LOC, geo_info['location'])
        else:
            print(f"  - Failed to geocode {name}")

        results.append({
            "Name": name,
            "Address": address,
            "Nearest Subway": geo_info['nearest_subway'],
            "From Chebei": route_info
        })

    # Create DataFrame
    df = pd.DataFrame(results)

    # Save to CSV in the current directory (should be project root if run from there)
    output_file = "guangzhou_chunithm_routes.csv"
    # Use abspath to be sure where it goes
    output_path = os.path.abspath(output_file)

    df.to_csv(output_path, index=False, encoding='utf-8-sig') # utf-8-sig for Excel compatibility in China
    print(f"\nDone! Saved to {output_path}")

    # Print Markdown Table
    try:
        print("\nResults:")
        print(df.to_markdown(index=False))
    except ImportError:
        print("\nResults (tabulate not installed):")
        print(df.to_string())
    except AttributeError:
         print("\nResults:")
         print(df)

if __name__ == "__main__":
    if not AMAP_KEY:
        print("WARNING: AMAP_KEY is not set. Geocoding will fail.")
    main()
