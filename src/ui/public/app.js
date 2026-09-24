'use strict';

if (!window.UIIcons?.icon) {
  throw new Error('icons.js did not load');
}
const icon = window.UIIcons.icon;
const app = document.getElementById('app');
const foot = document.getElementById('foot');
const footText = document.getElementById('foot-text');
const searchForm = document.getElementById('search-form');
const qInput = document.getElementById('q');

const QISM = {
  1: { short: 'الأول', title: 'ثبتت صحبته', desc: 'من ثبتت صحبته أو قربت' },
  2: { short: 'الثاني', title: 'أدرك ورأى', desc: 'من أدرك النبي ﷺ ولم تصح صحبته' },
  3: { short: 'الثالث', title: 'المخضرمون', desc: 'من أسلم في الجاهلية ثم أدرك الإسلام' },
  4: { short: 'الرابع', title: 'الردّ والتصحيف', desc: 'من أُدخل خطأً — ليس من الصحابة' },
};

const SECTION_LABEL = { names: 'الأسماء', kunya: 'الكنى', women: 'النساء' };
const KIND_LABEL = {
  biography: 'ترجمة', crossref_stub: 'إحالة', name_only: 'اسم فقط',
  kunya_redirect: 'كنية محالة', qism4_refutation: 'ردّ القسم الرابع',
};
const CHAPTER_KIND = {
  preface: 'مقدمة', definition: 'تعريف', method: 'منهج', virtue_adala: 'العدالة',
  taxonomy: 'تقسيم', qism_heading: 'قسم', letter_heading: 'حرف',
  block_heading: 'باب', volume_heading: 'مجلد', other: 'أخرى',
};
const LABEL_AR = {
  nasab: 'نسب', name_dispute: 'خلاف اسم', isnad: 'إسناد', hadith_matn: 'متن حديث',
  citation: 'استشهاد', crossref: 'إحالة', battle: 'غزو', event: 'حادثة',
  death: 'وفاة', birth: 'ولادة', age: 'عمر', office: 'ولاية', family: 'قرابة',
  praise: 'توثيق', criticism: 'جرح', defense: 'دفاع', ibn_hajar_voice: 'كلام ابن حجر',
  poetry: 'شعر', quran: 'قرآن', editor_footnote: 'حاشية', heading: 'عنوان',
  boilerplate: 'قالب', unlabeled: 'سرد',
};
const LABEL_HINT = {
  nasab: 'اسم المترجم ونسبه',
  name_dispute: 'خلاف في تعيين الاسم',
  isnad: 'سلسلة رواة',
  hadith_matn: 'متن حديث أو قول نبوي',
  citation: 'نقل عن عالم أو كتاب',
  crossref: 'إحالة إلى موضع آخر في الإصابة',
  battle: 'غزوة أو مشهد قتال',
  event: 'حادثة: وفادة أو أسر أو جرح أو بيعة',
  death: 'وفاة أو قتل',
  birth: 'ولادة أو مولد',
  age: 'عمر أو سنّ',
  office: 'ولاية أو إمرة أو قضاء',
  family: 'قرابة أو زوج أو ولد',
  praise: 'تعديل أو ثناء',
  criticism: 'جرح أو تضعيف أو وهم',
  defense: 'جواب ابن حجر عن اعتراض',
  ibn_hajar_voice: 'كلام المصنف بصيغة قلتُ',
  poetry: 'بيت أو شاهد شعري',
  quran: 'آية أو قراءة',
  editor_footnote: 'حاشية المحقق',
  heading: 'رقم الترجمة أو عنوان',
  boilerplate: 'صيغة مكررة',
  unlabeled: 'سرد لم يُصنَّف',
};
const SPAN_CLASS = {
  nasab: 'span-nasab', name_dispute: 'span-dispute', isnad: 'span-isnad',
  hadith_matn: 'span-matn', citation: 'span-cite', crossref: 'span-xref',
  battle: 'span-battle', event: 'span-event', death: 'span-death',
  birth: 'span-birth', age: 'span-age', office: 'span-office',
  family: 'span-family', praise: 'span-ok', criticism: 'span-crit',
  defense: 'span-defense', ibn_hajar_voice: 'span-voice', poetry: 'span-poetry',
  quran: 'span-quran', editor_footnote: 'span-note', heading: 'span-head',
  boilerplate: 'span-boiler', unlabeled: 'span-plain',
};

const TYPE_LABEL = {
  family: 'قرابة', narrated_from: 'روى عن', narrated_to: 'روى عنه',
  see_section: 'إحالة — قسم', see_qism: 'إحالة — قِسم', see_letter: 'إحالة — حرف',
  see_adjacent: 'مجاور', see_relation: 'إحالة — نسب', see_entry: 'إحالة — ترجمة',
};

const REL_LABEL = {
  father: 'أب', mother: 'أم', son: 'ابن', daughter: 'ابنة',
  brother: 'أخ', sister: 'أخت', wife: 'زوجة', husband: 'زوج',
};

const LAYER_LABEL = { llm: 'استخراج ذكي', regex: 'قواعد', structural: 'هيكلي' };

const FILL_LABEL = {
  nasab_parsed: 'نسب محلّل', nasab_multi_link: 'نسب متعدد', nisba: 'نسبة', kunya: 'كنية',
  qism: 'قِسم', letter: 'حرف', summary: 'ترجمة مختصرة', death_year: 'سنة الوفاة',
  birth_year: 'سنة الولادة', conversion: 'إسلام', companionship: 'صحبة', battles: 'غزوات',
  offices: 'ولايات', family: 'قرابة', residences: 'سكن', traits: 'صفات',
  narrated_from: 'روى عن', narrated_to: 'روى عنه', praise: 'توثيق', criticism: 'جرح',
  defenses: 'دفاع', any_life_fact: 'أي معلومة حياتية',
};

const FACT_ICONS = {
  companionship: 'heart', battles: 'sword', offices: 'user', residences: 'map',
  family: 'family', traits: 'user', conversion: 'heart',
  narrated_from: 'scroll', narrated_to: 'scroll', praise: 'check', criticism: 'warn', defenses: 'check',
  dates: 'scroll', citations: 'quote', default: 'book',
};

const state = { meta: null };
const SIRA_VIEW_KEY = 'isabah.siraView';

function fmt(n) { return Number(n || 0).toLocaleString('ar-EG'); }
function pct(n) { return `${Math.round((Number(n) || 0) * 100)}٪`; }
function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function personHref(id) { return `#/p/${encodeURIComponent(id)}`; }

function qismChip(qism) {
  if (!qism) return '';
  const q = QISM[qism];
  return `<span class="chip q${qism}" title="${esc(q?.desc || '')}">ق ${qism} · ${esc(q?.short || '')}</span>`;
}

function layerChip(layer) {
  const cls = layer === 'llm' ? 'layer-llm' : layer === 'regex' ? 'layer-regex' : '';
  return `<span class="chip ${cls}">${esc(LAYER_LABEL[layer] || layer)}</span>`;
}

function provenance(fact) {
  if (!fact.source || fact.source === 'structural') return '';
  const src = LAYER_LABEL[fact.source] || fact.source;
  let cls = 'provenance';
  let ico = '';
  if (fact.confidence >= 0.85) { cls += ' ok'; ico = icon('check'); }
  else if (fact.confidence <= 0.6) { cls += ' weak'; ico = icon('warn'); }
  const hint = fact.confidence >= 0.85 ? 'شاهد من النص' : fact.confidence <= 0.6 ? 'غير متحقّق' : 'متحقّق جزئياً';
  return `<span class="${cls}" title="${hint}">${ico}${esc(src)}</span>`;
}

function emptyState(msg, hint) {
  return `<div class="empty-state">
    <div class="empty-icon">${icon('empty')}</div>
    <p>${esc(msg)}</p>
    ${hint ? `<p class="muted">${esc(hint)}</p>` : ''}
  </div>`;
}

function breadcrumb(items) {
  return `<nav class="breadcrumb" aria-label="مسار التصفّح">${items.map((item, i) => {
    if (i) return `<span class="sep">›</span>${item.href ? `<a href="${item.href}">${esc(item.label)}</a>` : `<span>${esc(item.label)}</span>`}`;
    return item.href ? `<a href="${item.href}">${esc(item.label)}</a>` : `<span>${esc(item.label)}</span>`;
  }).join('')}</nav>`;
}

async function api(path, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(path, { signal: ctrl.signal });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('انتهت مهلة الاتصال بالخادم');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function setNav(name) {
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
}

function setFooter(text) {
  if (!text) { foot.hidden = true; return; }
  foot.hidden = false;
  footText.textContent = text;
}

function injectStaticIcons() {
  const searchIcon = document.getElementById('search-icon');
  if (searchIcon) searchIcon.innerHTML = icon('search');
  document.querySelectorAll('.nav-ico').forEach((el) => {
    el.innerHTML = icon(el.dataset.ico);
  });
}

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, queryString] = raw.split('?');
  const params = new URLSearchParams(queryString || '');
  const person = path.match(/^\/p\/(.+)$/);
  const chapter = path.match(/^\/chapter\/(\d+)$/);
  if (path === '/' || path === '') return { page: 'overview', params };
  if (path === '/browse') return { page: 'browse', params };
  if (path === '/quality') return { page: 'quality', params };
  if (path === '/chapters') return { page: 'chapters', params };
  if (path === '/battles') return { page: 'battles', params };
  if (path === '/citations') return { page: 'citations', params };
  if (path === '/tribes') return { page: 'tribes', params };
  if (chapter) return { page: 'chapter', id: chapter[1], params };
  if (person) return { page: 'person', id: decodeURIComponent(person[1]), params };
  return { page: 'overview', params };
}

function go(path) { location.hash = String(path).replace(/^#/, ''); }

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = qInput.value.trim();
  const next = new URLSearchParams();
  if (q) next.set('q', q);
  go(`#/browse?${next.toString()}`);
});

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== qInput) {
    e.preventDefault();
    qInput.focus();
    qInput.select();
  }
});

/* ── Overview ── */

function renderOverview(meta) {
  setNav('overview');
  const qismTotal = Object.values(meta.qism || {}).reduce((s, n) => s + n, 0) || 1;
  const llmPct = pct(meta.quality?.llm_fact_coverage);
  setFooter(`${fmt(meta.counts.persons)} ترجمة · تغطية ذكية ${llmPct}`);

  app.innerHTML = `
    ${breadcrumb([{ href: '#/', label: 'الفهرس' }])}
    <header style="margin-bottom:1.5rem">
      <div class="section-kicker">${esc(meta.book.author_ar)}</div>
      <h1 class="section-title">${esc(meta.book.title_ar)}</h1>
      <p class="lead">فهرس ${fmt(meta.counts.persons)} ترجمة من طبعة الشاملة — نسب، روابط، واستشهادات مع شواهد من النص.</p>
    </header>

    <div class="stat-row">
      <div class="stat-box"><b>${fmt(meta.counts.persons)}</b><span>ترجمة</span></div>
      <div class="stat-box"><b>${fmt(meta.counts.women)}</b><span>من النساء</span></div>
      <div class="stat-box"><b>${fmt(meta.counts.edges)}</b><span>رابطة</span></div>
      <div class="stat-box"><b>${fmt(meta.counts.citations)}</b><span>استشهاد</span></div>
      <div class="stat-box"><b>${llmPct}</b><span>تغطية ذكية</span></div>
    </div>

    <section aria-label="الأقسام الأربعة">
      <div class="qism-row">
        ${[1, 2, 3, 4].map((q) => {
          const info = QISM[q];
          const n = meta.qism?.[q] || 0;
          return `<div class="qism-card q${q}">
            <div class="q-num">${fmt(n)}</div>
            <div class="q-title">القسم ${info.short} — ${esc(info.title)}</div>
            <div class="q-desc">${pct(n / qismTotal)} · ${esc(info.desc)}</div>
          </div>`;
        }).join('')}
      </div>
    </section>

    <div class="page-split">
      <section class="card">
        <div class="card-head">${icon('book')}<h2>نماذج من التراجم</h2></div>
        <div class="tarjama-list">${(meta.featured || []).map(tarjamaItem).join('')}</div>
      </section>
      <section>
        <div class="card">
          <div class="card-head">${icon('list')}<h2>أبواب الكتاب</h2></div>
          ${Object.entries(meta.sections || {}).map(([key, n]) => {
            const total = Object.values(meta.sections).reduce((s, x) => s + x, 0) || 1;
            return `<div class="meter"><span>${esc(SECTION_LABEL[key] || key)}</span>
              <div class="meter-track"><div class="meter-fill" style="width:${(n / total) * 100}%"></div></div>
              <span>${fmt(n)}</span></div>`;
          }).join('')}
        </div>
        <div class="card">
          <div class="card-head">${icon('chart')}<h2>امتلاء الحقول</h2></div>
          ${Object.entries(meta.quality?.fill_rates || {})
            .filter(([k]) => ['companionship', 'kunya', 'battles', 'family', 'death_year'].includes(k))
            .sort((a, b) => b[1].rate - a[1].rate)
            .map(([k, v]) =>
              `<div class="meter"><span>${esc(FILL_LABEL[k] || k)}</span>
                <div class="meter-track"><div class="meter-fill" style="width:${v.rate * 100}%"></div></div>
                <span>${pct(v.rate)}</span></div>`
            ).join('')}
          <p class="muted" style="margin-top:0.85rem;font-size:0.88rem">رفض النسب ${pct(meta.quality?.nasab_rejection_rate)} · تغطية ${pct(meta.manifest?.coverage)}</p>
        </div>
      </section>
    </div>`;
}

/* ── Browse ── */

function letterSidebar(params) {
  const current = params.get('letter') || '';
  const items = (state.meta?.letters || []).map((item) => {
    const next = new URLSearchParams(params);
    next.set('letter', item.letter);
    next.delete('offset');
    return `<a href="#/browse?${next.toString()}" class="${current === item.letter ? 'active' : ''}">${esc(item.letter)} <span class="muted">(${fmt(item.count)})</span></a>`;
  }).join('');
  return `<aside class="letter-sidebar"><h3>حروف المعجم</h3>${items}</aside>`;
}

function filterControls(params) {
  const letters = (state.meta?.letters || []).map((item) =>
    `<option value="${esc(item.letter)}" ${params.get('letter') === item.letter ? 'selected' : ''}>${esc(item.letter)} (${fmt(item.count)})</option>`
  ).join('');
  return `<div class="filters">
    <select data-filter="qism" aria-label="القسم"><option value="">كل الأقسام</option>
      ${[1, 2, 3, 4].map((q) => `<option value="${q}" ${params.get('qism') === String(q) ? 'selected' : ''}>${QISM[q].short} — ${QISM[q].title}</option>`).join('')}
    </select>
    <select data-filter="section" aria-label="الباب"><option value="">كل الأبواب</option>
      ${Object.entries(SECTION_LABEL).map(([k, v]) => `<option value="${k}" ${params.get('section') === k ? 'selected' : ''}>${v}</option>`).join('')}
    </select>
    <select data-filter="letter" class="mobile-letter" aria-label="الحرف"><option value="">كل الحروف</option>${letters}</select>
    <select data-filter="woman" aria-label="الجنس"><option value="">الكل</option>
      <option value="1" ${params.get('woman') === '1' ? 'selected' : ''}>النساء</option>
      <option value="0" ${params.get('woman') === '0' ? 'selected' : ''}>الرجال</option>
    </select>
    <select data-filter="entry_kind" aria-label="نوع المدخل"><option value="">كل الأنواع</option>
      ${Object.entries(KIND_LABEL).map(([k, v]) => `<option value="${k}" ${params.get('entry_kind') === k ? 'selected' : ''}>${v}</option>`).join('')}
    </select>
    <label class="filter-check"><input type="checkbox" data-filter="in_text" value="1" ${params.get('in_text') === '1' ? 'checked' : ''}/> داخل النص</label>
  </div>`;
}

function tarjamaItem(row) {
  return `<a class="tarjama-item" href="${personHref(row.person_id)}">
    <span class="num">${esc(row.entry_number)}</span>
    <span>
      <span class="name">${esc(row.display_name)}</span>
      <div class="meta">${esc(row.full_name || '')}${row.volume ? ` · ج ${esc(row.volume)}` : ''}${row.page_start ? ` · ص ${esc(row.page_start)}` : ''}</div>
    </span>
    <span class="tags">
      ${qismChip(row.qism)}
      ${row.section_type ? `<span class="chip">${esc(SECTION_LABEL[row.section_type] || row.section_type)}</span>` : ''}
      ${row.entry_kind && row.entry_kind !== 'biography' ? `<span class="chip">${esc(KIND_LABEL[row.entry_kind] || row.entry_kind)}</span>` : ''}
      ${row.is_woman ? '<span class="chip">امرأة</span>' : ''}
      ${row.entry_number_is_ambiguous ? '<span class="chip warn">رقم مكرر</span>' : ''}
    </span>
  </a>`;
}

function renderHits(data) {
  if (!data.results.length) {
    return emptyState('لا نتائج مطابقة', 'جرّب اسماً آخر أو رقماً مختلفاً');
  }
  return `<div class="tarjama-list">${data.results.map(tarjamaItem).join('')}</div>`;
}

async function renderBrowse(params) {
  setNav('browse');
  const q = params.get('q') || '';
  qInput.value = q;
  const qs = new URLSearchParams(params);
  qs.set('limit', '40');
  const data = await api(`/api/search?${qs.toString()}`);
  const offset = Number(data.offset) || 0;
  const nextOff = offset + data.results.length;
  const prevOff = Math.max(0, offset - 40);
  setFooter(`${fmt(data.total)} ترجمة`);

  app.innerHTML = `
    ${breadcrumb([{ href: '#/', label: 'الفهرس' }, { href: '#/browse', label: 'التراجم' }, { label: data.query ? data.resolved_query : 'الكل' }])}
    <header style="margin-bottom:1.25rem">
      <h1 class="section-title">${data.query ? `نتائج «${esc(data.resolved_query)}»` : 'تصفّح التراجم'}</h1>
      <p class="muted">${fmt(data.total)} ترجمة · اضغط <kbd>/</kbd> للبحث السريع</p>
    </header>
    <div class="browse-grid">
      ${letterSidebar(params)}
      <div>
        ${filterControls(params)}
        ${renderHits(data)}
        <div class="pager">
          <button class="pager-btn" ${offset === 0 ? 'disabled' : ''} data-go="${prevOff}">${icon('chevR')} السابق</button>
          <span class="muted">${fmt(offset + 1)}–${fmt(offset + data.results.length)} من ${fmt(data.total)}</span>
          <button class="pager-btn" ${nextOff >= data.total ? 'disabled' : ''} data-go="${nextOff}">التالي ${icon('chevL')}</button>
        </div>
      </div>
    </div>`;

  wireFilters(params);
  app.querySelectorAll('[data-go]').forEach((el) => {
    el.addEventListener('click', () => {
      const next = new URLSearchParams(params);
      next.set('offset', el.dataset.go);
      go(`#/browse?${next.toString()}`);
    });
  });
}

function wireFilters(params) {
  app.querySelectorAll('[data-filter]').forEach((el) => {
    el.addEventListener('change', () => {
      const next = new URLSearchParams(params);
      if (el.type === 'checkbox') {
        if (el.checked) next.set(el.dataset.filter, el.value || '1');
        else next.delete(el.dataset.filter);
      } else if (el.value) next.set(el.dataset.filter, el.value);
      else next.delete(el.dataset.filter);
      next.delete('offset');
      go(`#/browse?${next.toString()}`);
    });
  });
}

/* ── Person ── */

function factItem(fact) {
  const value = fact.value ?? fact.name ?? '';
  return `<div class="fact-item">
    <span class="val">${esc(value)}</span>
    <div class="meta-row">${provenance(fact)}</div>
    ${fact.evidence ? `<div class="shahid"><div class="shahid-label">${icon('quote')} شاهد من النص</div>${esc(fact.evidence)}</div>` : ''}
  </div>`;
}

function factGroup(title, facts, iconName, mapFn = factItem) {
  const list = (facts || []).filter(Boolean);
  if (!list.length) return '';
  const ico = icon(FACT_ICONS[iconName] || FACT_ICONS.default);
  return `<div class="fact-group">
    <div class="fact-group-head">${ico}<h3>${title}</h3><span class="count">${fmt(list.length)}</span></div>
    ${list.map(mapFn).join('')}
  </div>`;
}

function yearBlock(event, label) {
  if (!event || (!event.year_hijri && !event.place && !(event.year_candidates || []).length)) return '';
  const years = event.year_candidates?.length ? event.year_candidates.join(' / ') : event.year_hijri;
  return `<div class="hijri-block">
    <span class="year">${esc(label)}: ${esc(years || '—')}</span>
    ${event.place ? `<span class="muted"> · ${esc(event.place)}</span>` : ''}
    ${event.year_uncertain ? ' <span class="chip warn">متردّد</span>' : ''}
  </div>`;
}

function getSiraView() {
  return localStorage.getItem(SIRA_VIEW_KEY) === 'cards' ? 'cards' : 'narrative';
}

function setSiraView(view) {
  localStorage.setItem(SIRA_VIEW_KEY, view);
}

function factTexts(arr) {
  return (arr || []).map((f) => String(f.value ?? f.name ?? '').trim()).filter(Boolean);
}

function joinArabic(items) {
  const list = items.filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} و${list[1]}`;
  return `${list.slice(0, -1).join('، ')}، و${list[list.length - 1]}`;
}

function isStubSummary(text) {
  return !text || /^\d+\s*[-–—]/.test(text.trim()) || text.trim().length < 16;
}

function cleanSiraText(text) {
  return String(text || '')
    .replace(/\[\s*\(\s*\d+\s*\)\s*\]/gu, '')
    .replace(/^\d+\s*[-–—:]\s*/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function clipSira(text, max = 240) {
  const src = cleanSiraText(text);
  if (src.length <= max) return src;
  return `${src.slice(0, max).replace(/\s+\S*$/u, '')}…`;
}

function factStory(fact) {
  if (!fact) return '';
  const value = cleanSiraText(fact.value ?? fact.name ?? '');
  const evidence = cleanSiraText(fact.evidence || '');
  if (evidence && evidence.length > Math.max(18, value.length + 6)) return clipSira(evidence, 280);
  return clipSira(value, 280);
}

function uniqueStory(items, limit = 8) {
  const seen = new Set();
  const out = [];
  for (const raw of items) {
    const text = cleanSiraText(raw);
    if (!text || text.length < 3) continue;
    const key = text.replace(/[.؟!،:]+$/u, '').slice(0, 48);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function endSentence(text) {
  const src = cleanSiraText(text);
  if (!src) return '';
  return /[.؟!]$/u.test(src) ? src : `${src}.`;
}

function yearNarrative(event, verb) {
  if (!event) return '';
  const years = event.year_candidates?.length
    ? event.year_candidates
    : (event.year_hijri != null ? [event.year_hijri] : []);
  if (!years.length && !event.place && !event.cause) return '';
  let phrase = verb;
  if (years.length === 1) phrase += ` سنة ${years[0]} للهجرة`;
  else if (years.length > 1) phrase += ` في إحدى سنوات ${joinArabic(years.map(String))} للهجرة`;
  if (event.place) phrase += ` في ${event.place}`;
  if (event.cause) phrase += `، وسبب ذلك ${event.cause}`;
  if (event.year_uncertain) phrase += '، والتاريخ متردّد في المصادر';
  return phrase;
}

function qismNarrative(qism, isWoman) {
  const who = isWoman ? 'هي' : 'هو';
  const map = {
    1: `${who} من الصحابة الذين ثبتت صحبتهم في الإصابة`,
    2: `${who} ممّن أدرك النبيّ ﷺ ولم تثبت صحبته`,
    3: `${who} من المخضرمين الذين عاشوا الجاهلية والإسلام`,
    4: `${who} ممّن ذكر خطأً بين الصحابة`,
  };
  return map[qism] || '';
}

const ORIGIN_AR = { muhajir: 'من المهاجرين', ansari: 'من الأنصار' };
const STATUS_AR = { mawla: 'مولى', free: 'حرّ' };
const GEN_AR = { mukhadram: 'من المخضرمين', tabii_mentioned: 'من التابعين المذكورين في الكتاب' };
const EVENT_VERB = {
  battle: 'شهد', sariyya: 'خرج في سرية', siege: 'حضر حصار', conquest: 'شهد فتح',
  ridda: 'شهد الردة في', fitna: 'أدرك فتنة', treaty: 'شهد', bayah: 'بايع في',
  hudna: 'شهد هدنة', hijra: 'هاجر', wufd: 'وفد', embassy: 'أُرسل في',
  exile: 'أُخرج في', settlement: 'نزل', wound: 'جرح يوم', captivity: 'أُسر في',
  ransom: 'فودي في', martyrdom: 'استشهد في', killing: 'قُتل في', plague: 'أصابه الطاعون في',
  assassination: 'اغتيل', meeting: 'لقي النبيّ في', letter_from_prophet: 'كتب إليه النبيّ في',
  letter_to_prophet: 'كتب إلى النبيّ في', gift: 'وُهب', duaa: 'دعا له النبيّ في',
  bashara: 'بُشّر في', marriage: 'تزوج', divorce: 'طلّق', childbirth: 'وُلد له في',
  manumission: 'أُعتق', inheritance: 'ورث', land: 'أُقطع أرضا في',
  horse_or_property: 'ذُكر له مال في', quran: 'له قراءة في', poetry: 'له شعر في',
  fatwa: 'أفتى في', dream: 'رؤيا في', karama: 'كرامة في', incident: '',
};

function foldAr(text) {
  return String(text || '').replace(/[ًٌٍَُِّْٱ]/gu, '').replace(/[أإآ]/gu, 'ا');
}

function eventStory(ev) {
  const evidence = cleanSiraText(ev.evidence || '');
  const value = cleanSiraText(ev.value || '');
  if (evidence.length > 18 && evidence !== value) return clipSira(evidence, 220);
  const verb = EVENT_VERB[ev.kind] || 'ذُكر في';
  const when = ev.year_hijri != null ? ` سنة ${ev.year_hijri}` : '';
  const where = ev.place ? ` في ${ev.place}` : '';
  if (!value && !verb) return '';
  let head = value || verb;
  if (verb && value) {
    const fv = foldAr(value);
    const fb = foldAr(verb);
    if (value.startsWith(verb) || fb.includes(fv) || fv.includes(fb)) head = verb.length >= value.length ? verb : value;
    else head = `${verb} ${value}`;
  }
  return clipSira(`${head}${when}${where}`, 180);
}

function alreadyTold(text, pool) {
  const needle = foldAr(cleanSiraText(text));
  if (!needle || needle.length < 6) return true;
  return (pool || []).some((row) => {
    const hay = foldAr(cleanSiraText(row));
    if (!hay) return false;
    const a = needle.slice(0, 22);
    const b = hay.slice(0, 22);
    return hay.includes(a) || needle.includes(b);
  });
}

function usefulSummary(summary, name, fullName) {
  if (!summary || isStubSummary(summary)) return '';
  const norm = cleanSiraText(summary);
  if (!norm) return '';
  if (fullName && norm.startsWith(fullName) && norm.length < fullName.length + 24) return '';
  if (name && (norm === name || norm.startsWith(`${name}.`))) return '';
  return norm.replace(/[.؟!…]+$/u, '').trim();
}

function composeSiraNarrative(p, ctx = {}) {
  const { identity, classification, life, narration = {}, entry = {} } = p;
  const name = identity.display_name;
  const fullName = identity.nasab?.full_name;
  const kunya = identity.kunya;
  const nisba = identity.nasab?.nisba || [];
  const summary = life.summary?.value || (typeof life.summary === 'string' ? life.summary : '');
  const paragraphs = [];
  const used = new Set();
  const remember = (text) => {
    const key = cleanSiraText(text).replace(/[.؟!،:]+$/u, '').slice(0, 40);
    if (!key || used.has(key)) return false;
    used.add(key);
    return true;
  };

  const opener = [];
  opener.push(identity.is_woman ? `في تراجم النساء يذكر ابن حجر ${name}` : name);
  if (fullName && fullName !== name) {
    if (fullName.startsWith(name)) {
      const tail = fullName.slice(name.length).replace(/^[\s،]+/u, '').trim();
      if (tail) opener.push(`من ${tail}`);
    } else {
      opener.push(`واسمه ${fullName}`);
    }
  }
  if (kunya && kunya !== name && !name.includes(kunya)) opener.push(`كنيته ${kunya}`);
  if (nisba.length) opener.push(`يُنسب ${joinArabic(nisba)}`);
  if (ORIGIN_AR[classification.origin]) opener.push(ORIGIN_AR[classification.origin]);
  if (STATUS_AR[classification.status]) opener.push(STATUS_AR[classification.status]);
  if (GEN_AR[classification.generation]) opener.push(GEN_AR[classification.generation]);
  const qismLine = qismNarrative(classification.qism, identity.is_woman);
  if (qismLine) opener.push(qismLine);
  if (classification.letter) opener.push(`في ${classification.letter}`);
  const extra = usefulSummary(summary, name, fullName);
  const storyFacts = uniqueStory([
    ...(life.conversion || []).map(factStory),
    ...(life.companionship || []).map(factStory),
  ], 8);
  if (extra && !storyFacts.some((line) => alreadyTold(extra, [line]) || alreadyTold(line, [extra]))) {
    opener.push(extra);
  }
  paragraphs.push(endSentence(opener.join('، ')));

  const alts = (identity.alternate_names || []).map((n) => n.value || n.name || n).filter(Boolean);
  const disputes = (identity.name_dispute_notes || []).map(factStory).filter(Boolean);
  if (alts.length || disputes.length) {
    const bits = [];
    if (alts.length) bits.push(`ويقال أيضا ${joinArabic(uniqueStory(alts, 5))}`);
    if (disputes.length) bits.push(`وفي تعيين اسمه خلاف: ${joinArabic(uniqueStory(disputes, 3))}`);
    paragraphs.push(endSentence(bits.join('، ')));
  }

  if (storyFacts.length) {
    paragraphs.push(storyFacts.map(endSentence).join(' '));
    storyFacts.forEach(remember);
  }

  const birth = yearNarrative(life.birth, 'وُلِد');
  const birthNotes = (life.birth?.notes || []).map(factStory);
  if (birth || birthNotes.length) {
    paragraphs.push(endSentence([birth, ...uniqueStory(birthNotes, 2)].filter(Boolean).join('، ')));
  }

  const toldSoFar = () => [...paragraphs, ...storyFacts];
  const eventLines = uniqueStory((life.events || []).map(eventStory), 8)
    .filter((line) => !alreadyTold(line, toldSoFar()));
  const battleNames = uniqueStory(factTexts(life.battles), 8);
  const leftoverBattles = battleNames.filter((bName) =>
    !alreadyTold(bName, [...toldSoFar(), ...eventLines]) && remember(bName)
  );
  if (eventLines.length || leftoverBattles.length) {
    const bits = eventLines.map(endSentence);
    if (leftoverBattles.length) {
      bits.push(endSentence(leftoverBattles.length > 1
        ? `وشهد ${joinArabic(leftoverBattles)}`
        : `ويُذكر له حضور ${leftoverBattles[0]}`));
    }
    paragraphs.push(bits.join(' '));
    eventLines.forEach(remember);
  }

  const offices = uniqueStory((life.offices || []).map((o) => {
    const story = factStory(o);
    const extra = [o.role, o.place].filter(Boolean).join(' في ');
    return extra && story && !story.includes(extra) ? `${story} (${extra})` : story;
  }), 6);
  if (offices.length) paragraphs.push(endSentence(`وفي الولايات والمناصب: ${joinArabic(offices)}`));

  const family = uniqueStory((life.family || []).map((f) => {
    const rel = REL_LABEL[f.relation] || f.relation || '';
    const nm = cleanSiraText(f.value || f.name || '');
    return rel ? `${rel} ${nm}`.trim() : nm;
  }), 8);
  if (family.length) paragraphs.push(endSentence(`ومن قرابته ${joinArabic(family)}`));

  const residences = uniqueStory(factTexts(life.residences), 5);
  if (residences.length) paragraphs.push(endSentence(`وسكن ${joinArabic(residences)}`));

  const traits = uniqueStory((life.traits || []).map(factStory), 5);
  if (traits.length) paragraphs.push(endSentence(`ويُوصف بأنه ${joinArabic(traits)}`));

  const wounds = uniqueStory((life.wounds || []).map(factStory), 4);
  if (wounds.length) paragraphs.push(endSentence(`وذُكر من جراحه ${joinArabic(wounds)}`));

  const ages = uniqueStory((life.ages || []).map((a) => {
    if (a.years != null && a.kind === 'at_death') return `عاش نحو ${a.years} سنة`;
    if (a.years != null && a.kind === 'at_islam') return `أسلم وهو ابن ${a.years} سنة`;
    return factStory(a);
  }), 3);
  if (ages.length) paragraphs.push(endSentence(joinArabic(ages)));

  const goods = uniqueStory((life.possessions || []).map(factStory), 3);
  if (goods.length) paragraphs.push(endSentence(`وذُكر من ماله ${joinArabic(goods)}`));

  const from = uniqueStory((narration.narrated_from || []).map((f) => f.value || f.name), 8);
  const to = uniqueStory((narration.narrated_to || []).map((f) => f.value || f.name), 8);
  const riwaya = [];
  if (from.length) riwaya.push(`روى عن ${joinArabic(from)}`);
  if (to.length) riwaya.push(`روى عنه ${joinArabic(to)}`);
  if (narration.hadith_count?.count != null) {
    riwaya.push(`ويُذكر له نحو ${narration.hadith_count.count} حديث`);
  } else if (narration.hadith_count?.value) {
    riwaya.push(`وفي عدد حديثه ${narration.hadith_count.value}`);
  }
  if (narration.is_prolific) riwaya.push('وهو من المكثرين');
  if (riwaya.length) paragraphs.push(endSentence(riwaya.join('، ')));

  const praise = uniqueStory((narration.praise || []).map(factStory), 4);
  const criticism = uniqueStory((narration.criticism || []).map(factStory), 4);
  const defenses = uniqueStory((narration.defenses || []).map(factStory), 3);
  if (praise.length) paragraphs.push(endSentence(`وفي التوثيق ${joinArabic(praise)}`));
  if (criticism.length) paragraphs.push(endSentence(`وفي الجرح ${joinArabic(criticism)}`));
  if (defenses.length) paragraphs.push(endSentence(`ودفع ابن حجر عنه بأن ${joinArabic(defenses)}`));

  const authorities = uniqueStory((ctx.citations || []).map((c) => c.authority || c.value), 8);
  if (authorities.length) {
    paragraphs.push(endSentence(`واستشهد ابن حجر في هذه الترجمة بـ${joinArabic(authorities)}`));
  }

  const death = yearNarrative(life.death, 'وتُوفّي');
  const deathNotes = uniqueStory((life.death?.notes || []).map(factStory), 3);
  if (death || deathNotes.length) {
    paragraphs.push(endSentence([death, ...deathNotes].filter(Boolean).join(' ')));
  }

  const excerpts = siraExcerptsFromText(ctx.text || '', used, entry.char_len || 0, paragraphs);
  if (excerpts.length) paragraphs.push(...excerpts);

  const body = paragraphs.filter((para) => para.replace(/[.؟!…\s]/gu, '').length > 10);
  if (body.length <= 1 && isStubSummary(summary) && !hasLifeContent(p) && !authorities.length) return [];
  return body;
}

function siraExcerptsFromText(text, used, charLen, told = []) {
  const source = String(text || '').trim();
  if (!source) return [];
  const parts = (typeof splitSentencesLocal === 'function'
    ? splitSentencesLocal(source)
    : source.split(/(?<=[.؟!])\s+/u).map((text) => ({ text })));
  const prefer = new Set([
    'event', 'battle', 'death', 'office', 'family', 'ibn_hajar_voice',
    'name_dispute', 'praise', 'criticism', 'age', 'birth', 'citation',
    'hadith_matn', 'defense',
  ]);
  const short = charLen > 0 && charLen < 900;
  const picked = [];
  for (const part of parts) {
    const quote = cleanSiraText(part.text || part.quote || '');
    if (quote.length < 12 || quote.length > 320) continue;
    if (/^[\u0600-\u06FF\s]{1,40}\s*:?\s*$/u.test(quote)) continue;
    if (alreadyTold(quote, [...told, ...picked])) continue;
    const label = typeof labelQuote === 'function' ? labelQuote(quote) : 'unlabeled';
    if (label === 'heading' || label === 'boilerplate' || label === 'editor_footnote') continue;
    if (!prefer.has(label) && !(short && label === 'unlabeled')) continue;
    const key = quote.replace(/[.؟!،:]+$/u, '').slice(0, 40);
    if (used.has(key)) continue;
    used.add(key);
    picked.push(quote);
    if (picked.length >= (short ? 10 : 8)) break;
  }
  if (!picked.length) return [];
  const chunks = [];
  for (let i = 0; i < picked.length; i += 3) {
    chunks.push(picked.slice(i, i + 3).map(endSentence).join(' '));
  }
  return chunks;
}

function renderSiraCards(p) {
  return `<div class="fact-grid">
    <div>
      ${(yearBlock(p.life.birth, 'الولادة') || yearBlock(p.life.death, 'الوفاة'))
        ? `<div class="fact-group"><div class="fact-group-head">${icon('scroll')}<h3>الميلاد والوفاة</h3></div>${yearBlock(p.life.birth, 'الولادة')}${yearBlock(p.life.death, 'الوفاة')}</div>`
        : ''}
      ${factGroup('الصحبة', p.life.companionship, 'companionship')}
      ${factGroup('الغزوات', p.life.battles, 'battles')}
      ${factGroup('الولايات', p.life.offices, 'offices', (f) =>
        factItem({ ...f, value: [f.value, f.role, f.place].filter(Boolean).join(' · ') }))}
      ${factGroup('السكن', p.life.residences, 'residences')}
    </div>
    <div>
      ${factGroup('القرابة', p.life.family, 'family', (f) =>
        factItem({ ...f, value: `${REL_LABEL[f.relation] || f.relation || ''} ${f.value || f.name || ''}`.trim() }))}
      ${factGroup('الصفات', p.life.traits, 'traits')}
      ${factGroup('الإسلام', p.life.conversion, 'conversion')}
    </div>
  </div>`;
}

function renderSiraNarrative(p, ctx = {}) {
  const paragraphs = composeSiraNarrative(p, ctx);
  if (!paragraphs.length) {
    return emptyState(
      'لا يكفي من المعلومات لسرد السيرة',
      'جرّب عرض البطاقات أو اقرأ النص الأصلي من تبويب «النص الأصلي»'
    );
  }
  return `<article class="sira-narrative" lang="ar">
    ${paragraphs.map((para, i) =>
      `<p class="${i === 0 ? 'sira-narrative-lead' : ''}">${esc(para)}</p>`
    ).join('')}
    <footer class="sira-narrative-foot muted">سرد مركّب من حقول الترجمة وشواهد النص — ليس حرف ابن حجر بنظمه</footer>
  </article>`;
}

function renderSiraContent(p, view, ctx = {}) {
  if (view === 'narrative') return renderSiraNarrative(p, ctx);
  const cards = renderSiraCards(p);
  const summary = p.life.summary?.value || (typeof p.life.summary === 'string' ? p.life.summary : '');
  if (!summary && !hasLifeContent(p)) {
    return cards + emptyState('لا معلومات حياتية مستخرجة', 'قد تكون ترجمة مختصرة أو إحالة لترجمة أخرى');
  }
  return cards;
}

function siraViewToggle(view) {
  return `<div class="sira-view-toggle" role="group" aria-label="طريقة عرض السيرة">
    <button type="button" class="${view === 'cards' ? 'active' : ''}" data-sira-view="cards">${icon('list')} بطاقات</button>
    <button type="button" class="${view === 'narrative' ? 'active' : ''}" data-sira-view="narrative">${icon('scroll')} سرد</button>
  </div>`;
}

function initSiraView(container, person, ctx = {}) {
  const toolbar = container.querySelector('.sira-toolbar');
  const content = container.querySelector('.sira-content');
  if (!toolbar || !content) return;

  toolbar.querySelectorAll('[data-sira-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.siraView;
      setSiraView(view);
      toolbar.querySelectorAll('[data-sira-view]').forEach((b) => {
        b.classList.toggle('active', b.dataset.siraView === view);
      });
      content.dataset.siraView = view;
      content.innerHTML = renderSiraContent(person, view, ctx);
    });
  });
}

function drawGraph(svg, graph) {
  if (!svg) return;
  const w = svg.clientWidth || 640;
  const h = svg.clientHeight || 360;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const cx = w / 2, cy = h / 2;
  const others = graph.nodes.filter((n) => n.person_id !== graph.center);
  const r = Math.min(w, h) * 0.36;
  const pos = new Map([[graph.center, { x: cx, y: cy }]]);
  others.forEach((node, i) => {
    const angle = (i / Math.max(others.length, 1)) * Math.PI * 2 - Math.PI / 2;
    pos.set(node.person_id, { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  });
  const edgeClass = (type) => type.startsWith('see') ? 'edge-see' : type === 'family' ? 'edge-family' : `edge-${type}`;
  const lines = graph.links.map((link) => {
    const a = pos.get(link.from), b = pos.get(link.to);
    if (!a || !b) return '';
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${edgeClass(link.type)}" stroke-width="1.5" opacity="0.75"/>`;
  }).join('');
  const nodes = graph.nodes.map((node) => {
    const p = pos.get(node.person_id);
    const isCenter = node.person_id === graph.center;
    const name = node.display_name.length > 14 ? `${node.display_name.slice(0, 14)}…` : node.display_name;
    return `<g class="g-node" data-id="${esc(node.person_id)}" style="cursor:pointer">
      <circle cx="${p.x}" cy="${p.y}" r="${isCenter ? 14 : 8}" class="${isCenter ? 'node-center' : ''}" fill="${isCenter ? '' : '#9a7b4f'}"/>
      <text class="node-label" x="${p.x}" y="${p.y + (isCenter ? 26 : 18)}" text-anchor="middle">${esc(name)}</text>
    </g>`;
  }).join('');
  svg.innerHTML = `<g>${lines}${nodes}</g>`;
  svg.querySelectorAll('.g-node').forEach((el) => el.addEventListener('click', () => go(personHref(el.dataset.id))));
}

function initTabs(container) {
  const bar = container.querySelector('.tab-bar');
  if (!bar) return;
  const panes = container.querySelectorAll(':scope > .tab-wrap + .tab-pane, :scope > .tab-pane');
  bar.querySelectorAll('button[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('button[data-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      panes.forEach((p) => {
        p.classList.toggle('active', p.dataset.tab === btn.dataset.tab);
      });
    });
  });
}

async function renderPerson(id) {
  setNav('browse');
  const data = await api(`/api/person/${encodeURIComponent(id)}`);

  if (data.ambiguous) {
    app.innerHTML = `
      ${breadcrumb([{ href: '#/', label: 'الفهرس' }, { href: '#/browse', label: 'التراجم' }, { label: `رقم ${data.entry_number}` }])}
      <div class="person-hero"><h1 class="section-title">رقم ${esc(data.entry_number)} مكرّر</h1>
      <p class="lead">الطبعة تعيد هذا الرقم لأكثر من ترجمة — اختر الصحيح:</p></div>
      ${renderHits({ results: data.candidates, total: data.candidates.length })}`;
    return;
  }

  const p = data.person;
  const nasab = p.identity.nasab;
  const chain = (nasab.chain || []).map((seg, i) => {
    const link = nasab.links?.[i] ? `<span class="link">${esc(nasab.links[i])}</span>` : '';
    return `${i ? link : ''}<span class="seg">${esc(seg)}</span>`;
  }).join('');
  const nisba = (nasab.nisba || []).map((n) => `<span class="chip">${esc(n)}</span>`).join(' ');
  const summary = p.life.summary?.value || (typeof p.life.summary === 'string' ? p.life.summary : '');
  const siraView = getSiraView();

  setFooter(`ترجمة ${p.entry.number} · ${p.identity.display_name}`);

  app.innerHTML = `
    ${breadcrumb([
      { href: '#/', label: 'الفهرس' },
      { href: '#/browse', label: 'التراجم' },
      { label: p.identity.display_name },
    ])}
    <a class="back-link" href="#/browse">${icon('back')} عودة إلى التراجم</a>

    <header class="person-hero">
      <div class="person-hero-top">
        <div class="entry-badge"><span class="label">ترجمة</span><span class="num">${esc(p.entry.number)}</span></div>
        <div style="flex:1;min-width:0">
          <h1>${esc(p.identity.display_name)}</h1>
          ${nasab.full_name ? `<div class="full-name">${esc(nasab.full_name)}</div>` : ''}
          <div class="loc-line">
            <span>${icon('book')} مج ${esc(p.entry.volume || '؟')}</span>
            <span>${icon('scroll')} ص ${esc(p.entry.page_start)}–${esc(p.entry.page_end)}</span>
            <span>${esc(p.classification.letter || '')}</span>
          </div>
          <div class="chips">
            ${qismChip(p.classification.qism)}
            <span class="chip">${esc(SECTION_LABEL[p.classification.section_type] || p.classification.section_type)}</span>
            ${p.identity.is_woman ? '<span class="chip">امرأة</span>' : ''}
            ${p.identity.kunya ? `<span class="chip">${esc(p.identity.kunya)}</span>` : ''}
            ${p.entry.number_is_ambiguous ? '<span class="chip warn">رقم مكرر</span>' : ''}
            ${(p.extraction.layers || []).map(layerChip).join(' ')}
          </div>
        </div>
      </div>
      ${nasab.rejected_reason
        ? `<p class="muted" style="margin-top:0.75rem">${icon('warn')} النسب: ${esc(nasab.rejected_reason)}</p>`
        : chain ? `<div class="nasab-line">${chain}${nisba ? ` ${nisba}` : ''}</div>` : ''}
      <p class="muted" style="font-size:0.88rem;margin-top:0.5rem">${esc(p.classification.qism_label || '')}</p>
    </header>

    ${summary && siraView === 'cards' && !isStubSummary(summary)
      ? `<div class="summary-box" role="doc-abstract">${esc(summary)}</div>`
      : ''}

    <div class="tab-wrap">
      <nav class="tab-bar" role="tablist">
        <button class="active" data-tab="life" role="tab">${icon('user')} السيرة</button>
        <button data-tab="riwaya" role="tab">${icon('scroll')} الرواية والجرح</button>
        <button data-tab="citations" role="tab">${icon('quote')} الاستشهادات</button>
        <button data-tab="links" role="tab">${icon('network')} الروابط</button>
        <button data-tab="text" role="tab">${icon('book')} النص الأصلي</button>
      </nav>
    </div>

    <div class="tab-pane active" data-tab="life">
      <div class="sira-toolbar">${siraViewToggle(siraView)}</div>
      <div class="sira-content" data-sira-view="${siraView}">${renderSiraContent(p, siraView, { citations: data.citations || [] })}</div>
    </div>

    <div class="tab-pane" data-tab="riwaya">
      <div class="fact-grid">
        <div>
          ${factGroup('روى عن', p.narration.narrated_from, 'narrated_from')}
          ${factGroup('روى عنه', p.narration.narrated_to, 'narrated_to')}
        </div>
        <div>
          ${factGroup('التوثيق', p.narration.praise, 'praise')}
          ${factGroup('الجرح', p.narration.criticism, 'criticism')}
          ${factGroup('الدفاع', p.narration.defenses, 'defenses')}
        </div>
      </div>
    </div>

    <div class="tab-pane" data-tab="citations">
      ${data.citations.length
        ? factGroup('من استشهد به ابن حجر', data.citations.slice(0, 30).map((c) => ({
            value: `${c.verb} ${c.authority}`, evidence: c.evidence, source: 'structural',
          })), 'citations') + (data.citations.length > 30 ? `<p class="muted">+ ${fmt(data.citations.length - 30)} استشهاد آخر</p>` : '')
        : emptyState('لا استشهادات في هذه الترجمة')}
    </div>

    <div class="tab-pane" data-tab="links">
      <div class="graph-box">
        <div class="legend">
          <span><i class="swatch" style="background:var(--q2)"></i>قرابة</span>
          <span><i class="swatch" style="background:var(--q1)"></i>روى عن</span>
          <span><i class="swatch" style="background:var(--q3)"></i>روى عنه</span>
          <span><i class="swatch" style="background:var(--accent)"></i>إحالة</span>
        </div>
        <p class="muted">${fmt(data.neighbors.links.length)} رابطة محلولة</p>
        <div class="graph-wrap"><svg id="graph" viewBox="0 0 640 360"></svg></div>
        ${data.neighbors.unresolved.length
          ? `<p class="muted" style="margin-top:0.75rem">إحالات غير محلولة (${fmt(data.neighbors.unresolved_total)}): ${data.neighbors.unresolved.slice(0, 5).map((e) => esc(e.to_literal || TYPE_LABEL[e.type] || e.type)).join(' · ')}</p>`
          : ''}
      </div>
    </div>

    <div class="tab-pane" data-tab="text">
      <div class="raw-box">
        <div class="raw-toolbar">
          <span>${icon('book')} نص الترجمة من الطبعة</span>
          <span class="raw-toolbar-end">
            <span id="raw-len"></span>
            <div class="raw-views" role="tablist" aria-label="عرض النص">
              <button type="button" class="active" data-raw-view="split">مفصول</button>
              <button type="button" data-raw-view="flow">متصل</button>
            </div>
            <button type="button" id="copy-raw">${icon('copy')} نسخ</button>
          </span>
        </div>
        <p class="raw-hint muted" id="raw-hint-split">كل فقرة جملة. الوسم يبيّن نوعها بعد فحص الكلمات الدالة.</p>
        <p class="raw-hint muted" id="raw-hint-flow" hidden>العرض السابق: تظليل متصل داخل النص.</p>
        <div class="span-legend" id="span-legend" hidden></div>
        <div class="raw-body" id="raw-text-split">يُحمَّل…</div>
        <div class="raw-body raw-body-flow" id="raw-text-flow" hidden></div>
      </div>
    </div>`;

  initTabs(app);
  const siraCtx = { citations: data.citations || [], text: '' };
  initSiraView(app, p, siraCtx);
  drawGraph(document.getElementById('graph'), data.neighbors);

  try {
    const [raw, spanData] = await Promise.all([
      api(`/api/person/${encodeURIComponent(id)}/text`),
      api(`/api/person/${encodeURIComponent(id)}/spans`).catch(() => ({ spans: data.spans || [] })),
    ]);
    const text = raw.text_body || '';
    siraCtx.text = text;
    const siraBox = app.querySelector('.sira-content');
    if (siraBox && getSiraView() === 'narrative') {
      siraBox.innerHTML = renderSiraContent(p, 'narrative', siraCtx);
    }
    const spans = relabelSpans(text, spanData.spans || data.spans || []);
    const split = document.getElementById('raw-text-split');
    const flow = document.getElementById('raw-text-flow');
    if (split) split.innerHTML = renderRawReader(text, spans);
    if (flow) flow.innerHTML = highlightText(text, spans);
    const used = [...new Set(spans.map((s) => s.label).filter((label) => label && label !== 'unlabeled'))];
    const legend = document.getElementById('span-legend');
    if (legend && used.length) {
      legend.hidden = false;
      legend.innerHTML = used.map((label) =>
        `<span class="span-key">
          <i class="${SPAN_CLASS[label] || 'span-other'}"></i>
          <span><b>${esc(LABEL_AR[label] || label)}</b><em>${esc(LABEL_HINT[label] || '')}</em></span>
        </span>`
      ).join('');
    }
    const lenEl = document.getElementById('raw-len');
    if (lenEl) lenEl.textContent = `${fmt(text.length)} حرف`;
    document.getElementById('copy-raw')?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(text);
      const btn = document.getElementById('copy-raw');
      btn.innerHTML = `${icon('check')} نُسخ`;
      setTimeout(() => { btn.innerHTML = `${icon('copy')} نسخ`; }, 2000);
    });
    initRawViews(app);
  } catch (err) {
    const split = document.getElementById('raw-text-split');
    if (split) split.textContent = `تعذّر التحميل: ${err.message}`;
  }
}

const RAW_VIEW_KEY = 'isabah.rawView';

function initRawViews(container) {
  const buttons = container.querySelectorAll('[data-raw-view]');
  if (!buttons.length) return;
  const setView = (view) => {
    const split = view !== 'flow';
    container.querySelectorAll('[data-raw-view]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.rawView === (split ? 'split' : 'flow'));
    });
    const splitBox = container.querySelector('#raw-text-split');
    const flowBox = container.querySelector('#raw-text-flow');
    const hintSplit = container.querySelector('#raw-hint-split');
    const hintFlow = container.querySelector('#raw-hint-flow');
    if (splitBox) splitBox.hidden = !split;
    if (flowBox) flowBox.hidden = split;
    if (hintSplit) hintSplit.hidden = !split;
    if (hintFlow) hintFlow.hidden = split;
    try { sessionStorage.setItem(RAW_VIEW_KEY, split ? 'split' : 'flow'); } catch { /* ignore */ }
  };
  buttons.forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.rawView)));
  let saved = 'split';
  try { saved = sessionStorage.getItem(RAW_VIEW_KEY) || 'split'; } catch { /* ignore */ }
  setView(saved);
}

const SENT_RE = /[^\n.؟!]+(?:[.؟!]+(?:\s*\[\s*\(\s*\d+\s*\)\s*\])?|\n+|$)/gu;

const BATTLE_KW =
  'بدر|أحد|الخندق|الأحزاب|خيبر|تبوك|حنين|الطائف|القادسية|اليرموك|الجمل|صفين|مؤتة|موتة|الحديبية|فتح مكة|يوم الفتح|اليمامة|أجنادين|نهاوند|الردة|بئر معونة|الرجيع|ذات الرقاع|النهروان|كربلاء|الحرة|جلولاء|مرج الصفر|مكة|بواط|الأبواء|العشيرة|سفوان|قينقاع|النضير|قريظة|المريسيع|المصطلق|أوطاس|فحل|المدائن|تستر|يوم الدار|ذات السلاسل|دومة الجندل';
const SCHOLAR_KW =
  'البخاري|مسلم|أبو داود|الترمذي|النسائي|ابن ماجه|أحمد|الحاكم|البغوي|ابن سعد|الواقدي|ابن إسحاق|ابن اسحاق|خليفة|الطبراني|الدارقطني|ابن حبان|ابن حبّان|ابن شاهين|البزار|أبو يعلى|البيهقي|ابن عساكر|الذهبي|ابن الكلبي|ابن قانع|الطبري|أبو نعيم|ابن مندة|ابن منده|ابن عبد البر|ابن الأثير|أبو موسى|الرشاطي|ابن فتحون|الهيثم|الكنى|أسد الغابة|الاستيعاب|التجريد|أبو زرعة|ابن أبي حاتم|ابن معين|يحيى بن معين|أحمد بن حنبل|الشافعي|مالك|النووي|المزي|المزّي|ابن أبي شيبة|الدولابي|ابن السكن|ابن خزيمة|أبو أحمد|وكيع|شعبة|سفيان|الزهري|ابن سيرين|الكلبي|تهذيب|تقريب|الكاشف|الحلية|الطبقات|الإصابة';
const NISBA_KW =
  'القرشي|الأنصاري|الأموي|الخزرجي|الأوسي|الدوسي|السلمي|العدوي|الزهري|التميمي|الليثي|الجهني|الغفاري|المزني|الخزاعي|الهذلي|الثقفي|العامري|المخزومي|الأسدي|الحارثي|البكري|الكلبي|الهمداني|الكندي|الأزدي|الطائي|الفهري|الجعفي|الكناني|الهلالي|السهمي|الجمحى|الجمحي|العبسي|الفزاري|الضبي|النهدي';

const LABEL_RE = {
  heading: /^\d+\s*[^\d\n]{0,12}\s*[-–—:]/u,
  voice: /^قلت[:：]/u,
  voiceMid: /(?:^|[.]\s+)قلت[:：]/u,
  dispute: /اختلف(?:وا)? في اسمه|قيل اسمه|يقال اسمه|في اسمه أقوال|سُمّي|يسمّى|ويقال اسمه|مختلف في اسمه|اختلفوا في اسمه|على أكثر من \S+ قولا/u,
  crossref: /يأتي في|سيأتي في|تقدم في|تقدمت في|مضى في|انظر[:：]?\s|ترجمه في|في الكنى|في النساء|كما سيأتي في ترجمت/u,
  isnad: /ثنا |أخبرنا |حدثنا |أنبأنا |نا [أاإ]|(?:عن [^.\n]{2,36} ){2}عن /u,
  matn: /قال رسول الل|قال النبي|سمعت رسول|عن النبي صل|فيما رواه عن النبي|رفعه[:：]/u,
  death: /(?:^|[.،:]\s*|ثم |و)(?:مات |توفي|توفّي)|وفاته|مقتله|قُتل |قتل يوم|قتل في|لما قتل|قتل أبي|استشهد|مات سنة|مات في|حضره الموت|حضرته الوفاة|لما مات|بعد موته/u,
  birth: /ولد |مولده|وُلد|ولدت |ولدته |ولد سنة/u,
  age: /وهو ابن \S.{0,20}سن|وعمره|أتت عليه|عاش \S.{0,12}سن|مات وهو ابن|ثمانيا? و\S+ سن|ابن ثلاثين سنة|زدت على الثلاثين/u,
  office: /استعمله|ولاه |ولّاه|أمّره|أمّر |أمير |قاض|عامل على|استعمل على|ولي |بعثه (?:النبي|أبو بكر|عمر|عثمان)|على البحرين|على اليمن|على مكة|على الكوفة|على البصرة|على الشام|على المدينة|على مصر/u,
  family: /أمه |أبوه |أخوه |أخته |ابنه |ابنته |زوجته |زوجها |عمه |خالُ|خاله |بنوه |بناته |ولد له|أعقب|له عقب|وامرأته |تزوّجها|تزوجها |ابن أخي|ابن أخيه|أبو المترجم/u,
  praise: /ثقة|ثبت |فاضل|من خيار|جليل|صدوق|حافظ |من كبار|له صحبة|أثبتت صحبته|من الصحابة|أحفظ|ألزمنا|أكثر الصحابة/u,
  criticism: /لا يصح|لا يثبت|ليس بصحابي|ليست له صحبة|وهم |تصحيف|ضعيف|غلط|لا يعرف|مجهول|ليست له رواية|خطأ|وهل منه/u,
  defense: /والصواب|والصحيح|فالجواب|وهذا وهم|يردّ عليه|والمعتمد/u,
  poetry: /وقال الشاعر|من الطويل|من البسيط|من الوافر|من الكامل|من الرجز|من المنسرح|قال حسّان|أنشد|\[(?:الطويل|البسيط|الوافر|الكامل|الرجز|المنسرح)\]/u,
  quran: /قوله تعالى|قال تعالى|الآية|﴿|القرآن|أقرأ/u,
  footnote: /^\[\s*\(\s*\d+\s*\)\s*\]/u,
  citationVerb: /ذكره |أخرجه |رواه |أسنده |أورده |قاله |حكاه |ونقل |في الصحيح|في السنن|في المسند|من طريق/u,
  narration: /(?:^|[.]\s+)روى عنه |(?:^|[.]\s+)روى عن |يروي عن/u,
  scholar: new RegExp(SCHOLAR_KW, 'u'),
  battleAct: new RegExp(`(?:شهد|غزا|غزوة|حضر يوم|وقعة|شهد معه|غزا معه)\\s*.{0,24}(?:${BATTLE_KW})`, 'u'),
  battleDay: new RegExp(`(?:غزوة|يوم|وقعة|فتح)\\s*(?:${BATTLE_KW})`, 'u'),
  event: /أسر|سُبي|سبي |وفد على|وفادته|في وفد|سري[ةه]|هاجر إلى|هجرته|بايع|بيعة |جرح |جريح|أعتق|تزوج|زوّجه|زوجه النبي|حاصر|صلح الحديبية|أسلم أيام|أسلم يوم|أسلم قبل|قدم مهاجرا|سكن |نزل |استوطن|كان مقدمه|قدم المدينة|أسلم |صحب النبي|صحبته /u,
  lifeVerb: /شهد|غزا|مات|توفي|أسلم|هاجر|روى|ذكره|أخرجه|قتل|ولاه|بايع|استشهد|وفد|سكن|نزل/u,
  nisba: new RegExp(NISBA_KW, 'u'),
};

function labelQuote(text) {
  const src = String(text || '').trim();
  const hits = [];
  const add = (label, score) => hits.push({ label, score });
  const R = LABEL_RE;
  if (R.heading.test(src) && src.length < 90) add('heading', 9);
  if (R.voice.test(src) || R.voiceMid.test(src)) add('ibn_hajar_voice', 10);
  if (R.dispute.test(src)) add('name_dispute', 9);
  if (R.crossref.test(src) && src.length < 220) add('crossref', 8);
  if (R.isnad.test(src)) add('isnad', 9);
  if (R.matn.test(src)) add('hadith_matn', 9);
  if (R.death.test(src)) add('death', 9);
  if (R.birth.test(src)) add('birth', 9);
  if (R.age.test(src)) add('age', 9);
  if (R.office.test(src)) add('office', 8);
  if (R.family.test(src)) add('family', 7);
  if (R.praise.test(src) && !R.criticism.test(src)) add('praise', 6);
  if (R.criticism.test(src)) add('criticism', 8);
  if (R.defense.test(src) && !R.voice.test(src)) add('defense', 7);
  if (R.poetry.test(src) && !R.lifeVerb.test(src) && !R.event.test(src) && !R.battleAct.test(src)) add('poetry', 9);
  if (R.quran.test(src)) add('quran', 9);
  if (R.footnote.test(src) || (src.length < 10 && /^\s*[«»[\]()\d]+\s*$/u.test(src))) add('editor_footnote', 6);
  if ((R.citationVerb.test(src) || R.scholar.test(src) || R.narration.test(src)) && !R.voice.test(src) && !R.matn.test(src)) {
    add('citation', 7);
  }
  if (R.battleAct.test(src)) add('battle', 8);
  else if (R.battleDay.test(src) && !R.death.test(src) && !R.scholar.test(src)) add('battle', 8);
  if (R.event.test(src) && !R.death.test(src)) add('event', 7);
  const reportCue = R.lifeVerb.test(src) || R.citationVerb.test(src)
    || R.scholar.test(src) || R.isnad.test(src) || R.narration.test(src)
    || R.family.test(src);
  const nasabHits = (src.match(/بن |بنت |ابن /gu) || []).length;
  if (nasabHits >= 2 && !reportCue) add('nasab', 8);
  else if (nasabHits >= 1 && src.length < 140 && !reportCue && R.nisba.test(src)) add('nasab', 6);
  if (!hits.length) return src.length < 3 ? 'boilerplate' : 'unlabeled';
  hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return hits[0].label;
}

function relabelSpans(text, spans) {
  const source = String(text || '');
  const local = splitSentencesLocal(source).map((part) => ({
    start: part.start,
    end: part.end,
    quote: part.text,
    label: labelQuote(part.text),
  }));
  if (local.length) return local;
  return (spans || []).map((span) => ({
    ...span,
    label: labelQuote(span.quote || source.slice(span.start, span.end)),
  }));
}

function highlightText(text, spans) {
  const source = String(text || '');
  if (!source) return '<p class="muted">لا نص</p>';
  const sorted = [...(spans || [])]
    .filter((span) => Number(span.end) > Number(span.start) && span.start >= 0 && span.end <= source.length)
    .sort((a, b) => a.start - b.start);
  let html = '';
  let cursor = 0;
  for (const span of sorted) {
    if (span.start < cursor) continue;
    if (span.start > cursor) html += esc(source.slice(cursor, span.start));
    const slice = source.slice(span.start, span.end);
    const label = span.label && span.label !== 'unlabeled' && span.label !== 'boilerplate' ? span.label : '';
    if (label) {
      const cls = SPAN_CLASS[label] || 'span-other';
      const title = `${LABEL_AR[label] || label}${LABEL_HINT[label] ? ` — ${LABEL_HINT[label]}` : ''}`;
      html += `<mark class="${cls}" title="${esc(title)}">${esc(slice)}</mark>`;
    } else {
      html += esc(slice);
    }
    cursor = span.end;
  }
  if (cursor < source.length) html += esc(source.slice(cursor));
  return html.replace(/\n/g, '<br>');
}

function splitSentencesLocal(text) {
  const source = String(text || '');
  const out = [];
  for (const match of source.matchAll(SENT_RE)) {
    const quote = match[0];
    const trimmed = quote.trim();
    if (!trimmed) continue;
    const pad = quote.indexOf(trimmed);
    out.push({
      start: match.index + pad,
      end: match.index + pad + trimmed.length,
      text: trimmed,
    });
  }
  return out;
}

function blocksFromSpans(text, spans) {
  const source = String(text || '');
  const sorted = (spans || [])
    .filter((span) => Number(span.end) > Number(span.start))
    .sort((a, b) => a.start - b.start || (b.end - a.start) - (a.end - a.start));

  const covered = [];
  let cursor = 0;
  const pushGap = (from, to) => {
    const chunk = source.slice(from, to);
    if (!chunk.trim()) return;
    for (const part of splitSentencesLocal(chunk)) {
      covered.push({ label: labelQuote(part.text), text: part.text });
    }
  };

  for (const span of sorted) {
    if (span.start > cursor) pushGap(cursor, span.start);
    if (span.start < cursor) continue;
    const slice = source.slice(span.start, span.end);
    const parts = splitSentencesLocal(slice);
    if (!parts.length) {
      const trimmed = slice.trim();
      if (trimmed) covered.push({ label: labelQuote(trimmed), text: trimmed });
    } else {
      for (const part of parts) {
        covered.push({ label: labelQuote(part.text), text: part.text });
      }
    }
    cursor = span.end;
  }
  if (cursor < source.length) pushGap(cursor, source.length);
  if (!covered.length) {
    return splitSentencesLocal(source).map((part) => ({ label: labelQuote(part.text), text: part.text }));
  }
  return covered;
}

function renderRawReader(text, spans) {
  const blocks = blocksFromSpans(text, spans);
  if (!blocks.length) return '<p class="muted">لا نص</p>';
  return `<div class="raw-reader">${blocks.map((block) => {
    const label = block.label && block.label !== 'unlabeled' ? block.label : '';
    const cls = SPAN_CLASS[block.label] || 'span-plain';
    const chip = label
      ? `<span class="raw-chip" title="${esc(LABEL_HINT[label] || LABEL_AR[label])}">${esc(LABEL_AR[label])}</span>`
      : '<span class="raw-chip raw-chip-empty" aria-hidden="true"></span>';
    return `<p class="raw-block ${cls}${label ? '' : ' is-plain'}" data-label="${esc(block.label || 'unlabeled')}">${chip}<span class="raw-line">${esc(block.text)}</span></p>`;
  }).join('')}</div>`;
}

function facetGrid(items, hrefFn) {
  if (!items?.length) return emptyState('لا بيانات');
  return `<div class="facet-grid">${items.map((item) =>
    `<a class="facet-card" href="${hrefFn(item)}">
      <span class="name">${esc(item.label_ar || item.title || item.key)}</span>
      <span class="muted">${item.kind ? esc(CHAPTER_KIND[item.kind] || item.kind) : ''}${item.count != null ? fmt(item.count) : item.char_len ? fmt(item.char_len) + ' حرف' : ''}</span>
    </a>`
  ).join('')}</div>`;
}

async function renderChapters() {
  setNav('chapters');
  const data = await api('/api/chapters');
  setFooter(`${fmt(data.chapters.length)} باب`);
  app.innerHTML = `
    ${breadcrumb([{ href: '#/', label: 'الفهرس' }, { label: 'الأبواب' }])}
    <header style="margin-bottom:1.25rem">
      <h1 class="section-title">أبواب الكتاب</h1>
      <p class="muted">مقدمات ابن حجر والعناوين الهيكلية خارج تراجم الأشخاص</p>
    </header>
    <div class="tarjama-list">${(data.chapters || []).map((ch) =>
      `<a class="tarjama-item" href="#/chapter/${ch.id}">
        <span class="num">${esc(ch.lvl)}</span>
        <span><span class="name">${esc(ch.title)}</span>
          <div class="meta">${esc(CHAPTER_KIND[ch.kind] || ch.kind)}${ch.char_len ? ` · ${fmt(ch.char_len)} حرف` : ''}</div>
        </span>
        <span class="tags"><span class="chip">${esc(ch.kind)}</span></span>
      </a>`
    ).join('')}</div>`;
}

async function renderChapter(id) {
  setNav('chapters');
  const ch = await api(`/api/chapter/${id}`);
  setFooter(ch.title);
  app.innerHTML = `
    ${breadcrumb([{ href: '#/', label: 'الفهرس' }, { href: '#/chapters', label: 'الأبواب' }, { label: ch.title }])}
    <a class="back-link" href="#/chapters">${icon('back')} عودة إلى الأبواب</a>
    <header class="person-hero">
      <h1>${esc(ch.title)}</h1>
      <p class="muted">${esc(CHAPTER_KIND[ch.kind] || ch.kind)} · ${fmt(ch.char_len)} حرف</p>
    </header>
    <div class="raw-box"><div class="raw-body">${esc(ch.text || 'لا نص لهذا العنوان')}</div></div>`;
}

async function renderBattles() {
  setNav('battles');
  const data = await api('/api/facets');
  setFooter(`${fmt(data.battles.length)} غزوة`);
  app.innerHTML = `
    ${breadcrumb([{ href: '#/', label: 'الفهرس' }, { label: 'الغزوات' }])}
    <header style="margin-bottom:1.25rem">
      <h1 class="section-title">من شهد الغزوات</h1>
      <p class="muted">القسم الرابع مستثنى · اضغط غزوة لعرض من حضرها</p>
    </header>
    ${facetGrid(data.battles, (item) => `#/browse?battle=${encodeURIComponent(item.key)}`)}
    <h2 class="section-title" style="margin-top:2rem;font-size:1.4rem">القبائل والنسب</h2>
    ${facetGrid((data.nisba || []).slice(0, 24), (item) => `#/browse?nisba=${encodeURIComponent(item.key)}`)}`;
}

async function renderCitationsPage() {
  setNav('citations');
  const data = await api('/api/facets');
  setFooter(`${fmt(data.authorities.length)} مصدر`);
  app.innerHTML = `
    ${breadcrumb([{ href: '#/', label: 'الفهرس' }, { label: 'الاستشهادات' }])}
    <header style="margin-bottom:1.25rem">
      <h1 class="section-title">من استشهد بهم ابن حجر</h1>
      <p class="muted">اضغط مصدراً لرؤية التراجم التي نُقل عنه فيها</p>
    </header>
    ${facetGrid(data.authorities, (item) => `#/browse?authority=${encodeURIComponent(item.key)}`)}`;
}

function hasLifeContent(p) {
  const l = p.life;
  const n = p.narration || {};
  return (l.companionship?.length || l.battles?.length || l.offices?.length ||
    l.residences?.length || l.family?.length || l.traits?.length || l.conversion?.length ||
    l.events?.length || l.wounds?.length || l.ages?.length || l.possessions?.length ||
    n.narrated_from?.length || n.narrated_to?.length || n.praise?.length ||
    l.birth?.year_hijri || l.death?.year_hijri || (l.death?.notes || []).length);
}

/* ── Quality ── */

function renderQuality(meta) {
  setNav('quality');
  const q = meta.quality || {};
  const g = meta.graph || {};
  const ev = q.evidence || {};
  const evTotal = (ev.verified || 0) + (ev.unverified || 0) + (ev.absent || 0) || 1;
  setFooter('تقرير جودة البيانات');

  app.innerHTML = `
    ${breadcrumb([{ href: '#/', label: 'الفهرس' }, { label: 'الجودة' }])}
    <header style="margin-bottom:1.25rem">
      <div class="section-kicker">ضبط الجودة</div>
      <h1 class="section-title">سلامة البيانات</h1>
      <p class="lead">طبقات: ${Object.entries(q.layers || {}).map(([k, n]) => `${esc(LAYER_LABEL[k] || k)} (${fmt(n)})`).join(' · ')}</p>
    </header>

    <div class="evidence-row">
      <div class="evidence-box"><b>${pct(ev.verified / evTotal)}</b><span>شواهد متحقّقة</span></div>
      <div class="evidence-box"><b>${fmt(ev.verified)}</b><span>من ${fmt(evTotal)} حقيقة</span></div>
      <div class="evidence-box"><b>${pct(q.llm_fact_coverage)}</b><span>تغطية ذكية</span></div>
    </div>

    <div class="page-split">
      <section class="card">
        <div class="card-head">${icon('chart')}<h2>امتلاء الحقول</h2></div>
        ${Object.entries(q.fill_rates || {}).sort((a, b) => b[1].rate - a[1].rate).map(([k, v]) =>
          `<div class="meter"><span>${esc(FILL_LABEL[k] || k)}</span>
            <div class="meter-track"><div class="meter-fill" style="width:${v.rate * 100}%"></div></div>
            <span>${pct(v.rate)}</span></div>`
        ).join('')}
      </section>
      <section>
        <div class="card">
          <div class="card-head">${icon('network')}<h2>أنواع الروابط</h2></div>
          ${Object.entries(g.by_type || {}).map(([k, n]) =>
            `<div class="meter"><span>${esc(TYPE_LABEL[k] || k)}</span>
              <div class="meter-track"><div class="meter-fill" style="width:${(n / (g.edges || 1)) * 100}%"></div></div>
              <span>${fmt(n)}</span></div>`
          ).join('')}
          <p class="muted" style="margin-top:0.75rem">محلول ${fmt(g.resolved)} · ملتبس ${fmt(g.ambiguous)} · بلا هدف ${fmt(g.unresolved)}</p>
        </div>
        <div class="card">
          <div class="card-head">${icon('warn')}<h2>رفض النسب</h2></div>
          ${Object.entries(q.nasab_rejections || {}).map(([k, n]) =>
            `<div class="fact-item"><span class="val">${esc(k)}</span> <span class="muted">${fmt(n)}</span></div>`
          ).join('')}
        </div>
      </section>
    </div>

    <section class="card">
      <div class="card-head">${icon('quote')}<h2>أكثر من استشهد بهم</h2></div>
      <div class="tarjama-list">
        ${(g.top_authorities || []).slice(0, 12).map((a) =>
          `<a class="tarjama-item" href="#/browse?authority=${encodeURIComponent(a.key)}"><span class="num">${fmt(a.count)}</span><span class="name">${esc(a.label_ar || a.key)}</span><span></span></a>`
        ).join('')}
      </div>
    </section>`;
}

/* ── Router ── */

async function route() {
  const loc = parseHash();
  app.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>يُحمَّل…</p></div>`;
  try {
    if (!state.meta) state.meta = await api('/api/meta');
    if (loc.page === 'overview') renderOverview(state.meta);
    else if (loc.page === 'browse') await renderBrowse(loc.params);
    else if (loc.page === 'quality') renderQuality(state.meta);
    else if (loc.page === 'person') await renderPerson(loc.id);
    else if (loc.page === 'chapters') await renderChapters();
    else if (loc.page === 'chapter') await renderChapter(loc.id);
    else if (loc.page === 'battles') await renderBattles();
    else if (loc.page === 'citations') await renderCitationsPage();
  } catch (err) {
    app.innerHTML = emptyState(`تعذّر التحميل: ${err.message}`, 'تأكّد من تشغيل npm run pipeline');
    setFooter('');
  }
  window.scrollTo(0, 0);
}

function boot() {
  injectStaticIcons();
  window.addEventListener('hashchange', route);
  route();
}

try {
  boot();
} catch (err) {
  app.innerHTML = emptyState(`تعذّر تحميل الواجهة: ${err.message}`);
}
