import { test, expect, type Page } from "@playwright/test";

// Differentiated worksheets, actually clicked.
//
// additionalTiers is live on the backend now, so the `additional` case is
// the everyday path and the missing-key case is the safety net — kept
// because an older deployment behind the proxy would land there, and a
// teacher who checked a tier box deserves an honest notice rather than a
// silent no-op. No account and no network: PostgREST and the backend are
// stubbed, same pattern as class-materials.spec.ts.

const USER = {
  id: "00000000-0000-0000-0000-0000000000aa",
  aud: "authenticated",
  role: "authenticated",
  email: "teacher@example.test",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

const PROFILE = {
  role: "teacher",
  status: "active",
  name: "Test Teacher",
  email: "teacher@example.test",
  institution: "Test School",
  staff_id: "T-1",
  syllabus: "CBSE",
};

const CLASS_ID = "22222222-2222-2222-2222-222222222222";
const GOAL_ID = "33333333-3333-3333-3333-333333333333";

const CLASS = {
  id: CLASS_ID,
  subject: "Physics",
  division_id: "11111111-1111-1111-1111-111111111111",
  division: {
    id: "11111111-1111-1111-1111-111111111111",
    label: "A",
    grade: { id: "g1", level: 9, batch: { id: "b1", label: "2026-2027" } },
  },
};

type Written = { method: string; url: string; body: unknown };

async function teacher(page: Page, generateResponse: unknown) {
  const written: Written[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") console.log("CONSOLE ERROR:", m.text());
  });
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));

  await page.route("**/auth/v1/**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) }),
  );

  await page.route("**/rest/v1/**", async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    let body: unknown = null;
    try {
      body = req.postDataJSON();
    } catch {
      /* GET, or not JSON */
    }
    if (method !== "GET") written.push({ method, url, body });

    const wantsObject = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
    const json = (d: unknown, extraHeaders: Record<string, string> = {}) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "Access-Control-Allow-Origin": "*",
          // Content-Range isn't in the browser's default-exposed response
          // header safelist for a cross-origin fetch, so hasReferenceMaterial's
          // count query silently sees it as null without this.
          "Access-Control-Expose-Headers": "*",
          ...extraHeaders,
        },
        body: JSON.stringify(wantsObject && Array.isArray(d) ? (d[0] ?? null) : d),
      });

    if (url.includes("/rest/v1/profiles")) return json([PROFILE]);
    if (url.includes("/rest/v1/classes")) return json([CLASS]);
    // hasReferenceMaterial's count query — a positive Content-Range means
    // "materials attached", which is what enables the composer at all.
    if (url.includes("/rest/v1/class_materials")) return json([], { "Content-Range": "*/1" });
    if (url.includes("/rest/v1/goals")) {
      if (method === "POST") return json({ id: GOAL_ID });
      return json([{ id: GOAL_ID }]);
    }
    if (url.includes("/rest/v1/goal_items")) return json([]);
    return json([]);
  });

  await page.route("**/api/studio/generate", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(generateResponse),
    }),
  );

  await page.addInitScript((user) => {
    const session = JSON.stringify({
      access_token: "test-token",
      refresh_token: "test-refresh",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user,
    });
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key: string) {
      return /^sb-.+-auth-token$/.test(key) ? session : original.call(this, key);
    };
  }, USER);

  return written;
}

async function generate(page: Page) {
  await page.goto(`/classes/${CLASS_ID}/homework`);
  await expect(page.getByText("Also generate:")).toBeVisible();
  await page.getByRole("button", { name: "Simplified" }).click();
  await page.getByRole("button", { name: "Challenge" }).click();
  await page.getByPlaceholder(/worksheet/i).fill("Cellular respiration stages");
  await page.getByRole("button", { name: "Create" }).click();
}

test.describe("differentiated worksheets on the Homework composer", () => {
  test("degrades cleanly against today's real backend response (no additional key)", async ({
    page,
  }) => {
    const written = await teacher(page, {
      title: "Cellular Respiration",
      content: "## Objectives\n…",
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    await generate(page);

    await expect(
      page.getByText(/Differentiated versions aren't available yet/i),
    ).toBeVisible({ timeout: 10_000 });

    const insert = written.find(
      (w) => w.method === "POST" && w.url.includes("/rest/v1/goal_items"),
    );
    expect(insert, "one goal_item is still written for the standard version").toBeTruthy();
    const rows = insert!.body as { tier: string | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].tier).toBeNull();
  });

  test("creates a sibling goal_item per tier once the backend returns `additional`", async ({
    page,
  }) => {
    const written = await teacher(page, {
      title: "Cellular Respiration",
      content: "## Objectives\n…",
      additional: {
        support: { title: "Cellular Respiration — Simplified", content: "…easier…" },
        extend: { title: "Cellular Respiration — Challenge", content: "…harder…" },
      },
    });

    await generate(page);

    await expect
      .poll(() => written.some((w) => w.method === "POST" && w.url.includes("/rest/v1/goal_items")))
      .toBe(true);
    await expect(
      page.getByText(/Differentiated versions aren't available yet/i),
    ).toBeHidden();

    const insert = written.find(
      (w) => w.method === "POST" && w.url.includes("/rest/v1/goal_items"),
    );
    expect(insert).toBeTruthy();
    const rows = insert!.body as { tier: string | null; title: string }[];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.tier).sort()).toEqual([null, "extend", "support"].sort());
  });

  test("every other composer (e.g. Notes) shows no tier UI", async ({ page }) => {
    await teacher(page, { title: "t", content: "c" });
    await page.goto(`/classes/${CLASS_ID}/notes`);
    await expect(page.getByText("Also generate:")).toBeHidden();
  });
});
