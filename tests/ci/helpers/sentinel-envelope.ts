/**
 * @spec [owner brief G2-1 "authority boundary", Karl 2026-11-02] | @implemented [2026-11-02]
 *
 * plain English: builds an orchestrate envelope straight from the wire schema with a unique
 * sentinel token in EVERY free-text field, so a test can find each one in the rendered system
 * instruction and check it sits inside a data block. Walking the schema (not a hand-written
 * fixture) is the point: a text field added to the wire later gets a sentinel automatically,
 * so a new data source that renders without the helper fails the boundary test the day it
 * lands. Enums, literals, numbers and booleans carry no words and get plain values.
 *
 * Two variants flip every boolean and pick the first or last enum value, so both item types,
 * pre- and post-submit and every optional branch the renderer has are reached.
 */
import { z } from "zod";
import { orchestrateRequestSchema } from "../../../shared/tutor-orchestrator-wire";
import type { OrchestrateRequest } from "../../../shared/tutor-orchestrator-wire";

export type SentinelVariant = "a" | "b";

export type SentinelEnvelope = {
  request: OrchestrateRequest;
  /** sentinel token → the schema path of the field it was put in. */
  sentinels: Map<string, string>;
};

const SENTINEL_PREFIX = "SNTL";

/** A regex-checked string with no generic valid value: the nullable parent becomes null. */
const FORMAT_ONLY = Symbol("format-only");

export function isSentinel(token: string): boolean {
  return token.startsWith(SENTINEL_PREFIX);
}

/** Every sentinel token in a rendered string, in order. */
export function sentinelsIn(text: string): string[] {
  return text.match(/SNTL\d+X/g) ?? [];
}

export function buildSentinelEnvelope(
  variant: SentinelVariant,
  promptVersion: string,
): SentinelEnvelope {
  const sentinels = new Map<string, string>();
  let n = 0;
  const text = (path: string): string => {
    n += 1;
    const token = `${SENTINEL_PREFIX}${n}X`;
    sentinels.set(token, path);
    return token;
  };

  const walk = (schema: z.ZodTypeAny, path: string): unknown => {
    const def = schema._def as { typeName: z.ZodFirstPartyTypeKind };
    switch (def.typeName) {
      case z.ZodFirstPartyTypeKind.ZodString: {
        // A format-checked string (uuid, canonical-id regex) cannot carry words; give it a
        // valid value instead of a sentinel.
        const checks = (schema as z.ZodString)._def.checks;
        if (checks.some((c) => c.kind === "uuid")) {
          n += 1;
          return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
        }
        if (checks.some((c) => c.kind === "regex")) return FORMAT_ONLY;
        return text(path);
      }
      case z.ZodFirstPartyTypeKind.ZodNumber: {
        const isInt = (schema as z.ZodNumber).isInt;
        return variant === "a" ? 2 : isInt ? 1 : 0.5;
      }
      case z.ZodFirstPartyTypeKind.ZodBoolean:
        return variant === "a";
      case z.ZodFirstPartyTypeKind.ZodLiteral:
        return (schema as z.ZodLiteral<unknown>).value;
      case z.ZodFirstPartyTypeKind.ZodEnum: {
        const options = (schema as z.ZodEnum<[string, ...string[]]>).options;
        return variant === "a" ? options[0] : options[options.length - 1];
      }
      case z.ZodFirstPartyTypeKind.ZodNullable:
      case z.ZodFirstPartyTypeKind.ZodOptional: {
        const inner = walk(
          (schema as z.ZodNullable<z.ZodTypeAny>).unwrap(),
          path,
        );
        return inner === FORMAT_ONLY ? null : inner;
      }
      case z.ZodFirstPartyTypeKind.ZodDefault:
        return walk(
          (schema as z.ZodDefault<z.ZodTypeAny>).removeDefault(),
          path,
        );
      case z.ZodFirstPartyTypeKind.ZodEffects:
        return walk((schema as z.ZodEffects<z.ZodTypeAny>).innerType(), path);
      case z.ZodFirstPartyTypeKind.ZodArray:
        return [
          walk((schema as z.ZodArray<z.ZodTypeAny>).element, `${path}[0]`),
          walk((schema as z.ZodArray<z.ZodTypeAny>).element, `${path}[1]`),
        ];
      case z.ZodFirstPartyTypeKind.ZodUnion:
      case z.ZodFirstPartyTypeKind.ZodDiscriminatedUnion: {
        const options = (
          schema as z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]>
        ).options;
        const pick = variant === "a" ? options[0] : options[options.length - 1];
        if (pick === undefined) throw new Error(`empty union at ${path}`);
        return walk(pick, path);
      }
      case z.ZodFirstPartyTypeKind.ZodObject: {
        const obj = schema as z.AnyZodObject;
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj.shape)) {
          out[key] = walk(value as z.ZodTypeAny, `${path}.${key}`);
        }
        // An open object (memory content_json) carries whatever a writer put there: give it
        // the free-text keys a renderer could read.
        if (obj._def.unknownKeys === "passthrough") {
          out["text"] = text(`${path}.text`);
          out["summary"] = text(`${path}.summary`);
        }
        return out;
      }
      case z.ZodFirstPartyTypeKind.ZodRecord:
        return { [text(`${path}{key}`)]: text(`${path}{value}`) };
      case z.ZodFirstPartyTypeKind.ZodUnknown:
      case z.ZodFirstPartyTypeKind.ZodAny:
        return text(path);
      default:
        throw new Error(
          `sentinel-envelope: no rule for ${String(def.typeName)} at ${path}; add one`,
        );
    }
  };

  const raw = walk(orchestrateRequestSchema, "$") as Record<string, unknown>;
  // The two fields that select the prompt artifact stay real values, or the registry falls
  // back to another artifact; correct_answer is null pre-submit, as the BFF guarantees.
  const policy = raw["policy_assignment"] as Record<string, unknown>;
  policy["policy_variant"] = "default";
  policy["prompt_version"] = promptVersion;
  if (raw["is_post_submit"] === false) raw["correct_answer"] = null;
  return { request: orchestrateRequestSchema.parse(raw), sentinels };
}
