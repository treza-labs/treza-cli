/**
 * In-process redaction for `--local` mode.
 *
 * Pipeline:
 *   1. Deterministic regex/checksum recognizers (SSN, CC w/ Luhn, MRN, DOB cues)
 *      — these match the in-enclave recognizers exactly via `redact-manifest.json`.
 *   2. Lightweight regex-based NER fallback for emails, phones, URLs, and dates.
 *
 * Names and free-form addresses require the Privacy Filter token-classifier;
 * that swap is gated on shipping an ONNX export through `@huggingface/transformers`.
 * When wired in, replace `fallbackNer` with the transformers.js pipeline; the rest
 * of this module (merge, placeholder assignment, manifest) stays the same.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { RedactEntity, RedactResult } from './redact-api.js';

interface ManifestRecognizer {
  type: string;
  pattern: string;
  validator: 'ssn_format' | 'luhn' | 'none';
  captureGroup?: number;
}

interface RedactManifest {
  recognizerVersion: string;
  placeholderMap: Record<string, string>;
  regexRecognizers: ManifestRecognizer[];
  dobCueWords: string[];
  dobCueWindowChars: number;
}

const MANIFEST_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'redact-manifest.json',
);

let cachedManifest: RedactManifest | null = null;
function loadManifest(): RedactManifest {
  if (cachedManifest) return cachedManifest;
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  cachedManifest = JSON.parse(raw) as RedactManifest;
  return cachedManifest;
}

function luhnValid(digits: string): boolean {
  const trimmed = digits.replace(/[\s-]/g, '');
  if (trimmed.length < 13 || trimmed.length > 19 || !/^\d+$/.test(trimmed)) return false;
  let sum = 0;
  let alt = false;
  for (let i = trimmed.length - 1; i >= 0; i--) {
    let d = trimmed.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function ssnValid(match: RegExpExecArray): boolean {
  const [, a, b, c] = match;
  if (a === '000' || a === '666' || a.startsWith('9')) return false;
  if (b === '00') return false;
  if (c === '0000') return false;
  return true;
}

interface RawSpan {
  type: string;
  start: number;
  end: number;
  original: string;
}

function runRegexRecognizers(text: string, manifest: RedactManifest): RawSpan[] {
  const spans: RawSpan[] = [];
  for (const rec of manifest.regexRecognizers) {
    const re = new RegExp(rec.pattern, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (rec.validator === 'ssn_format' && !ssnValid(match)) continue;
      if (rec.validator === 'luhn' && !luhnValid(match[0])) continue;
      const captureIdx = rec.captureGroup ?? 0;
      const captured = match[captureIdx] ?? match[0];
      const offset = match[0].indexOf(captured);
      const start = match.index + (offset >= 0 ? offset : 0);
      const end = start + captured.length;
      spans.push({ type: rec.type, start, end, original: captured });
    }
  }
  return spans;
}

function isDobContext(text: string, start: number, manifest: RedactManifest): boolean {
  const window = manifest.dobCueWindowChars;
  const before = text.slice(Math.max(0, start - window), start).toLowerCase();
  for (const cue of manifest.dobCueWords) {
    if (before.includes(cue.toLowerCase())) return true;
  }
  return false;
}

interface FallbackEntity {
  type: string;
  start: number;
  end: number;
}

/**
 * Best-effort NER fallback for the MVP local mode. Detects emails, phones,
 * URLs, and simple dates with deterministic patterns. This is a stand-in
 * until the Privacy Filter ONNX export is wired in (handled in a later
 * task; the harness here makes that swap a one-line change).
 */
function fallbackNer(text: string): FallbackEntity[] {
  const found: FallbackEntity[] = [];
  const patterns: Array<[string, RegExp]> = [
    ['private_email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
    ['private_phone', /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g],
    ['private_url', /\bhttps?:\/\/[^\s)]+/g],
    [
      'private_date',
      /\b(?:\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/g,
    ],
  ];
  for (const [type, re] of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      found.push({ type, start: m.index, end: m.index + m[0].length });
    }
  }
  return found;
}

function mergeSpans(regex: RawSpan[], ner: FallbackEntity[]): RawSpan[] {
  const out: RawSpan[] = [...regex];
  for (const n of ner) {
    const overlaps = regex.some((r) => !(n.end <= r.start || n.start >= r.end));
    if (!overlaps) {
      out.push({ type: n.type, start: n.start, end: n.end, original: '' });
    }
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

function assignPlaceholders(
  spans: RawSpan[],
  text: string,
  manifest: RedactManifest,
): { redacted: string; entities: RedactEntity[] } {
  const counters: Record<string, number> = {};
  const entities: RedactEntity[] = [];
  let cursor = 0;
  let redacted = '';

  for (const span of spans) {
    let label = span.type;
    if (label === 'private_date' && isDobContext(text, span.start, manifest)) {
      label = 'DOB';
    }
    const placeholderBase = manifest.placeholderMap[label] || label.toUpperCase();
    counters[placeholderBase] = (counters[placeholderBase] || 0) + 1;
    const placeholder = `[${placeholderBase}_${counters[placeholderBase]}]`;

    redacted += text.slice(cursor, span.start);
    const placeholderStart = redacted.length;
    redacted += placeholder;
    cursor = span.end;

    entities.push({
      type: placeholderBase,
      placeholder,
      start: placeholderStart,
      end: placeholderStart + placeholder.length,
    });
  }
  redacted += text.slice(cursor);
  return { redacted, entities };
}

export async function redactTextLocal(text: string): Promise<RedactResult> {
  const manifest = loadManifest();
  const regexSpans = runRegexRecognizers(text, manifest);
  const ner = fallbackNer(text);
  const merged = mergeSpans(regexSpans, ner);
  const { redacted, entities } = assignPlaceholders(merged, text, manifest);
  return {
    redacted,
    entities,
    requestId: `local-${Date.now().toString(36)}`,
    modelVersion: 'local-fallback-ner-0.1',
    recognizerVersion: manifest.recognizerVersion,
  };
}
