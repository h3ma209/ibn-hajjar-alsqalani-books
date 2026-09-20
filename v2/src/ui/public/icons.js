'use strict';

(function () {
  if (window.UIIcons) return;

/** Inline SVG icons — 20×20 stroke, currentColor */
const PATHS = {
  search: 'M9 17A8 8 0 1 0 9 1a8 8 0 0 0 0 16zM18 18l-4-4',
  home: 'M3 10.5L10 4l7 6.5V17a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1v-6.5z',
  list: 'M4 6h12M4 10h12M4 14h8',
  chart: 'M4 16V8M9 16V4M14 16v-6M19 16V6',
  book: 'M5 4h10a2 2 0 0 1 2 2v12H7a2 2 0 0 1-2-2V4zM7 4v14',
  scroll: 'M6 3h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM10 7h4M10 11h4',
  quote: 'M7 8c-1.5 1-2 2.5-2 4v4h4v-4H7M15 8c-1.5 1-2 2.5-2 4v4h4v-4h-3',
  network: 'M10 3v4M10 13v4M3 10h4M13 10h4M5.5 5.5l2.8 2.8M11.7 11.7l2.8 2.8M5.5 14.5l2.8-2.8M11.7 8.3l2.8-2.8',
  user: 'M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 18c0-3.5 3.1-6 7-6s7 2.5 7 6',
  chevL: 'M12 6l-6 6 6 6',
  chevR: 'M8 6l6 6-6 6',
  check: 'M4 10l4 4 8-8',
  warn: 'M10 3L2 17h16L10 3zM10 8v4M10 15h.01',
  back: 'M14 6L8 12l6 6',
  copy: 'M7 5h8a2 2 0 0 1 2 2v8M5 9H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1',
  sword: 'M14 3l3 3-7 7-3 1 1-3 7-7zM6 14l-4 4',
  heart: 'M10 17l-1.2-1.1C4.5 12.2 2 9.8 2 7a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 2.8-2.5 5.2-6.8 8.9L10 17z',
  map: 'M2 5l6-2 6 2 6-2v14l-6 2-6-2-6 2V5zM8 3v14M16 5v14',
  family: 'M7 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM15 12a2.5 2.5 0 1 0 0-5M3 18c0-2.5 2-4.5 4-4.5M13 18c0-1.8 1.5-3.5 3.5-3.5',
  empty: 'M6 4h8l2 2v12H6V4zM9 9h6M9 13h4',
};

function icon(name, extraClass = '') {
  const d = PATHS[name];
  if (!d) return '';
  return `<svg class="ico ${extraClass}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

window.UIIcons = { icon };
})();
