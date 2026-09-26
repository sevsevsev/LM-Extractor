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

  if (tally.failures > 0) {
    return {
      exitCode: 2,
      summary: `${tally.failures} document(s) errored — is \`npm run dev\` running with GEMINI_API_KEY set?`,
    };
  }

  // Nothing measured is not a pass, whatever the reason. This is the case the old rule was really
  // guarding, and the only one that needs to be an error.
  if (measured === 0) {
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

  if (tally.changed > 0 && !tally.update) {
    return {
      exitCode: 1,
      summary: 'Output changed. If intended, re-run with --update to accept the new baseline.',
    };
  }

  const skipped =
    tally.missingBundles > 0
      ? ` ${tally.missingBundles} document(s) skipped for want of a bundle — capture them to widen the guard.`
      : '';
  return {
    exitCode: 0,
    summary: tally.update
      ? `${measured} document(s) measured, baselines accepted.${skipped}`
      : `${measured} document(s) measured, all unchanged.${skipped}`,
  };
}
