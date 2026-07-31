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
