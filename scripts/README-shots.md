# Calendar screenshot harness

Renders the real `CalendarView` with the approved prototype's own plan data, so a screenshot
of the shipped component and a screenshot of `docs/design/calendar-prototype.html` are
comparing like with like. The prototype is itself fixture-driven — that is what makes the
comparison fair rather than a picture of a mock.

```bash
pnpm exec vite build --config vite.shots.config.ts   # builds client/shots -> dist/shots
node scripts/shots.mjs                               # every scene, to /tmp
node scripts/shots-proto.mjs                         # the prototype, for side-by-side
```

Scenes: `week`, `month`, `setup`, `guardian`, `loading`, `premium`, `error`,
`guardian-not-set-up`, plus a sheet-open and a 430px mobile variant.

It mounts the component **outside `App.tsx`**, so it does not receive the global token
stylesheet. That is deliberate: it is how the missing `var(--calendar-*, …)` fallbacks in
`calendar.css` were caught, and how the guardian surface was found labelling every block
"Full sitting".
