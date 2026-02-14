export type CanonicalSection = 'math' | 'rw';

export function normalizeSection(input: string | null | undefined): CanonicalSection | null {
  if (!input) return null;
  
  const lower = input.toLowerCase().trim();
  
  if (lower === 'math' || lower === 'm') {
    return 'math';
  }
  
  if (
    lower === 'rw' ||
    lower === 'reading' ||
    lower === 'writing' ||
    lower === 'r&w' ||
    lower === 'r & w' ||
    lower === 'reading & writing' ||
    lower === 'reading and writing'
  ) {
    return 'rw';
  }
  
  return null;
}

export function isValidSection(input: string | null | undefined): input is CanonicalSection {
  return normalizeSection(input) !== null;
}
