/**
 * What exit code a regression run should end on.
 *
 * WHY THIS IS ITS OWN MODULE. The check used to exit 2 whenever ANY manifest document had no
 * captured bundle. Bundles are gitignored multi-MB rasters, so on any machine that has not
 * captured all seventeen — which is every fresh clone, and was the normal state of the repository
 * — the tier-1 guard reported failure while nothing was wrong. A guard that cries wolf in its
 * resting state is one people learn to ignore, which costs more than the case it was protecting.
 *
 * The case it WAS protecting is real and kept: a run where nothing was actually measured must not
 * look like a pass. So the rule is by what the run achieved, not by what it lacked.
 */
export interface RegressionTally {
  /** Manifest documents in scope for this run. */
  total: number;
  unchanged: number;
  changed: number;
  /** Documents whose bundle is not on this machine — an environment fact, not a regression. */
  missingBundles: number;
  /** Documents whose extract call errored — the API is down, or the key is missing. */
  failures: number;
  /**
   * Documents that ran but had no committed snapshot to be checked against. Counted separately
   * from `unchanged` because a first capture is not evidence of anything: until a person has read
   * it, it is one run of unknown quality, and writing it as the baseline makes whatever came out
   * that day the thing every later run is measured against.
   */
  unblessed: number;
  /** True when the run was invoked with --update, so a change is an intention, not a regression. */
  update: boolean;
  /** True when the caller asked for every manifest document to be measurable. */
  requireBundles: boolean;
}

export interface RegressionOutcome {
  exitCode: 0 | 1 | 2;
  /** One line saying why, printed as the run's last word. */
  summary: string;
}

export function regressionOutcome(tally: RegressionTally): RegressionOutcome {
  const measured = tally.unchanged + tally.changed;
  /** Documents that actually ran, whether or not there was anything to compare them with. */
  const produced = measured + tally.unblessed;

  if (tally.failures > 0) {
    return {
      exitCode: 2,
      summary: `${tally.failures} document(s) errored — is \`npm run dev\` running with GEMINI_API_KEY set?`,
    };
  }

  // Nothing ran is not a pass, whatever the reason. This is the case the old rule was really
  // guarding, and the only one that needs to be an error.
  if (produced === 0) {
    return {
      exitCode: 2,
      summary:
        tally.missingBundles > 0
          ? `Nothing was tested: all ${tally.missingBundles} document(s) in scope have no captured bundle. ` +
            'See fixtures/regression-set/README.md.'
          : 'Nothing was tested: no document in scope produced a result.',
    };
  }

  if (tally.requireBundles && tally.missingBundles > 0) {
    return {
      exitCode: 2,
      summary: `--require-bundles: ${tally.missingBundles} document(s) have no captured bundle on this machine.`,
    };
  }

  // A document with a bundle and no snapshot used to be blessed on the spot and counted as a pass.
  // That made an unread run the baseline silently, which is the one way this harness can launder a
  // defect into the thing every later run is measured against. Blessing is now asked for by name.
  if (tally.unblessed > 0 && !tally.update) {
    return {
      exitCode: 1,
      summary:
        `${tally.unblessed} document(s) ran with no committed snapshot and were NOT blessed. ` +
        'Read the extraction, then accept it with --only=<id> --update.',
    };
  }

  if (tally.changed > 0 && !tally.update) {
    return {
      exitCode: 1,
      summary: 'Output changed. If intended, re-run with --update to accept the new baseline.',
    };
  }

  const blessed = tally.unblessed > 0 ? ` ${tally.unblessed} new baseline(s) written.` : '';
  const skipped =
    tally.missingBundles > 0
      ? ` ${tally.missingBundles} document(s) skipped for want of a bundle — capture them to widen the guard.`
      : '';
  return {
    exitCode: 0,
    summary: tally.update
      ? `${produced} document(s) measured, baselines accepted.${blessed}${skipped}`
      : `${measured} document(s) measured, all unchanged.${skipped}`,
  };
}
