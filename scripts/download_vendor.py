"""Download front-end vendor files (Chart.js) into static/vendor/."""

import urllib.request
import sys
from pathlib import Path

VENDOR = Path(__file__).parent.parent / "src" / "calidrux" / "api" / "static" / "vendor"
VENDOR.mkdir(parents=True, exist_ok=True)

FILES = {
    "chart.umd.min.js": "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js",
}

for name, url in FILES.items():
    dest = VENDOR / name
    if dest.exists():
        print(f"  {name} already present, skipping.")
        continue
    print(f"  Downloading {name} …")
    try:
        urllib.request.urlretrieve(url, dest)
        print(f"  -> {dest}")
    except Exception as e:
        print(f"  ERROR: {e}", file=sys.stderr)
        sys.exit(1)

print("Vendor files ready.")
