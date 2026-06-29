# Pineback – Deployment, staging & domän

En praktisk guide för att driftsätta Pineback, sätta upp en staging-miljö och
peka domänen **pineback.com** rätt. Allt bygger på git-push: du ändrar något på
din dator, pushar, och rätt miljö uppdateras automatiskt.

---

## 1. Arkitektur

Pineback består av två delar:

| Del | Teknik | Hostas på (rekommenderat) |
|-----|--------|---------------------------|
| **Frontend** | Next.js | **Vercel** |
| **Backend** | Django + DRF | **Render** |
| **Databas** | PostgreSQL | **Render** (managed) |

**Hur de pratar:** webbläsaren laddar frontenden (pineback.com). Frontendens
Next.js proxar allt under `/api` och `/admin` vidare till backenden (server-side,
via `BACKEND_ORIGIN`). Det gör att webbläsaren bara ser **en domän** → inga
CORS- eller cookie-problem (precis som med tunneln vi använde).

```
  Webbläsare ──https──>  Vercel (Next.js, pineback.com)
                              │  /api/*  (proxas server-side)
                              ▼
                         Render (Django) ──> PostgreSQL
```

> Varför inte SQLite i produktion? PaaS-servrar har ett *tillfälligt* filsystem
> som nollställs vid varje deploy. Därför använder vi PostgreSQL i molnet.
> Lokalt fortsätter du köra SQLite – ingen ändring behövs där.

### Två miljöer

| Miljö | Gren (branch) | Frontend | Backend | Databas |
|-------|---------------|----------|---------|---------|
| **Produktion** | `main` | pineback.com | pineback-api | pineback-db |
| **Staging** | `staging` | staging.pineback.com | pineback-api-staging | pineback-db-staging |

Du jobbar lokalt → pushar till `staging` → testar på staging.pineback.com →
när allt funkar mergar du till `main` → produktion uppdateras.

---

## 2. Förberedelse: Git + GitHub (engångs)

Allt deploy bygger på att koden ligger på GitHub.

```powershell
cd "C:\Users\JohanWikström\OneDrive - Stiftelsen Dalarna Science Park\Skrivbordet\AI Docs\Cykelplanering"
git init
git add .
git commit -m "Pineback – första commit"
git branch -M main
git branch staging        # skapa staging-grenen
```

1. Skapa ett **privat** repo på GitHub (github.com → New repository → "pineback").
2. Koppla och pusha:

```powershell
git remote add origin https://github.com/<ditt-användarnamn>/pineback.git
git push -u origin main
git push -u origin staging
```

> `.gitignore` är redan satt så att `venv/`, `node_modules/`, `.next/`,
> `db.sqlite3` och `.env` **inte** checkas in. Hemligheter (ORS-nyckeln) ligger
> kvar lokalt och sätts som miljövariabler i molnet (se nedan) – aldrig i koden.

---

## 3. Backend på Render (produktion)

1. Gå till **render.com** → logga in med GitHub → **New +**.
2. **Skapa databasen först:** New → **PostgreSQL**.
   - Name: `pineback-db`. Region: Frankfurt. Plan: Free (eller Starter).
   - När den är klar, kopiera **Internal Database URL**.
3. New → **Web Service** → välj ditt `pineback`-repo.
   - **Name:** `pineback-api`
   - **Branch:** `main`
   - **Root Directory:** `backend`
   - **Runtime:** Python 3
   - **Build Command:**
     ```
     pip install -r requirements.txt && python manage.py collectstatic --noinput && python manage.py migrate
     ```
   - **Start Command:**
     ```
     gunicorn config.wsgi
     ```
   - **Environment Variables** (Add):
     | Nyckel | Värde |
     |--------|-------|
     | `DJANGO_SECRET_KEY` | en lång slumpsträng (generera, se nedan) |
     | `DJANGO_DEBUG` | `0` |
     | `DJANGO_ALLOWED_HOSTS` | `pineback-api.onrender.com` |
     | `DJANGO_TRUSTED_ORIGINS` | `https://pineback.com,https://www.pineback.com` |
     | `DATABASE_URL` | (klistra in Internal Database URL) |
     | `ORS_API_KEY` | din OpenRouteService-nyckel |
     | `PYTHON_VERSION` | `3.13.13` |
4. Deploy. När det är klart: öppna en **Shell** (Render → Service → Shell) och
   skapa ditt admin-konto:
   ```
   python manage.py createsuperuser
   ```

Generera en secret key lokalt:
```powershell
backend\venv\Scripts\python.exe -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

Backend-URL blir t.ex. `https://pineback-api.onrender.com`. Testa
`https://pineback-api.onrender.com/api/auth/csrf/` → ska ge `200`.

---

## 4. Frontend på Vercel (produktion)

1. Gå till **vercel.com** → logga in med GitHub → **Add New → Project** → välj
   `pineback`-repot.
2. Inställningar:
   - **Root Directory:** `frontend`
   - Framework: Next.js (upptäcks automatiskt)
   - **Environment Variables:**
     | Nyckel | Värde |
     |--------|-------|
     | `BACKEND_ORIGIN` | `https://pineback-api.onrender.com` |
     | `NEXT_PUBLIC_API_URL` | `/api` |
     | `NEXT_PUBLIC_ADMIN_URL` | `/admin/` |
3. Deploy. Du får en URL som `https://pineback.vercel.app` – testa att logga in.

> `BACKEND_ORIGIN` är det som gör att Next proxar `/api` → din Render-backend.
> Tack vare det behöver du **inte** öppna backend mot publika domänen separat.

---

## 5. Domänpekning på GoDaddy

Du pekar **pineback.com** mot Vercel (frontenden). Backend nås via proxyn, så
den behöver ingen egen DNS.

1. I **Vercel**: Project → **Settings → Domains** → lägg till `pineback.com`
   och `www.pineback.com`. Vercel visar exakt vilka DNS-poster som krävs.
   Typiskt:
   | Typ | Namn | Värde |
   |-----|------|-------|
   | `A` | `@` | `76.76.21.21` |
   | `CNAME` | `www` | `cname.vercel-dns.com` |
2. I **GoDaddy**: Mina produkter → pineback.com → **DNS** → Manage DNS.
   - Lägg till/ändra posterna **exakt som Vercel angav** (ta bort GoDaddys
     default-"parking"-poster för `@` och `www` om de krockar).
3. Vänta på DNS (oftast minuter, ibland upp till några timmar). Vercel ordnar
   HTTPS-certifikat automatiskt när posterna stämmer.

> Tips: om Vercel föreslår en annan A-IP eller "nameserver-metod", följ alltid
> det Vercel visar i din dashboard – de uppdaterar ibland adresserna.

---

## 6. Staging-miljön

Mål: en exakt kopia på `staging.pineback.com` där du testar innan produktion.

### Backend (Render)
Skapa **en till** Web Service + databas, men från `staging`-grenen:
- Web Service `pineback-api-staging`, **Branch: `staging`**, Root `backend`,
  samma build/start-kommandon.
- Egen databas `pineback-db-staging` (så testdata inte rör produktionen).
- Env vars som produktionen, men:
  - `DJANGO_ALLOWED_HOSTS` = `pineback-api-staging.onrender.com`
  - `DJANGO_TRUSTED_ORIGINS` = `https://staging.pineback.com`
  - `DATABASE_URL` = staging-databasens URL

### Frontend (Vercel)
Enklast och renast: skapa **ett andra Vercel-projekt** från samma repo men med
**Production Branch = `staging`**:
- Env: `BACKEND_ORIGIN` = `https://pineback-api-staging.onrender.com`
- Lägg till domänen `staging.pineback.com` på det projektet.
- I GoDaddy: `CNAME` `staging` → `cname.vercel-dns.com`.

> Alternativ (gratis och noll-konfig): Vercel skapar automatiskt en **Preview
> Deployment** med egen URL för *varje* push/PR. Det räcker långt som
> "staging light" om du inte vill ha en egen subdomän. Den fasta
> `staging.pineback.com` är dock trevligare att återkomma till.

---

## 7. Ditt uppdateringsflöde (vardagen)

När du hittar en bugg eller vill lägga till något:

```powershell
# 1. Jobba lokalt (backend 8001, frontend 3001 som vanligt) och testa.
# 2. Commit:
git add .
git commit -m "Fixar X"

# 3. Pusha till staging -> deployas automatiskt till staging.pineback.com
git checkout staging
git merge main          # eller jobba direkt i staging
git push

# 4. Testa på staging.pineback.com.

# 5. När det är bra -> till produktion:
git checkout main
git merge staging
git push                # deployas automatiskt till pineback.com
```

Både Render och Vercel märker pushen och bygger om automatiskt. Inga manuella
uppladdningar.

> **Databasändringar:** om du lagt till/ändrat en modell, skapa migrationen
> lokalt (`python manage.py makemigrations`), committa den, och pusha.
> Render kör `migrate` automatiskt i sitt build-kommando.

---

## 8. Checklista innan första produktionssläpp

- [ ] Repo på GitHub, grenarna `main` + `staging` pushade.
- [ ] Render: backend-service + Postgres uppe, env vars satta, `migrate` kört.
- [ ] Render Shell: `createsuperuser` körd.
- [ ] Vercel: frontend uppe med `BACKEND_ORIGIN` + `NEXT_PUBLIC_API_URL=/api`.
- [ ] `pineback.com` + `www` pekar mot Vercel, HTTPS grönt.
- [ ] Testa: logga in, skapa resa, beräkna rutt (kräver `ORS_API_KEY`), navigera.

## 9. Felsökning

| Symptom | Trolig orsak / lösning |
|---------|------------------------|
| 400/403 vid inloggning i molnet | `DJANGO_TRUSTED_ORIGINS` saknar din domän, eller `BACKEND_ORIGIN` fel på Vercel. |
| 500 + "DisallowedHost" | Lägg domänen/onrender-värdet i `DJANGO_ALLOWED_HOSTS`. |
| Admin saknar styling | `collectstatic` kördes inte – ingår i build-kommandot ovan. |
| Ruttberäkning ger fel | `ORS_API_KEY` saknas i Render-env. |
| Sidan laddar oändligt | Kör frontenden i **produktionsläge** (Vercel gör det automatiskt). |
| Render free "somnar" | Free-tjänster sover efter inaktivitet; första anropet tar ~30 s. Uppgradera till Starter för alltid-på. |

---

## 10. Kostnad (ungefär)

- **Vercel Hobby:** gratis (personligt bruk).
- **Render Free:** gratis men "sover" + begränsad Postgres. För en alltid-på,
  pålitlig produktion: Render Starter ~7 USD/mån per tjänst + ~7 USD/mån för
  Postgres.
- **Domänen** äger du redan.

Vill du ha billigast möjligt och alltid-på kan allt också köras på **en liten
VPS** (Hetzner ~4 €/mån) med nginx + Docker – säg till så skriver jag den
varianten i stället.
