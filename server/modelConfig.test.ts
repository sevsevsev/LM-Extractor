import assert from 'node:assert/strict';
import test from 'node:test';
import { ThinkingLevel } from '@google/genai';
import { resolveThinkingLevel } from './modelConfig.ts';

test('unset means the shipped default, which is low and not the model default', () => {
  assert.equal(resolveThinkingLevel(undefined), ThinkingLevel.LOW);
  assert.equal(resolveThinkingLevel(''), ThinkingLevel.LOW);
  assert.equal(resolveThinkingLevel('   '), ThinkingLevel.LOW);
});

test('named levels resolve, case and surrounding space insensitively', () => {
  assert.equal(resolveThinkingLevel('low'), ThinkingLevel.LOW);
  assert.equal(resolveThinkingLevel('LOW'), ThinkingLevel.LOW);
  assert.equal(resolveThinkingLevel(' High '), ThinkingLevel.HIGH);
  assert.equal(resolveThinkingLevel('medium'), ThinkingLevel.MEDIUM);
  assert.equal(resolveThinkingLevel('minimal'), ThinkingLevel.MINIMAL);
});

/**
 * The arm that matters most for re-qualifying a model: send no `thinkingConfig` and let the model
 * decide. It has to be selectable from outside the code, because on `gemini-3.8-flash` it is the
 * arm that extracts the regression set correctly.
 */
test('default and none mean send no thinkingConfig', () => {
  assert.equal(resolveThinkingLevel('default'), undefined);
  assert.equal(resolveThinkingLevel('none'), undefined);
  assert.equal(resolveThinkingLevel('DEFAULT'), undefined);
});

/**
 * Refusing is the point. A silently ignored override would run the default and report its numbers
 * under the candidate's name — an experiment that lies is worse than one that will not start.
 */
test('an unrecognised level throws and names the valid ones', () => {
  assert.throws(() => resolveThinkingLevel('lowish'), /not a thinking level/);
  assert.throws(() => resolveThinkingLevel('0'), /minimal, low, medium, high, default/);
  assert.throws(() => resolveThinkingLevel('off'), /not a thinking level/);
});
