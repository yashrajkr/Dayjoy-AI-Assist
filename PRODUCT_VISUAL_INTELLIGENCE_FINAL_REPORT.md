# Context-Aware Product Visual Intelligence — Final Report

Date: 2026-08-23

## Summary

This work adds approved product images to chat answers that resolve a real
product (pricing lookups and condition-based recommendations), without
rebuilding any of the existing RAG / structured-response / product-resolution
systems. It also fixes eight UI bugs found in the chat, Settings, and Product
Discovery screens (pinned chats, About page content, app-install
discoverability, the mobile mode selector, category filtering, card/detail
layout, and the attachment strip).

## Part A — Bug fixes

| # | Fix | Files |
|---|---|---|
| A1 | Pinned chats no longer get bumped by a newly-created chat or an unsorted optimistic update; drawer nav gets its own "Pinned" bucket | `src/app/lib/chatStore.ts` (new `sortConversations`), `src/app/components/user/UserChat.tsx`, `src/app/components/user/UserLayout.tsx` |
| A2 | "About Dayjoy AI Assist" expanded with a real overview, feature list, install section, support/privacy links, version/org info | `src/app/components/user/settings/AboutSettings.tsx` |
| A3 | Added a visible "Install Dayjoy AI" row directly on the Settings index (in addition to the existing About-page card, profile-menu item, and desktop floating button) | `src/app/components/user/UserSettings.tsx` |
| A4 | Mode selector modal no longer clips options under the on-screen keyboard on mobile; search input no longer auto-opens the keyboard on mobile | `src/app/components/common/Modal.tsx`, `src/app/components/user/UserChat.tsx` |
| A5 | Category chips (Agriculture, Lifestyle, etc.) now actually filter — normalized matching client-side, and the admin editor's free-text category field is now a fixed `<select>` so new products can't drift from the filter set | `src/app/components/user/ProductDiscovery.tsx`, `src/app/components/admin/ProductDatabase.tsx` |
| A6 | Product Discovery: reorganized the category/sort control bar into a clearer labeled strip, consistent 4:3 image aspect-ratio on cards, added a shadow to the fixed mobile header bar for clearer separation from the page header below | `src/app/components/user/ProductDiscovery.tsx`, `src/app/components/user/UserLayout.tsx` |
| A7 | Product "Details" modal now also shows `warnings` (distinct from safety note), FAQs (`faqs_json`), SKU, and source — previously stored but never rendered | `src/app/components/user/ProductDiscovery.tsx` |
| A8 | Composer attachment thumbnail strip: scroll-snap, larger thumbnails, subtle shadow instead of a raw cropped overflow row | `src/app/components/user/UserChat.tsx` |

All verified via `npm run typecheck` / `npm run lint` (no new errors —
remaining errors/warnings are pre-existing, unrelated to files touched here)
and a live pass against the dev server: category filter confirmed fixed
(Agriculture now returns "Happy Soil" instead of "No products found"),
Details modal renders correctly, mode selector's 6 options all fit within
the viewport and the search input correctly skips autofocus on a mobile
viewport (`isMobile` gate verified via `document.activeElement`).

## Part B — Context-Aware Product Visual Intelligence

### What already existed (reused, not rebuilt)
- **Visual decision**: `RouteResult.product_cards` (`backend/main.py`) was
  already only populated for the two intents where a product is genuinely
  resolved from a verified DB row — pricing lookups and condition-based
  recommendations — never for general RAG answers. That's already the "only
  show an image when it helps" behavior; no separate decision engine needed.
- **Product resolution**: `tools/pricing.py` (best-matching product by name
  token overlap) and `tools/recommend.py` (condition → product via the
  official recommendation chart) already resolve a specific, approved
  `products` row before anything is shown.
- **Grounding**: every field in a product card already comes verbatim from a
  DB row, never from LLM-generated text — image data now follows the same
  rule.

### What was added
1. **`backend/orchestrator/tools/product_media.py`** (new) — `pick_primary_image()`,
   mirroring the frontend's `pickPrimaryImage()` in `src/app/lib/db.ts` exactly
   (same `is_primary` → lowest `display_order` tie-break), so a product shows
   the same photo in chat as on the Product Discovery page. Returns `None`
   when a product has no `product_images` row — never fabricates a URL.
2. **`tools/pricing.py`** and **`tools/recommend.py`** now select the embedded
   `product_images(image_url,alt_text,is_primary,display_order)` alongside
   the product row (joining on `products.id`, the actual FK target —
   `product_images.product_id` references `products.id`, not the business
   `product_id` these tools match on) and attach `image_url`/`image_alt` to
   their result.
3. **`backend/main.py`**'s pricing-intent `product_cards` construction now
   passes through `image_url`/`image_alt`; the recommendation-intent branch
   already passes `rec["products"]` through verbatim, which now includes the
   same fields from `_bundle_product()`.
4. **`src/lib/api.ts`**'s `ChatProductCard` type extended with
   `image_url`/`image_alt`.
5. **`UserChat.tsx`**'s `ProductCard` gets a new `ProductCardPhoto` slot
   (image with graceful fallback to the existing package icon on missing/
   broken image — never a broken-image icon, never an invented photo).
6. **De-dup**: `messages.map` now computes the previous assistant message's
   shown product IDs and passes a `dedupeProductIds` set down; an immediate
   follow-up about the same product (e.g. "what are its benefits?") renders
   text-only (icon, not image) instead of repeating the photo.
7. **Comparison**: unchanged — multiple resolved products (from
   `product_recommendation`) already render as a stacked list of
   `ProductCard`s; each now simply carries its own image, no new comparison
   component needed.

### Verification performed
- `pick_primary_image()` unit-verified directly (no images → `None`;
  `is_primary` wins over `display_order`; falls back to lowest
  `display_order` when none is primary; a row with a null `image_url` is
  treated as no image, never fabricated) — all assertions passed.
- Python syntax-checked all touched backend files.
- `npm run typecheck` / `npm run lint` — no new issues.
- Code-path review confirms: image only ever appears on the two
  DB-resolved intents (never for a general RAG-only answer, satisfying the
  "no image on `What is DayJoy's return policy?`"-style questions from the
  spec); missing image degrades to the existing icon placeholder without
  interrupting the answer; streaming is untouched — the SSE stream's final
  metadata payload (`main.py` line ~2411) already carried `product_cards`,
  now with two extra optional string fields, so no framing/timing change.

### Known gaps
- **Not live-tested against a running backend + populated Supabase**: this
  environment's dev server serves the frontend only. The pricing/
  recommendation code paths, the actual `product_images` join, and the
  chat-side image rendering were verified by direct code/unit-level checks
  and TypeScript's type system, not an end-to-end request through a live
  `/chat/stream` call. Recommend running the spec's test-flow list (single
  product, recommendation with 2+ products, Hinglish question, missing
  image, mobile/desktop layout) against a staging environment with real
  data before considering this fully proven in production.
- **Bundle/package images**: `product_relationships` data exists but is
  sparse in the audited production DB (per `recommend.py`'s own docstring),
  so a dedicated bundle/package image view wasn't built — the existing
  multi-card recommendation list already covers "show me products for this
  need" without inventing a bundle image concept the data doesn't actually
  support yet.
- **Comparison table with a dedicated grid layout** (as in the original
  spec's mockup) wasn't built — the existing stacked-card list was judged a
  better fit for reuse than adding a new UI pattern; revisit if product
  wants a literal side-by-side grid.
