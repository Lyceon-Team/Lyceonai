/**
 * Minimal ambient declaration for the `pg` module, for scripts under
 * scripts/ci/ only.
 *
 * WHY THIS EXISTS. `pg` ships no types and `@types/pg` is not a dependency of
 * this repo; adding one needs approval (CLAUDE.md, "no dependency changes
 * without approval"). Without a declaration, `import pgModule from 'pg'` is
 * implicitly `any`, and `any` is a hard stop (Coding Standards §3.2, §17).
 *
 * SCOPE. scripts/** is outside tsconfig.json's `include`, so this declaration
 * is picked up only when a scripts/ci file is typechecked directly. It states
 * the narrow surface those gates use and nothing more, so it cannot drift into
 * a hand-maintained copy of @types/pg. If @types/pg is ever added as a real
 * dependency, delete this file — the real types supersede it.
 */
declare module 'pg' {
  export type PgQueryResult<R> = { rows: R[]; rowCount: number | null };

  export class Client {
    constructor(config: {
      host?: string;
      port?: number;
      user?: string;
      password?: string;
      database?: string;
      connectionString?: string;
    });
    connect(): Promise<void>;
    end(): Promise<void>;
    query<R>(text: string, values?: readonly unknown[]): Promise<PgQueryResult<R>>;
  }

  const pg: { Client: typeof Client };
  export default pg;
}
