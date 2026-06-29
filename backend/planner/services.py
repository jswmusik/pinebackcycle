"""Integration mot OpenRouteService (ORS).

ORS är gratis (skaffa nyckel på https://openrouteservice.org/dev/) och ger
distans, restid och höjddata (ascent/descent) för cykelrutter i ett anrop.
"""
import math
import time

import requests
from django.conf import settings

ORS_DIRECTIONS_URL = (
    'https://api.openrouteservice.org/v2/directions/{profile}/geojson'
)

# ORS cykelprofiler.
PROFILES = {
    'regular': 'cycling-regular',
    'road': 'cycling-road',
    'mountain': 'cycling-mountain',
    'electric': 'cycling-electric',
}


class ORSError(Exception):
    """Fel vid anrop mot OpenRouteService."""


def get_route(waypoints, profile='regular'):
    """Hämta ruttdata från ORS.

    Args:
        waypoints: lista av [lng, lat]-koordinater, minst två punkter.
        profile: nyckel i PROFILES (regular/road/mountain/electric).

    Returns:
        dict med distance_km, ascent_m, descent_m, duration_s, geometry.

    Raises:
        ORSError vid saknad nyckel, för få punkter eller API-fel.
    """
    if not settings.ORS_API_KEY:
        raise ORSError(
            'ORS_API_KEY saknas. Sätt miljövariabeln innan du beräknar rutter.'
        )
    if not waypoints or len(waypoints) < 2:
        raise ORSError('Minst två punkter (från och till) krävs.')

    ors_profile = PROFILES.get(profile, PROFILES['regular'])
    url = ORS_DIRECTIONS_URL.format(profile=ors_profile)
    headers = {
        'Authorization': settings.ORS_API_KEY,
        'Content-Type': 'application/json',
    }
    body = {
        'coordinates': waypoints,
        'elevation': True,  # ger ascent/descent
    }

    # OpenRouteService kan ge tillfälliga 5xx-fel – försök igen några gånger.
    resp = None
    last_exc = None
    for attempt in range(3):
        if attempt:
            time.sleep(1.5 * attempt)  # kort backoff mellan försök
        try:
            resp = requests.post(url, json=body, headers=headers, timeout=30)
        except requests.RequestException as exc:
            last_exc = exc
            continue
        if resp.status_code == 200:
            break
        if resp.status_code in (429, 502, 503, 504):
            continue  # tillfälligt – försök igen
        break  # andra fel (t.ex. 400/401) – ingen mening att försöka igen

    if resp is None:
        raise ORSError(
            'Kunde inte nå OpenRouteService just nu. Kontrollera din '
            f'internetanslutning och försök igen. ({last_exc})'
        )
    if resp.status_code in (429, 502, 503, 504):
        raise ORSError(
            'OpenRouteService är tillfälligt överbelastad. Vänta en stund '
            'och tryck Beräkna igen.'
        )
    if resp.status_code == 401:
        raise ORSError('ORS-nyckeln nekades (401). Kontrollera ORS_API_KEY.')
    if resp.status_code != 200:
        # Visa ev. felmeddelande från ORS, men aldrig rå HTML.
        detail = ''
        try:
            detail = resp.json().get('error', {}).get('message', '')
        except ValueError:
            detail = ''
        raise ORSError(
            f'Ruttberäkningen misslyckades (ORS {resp.status_code}).'
            + (f' {detail}' if detail else '')
        )

    data = resp.json()
    try:
        feature = data['features'][0]
        props = feature['properties']
        summary = props['summary']
        ascent = props.get('ascent', 0)
        descent = props.get('descent', 0)
        geometry = feature['geometry']
    except (KeyError, IndexError) as exc:
        raise ORSError('Oväntat svar från ORS.') from exc

    # Sväng-för-sväng-instruktioner (för navigatorn).
    steps = []
    for seg in props.get('segments', []):
        for st in seg.get('steps', []):
            wp = st.get('way_points', [0, 0])
            name = st.get('name', '')
            steps.append({
                'instruction': st.get('instruction', ''),
                'name': '' if name in ('-', None) else name,
                'distance': round(st.get('distance', 0)),
                'type': st.get('type'),
                'way_point': wp[0],
            })

    return {
        'distance_km': round(summary['distance'] / 1000, 2),
        'duration_s': round(summary.get('duration', 0)),
        'ascent_m': round(ascent, 1),
        'descent_m': round(descent, 1),
        'geometry': geometry,
        'steps': steps,
    }


# --- Landsdetektering --------------------------------------------------------
NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse'
# Nominatim kräver en identifierande User-Agent.
NOMINATIM_HEADERS = {'User-Agent': 'Cykelsemesterplaneraren/1.0'}


def _haversine_km(a, b):
    """Avstånd i km mellan två [lng, lat]-punkter."""
    r = 6371
    dlat = math.radians(b[1] - a[1])
    dlng = math.radians(b[0] - a[0])
    h = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(a[1])) * math.cos(math.radians(b[1]))
         * math.sin(dlng / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(h))


def _reverse_country(lat, lng):
    """Slå upp land för en koordinat via Nominatim. Returnerar (kod, namn)."""
    resp = requests.get(
        NOMINATIM_REVERSE,
        params={'format': 'json', 'lat': lat, 'lon': lng,
                'zoom': 3, 'addressdetails': 1},
        headers=NOMINATIM_HEADERS, timeout=8,
    )
    resp.raise_for_status()
    addr = resp.json().get('address', {})
    return addr.get('country_code', '').upper(), addr.get('country', 'Okänt')


def reverse_place(lat, lng):
    """Slå upp ortnamn och landskod för en koordinat via Nominatim.

    Returnerar (namn, landskod). Tomma strängar om uppslag misslyckas.
    """
    try:
        resp = requests.get(
            NOMINATIM_REVERSE,
            params={'format': 'json', 'lat': lat, 'lon': lng,
                    'zoom': 14, 'addressdetails': 1},
            headers=NOMINATIM_HEADERS, timeout=8,
        )
        resp.raise_for_status()
        addr = resp.json().get('address', {})
    except requests.RequestException:
        return '', ''
    country = (addr.get('country_code') or '').upper()
    for key in ('city', 'town', 'village', 'hamlet', 'municipality',
                'suburb', 'county'):
        if addr.get(key):
            return addr[key], country
    return '', country


def country_breakdown(geometry):
    """Beräkna km per land längs en rutt.

    Samplar upp till 5 punkter längs rutten, slår upp land för varje (med
    paus för Nominatims hastighetsgräns) och fördelar varje delsträcka till
    närmaste samplade punkts land.

    Returnerar en lista [{code, name, km}] eller [] om uppslag misslyckas.
    """
    coords = (geometry or {}).get('coordinates', [])
    if len(coords) < 2:
        return []

    # Kumulativ distans per punkt.
    cum = [0.0]
    for i in range(1, len(coords)):
        cum.append(cum[-1] + _haversine_km(coords[i - 1], coords[i]))
    total = cum[-1]
    if total <= 0:
        return []

    # Välj samplingsindex jämnt fördelade längs sträckan.
    # Färre punkter = snabbare beräkning (varje uppslag pausar ~1s).
    n_samples = min(3, max(1, int(total // 40) + 1))
    sample_idx = [
        min(range(len(cum)), key=lambda j: abs(cum[j] - frac * total))
        for frac in [(k + 0.5) / n_samples for k in range(n_samples)]
    ]

    # Slå upp land för varje sampling (cacha per koordinat).
    sample_country = {}
    for idx in sample_idx:
        if idx in sample_country:
            continue
        try:
            sample_country[idx] = _reverse_country(coords[idx][1], coords[idx][0])
        except requests.RequestException:
            return []  # ge upp tyst – landsdata är en bonus
        time.sleep(1)  # respektera Nominatims gräns

    # Fördela varje delsträcka till närmaste samplade punkts land.
    km_by_code = {}
    names = {}
    for i in range(1, len(coords)):
        seg_km = cum[i] - cum[i - 1]
        nearest = min(sample_idx, key=lambda j: abs(j - i))
        code, name = sample_country[nearest]
        if not code:
            continue
        km_by_code[code] = km_by_code.get(code, 0) + seg_km
        names[code] = name

    return [
        {'code': code, 'name': names[code], 'km': round(km, 2)}
        for code, km in sorted(km_by_code.items(), key=lambda t: -t[1])
    ]
