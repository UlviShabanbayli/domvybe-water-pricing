# Water pricing — UI component

**[Live demo](https://domvybe.com/components/water-pricing/)** · [Step-by-step tutorial](https://domvybe.com/library/water-pricing/) · [Download the ZIP](https://github.com/UlviShabanbayli/domvybe-water-pricing/releases/latest/download/water-pricing-source.zip)

A team-size pricing slider made of water: drag the water in a tall glass, the price tag rides the meniscus, the surface sloshes and swirls, and more than 50 seats fills it to the brim.

Open `index.html` through any local static server (for example `python3 -m http.server`) and try it with a mouse,
a finger or the keyboard. Plain HTML, CSS and JavaScript; no build step, no libraries.

- `index.html` — the pricing page: the skip link, the header, the copy (eyebrow, headline, lead, the total with the per-seat price and the volume badge, the features, Start trial, Talk to sales and Change seats, the status line), the stage with its canvas, the CSS glass, the etched numbers, the role=slider over the glass, the price tag, the hover label, the hint and the admin note, the caption, and a pre-paint script (old keys, ?nofx)
- `css` — water.css: the two-column desk layout, the button and tag states, the CSS glass without WebGL 2, the stacked tablet and phone layout, the phone on its side, reduced motion
- `js` — app.js (the pricing tiers, the slider: drag, touch and keys, the water on a heavy spring, slosh and swirl, the trial button, the scheduler that redraws only what changed, then sleeps), vessel.js (the camera and the shader that traces every pixel through glass, water and floor), gl.js (the WebGL 2 helper)

Tidal and its prices are made up (1 to 9 seats $14, 10 to 24 $12, 25 to 50 $10 a seat, more than 50 Talk to sales),
and the page sends nothing: the trial button simulates a request, so put your own in `js/app.js`, where the tiers are
data. Everything is made in code: the glass, the water, the silver meniscus, the shadow and the caustic are one WebGL 2
shader that traces each pixel analytically through glass, water and floor (refraction, Fresnel, Beer-Lambert), and
every word, the price tag and the slider are HTML; no AI pictures. The glass is a real `role=slider` (drag, touch,
arrow keys, PageUp, PageDown, Home, End). Only the seat count is kept in `localStorage` (`dv75.seats`). Nothing is drawn
at rest: while the water moves only the band it swept is redrawn, then the changed areas are refined once and the loop
sleeps. Without WebGL 2 (or with `?nofx`, or when the context is lost) the glass is CSS; `?disabled` shows the
admin-managed state and `?seats=N` opens on a team size. The page reads Google Fonts (Instrument Serif, Manrope).

It respects `prefers-reduced-motion`. Made by Ulvi (Code with Ulvi) · domvybe.com

## Licence

MIT — see [LICENSE](LICENSE). Use it in your own projects, commercial ones included.
