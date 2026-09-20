# Tech — Source review v1

Implements `source-review-v1.md`. Golden Path only; no new npm deps.

## Data shapes (`types.ts`)

```ts
/** 1-based page (+ optional column) for an extract JPEG in DocumentBundle.images */
export interface SourceImageRef {
  page: number;
  column?: number;
}

// DocumentBundle additions:
previewImages?: string[];   // one JPEG per page/slide for UI; omit/empty if text-only
imageRefs?: SourceImageRef[]; // parallel to images[] when known

// LogicModelItem additions:
sourcePage?: number;    // 1-based into previewImages
sourceColumn?: number;  // 1-based when known

// ProcessingFile additions:
sourcePreviewImages?: string[]; // session copy of previewImages; cleared on Remove
```

## Boundaries

| Layer | Responsibility |
|-------|----------------|
| `services/fileService.ts` | Always emit `previewImages` (content-cropped full pages). Extract `images` may still be column tiles; emit parallel `imageRefs`. |
| `server/geminiLogicModel.ts` | Before each extract JPEG, insert a text part labeling page/column from `imageRefs`. Schema: optional `sourcePage` / `sourceColumn` on extract + critique item schemas. |
| `shared/provenance.ts` | Reconcile `sourcePage` / `sourceColumn` like other provenance (critique must not drop anchors). |
| `App.tsx` | Persist `sourcePreviewImages` after convert; split layout; page state; pass focus handler into editor. |
| `components/SourceDocumentPane.tsx` | Page nav, zoom, collapse, optional column cue text (no bbox overlay required in v1). |
| `components/LogicModelEditor.tsx` | Item focus / “Show in source” → `onFocusSource({ sourcePage, sourceColumn })`. |

## Tile → page rule

`sourcePage` always indexes **`previewImages`**, never extract tile ordinals. Prompt + `imageRefs` labels teach the model document page numbers. Normalize may clamp invalid pages; omit rather than invent.

## Memory

Retain base64 preview JPEGs in React state for the file’s lifetime (≤15 pages). Drop on Remove / Retry re-convert. Do not put rasters into CSV/PDF export.

## Bug: `imageRefs` silently dropped server-side (fixed 2026-09-19)

The Boundaries table above omits a layer that was added later: `server/apiCore.ts`'s
`parseDocumentBundle` reconstructs the `DocumentBundle` from the raw HTTP request body before
`server/geminiLogicModel.ts` ever sees it. That reconstruction listed `images`/`textTrack`/
`warnings`/`sourceFormat` but not `imageRefs` — so even though `services/fileService.ts` always
built real refs and the client always sent them over the wire (`postJson` serializes the whole
bundle), the server discarded the field before the "insert a text part labeling page/column from
`imageRefs`" step in the Boundaries table above ever ran. Every Track B image fell back to the
generic `"TRACK B image N of M."` label with no page number — the entire mechanism this doc
describes (`sourcePage always indexes previewImages ... imageRefs labels teach the model document
page numbers`) was non-functional in both the local Express and Vercel serverless paths, since both
call the same shared parser. Found via codebase audit (`docs/specs/codebase-audit-2026-09-19.md`
#1), not by anyone hitting a visible symptom — the feature degraded to "no source anchors" rather
than erroring.

Fixed by adding `imageRefs` to `parseDocumentBundle`'s reconstruction, validated whole-array (an
entry-by-entry repair would silently misalign `imageRefs[i]` with `images[i]` for every index after
a bad entry — worse than the no-label fallback). Verified live: re-extracting a real 2-page document
now sends `imageRefs` in the request and gets back items with the correct `sourcePage` (2, the real
grid page — previously this could only ever have been a guess or absent).
