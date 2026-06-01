"""
Hikka API — парс усіх колекцій у два JSON файли.
Сортування: created:desc. Content type: будь-який.

Структура збереження:
  - author: reference, username, avatar
  - collection: лише перші 3 елементи з поля collection
      - контент (anime/manga/novel): title_ua|title_ja|title_original + image
      - персонажі/персони: name_ua|name_en + image
  - сама колекція: без поля description

Вихідні файли:
  - collections_public.json   — visibility == "public"
  - collections_unlisted.json — visibility == "unlisted"
"""

import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import aiohttp

BASE_URL = "https://api.hikka.io"
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
        slim = {"name": pick_name(content),   "image": content.get("image"), "slug": content.get("slug")}
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
        "reference":    col.get("reference"),
        "title":        col.get("title"),
        "content_type": col.get("content_type"),
        "visibility":   col.get("visibility"),
        "spoiler":      col.get("spoiler"),
        "nsfw":         col.get("nsfw"),
        "tags":         col.get("tags", []),
        "labels_order": col.get("labels_order", []),
        "entries":      col.get("entries"),
        "vote_score":   col.get("vote_score"),
        "comments_count": col.get("comments_count"),
        "created": col.get("created"),
        "updated": col.get("updated"),
        "author":     slim_author(col.get("author", {})),
        "collection": [slim_content_item(i) for i in col.get("collection", [])[:3]],
    }


async def fetch_collections_page(
    session: aiohttp.ClientSession, page: int, size: int = 30
) -> tuple[list[dict], int]:
    url     = f"{BASE_URL}/collections"
    payload = {"sort": ["created:desc"], "only_public": False}

    async with session.post(url, json=payload, params={"page": page, "size": size}) as resp:
        resp.raise_for_status()
        data = await resp.json()

    total = data.get("pagination", {}).get("total", 0)
    return data.get("list", []), total


async def fetch_all_collections(session: aiohttp.ClientSession) -> list[dict]:
    size = 30
    first_page, total = await fetch_collections_page(session, page=1, size=size)

    pages = (total + size - 1) // size
    print(f"  Всього колекцій: {total}, сторінок: {pages}")

    all_collections = list(first_page)

    for page in range(2, pages + 1):
        page_data, _ = await fetch_collections_page(session, page=page, size=size)
        all_collections.extend(page_data)
        print(f"  Сторінка {page}/{pages} — отримано {len(page_data)}")

    return all_collections


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


def write_json(path: Path, collections: list[dict]) -> None:
    output = {
        "parsed_at": datetime.now(timezone.utc).isoformat(),
        "total":     len(collections),
        "collections": collections,
    }
    path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")


async def main():
    headers = {
        "Content-Type": "application/json",
        "Accept":       "application/json",
        "User-Agent":   "hikka-collection-parser/1.0",
    }

    print("▶ Підключаємось до Hikka API...")

    async with aiohttp.ClientSession(headers=headers) as session:
        print("▶ Завантажуємо список усіх колекцій (created:desc)...")
        try:
            all_refs = await fetch_all_collections(session)
        except aiohttp.ClientResponseError as e:
            print(f"✗ Помилка запиту списку: {e.status} {e.message}", file=sys.stderr)
            sys.exit(1)

        print(f"▶ Завантажуємо повні дані для {len(all_refs)} колекцій (concurrency={CONCURRENCY})...")
        sem   = asyncio.Semaphore(CONCURRENCY)
        total = len(all_refs)

        tasks = [
            fetch_full_collection(session, sem, col["reference"], col.get("title", "?"), i, total)
            for i, col in enumerate(all_refs, 1)
        ]
        results = await asyncio.gather(*tasks)

    full = [slim_collection(r) for r in results if r is not None]

    # Розбиваємо на два списки за полем visibility
    public   = [c for c in full if c.get("visibility") == "public"]
    unlisted = [c for c in full if c.get("visibility") == "unlisted"]
    other    = [c for c in full if c.get("visibility") not in ("public", "unlisted")]

    if other:
        print(f"  ⚠ {len(other)} колекцій з невідомим visibility: {set(c['visibility'] for c in other)}")

    write_json(OUTPUT_PUBLIC,   public)
    write_json(OUTPUT_UNLISTED, unlisted)

    print(f"\n✓ public:   {len(public):>5} колекцій → {OUTPUT_PUBLIC}")
    print(f"✓ unlisted: {len(unlisted):>5} колекцій → {OUTPUT_UNLISTED}")


if __name__ == "__main__":
    asyncio.run(main())