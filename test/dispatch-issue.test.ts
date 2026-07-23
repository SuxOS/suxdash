import { describe, it, expect, vi } from "vitest";
import {
  planDispatchIssue,
  executeDispatchIssue,
  type GithubIssueSeam,
} from "../src/actions/dispatch-issue";

describe("planDispatchIssue", () => {
  it("produces a preview plan without mutating anything", () => {
    const plan = planDispatchIssue({ repo: "sux", title: "Add X", body: "why" });
    expect(plan.target).toBe("sux");
    expect(plan.summary).toContain("Add X");
  });
});

describe("executeDispatchIssue", () => {
  it("creates the issue exactly once and returns its url", async () => {
    const seam: GithubIssueSeam = {
      createIssue: vi.fn(async () => ({ url: "https://x/issues/9" })),
    };
    const res = await executeDispatchIssue({ repo: "sux", title: "Add X", body: "why" }, seam);
    expect(res).toEqual({ ok: true, url: "https://x/issues/9" });
    expect(seam.createIssue).toHaveBeenCalledTimes(1);
    expect(seam.createIssue).toHaveBeenCalledWith("sux", "Add X", "why");
  });

  it("rejects an empty title without calling the seam", async () => {
    const seam: GithubIssueSeam = { createIssue: vi.fn() };
    const res = await executeDispatchIssue({ repo: "sux", title: "", body: "" }, seam);
    expect(res.ok).toBe(false);
    expect(seam.createIssue).not.toHaveBeenCalled();
  });

  it("rejects a repo value carrying a path segment (org-scope escape) without calling the seam", async () => {
    const seam: GithubIssueSeam = { createIssue: vi.fn() };
    const res = await executeDispatchIssue(
      { repo: "../other-org/other-repo", title: "Add X", body: "why" },
      seam,
    );
    expect(res.ok).toBe(false);
    expect(seam.createIssue).not.toHaveBeenCalled();
  });

  it("rejects a repo value carrying a bare slash without calling the seam", async () => {
    const seam: GithubIssueSeam = { createIssue: vi.fn() };
    const res = await executeDispatchIssue({ repo: "sux/extra", title: "Add X", body: "why" }, seam);
    expect(res.ok).toBe(false);
    expect(seam.createIssue).not.toHaveBeenCalled();
  });
});
