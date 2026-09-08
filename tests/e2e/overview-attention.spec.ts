import { test, expect, type Page } from "@playwright/test";

// Needs-your-attention digest, actually clicked.
//
// Confirms the Overview page renders the new card from the three read-only
// views (assessment_progress, class_attendance_freshness, goal_item_details)
// and that each row's link lands on the right class tab. No account and no
// network: PostgREST is stubbed, same pattern as class-materials.spec.ts.

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
const ASSESSMENT_ID = "88888888-8888-8888-8888-888888888888";
const GOAL_ITEM_ID = "99999999-9999-9999-9999-999999999999";
const FAILED_GOAL_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

type Written = { method: string; url: string };

async function teacher(
  page: Page,
  views: {
    attendance?: unknown[];
    progress?: unknown[];
    goalItems?: unknown[];
    failedGoals?: unknown[];
  } = {},
) {
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
    if (method !== "GET") written.push({ method, url });

    // PostgREST returns a single OBJECT, not a one-element array, when the
    // client asks for one via .single()'s Accept header — the profile
    // fetch in session-context.tsx does this. Returning an array here
    // would silently make `profile.role`/`profile.institution` undefined.
    const wantsObject = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
    const json = (data: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(
          wantsObject && Array.isArray(data) ? (data[0] ?? null) : data,
        ),
      });

    if (url.includes("/rest/v1/profiles")) return json([PROFILE]);
    if (url.includes("/rest/v1/class_attendance_freshness")) return json(views.attendance ?? []);
    if (url.includes("/rest/v1/assessment_progress")) return json(views.progress ?? []);
    if (url.includes("/rest/v1/goal_item_details")) return json(views.goalItems ?? []);
    if (url.includes("/rest/v1/goals") && url.includes("status=eq.failed")) {
      return json(views.failedGoals ?? []);
    }
    // Every other Overview-page query (classes/students/goals/results/attendance/goal_items counts)
    return json([]);
  });

  // supabase-js reads the session from localStorage under
  // sb-<project-ref>-auth-token; the ref is inlined into the bundle and not
  // readable from here, so answer for any key of that shape.
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

test.describe("the Overview needs-attention digest", () => {
  test("shows one row per category and links to the right class tab", async ({ page }) => {
    await teacher(page, {
      attendance: [
        {
          class_id: CLASS_ID,
          subject: "Physics",
          last_marked: "2020-01-01",
        },
      ],
      progress: [
        {
          assessment_id: ASSESSMENT_ID,
          class_id: CLASS_ID,
          title: "Unit test",
          subject: "Physics",
          scheduled_for: "2020-01-01",
          roster_count: 18,
          graded_count: 3,
        },
      ],
      goalItems: [
        {
          id: GOAL_ITEM_ID,
          class_id: CLASS_ID,
          kind: "homework",
          title: "Forces worksheet",
          subject: "Physics",
          updated_at: "2020-01-01",
        },
      ],
      failedGoals: [{ id: FAILED_GOAL_ID, title: "Term plan", updated_at: "2020-01-01" }],
    });

    await page.goto("/overview");
    await expect(page.getByRole("heading", { name: "Needs your attention" })).toBeVisible();

    const staleRow = page.getByRole("link", { name: /Physics.*Not marked in/s });
    await expect(staleRow).toBeVisible();
    await expect(staleRow).toHaveAttribute("href", `/classes/${CLASS_ID}/attendance`);

    const ungradedRow = page.getByRole("link", { name: /Unit test/ });
    await expect(ungradedRow).toBeVisible();
    await expect(ungradedRow).toContainText("3 of 18 graded");
    await expect(ungradedRow).toHaveAttribute("href", `/classes/${CLASS_ID}/results`);

    const failedRow = page.getByRole("link", { name: /Term plan/ });
    await expect(failedRow).toBeVisible();
    await expect(failedRow).toHaveAttribute("href", "/goal-planner");

    const unscheduledRow = page.getByRole("link", { name: /Forces worksheet/ });
    await expect(unscheduledRow).toBeVisible();
    await expect(unscheduledRow).toHaveAttribute("href", `/classes/${CLASS_ID}/homework`);
  });

  test("shows an all-caught-up empty state when nothing needs attention", async ({ page }) => {
    await teacher(page);
    await page.goto("/overview");

    await expect(page.getByRole("heading", { name: "Needs your attention" })).toBeVisible();
    await expect(page.getByText("All caught up")).toBeVisible();
  });
});
