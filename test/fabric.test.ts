import { describe, it, expect } from "vitest";
import { fabricPanel, type FabricSeam } from "../src/fabric";

const seam: FabricSeam = {
  openPrCount: async () => 4,
  openIssueCount: async () => 7,
  recentItems: async () => [
    { id: "pr-1", title: "Fix flaky auth test", url: "https://x/pr/1", badge: "PR" },
  ],
};

describe("fabricPanel", () => {
  it("builds a Fabric panel with count summary, recent items, and a dispatch action", async () => {
    const panel = await fabricPanel(seam, 123);
    expect(panel.title).toBe("Fabric");
    expect(panel.staleAt).toBe(123);
    expect(panel.actions).toEqual([
      { verb: "dispatch-issue", label: "File issue", kind: "confirm" },
    ]);
    // first item summarizes open counts
    expect(panel.items[0].title).toContain("4");
    expect(panel.items[0].title).toContain("7");
    // recent items are appended
    expect(panel.items.some((i) => i.id === "pr-1")).toBe(true);
  });
});
