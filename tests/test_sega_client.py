import pytest
import sys
import os

# Add src to path so we can import the module
sys.path.append(os.path.join(os.path.dirname(__file__), '../src'))

from sega_client import fetch_guangzhou_locations

def test_fetch_guangzhou_locations_returns_list():
    # Mocking would be ideal, but for now we expect a list of dicts
    # In a real run we might mock requests.get
    locations = fetch_guangzhou_locations()
    assert isinstance(locations, list)
    if len(locations) > 0:
        assert 'name' in locations[0]
        assert 'address' in locations[0]
        # Ensure filtering worked
        # Note: The plan had 'arcadeName' in the test but 'name' in the implementation mapping.
        # I will use the keys defined in the implementation plan: 'name', 'address'.

        # Check if the location is actually in Guangzhou (either address or province/city check)
        # The implementation checks for '广州' in address or province.
        # Since we return a cleaned dict, we check the values we put in.
        assert '广州' in locations[0]['address'] or '广州' in str(locations[0].get('raw_data', ''))
