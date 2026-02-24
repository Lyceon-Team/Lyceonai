# Sprint 11 — Role Invariant Proof (No Dual Roles)

**Sprint:** 11 (Security — Role Invariant Proof)  
**Source of truth:** 🔒 LOCKED PARALLEL SPRINT MATRIX :contentReference[oaicite:0]{index=0}  
**Invariant:** A user has exactly **one** active role at a time (no dual roles). :contentReference[oaicite:1]{index=1} :contentReference[oaicite:2]{index=2}

---

## Grounding (Local Proofs)

**Repo root (PowerShell `pwd`):**
- `C:\Users\14438\projects\lyceonai`

**Git state (PowerShell):**
- Branch: `sprint-8`
- Clean working tree: `git status --porcelain` → *(empty output)*
- Commit SHA: `9427ac5e9b8d497f14764032c9fcaffdd6dcdc97`

**Toolchain (PowerShell):**
- Node: `v22.19.0`
- pnpm: `10.28.1`

> Note: Local branch `sprint-11` does not exist (`git checkout sprint-11` fails).  
> Sprint 11 proof is based on repository migration evidence + live Supabase DB constraint evidence, which is the sprint’s accepted proof mechanism.

---

## Definition of Done (Sprint 11)

Per matrix, Sprint 11 is complete when: :contentReference[oaicite:3]{index=3}
- ✅ DB-level constraint **OR** invariant test exists
- ✅ Attempted violation fails (either via DB constraint enforcement or test)
- ✅ Build + tests green *(not attributable to Sprint 11; tracked elsewhere)*

Sprint 11 is satisfied via **DB-level constraint proof**.

---

## Proof A — Repo Migration Enforces Role Constraint (File:Line Evidence)

**File:** `supabase/migrations/20260102_guardian_link_code.sql`  
**Evidence excerpt (PowerShell line-number print, lines 115–135):**

```text
 115: DO $$
 116: DECLARE
 117:   role_udt_name TEXT;
 118: BEGIN
 119:   SELECT udt_name INTO role_udt_name
 120:   FROM information_schema.columns
 121:   WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role';
 122:
 123:   IF role_udt_name = 'text' THEN
 124:     EXECUTE 'ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check';
 125:     EXECUTE 'ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role = ANY (ARRAY[''student''::text, ''admin''::text, ''guardian''::text]))';
 126:     RAISE NOTICE 'Updated TEXT role CHECK constraint to include guardian';
 127:   ELSE
 128:     BEGIN
 129:       EXECUTE format('ALTER TYPE public.%I ADD VALUE IF NOT EXISTS ''guardian''', role_udt_name);
 130:       RAISE NOTICE 'Added guardian to enum type %', role_udt_name;
 131:     EXCEPTION WHEN OTHERS THEN
 132:       RAISE NOTICE 'Could not add guardian to enum (may already exist): %', SQLERRM;
 133:     END;
 134:   END IF;
 135: END $$;
