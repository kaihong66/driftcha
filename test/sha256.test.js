import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSha256, digestToHex } from '../src/pow/sha256.js';

const sha256 = createSha256();
const hex = input => digestToHex(sha256(input));

test('matches the FIPS 180-2 test vectors', () => {
  assert.equal(hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(
    hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
  );
});

test('matches node:crypto across block boundaries', () => {
  for (let len = 0; len <= 200; len++) {
    const input = 'x'.repeat(len);
    assert.equal(hex(input), createHash('sha256').update(input, 'latin1').digest('hex'), `length ${len}`);
  }
});
