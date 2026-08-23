"""
Shared helper for resolving a product's approved primary image.

Mirrors `pickPrimaryImage()` in `src/app/lib/db.ts` exactly (same tie-break:
`is_primary` first, then lowest `display_order`) so a product shows the same
photo in chat as it does on the Product Discovery page. Used by both
tools/pricing.py and tools/recommend.py — the two structured-answer paths
that resolve a real product row and may attach an image to it.

`product_images.product_id` is a foreign key to `products.id` (the internal
uuid), NOT `products.product_id` (the business key pricing/recommend match
on) — so callers must select `id` alongside the embedded `product_images(...)`
rows and pass the embedded list here, they cannot look images up by the
business `product_id` directly.

Never fabricates a URL: returns None when a product has no product_images
row, and callers must treat that as "no image", not an error.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

PRODUCT_IMAGES_EMBED = "product_images(image_url,alt_text,is_primary,display_order)"


def pick_primary_image(images: Optional[List[Dict[str, Any]]]) -> Optional[Dict[str, Optional[str]]]:
    """Returns {"image_url", "alt_text"} for the primary (or first, by
    display_order) image, or None if the product has no approved images."""
    if not images:
        return None
    ranked = sorted(
        images,
        key=lambda r: (0 if r.get("is_primary") else 1, r.get("display_order") or 0),
    )
    top = ranked[0]
    url = top.get("image_url")
    if not url:
        return None
    return {"image_url": url, "alt_text": top.get("alt_text")}
