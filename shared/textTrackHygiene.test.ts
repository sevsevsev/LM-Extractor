import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { binaryPayloadChars, stripBinaryPayloads } from './textTrackHygiene.ts';

const BLOB = 'iVBORw0KGgoAAAANSUhEUgAAAp4AAACQCAYAAAHW5FtcAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjw';

describe('stripBinaryPayloads', () => {
  it('removes a markdown image whose source is a data URI, alt text and all', () => {
    const md = `# Heading\n\n![https://lh4.googleusercontent.com/uHO5m4A7palSJe2](data:image/png;base64,${BLOB})\n\nReal content`;
    const out = stripBinaryPayloads(md);
    assert.ok(!out.includes('base64'), 'base64 payload survived');
    assert.ok(!out.includes('googleusercontent'), 'the image URL used as alt text survived');
    assert.ok(out.includes('# Heading') && out.includes('Real content'), 'readable content was destroyed');
  });

  it('keeps the link text when a LINK (not an image) wraps a data URI', () => {
    const out = stripBinaryPayloads(`See [the chart](data:image/png;base64,${BLOB}) for detail`);
    assert.equal(out, 'See the chart for detail');
  });

  it('removes a bare data URI with no surrounding markup', () => {
    const out = stripBinaryPayloads(`Logo: data:image/jpeg;base64,${BLOB} end`);
    assert.ok(!out.includes('base64'));
    assert.ok(out.startsWith('Logo:') && out.trimEnd().endsWith('end'));
  });

  it('leaves a track with no payloads byte-identical', () => {
    const clean = '# Logic Model\n\nRESOURCES ACTIVITIES OUTPUTS\n\n- Teaching Artists\n- Classrooms';
    assert.equal(stripBinaryPayloads(clean), clean);
  });

  /**
   * The word "data:" appears in ordinary prose ("data: collected quarterly"). Stripping must key
   * on the data-URI shape, not on the substring.
   */
  it('does not touch the word "data:" in prose', () => {
    const prose = 'Outputs data: collected quarterly and reported to the district.';
    assert.equal(stripBinaryPayloads(prose), prose);
  });

  it('has no size threshold — a small payload is stripped like a large one', () => {
    const small = `![](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)`;
    assert.equal(stripBinaryPayloads(small), '');
  });

  it('reports how much it removed', () => {
    const md = `Text\n\n![x](data:image/png;base64,${BLOB})\n\nMore`;
    assert.ok(binaryPayloadChars(md) > BLOB.length, 'should count the whole construct, not just the blob');
    assert.equal(binaryPayloadChars('nothing to strip'), 0);
  });
});
