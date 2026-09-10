"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  getLibraryFilters,
  searchLibrary,
  type LibraryBoard,
  type LibraryMaterial,
} from "@/lib/data/goal-planner";

// The admin-curated corpus, browsed by board/grade/subject. Ticking a
// document here adds it to the plan being drafted — it does not replace
// whatever else is already grounding that plan.
export function SharedLibraryPicker({
  selected,
  onToggle,
}: {
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [filters, setFilters] = useState<{ boards: LibraryBoard[] } | null>(null);
  const [board, setBoard] = useState("");
  const [grade, setGrade] = useState("");
  const [subject, setSubject] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<LibraryMaterial[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getLibraryFilters()
      .then(setFilters)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load the library"));
  }, []);

  // Debounced — a title/keyword search fires on every keystroke otherwise.
  useEffect(() => {
    const handle = setTimeout(() => {
      searchLibrary({
        board: board || undefined,
        grade: grade || undefined,
        subject: subject || undefined,
        q: q.trim() || undefined,
        limit: 40,
      })
        .then((r) => {
          setResults(r.materials);
          setTotal(r.total);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Search failed"));
    }, 300);
    return () => clearTimeout(handle);
  }, [board, grade, subject, q]);

  const boardOptions = filters?.boards ?? [];
  const activeBoard = boardOptions.find((b) => b.board === board);

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by title or keyword…"
          className="h-8 pl-8 text-xs"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <select
          value={board}
          onChange={(e) => {
            setBoard(e.target.value);
            setGrade("");
            setSubject("");
          }}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm"
        >
          <option value="">Any board</option>
          {boardOptions.map((b) => (
            <option key={b.board} value={b.board}>
              {b.board} ({b.count})
            </option>
          ))}
        </select>
        <select
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          disabled={!activeBoard}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm disabled:opacity-50"
        >
          <option value="">Any grade</option>
          {(activeBoard?.grades ?? []).map((g) => (
            <option key={g} value={g}>
              Grade {g}
            </option>
          ))}
        </select>
        <select
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={!activeBoard}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm disabled:opacity-50"
        >
          <option value="">Any subject</option>
          {(activeBoard?.subjects ?? []).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {results === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : results.length === 0 ? (
        <p className="text-xs text-muted-foreground">No documents match those filters.</p>
      ) : (
        <>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {results.map((m) => (
              <label key={m.id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4"
                  checked={selected.has(m.id)}
                  onChange={() => onToggle(m.id)}
                />
                <span className="min-w-0">
                  <span className="block truncate">{m.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {m.board} · Grade {m.grade_label} · {m.subject} · {m.material_type}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {results.length} of {total} shown
          </p>
        </>
      )}
    </div>
  );
}
