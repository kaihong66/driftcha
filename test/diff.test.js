import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffOf } from '../src/guards/typing.js';

test('detects an append', () => {
  assert.deepEqual(diffOf('12', '123'), { p: 2, removed: 0, inserted: '3' });
});

test('detects an insert in the middle', () => {
  assert.deepEqual(diffOf('124', '1234'), { p: 2, removed: 0, inserted: '3' });
});

test('detects a deletion', () => {
  assert.deepEqual(diffOf('1234', '134'), { p: 1, removed: 1, inserted: '' });
});

test('detects a replaced selection', () => {
  assert.deepEqual(diffOf('1234', '194'), { p: 1, removed: 2, inserted: '9' });
});

test('reports a bulk change as one big insert', () => {
  assert.deepEqual(diffOf('', '1234'), { p: 0, removed: 0, inserted: '1234' });
});
