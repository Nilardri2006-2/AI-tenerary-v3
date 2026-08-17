import time
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

WIKI_API = "https://en.wikipedia.org/w/api.php"

session = requests.Session()

retry = Retry(
    total=5,
    backoff_factor=1,
    status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=["GET"]
)

adapter = HTTPAdapter(max_retries=retry)

session.mount("https://", adapter)
session.mount("http://", adapter)

session.headers.update({
    "User-Agent": "AI-tinerary/1.0 (your-email@example.com)"
})


def get_place_image(place: str):
    params = {
        "action": "query",
        "format": "json",
        "generator": "search",
        "gsrsearch": place,
        "gsrlimit": 1,
        "prop": "pageimages",
        "piprop": "original",
    }

    for attempt in range(5):
        try:
            response = session.get(
                WIKI_API,
                params=params,
                timeout=10,
            )

            if response.status_code == 429:
                retry_after = response.headers.get("Retry-After")

                wait = int(retry_after) if retry_after else 2 ** attempt

                print(f"Rate limited. Waiting {wait}s...")

                time.sleep(wait)
                continue

            response.raise_for_status()

            data = response.json()

            pages = data.get("query", {}).get("pages", {})

            if not pages:
                return None

            page = next(iter(pages.values()))

            return page.get("original", {}).get("source")

        except Exception as e:
            print(f"{place}: {e}")
            time.sleep(1)

    return None


def get_images(places):
    images = []

    for i, place in enumerate(places):
        print(f"{i+1}/{len(places)} -> {place}")

        image = get_place_image(place)

        if image:  # ← only add if image exists
            images.append({
                "title": place,
                "url": image
            })
        time.sleep(0.4)
    return images