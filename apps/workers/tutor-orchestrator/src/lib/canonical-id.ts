/**
 * Canonical SAT question ID pattern — single source of truth.
 * @spec [Doc-02A_V6, §16] | genesis questions.id CHECK constraint
 *
 * Browser-safe: this module has no Node.js dependencies so it can be
 * imported by both server-side code and Vite-bundled client code.
 * question-bank-contract.ts re-exports this; use whichever import path
 * suits the build context.
 */
export const CANONICAL_ID_PATTERN = /^SAT(?:M|RW)[12][A-Z0-9]{6}$/;
