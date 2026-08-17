"""Weather tool — free, no-API-key Open-Meteo geocoding + forecast.

Real, live weather data only, never fabricated. Returns `None` when no
resolvable place name was found in the query rather than guessing a
location, since a wrong location would be worse than falling back to the
normal answer path (which will then ask the user to specify a place).
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx

_GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

_PLACE_RE = re.compile(
    r"\b(?:weather|temperature|forecast|rain(?:fall|ing)?|humidity)\b.*?"
    r"\b(?:in|at|for|near)\s+([A-Za-z][A-Za-z\s]{1,40}?)"
    r"(?:\s+(?:today|tomorrow|tonight|now|currently|right\s+now|this\s+week|this\s+weekend)\b|[?.!,]|$)",
    re.IGNORECASE,
)

_WEATHER_CODES = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Depositing rime fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
    80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
    95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail",
}


def extract_place(message: str) -> Optional[str]:
    m = _PLACE_RE.search(message)
    return m.group(1).strip() if m else None


async def run(message: str) -> Optional[Dict[str, Any]]:
    place = extract_place(message)
    if not place:
        return None

    async with httpx.AsyncClient(timeout=8.0) as client:
        try:
            geo_resp = await client.get(_GEOCODE_URL, params={"name": place, "count": 1})
            geo_resp.raise_for_status()
            geo = geo_resp.json()
        except (httpx.HTTPError, ValueError):
            return None

        results = geo.get("results") or []
        if not results:
            return None
        loc = results[0]
        lat, lon = loc.get("latitude"), loc.get("longitude")
        resolved_name = ", ".join(
            p for p in [loc.get("name"), loc.get("admin1"), loc.get("country")] if p
        )

        try:
            fc_resp = await client.get(
                _FORECAST_URL,
                params={
                    "latitude": lat,
                    "longitude": lon,
                    "current": "temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation,weather_code",
                    "timezone": "auto",
                },
            )
            fc_resp.raise_for_status()
            fc = fc_resp.json()
        except (httpx.HTTPError, ValueError):
            return None

    current = fc.get("current") or {}
    if not current:
        return None

    code = current.get("weather_code")
    return {
        "location": resolved_name,
        "temperature_c": current.get("temperature_2m"),
        "humidity_pct": current.get("relative_humidity_2m"),
        "wind_kmh": current.get("wind_speed_10m"),
        "precipitation_mm": current.get("precipitation"),
        "condition": _WEATHER_CODES.get(code, "Unknown"),
        "observed_at": current.get("time"),
        "source": "Open-Meteo",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def format_context(data: Dict[str, Any]) -> str:
    """Renders the weather payload as grounded context text for the LLM
    prompt — the system prompt instructs the model to use these exact
    numbers rather than inventing its own."""
    lines = [
        f"Live weather for {data['location']} (source: Open-Meteo, observed {data.get('observed_at', 'now')}):",
        f"- Condition: {data['condition']}",
        f"- Temperature: {data['temperature_c']}°C",
        f"- Humidity: {data['humidity_pct']}%",
        f"- Wind speed: {data['wind_kmh']} km/h",
        f"- Precipitation: {data['precipitation_mm']} mm",
    ]
    return "\n".join(lines)
