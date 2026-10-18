import { tokens, FIXTURES } from "./notation-tokens.js";

/**
 * Fixture validation for notation-token extractor.
 * Every token must pass all its positive AND negative cases.
 * A token that can't pass its negative fixtures doesn't ship.
 */

let failures = 0;

for (const fixture of FIXTURES) {
  // Positive: token MUST be detected
  for (const input of fixture.positive) {
    const result = tokens(input);
    if (!result.has(fixture.token)) {
      console.error(
        `FAIL [${fixture.token}] positive: expected to detect in "${input}"`,
      );
      failures++;
    }
  }

  // Negative: token MUST NOT be detected
  for (const input of fixture.negative) {
    const result = tokens(input);
    if (result.has(fixture.token)) {
      console.error(
        `FAIL [${fixture.token}] negative: falsely detected in "${input}"`,
      );
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} fixture(s) FAILED`);
  process.exit(1);
} else {
  const totalPositive = FIXTURES.reduce((s, f) => s + f.positive.length, 0);
  const totalNegative = FIXTURES.reduce((s, f) => s + f.negative.length, 0);
  console.log(
    `All ${FIXTURES.length} tokens passed (${totalPositive} positive, ${totalNegative} negative fixtures)`,
  );
}
