import { test, expect, type Page } from "@playwright/test";

// Substitute plan, actually clicked.
//
// Confirms the class header's "Sub plan" button reaches a page that shows
// the roster and whatever is scheduled that day, that changing the date
// re-fetches, and that an empty day still shows the roster rather than a
// dead end. No account and no network: PostgREST is stubbed, same pattern
// as class-materials.spec.ts / overview-attention.spec.ts.

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
const GOAL_ITEM_ID = "44444444-4444-4444-4444-444444444444";
const ASSESSMENT_ID = "55555555-5555-5555-5555-555555555555";
const STUDENT_ID = "66666666-6666-6666-6666-666666666666";
const TODAY = new Date().toISOString().slice(0, 10);

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

async function teacher(
  page: Page,
  data: {
    goalItems?: unknown[];
    assessments?: unknown[];
    students?: unknown[];
  } = {},
) {
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

    const wantsObject = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
    const json = (d: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(wantsObject && Array.isArray(d) ? (d[0] ?? null) : d),
      });

    if (url.includes("/rest/v1/profiles")) return json([PROFILE]);
    if (url.includes("/rest/v1/classes")) return json([CLASS]);
    if (url.includes("/rest/v1/goal_items")) return json(data.goalItems ?? []);
    if (url.includes("/rest/v1/goals")) return json([{ id: GOAL_ID }]);
    if (url.includes("/rest/v1/assessments")) return json(data.assessments ?? []);
    if (url.includes("/rest/v1/class_members")) return json(data.students ?? []);
    return json([]);
  });

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
}

test.describe("the class sub-plan page", () => {
  test("the class header's Sub plan button reaches it", async ({ page }) => {
    await teacher(page);
    await page.goto(`/classes/${CLASS_ID}`);
    await page.getByRole("link", { name: /sub plan/i }).click();
    await expect(page).toHaveURL(new RegExp(`/classes/${CLASS_ID}/sub-plan$`));
    await expect(page.getByRole("heading", { name: "Substitute plan" })).toBeVisible();
  });

  test("shows the roster and today's scheduled items", async ({ page }) => {
    await teacher(page, {
      students: [
        { student: { id: STUDENT_ID, name: "Reem Al Dhaheri", roll_no: "9A-01", email: null, status: "active" } },
      ],
      goalItems: [
        {
          id: GOAL_ITEM_ID,
          kind: "homework",
          title: "Forces worksheet",
          content: { markdown: "Answer questions 1-5." },
        },
      ],
      assessments: [
        {
          id: ASSESSMENT_ID,
          kind: "quiz",
          title: "Pop quiz",
          content: { markdown: "Q1. Newton's first law?" },
        },
      ],
    });

    await page.goto(`/classes/${CLASS_ID}/sub-plan`);

    await expect(page.getByText("Reem Al Dhaheri")).toBeVisible();
    await expect(page.getByText("9A-01")).toBeVisible();
    await expect(page.getByText("Forces worksheet")).toBeVisible();
    await expect(page.getByText("Answer questions 1-5.")).toBeVisible();
    await expect(page.getByText("Pop quiz")).toBeVisible();

    // Homework (kind order 3) renders before the quiz (kind order 6).
    const titles = page.locator("p.text-sm.font-semibold");
    await expect(titles.first()).toHaveText("Forces worksheet");
  });

  test("shows an empty state but keeps the roster when nothing is scheduled", async ({ page }) => {
    await teacher(page, {
      students: [
        { student: { id: STUDENT_ID, name: "Reem Al Dhaheri", roll_no: "9A-01", email: null, status: "active" } },
      ],
    });
    await page.goto(`/classes/${CLASS_ID}/sub-plan`);

    await expect(page.getByText("Reem Al Dhaheri")).toBeVisible();
    await expect(page.getByText(`Nothing scheduled for ${TODAY}`)).toBeVisible();
  });

  test("changing the date re-fetches scheduled items", async ({ page }) => {
    let requestedDates: string[] = [];
    await teacher(page);
    await page.route("**/rest/v1/goal_items*", (route) => {
      requestedDates.push(new URL(route.request().url()).searchParams.get("scheduled_for") ?? "");
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });

    await page.goto(`/classes/${CLASS_ID}/sub-plan`);
    await expect(page.getByText(`Nothing scheduled for ${TODAY}`)).toBeVisible();

    await page.getByLabel("Date").fill("2026-09-15");
    await expect(page.getByText("Nothing scheduled for 2026-09-15")).toBeVisible();
    expect(requestedDates.some((d) => d.includes("2026-09-15"))).toBe(true);
  });
});
