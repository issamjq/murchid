import { test, expect, type Page } from "@playwright/test";

// Parent updates, actually clicked.
//
// The product cannot email anyone, so the whole feature is "draft, edit,
// copy" — this proves the copy actually reaches the clipboard, that the
// template fallback fires on today's real 400, and that the local template
// quotes no raw marks (a bare score is meaningless to a parent, since
// assessments carry no max_score).

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
        {
          student: {
            id: STUDENT_ID,
            name: "Reem Al Dhaheri",
            roll_no: "9A-01",
            email: null,
            status: "active",
          },
        },
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
    if (url.includes("/rest/v1/parent_updates")) return json([]);
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

test.describe("parent updates on a class", () => {
  test("the header button reaches it, and it says the product doesn't email parents", async ({
    page,
  }) => {
    await teacher(page, 400, { error: "unrecognized feature", code: "bad_request" });
    await page.goto(`/classes/${CLASS_ID}`);
    await page.getByRole("link", { name: /parent updates/i }).click();

    await expect(page).toHaveURL(new RegExp(`/classes/${CLASS_ID}/parent-updates$`));
    await expect(page.getByText(/Murchid doesn't email parents/i)).toBeVisible();
    await expect(page.getByText("Reem Al Dhaheri")).toBeVisible();
    // No "Send" anywhere on this page — the whole point.
    await expect(page.getByRole("button", { name: /^send/i })).toHaveCount(0);
  });

  test("falls back to a template on today's real 400, and quotes no raw marks", async ({ page }) => {
    await teacher(page, 400, { error: "unrecognized feature", code: "bad_request" });
    await page.goto(`/classes/${CLASS_ID}/parent-updates`);
    await page.getByRole("button", { name: "Draft" }).click();

    const textarea = page.getByRole("textbox");
    await expect(textarea).toHaveValue(/attended 2 of 3 sessions/i, { timeout: 10_000 });
    await expect(page.getByText("Template")).toBeVisible();
    // The score (45) is meaningless to a parent without a max — never quoted.
    await expect(textarea).not.toHaveValue(/45/);
  });

  test("uses the AI response verbatim once the backend supports it", async ({ page }) => {
    await teacher(page, 200, {
      title: "Reem Al Dhaheri — parent update",
      content: "Reem has settled well into the forces unit.",
    });
    await page.goto(`/classes/${CLASS_ID}/parent-updates`);
    await page.getByRole("button", { name: "Draft" }).click();

    await expect(page.getByRole("textbox")).toHaveValue("Reem has settled well into the forces unit.", {
      timeout: 10_000,
    });
    await expect(page.getByText("Template")).toBeHidden();
  });

  test("Copy update puts the text on the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await teacher(page, 400, { error: "x", code: "bad_request" });
    await page.goto(`/classes/${CLASS_ID}/parent-updates`);

    await page.getByRole("textbox").fill("Reem is doing well this term.");
    await page.getByRole("button", { name: "Copy update" }).click();

    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe("Reem is doing well this term.");
  });

  test("Save writes the edited text, and Mark final sets status to approved", async ({ page }) => {
    const written = await teacher(page, 400, { error: "x", code: "bad_request" });
    await page.goto(`/classes/${CLASS_ID}/parent-updates`);

    await page.getByRole("textbox").fill("A hand-written update.");
    await page.getByRole("button", { name: "Save" }).click();

    await expect
      .poll(() => written.some((w) => w.url.includes("/rest/v1/parent_updates")))
      .toBe(true);
    const save = written.find((w) => w.url.includes("/rest/v1/parent_updates"));
    expect((save!.body as { update_text: string }).update_text).toBe("A hand-written update.");
    expect((save!.body as { status: string }).status).toBe("draft");

    await page.getByRole("button", { name: "Mark final" }).click();
    await expect(page.getByText("Approved")).toBeVisible();
  });
});
