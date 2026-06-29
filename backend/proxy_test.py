"""Verifierar login via Next-proxyn (samma origin som tunneln anvander)."""
import requests

BASE = "http://localhost:3001/api"  # via Next-proxyn, inte Django direkt
s = requests.Session()
s.get(f"{BASE}/auth/csrf/", timeout=10)
csrf = s.cookies.get("csrftoken")
assert csrf, "Ingen csrftoken via proxyn"
print("OK: csrftoken via proxy")

r = s.post(f"{BASE}/auth/login/",
           json={"username": "admin", "password": "cykel2026"},
           headers={"X-CSRFToken": csrf}, timeout=10)
assert r.status_code == 200, f"Login via proxy: {r.status_code} {r.text}"
print("OK: inloggad via proxy som", r.json()["username"])

r = s.get(f"{BASE}/auth/me/", timeout=10)
assert r.status_code == 200, f"/me via proxy: {r.status_code}"
print("OK: /me via proxy bekraftar session")
print("\n[OK] Proxy-login fungerar.")
