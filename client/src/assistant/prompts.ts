/** Anchored-prompt builders — unchanged in spirit from the pre-overhaul
 *  `ApplyChat.tsx` (moved here since AssistantProvider, not a single
 *  component, now owns quick actions). Always states the absolute
 *  JOB_HUNT_ROOT explicitly so every relative path a workflow/skill step
 *  uses resolves against job-hunt\, not the CLI turn's actual cwd. */

const PIPELINE_WORKFLOW = "job-application-pipeline";

function anchoredRoot(root: string): string {
  if (!root) return "";
  return root.endsWith("\\") ? root : `${root}\\`;
}

export function buildPipelinePrompt(root: string, jdAbsPath: string): string {
  const anchored = anchoredRoot(root);
  return (
    `Use the workflow-runner skill to run the "${PIPELINE_WORKFLOW}" workflow. ` +
    `The project root for every relative path used anywhere in this workflow's steps ` +
    `(jobs\\incoming\\, applications\\, profile\\, scripts\\, outbox\\, tracker.csv) is ` +
    `${anchored} — resolve every such path against that absolute root, not your current ` +
    `working directory. Input job description file: ${jdAbsPath}`
  );
}

export function buildScoutPrompt(root: string): string {
  const anchored = anchoredRoot(root);
  return (
    `Use the job-scout skill to sweep public job boards for offers posted within the last ` +
    `7 days matching the profile, score them, and write the ranked shortlist. The project ` +
    `root for every relative path used anywhere in this skill (profile\\, scout\\, ` +
    `jobs\\incoming\\, tracker.csv) is ${anchored} — resolve every such path against that ` +
    `absolute root, not your current working directory. Never fetch or search LinkedIn.`
  );
}

export function buildFollowUpPrompt(root: string, company: string, folder: string): string {
  const anchored = anchoredRoot(root);
  return (
    `Draft a brief follow-up note (do not send anything) for the application to ${company} ` +
    `at applications\\${folder}\\ — the project root for every relative path is ${anchored}. ` +
    `Write it as a new file under applications\\${folder}\\outreach\\ following the existing ` +
    `draft files' format and add it to outbox\\manifest.md, exactly as the existing outreach ` +
    `drafting step of the job-application-pipeline workflow does.`
  );
}
