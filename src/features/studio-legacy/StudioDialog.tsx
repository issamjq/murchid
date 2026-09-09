"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useStudio, type StudioItem } from "./studio-context";

// Opening a record used to slide a 440px column in from the right, which
// put a term's worth of prose in a strip narrower than a phone and left
// most of the panel to a chat that only ever returned a canned "this is
// a simulated reply". Reading the record is the actual job, so it is a
// centred dialog at a readable measure, and the composer is gone until
// there is a real assistant behind it.
function Dialog({ item, onClose }: { item: StudioItem; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const returnFocusTo = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    // The page behind must not scroll under the dialog.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusTo?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8">
      <div
        className="absolute inset-0 bg-foreground/40 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-dialog-title"
        tabIndex={-1}
        className="relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl focus-visible:outline-none"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border bg-secondary/40 px-6 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {item.kind}
              {item.classLabel ? ` · ${item.classLabel}` : ""}
            </p>
            <h2 id="studio-dialog-title" className="mt-0.5 text-lg font-black text-foreground">
              {item.title}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8">
          {item.content ? (
            <div className="mx-auto max-w-[70ch] whitespace-pre-wrap text-[15px] leading-7 text-foreground">
              {item.content}
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nothing is saved in this {item.kind.toLowerCase()} yet.
            </p>
          )}

          {item.sources && item.sources.length > 0 ? (
            <div className="mx-auto mt-8 max-w-[70ch] border-t border-border pt-4">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Grounded in
              </p>
              <ul className="mt-2 space-y-1">
                {item.sources.map((source) => (
                  <li key={source.id} className="text-sm text-muted-foreground">
                    {source.title}
                    {/* A curriculum chapter the backend matched isn't something
                        she attached, so it shouldn't read as if she had. */}
                    {source.origin === "curriculum" ? (
                      <span className="ml-1.5 text-xs">· national curriculum</span>
                    ) : null}
                    {source.origin === "library" ? (
                      <span className="ml-1.5 text-xs">· shared library</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function StudioDialog() {
  const { item, close } = useStudio();
  if (!item) return null;
  return <Dialog item={item} onClose={close} />;
}
