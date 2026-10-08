/**
 * Which input tracks a measurement run sends — an EXPERIMENT ARM for the two measurement scripts,
 * never a product setting.
 *
 * THE QUESTION IT ANSWERS. The app sends page rasters and the text track together, and the rasters
 * are roughly two-thirds of the input tokens. The two documents that failed most recently
 * (`inline-colon-labels`, `theory-of-change-own-voice`) were not vision failures — the text track
 * held every string. So it is worth knowing what the rasters buy, and that has never been run.
 *
 *   --input=both        (default) the bundle exactly as captured
 *   --input=text-only   drop the page images; the server then sends the text-only prompt variant
 *
 * The arm is applied to the bundle in the script, not in the server, so the server and both
 * providers run their normal code path: what is measured is the input, nothing else. The prompt
 * variant the server reports (`text-only`) is printed on every row, so the arm is visible in the
 * output as well as the run record.
 *
 * What text-only CANNOT see, stated so a good score is not over-read: column position and colour.
 * A document whose text track flattens its columns into one reading order, or whose meaning is
 * carried by colour, is exactly where this arm should lose, and the benchmark decks are generated
 * as clean column text boxes. A text-only win here is a reason to run the regression set, not a
 * reason to switch.
 */
export const INPUT_ARMS = ['both', 'text-only'] as const;
export type InputArm = (typeof INPUT_ARMS)[number];

export function inputArmFromArgs(args: readonly string[]): InputArm {
  const flag = args.find(a => a.startsWith('--input='));
  if (!flag) return 'both';
  const value = flag.slice('--input='.length).trim();
  if ((INPUT_ARMS as readonly string[]).includes(value)) return value as InputArm;
  throw new Error(`--input=${value} is not one of: ${INPUT_ARMS.join(', ')}`);
}

/**
 * The bundle this arm sends. Never mutates the captured bundle. A bundle with no text track cannot
 * be sent text-only, so it is refused rather than sent empty or sent with images under the wrong
 * label.
 */
export function applyInputArm<T extends { images?: unknown; imageRefs?: unknown; textTrack?: unknown }>(
  bundle: T,
  arm: InputArm
): T {
  if (arm === 'both') return bundle;
  const text = typeof bundle.textTrack === 'string' ? bundle.textTrack.trim() : '';
  if (!text) throw new Error('bundle has no text track, so it cannot run in the text-only arm');
  const { images: _images, imageRefs: _refs, ...rest } = bundle;
  return { ...rest, images: [] } as unknown as T;
}
