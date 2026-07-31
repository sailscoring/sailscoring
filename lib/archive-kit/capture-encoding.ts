/**
 * Decoding captured result pages (ADR-010).
 *
 * Captures are verbatim third-party files and must not be transcoded in place,
 * so the encoding question lands here, at read time. Sailwave publishes
 * ISO-8859-1 — its pages declare `charset=ISO-8859-1` — and reading those bytes
 * as UTF-8 turns every accented name into U+FFFD. Names are the identity
 * spine's matching signal, so that corruption hits exactly the data an archive
 * exists to carry faithfully.
 *
 * The declared charset alone is not enough to decide by: across the archive
 * corpora, pages that declare ISO-8859-1 are sometimes really UTF-8, and the
 * one page declaring windows-1250 is pure ASCII. So decode by what the bytes
 * are, and consult the declaration only when they rule UTF-8 out:
 *
 *  1. A strict UTF-8 decode, which no single-byte page survives by accident.
 *  2. Failing that, the declared charset if it names something other than the
 *     Latin-1 family — and only if every byte maps.
 *  3. Otherwise byte by byte: a well-formed UTF-8 sequence is UTF-8, and any
 *     other high byte is windows-1252, the superset a browser would apply to a
 *     page declaring ISO-8859-1. Some pages really are mixed — a few IODAI
 *     Leinsters pages are UTF-8 apart from a stray windows-1252 apostrophe —
 *     and decoding the whole file either way mangles the other half.
 *
 * The five bytes windows-1252 leaves unassigned pass through as their own code
 * points rather than becoming U+FFFD: they are junk in the source (`P Cruise
 * O'\x81\x81\x81Brien`), and carrying junk verbatim beats swapping it for a
 * different junk character. Nothing here ever mints a U+FFFD.
 */

/** windows-1252's assignments for 0x80–0x9F, where it differs from ISO-8859-1.
 *  A gap means the byte is unassigned and passes through unchanged. */
const CP1252_HIGH_CONTROLS: Record<number, string> = {
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x8e: 'Ž',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9e: 'ž',
  0x9f: 'Ÿ',
};

/** The charset a page declares, from its `<meta charset>` or its
 *  `Content-Type` equivalent. Read from the head of the buffer as Latin-1, so
 *  the sniff itself never depends on the answer. */
function declaredCharset(bytes: Uint8Array): string | undefined {
  const head = latin1(bytes.subarray(0, 2048));
  return /charset\s*=\s*"?\s*([a-z0-9_-]+)/i.exec(head)?.[1]?.toLowerCase();
}

/** Every byte as its own code point — the one decode that cannot fail. */
function latin1(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 4096) {
    text += String.fromCharCode(...bytes.subarray(i, i + 4096));
  }
  return text;
}

const UTF8_LABELS = new Set(['utf-8', 'utf8', 'unicode-1-1-utf-8']);
const LATIN1_LABELS = new Set([
  'iso-8859-1',
  'iso8859-1',
  'iso_8859-1',
  '8859-1',
  'latin1',
  'l1',
  'cp1252',
  'windows-1252',
  'ansi_x3.4-1968',
  'us-ascii',
  'ascii',
]);

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** The length of the well-formed UTF-8 sequence starting at `i`, or 0 if the
 *  bytes there are not one. TextDecoder does the validating, so overlong
 *  encodings and surrogates count as "not UTF-8" and fall to windows-1252. */
function utf8SequenceLength(bytes: Uint8Array, i: number): number {
  const lead = bytes[i];
  const length = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 0;
  if (length === 0 || i + length > bytes.length) return 0;
  try {
    UTF8.decode(bytes.subarray(i, i + length));
    return length;
  } catch {
    return 0;
  }
}

/** Decode a page whose bytes are not wholly UTF-8: UTF-8 where the bytes are
 *  well-formed UTF-8, windows-1252 everywhere else. */
function decodeMixed(bytes: Uint8Array): { text: string; encoding: string } {
  const out: string[] = [];
  let sawUtf8 = false;
  let ascii = 0;
  for (let i = 0; i < bytes.length; ) {
    if (bytes[i] < 0x80) {
      ascii++;
      i++;
      continue;
    }
    if (ascii > 0) {
      out.push(latin1(bytes.subarray(i - ascii, i)));
      ascii = 0;
    }
    const length = utf8SequenceLength(bytes, i);
    if (length > 0) {
      sawUtf8 = true;
      out.push(UTF8.decode(bytes.subarray(i, i + length)));
      i += length;
      continue;
    }
    out.push(CP1252_HIGH_CONTROLS[bytes[i]] ?? String.fromCharCode(bytes[i]));
    i++;
  }
  if (ascii > 0) out.push(latin1(bytes.subarray(bytes.length - ascii)));
  return {
    text: out.join(''),
    encoding: sawUtf8 ? 'utf-8 + windows-1252' : 'windows-1252',
  };
}

/**
 * Decode a captured page, reporting which encoding the bytes turned out to be
 * in. `encoding` is for the caller's log, not for the parse — the text is
 * always the same string either way.
 */
export function decodeCapture(bytes: Uint8Array): { text: string; encoding: string } {
  const body =
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return { text: UTF8.decode(body), encoding: 'utf-8' };
  } catch {
    // Not UTF-8; fall through to the single-byte encodings.
  }

  const declared = declaredCharset(body);
  if (declared && !UTF8_LABELS.has(declared) && !LATIN1_LABELS.has(declared)) {
    try {
      return {
        text: new TextDecoder(declared, { fatal: true }).decode(body),
        encoding: declared,
      };
    } catch {
      // An unsupported label, or a byte the declared charset can't map: the
      // declaration is wrong or unusable, so ignore it.
    }
  }
  return decodeMixed(body);
}
