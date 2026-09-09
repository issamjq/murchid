import { test, expect, type Page } from "@playwright/test";

// Dictating a brief, actually clicked.
//
// Real speech recognition can't be driven from a test, so a fake
// SpeechRecognition is injected on window before the app loads — which
// makes the whole flow deterministic AND lets the most important case be
// tested directly: a browser without the API (Firefox today) must show no
// mic button at all, rather than one that does nothing.

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

/** Installs a fake SpeechRecognition and exposes window.__speech to drive
 * it: emit(transcript, isFinal) and fail(errorCode). */
async function installFakeSpeech(page: Page) {
  await page.addInitScript(() => {
    const control: {
      instance: Record<string, ((e: unknown) => void) | null> | null;
      started: boolean;
      emit?: (transcript: string, isFinal: boolean) => void;
      fail?: (error: string) => void;
    } = { instance: null, started: false };

    class FakeSpeechRecognition {
      continuous = false;
      interimResults = false;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        control.instance = this as unknown as Record<string, ((e: unknown) => void) | null>;
        control.started = true;
      }
      stop() {
        control.started = false;
        this.onend?.();
      }
      abort() {
        control.started = false;
      }
    }

    control.emit = (transcript: string, isFinal: boolean) => {
      const inst = control.instance as unknown as FakeSpeechRecognition | null;
      inst?.onresult?.({
        resultIndex: 0,
        results: { length: 1, 0: { length: 1, isFinal, 0: { transcript } } },
      });
    };
    control.fail = (error: string) => {
      const inst = control.instance as unknown as FakeSpeechRecognition | null;
      inst?.onerror?.({ error });
    };

    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeSpeechRecognition;
    (window as unknown as Record<string, unknown>).__speech = control;
  });
}

async function teacher(page: Page) {
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
    // A material attached, so the composer is enabled.
    if (url.includes("/rest/v1/class_materials")) return json([], { "Content-Range": "*/1" });
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

const emit = (page: Page, transcript: string, isFinal: boolean) =>
  page.evaluate(
    ([t, f]) =>
      (window as unknown as { __speech: { emit: (a: string, b: boolean) => void } }).__speech.emit(
        t as string,
        f as boolean,
      ),
    [transcript, isFinal] as const,
  );

const fail = (page: Page, error: string) =>
  page.evaluate(
    (e) =>
      (window as unknown as { __speech: { fail: (a: string) => void } }).__speech.fail(e as string),
    error,
  );

test.describe("dictating a brief into the composer", () => {
  test("a final result lands in the textarea", async ({ page }) => {
    await installFakeSpeech(page);
    await teacher(page);
    await page.goto(`/classes/${CLASS_ID}/exams`);

    await page.getByRole("button", { name: "Dictate" }).click();
    await expect(page.getByRole("button", { name: "Stop dictating" })).toBeVisible();

    await emit(page, "a mid-term on forces and motion", true);
    await expect(page.getByRole("textbox")).toHaveValue("a mid-term on forces and motion");
  });

  test("interim text shows as a live line but never enters the textarea", async ({ page }) => {
    await installFakeSpeech(page);
    await teacher(page);
    await page.goto(`/classes/${CLASS_ID}/exams`);

    await page.getByRole("button", { name: "Dictate" }).click();
    await emit(page, "a mid term on for", false);

    await expect(page.getByText("Hearing: a mid term on for")).toBeVisible();
    // The half-guessed text must not be appended — that's how dictation ends
    // up duplicated once the browser revises it.
    await expect(page.getByRole("textbox")).toHaveValue("");

    await emit(page, "a mid-term on forces", true);
    await expect(page.getByRole("textbox")).toHaveValue("a mid-term on forces");
    await expect(page.getByText(/^Hearing:/)).toBeHidden();
  });

  test("dictation appends to text already typed", async ({ page }) => {
    await installFakeSpeech(page);
    await teacher(page);
    await page.goto(`/classes/${CLASS_ID}/exams`);

    await page.getByRole("textbox").fill("A mid-term");
    await page.getByRole("button", { name: "Dictate" }).click();
    await emit(page, "covering units 3 and 4", true);

    await expect(page.getByRole("textbox")).toHaveValue("A mid-term covering units 3 and 4");
  });

  test("a blocked microphone says so in plain words", async ({ page }) => {
    await installFakeSpeech(page);
    await teacher(page);
    await page.goto(`/classes/${CLASS_ID}/exams`);

    await page.getByRole("button", { name: "Dictate" }).click();
    await fail(page, "not-allowed");

    await expect(page.getByText(/Microphone access is blocked/i)).toBeVisible();
    // And it stops listening rather than leaving the button stuck live.
    await expect(page.getByRole("button", { name: "Dictate" })).toBeVisible();
  });

  test("no mic button at all in a browser without the API", async ({ page }) => {
    // Deliberately no installFakeSpeech — this is the Firefox path.
    await teacher(page);
    await page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).SpeechRecognition;
      delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    });
    await page.goto(`/classes/${CLASS_ID}/exams`);

    // The composer itself is there…
    await expect(page.getByRole("textbox")).toBeVisible();
    // …but nothing offers dictation.
    await expect(page.getByRole("button", { name: "Dictate" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Stop dictating" })).toHaveCount(0);
  });
});
