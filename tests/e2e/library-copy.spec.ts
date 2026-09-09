import { test, expect, type Page } from "@playwright/test";

// Copy-to-adapt from the shared library, actually clicked.
//
// "Add" attaches the admin's row by reference and stays read-only in the
// class; "Copy" pulls in an editable copy the teacher owns. A file-only
// material has no text to adapt, so Copy refuses rather than silently
// doing something else under that label.

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
const TEXT_MATERIAL_ID = "cccccccc-0000-0000-0000-000000000001";
const FILE_MATERIAL_ID = "cccccccc-0000-0000-0000-000000000002";
const COPY_ID = "dddddddd-0000-0000-0000-000000000001";

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

// What listSharedMaterials returns — deliberately without body_md, which is
// only fetched on Copy so browsing stays cheap.
const SHARED = [
  {
    id: TEXT_MATERIAL_ID,
    title: "CBSE Grade 9 Physics syllabus",
    kind: "note",
    subject: "Physics",
    syllabus: "Indian — CBSE",
    grade_level: 9,
    storage_path: null,
    created_at: "2026-09-01T00:00:00Z",
  },
  {
    id: FILE_MATERIAL_ID,
    title: "Scanned textbook.pdf",
    kind: "other",
    subject: "Physics",
    syllabus: "Indian — CBSE",
    grade_level: 9,
    storage_path: "shared/textbook.pdf",
    created_at: "2026-09-01T00:00:00Z",
  },
];

type Written = { method: string; url: string; body: unknown };

async function teacher(page: Page) {
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
    if (url.includes("/rest/v1/class_materials")) return json([], { "Content-Range": "*/0" });
    if (url.includes("/rest/v1/materials")) {
      if (method === "POST") return json({ id: COPY_ID });
      // The single-row fetch Copy makes: only the text-bearing one has a body.
      if (url.includes(TEXT_MATERIAL_ID)) {
        return json([
          {
            title: "CBSE Grade 9 Physics syllabus",
            kind: "note",
            body_md: "Unit 1: Forces and Motion",
            subject: "Physics",
            syllabus: "Indian — CBSE",
            grade_level: 9,
          },
        ]);
      }
      if (url.includes(FILE_MATERIAL_ID)) {
        return json([
          {
            title: "Scanned textbook.pdf",
            kind: "other",
            body_md: null,
            subject: "Physics",
            syllabus: "Indian — CBSE",
            grade_level: 9,
          },
        ]);
      }
      return json(SHARED);
    }
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

  return written;
}

/** Opens the composer's attach menu, which defaults to the shared-library tab. */
async function openDeck(page: Page) {
  await page.goto(`/classes/${CLASS_ID}/notes`);
  await page.getByRole("button", { name: /choose from deck or add a syllabus/i }).click();
  await expect(page.getByText("CBSE Grade 9 Physics syllabus")).toBeVisible();
}

/** One result row. Scoped to the row element itself — a bare hasText div
 * matches every ancestor too, and would find the wrong row's buttons. */
function rowFor(page: Page, title: string) {
  return page.locator("div.rounded-md.border-border").filter({ hasText: title });
}

test.describe("copying from the shared library", () => {
  test("Copy writes an editable copy the teacher owns, plus a class link", async ({ page }) => {
    const written = await teacher(page);
    await openDeck(page);

    await rowFor(page, "CBSE Grade 9 Physics syllabus").getByRole("button", { name: "Copy" }).click();

    await expect
      .poll(() => written.some((w) => w.method === "POST" && w.url.includes("/rest/v1/materials")))
      .toBe(true);

    const insert = written.find((w) => w.method === "POST" && w.url.includes("/rest/v1/materials"));
    const row = insert!.body as {
      owner_id: string;
      title: string;
      body_md: string;
      is_shared: boolean;
    };
    expect(row.owner_id).toBe(USER.id);
    expect(row.is_shared).toBe(false);
    expect(row.title).toBe("CBSE Grade 9 Physics syllabus (copy)");
    expect(row.body_md).toBe("Unit 1: Forces and Motion");

    // …and it gets linked to this class.
    await expect
      .poll(() =>
        written.some((w) => w.method === "POST" && w.url.includes("/rest/v1/class_materials")),
      )
      .toBe(true);
    const link = written.find(
      (w) => w.method === "POST" && w.url.includes("/rest/v1/class_materials"),
    );
    expect((link!.body as { material_id: string }).material_id).toBe(COPY_ID);
  });

  test("Copy on a file-only material refuses instead of faking it", async ({ page }) => {
    const written = await teacher(page);
    await openDeck(page);

    await rowFor(page, "Scanned textbook.pdf").getByRole("button", { name: "Copy" }).click();

    await expect(page.getByText(/Nothing to copy — this one's a file/i)).toBeVisible();
    expect(
      written.some((w) => w.method === "POST" && w.url.includes("/rest/v1/materials")),
      "no copy row is written",
    ).toBe(false);
    expect(
      written.some((w) => w.method === "POST" && w.url.includes("/rest/v1/class_materials")),
      "and nothing is attached either",
    ).toBe(false);
  });

  test("Add still attaches the shared row by reference, unchanged", async ({ page }) => {
    const written = await teacher(page);
    await openDeck(page);

    await rowFor(page, "CBSE Grade 9 Physics syllabus").getByRole("button", { name: "Add" }).click();

    await expect
      .poll(() =>
        written.some((w) => w.method === "POST" && w.url.includes("/rest/v1/class_materials")),
      )
      .toBe(true);
    const link = written.find(
      (w) => w.method === "POST" && w.url.includes("/rest/v1/class_materials"),
    );
    // The admin's own row id — a reference, not a copy.
    expect((link!.body as { material_id: string }).material_id).toBe(TEXT_MATERIAL_ID);
    expect(written.some((w) => w.method === "POST" && w.url.includes("/rest/v1/materials"))).toBe(
      false,
    );
  });
});
