import { test, expect, type Page } from "@playwright/test";

// Grounded sources, actually clicked.
//
// The backend names the documents a draft was written from, and that list
// is the only one shown — an earlier client-side guess was retired after it
// measured wrong six to one against real data. So: the backend's list is
// used verbatim, nothing is claimed when it sends none, and a saved draft
// still shows its sources when reopened.

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
const READABLE_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const UNREAD_ID = "aaaaaaaa-0000-0000-0000-000000000002";
const EXAM_ID = "bbbbbbbb-0000-0000-0000-000000000001";

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

// One material with real extracted text, one uploaded file that was never
// read — the backend grounds on the first and reports the second as unread.
const CLASS_MATERIALS = [
  {
    material: {
      id: READABLE_ID,
      title: "Grade 9 Physics syllabus",
      kind: "note",
      body_md: "Unit 1: Forces and Motion",
      created_at: "2026-09-01T00:00:00Z",
      owner_id: USER.id,
      is_shared: false,
      storage_path: null,
    },
  },
  {
    material: {
      id: UNREAD_ID,
      title: "Scanned textbook.pdf",
      kind: "other",
      body_md: null,
      created_at: "2026-09-01T00:00:00Z",
      owner_id: USER.id,
      is_shared: false,
      storage_path: "some/path.pdf",
    },
  },
];

type Written = { method: string; url: string; body: unknown };

async function teacher(
  page: Page,
  opts: { generateResponse?: unknown; savedExams?: unknown[] } = {},
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
          "Access-Control-Expose-Headers": "*",
          ...extraHeaders,
        },
        body: JSON.stringify(wantsObject && Array.isArray(d) ? (d[0] ?? null) : d),
      });

    if (url.includes("/rest/v1/profiles")) return json([PROFILE]);
    if (url.includes("/rest/v1/classes")) return json([CLASS]);
    // Serves both hasReferenceMaterial's count query and listMaterialsForClass.
    if (url.includes("/rest/v1/class_materials")) {
      return json(CLASS_MATERIALS, { "Content-Range": "*/2" });
    }
    if (url.includes("/rest/v1/assessments")) {
      return json(method === "GET" ? (opts.savedExams ?? []) : { id: EXAM_ID });
    }
    return json([]);
  });

  await page.route("**/api/studio/generate", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(opts.generateResponse ?? { title: "Forces exam", content: "Q1…" }),
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

async function generateExam(page: Page) {
  await page.goto(`/classes/${CLASS_ID}/exams`);
  await page.getByRole("textbox").fill("End of unit exam on forces");
  await page.getByRole("button", { name: "Create" }).click();
}

test.describe("grounded sources on a generated draft", () => {
  test("claims no sources at all when the backend names none", async ({ page }) => {
    const written = await teacher(page, {
      generateResponse: { title: "Forces exam", content: "Q1…" },
    });
    await generateExam(page);

    await expect
      .poll(() => written.some((w) => w.method === "POST" && w.url.includes("/rest/v1/assessments")))
      .toBe(true);
    const insert = written.find(
      (w) => w.method === "POST" && w.url.includes("/rest/v1/assessments"),
    );
    const content = (insert!.body as { content: { markdown: string; groundedOn?: unknown[] } })
      .content;
    expect(content.markdown).toBe("Q1…");
    // This used to guess from the attached materials. Measured against real
    // data that guess was wrong six to one — it named studio-generated
    // drafts the backend deliberately withholds. Saying nothing beats
    // confidently naming documents a draft wasn't written from.
    expect(content.groundedOn).toBeUndefined();
  });

  test("uses the backend's grounded_on list verbatim", async ({ page }) => {
    const written = await teacher(page, {
      generateResponse: {
        title: "Forces exam",
        content: "Q1…",
        // Deliberately narrower than what the client would have guessed —
        // e.g. the prompt-budget cap dropped the syllabus.
        grounded_on: [{ id: UNREAD_ID, title: "Scanned textbook.pdf" }],
      },
    });
    await generateExam(page);

    await expect
      .poll(() => written.some((w) => w.method === "POST" && w.url.includes("/rest/v1/assessments")))
      .toBe(true);
    const insert = written.find(
      (w) => w.method === "POST" && w.url.includes("/rest/v1/assessments"),
    );
    const content = (insert!.body as { content: { groundedOn?: { id: string }[] } }).content;
    expect(content.groundedOn).toHaveLength(1);
    expect(content.groundedOn![0].id).toBe(UNREAD_ID);
  });

  test("shows the sources when a saved draft is reopened", async ({ page }) => {
    await teacher(page, {
      savedExams: [
        {
          id: EXAM_ID,
          kind: "exam",
          title: "Forces exam",
          status: "draft",
          scheduled_for: null,
          created_at: "2026-09-01T00:00:00Z",
          content: {
            markdown: "Q1…",
            groundedOn: [{ id: READABLE_ID, title: "Grade 9 Physics syllabus" }],
          },
        },
      ],
    });
    await page.goto(`/classes/${CLASS_ID}/exams`);
    await page.getByRole("button", { name: "Review" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Grounded in")).toBeVisible();
    await expect(dialog.getByText("Grade 9 Physics syllabus")).toBeVisible();
  });

  test("shows no sources section on a draft that has none", async ({ page }) => {
    await teacher(page, {
      savedExams: [
        {
          id: EXAM_ID,
          kind: "exam",
          title: "Forces exam",
          status: "draft",
          scheduled_for: null,
          created_at: "2026-09-01T00:00:00Z",
          content: { markdown: "Q1…" },
        },
      ],
    });
    await page.goto(`/classes/${CLASS_ID}/exams`);
    await page.getByRole("button", { name: "Review" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Q1…")).toBeVisible();
    await expect(dialog.getByText("Grounded in")).toBeHidden();
  });
});
