import type { Invoice } from "@/types";

export function ApprovalTimeline({ invoice }: { invoice: Invoice }) {
  const ws = invoice.workflowState;
  if (!ws || !ws.stepResults || ws.stepResults.length === 0) {
    if (invoice.approval?.approvedAt) {
      return (
        <div className="approval-timeline">
          <div className="approval-timeline-step">
            <span className="approval-timeline-dot approval-timeline-dot-done">✓</span>
            <div className="approval-timeline-content">
              <strong>Approved</strong>
              <small>
                {invoice.approval.email ?? invoice.approval.approvedBy ?? "Unknown"}
                {" — "}
                {new Date(invoice.approval.approvedAt).toLocaleString()}
              </small>
            </div>
          </div>
        </div>
      );
    }
    return null;
  }

  const maxStep = Math.max(...ws.stepResults.map((r) => r.step), ws.currentStep ?? 0);
  const steps: Array<{ step: number; name: string; status: "done" | "current" | "pending" | "rejected" | "skipped"; detail?: string }> = [];

  for (let i = 1; i <= maxStep; i++) {
    const results = ws.stepResults.filter((r) => r.step === i);
    const lastResult = results[results.length - 1];

    if (lastResult?.action === "skipped") {
      steps.push({ step: i, name: lastResult.name, status: "skipped", detail: "Skipped — condition not met" });
    } else if (lastResult?.action === "rejected") {
      steps.push({
        step: i,
        name: lastResult.name,
        status: "rejected",
        detail: `Rejected by ${lastResult.email ?? "unknown"}${lastResult.note ? `: ${lastResult.note}` : ""}`
      });
    } else if (lastResult?.action === "approved") {
      if ((ws.currentStep && ws.currentStep > i) || ws.status === "approved") {
        const approvers = results.filter((r) => r.action === "approved").map((r) => r.email ?? "unknown");
        steps.push({
          step: i,
          name: lastResult.name,
          status: "done",
          detail: `${approvers.join(", ")} — ${new Date(lastResult.timestamp).toLocaleString()}`
        });
      } else {
        const approvedCount = results.filter((r) => r.action === "approved").length;
        steps.push({
          step: i,
          name: lastResult.name,
          status: "current",
          detail: `${approvedCount} approved so far`
        });
      }
    } else if (ws.currentStep === i) {
      steps.push({ step: i, name: `Step ${i}`, status: "current", detail: "Waiting for approval" });
    } else {
      steps.push({ step: i, name: `Step ${i}`, status: "pending" });
    }
  }

  if (ws.currentStep && ws.currentStep > maxStep) {
    steps.push({ step: ws.currentStep, name: `Step ${ws.currentStep}`, status: "current", detail: "Waiting for approval" });
  }

  return (
    <div className="approval-timeline">
      {steps.map((s) => (
        <div key={s.step} className="approval-timeline-step">
          <span className={`approval-timeline-dot approval-timeline-dot-${s.status === "skipped" ? "done" : s.status}`}>
            {s.status === "done" || s.status === "skipped" ? "✓" : s.status === "rejected" ? "✗" : s.status === "current" ? "●" : "○"}
          </span>
          <div className="approval-timeline-content">
            <strong>{s.name}</strong>
            {s.detail ? <small>{s.detail}</small> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
