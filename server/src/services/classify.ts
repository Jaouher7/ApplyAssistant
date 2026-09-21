/**
 * Bilingual (EN/FR — the job-hunt corpus is French-first) job-posting vs CV
 * classifier: weighted signal counting → two scores → decision. Intentionally
 * simple: this only ever produces a *suggestion* the user confirms/overrides
 * in the UI before anything is written (services/jobHuntWrite.ts never calls
 * this), so it does not need to be a perfect classifier.
 */
import type { ApplyClassification } from "../../../shared/apply";

export interface ClassifyResult {
  classification: ApplyClassification;
  confidence: number; // 0..1, margin between the two class scores
  signals: { cv: string[]; jobPosting: string[] };
  suggested: { company: string; roleTitle: string };
}

// --- CV signal patterns -----------------------------------------------

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i;
const PHONE_RE = /(\+?\d[\d .()-]{7,}\d)/;

const CV_SECTION_HEADINGS: Array<{ label: string; re: RegExp }> = [
  { label: "section: Experience", re: /\b(experience|expérience)\b/i },
  { label: "section: Education", re: /\b(education|formation|études|etudes)\b/i },
  { label: "section: Skills", re: /\b(skills|compétences|competences)\b/i },
  { label: "section: Projects", re: /\b(projects|projets)\b/i },
  { label: "section: Languages", re: /\b(languages|langues)\b/i },
  { label: "section: Interests", re: /\b(interests|centres d'intérêt|centres d'interet)\b/i },
];
const CV_SECTION_HEADINGS_CAP = 4;

const PAST_TENSE_VERBS_RE = /\b(developed|built|led|conçu|développé|réalisé|géré)\b/i;

// A short line near the very top with 2-4 capitalized words and nothing
// else (no digits, no "@", no trailing punctuation beyond hyphen/
// apostrophe) — the shape of "Jane Doe" / "Jean-Pierre Martin" as a CV
// header line.
const NAME_LINE_RE = /^[A-ZÀ-Ý][a-zà-ÿ'-]+(\s+[A-ZÀ-Ý][a-zà-ÿ'-]+){1,3}$/;

// --- Job-posting signal patterns ---------------------------------------

const HIRING_PHRASES_RE =
  /(we are looking for|we're looking for|nous recherchons|vous serez|you will|profil recherché|responsibilities|missions|what you'll do|your role)/i;

const REQUIREMENTS_RE =
  /(required|requirements|requis|profil|must have|nice to have|qualifications|compétences requises)/i;

const EMPLOYMENT_TOKEN_RE =
  /\b(cdi|cdd|stage|alternance|internship|full[- ]time|part[- ]time|h\/f|f\/h)\b/i;

const APPLY_CTA_RE = /(apply now|postuler|envoyez votre cv|how to apply)/i;

// "Company voice" — counted (density), not just presence.
const COMPANY_VOICE_RE = /\b(we|our team|notre équipe|rejoignez)\b/gi;
const COMPANY_VOICE_MIN_HITS = 3;

// --- Decision thresholds ----------------------------------------

const AMBIGUOUS_CONFIDENCE_THRESHOLD = 0.34;
const AMBIGUOUS_TOTAL_THRESHOLD = 2;

// --- Best-effort field pre-fill (never authoritative; the user confirms/
// edits before any write) ---------

const ROLE_TITLE_KEYWORDS_RE =
  /(développeur|developpeur|developer|engineer|ingénieur|ingenieur|stagiaire|intern(ship)?|alternant|analyst|manager|consultant|designer)/i;
const COMPANY_LABEL_RE = /\b(?:chez|at|entreprise\s*:|company\s*:)\s*([A-Z][\w&.'\- ]{1,60})/;

export function classify(text: string): ClassifyResult {
  const cvSignals: string[] = [];
  const jdSignals: string[] = [];
  let cvScore = 0;
  let jdScore = 0;

  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const nonEmptyLines = lines.filter((l) => l.length > 0);
  const firstLinesBlock = lines.slice(0, 15).join("\n");

  // --- CV signals ---
  if (EMAIL_RE.test(firstLinesBlock) && PHONE_RE.test(firstLinesBlock)) {
    cvScore += 2;
    cvSignals.push("email+phone header");
  }

  let headingHits = 0;
  for (const { label, re } of CV_SECTION_HEADINGS) {
    if (re.test(text)) {
      headingHits += 1;
      cvSignals.push(label);
    }
  }
  cvScore += Math.min(headingHits, CV_SECTION_HEADINGS_CAP);

  if (PAST_TENSE_VERBS_RE.test(text)) {
    cvScore += 1;
    cvSignals.push("past-tense action verbs");
  }

  if (nonEmptyLines.slice(0, 5).some((l) => l.length <= 40 && NAME_LINE_RE.test(l))) {
    cvScore += 1;
    cvSignals.push("name-shaped line near top");
  }

  // --- Job posting signals ---
  if (HIRING_PHRASES_RE.test(text)) {
    jdScore += 2;
    jdSignals.push("phrase: we are looking for / hiring language");
  }
  if (REQUIREMENTS_RE.test(text)) {
    jdScore += 1;
    jdSignals.push("phrase: requirements language");
  }
  if (EMPLOYMENT_TOKEN_RE.test(text)) {
    jdScore += 1;
    jdSignals.push("employment/contract token (CDI/CDD/stage/...)");
  }
  if (APPLY_CTA_RE.test(text)) {
    jdScore += 1;
    jdSignals.push("phrase: apply CTA");
  }
  const companyVoiceHits = (text.match(COMPANY_VOICE_RE) ?? []).length;
  if (companyVoiceHits >= COMPANY_VOICE_MIN_HITS) {
    jdScore += 1;
    jdSignals.push("company-voice density (we/our team/rejoignez)");
  }

  const total = cvScore + jdScore;
  let classification: ApplyClassification;
  let confidence: number;
  if (total === 0) {
    classification = "ambiguous";
    confidence = 0;
  } else {
    const winner: ApplyClassification = cvScore >= jdScore ? "cv" : "job_posting";
    confidence = Math.abs(cvScore - jdScore) / total;
    classification =
      confidence < AMBIGUOUS_CONFIDENCE_THRESHOLD || total < AMBIGUOUS_TOTAL_THRESHOLD
        ? "ambiguous"
        : winner;
  }

  return {
    classification,
    confidence,
    signals: { cv: cvSignals, jobPosting: jdSignals },
    suggested: suggestFields(nonEmptyLines, text),
  };
}

function suggestFields(
  nonEmptyLines: string[],
  text: string,
): { company: string; roleTitle: string } {
  let roleTitle = "";
  for (const line of nonEmptyLines.slice(0, 20)) {
    if (line.length < 100 && ROLE_TITLE_KEYWORDS_RE.test(line)) {
      roleTitle = line;
      break;
    }
  }
  let company = "";
  const m = COMPANY_LABEL_RE.exec(text);
  if (m) company = m[1].trim();
  return { company, roleTitle };
}
