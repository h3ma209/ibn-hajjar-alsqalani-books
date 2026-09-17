'use strict';

const fs = require('fs');
const path = require('path');
const MDBReader = require('mdb-reader').default;

const { decodeArabic } = require('../util/arabic');
const { sha256File } = require('../util/hash');
const { BOOK } = require('../config');

/**
 * Read a Shamela .bok (Access MDB) into decoded pages and table of contents.
 *
 * Shamela layout: `Main` holds one metadata row, `b<bookId>` holds page text,
 * `t<bookId>` holds the TOC. Page text is windows-1256 and must be decoded
 * before anything else touches it.
 */
function readBook(bokPath, { withChecksum = true } = {}) {
  const buffer = fs.readFileSync(bokPath);
  const reader = new MDBReader(buffer);
  const tables = reader.getTableNames();

  const bodyTable = tables.find((t) => /^b\d+$/i.test(t));
  const tocTable = tables.find((t) => /^t\d+$/i.test(t));
  if (!bodyTable || !tocTable) {
    throw new Error(
      `Unexpected .bok layout: no body/toc table found. Tables: ${tables.join(', ')}`
    );
  }

  const main = reader.getTable('Main').getData()[0] || {};
  const bookId = main.BkId ?? null;
  if (BOOK.expected_book_id && bookId !== BOOK.expected_book_id) {
    process.stderr.write(
      `warning: book_id ${bookId} does not match expected ${BOOK.expected_book_id}; ` +
        'placement heuristics are tuned for al-Isabah\n'
    );
  }

  const pages = reader
    .getTable(bodyTable)
    .getData()
    .map((row) => ({
      id: row.id,
      page: row.page ?? null,
      part: row.part == null ? null : String(row.part),
      text: decodeArabic(row.nass),
    }))
    .sort((a, b) => (a.id || 0) - (b.id || 0));

  const toc = reader
    .getTable(tocTable)
    .getData()
    .map((row) => ({
      id: row.id,
      lvl: row.lvl,
      sub: row.sub ?? null,
      title: decodeArabic(row.tit).replace(/\s+/g, ' ').trim(),
    }))
    .sort((a, b) => a.id - b.id || a.lvl - b.lvl);

  const source = {
    slug: BOOK.slug,
    book_id: bookId,
    title: decodeArabic(main.Bk),
    author: decodeArabic(main.Auth),
    card: decodeArabic(main.Betaka),
    file: path.basename(bokPath),
    file_sha256: withChecksum ? sha256File(bokPath) : null,
    body_table: bodyTable,
    toc_table: tocTable,
    page_count: pages.length,
    toc_count: toc.length,
  };

  return { source, pages, toc };
}

module.exports = { readBook };
