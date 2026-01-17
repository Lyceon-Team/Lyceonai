export type Choice = { key: 'A'|'B'|'C'|'D'; text: string };

// Base fields common to both MC and FR questions
interface QAItemBase {
  id: string;                     // canonical id: <docSlug>_p<page>_q<index>
  rawId?: string;                 // upstream hex or source-native id
  stem: string;
  explanation: string | null;
  section: 'Reading'|'Writing'|'Math'|null;
  source: { path: string; page: number };
  tags: string[];
  version: 1;
  createdAt: string;
  updatedAt: string;
  // Confidence scoring fields (from robust parser)
  confidence?: number;            // 0.0 - 1.0 confidence score
  needsReview?: boolean;          // true if confidence < 0.8
  parsingMetadata?: {
    anchorsDetected: string[];
    patternMatches: Record<string, boolean>;
    warnings: string[];
    originalText?: string;
  };
}

// Multiple Choice question type - exactly 4 options (A-D) with choice answer
export interface QAItemMC extends QAItemBase {
  type: "mc";
  options: Choice[];              // Must have exactly 4 options A-D  
  answer_choice: 'A'|'B'|'C'|'D'; // Choice answer for MC
}

// Free Response question type - no options, text/number answer
export interface QAItemFR extends QAItemBase {
  type: "fr";
  answer_text: string;            // Text/number answer for FR (non-empty)
}

// Discriminated union of question types
export type QAItem = QAItemMC | QAItemFR;

// Legacy type alias for backward compatibility
export type QAItemLegacy = QAItemMC;