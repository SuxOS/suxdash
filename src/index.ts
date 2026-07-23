import { verifyAccess } from "./access";
import { SHELL_HTML } from "./shell";
import { cached } from "./cache";
import { githubFabricSeam, fabricPanel } from "./fabric";
import {
  planDispatchIssue,
  executeDispatchIssue,
  githubIssueSeam,
  type DispatchIssueInput,
} from "./actions/dispatch-issue";

export interface Env {
  CACHE: KVNamespace;
  OPERATOR_EMAIL: string;
  GITHUB_ORG: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  GITHUB_TOKEN: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/healthz") {
      return new Response("suxdash ok", { status: 200 });
    }
    const auth = await verifyAccess(req, env);
    if (!auth) return new Response("forbidden", { status: 403 });

    if (url.pathname === "/") {
      return new Response(SHELL_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    if (url.pathname === "/api/fabric") {
      try {
        const { value, staleAt } = await cached(env.CACHE, "fabric:panel", 60, async () => {
          const seam = githubFabricSeam(env.GITHUB_ORG, env.GITHUB_TOKEN);
          return (await fabricPanel(seam, 0)).items; // items only; staleAt from cache wrapper
        });
        const panel = {
          title: "Fabric",
          items: value,
          staleAt,
          actions: [{ verb: "dispatch-issue", label: "File issue", kind: "confirm" }],
        };
        return Response.json(panel);
      } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 502 });
      }
    }

    if (url.pathname === "/api/act/dispatch-issue" && req.method === "POST") {
      const input = (await req.json()) as DispatchIssueInput;
      if (url.searchParams.get("dry") === "1") {
        return Response.json(planDispatchIssue(input));
      }
      try {
        const seam = githubIssueSeam(env.GITHUB_ORG, env.GITHUB_TOKEN);
        const result = await executeDispatchIssue(input, seam);
        return Response.json(result, { status: result.ok ? 200 : 400 });
      } catch (err) {
        return Response.json({ ok: false, error: (err as Error).message }, { status: 502 });
      }
    }

    return new Response("not found", { status: 404 });
  },
};
