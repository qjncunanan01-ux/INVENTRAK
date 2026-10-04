// Vitest setup: jest-dom matchers (toBeInTheDocument, ...). The /vitest entry
// wires them into Vitest's expect instead of Jest's global expect.
import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// testing-library's async helpers (waitFor, findBy*) give up after 1000ms by
// default, and that default is NOT derived from vitest's `testTimeout` — which
// this repo already raises to 20s because whole admin pages render slowly in
// jsdom (see vite.config.js). Without this, a test can have 20s to run and
// still lose its assertion at 1s while the worker pool is busy, which showed up
// as DashboardPage's pending-count check failing under full-suite load and
// passing in isolation.
//
// This only widens the wait budget; it relaxes no assertion, and a genuinely
// broken test still fails once the element stops appearing.
configure({ asyncUtilTimeout: 20000 });