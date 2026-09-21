// This project originally used `pdf-parse@1.1.1`, which ships a debug block
// in its own entry point — `let isDebugMode = !module.parent` — that throws
// ENOENT under ESM/tsx unless you import the inner
// `pdf-parse/lib/pdf-parse.js` module directly. With that worked around, a
// deeper bug surfaced: extractPdfText() was empirically found (via
// Promise.all and even plain sequential repeated calls in the same process)
// to occasionally return a *different* upload's text under the correct
// request's filename — a real cross-request data leak, not a cosmetic bug.
// Root cause: pdf-parse@1.1.1 bundles pdf.js v1.10.100 with
// `PDFJS.disableWorker = true`, and that ancient build's Node "fake worker"
// fallback is an internal singleton never designed for a long-lived,
// multi-request server process (it assumes one-shot CLI/script usage).
// pdf-parse@2.x fixes this but pulls in `@napi-rs/canvas`, a native/prebuilt
// dependency — exactly the toolchain risk pdf-parse was chosen over.
//
// So: use `pdfjs-dist` directly (zero dependencies of its own, pure JS for
// the text-extraction path used here — no `canvas` needed unless
// rendering/screenshotting pages, which this file never does). Each
// extractPdfText() call creates and destroys its own PDFDocumentProxy, with
// no shared module-level parsing state — confirmed race-free under both
// concurrent (`Promise.all`) and rapid-sequential repeated calls.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

/** Below this many extracted characters, treat the PDF as textless (a
 *  scanned/image-only PDF still "succeeds" at the library level but yields
 *  ~0 characters) rather than pass near-empty text on to the classifier. */
const MIN_TEXT_LENGTH = 40;

const NO_TEXT_LAYER_MESSAGE =
  "Couldn't read a text layer from this PDF — it may be scanned/image-only.";

/** Thrown when a PDF can't be parsed at all, or parses to (near) no text —
 *  the route turns this into a 400 with NO_TEXT_LAYER_MESSAGE. */
export class PdfNoTextLayerError extends Error {}

/** Join one page's text items into a string, inserting a newline whenever
 *  the text's baseline Y-coordinate changes (i.e. a new visual line) and
 *  otherwise concatenating in place — the same item.transform[5]-based
 *  heuristic pdf-parse's own render_page() uses, ported here so
 *  line-oriented signals in services/classify.ts (contact header / name
 *  line, both scoped to "the first N lines") still see meaningful lines
 *  rather than one giant per-page run-on string. */
function joinTextItems(items: Array<TextItem | { str?: undefined }>): string {
  let text = "";
  let lastY: number | undefined;
  for (const item of items) {
    if (!("str" in item) || typeof item.str !== "string") continue;
    const y = item.transform?.[5];
    if (lastY === undefined || lastY === y) {
      text += item.str;
    } else {
      text += "\n" + item.str;
    }
    lastY = y;
  }
  return text;
}

/**
 * Extract plain text from a PDF buffer, entirely in memory — the buffer is
 * never written to disk anywhere. Throws PdfNoTextLayerError for a
 * corrupt/unparseable PDF or one with (near) no text layer; never throws any
 * other error shape.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  let text: string;
  try {
    const doc = await getDocument({
      data: new Uint8Array(buffer),
      // Node has no DOM/fetch-backed CMap or font loading; keep everything
      // local/synchronous rather than trying (and failing) to fetch assets.
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    try {
      const pageTexts: string[] = [];
      for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
        const page = await doc.getPage(pageNum);
        try {
          const content = await page.getTextContent();
          pageTexts.push(joinTextItems(content.items as TextItem[]));
        } finally {
          page.cleanup();
        }
      }
      text = pageTexts.join("\n\n").trim();
    } finally {
      await doc.destroy();
    }
  } catch {
    throw new PdfNoTextLayerError(NO_TEXT_LAYER_MESSAGE);
  }
  if (text.length < MIN_TEXT_LENGTH) {
    throw new PdfNoTextLayerError(NO_TEXT_LAYER_MESSAGE);
  }
  return text;
}
