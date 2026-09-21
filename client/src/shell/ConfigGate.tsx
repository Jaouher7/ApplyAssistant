/** Unchanged in spirit from the pre-overhaul `ApplyAssistant.tsx`
 *  not-configured state — every data view is disabled and this renders
 *  instead when `GET /api/apply/status` reports `jobHuntConfigured:false`. */
export function ConfigGate() {
  return (
    <div className="empty-panel">
      <div className="title">Apply Assistant needs to be pointed at your job-hunt folder.</div>
      <div className="body">
        Set <code>JOB_HUNT_ROOT</code> in <code>.env</code> (copy <code>.env.example</code>) to your local{" "}
        <code>job-hunt\</code> project folder. Requires the <code>claude</code> CLI installed and logged in.
      </div>
    </div>
  );
}
