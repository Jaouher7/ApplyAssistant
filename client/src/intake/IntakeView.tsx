import { useAssistant } from "../assistant/AssistantProvider";
import { PdfDropZone } from "./PdfDropZone";

/** Intake surface — the PDF drop zone, unchanged in behavior, restyled into
 *  its own rail view per the task brief ("keep the drop zone reachable...
 *  its own view/panel is fine"). Feeds a routed job posting's absolute
 *  path into the assistant's "Run pipeline" quick action. */
export function IntakeView() {
  const { configured, setJdPath } = useAssistant();
  return (
    <section className="view" id="v-intake">
      <div className="h">
        <h2>Intake</h2>
        <span className="sub">drop a job posting or CV PDF · classifies and routes it into job-hunt</span>
      </div>
      <PdfDropZone configured={configured} onJdWritten={(absPath) => setJdPath(absPath)} />
    </section>
  );
}
