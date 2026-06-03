---
name: frontend
description: React/TypeScript frontend standards — component purity, server-state via query layer, no client privilege, immutable state updates. Use whenever code adds or edits a React component, hook, or any client-side data fetching/state. Covers the business-logic-out-of-components rule and the no-useEffect-for-derived-state rule.
---

# Frontend Standards (Coding Standards §11 · canonical: docs/Spec)

## Layering

- **Components render UI.** No business logic inlined.
- **Hooks** fetch and mutate via the query layer.
- **Domain logic** lives in `packages/shared` or `lib/` — imported, never inlined into components.

## Server state via query layer

Use TanStack Query (`useQuery` / `useMutation`) for all server/async state. No ad-hoc `fetch` inside components.

| Data | Tool |
|---|---|
| Server / API data | TanStack Query |
| Local UI state | `useState` |
| Complex local state | `useReducer` |

## No client-side privilege assumptions

UI may show/hide by role, but **the server always enforces**. Never gate access on client-held role state alone. (Ties to `auth-entitlements`.)

## Purity & state

- No side effects in the render body.
- **Never use `useEffect` to compute derived state** (§17 hard stop) — derive inline:

```tsx
// ✅ derived inline
const pct = Math.round((correct / total) * 100);

// ❌ useEffect for a derivable value
useEffect(() => setPct(Math.round((correct / total) * 100)), [correct, total]);
```

- **Never mutate state directly** — copy:

```ts
setAnswers(prev => [...prev, newAnswer]);   // ✅
answers.push(newAnswer); setAnswers(answers); // ❌
```

## Naming (§15)

Components `PascalCase` in `PascalCase.tsx`; hooks `camelCase.ts`; directories `kebab-case`.

## Self-check before done

- [ ] No business logic in the component body.
- [ ] All server state through TanStack Query; no raw `fetch` in components.
- [ ] No `useEffect` computing derived state.
- [ ] No direct state mutation.
- [ ] Access never gated on client role alone.

## Proving mechanism

The server enforces access regardless of UI; a denial test (in `auth-entitlements`) proves hiding a button doesn't equal protection. Lint catches direct mutation / effect-derived state where configured.
