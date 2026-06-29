"""Verifierar login + CSRF-skyddad POST over HTTPS-tunneln (med Origin-header
som en webblasare skickar)."""
import sys
import requests

BASE = sys.argv[1].rstrip("/") + "/api"
ORIGIN = sys.argv[1].rstrip("/")
s = requests.Session()
s.headers.update({"Origin": ORIGIN, "Referer": ORIGIN + "/"})

s.get(f"{BASE}/auth/csrf/", timeout=20)
csrf = s.cookies.get("csrftoken")
assert csrf, "Ingen csrftoken over tunneln"
print("OK: csrftoken")

r = s.post(f"{BASE}/auth/login/",
           json={"username": "admin", "password": "cykel2026"},
           headers={"X-CSRFToken": csrf}, timeout=20)
assert r.status_code == 200, f"login: {r.status_code} {r.text}"
print("OK: inloggad")

# CSRF-skyddad POST: skapa + ta bort ett testprojekt.
csrf = s.cookies.get("csrftoken")
r = s.post(f"{BASE}/projects/",
           json={"title": "TUNNELTEST", "budget": "0",
                 "start_date": "2026-08-01", "end_date": "2026-08-01"},
           headers={"X-CSRFToken": csrf}, timeout=20)
assert r.status_code == 201, f"POST projekt (CSRF): {r.status_code} {r.text}"
pid = r.json()["id"]
print("OK: CSRF-skyddad POST gick igenom (projekt skapat)")

csrf = s.cookies.get("csrftoken")
s.delete(f"{BASE}/projects/{pid}/", headers={"X-CSRFToken": csrf}, timeout=20)
print("OK: stadat upp")
print("\n[OK] Tunneln fungerar fullt ut (login + CSRF).")
