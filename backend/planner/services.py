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


# --- Väder & vind längs rutten (Open-Meteo, gratis, ingen nyckel) ------------
OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'
# Open-Meteo ger prognos ~16 dagar framåt.
FORECAST_HORIZON_DAYS = 15


def _bearing(a, b):
    """Initial kompassbäring (grader, 0=N) från punkt a till b ([lng, lat])."""
    lng1, lat1 = math.radians(a[0]), math.radians(a[1])
    lng2, lat2 = math.radians(b[0]), math.radians(b[1])
    dlng = lng2 - lng1
    y = math.sin(dlng) * math.cos(lat2)
    x = (math.cos(lat1) * math.sin(lat2)
         - math.sin(lat1) * math.cos(lat2) * math.cos(dlng))
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def _sample_route(coords, n=4):
    """Välj n punkter jämnt fördelade längs rutten (efter kumulativ distans).

    Returnerar [{idx, km, frac}] där frac är andel av sträckan (0..1).
    """
    cum = [0.0]
    for i in range(1, len(coords)):
        cum.append(cum[-1] + _haversine_km(coords[i - 1], coords[i]))
    total = cum[-1]
    if total <= 0:
        return []
    out = []
    seen = set()
    for k in range(n):
        target = total * (k / (n - 1) if n > 1 else 0)
        idx = min(range(len(cum)), key=lambda j: abs(cum[j] - target))
        if idx in seen:
            continue
        seen.add(idx)
        out.append({'idx': idx, 'km': round(cum[idx], 1), 'frac': cum[idx] / total})
    return out


def _fetch_weather(latlngs, date_iso):
    """Hämta timvis väder för en dag i flera punkter (ett anrop mot Open-Meteo).

    latlngs: lista av (lat, lng). Returnerar en lista med samma ordning där
    varje element har 'hourly'-data, eller [] vid fel.
    """
    lat = ','.join(f'{p[0]:.4f}' for p in latlngs)
    lon = ','.join(f'{p[1]:.4f}' for p in latlngs)
    params = {
        'latitude': lat,
        'longitude': lon,
        'hourly': ('temperature_2m,precipitation,precipitation_probability,'
                   'weather_code,wind_speed_10m,wind_direction_10m'),
        'start_date': date_iso,
        'end_date': date_iso,
        'timezone': 'auto',
    }
    resp = requests.get(OPEN_METEO_URL, params=params, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    if isinstance(data, dict):  # ett enda koordinatpar → dict, annars lista
        data = [data]
    return data


def _hour_index(times, hour):
    """Index i timserien som matchar en viss timme (0-23)."""
    want = f'T{hour:02d}:00'
    for j, t in enumerate(times):
        if t.endswith(want):
            return j
    return min(hour, len(times) - 1) if times else 0


def day_conditions(day):
    """Sammanställ 'dagens förutsättningar': väder + vind längs rutten + stats.

    Tidsmedvetet: uppskattar när man är vid varje punkt (starttid + restid) och
    hämtar vädret för just den timmen. Beräknar med/motvind mot ruttriktningen.
    """
    import datetime

    stages = list(day.stages.all().order_by('order'))
    coords = []
    total_dur = 0
    total_dist = 0.0
    total_ascent = 0.0
    start_min = None
    for s in stages:
        geom = s.route_geometry or {}
        c = geom.get('coordinates') or []
        if c:
            coords.extend(c)
        total_dur += s.estimated_duration_minutes or 0
        total_dist += float(s.distance_km or 0)
        total_ascent += float(s.ascent_m or 0)
        if start_min is None and s.start_time:
            start_min = s.start_time.hour * 60 + s.start_time.minute

    stats = {
        'distance_km': round(total_dist, 1),
        'ascent_m': round(total_ascent),
        'duration_min': total_dur,
        'calories': day.cycling_calories,
    }

    if day.is_rest_day:
        return {'available': False, 'reason': 'rest_day'}
    if len(coords) < 2:
        return {'available': False, 'reason': 'no_route', 'stats': stats}

    today = datetime.date.today()
    days_until = (day.date - today).days
    if days_until < 0 or days_until > FORECAST_HORIZON_DAYS:
        return {
            'available': True,
            'forecast': False,
            'reason': 'past' if days_until < 0 else 'too_far',
            'days_until': days_until,
            'stats': stats,
        }

    if start_min is None:
        start_min = 9 * 60  # standard: avfärd kl 09
    dur = total_dur or int(total_dist / 18 * 60)  # ~18 km/h om tid saknas

    samples = _sample_route(coords, n=4)
    latlngs = [(coords[sm['idx']][1], coords[sm['idx']][0]) for sm in samples]

    try:
        weather = _fetch_weather(latlngs, day.date.isoformat())
    except requests.RequestException:
        return {'available': True, 'forecast': False, 'reason': 'weather_error',
                'days_until': days_until, 'stats': stats}

    step = max(1, len(coords) // 24)
    points, heads, temps, probs, codes, winds = [], [], [], [], [], []
    any_precip = False
    for i, sm in enumerate(samples):
        if i >= len(weather):
            break
        hourly = weather[i].get('hourly') or {}
        times = hourly.get('time') or []
        if not times:
            continue
        arrival = start_min + int(sm['frac'] * dur)
        hh, mm = (arrival // 60) % 24, arrival % 60
        hidx = _hour_index(times, hh)

        def val(key, default=0):
            arr = hourly.get(key) or []
            return arr[hidx] if hidx < len(arr) else default

        temp = val('temperature_2m')
        precip = val('precipitation')
        prob = val('precipitation_probability')
        code = int(val('weather_code'))
        wind = val('wind_speed_10m')
        wdir = val('wind_direction_10m')

        idx = sm['idx']
        nxt = min(idx + step, len(coords) - 1)
        brng = _bearing(coords[idx], coords[nxt]) if nxt != idx else 0
        # Motvind: positiv komponent när vinden kommer från färdriktningen.
        head = round(wind * math.cos(math.radians(brng - wdir)), 1)
        effect = 'headwind' if head > 4 else ('tailwind' if head < -4 else 'crosswind')

        if precip and precip > 0.2:
            any_precip = True
        heads.append(head)
        temps.append(temp)
        probs.append(prob or 0)
        codes.append(code)
        winds.append(wind)

        points.append({
            'km': sm['km'],
            'time': f'{hh:02d}:{mm:02d}',
            'temp': round(temp),
            'code': code,
            'precip_prob': round(prob or 0),
            'wind_kmh': round(wind),
            'wind_dir': round(wdir),
            'bearing': round(brng),
            'headwind_kmh': head,
            'effect': effect,
        })

    if not points:
        return {'available': True, 'forecast': False, 'reason': 'weather_error',
                'days_until': days_until, 'stats': stats}

    avg_head = sum(heads) / len(heads)
    wind_effect = ('headwind' if avg_head > 4
                   else 'tailwind' if avg_head < -4 else 'crosswind')
    summary = {
        'temp_min': round(min(temps)),
        'temp_max': round(max(temps)),
        'precip_prob_max': round(max(probs)),
        'rain': any_precip or max(probs) >= 40,
        'worst_code': max(codes),
        'wind_effect': wind_effect,
        'wind_avg_kmh': round(sum(winds) / len(winds)),
        'headwind_kmh': round(avg_head),
        'start_time': f'{(start_min // 60) % 24:02d}:{start_min % 60:02d}',
    }

    return {
        'available': True,
        'forecast': True,
        'date': day.date.isoformat(),
        'days_until': days_until,
        'summary': summary,
        'points': points,
        'stats': stats,
    }
