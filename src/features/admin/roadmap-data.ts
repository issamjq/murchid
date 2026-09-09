export type CheckpointStatus = "done" | "in-progress" | "planned";

export type RoadmapCheckpoint = {
  id: string;
  title: string;
  period: string;
  status: CheckpointStatus;
  summary: string;
  items: string[];
};

// Edit this list to update the roadmap — the page reads straight from it.
export const ROADMAP_UPDATED = "9 Sep 2026";

export const ROADMAP: RoadmapCheckpoint[] = [
  {
    id: "foundation",
    title: "Platform foundation",
    period: "Completed",
    status: "done",
    summary:
      "Rebuilt from a blank slate on Next.js (App Router) and Supabase, replacing the legacy SPA.",
    items: [
      "Role-based auth for teacher, sub-admin, super-admin, and organisation roles, enforced with Supabase RLS",
      "Core routes scaffolded: dashboard, classes, calendar, goal planner, onboarding, and admin consoles",
    ],
  },
  {
    id: "dashboard-live-data",
    title: "Dashboard wired to real data",
    period: "Completed",
    status: "done",
    summary: "Replaced hardcoded numbers across the teacher dashboard with live Supabase queries.",
    items: [
      "Overview page pulled real counts instead of placeholder stats",
      "Dashboard charts wired up; sidebar height/nav and favicon fixed",
      "My Classes redesigned — fixed duplicate batch heading, card hierarchy, hover-reveal actions",
      "Fixed a bug where a hard refresh could falsely sign users out",
    ],
  },
  {
    id: "marketing-photography",
    title: "Marketing page — real photography",
    period: "Completed",
    status: "done",
    summary: "Swapped placeholder art for real photography on the public-facing landing page.",
    items: ["Hero, features grid, and roles section now use real photography"],
  },
  {
    id: "needs-attention-digest",
    title: "Needs-your-attention digest on Overview",
    period: "Completed",
    status: "done",
    summary:
      "Replaced the passive \"pending review\" count with an actionable, deep-linked list of what a teacher should go do next.",
    items: [
      "Stale attendance, ungraded assessments, unscheduled drafts, and failed term-plan generations surfaced in one card",
      "Every item deep-links straight to the right class tab — no dead ends",
      "First of a 9-item teacher quality-of-life roadmap; the rest are queued up one at a time",
    ],
  },
  {
    id: "sub-day-packet",
    title: "Substitute plan on each class",
    period: "Completed",
    status: "done",
    summary:
      "A one-click, printable packet for handing a class off to a substitute — no more assembling it by hand across four tabs.",
    items: [
      "Roster plus the day's lessons, homework, quizzes, and exams bundled onto one page for any class + date",
      "Print-isolated view (sidebar and nav disappear in print preview) — the first print-oriented screen in the app",
      "Second of a 9-item teacher quality-of-life roadmap; the rest are queued up one at a time",
    ],
  },
  {
    id: "tiered-worksheets",
    title: "Differentiated worksheets on Homework",
    period: "Completed",
    status: "done",
    summary:
      "Optional \"also generate\" toggles for a simplified or challenge version alongside the standard worksheet — one prompt instead of writing each level by hand.",
    items: [
      "Live end to end — the backend half shipped, and tiers turned out to work on any generated document, not just homework",
      "Every other generator (lessons, presentations, activities, notes, quizzes, exams) is untouched — zero visual or behavioral change",
      "Third of a 9-item teacher quality-of-life roadmap; the rest are queued up one at a time",
    ],
  },
  {
    id: "report-comments",
    title: "Report-card comment drafting",
    period: "Completed",
    status: "done",
    summary:
      "Each student's results and attendance, next to an editable, AI-draftable comment — instead of writing a whole class's report cards from memory.",
    items: [
      "Live end to end — comments are now AI-drafted from the student's record, with the template kept only as a safety net",
      "Scores are listed per assessment, not averaged — there's no common scale to blend a quiz and an exam mark into one honest percentage",
      "Fourth of a 9-item teacher quality-of-life roadmap; the rest are queued up one at a time",
    ],
  },
  {
    id: "curriculum-coverage-foundation",
    title: "Curriculum coverage — groundwork laid",
    period: "In progress",
    status: "in-progress",
    summary:
      "A syllabus-derive endpoint mentioned in old backend notes turned out not to exist anywhere — schema and backend spec now written from scratch so the real tracker UI can follow.",
    items: [
      "New syllabus_units table (manual or AI-derived units) and a goal_items.unit_id tag, both live in Supabase",
      "The derive endpoint is now live and refuses text that isn't a syllabus rather than inventing units — the tracker UI is what's left",
      "Manual-entry UI and the AI-derive UI are deliberately being built together in the next pass, not staged separately",
    ],
  },
  {
    id: "grounded-sources",
    title: "Every draft shows what it was grounded in",
    period: "Completed",
    status: "done",
    summary:
      "A generated lesson, quiz or worksheet now records which of the class's reference materials it drew on, shown under the draft when you open it.",
    items: [
      "Now names the documents a draft was genuinely written from, reported by the backend rather than inferred",
      "Stored alongside the draft, so it's still there when the record is reopened weeks later",
      "The earlier client-side guess was retired: measured against real data it named five documents a draft was specifically not written from",
    ],
  },
  {
    id: "parent-updates",
    title: "Parent updates, drafted to copy",
    period: "Completed",
    status: "done",
    summary:
      "A plain-language progress update per student, written for a parent rather than a colleague — drafted from the student's record, copied into whatever channel the teacher already uses.",
    items: [
      "Copy, never send: nothing in the product can email anyone, so the UI says so plainly rather than implying otherwise",
      "The draft quotes attendance but never raw marks — a score means nothing to a parent while assessments carry no total",
      "Live end to end — and the backend withholds marks from the model entirely, so an uninterpretable score can't reach a parent even by accident",
    ],
  },
  {
    id: "library-copy",
    title: "Copy shared material to adapt it",
    period: "Completed",
    status: "done",
    summary:
      "Pulling someone else's syllabus into your class used to attach it read-only. You can now take an editable copy — and a permissions hole that let any teacher publish into the shared library has been closed.",
    items: [
      "\"Copy\" alongside the existing \"Add\" in Choose from deck; a file with no text says so rather than pretending to copy",
      "Closed an RLS gap: the update policy didn't guard is_shared, so a teacher could publish to the platform-wide library the insert rule reserves for admins",
      "Still open, and a product decision rather than a build: shared material is global-or-private, with no school/organisation scoping modelled at all",
    ],
  },
  {
    id: "dictation",
    title: "Dictate a brief instead of typing it",
    period: "Completed",
    status: "done",
    summary:
      "A mic button on the studio composer — describe what you want out loud and it lands in the prompt box. Covers all seven generation tabs at once.",
    items: [
      "Uses the browser's own speech recognition — no new dependency, no backend, nothing extra to run",
      "Only settled text is inserted; the browser's live guesses show separately so nothing arrives duplicated",
      "In a browser without the API the button simply isn't there, rather than being there and doing nothing",
    ],
  },
  {
    id: "student-access",
    title: "Students can sign in and read shared notes",
    period: "Completed",
    status: "done",
    summary:
      "Invite-only student accounts, and a switch on each note in Notes & text that decides whether the students of that class can read it.",
    items: [
      "A teacher hands over a single-use join code; nobody can register without one, and redeeming it is the only way to become a student",
      "Sharing is per class, not per note — the same note can be open to one class and closed to another",
      "The first non-owner read path in the database, proven against the live schema: a student sees a shared note in their own class and nothing else, and teachers are unaffected",
    ],
  },
  {
    id: "full-redesign",
    title: "Full site redesign",
    period: "Target: Sun, 20 Sep 2026",
    status: "in-progress",
    summary: "A visual pass across the whole app — the current focus.",
    items: [
      "Company-wide visual refresh across dashboard, classes, and admin surfaces",
      "Public marketing pages still wait for visual sign-off before shipping, per project policy",
    ],
  },
  {
    id: "goal-planner-pipeline",
    title: "Goal Planner pipeline",
    period: "Planned",
    status: "planned",
    summary:
      "The core teaching pipeline: curriculum in, AI-drafted term material out, teacher-approved and scheduled.",
    items: ["Curriculum intake → AI-drafted term material → teacher approval → scheduled & notified"],
  },
  {
    id: "backend-polish",
    title: "Backend integration polish",
    period: "Planned",
    status: "planned",
    summary: "Remaining items on the AI backend surface.",
    items: [
      "Skill-profile endpoint with assignment-aware skill IDs",
      "Per-field confidence scoring on onboarding document parsing",
    ],
  },
  {
    id: "future-scope",
    title: "Future scope",
    period: "Not started",
    status: "planned",
    summary: "Deliberately deferred until the core pipeline is solid.",
    items: ["Student self-serve learning materials, independent of teacher-assigned work"],
  },
];
