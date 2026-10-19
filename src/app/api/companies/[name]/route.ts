import { getCompany } from "@/lib/db";
import { checkCompanyPolicy } from "@/lib/crawler/policyCheck";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const company = await getCompany(decodeURIComponent(name));
  if (!company) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(company);
}

/** Checks the company's application rules now (reads its postings). */
export async function POST(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  try {
    const policy = await checkCompanyPolicy(decodeURIComponent(name));
    return Response.json(policy);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
