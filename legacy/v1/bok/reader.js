/**
 * Shamela .bok (Access MDB) reader.
 *
 * A .bok holds three relevant tables:
 *   Main    - one row of book metadata
 *   b<id>   - page bodies (`nass`), one row per printed page
 *   t<id>   - table of contents, `tit` + `lvl` + `id` pointing into b<id>
 *
 * Text is stored as windows-1256 bytes that the MDB driver hands back as
 * latin1-ish strings, so every string field must be re-decoded.
 */

const fs = require('fs');
const path = require('path');
const MDBReader = require('mdb-reader').default;
const iconv = require('iconv-lite');

/** Slug used to namespace person ids across books. */
const BOOK_SLUGS = {
  9767: 'isabah',
};

function decodeArabic(value) {
  if (value == null) return '';
  return iconv.decode(Buffer.from(String(value), 'binary'), 'windows-1256');
}

function findBok(explicit, cwd = process.cwd()) {
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`bok not found: ${explicit}`);
    return path.resolve(explicit);
  }
  const hit = fs.readdirSync(cwd).find((f) => f.toLowerCase().endsWith('.bok'));
  if (!hit) throw new Error('No .bok found in cwd. Pass --bok <path>');
  return path.join(cwd, hit);
}

function readBook(bokPath) {
  const reader = new MDBReader(fs.readFileSync(bokPath));
  const tables = reader.getTableNames();
  const bodyTable = tables.find((t) => /^b\d+$/i.test(t));
  const tocTable = tables.find((t) => /^t\d+$/i.test(t));
  if (!bodyTable || !tocTable) {
    throw new Error(`Unexpected .bok layout. tables=${tables.join(',')}`);
  }

  const main = reader.getTable('Main').getData()[0] || {};
  const bookId = main.BkId ?? null;

  const meta = {
    slug: BOOK_SLUGS[bookId] || `bk${bookId}`,
    book_id: bookId,
    title: decodeArabic(main.Bk),
    author: decodeArabic(main.Auth),
    card: decodeArabic(main.Betaka),
    bok_file: path.basename(bokPath),
    body_table: bodyTable,
    toc_table: tocTable,
  };

  const pages = reader
    .getTable(bodyTable)
    .getData()
    .map((r) => ({
      id: r.id,
      page: r.page,
      part: r.part == null ? null : String(r.part),
      text: decodeArabic(r.nass),
    }))
    .sort((a, b) => (a.id || 0) - (b.id || 0));

  const toc = reader
    .getTable(tocTable)
    .getData()
    .map((r) => ({
      id: r.id,
      lvl: r.lvl,
      sub: r.sub,
      title: decodeArabic(r.tit),
    }))
    .sort((a, b) => a.id - b.id || a.lvl - b.lvl);

  return {
    meta,
    pages,
    pageById: new Map(pages.map((p) => [p.id, p])),
    toc,
  };
}

module.exports = { readBook, findBok, decodeArabic, BOOK_SLUGS };
