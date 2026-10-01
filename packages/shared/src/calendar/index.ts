/**
 * The calendar shared layer — schemas, inferred types, the §13 allocator and the derived
 * read model. No database access, no fetch, no streak computation.
 *
 * @spec [Doc_05F §6, §10.2, §13, §14, §15] | @implemented [2026-09-17]
 */
export * from "./time.js";
export * from "./scope.js";
export * from "./plan.js";
export * from "./profile.js";
export * from "./allocate.js";
export * from "./read-model.js";
export * from "./api.js";
