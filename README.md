# 🚲 Cykelsemesterplaneraren

Webbapp för att planera cykelsemestrar: dagsetapper, höjdmeter, svårighetsgrad,
restid och budget. Backend i Django + DRF, frontend i Next.js, karta via Leaflet +
OpenStreetMap och ruttdata från OpenRouteService (gratis).

> **Portar:** Den här maskinen kör ett annat projekt på 8000/3000, så den här appen
> använder **backend = 8001** och **frontend = 3001**.

## Innehåll

- `backend/` – Django-API (projekt, dagar, etapper, kostnader, budget, ORS-anrop)
- `frontend/` – Next.js-app (inloggning, projektöversikt, dagsplanering med karta)

## Förutsättningar

- Python 3.13 (finns)
- Node.js 24 (finns)
- En gratis API-nyckel från OpenRouteService (för km/höjdberäkning)

## 1. ORS-nyckel (redan konfigurerad)

Ruttberäkningen använder OpenRouteService. Nyckeln ligger redan i `backend/.env`
(`ORS_API_KEY=...`) och läses in automatiskt – du behöver inte göra något.

Vill du byta nyckel: skaffa en ny gratis på
<https://openrouteservice.org/dev/#/signup> och ersätt värdet i `backend/.env`.
(Filen är gitignorerad så nyckeln checkas inte in.)

## 2. Starta backend (port 8001)

```powershell
cd backend
venv\Scripts\python.exe manage.py runserver 8001
```

Backend körs på <http://127.0.0.1:8001>. Django admin: <http://127.0.0.1:8001/admin/>

**Inloggning (superadmin):** `admin` / `cykel2026` (byt lösenord i admin!)

Superadmin skapar nya användare under **admin → Användare → Lägg till**.

## 3. Starta frontend (port 3001)

```powershell
cd frontend
npm run dev
```

Öppna <http://localhost:3001> och logga in.

## Använda appen

1. **Skapa cykelsemester** – titel, budget och datum. Dagar genereras automatiskt.
2. **Öppna en dag** – välj boende, lägg till etapper.
3. **Rita rutt** – klicka ut punkter (start, stopp, mål) på kartan, tryck
   *Beräkna rutt*. Systemet hämtar km + höjdmeter och räknar ut svårighetsgrad,
   snitthastighet och restid.
4. **Kostnader** – fyll i belopp per kategori. Dags- och totalsummor uppdateras.
5. **Budget** – projektvyn visar dagsbudget (kvarvarande budget ÷ kvarvarande dagar,
   omräknad löpande) och om du ligger över/under.

## Svårighetsskala

| Nivå | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|------|---|---|---|---|---|---|---|
| km/h | 20 | 18 | 16 | 14 | 12 | 10 | 8 |

Nivån sätts av stigning per km (se `DIFFICULTY_THRESHOLDS_M_PER_KM` i
`backend/planner/models.py` – trösklarna kan finjusteras).

## Tester

```powershell
cd backend
venv\Scripts\python.exe manage.py test planner      # enhets- + API-tester
venv\Scripts\python.exe smoke_test.py               # kräver körande server på 8001
```
