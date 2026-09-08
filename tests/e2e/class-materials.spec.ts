import { test, expect, type Page } from "@playwright/test";

// Notes & text, actually clicked.
//
// The three things a teacher can now do to a class's reference material —
// upload a file, edit it, delete it — each cross a boundary that typecheck
// cannot see: an edit is a PATCH to PostgREST, a delete is a call to the
// separate backend (it owns the Backblaze objects a row delete would
// orphan), and an upload is three calls in sequence with a poll after them.
// This asserts the requests each click actually forms.
//
// No account and no network: the session is a seeded token, PostgREST and
// the backend are stubbed. A test of the FRONTEND — state, handlers, the
// request — deliberately not of RLS, which is the database's job.

const CLASS_ID = "22222222-2222-2222-2222-222222222222";
const MATERIAL_ID = "66666666-6666-6666-6666-666666666666";
const UPLOAD_ID = "77777777-7777-7777-7777-777777777777";
const SIGNED_URL = "https://s3.example.test/bucket/object?X-Amz-Signature=abc";

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

const BATCHES = [
  {
    id: "b1",
    label: "2026-2027",
    start_year: 2026,
    grades: [
      {
        id: "g1",
        level: 9,
        batch_id: "b1",
        divisions: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            label: "A",
            grade_id: "g1",
            classes: [{ id: CLASS_ID, subject: "Physics", division_id: "11111111-1111-1111-1111-111111111111" }],
          },
        ],
      },
    ],
  },
];

const MATERIAL = {
  id: MATERIAL_ID,
  title: "Grade 9 Physics syllabus",
  kind: "note",
  body_md: "Unit 1: Forces and Motion",
  created_at: "2026-09-01T00:00:00Z",
  owner_id: USER.id,
  is_shared: false,
  storage_path: null,
};

type Written = { method: string; url: string; body: unknown };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

/** Signs in, stubs PostgREST and the backend, and records every write. */
async function teacher(page: Page, opts: { uploadStatus?: string } = {}) {
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
    const json = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: CORS,
        body: JSON.stringify(wantsObject && Array.isArray(data) ? (data[0] ?? null) : data),
      });

    if (url.includes("/rest/v1/profiles")) return json([PROFILE]);
    if (url.includes("/rest/v1/classes")) return json([CLASS]);
    if (url.includes("/rest/v1/batches")) return json(BATCHES);
    if (url.includes("/rest/v1/class_materials")) {
      return json(method === "GET" ? [{ material: MATERIAL }] : []);
    }
    if (url.includes("/rest/v1/materials")) return json(method === "GET" ? [] : [MATERIAL]);
    if (url.includes("/rest/v1/rpc/")) return json({});
    return json([]);
  });

  // The separate backend, reached through the same-origin /api/* rewrite.
  await page.route("**/api/studio/**", async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    let body: unknown = null;
    try {
      body = req.postDataJSON();
    } catch {
      /* no body */
    }
    written.push({ method, url, body });

    const json = (data: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });

    if (url.includes("/api/studio/uploads") && url.endsWith("/complete")) {
      return json({
        materialId: UPLOAD_ID,
        status: opts.uploadStatus ?? "queued",
        usable: false,
        note: null,
      });
    }
    if (url.match(/\/api\/studio\/uploads\/[^/]+$/)) {
      if (method === "DELETE") return json({ deleted: true });
      return json({
        materialId: UPLOAD_ID,
        title: "Syllabus",
        filename: "syllabus.pdf",
        status: "ready",
        usable: true,
        note: null,
      });
    }
    if (url.includes("/api/studio/uploads")) {
      return json({
        materialId: UPLOAD_ID,
        uploadUrl: SIGNED_URL,
        method: "PUT",
        expiresInSeconds: 900,
        maxBytes: 157286400,
      });
    }
    if (url.includes("/api/studio/materials/")) return json({ deleted: true });
    return json({});
  });

  // Backblaze. A PUT whose body is a File carries the file's own
  // Content-Type, which is not a CORS-simple value — so the browser
  // preflights, and without an answer here the upload fails as a bare
  // network error rather than reaching any assertion.
  await page.route(`${SIGNED_URL.split("?")[0]}**`, (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    written.push({ method: route.request().method(), url: route.request().url(), body: null });
    return route.fulfill({ status: 200, headers: CORS, body: "" });
  });

  // supabase-js reads the session from localStorage under
  // sb-<project-ref>-auth-token, and the ref is inlined into the bundle
  // rather than readable from here. Answering for any key of that shape
  // beats hardcoding a ref that stops matching the day the project moves.
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

test.describe("a class's notes and documents", () => {
  test("editing a note writes the new title and body", async ({ page }) => {
    const written = await teacher(page);
    await page.goto(`/classes/${CLASS_ID}/notes`);

    await expect(page.getByText("Grade 9 Physics syllabus")).toBeVisible();
    await page.getByRole("button", { name: /edit grade 9 physics syllabus/i }).click();

    const title = page.getByRole("textbox").first();
    await title.fill("Grade 9 Physics syllabus — revised");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect
      .poll(() => written.find((w) => w.method === "PATCH" && w.url.includes("/materials")))
      .toBeTruthy();
    const patch = written.find((w) => w.method === "PATCH" && w.url.includes("/materials"));
    expect(patch?.url).toContain(MATERIAL_ID);
    expect(patch?.body).toMatchObject({ title: "Grade 9 Physics syllabus — revised" });
  });

  test("deleting a note asks first, then calls the backend that owns its files", async ({ page }) => {
    const written = await teacher(page);
    await page.goto(`/classes/${CLASS_ID}/notes`);
    await expect(page.getByText("Grade 9 Physics syllabus")).toBeVisible();

    // Dismissed: nothing is deleted.
    page.once("dialog", (d) => d.dismiss());
    await page.getByRole("button", { name: /delete grade 9 physics syllabus/i }).click();
    expect(written.filter((w) => w.method === "DELETE")).toHaveLength(0);

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /delete grade 9 physics syllabus/i }).click();

    await expect
      .poll(() => written.find((w) => w.method === "DELETE"))
      .toBeTruthy();
    const del = written.find((w) => w.method === "DELETE");
    expect(del?.url).toContain(`/api/studio/materials/${MATERIAL_ID}`);
  });

  test("attaching a file reserves a slot, sends the bytes, then reports it landed", async ({
    page,
  }) => {
    const written = await teacher(page, { uploadStatus: "ready" });
    await page.goto(`/classes/${CLASS_ID}/notes`);
    await expect(page.getByText("Grade 9 Physics syllabus")).toBeVisible();

    await page.getByRole("button", { name: /choose from deck or add a syllabus/i }).click();
    await page.getByRole("button", { name: /add syllabus \/ curriculum/i }).click();

    await page.setInputFiles('input[type="file"]', {
      name: "syllabus.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 a real enough file"),
    });

    await expect.poll(() => written.length >= 3, { timeout: 15_000 }).toBeTruthy();

    const reserve = written.find((w) => w.method === "POST" && w.url.endsWith("/api/studio/uploads"));
    expect(reserve?.body).toMatchObject({
      classId: CLASS_ID,
      filename: "syllabus.pdf",
      mimeType: "application/pdf",
    });

    const put = written.find((w) => w.method === "PUT");
    expect(put?.url).toContain("s3.example.test");

    const complete = written.find((w) => w.url.endsWith("/complete"));
    expect(complete?.url).toContain(UPLOAD_ID);
  });

  test("a file attached in the Goal Planner reports when it has been read", async ({ page }) => {
    await teacher(page, { uploadStatus: "queued" });
    await page.goto("/goal-planner");

    // The prompt, the attach control and the library are one intake, not
    // three modes: all of them reachable without choosing between them.
    await expect(page.getByLabel("What should this term cover?")).toBeVisible();
    await expect(page.getByRole("button", { name: /attach a document/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /shared library/i })).toBeVisible();
    await expect(page.getByText("Grade 9 Physics syllabus already on this class")).toBeVisible();

    await page.setInputFiles('input[type="file"]', {
      name: "syllabus.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 a real enough file"),
    });

    await expect(page.getByText("syllabus.pdf")).toBeVisible();
    // "queued" at complete, "ready" on the next poll — the chip has to
    // move on its own, without another click.
    await expect(page.getByText("Reading your document…")).toBeVisible();
    await expect(page.getByText("Ready", { exact: true })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /remove syllabus\.pdf/i }).click();
    await expect(page.getByText("syllabus.pdf")).toBeHidden();
  });
});
