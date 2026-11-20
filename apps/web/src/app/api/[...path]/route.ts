import { handleApi } from "@/server/api";
import { nodeState } from "@/server/node-state";

/**
 * All of /api, served in-process when the app runs on Node (local, Docker). On Cloudflare the
 * worker sends /api to a Durable Object before Next.js sees it (see worker.ts).
 */
export const dynamic = "force-dynamic";

const handler = (req: Request) => handleApi(req, nodeState());

export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
