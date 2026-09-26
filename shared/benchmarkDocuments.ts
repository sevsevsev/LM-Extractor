/**
 * The benchmark's document specs, and the golden answer derived from each.
 *
 * ONE SOURCE, TWO ARTEFACTS. A spec under `fixtures/benchmark/documents/` declares what is
 * printed on the page: slides, column headings, and the items under each heading. The deck the
 * benchmark extracts from is generated from that spec, and so is the expected answer. Nothing is
 * transcribed by hand from one to the other, so the two cannot drift, and the expected answer is
 * known by construction rather than blessed from a previous run — which is the whole difference
 * between this and the regression set.
 *
 * WHY THE DOCUMENTS ARE INVENTED. Every real logic model in this project is a client file naming
 * a real organisation and must never enter the repository. The organisations, programmes and
 * items here are fictional, written for this benchmark, and deliberately resemble no partner's
 * document. That is also what makes the benchmark shareable: anyone with a clone and a key can
 * run it.
 */
import type { GoldenAnswer, ScoredDomain } from './extractionScore.js';

export interface BenchmarkColumn {
  /** The heading printed above the column on the slide. */
  heading: string;
  /**
   * Where the items under this heading belong. `null` means the column is not grid content at all
   * (a budget line, a prose impact statement) and its items are expected nowhere — the extraction
   * is not penalised for reading them, only for placing them in a grid domain.
   */
  domain: ScoredDomain | null;
  /** Everything printed under the heading, in reading order — items and in-column labels alike. */
  items: string[];
  /**
   * Which of `items` are in-column GROUP HEADINGS rather than content ("Youth Outcomes" printed
   * above two activity bullets). They are printed on the slide but expected nowhere: the correct
   * handling is to become a group name, which this benchmark deliberately does not score, and a
   * model that reads one as an item is being unhelpful rather than wrong. Listing them as expected
   * items instead would mark a correct extraction down for doing the right thing.
   */
  labels?: string[];
  /**
   * Cells printed as ONE bullet that the expected answer counts as SEVERAL items, keyed by the
   * printed text. A source that writes three things into one run-on cell still states three
   * things, so that is what a reviewer should find on the board; `shared/listItemSplit.ts` is what
   * gets them there. Every key must also appear in `items`, and every part must be a substring of
   * its key, so the printed page and the expected answer still cannot drift.
   */
  splits?: Record<string, string[]>;
}

export interface BenchmarkSlide {
  title: string;
  columns: BenchmarkColumn[];
}

export interface BenchmarkDocument {
  id: string;
  label: string;
  /** The failure mode this document is in the set to exercise. */
  covers: string;
  organization?: string;
  program?: string;
  /** Expected document-type verdict, when the document is here to test that judgement. */
  documentTypeAssessment?: 'logic_model' | 'not_logic_model' | 'unclear';
  /**
   * Set on a document that prints the same model twice. The expected answer still asks for every
   * item on every page — anything printed should be extracted — so a dropped draft shows up as
   * lost recall rather than being defined away.
   */
  expectDropOneDraft?: boolean;
  slides: BenchmarkSlide[];
}

/**
 * Build the expected answer from the spec.
 *
 * Headings and non-grid columns become `tolerated` rather than expected items: a model that reads
 * "RESOURCES" as an item is doing something unhelpful but not wrong enough to call a miss, and an
 * impact statement is expected in a prose field this scorer does not grade. Group names are not
 * derived at all — see `GoldenAnswer` for why grouping is out of scope.
 */
export function goldenFromDocument(doc: BenchmarkDocument): GoldenAnswer {
  const items: Partial<Record<ScoredDomain, string[]>> = {};
  const tolerated: string[] = [];
  for (const slide of doc.slides) {
    tolerated.push(slide.title);
    for (const column of slide.columns) {
      tolerated.push(column.heading);
      if (column.domain === null) {
        tolerated.push(...column.items);
        continue;
      }
      const labels = new Set(column.labels ?? []);
      for (const item of column.items) {
        if (labels.has(item)) tolerated.push(item);
        else (items[column.domain] ??= []).push(...(column.splits?.[item] ?? [item]));
      }
    }
  }
  return {
    id: doc.id,
    label: doc.label,
    covers: doc.covers,
    organization: doc.organization,
    program: doc.program,
    documentTypeAssessment: doc.documentTypeAssessment,
    items,
    tolerated,
  };
}

/** The plain text of a document, in reading order — what a text-only bundle would carry. */
export function documentTextTrack(doc: BenchmarkDocument): string {
  const lines: string[] = [];
  doc.slides.forEach((slide, index) => {
    lines.push(`## Slide ${index + 1}`, '', `### ${slide.title}`, '');
    for (const column of slide.columns) {
      lines.push(`#### ${column.heading}`, '');
      for (const item of column.items) lines.push(`- ${item}`);
      lines.push('');
    }
  });
  return lines.join('\n');
}

/** Every item the document prints, grid or not — the denominator for "is this wording on a page". */
export function documentItemCount(doc: BenchmarkDocument): number {
  let n = 0;
  for (const slide of doc.slides) for (const column of slide.columns) n += column.items.length;
  return n;
}

export function parseBenchmarkDocument(raw: unknown, sourceLabel: string): BenchmarkDocument {
  const doc = raw as Partial<BenchmarkDocument>;
  if (!doc || typeof doc.id !== 'string' || !Array.isArray(doc.slides)) {
    throw new Error(`${sourceLabel}: not a benchmark document (needs id and slides[])`);
  }
  for (const slide of doc.slides) {
    if (!Array.isArray(slide?.columns)) throw new Error(`${sourceLabel}: slide without columns[]`);
    for (const column of slide.columns) {
      if (typeof column?.heading !== 'string' || !Array.isArray(column.items)) {
        throw new Error(`${sourceLabel}: column without a heading and items[]`);
      }
      for (const [printed, parts] of Object.entries(column.splits ?? {})) {
        if (!column.items.includes(printed)) {
          throw new Error(`${sourceLabel}: splits key is not printed in items[]: ${printed}`);
        }
        for (const part of parts) {
          if (!printed.includes(part)) {
            throw new Error(`${sourceLabel}: split part is not a substring of its cell: ${part}`);
          }
        }
      }
    }
  }
  return doc as BenchmarkDocument;
}
