import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// CI runs on resource-constrained runner pods where vitest's per-test timeout
// is 25 s. Raise Testing Library's default asyncUtilTimeout from 1 s to 10 s so
// `waitFor` and `findBy*` queries don't time out during heavy CPU load or chunk loading.
configure({ asyncUtilTimeout: 10_000 });
