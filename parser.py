"""
Hikka API — інкрементальний парс колекцій.
Сортування: created:desc. Content type: будь-який.

Режими запуску:
  python parser.py           — лише нові колекції (інкрементально)
  python parser.py --full    — оновити всі колекції повністю

Вихідні файли:
  - collections_public.json   — visibility == "public"
  - collections_unlisted.json — visibility == "unlisted"
"""

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import aiohttp

BASE_URL        = "https://api.hikka.io"
OUTPUT_PUBLIC   = Path("collections_public.json")
OUTPUT_UNLISTED = Path("collections_unlisted.json")

TITLE_TYPES = {"anime", "manga", "novel"}
NAME_TYPES  = {"character", "person"}


def pick_title(content: dict) -> str | None:
    return (
        content.get("title_ua")
        or content.get("title_ja")
        or content.get("title_original")
        or content.get("title_en")
    )


def pick_name(content: dict) -> str | None:
    return (
        content.get("name_ua")
        or content.get("name_en")
        or content.get("name_ja")
        or content.get("name_native")
    )


def slim_content_item(item: dict) -> dict:
    content      = item.get("content", {})
    content_type = item.get("content_type", "")

    if content_type in TITLE_TYPES:
        slim = {"title": pick_title(content), "image": content.get("image"), "slug": content.get("slug")}
    elif content_type in NAME_TYPES:
        slim = {"name": pick_name(content), "image": content.get("image"), "slug": content.get("slug")}
    else:
        slim = {"image": content.get("image"), "slug": content.get("slug")}

    return {
        "content_type": content_type,
        "order":   item.get("order"),
        "label":   item.get("label"),
        "comment": item.get("comment"),
        "content": slim,
    }


def slim_author(author: dict) -> dict:
    return {
        "reference": author.get("reference"),
        "username":  author.get("username"),
        "avatar":    author.get("avatar"),
    }


def slim_collection(col: dict) -> dict:
    return {
        "reference":      col.get("reference"),
        "title":          col.get("title"),
        "content_type":   col.get("content_type"),
        "visibility":     col.get("visibility"),
        "spoiler":        col.get("spoiler"),
        "nsfw":           col.get("nsfw"),
        "tags":           col.get("tags", []),
        "labels_order":   col.get("labels_order", []),
        "entries":        col.get("entries"),
        "vote_score":     col.get("vote_score"),
        "comments_count": col.get("comments_count"),
        "created":        col.get("created"),
        "updated":        col.get("updated"),
        "author":         slim_author(col.get("author", {})),
        "collection":     [slim_content_item(i) for i in col.get("collection", [])[:3]],
    }


def load_existing(path: Path) -> tuple[list[dict], set[str]]:
    """Завантажує існуючий JSON файл. Повертає (список колекцій, set of reference)."""
    if not path.exists():
        return [], set()
    try:
        data     = json.loads(path.read_text(encoding="utf-8"))
        existing = data.get("collections", [])
        known    = {c["reference"] for c in existing if c.get("reference")}
        print(f"  📂 {path.name}: знайдено {len(existing)} існуючих записів")
        return existing, known
    except (json.JSONDecodeError, KeyError) as e:
        print(f"  ⚠ Не вдалось прочитати {path.name}: {e} — починаємо з нуля", file=sys.stderr)
        return [], set()


def write_json(path: Path, collections: list[dict]) -> None:
    output = {
        "parsed_at":   datetime.now(timezone.utc).isoformat(),
        "total":       len(collections),
        "collections": collections,
    }
    path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")


async def fetch_collections_page(
    session: aiohttp.ClientSession, page: int, size: int = 30
) -> tuple[list[dict], int]:
    url     = f"{BASE_URL}/collections"
    payload = {"sort": ["created:desc"], "only_public": True}

    async with session.post(url, json=payload, params={"page": page, "size": size}) as resp:
        resp.raise_for_status()
        data = await resp.json()

    total = data.get("pagination", {}).get("total", 0)
    return data.get("list", []), total


async def fetch_all_refs(session: aiohttp.ClientSession) -> list[dict]:
    """Завантажує всі сторінки колекцій без жодних пропусків."""
    size = 30
    first_page, total = await fetch_collections_page(session, page=1, size=size)

    pages = (total + size - 1) // size
    print(f"  Всього колекцій: {total}, сторінок: {pages}")

    all_refs = list(first_page)

    for page in range(2, pages + 1):
        page_data, _ = await fetch_collections_page(session, page=page, size=size)
        all_refs.extend(page_data)
        print(f"  Сторінка {page}/{pages} — отримано {len(page_data)}")

    return all_refs


async def fetch_new_refs(
    session: aiohttp.ClientSession, known: set[str]
) -> list[dict]:
    """
    Завантажує сторінки колекцій, зупиняючись як тільки зустріне вже відому.
    Працює надійно бо API сортує created:desc — нові завжди йдуть спочатку.
    """
    size     = 30
    page     = 1
    new_refs = []

    while True:
        page_data, total = await fetch_collections_page(session, page=page, size=size)
        if not page_data:
            break

        pages = (total + size - 1) // size
        found_known = False

        for col in page_data:
            if col.get("reference") in known:
                found_known = True
                break
            new_refs.append(col)

        print(f"  Сторінка {page}/{pages} — нових: {len(new_refs)}")

        if found_known or page >= pages:
            break

        page += 1

    return new_refs


CONCURRENCY = 10


async def fetch_full_collection(
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
    reference: str,
    title: str,
    index: int,
    total: int,
) -> dict | None:
    async with sem:
        print(f"  [{index}/{total}] {title!r}")
        try:
            async with session.get(f"{BASE_URL}/collections/{reference}") as resp:
                resp.raise_for_status()
                return await resp.json()
        except aiohttp.ClientResponseError as e:
            print(f"  ✗ {reference}: {e.status}", file=sys.stderr)
            return None


def split_by_visibility(collections: list[dict]) -> tuple[list[dict], list[dict], list[dict]]:
    """Розбиває список на public, unlisted та інші."""
    public   = [c for c in collections if c.get("visibility") == "public"]
    unlisted = [c for c in collections if c.get("visibility") == "unlisted"]
    other    = [c for c in collections if c.get("visibility") not in ("public", "unlisted")]
    return public, unlisted, other


async def main(full_update: bool) -> None:
    headers = {
        "Content-Type": "application/json",
        "Accept":       "application/json",
        "User-Agent":   "hikka-collection-parser/1.0",
    }

    if full_update:
        print("▶ Режим: повне оновлення (--full)")
    else:
        print("▶ Режим: інкрементальне оновлення (тільки нові)")

    print("▶ Читаємо існуючі файли...")
    existing_public,   known_public   = load_existing(OUTPUT_PUBLIC)
    existing_unlisted, known_unlisted = load_existing(OUTPUT_UNLISTED)
    known_all = known_public | known_unlisted

    print("▶ Підключаємось до Hikka API...")

    async with aiohttp.ClientSession(headers=headers) as session:
        if full_update:
            print("▶ Завантажуємо всі колекції...")
            try:
                refs = await fetch_all_refs(session)
            except aiohttp.ClientResponseError as e:
                print(f"✗ Помилка запиту: {e.status} {e.message}", file=sys.stderr)
                sys.exit(1)
        else:
            print("▶ Шукаємо нові колекції (created:desc)...")
            try:
                refs = await fetch_new_refs(session, known_all)
            except aiohttp.ClientResponseError as e:
                print(f"✗ Помилка запиту: {e.status} {e.message}", file=sys.stderr)
                sys.exit(1)

            if not refs:
                print("\n✓ Нових колекцій немає — файли не змінено.")
                return

        print(f"▶ Завантажуємо повні дані для {len(refs)} колекцій (concurrency={CONCURRENCY})...")
        sem   = asyncio.Semaphore(CONCURRENCY)
        total = len(refs)

        tasks = [
            fetch_full_collection(session, sem, col["reference"], col.get("title", "?"), i, total)
            for i, col in enumerate(refs, 1)
        ]
        results = await asyncio.gather(*tasks)

    fetched = [slim_collection(r) for r in results if r is not None]
    new_public, new_unlisted, other = split_by_visibility(fetched)

    if other:
        print(f"  ⚠ {len(other)} колекцій з невідомим visibility: {set(c['visibility'] for c in other)}")

    if full_update:
        # Повне перезаписування — існуючі дані ігноруються
        merged_public   = new_public
        merged_unlisted = new_unlisted
    else:
        # Нові додаємо на початок (зберігається порядок created:desc)
        merged_public   = new_public   + existing_public
        merged_unlisted = new_unlisted + existing_unlisted

    write_json(OUTPUT_PUBLIC,   merged_public)
    write_json(OUTPUT_UNLISTED, merged_unlisted)

    if full_update:
        print(f"\n✓ public:   {len(merged_public):>5} колекцій → {OUTPUT_PUBLIC}")
        print(f"✓ unlisted: {len(merged_unlisted):>5} колекцій → {OUTPUT_UNLISTED}")
    else:
        print(f"\n✓ public:   +{len(new_public):>4} нових  (всього {len(merged_public)}) → {OUTPUT_PUBLIC}")
        print(f"✓ unlisted: +{len(new_unlisted):>4} нових  (всього {len(merged_unlisted)}) → {OUTPUT_UNLISTED}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Hikka collections parser")
    parser.add_argument(
        "--full",
        action="store_true",
        default=False,
        help="Повністю перезаписати всі колекції (за замовчуванням — лише нові)",
    )
    args = parser.parse_args()

    asyncio.run(main(full_update=args.full))