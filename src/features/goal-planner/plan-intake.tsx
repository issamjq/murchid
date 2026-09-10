"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, FileWarning, LibraryBig, NotebookPen, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AddOwnReferenceForm } from "@/shared/add-own-reference-form";
import { ClassFileUpload } from "@/shared/class-file-upload";
import { listMaterialsForClass, type MaterialRow } from "@/lib/data/classes";
import type { GoalSource } from "@/lib/data/goal-planner";
import { SharedLibraryPicker } from "./shared-library-picker";

// A detailed enough prompt counts as grounding on its own, per the
// concept: "curriculum, or proper detailed prompts, and textbooks or
// documents, or choose from the materials."
const MIN_GROUNDED_PROMPT_LENGTH = 40;

// Starters a teacher can pick to reach MIN_GROUNDED_PROMPT_LENGTH without
// having to phrase it from scratch — they fill in the brackets after.
const PROMPT_STARTERS = [
  "Cover [topic], focusing on [subtopic 1] and [subtopic 2].",
  "This term builds toward [skill], across [topic 1] through [topic 2].",
  "Introduce [topic], go deeper into [subtopic], then review with [activity].",
];

export interface ClassOption {
  id: string;
  label: string;
}

export interface GeneratePayload {
  classId: string;
  prompt: string;
  source: GoalSource;
  materialIds: string[];
}

/** What the sources panel has gathered, as the card above it needs to see it. */
interface SourceState {
  referenceCount: number;
  libraryIds: string[];
  hasUpload: boolean;
}

const NO_SOURCES: SourceState = { referenceCount: 0, libraryIds: [], hasUpload: false };

function SourceLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <Check className="mt-0.5 size-3 shrink-0 text-success" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

// Everything one plan is grounded on, in one box.
//
// These were three tabs — Prompt, Upload documents, Shared library —
// which read as three separate ways to generate, so a teacher picked one
// and never learned that a plan can draw on all of them at once. They
// are additive, and now they look it: whatever is gathered here is
// listed as it accumulates.
//
// Remounted by key on class change, which is also how everything picked
// for the previous class is discarded.
function PlanSources({
  classId,
  ownerId,
  promptIsDetailed,
  onChange,
}: {
  classId: string;
  ownerId: string | null;
  promptIsDetailed: boolean;
  onChange: (state: SourceState) => void;
}) {
  const [references, setReferences] = useState<MaterialRow[] | null>(null);
  const [libraryIds, setLibraryIds] = useState<Set<string>>(new Set());
  const [hasUpload, setHasUpload] = useState(false);
  const [panel, setPanel] = useState<"library" | "text" | null>(null);

  const loadReferences = useCallback(() => {
    listMaterialsForClass(classId)
      .then(setReferences)
      .catch(() => setReferences([]));
  }, [classId]);

  useEffect(loadReferences, [loadReferences]);

  useEffect(() => {
    onChange({
      referenceCount: references?.length ?? 0,
      libraryIds: Array.from(libraryIds),
      hasUpload,
    });
  }, [references, libraryIds, hasUpload, onChange]);

  function toggleMaterial(id: string) {
    setLibraryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const referenceCount = references?.length ?? 0;
  const nothingYet = referenceCount === 0 && !hasUpload && libraryIds.size === 0 && !promptIsDetailed;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-secondary/40 p-3">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">What it draws on</p>
        <p className="text-xs text-muted-foreground">
          All of this goes into the same plan — the prompt says what to cover, these say what
          to teach it from. Add as many as you like.
        </p>
      </div>

      <div className="space-y-1.5">
        {referenceCount > 0 ? (
          <SourceLine>
            {referenceCount === 1 ? references![0].title : `${referenceCount} documents`} already
            on this class
          </SourceLine>
        ) : null}
        {libraryIds.size > 0 ? (
          <SourceLine>
            {libraryIds.size} from the shared library
          </SourceLine>
        ) : null}
        {promptIsDetailed ? <SourceLine>Your prompt, detailed enough to plan from</SourceLine> : null}
        {nothingYet ? <p className="text-xs text-muted-foreground">Nothing yet.</p> : null}
      </div>

      <ClassFileUpload
        classId={classId}
        onUsableChange={setHasUpload}
        actions={
          <>
            <Button
              variant={panel === "library" ? "secondary" : "outline"}
              size="sm"
              onClick={() => setPanel(panel === "library" ? null : "library")}
            >
              <LibraryBig className="size-3.5" />
              Shared library{libraryIds.size > 0 ? ` · ${libraryIds.size}` : ""}
            </Button>
            <Button
              variant={panel === "text" ? "secondary" : "outline"}
              size="sm"
              onClick={() => setPanel(panel === "text" ? null : "text")}
            >
              <NotebookPen className="size-3.5" />
              Paste a syllabus
            </Button>
          </>
        }
      />

      {panel === "library" ? (
        <SharedLibraryPicker selected={libraryIds} onToggle={toggleMaterial} />
      ) : null}
      {panel === "text" && ownerId ? (
        <AddOwnReferenceForm
          ownerId={ownerId}
          classId={classId}
          showUpload={false}
          showSubmitButton={false}
          onAttached={() => {
            loadReferences();
            setPanel(null);
          }}
        />
      ) : null}
    </div>
  );
}

export function PlanIntake({
  classes,
  ownerId,
  busy,
  onGenerate,
  onClassChange,
}: {
  classes: ClassOption[] | null;
  ownerId: string | null;
  busy: boolean;
  onGenerate: (payload: GeneratePayload) => void;
  onClassChange?: (classId: string) => void;
}) {
  const [classId, setClassId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [sources, setSources] = useState<SourceState>(NO_SOURCES);

  const firstClassId = classes?.[0]?.id ?? "";
  const selectedClassId = classId || firstClassId;

  // Fires only when the class id itself changes, not whenever the parent's
  // callback identity does (it's a useCallback keyed on stage/autoResumedFor,
  // both of which change on every "start a new plan" click) — otherwise
  // dismissing a resumed draft immediately re-triggers the same resume.
  const notifiedClassIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedClassId && selectedClassId !== notifiedClassIdRef.current) {
      notifiedClassIdRef.current = selectedClassId;
      onClassChange?.(selectedClassId);
    }
  }, [selectedClassId, onClassChange]);

  const promptIsDetailed = prompt.trim().length >= MIN_GROUNDED_PROMPT_LENGTH;
  const promptCharsToGo = Math.max(0, MIN_GROUNDED_PROMPT_LENGTH - prompt.trim().length);

  function insertStarter(starter: string) {
    setPrompt((prev) => (prev.trim() ? `${prev.trim()} ${starter}` : starter));
  }

  const grounded =
    sources.referenceCount > 0 ||
    sources.hasUpload ||
    sources.libraryIds.length > 0 ||
    promptIsDetailed;
  const canGenerate = Boolean(selectedClassId) && Boolean(ownerId) && grounded && !busy;

  function generate() {
    if (!canGenerate) return;
    // The plan draws on all of them at once; `source` only records which
    // kind led, for the goal row's own history.
    const source: GoalSource =
      sources.libraryIds.length > 0 ? "library" : sources.hasUpload ? "upload" : "prompt";
    onGenerate({
      classId: selectedClassId,
      prompt: prompt.trim(),
      source,
      materialIds: sources.libraryIds,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>What are we planning?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="class">Class</Label>
          {classes === null ? (
            <p className="text-sm text-muted-foreground">Loading your classes…</p>
          ) : classes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No classes yet — add one in My Classes first.
            </p>
          ) : (
            <select
              id="class"
              value={selectedClassId}
              onChange={(e) => {
                setClassId(e.target.value);
                setSources(NO_SOURCES);
              }}
              disabled={busy}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="prompt">What should this term cover?</Label>
          <Textarea
            id="prompt"
            rows={5}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy}
            placeholder="e.g. Term 2, Unit 3: Trade routes of the ancient world. Cover the Silk Road, maritime trade, and the spread of ideas."
          />
          <p className={`text-xs ${promptCharsToGo > 0 ? "text-muted-foreground" : "text-success"}`}>
            {promptCharsToGo > 0
              ? `${promptCharsToGo} more character${promptCharsToGo === 1 ? "" : "s"} to count as grounding on its own`
              : "Detailed enough to plan from on its own."}
          </p>
          {promptCharsToGo > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {PROMPT_STARTERS.map((starter) => (
                <Button
                  key={starter}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-auto whitespace-normal py-1 text-left text-xs font-normal"
                  onClick={() => insertStarter(starter)}
                >
                  {starter}
                </Button>
              ))}
            </div>
          ) : null}
        </div>

        {selectedClassId ? (
          <PlanSources
            key={selectedClassId}
            classId={selectedClassId}
            ownerId={ownerId}
            promptIsDetailed={promptIsDetailed}
            onChange={setSources}
          />
        ) : null}

        {selectedClassId && !grounded ? (
          <div className="flex items-start gap-2 rounded-md border border-dashed border-warning/40 bg-warning/5 p-3">
            <FileWarning className="size-4 shrink-0 text-warning" />
            <p className="text-xs text-muted-foreground">
              Nothing is grounding this plan yet. Attach a document, choose from the shared
              library, or write the prompt out in more detail — otherwise the draft would be
              guessing.
            </p>
          </div>
        ) : null}

        <Button className="w-full" onClick={generate} disabled={!canGenerate}>
          <Sparkles /> Generate term plan
        </Button>
      </CardContent>
    </Card>
  );
}
