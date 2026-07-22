import type { Panel, PanelItem } from "./panel";

export interface FabricSeam {
  openPrCount(): Promise<number>;
  openIssueCount(): Promise<number>;
  recentItems(): Promise<PanelItem[]>;
}

const GH = "https://api.github.com";

function ghHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "suxdash",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function searchCount(org: string, token: string, q: string): Promise<number> {
  const res = await fetch(
    `${GH}/search/issues?q=${encodeURIComponent(`org:${org} is:open ${q}`)}&per_page=1`,
    { headers: ghHeaders(token) },
  );
  if (!res.ok) throw new Error(`github search ${res.status}`);
  const body = (await res.json()) as { total_count: number };
  return body.total_count;
}

export function githubFabricSeam(org: string, token: string): FabricSeam {
  return {
    openPrCount: () => searchCount(org, token, "is:pr"),
    openIssueCount: () => searchCount(org, token, "is:issue"),
    recentItems: async () => {
      const res = await fetch(
        `${GH}/search/issues?q=${encodeURIComponent(`org:${org} is:open`)}&sort=updated&order=desc&per_page=8`,
        { headers: ghHeaders(token) },
      );
      if (!res.ok) throw new Error(`github search ${res.status}`);
      const body = (await res.json()) as {
        items: { id: number; title: string; html_url: string; pull_request?: unknown; repository_url: string }[];
      };
      return body.items.map((it) => ({
        id: String(it.id),
        title: it.title,
        subtitle: it.repository_url.split("/").pop(),
        url: it.html_url,
        badge: it.pull_request ? "PR" : "issue",
      }));
    },
  };
}

export async function fabricPanel(seam: FabricSeam, staleAt: number): Promise<Panel> {
  const [prs, issues, recent] = await Promise.all([
    seam.openPrCount(),
    seam.openIssueCount(),
    seam.recentItems(),
  ]);
  const summary: PanelItem = {
    id: "summary",
    title: `${prs} open PRs · ${issues} open issues`,
    badge: "org",
  };
  return {
    title: "Fabric",
    items: [summary, ...recent],
    staleAt,
    actions: [{ verb: "dispatch-issue", label: "File issue", kind: "confirm" }],
  };
}
