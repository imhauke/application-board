import BoardApp from "@/components/BoardApp";
import { buildBoardData } from "@/lib/board";
import { loadCvs } from "@/lib/cv";
import { readDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [db, cvs] = await Promise.all([readDb({ board: "global" }), loadCvs()]);
  return <BoardApp data={buildBoardData(db, cvs, "global")} />;
}
