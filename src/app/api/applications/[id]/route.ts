import { getCompany, NotFoundError, updateTracking, ValidationError } from "@/lib/db";
import { checkCompanyPolicy, policyIsFresh } from "@/lib/crawler/policyCheck";
import type { TrackingPatch } from "@/lib/types";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: TrackingPatch;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const update = await updateTracking(id, body);
    let policyCheck: "started" | "known" | null = null;
    if (update.justApplied) {
      // React to the application: read the company's rules unless we already know them
      const company = await getCompany(update.company);
      if (policyIsFresh(company?.policy)) policyCheck = "known";
      else {
        checkCompanyPolicy(update.company, id).catch(() => {});
        policyCheck = "started";
      }
    }
    return Response.json({ tracking: update.tracking, company: update.company, policyCheck });
  } catch (e) {
    if (e instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    if (e instanceof ValidationError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
