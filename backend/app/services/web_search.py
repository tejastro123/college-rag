"""Web and YouTube search service for live content retrieval."""
from __future__ import annotations

import json
from typing import Optional
from urllib.parse import quote_plus

import httpx
from app.core.logging import get_logger

logger = get_logger(__name__)


async def search_web(
    query: str,
    max_results: int = 5,
) -> list[dict]:
    """Search the web using DuckDuckGo (no API key needed)."""
    try:
        from duckduckgo_search import DDGS
        results = []
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=max_results):
                results.append({
                    "title": r.get("title", ""),
                    "url": r.get("href", ""),
                    "snippet": r.get("body", ""),
                })
        return results
    except Exception as e:
        logger.warning("Web search failed, trying fallback", error=str(e))
        return await _search_fallback(query, max_results)


async def _search_fallback(query: str, max_results: int = 5) -> list[dict]:
    """Fallback using httpx + HTML scraping of a public search engine."""
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml",
        }
        url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()

        from bs4 import BeautifulSoup
        soup = BeautifulSoup(resp.text, "html.parser")
        results = []
        for item in soup.select(".result")[:max_results]:
            title_el = item.select_one(".result__title a")
            snippet_el = item.select_one(".result__snippet")
            if title_el:
                results.append({
                    "title": title_el.get_text(strip=True),
                    "url": title_el.get("href", ""),
                    "snippet": snippet_el.get_text(strip=True) if snippet_el else "",
                })
        return results
    except Exception as e:
        logger.error("Search fallback failed", error=str(e))
        return []


async def search_youtube(
    query: str,
    max_results: int = 5,
) -> list[dict]:
    """Search YouTube and return video info with transcripts."""
    try:
        from duckduckgo_search import DDGS
        video_results = []
        with DDGS() as ddgs:
            for r in ddgs.videos(query, max_results=max_results):
                video_results.append({
                    "title": r.get("title", ""),
                    "url": r.get("content", "") or r.get("href", ""),
                    "description": r.get("description", ""),
                    "duration": r.get("duration", ""),
                    "thumbnail": r.get("image", ""),
                })
        return video_results
    except Exception as e:
        logger.warning("YouTube search via DDG failed", error=str(e))
        return await _search_youtube_fallback(query, max_results)


async def _search_youtube_fallback(query: str, max_results: int = 5) -> list[dict]:
    """Fallback YouTube search using direct scraping."""
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        }
        url = f"https://www.youtube.com/results?search_query={quote_plus(query)}"
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
        return [{"title": "Search complete", "url": url, "description": "Check YouTube directly"}]
    except Exception as e:
        logger.error("YouTube fallback failed", error=str(e))
        return []


async def get_youtube_transcript(video_id: str) -> Optional[str]:
    """Fetch transcript for a YouTube video given its ID."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        transcript = YouTubeTranscriptApi.get_transcript(video_id)
        return " ".join(segment["text"] for segment in transcript)
    except Exception as e:
        logger.warning("YouTube transcript fetch failed", video_id=video_id, error=str(e))
        return None


async def search_and_summarize(
    query: str,
    sources: list[str] = ["web"],
    max_results: int = 5,
) -> dict:
    """Search multiple sources and return combined results."""
    results = {}
    if "web" in sources:
        results["web"] = await search_web(query, max_results)
    if "youtube" in sources:
        results["youtube"] = await search_youtube(query, max_results)
    return results
