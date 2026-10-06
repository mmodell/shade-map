# ☀︎ Shade Map

Plan a walk, get 2–4 walking routes ranked by **shade**, **directness** and **safety**
for the time you're actually leaving — then open it on your phone from anywhere.

- **Frontend:** Vite + React, Google Maps JS (map, walking directions, places autocomplete)
- **Backend:** one Vercel serverless function (`/api/route`) that pulls tree/park/footpath
  data from OpenStreetMap, estimates shade from sun angle, and builds a weather timeline
- **Install:** it's a PWA — "Add to Home Screen" and it behaves like an app
- **Cost:** $0 (Google Maps free tier + OpenWeather free tier + Vercel Hobby)

> **Also in this repo:** [`umbra/`](umbra/README.md) — a keyless, build-free 3D sandbox of the same idea: a procedural city lit by the real sun with ray-traced shadows and a shade-seeking router.

---

## 1. Prerequisites

- [Node.js 18+](https://nodejs.org/) (`node --version`)
- A [GitHub](https://github.com) account and [git](https://git-scm.com/) (easiest deploy path)
- A [Vercel](https://vercel.com) account (sign in with GitHub)

## 2. Get API keys

### Google Maps  → `VITE_GOOGLE_MAPS_API_KEY`
1. https://console.cloud.google.com/ → create a project (e.g. "Shade Map")
2. **APIs & Services → Enable APIs** — enable all four:
   *Maps JavaScript API*, *Directions API*, *Places API*, *Elevation API*
3. **Credentials → Create credentials → API key**
4. Edit the key → **Application restrictions → HTTP referrers**, add:
   - `http://localhost:5173/*`
   - `https://YOUR-APP.vercel.app/*` (fill in after step 4)
5. **API restrictions →** restrict to the four APIs above.

> The Maps JS key is visible in the browser bundle — that's expected. The referrer
> restriction is what stops anyone else from using it.

### OpenWeather  → `OPENWEATHER_API_KEY` (optional but nice)
1. https://openweathermap.org/api → sign up (free)
2. Copy the default key from **My API keys**. New keys take ~1–2 hours to activate.
3. If you skip this, routes still rank fine — you just don't get the weather strip.

## 3. Run it locally

```bash
npm install
cp .env.local.example .env.local   # then paste your keys into .env.local
```

Two ways to run:

| Command | What you get | When |
|---|---|---|
| `npm run dev` | UI + map + routes, shade estimated from **sun angle only** | quick styling / UI work |
| `npm run dev:full` | everything, including the real `/api/route` analyzer | testing shade + weather |

`npm run dev:full` needs the Vercel CLI once: `npm i -g vercel && vercel link`.
It reads the same `.env.local`.

Open http://localhost:5173.

## 4. Deploy to Vercel (access from anywhere)

**Option A — GitHub (recommended, auto-deploys on every push):**

```bash
git init && git add -A && git commit -m "Shade Map"
git branch -M main
# create an empty repo on github.com, then:
git remote add origin https://github.com/YOU/shade-map.git
git push -u origin main
```

1. https://vercel.com/new → import the repo → Framework preset **Vite** (auto-detected) → Deploy.
2. Project → **Settings → Environment Variables**, add for **Production** + **Preview**:
   - `VITE_GOOGLE_MAPS_API_KEY` = your Maps key
   - `OPENWEATHER_API_KEY` = your OpenWeather key
   - `WEATHER_UNITS` = `imperial` (or `metric`)
3. **Deployments → ⋯ → Redeploy** so the env vars take effect.
4. Copy your `https://YOUR-APP.vercel.app` URL and add it to the Google key's
   referrer list (step 2.4).

**Option B — CLI:** `vercel` then `vercel --prod`, and add the env vars with
`vercel env add ...` or in the dashboard.

## 5. Put it on your phone

1. Open `https://YOUR-APP.vercel.app` in the phone browser.
2. **iPhone (Safari):** Share → *Add to Home Screen.*
   **Android (Chrome):** ⋮ → *Add to Home screen / Install app.*
3. Launch it from the icon — full screen, no address bar. Works on cellular,
   any network, PC off.

Grant location permission when prompted so the ◎ button can fill in "From".

---

## How the shade score works

For each route the analyzer samples the path every ~40 m and decides, point by point,
whether you'd be standing in shade:

- **Canopy shade** — the point is inside an OSM park / wood / garden / tree row / hedge,
  or within a few metres of a mapped tree.
- **Building shadows, ray-cast from real footprints** — from each point a ray is traced
  toward the sun. If it enters a building's outline at distance *s* and the building is
  taller than *s · tan(sun altitude)*, you're in its shadow. A long slab shades the whole
  frontage behind it; a narrow tower shades a thin stripe; the side of the street flips as
  the sun moves. Heights come from OSM `height` / `building:levels` (default ≈ 12 m).
  Buildings with only a centre point fall back to a directional cone.
- **Time-aware** — each point is evaluated with the sun where it will be when you *reach*
  it (route duration × distance along the route), so a long walk that crosses sunset or
  slides out of a shadow is scored honestly.
- After dark `shadeFraction = 1` and the score leans on **lighting** and **safety**.

`shadeFraction` is the share of sample points in shade. Clouds explain the number (a note
and a lower UV index) but never fudge it.

### "When should I leave?" chart

The same prepared geometry is re-evaluated for every departure time from sunrise to sunset
in 30-minute steps (`shade.byDeparture`, ~0.2 s for four routes in a dense city). The chart
in the results panel plots each route's shade share across the day, marks the shadiest
time, and tapping it re-analyzes the *same routes* for that departure — no new Directions
search. Wherever the lines cross is a moment the best route changes.

**Safety** blends how much of the route is sidewalk / dedicated footpath vs. exposed
alongside a big road, plus lighting at night.

The three sliders re-rank instantly without re-querying. It's still a model — OSM
footprints are missing or mis-heighted in places, trees are circles, and nothing here
knows about awnings — so treat it as good for *comparing* routes, not for claiming an
exact percentage.

## Project layout

```
Shade Map/
├─ api/
│  ├─ route.js                 # POST /api/route — the analyzer
│  └─ _lib/                    # (underscore = not a route)
│     ├─ overpass.js           # OpenStreetMap (Overpass) query + parse
│     ├─ shadeCalculator.js    # footprint shadow ray-casting, time-aware, per-departure curve
│     ├─ lightingService.js    # lit=yes coverage
│     ├─ safetyService.js      # sidewalk vs. big-road, night lighting
│     ├─ weatherService.js     # OpenWeather current + 3h/5d forecast
│     ├─ wayMatch.js           # snap route points to nearest footpath
│     └─ geo.js                # haversine, point-in-polygon, etc.
├─ src/
│  ├─ App.jsx / App.css
│  ├─ components/
│  │  ├─ RouteForm.jsx         # from / to / time / sliders
│  │  ├─ MapComponent.jsx      # Google map + route polylines
│  │  ├─ RouteList.jsx         # ranked cards
│  │  ├─ ShadeFlipChart.jsx    # shade vs. departure time; tap to leave then
│  │  └─ WeatherTimeline.jsx   # weather strip over the walk window
│  └─ lib/
│     ├─ googleDirections.js   # DirectionsService + path sampling
│     ├─ analyze.js            # calls /api/route, degrades gracefully
│     ├─ ranking.js            # slider weights → composite score
│     ├─ shadeCurve.js         # best-departure / spread helpers for the chart
│     ├─ localShadeEstimate.js # offline fallback (sun angle only)
│     └─ format.js
├─ public/  (icon.svg, manifest.webmanifest, sw.js)
├─ vercel.json · vite.config.js · .env.local.example
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Add your Google Maps API key" screen | `VITE_GOOGLE_MAPS_API_KEY` missing — set in `.env.local` locally, or in Vercel env vars + redeploy |
| Map is grey / `RefererNotAllowedMapError` in console | add your exact origin (`http://localhost:5173/*`, `https://...vercel.app/*`) to the key's HTTP-referrer list |
| Routes load but every card says "sun-angle-only estimate" | `/api/route` isn't running — use `npm run dev:full` locally, or check the function logs in Vercel |
| No weather strip | `OPENWEATHER_API_KEY` unset, or key still activating (wait ~1 h) |
| Overpass timeouts | free OSM servers are busy; it retries 3 mirrors, then falls back to sun-angle-only for that route |
| PWA won't install on iPhone | must be HTTPS (Vercel URL, not the LAN IP) and opened in Safari |
```
