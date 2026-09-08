"use client";

import { useState } from "react";
import { Paperclip, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { logGeneration } from "@/lib/data/analytics";
import { ComposerAttachMenu } from "./ComposerAttachMenu";

export function StudioComposerBar({
  placeholder,
  buttonLabel,
  onSubmit,
  classId,
  ownerId,
  feature,
  canSend = true,
  disabledHint,
  onAttached,
  tierOptions,
}: {
  placeholder: string;
  buttonLabel: string;
  onSubmit: (prompt: string, tiers?: string[]) => Promise<{ notice?: string } | void>;
  classId: string;
  ownerId: string | null;
  feature: string;
  canSend?: boolean;
  disabledHint?: string;
  onAttached?: () => void;
  // When provided, renders a toggle per entry above the textarea ("also
  // generate a simplified/challenge version") and passes the selection
  // as onSubmit's second argument. Omit to leave this composer unchanged.
  tierOptions?: { key: string; label: string }[];
}) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedTiers, setSelectedTiers] = useState<string[]>([]);

  function toggleTier(key: string) {
    setSelectedTiers((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  async function submit() {
    const value = prompt.trim();
    if (!value || busy || !canSend) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await onSubmit(value, selectedTiers);
      if (ownerId) logGeneration(ownerId, feature, classId);
      setPrompt("");
      if (result?.notice) setNotice(result.notice);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-2">
      {attachOpen && ownerId ? (
        <ComposerAttachMenu
          ownerId={ownerId}
          classId={classId}
          onAttached={() => {
            setAttachOpen(false);
            onAttached?.();
          }}
        />
      ) : null}
      {tierOptions && tierOptions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 px-1">
          <span className="text-xs text-muted-foreground">Also generate:</span>
          {tierOptions.map((opt) => {
            const active = selectedTiers.includes(opt.key);
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => toggleTier(opt.key)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2.5 shadow-sm">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setAttachOpen((o) => !o)}
          disabled={!ownerId}
          className="shrink-0 rounded-full text-muted-foreground hover:text-foreground"
          title="Choose from deck or add a syllabus/curriculum"
        >
          {attachOpen ? <X className="size-4" /> : <Paperclip className="size-4" />}
        </Button>
        <Textarea
          rows={1}
          placeholder={placeholder}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="min-h-10 flex-1 resize-none rounded-xl border-0 shadow-none focus-visible:ring-0"
        />
        <Button
          onClick={submit}
          disabled={busy || !prompt.trim() || !canSend}
          className="shrink-0 rounded-full"
        >
          <Sparkles className="size-4" />
          {busy ? "Drafting…" : buttonLabel}
        </Button>
      </div>
      {!canSend ? (
        <p className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
          {disabledHint ?? (
            <>
              Add a syllabus or reference with the <Paperclip className="size-3" /> button first —
              it keeps the draft grounded.
            </>
          )}
        </p>
      ) : null}
      {error ? <p className="px-1 text-xs text-destructive">{error}</p> : null}
      {notice ? <p className="px-1 text-xs text-warning">{notice}</p> : null}
    </div>
  );
}
