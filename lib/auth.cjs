'use strict';

const { timingSafeEqual } = require('node:crypto');

function matchesSecret(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string' || !expected) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

module.exports = { matchesSecret };