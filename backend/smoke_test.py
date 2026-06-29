"""Skarpt rÃ¶k-test mot en kÃ¶rande server: CSRF + login + skapa projekt.

KÃ¶r med servern igÃ¥ng:  python smoke_test.py
Tar bort sitt testprojekt efterÃ¥t.
"""
import sys
import requests

BASE = "http://localhost:8001/api"
s = requests.Session()

# 1. HÃ¤mta CSRF-cookie.
s.get(f"{BASE}/auth/csrf/", timeout=10)
csrf = s.cookies.get("csrftoken")
assert csrf, "Ingen csrftoken-cookie sattes"
print("OK: csrftoken-cookie satt")

# 2. Logga in.
r = s.post(f"{BASE}/auth/login/",
           json={"username": "admin", "password": "cykel2026"},
           headers={"X-CSRFToken": csrf}, timeout=10)
assert r.status_code == 200, f"Login misslyckades: {r.status_code} {r.text}"
print("OK: inloggad som", r.json()["username"])

# 3. /me ska nu fungera.
r = s.get(f"{BASE}/auth/me/", timeout=10)
assert r.status_code == 200 and r.json()["is_superadmin"], r.text
print("OK: /me bekrÃ¤ftar superadmin")

# 4. Skapa projekt (krÃ¤ver CSRF + session).
csrf = s.cookies.get("csrftoken")
r = s.post(f"{BASE}/projects/",
           json={"title": "RÃ–KTEST", "budget": "2000",
                 "start_date": "2026-08-01", "end_date": "2026-08-03"},
           headers={"X-CSRFToken": csrf}, timeout=10)
assert r.status_code == 201, f"Kunde inte skapa projekt: {r.status_code} {r.text}"
pid = r.json()["id"]
print(f"OK: projekt skapat (id={pid})")

# 5. Detalj ska visa 3 autogenererade dagar + dagsbudget.
r = s.get(f"{BASE}/projects/{pid}/", timeout=10)
data = r.json()
assert len(data["days"]) == 3, f"FÃ¶rvÃ¤ntade 3 dagar, fick {len(data['days'])}"
assert len(data["daily_budgets"]) == 3
print(f"OK: {len(data['days'])} dagar genererade, dagsbudget berÃ¤knad")

# 6. Riktig ORS-ruttberÃ¤kning (Mora -> Orsa, ca 15 km).
day_id = data["days"][0]["id"]
csrf = s.cookies.get("csrftoken")
r = s.post(f"{BASE}/stages/",
           json={"day": day_id, "order": 0, "from_point": "",
                 "to_point": "",
                 "waypoints": [[14.5400, 61.0050], [14.6100, 61.1200]]},
           headers={"X-CSRFToken": csrf}, timeout=15)
assert r.status_code == 201, f"Kunde inte skapa etapp: {r.text}"
stage_id = r.json()["id"]
csrf = s.cookies.get("csrftoken")
r = s.post(f"{BASE}/stages/{stage_id}/calculate/",
           headers={"X-CSRFToken": csrf}, timeout=90)
assert r.status_code == 200, f"ORS-berÃ¤kning misslyckades: {r.status_code} {r.text}"
st = r.json()
assert st["distance_km"] and st["distance_km"] > 0, st
print(f"OK: ORS gav {st['distance_km']} km, "
      f"stigning {st['ascent_m']} m, nivÃ¥ {st['difficulty_level']}, "
      f"restid {st['estimated_duration_minutes']} min")
# FrÃ¥n/Till ska ha autofyllts frÃ¥n kartans start/slut.
assert st["from_point"] and st["to_point"], f"FrÃ¥n/Till ej autofyllt: {st}"
assert st["from_country"] == "SE" and st["to_country"] == "SE", st
print(f"OK: FrÃ¥n/Till autofyllt: {st['from_country']} {st['from_point']} "
      f"-> {st['to_country']} {st['to_point']}")

# 6b. Byt slutpunkt och berÃ¤kna om -> autofyllt Till ska uppdateras.
old_to = st["to_point"]
csrf = s.cookies.get("csrftoken")
s.patch(f"{BASE}/stages/{stage_id}/",
        json={"waypoints": [[14.5400, 61.0050], [15.1150, 60.8880]]},
        headers={"X-CSRFToken": csrf}, timeout=10)
csrf = s.cookies.get("csrftoken")
r = s.post(f"{BASE}/stages/{stage_id}/calculate/",
           headers={"X-CSRFToken": csrf}, timeout=90)
st2 = r.json()
assert st2["to_point"] and st2["to_point"] != old_to, (
    f"Till uppdaterades inte vid ny slutpunkt: {old_to} -> {st2['to_point']}")
print(f"OK: ny slutpunkt -> Till uppdaterat: {old_to} -> {st2['to_point']}")

# 7. Markera dag 2 som vilodag och kontrollera statistiken.
csrf = s.cookies.get("csrftoken")
r = s.patch(f"{BASE}/days/{data['days'][1]['id']}/",
            json={"is_rest_day": True},
            headers={"X-CSRFToken": csrf}, timeout=10)
assert r.status_code == 200, r.text
stats = s.get(f"{BASE}/projects/{pid}/", timeout=10).json()["stats"]
assert stats["rest_day_count"] == 1, stats
assert stats["total_distance_km"] > 0, stats
print(f"OK: statistik â€“ {stats['rest_day_count']} vilodag, "
      f"{stats['cycling_day_count']} cykeldagar, "
      f"snitt {stats['avg_km_per_cycling_day']} km/dag, "
      f"stigning {stats['total_ascent_m']} m, hÃ¶gsta {stats['highest_point_m']} m")
countries = stats.get("countries", [])
print(f"OK: lÃ¤nder upptÃ¤ckta: "
      f"{', '.join(c['code'] for c in countries) or '(inga)'} "
      f"(antal {stats['country_count']})")

# 7b. Satt cyklistprofil och kontrollera kaloriberakningen.
csrf = s.cookies.get("csrftoken")
r = s.patch(f"{BASE}/projects/{pid}/",
            json={"rider_gender": "M", "rider_age": 40,
                  "rider_height_cm": 180, "rider_weight_kg": 80},
            headers={"X-CSRFToken": csrf}, timeout=10)
assert r.status_code == 200, r.text
cal = s.get(f"{BASE}/projects/{pid}/", timeout=10).json()["stats"]
assert cal["has_calorie_profile"] and cal["bmr"] == 1730, cal
assert cal["total_cycling_calories"] > 0, cal
assert cal["total_calories"] > cal["total_cycling_calories"], cal
print(f"OK: kalorier - BMR {cal['bmr']}, "
      f"cykel {cal['total_cycling_calories']} kcal, "
      f"total {cal['total_calories']} kcal")

# 7c. Cykellage: logga utgift + faktisk tid, kontrollera utfall.
csrf = s.cookies.get("csrftoken")
r = s.post(f"{BASE}/logs/",
           json={"day": day_id, "kind": "EXPENSE",
                 "category": "LUNCH", "amount": 145, "text": "Lunch"},
           headers={"X-CSRFToken": csrf}, timeout=10)
assert r.status_code == 201, r.text
csrf = s.cookies.get("csrftoken")
r = s.patch(f"{BASE}/days/{day_id}/",
            json={"actual_distance_km": 18.5,
                  "actual_start_time": "09:00", "actual_end_time": "12:30"},
            headers={"X-CSRFToken": csrf}, timeout=10)
assert r.status_code == 200, r.text
d = s.get(f"{BASE}/days/{day_id}/", timeout=10).json()
assert len(d["logs"]) == 1, d
assert float(d["actual_cost"]) == 145.0, d
assert d["actual_duration_minutes"] == 210, d
print(f"OK: cykellage - logg {len(d['logs'])} post, "
      f"verklig kostnad {d['actual_cost']} kr, "
      f"verklig tid {d['actual_duration_minutes']} min, "
      f"verklig stracka {d['actual_distance_km']} km")

# 8. Stada upp.
csrf = s.cookies.get("csrftoken")
r = s.delete(f"{BASE}/projects/{pid}/", headers={"X-CSRFToken": csrf}, timeout=10)
assert r.status_code == 204, r.text
print("OK: testprojekt borttaget")

print("\n[OK] Alla rÃ¶k-test passerade.")
sys.exit(0)

