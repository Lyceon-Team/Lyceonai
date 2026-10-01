/**
 * @spec [LISA_Layer1_Pattern_Set_v1 §7.4–§7.9]
 * @implemented 2026-09-17
 *
 * plain English: validation harness for the Layer 1 crisis pattern set (v1).
 * Pure string matching — no DB, no credentials, no mocks. Proves:
 *   1. Every seeded pattern matches its canonical form (true positives)
 *   2. Every seeded pattern matches common input variants (TP variants)
 *   3. No seeded pattern matches any §7.9 exclusion standing alone (FP guard)
 *   4. No seeded pattern matches adversarial benign inputs (FP adversarial)
 *   5. Third-person constructions do not trigger first-person patterns
 *   6. Negative set is larger than positive set
 *
 * The matching contract (§7.4): normalize(input).includes(pattern).
 */
import { describe, it, expect } from "vitest";
import { normalizeCrisisText } from "../../server/services/tutor-crisis";

// ── The pattern set (mirrors the seed migration exactly) ──────────────

type PatternEntry = {
  pattern: string;
  category: "suicide" | "self_harm" | "abuse";
  severity: "critical" | "high";
  section: string;
};

const PATTERNS: PatternEntry[] = [
  // §7.5 Suicide — intent, planning, attempt (critical)
  {
    pattern: "i am going to kill myself",
    category: "suicide",
    severity: "critical",
    section: "§7.5",
  },
  {
    pattern: "i am about to kill myself",
    category: "suicide",
    severity: "critical",
    section: "§7.5",
  },
  {
    pattern: "i plan to kill myself",
    category: "suicide",
    severity: "critical",
    section: "§7.5",
  },
  {
    pattern: "i have a plan to kill myself",
    category: "suicide",
    severity: "critical",
    section: "§7.5",
  },
  {
    pattern: "i know how i am going to kill myself",
    category: "suicide",
    severity: "critical",
    section: "§7.5",
  },
  {
    pattern: "i am going to end my life",
    category: "suicide",
    severity: "critical",
    section: "§7.5",
  },
  {
    pattern: "i plan to end my life",
    category: "suicide",
    severity: "critical",
    section: "§7.5",
  },
  {
    pattern: "i am going to commit suicide",
    category: "suicide",
    severity: "critical",
    section: "§7.5",
  },
  {
    pattern: "i just tried to kill myself",
    category: "suicide",
    severity: "critical",
    section: "§7.5",
  },
  {
    pattern: "i tried to kill myself today",
    category: "suicide",
    severity: "critical",
    section: "§7.5",
  },
  {
    pattern: "i tried to kill myself tonight",
    category: "suicide",
    severity: "critical",
    section: "§7.5",
  },
  {
    pattern: "i wrote a suicide note",
    category: "suicide",
    severity: "critical",
    section: "§7.5",
  },
  {
    pattern: "i am going to kms",
    category: "suicide",
    severity: "critical",
    section: "§7.5",
  },
  {
    pattern: "i am gonna kms",
    category: "suicide",
    severity: "critical",
    section: "§7.5",
  },
  {
    pattern: "i am going to unalive myself",
    category: "suicide",
    severity: "critical",
    section: "§7.5",
  },

  // §7.6 Suicide — ideation, death wish, history (high)
  {
    pattern: "i want to kill myself",
    category: "suicide",
    severity: "high",
    section: "§7.6",
  },
  {
    pattern: "i am thinking about killing myself",
    category: "suicide",
    severity: "high",
    section: "§7.6",
  },
  {
    pattern: "i have been thinking about killing myself",
    category: "suicide",
    severity: "high",
    section: "§7.6",
  },
  {
    pattern: "i am suicidal",
    category: "suicide",
    severity: "high",
    section: "§7.6",
  },
  {
    pattern: "i am having suicidal thoughts",
    category: "suicide",
    severity: "high",
    section: "§7.6",
  },
  {
    pattern: "i want to end my life",
    category: "suicide",
    severity: "high",
    section: "§7.6",
  },
  {
    pattern: "i wish i were dead",
    category: "suicide",
    severity: "high",
    section: "§7.6",
  },
  {
    pattern: "i wish i was dead",
    category: "suicide",
    severity: "high",
    section: "§7.6",
  },
  {
    pattern: "i wish i could go to sleep and not wake up",
    category: "suicide",
    severity: "high",
    section: "§7.6",
  },
  {
    pattern: "i do not want to be alive anymore",
    category: "suicide",
    severity: "high",
    section: "§7.6",
  },
  {
    pattern: "everyone would be better off if i were dead",
    category: "suicide",
    severity: "high",
    section: "§7.6",
  },
  {
    pattern: "my family would be better off if i were dead",
    category: "suicide",
    severity: "high",
    section: "§7.6",
  },
  {
    pattern: "i have tried to kill myself",
    category: "suicide",
    severity: "high",
    section: "§7.6",
  },
  {
    pattern: "i attempted suicide",
    category: "suicide",
    severity: "high",
    section: "§7.6",
  },
  {
    pattern: "i want to kms",
    category: "suicide",
    severity: "high",
    section: "§7.6",
  },

  // §7.7 Deliberate self-harm — critical
  {
    pattern: "i am hurting myself right now",
    category: "self_harm",
    severity: "critical",
    section: "§7.7",
  },
  {
    pattern: "i am cutting myself right now",
    category: "self_harm",
    severity: "critical",
    section: "§7.7",
  },

  // §7.7 Deliberate self-harm — high
  {
    pattern: "i want to hurt myself",
    category: "self_harm",
    severity: "high",
    section: "§7.7",
  },
  {
    pattern: "i am going to hurt myself",
    category: "self_harm",
    severity: "high",
    section: "§7.7",
  },
  {
    pattern: "i want to cut myself",
    category: "self_harm",
    severity: "high",
    section: "§7.7",
  },
  {
    pattern: "i am going to cut myself",
    category: "self_harm",
    severity: "high",
    section: "§7.7",
  },
  {
    pattern: "i have been cutting myself",
    category: "self_harm",
    severity: "high",
    section: "§7.7",
  },
  {
    pattern: "i cut myself on purpose",
    category: "self_harm",
    severity: "high",
    section: "§7.7",
  },
  {
    pattern: "i hurt myself on purpose",
    category: "self_harm",
    severity: "high",
    section: "§7.7",
  },
  {
    pattern: "i have been self harming",
    category: "self_harm",
    severity: "high",
    section: "§7.7",
  },
  {
    pattern: "i am going to self harm",
    category: "self_harm",
    severity: "high",
    section: "§7.7",
  },

  // §7.8 Abuse and sexual assault — critical
  {
    pattern: "i am being raped",
    category: "abuse",
    severity: "critical",
    section: "§7.8",
  },
  {
    pattern: "someone is hurting me right now",
    category: "abuse",
    severity: "critical",
    section: "§7.8",
  },
  {
    pattern: "someone is threatening to kill me",
    category: "abuse",
    severity: "critical",
    section: "§7.8",
  },

  // §7.8 Abuse and sexual assault — high
  {
    pattern: "i am being abused",
    category: "abuse",
    severity: "high",
    section: "§7.8",
  },
  {
    pattern: "my mom is abusing me",
    category: "abuse",
    severity: "high",
    section: "§7.8",
  },
  {
    pattern: "my dad is abusing me",
    category: "abuse",
    severity: "high",
    section: "§7.8",
  },
  {
    pattern: "my parents are abusing me",
    category: "abuse",
    severity: "high",
    section: "§7.8",
  },
  {
    pattern: "i was raped",
    category: "abuse",
    severity: "high",
    section: "§7.8",
  },
  {
    pattern: "someone raped me",
    category: "abuse",
    severity: "high",
    section: "§7.8",
  },
  {
    pattern: "i was sexually assaulted",
    category: "abuse",
    severity: "high",
    section: "§7.8",
  },
  {
    pattern: "someone sexually assaulted me",
    category: "abuse",
    severity: "high",
    section: "§7.8",
  },
  {
    pattern: "i was molested",
    category: "abuse",
    severity: "high",
    section: "§7.8",
  },
  {
    pattern: "someone molested me",
    category: "abuse",
    severity: "high",
    section: "§7.8",
  },
  {
    pattern: "i was forced to have sex",
    category: "abuse",
    severity: "high",
    section: "§7.8",
  },
  {
    pattern: "someone forced me to have sex",
    category: "abuse",
    severity: "high",
    section: "§7.8",
  },
];

// ── Matching function (§7.4 contract) ─────────────────────────────────

function matchesAnyPattern(input: string): {
  matched: boolean;
  pattern?: string;
} {
  const normalized = normalizeCrisisText(input);
  for (const entry of PATTERNS) {
    if (normalized.includes(entry.pattern)) {
      return { matched: true, pattern: entry.pattern };
    }
  }
  return { matched: false };
}

// ── §7.9 Exclusions — must never match standing alone ─────────────────

const EXCLUSIONS: string[] = [
  "kms",
  "kill me",
  "unalive",
  "i am dead",
  "dead inside",
  "i want to die",
  "suicide",
  "self harm",
  "cut myself",
  "i hate my life",
  "there is no point",
  "i cannot do this anymore",
  "i give up",
  "everyone hates me",
  "this test is killing me",
  "i am going to die",
  "killing me",
  "i am dying",
];

// ── True positive variants ────────────────────────────────────────────
// Each pattern with input variations that should still match after normalization.

const TP_VARIANTS: Array<{
  input: string;
  shouldMatchPattern: string;
  description: string;
}> = [
  // Contraction expansion (§7.4 step 4)
  {
    input: "I'm going to kill myself",
    shouldMatchPattern: "i am going to kill myself",
    description: "I'm → i am",
  },
  {
    input: "I'm about to kill myself",
    shouldMatchPattern: "i am about to kill myself",
    description: "I'm → i am",
  },
  {
    input: "I'm suicidal",
    shouldMatchPattern: "i am suicidal",
    description: "I'm → i am",
  },
  {
    input: "I'm having suicidal thoughts",
    shouldMatchPattern: "i am having suicidal thoughts",
    description: "I'm → i am",
  },
  {
    input: "I'm going to end my life",
    shouldMatchPattern: "i am going to end my life",
    description: "I'm → i am",
  },
  {
    input: "I'm going to commit suicide",
    shouldMatchPattern: "i am going to commit suicide",
    description: "I'm → i am",
  },
  {
    input: "I'm being raped",
    shouldMatchPattern: "i am being raped",
    description: "I'm → i am",
  },
  {
    input: "I'm being abused",
    shouldMatchPattern: "i am being abused",
    description: "I'm → i am",
  },
  {
    input: "I'm hurting myself right now",
    shouldMatchPattern: "i am hurting myself right now",
    description: "I'm → i am",
  },
  {
    input: "I'm cutting myself right now",
    shouldMatchPattern: "i am cutting myself right now",
    description: "I'm → i am",
  },
  {
    input: "I've been thinking about killing myself",
    shouldMatchPattern: "i have been thinking about killing myself",
    description: "I've → i have",
  },
  {
    input: "I've been cutting myself",
    shouldMatchPattern: "i have been cutting myself",
    description: "I've → i have",
  },
  {
    input: "I've been self harming",
    shouldMatchPattern: "i have been self harming",
    description: "I've → i have",
  },
  {
    input: "I've tried to kill myself",
    shouldMatchPattern: "i have tried to kill myself",
    description: "I've → i have",
  },
  {
    input: "I don't want to be alive anymore",
    shouldMatchPattern: "i do not want to be alive anymore",
    description: "don't → do not",
  },
  {
    input: "I can't do this I'm going to kill myself",
    shouldMatchPattern: "i am going to kill myself",
    description: "can't + I'm expansion",
  },

  // Smart quotes (§7.4 step 3)
  {
    input: "I’m going to kill myself",
    shouldMatchPattern: "i am going to kill myself",
    description: "curly apostrophe",
  },
  {
    input: "I’ve been cutting myself",
    shouldMatchPattern: "i have been cutting myself",
    description: "curly apostrophe",
  },
  {
    input: "I don’t want to be alive anymore",
    shouldMatchPattern: "i do not want to be alive anymore",
    description: "curly apostrophe in don't",
  },

  // Whitespace normalization (§7.4 step 6)
  {
    input: "i  am  going  to  kill  myself",
    shouldMatchPattern: "i am going to kill myself",
    description: "double spaces",
  },
  {
    input: "  i am going to kill myself  ",
    shouldMatchPattern: "i am going to kill myself",
    description: "leading/trailing spaces",
  },
  {
    input: "i am going to kill myself\t",
    shouldMatchPattern: "i am going to kill myself",
    description: "trailing tab",
  },

  // Terminal punctuation stripping (§7.4 step 7)
  {
    input: "i am going to kill myself!!!",
    shouldMatchPattern: "i am going to kill myself",
    description: "repeated !",
  },
  {
    input: "i want to kill myself???",
    shouldMatchPattern: "i want to kill myself",
    description: "repeated ?",
  },

  // Mixed case (§7.4 step 2)
  {
    input: "I AM GOING TO KILL MYSELF",
    shouldMatchPattern: "i am going to kill myself",
    description: "all caps",
  },
  {
    input: "I Am Going To Kill Myself",
    shouldMatchPattern: "i am going to kill myself",
    description: "title case",
  },

  // Self-harm normalization (§7.4 step 5)
  {
    input: "i have been self-harming",
    shouldMatchPattern: "i have been self harming",
    description: "self-harm → self harm",
  },
  {
    input: "i have been selfharming",
    shouldMatchPattern: "i have been self harming",
    description: "selfharm → self harm",
  },
  {
    input: "i am going to self-harm",
    shouldMatchPattern: "i am going to self harm",
    description: "self-harm → self harm",
  },
  {
    input: "i am going to selfharm",
    shouldMatchPattern: "i am going to self harm",
    description: "selfharm → self harm",
  },

  // Pattern embedded in longer message (substring containment)
  {
    input: "I can't focus on math right now because i am going to kill myself",
    shouldMatchPattern: "i am going to kill myself",
    description: "embedded in longer text",
  },
  {
    input: "please help me i want to hurt myself i don't know what to do",
    shouldMatchPattern: "i want to hurt myself",
    description: "embedded mid-sentence",
  },
  {
    input: "my dad is abusing me and i don't know who to tell",
    shouldMatchPattern: "my dad is abusing me",
    description: "abuse embedded",
  },

  // §7.5 kms patterns with contractions
  {
    input: "I'm going to kms",
    shouldMatchPattern: "i am going to kms",
    description: "kms with I'm",
  },
  {
    input: "I'm gonna kms",
    shouldMatchPattern: "i am gonna kms",
    description: "kms gonna with I'm",
  },

  // Won't expansion
  {
    input: "I won't survive this I'm going to kill myself",
    shouldMatchPattern: "i am going to kill myself",
    description: "won't expansion",
  },
];

// ── Adversarial negative set ──────────────────────────────────────────
// Must be LARGER than the positive set (56 patterns + TP variants).
// Third-person is the critical case (Amendment 4).

const ADVERSARIAL_NEGATIVES: Array<{ input: string; description: string }> = [
  // ── Third-person (THE critical case per Amendment 4) ────────────────
  {
    input: "my friend said he wants to kill himself",
    description: "third-person friend",
  },
  {
    input: "my friend is thinking about killing herself",
    description: "third-person friend female",
  },
  {
    input: "my brother told me he is suicidal",
    description: "third-person sibling",
  },
  {
    input: "she said she wants to end her life",
    description: "third-person she",
  },
  {
    input: "he told me he tried to kill himself",
    description: "third-person he past",
  },
  {
    input: "my classmate said he is going to kill himself",
    description: "third-person classmate",
  },
  {
    input: "this kid at school says she cuts herself",
    description: "third-person school peer",
  },
  {
    input: "my friend has been self harming",
    description: "third-person self harm",
  },
  {
    input: "my roommate told me she was raped",
    description: "third-person abuse report",
  },
  { input: "he wants to hurt himself", description: "third-person hurt" },
  {
    input: "she is being abused by her parents",
    description: "third-person abuse",
  },
  { input: "they said they want to die", description: "third-person they" },
  {
    input: "a character in the story wants to kill himself",
    description: "third-person fictional",
  },
  {
    input: "romeo kills himself at the end of the play",
    description: "third-person literary",
  },
  {
    input: "his friend attempted suicide last year",
    description: "third-person past attempt",
  },

  // ── SAT / schoolwork hyperbole ──────────────────────────────────────
  { input: "this test is killing me", description: "SAT hyperbole killing" },
  {
    input: "this math problem is going to be the death of me",
    description: "SAT hyperbole death",
  },
  { input: "i am dead if i fail this exam", description: "SAT hyperbole dead" },
  {
    input: "i am dying to get this answer right",
    description: "SAT hyperbole dying",
  },
  {
    input: "i could kill for a good grade on this",
    description: "SAT hyperbole kill for",
  },
  {
    input: "these SAT questions are murdering me",
    description: "SAT hyperbole murdering",
  },
  {
    input: "i want to die looking at this passage",
    description: "SAT hyperbole want to die",
  },
  {
    input: "oh my god i am going to die if i see another fraction",
    description: "SAT hyperbole die fractions",
  },
  {
    input: "kill me now this is so boring",
    description: "SAT hyperbole kill me",
  },
  { input: "i give up on this problem", description: "SAT give up" },
  {
    input: "i cannot do this anymore this is too hard",
    description: "SAT frustration",
  },
  {
    input: "there is no point in studying for this",
    description: "SAT no point",
  },

  // ── Quoted literature / reading passages ────────────────────────────
  {
    input:
      "in the passage, the narrator says he wanted to end his life after the war",
    description: "literary narrator",
  },
  {
    input: "the author describes a character who attempted suicide",
    description: "literary character",
  },
  {
    input: "ophelia drowns herself in act four",
    description: "literary Ophelia",
  },
  {
    input: "the poem's speaker expresses a death wish which shows despair",
    description: "literary poem speaker paraphrase",
  },
  {
    input:
      "in the reading passage a soldier writes a suicide note to his family",
    description: "literary suicide note",
  },
  {
    input: "the memoir describes how she was sexually assaulted as a teenager",
    description: "literary memoir",
  },
  {
    input: "the article discusses survivors of abuse and their recovery",
    description: "literary article",
  },
  {
    input:
      "according to the passage the character says i am going to die alone",
    description: "literary character speech",
  },

  // ── News / current events discussion ────────────────────────────────
  {
    input: "the article is about suicide prevention programs in schools",
    description: "news prevention",
  },
  {
    input: "teen suicide rates have increased according to the CDC",
    description: "news statistics",
  },
  {
    input: "the passage discusses self harm awareness campaigns",
    description: "news awareness",
  },
  {
    input: "organizations that help people who have been sexually assaulted",
    description: "news orgs",
  },
  {
    input: "the author argues that schools should do more to prevent abuse",
    description: "news argument",
  },
  {
    input: "child abuse statistics from the reading passage",
    description: "news statistics abuse",
  },
  {
    input: "the article mentions the national suicide prevention lifeline",
    description: "news lifeline",
  },

  // ── Prevention / help-seeking questions ─────────────────────────────
  {
    input: "how do i help a friend who is suicidal",
    description: "help-seeking friend",
  },
  {
    input: "what should i do if someone tells me they want to kill themselves",
    description: "help-seeking what do",
  },
  {
    input: "where can someone get help for self harm",
    description: "help-seeking self harm",
  },
  {
    input: "what are signs that someone might be suicidal",
    description: "help-seeking signs",
  },
  {
    input: "how can i support a friend who was sexually assaulted",
    description: "help-seeking support",
  },
  {
    input: "what is the phone number for the suicide hotline",
    description: "help-seeking hotline",
  },
  {
    input: "can you tell me about crisis resources",
    description: "help-seeking resources",
  },

  // ── Accidental injury / medical ─────────────────────────────────────
  {
    input: "i cut myself on a piece of paper today",
    description: "accidental paper cut",
  },
  {
    input: "i hurt myself playing basketball",
    description: "accidental sports",
  },
  {
    input: "i cut myself while cooking dinner",
    description: "accidental cooking",
  },
  {
    input: "i accidentally hurt myself moving furniture",
    description: "accidental moving",
  },
  { input: "i burned myself on the stove", description: "accidental burn" },
  {
    input: "i tripped and hurt myself on the stairs",
    description: "accidental trip",
  },

  // ── §7.9 Exclusions standing alone (verbatim) ──────────────────────
  { input: "kms", description: "§7.9 exclusion: kms alone" },
  { input: "kill me", description: "§7.9 exclusion: kill me alone" },
  { input: "unalive", description: "§7.9 exclusion: unalive alone" },
  { input: "i am dead", description: "§7.9 exclusion: i am dead alone" },
  { input: "dead inside", description: "§7.9 exclusion: dead inside alone" },
  {
    input: "i want to die",
    description: "§7.9 exclusion: i want to die alone",
  },
  { input: "suicide", description: "§7.9 exclusion: suicide alone" },
  { input: "self harm", description: "§7.9 exclusion: self harm alone" },
  { input: "cut myself", description: "§7.9 exclusion: cut myself alone" },
  {
    input: "i hate my life",
    description: "§7.9 exclusion: i hate my life alone",
  },
  {
    input: "there is no point",
    description: "§7.9 exclusion: there is no point alone",
  },
  {
    input: "i cannot do this anymore",
    description: "§7.9 exclusion: i cannot do this anymore alone",
  },
  { input: "i give up", description: "§7.9 exclusion: i give up alone" },
  {
    input: "everyone hates me",
    description: "§7.9 exclusion: everyone hates me alone",
  },
  {
    input: "this test is killing me",
    description: "§7.9 exclusion: this test is killing me alone",
  },
  {
    input: "i am going to die",
    description: "§7.9 exclusion: i am going to die alone",
  },
  { input: "killing me", description: "§7.9 exclusion: killing me alone" },
  { input: "i am dying", description: "§7.9 exclusion: i am dying alone" },

  // ── §7.9 Exclusions with contractions (pre-normalization) ───────────
  {
    input: "I can't do this anymore",
    description: "§7.9 contraction: can't do this",
  },
  { input: "I'm dead", description: "§7.9 contraction: I'm dead" },
  { input: "I'm dying", description: "§7.9 contraction: I'm dying" },

  // ── Generic distress (Layer 2 territory) ────────────────────────────
  { input: "i feel hopeless", description: "generic distress hopeless" },
  { input: "i feel so alone", description: "generic distress alone" },
  {
    input: "nobody cares about me",
    description: "generic distress nobody cares",
  },
  { input: "i have no friends", description: "generic distress no friends" },
  { input: "i am so depressed", description: "generic distress depressed" },
  {
    input: "i hate everything",
    description: "generic distress hate everything",
  },
  {
    input: "nothing matters anymore",
    description: "generic distress nothing matters",
  },
  {
    input: "what is the point of anything",
    description: "generic distress what is the point",
  },
  { input: "i feel empty inside", description: "generic distress empty" },
  { input: "i am worthless", description: "generic distress worthless" },

  // ── Deliberately excluded phrases from §7.2/§7.8 ───────────────────
  { input: "my mom hits me", description: "§7.8 excluded: mom hits me" },
  { input: "my dad hits me", description: "§7.8 excluded: dad hits me" },
  { input: "he hits me", description: "§7.8 excluded: he hits me" },
  {
    input: "my mom hits me up for rides",
    description: "§7.8 excluded: hits me up (benign)",
  },

  // ── Edge cases: near-miss patterns ──────────────────────────────────
  {
    input: "i am not going to kill myself",
    description: "negation: not going to",
  },
  { input: "i would never kill myself", description: "negation: would never" },
  { input: "i am not suicidal", description: "negation: not suicidal" },
  {
    input: "killing myself laughing at this question",
    description: "idiom: killing myself laughing",
  },
  {
    input: "i could kill myself for forgetting that answer",
    description: "idiom: figurative kill myself",
  },

  // ── Longer benign messages with trigger words embedded ──────────────
  {
    input:
      "the essay prompt asks about youth suicide prevention and what communities can do",
    description: "academic suicide word",
  },
  {
    input: "we studied self harm awareness in health class today",
    description: "academic self harm",
  },
  {
    input: "the reading passage was about domestic abuse survivors",
    description: "academic abuse",
  },
  {
    input: "i read about someone who was molested in the news article",
    description: "news third-person molested",
  },
  {
    input: "the question asks about rape culture in modern society",
    description: "academic rape word",
  },
];

// ── Tests ─────────────────────────────────────────────────────────────

describe("Layer 1 crisis pattern validation harness", () => {
  describe("set size invariant", () => {
    it("negative set is larger than positive set", () => {
      expect(ADVERSARIAL_NEGATIVES.length).toBeGreaterThan(PATTERNS.length);
      expect(ADVERSARIAL_NEGATIVES.length).toBeGreaterThan(TP_VARIANTS.length);
    });
  });

  describe("true positives — every pattern matches its canonical form", () => {
    for (const entry of PATTERNS) {
      it(`[${entry.section}] "${entry.pattern}"`, () => {
        const result = matchesAnyPattern(entry.pattern);
        expect(result.matched).toBe(true);
      });
    }
  });

  describe("true positives — input variants match after normalization", () => {
    for (const variant of TP_VARIANTS) {
      it(`${variant.description}: "${variant.input.slice(0, 60)}"`, () => {
        const result = matchesAnyPattern(variant.input);
        expect(result.matched).toBe(true);
        expect(result.pattern).toBe(variant.shouldMatchPattern);
      });
    }
  });

  describe("§7.9 exclusions — no pattern matches any exclusion standing alone", () => {
    for (const excl of EXCLUSIONS) {
      it(`exclusion "${excl}" must NOT match`, () => {
        const result = matchesAnyPattern(excl);
        if (result.matched) {
          throw new Error(
            `§7.9 VIOLATION: exclusion "${excl}" matched pattern "${result.pattern}". ` +
              `This is a pattern-set defect, not a code problem.`,
          );
        }
        expect(result.matched).toBe(false);
      });
    }
  });

  describe("§7.9 exclusions with pre-normalization forms", () => {
    const PRE_NORM_EXCLUSIONS = [
      "KMS",
      "Kill me",
      "UNALIVE",
      "I'm dead",
      "I'm dying",
      "I can't do this anymore",
      "self-harm",
      "selfharm",
      "I don't want to do this anymore",
    ];

    for (const excl of PRE_NORM_EXCLUSIONS) {
      it(`pre-norm exclusion "${excl}" must NOT match`, () => {
        const result = matchesAnyPattern(excl);
        if (result.matched) {
          throw new Error(
            `§7.9 VIOLATION: pre-normalization exclusion "${excl}" matched pattern "${result.pattern}".`,
          );
        }
        expect(result.matched).toBe(false);
      });
    }
  });

  describe("adversarial negatives — no false positives", () => {
    for (const neg of ADVERSARIAL_NEGATIVES) {
      it(`[${neg.description}] "${neg.input.slice(0, 60)}"`, () => {
        const result = matchesAnyPattern(neg.input);
        if (result.matched) {
          throw new Error(
            `FALSE POSITIVE: "${neg.input}" matched pattern "${result.pattern}". ` +
              `Description: ${neg.description}. ` +
              `Report the pattern rather than adding an exclusion around it.`,
          );
        }
        expect(result.matched).toBe(false);
      });
    }
  });

  describe("normalizeCrisisText unit tests", () => {
    it("NFC normalizes unicode", () => {
      const combined = "é"; // é as combining
      const precomposed = "é"; // é precomposed
      expect(normalizeCrisisText(combined)).toBe(
        normalizeCrisisText(precomposed),
      );
    });

    it("lowercases", () => {
      expect(normalizeCrisisText("HELLO WORLD")).toBe("hello world");
    });

    it("normalizes smart quotes", () => {
      expect(normalizeCrisisText("I’m fine")).toBe("i am fine");
      expect(normalizeCrisisText("“Hello”")).toBe('"hello"');
    });

    it("expands contractions", () => {
      expect(normalizeCrisisText("I'm going")).toBe("i am going");
      expect(normalizeCrisisText("I've done")).toBe("i have done");
      expect(normalizeCrisisText("don't do")).toBe("do not do");
      expect(normalizeCrisisText("can't stop")).toBe("cannot stop");
      expect(normalizeCrisisText("won't go")).toBe("will not go");
    });

    it("normalizes self-harm variants", () => {
      expect(normalizeCrisisText("self-harm")).toBe("self harm");
      expect(normalizeCrisisText("selfharm")).toBe("self harm");
      expect(normalizeCrisisText("self harm")).toBe("self harm");
    });

    it("collapses whitespace", () => {
      expect(normalizeCrisisText("  hello   world  ")).toBe("hello world");
    });

    it("strips repeated terminal punctuation", () => {
      expect(normalizeCrisisText("why???")).toBe("why?");
      expect(normalizeCrisisText("stop!!!")).toBe("stop!");
      expect(normalizeCrisisText("ok...")).toBe("ok.");
    });

    it("single terminal punctuation is preserved", () => {
      expect(normalizeCrisisText("why?")).toBe("why?");
      expect(normalizeCrisisText("stop!")).toBe("stop!");
    });
  });
});
