import { test, expect, type Page } from "@playwright/test";

// Report-card comments, actually clicked.
//
// "report_comment" is a brand-new feature value, so the current (real)
// backend rejects it with 400 — this proves the template fallback fires on
// that confirmed error, and separately that a real AI response is used
// verbatim once the backend ships it. No account and no network: PostgREST
// and the backend are stubbed, same pattern as tiered-worksheets.spec.ts.

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
const STUDENT_ID = "66666666-6666-6666-6666-666666666666";
const ASSESSMENT_ID = "77777777-7777-7777-7777-777777777777";

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

async function teacher(page: Page, generateStatus: number, generateBody: unknown) {
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
    const json = (d: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(wantsObject && Array.isArray(d) ? (d[0] ?? null) : d),
      });

    if (url.includes("/rest/v1/profiles")) return json([PROFILE]);
    if (url.includes("/rest/v1/classes")) return json([CLASS]);
    if (url.includes("/rest/v1/class_members")) {
      return json([
        { student: { id: STUDENT_ID, name: "Reem Al Dhaheri", roll_no: "9A-01", email: null, status: "active" } },
      ]);
    }
    if (url.includes("/rest/v1/assessments")) return json([{ id: ASSESSMENT_ID, title: "Unit test" }]);
    if (url.includes("/rest/v1/results")) {
      return json([{ student_id: STUDENT_ID, assessment_id: ASSESSMENT_ID, score: 45 }]);
    }
    if (url.includes("/rest/v1/attendance")) {
      return json([
        { student_id: STUDENT_ID, status: "present" },
        { student_id: STUDENT_ID, status: "present" },
        { student_id: STUDENT_ID, status: "late" },
      ]);
    }
    if (url.includes("/rest/v1/report_comments")) return json([]);
    return json([]);
  });

  await page.route("**/api/studio/generate", (route) =>
    route.fulfill({
      status: generateStatus,
      contentType: "application/json",
      body: JSON.stringify(generateBody),
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

test.describe("report-card comments on a class", () => {
  test("the header's Report comments button reaches it, alongside Sub plan", async ({ page }) => {
    await teacher(page, 400, { error: "unrecognized feature", code: "bad_request" });
    await page.goto(`/classes/${CLASS_ID}`);
    await expect(page.getByRole("link", { name: /sub plan/i })).toBeVisible();
    await page.getByRole("link", { name: /report comments/i }).click();
    await expect(page).toHaveURL(new RegExp(`/classes/${CLASS_ID}/report-comments$`));
    await expect(page.getByText("Reem Al Dhaheri")).toBeVisible();
    await expect(page.getByText("Unit test: 45")).toBeVisible();
    await expect(page.getByText(/2\/3 present, 1 late/)).toBeVisible();
  });

  test("falls back to a template on today's real 400, tagged so the teacher knows", async ({ page }) => {
    await teacher(page, 400, { error: "unrecognized feature", code: "bad_request" });
    await page.goto(`/classes/${CLASS_ID}/report-comments`);
    await page.getByRole("button", { name: "Draft" }).click();

    const textarea = page.getByRole("textbox");
    await expect(textarea).toHaveValue(/Reem Al Dhaheri scored 45 on Unit test/, { timeout: 10_000 });
    await expect(page.getByText("Template")).toBeVisible();
  });

  test("uses the AI response verbatim once the backend supports it", async ({ page }) => {
    await teacher(page, 200, {
      title: "Reem Al Dhaheri — report comment",
      content: "Reem has shown strong understanding of the unit test material.",
    });
    await page.goto(`/classes/${CLASS_ID}/report-comments`);
    await page.getByRole("button", { name: "Draft" }).click();

    const textarea = page.getByRole("textbox");
    await expect(textarea).toHaveValue("Reem has shown strong understanding of the unit test material.", {
      timeout: 10_000,
    });
    await expect(page.getByText("Template")).toBeHidden();
  });

  test("Save writes the edited text, and Mark final sets status to approved", async ({ page }) => {
    const written = await teacher(page, 400, { error: "x", code: "bad_request" });
    await page.goto(`/classes/${CLASS_ID}/report-comments`);

    const textarea = page.getByRole("textbox");
    await textarea.fill("A hand-written comment.");
    await page.getByRole("button", { name: "Save" }).click();

    await expect
      .poll(() => written.some((w) => w.url.includes("/rest/v1/report_comments")))
      .toBe(true);
    const save = written.find((w) => w.url.includes("/rest/v1/report_comments"));
    expect((save!.body as { comment_text: string }).comment_text).toBe("A hand-written comment.");
    expect((save!.body as { status: string }).status).toBe("draft");

    await page.getByRole("button", { name: "Mark final" }).click();
    await expect(page.getByText("Approved")).toBeVisible();
  });
});
