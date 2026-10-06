# ◐ Umbra — walk the shade

A tiny city you can fly around, lit by the **real sun**, where every shadow is ray-traced
per pixel on your GPU — and a router that finds the walk with the least sun, *using the
shadows that will exist by the time you actually get there*.

No API keys. No build step. No dependencies. Everything (city, sun, shadows, routing) is
generated in the browser.

```bash
cd umbra
python3 -m http.server 8123      # any static server works (ES modules need http://, not file://)
# open http://localhost:8123
```

## What you're looking at

| | |
|---|---|
| **Sun** | Real solar geometry for any latitude and day of year (solar time). Pick Phoenix, Reykjavík or Singapore and watch the day length and shadow angles change. At night the moon takes over the lighting. |
| **Shadows** | The whole city is a heightfield. A fragment shader marches a grid-DDA ray from every pixel, then a second one toward the sun. Penumbrae are soft; canopy casts shade too. |
| **Router** | Time-dependent Dijkstra. A metre in sun costs `1 + shade-seeking × sunStrength`, evaluated against the shadow map for the minute you *arrive* at each cell. Orange = shortest, cyan = coolest. |
| **Shade-flip chart** | Above the timeline: for every departure time of the day, the % of each route spent in direct sun. It shows the exact moments when taking the detour matters (and when it doesn't). |
| **Thermal** (`T`) | Sunlit pavement glows, shade goes cold. |

Controls: drag = orbit · scroll/pinch = zoom · shift-drag = pan · tap the city = place A / B ·
`space` = play the day · `←/→` = nudge 15 min. URL params: `?lat=&day=&t=&seek=&seed=&thermal=1`.

## Layout

```
src/sun.js      solar position, day length
src/city.js     procedural city (streets, blocks, parks, river + bridges) → heightfield
src/shade.js    CPU shadow caster (same algorithm as the GPU one)
src/route.js    time-aware shade-seeking Dijkstra + path evaluation
src/shader.js   WebGL2 ray-marching shader
src/main.js     camera, UI, live re-routing, chart
```

Logic is unit-tested: `npm test` from the repo root.

## Where this could go

It's the idea behind `shade-map` stripped to its physics. Swap `generateCity()` for real
building footprints + heights from OSM and you have true shadow-aware routing for a real
neighbourhood.
