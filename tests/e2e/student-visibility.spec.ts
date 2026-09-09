import { test, expect, type Page } from "@playwright/test";

// The note visibility toggle and the student side it feeds.
//
// The RLS that actually enforces this is proven separately against the live
// database (a policy can't be tested from a browser with PostgREST stubbed).
// What's tested here is the half a stub can tell the truth about: that the
// toggle writes the per-class flag, that a file-only note can't be shared
// because nothing could open it, and that the portal renders what the
// policies return — plus that it refuses to render for a non-student.

const TEACHER = {
  id: "00000000-0000-0000-0000-0000000000aa",
  aud: "authenticated",
  role: "authenticated",
  email: "teacher@example.test",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

const TEACHER_PROFILE = {
  role: "teacher",
  status: "active",
  name: "Test Teacher",
  email: "teacher@example.test",
  institution: "Test School",
  staff_id: "T-1",
  syllabus: "CBSE",
};

const STUDENT_PROFILE = {
  role: "student",
  status: "active",
  name: "Reem Al Dhaheri",
  email: "reem@example.test",
  institution: null,
  staff_id: null,
  syllabus: null,
};

const CLASS_ID = "22222222-2222-2222-2222-222222222222";
const TEXT_NOTE_ID = "eeeeeeee-0000-0000-0000-000000000001";
const FILE_NOTE_ID = "eeeeeeee-0000-0000-0000-000000000002";

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

const NOTES = [
  {
    visible_to_students: false,
    material: {
      id: TEXT_NOTE_ID,
      title: "Forces — unit notes",
      kind: "note",
      body_md: "Newton's first law states…",
      created_at: "2026-09-01T00:00:00Z",
      owner_id: TEACHER.id,
      is_shared: false,
      storage_path: null,
    },
  },
  {
    visible_to_students: false,
    material: {
      id: FILE_NOTE_ID,
      title: "Scanned worksheet.pdf",
      kind: "other",
      body_md: null,
      created_at: "2026-09-01T00:00:00Z",
      owner_id: TEACHER.id,
      is_shared: false,
      storage_path: "uploads/worksheet.pdf",
    },
  },
];

type Written = { method: string; url: string; body: unknown };

async function signedInAs(
  page: Page,
  user: typeof TEACHER,
  profile: unknown,
  handlers: (ctx: {
    url: string;
    method: string;
    json: (d: unknown, h?: Record<string, string>) => Promise<void>;
  }) => Promise<void> | undefined | void,
) {
  const written: Written[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") console.log("CONSOLE ERROR:", m.text());
  });
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));

  await page.route("**/auth/v1/**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) }),
  );

  await page.route("**/rest/v1/**", async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    let body: unknown = null;
    try {
      body = req.postDataJSON();
    } catch {
      /* GET */
    }
    if (method !== "GET") written.push({ method, url, body });

    const wantsObject = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
    const json = (d: unknown, extra: Record<string, string> = {}) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "*",
          ...extra,
        },
        body: JSON.stringify(wantsObject && Array.isArray(d) ? (d[0] ?? null) : d),
      });

    if (url.includes("/rest/v1/profiles")) return json([profile]);
    await handlers({ url, method, json });
    if (!route.request().isNavigationRequest()) {
      // Anything the test didn't special-case.
      try {
        await json([]);
      } catch {
        /* already fulfilled by the handler */
      }
    }
  });

  await page.addInitScript((u) => {
    const session = JSON.stringify({
      access_token: "test-token",
      refresh_token: "test-refresh",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: u,
    });
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key: string) {
      return /^sb-.+-auth-token$/.test(key) ? session : original.call(this, key);
    };
  }, user);

  return written;
}

test.describe("sharing a note with students", () => {
  test("the toggle writes the per-class visibility flag", async ({ page }) => {
    const written = await signedInAs(page, TEACHER, TEACHER_PROFILE, async ({ url, json }) => {
      if (url.includes("/rest/v1/classes")) return json([CLASS]);
      if (url.includes("/rest/v1/class_materials")) return json(NOTES, { "Content-Range": "*/2" });
    });

    await page.goto(`/classes/${CLASS_ID}/notes`);
    await expect(page.getByText("Forces — unit notes")).toBeVisible();

    await page.getByRole("button", { name: /Show Forces — unit notes to students/i }).click();

    await expect
      .poll(() => written.some((w) => w.method === "PATCH" && w.url.includes("class_materials")))
      .toBe(true);
    const patch = written.find((w) => w.method === "PATCH" && w.url.includes("class_materials"));
    expect((patch!.body as { visible_to_students: boolean }).visible_to_students).toBe(true);
    // Scoped to this class, not the material everywhere it's attached.
    expect(patch!.url).toContain(CLASS_ID);
    await expect(page.getByText(/Students in this class can read this/i)).toBeVisible();
  });

  test("a file-only note can't be shared, and says why", async ({ page }) => {
    const written = await signedInAs(page, TEACHER, TEACHER_PROFILE, async ({ url, json }) => {
      if (url.includes("/rest/v1/classes")) return json([CLASS]);
      if (url.includes("/rest/v1/class_materials")) return json(NOTES, { "Content-Range": "*/2" });
    });

    await page.goto(`/classes/${CLASS_ID}/notes`);
    const toggle = page.getByRole("button", { name: /Show Scanned worksheet.pdf to students/i });
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute("title", /no reader for them/i);
    expect(written.some((w) => w.method === "PATCH")).toBe(false);
  });
});

test.describe("the student portal", () => {
  test("shows the notes shared with them, grouped by subject", async ({ page }) => {
    await signedInAs(page, TEACHER, STUDENT_PROFILE, async ({ url, json }) => {
      if (url.includes("/rest/v1/students")) {
        return json([{ id: "s1", name: "Reem Al Dhaheri", roll_no: "9A-01" }]);
      }
      if (url.includes("/rest/v1/class_materials")) {
        return json([
          {
            material: {
              id: TEXT_NOTE_ID,
              title: "Forces — unit notes",
              body_md: "Newton's first law states…",
              storage_path: null,
            },
            class: { subject: "Physics" },
          },
        ]);
      }
    });

    await page.goto("/student");
    await expect(page.getByText("Hello, Reem")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Physics" })).toBeVisible();
    await expect(page.getByText("Forces — unit notes")).toBeVisible();

    await page.getByRole("button", { name: "Read" }).click();
    await expect(page.getByRole("dialog")).toContainText("Newton's first law states");
  });

  test("says so plainly when nothing has been shared", async ({ page }) => {
    await signedInAs(page, TEACHER, STUDENT_PROFILE, async ({ url, json }) => {
      if (url.includes("/rest/v1/students")) {
        return json([{ id: "s1", name: "Reem Al Dhaheri", roll_no: "9A-01" }]);
      }
      if (url.includes("/rest/v1/class_materials")) return json([]);
    });

    await page.goto("/student");
    await expect(page.getByText("Nothing shared yet")).toBeVisible();
  });

  test("a teacher who wanders into the portal is sent out of it", async ({ page }) => {
    await signedInAs(page, TEACHER, TEACHER_PROFILE, async ({ url, json }) => {
      if (url.includes("/rest/v1/class_materials")) return json([]);
    });

    await page.goto("/student");
    // Bounced away — never renders student content to a non-student.
    await expect(page).not.toHaveURL(/\/student$/, { timeout: 10_000 });
  });
});
