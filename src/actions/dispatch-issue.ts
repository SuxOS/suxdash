export interface DispatchIssueInput {
  repo: string;
  title: string;
  body: string;
}
export interface Plan {
  summary: string;
  target: string;
}
export interface ActionResult {
  ok: boolean;
  url?: string;
  error?: string;
}
export interface GithubIssueSeam {
  createIssue(repo: string, title: string, body: string): Promise<{ url: string }>;
}

export function planDispatchIssue(input: DispatchIssueInput): Plan {
  return {
    summary: `File issue "${input.title}" on ${input.repo}`,
    target: input.repo,
  };
}

// GitHub repo names: alphanumeric, hyphen, underscore, dot — nothing that could act as a
// URL path segment (no `/`, no `..`). createIssue interpolates this straight into a REST
// URL (`repos/${org}/${repo}/issues`); an unvalidated value admits dot-segment escapes
// (e.g. `../other-org/other-repo`) out of the intended org scope. The negative lookahead
// also rejects values that are entirely dots (`.`, `..`, `...`), which the plain character
// class would otherwise let through as a bare dot-segment.
const REPO_NAME_RE = /^(?!\.+$)[A-Za-z0-9._-]+$/;

export async function executeDispatchIssue(
  input: DispatchIssueInput,
  seam: GithubIssueSeam,
): Promise<ActionResult> {
  const repo = input.repo.trim();
  const title = input.title.trim();
  const body = input.body.trim();
  if (!repo || !title) {
    return { ok: false, error: "repo and title are required" };
  }
  if (!REPO_NAME_RE.test(repo)) {
    return { ok: false, error: "repo must be a plain repository name (no slashes or path segments)" };
  }
  const { url } = await seam.createIssue(repo, title, body);
  return { ok: true, url };
}

export function githubIssueSeam(org: string, token: string): GithubIssueSeam {
  return {
    createIssue: async (repo, title, body) => {
      const res = await fetch(`https://api.github.com/repos/${org}/${repo}/issues`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "suxdash",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, body }),
      });
      if (!res.ok) throw new Error(`github create issue ${res.status}`);
      const created = (await res.json()) as { html_url: string };
      return { url: created.html_url };
    },
  };
}
