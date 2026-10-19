import { promises as fs } from "node:fs";
import { CV_FILES, cvPath } from "@/lib/cv";
import type { CvKind } from "@/lib/types";

// Serves the PDF straight from cv/ (or CV_DIR): update the CV there and the board opens the new one.
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (kind !== "quant" && kind !== "swe") return new Response("CV no encontrado", { status: 404 });
  try {
    const pdf = await fs.readFile(cvPath(kind as CvKind));
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="CV ${kind === "quant" ? "Quant" : "SWE"}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response(`No se encuentra ${CV_FILES[kind as CvKind]}`, { status: 404 });
  }
}
