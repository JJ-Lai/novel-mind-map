/** 語意邊界文本切片 — 對齊藍圖 TextChunkingService */
const MAX_CHUNK_LENGTH = 3000;
const SPLIT_PATTERNS = [
  /(第[一二三四五六七八九十百千0-9]+[章回節])/,
  /\n\s*\n/,
  /\n/,
  /([。！？!?][”」』]?\s*)/,
];

export function splitText(text: string): string[] {
  const chunks: string[] = [];
  if (!text?.trim()) return chunks;
  processChunk(text.trim(), 0, chunks);
  return chunks.filter((c) => c.length > 0);
}

function processChunk(text: string, patternIndex: number, result: string[]): void {
  if (text.length <= MAX_CHUNK_LENGTH) {
    result.push(text);
    return;
  }
  if (patternIndex >= SPLIT_PATTERNS.length) {
    result.push(text.slice(0, MAX_CHUNK_LENGTH));
    processChunk(text.slice(MAX_CHUNK_LENGTH), patternIndex, result);
    return;
  }

  const pattern = SPLIT_PATTERNS[patternIndex];
  const searchLimit = Math.min(text.length, MAX_CHUNK_LENGTH);
  let bestCut = -1;
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const re = new RegExp(pattern.source, flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    if (end > 200 && end <= searchLimit) bestCut = end;
    if (end > searchLimit) break;
  }

  if (bestCut > 0) {
    result.push(text.slice(0, bestCut).trim());
    const rest = text.slice(bestCut).trim();
    if (rest) processChunk(rest, patternIndex, result);
  } else {
    processChunk(text, patternIndex + 1, result);
  }
}
