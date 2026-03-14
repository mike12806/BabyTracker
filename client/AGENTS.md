# Client — React + Vite + Material UI

## Stack

- React 18+ with TypeScript
- Vite for bundling and dev server
- Material UI (MUI) for all UI components
- Deployed to Cloudflare Pages

## Structure

- `src/components/` — Reusable UI components
- `src/pages/` — Top-level route pages
- `src/api/` — API client functions (fetch wrappers)
- `src/hooks/` — Custom React hooks
- `src/types/` — Shared TypeScript types
- `src/theme/` — MUI theme customization

## Conventions

- Use MUI components exclusively — do not mix in raw HTML elements for UI controls, inputs, or layout
- Use MUI's `sx` prop for one-off styling; use `styled()` or theme overrides for reusable styles
- Use React Router for client-side routing
- API calls go through a centralized client in `src/api/` — never call `fetch` directly from components
- Use ISO 8601 strings for all date/time values; format for display at the component level
- Prefer controlled components for forms
- Use `useQuery`/`useMutation` patterns (e.g., TanStack Query) for server state management

## Auth

- Cloudflare Access handles login — no login page or auth UI needed
- The API client should include credentials with every request (`credentials: 'include'` or forward cookies)
- If a 401 is returned, redirect to the Access login URL

## Component Patterns

- Each page component corresponds to a route and composes smaller components
- Form components for each entity (FeedingForm, DiaperForm, SleepForm, etc.)
- Dashboard should show recent activity across all tracked entities
- Timer components for in-progress events (feedings, sleep, tummy time)
