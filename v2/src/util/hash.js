'use strict';

const crypto = require('crypto');
const fs = require('fs');

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

module.exports = { sha256, sha256File };
