/**
 * The shape a resolved legal version has, in its own module.
 *
 * WHY SEPARATE. `legal-registry.ts` imports the generated table and the
 * generated table needs this type; putting it here keeps that from being a
 * circular import. It is a type and nothing else, so it costs nothing at
 * runtime.
 */
export type ResolvedLegalVersion = {
  slug: string;
  title: string;
  version: string;
  effectiveDate: string;
  contentHash: string;
};
