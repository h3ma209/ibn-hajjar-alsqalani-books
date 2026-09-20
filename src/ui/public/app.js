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
  if (path === '/' || path === '') return { page: 'overview', params };
  if (path === '/browse') return { page: 'browse', params };
  if (path === '/quality') return { page: 'quality', params };
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
      if (el.value) next.set(el.dataset.filter, el.value);
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
  return localStorage.getItem(SIRA_VIEW_KEY) === 'narrative' ? 'narrative' : 'cards';
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

function yearNarrative(event, verb) {
  if (!event) return '';
  const years = event.year_candidates?.length
    ? event.year_candidates
    : (event.year_hijri != null ? [event.year_hijri] : []);
  if (!years.length && !event.place) return '';
  let phrase = verb;
  if (years.length === 1) phrase += ` سنة ${years[0]} للهجرة`;
  else if (years.length > 1) phrase += ` في إحدى سنوات ${joinArabic(years.map(String))} للهجرة`;
  if (event.place) phrase += ` في ${event.place}`;
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

function composeSiraNarrative(p) {
  const { identity, classification, life } = p;
  const name = identity.display_name;
  const fullName = identity.nasab?.full_name;
  const kunya = identity.kunya;
  const summary = life.summary?.value || (typeof life.summary === 'string' ? life.summary : '');
  const paragraphs = [];

  const opener = [];
  if (identity.is_woman) {
    opener.push(`في تراجم النساء يذكر ابن حجر ${name}`);
  } else {
    opener.push(name);
  }
  if (fullName && fullName !== name) {
    if (fullName.startsWith(name)) {
      const tail = fullName.slice(name.length).replace(/^[\s،]+/, '').trim();
      if (tail) opener.push(`من ${tail}`);
    } else {
      opener.push(`واسمه ${fullName}`);
    }
  }
  if (kunya && kunya !== name && !name.includes(kunya)) opener.push(`كنيته ${kunya}`);
  const qismLine = qismNarrative(classification.qism, identity.is_woman);
  if (qismLine) opener.push(qismLine);
  if (!isStubSummary(summary)) {
    opener.push(summary.replace(/[.؟!…]+$/u, '').trim());
  }
  paragraphs.push(`${opener.join('، ')}.`);

  const conversion = factTexts(life.conversion);
  const companionship = factTexts(life.companionship);
  if (conversion.length || companionship.length) {
    const parts = [];
    if (conversion.length) parts.push(`في الإسلام ${joinArabic(conversion)}`);
    if (companionship.length) {
      parts.push(`في الصحبة ${joinArabic(companionship)}`);
    }
    paragraphs.push(`${parts.join('، ')}.`);
  }

  const birth = yearNarrative(life.birth, 'وُلِد');
  const death = yearNarrative(life.death, 'وتُوفّي');
  if (birth || death) paragraphs.push(`${[birth, death].filter(Boolean).join('، ')}.`);

  const battles = factTexts(life.battles);
  if (battles.length) {
    paragraphs.push(battles.length > 1
      ? `شهد ${joinArabic(battles)}.`
      : `يُذكر له حضور ${battles[0]}.`);
  }

  const offices = (life.offices || [])
    .map((o) => [o.value, o.role, o.place].filter(Boolean).join(' — '))
    .filter(Boolean);
  if (offices.length) {
    paragraphs.push(`وله في الولايات والمناصب ذكر ${joinArabic(offices)}.`);
  }

  const family = (life.family || [])
    .map((f) => {
      const rel = REL_LABEL[f.relation] || f.relation || '';
      const nm = f.value || f.name || '';
      return rel ? `${rel} ${nm}`.trim() : nm;
    })
    .filter(Boolean);
  if (family.length) paragraphs.push(`في النسب والقرابة: ${joinArabic(family)}.`);

  const residences = factTexts(life.residences);
  if (residences.length) paragraphs.push(`ومن مساكنه أو مقامه ${joinArabic(residences)}.`);

  const traits = factTexts(life.traits);
  if (traits.length) {
    paragraphs.push(traits.length > 1
      ? `يصفه ابن حجر بأنه ${joinArabic(traits)}.`
      : `${traits[0]}.`);
  }

  const body = paragraphs.filter((para) => para.replace(/[.؟!…\s]/gu, '').length > 12);
  if (body.length <= 1 && isStubSummary(summary) && !hasLifeContent(p)) return [];
  return body;
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

function renderSiraNarrative(p) {
  const paragraphs = composeSiraNarrative(p);
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
    <footer class="sira-narrative-foot muted">مُؤلَّف من حقول الترجمة — ليس نصّ ابن حجر حرفياً</footer>
  </article>`;
}

function renderSiraContent(p, view) {
  if (view === 'narrative') return renderSiraNarrative(p);
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

function initSiraView(container, person) {
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
      content.innerHTML = renderSiraContent(person, view);
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
  bar.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      container.querySelectorAll('.tab-pane').forEach((p) => {
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
      <div class="sira-content" data-sira-view="${siraView}">${renderSiraContent(p, siraView)}</div>
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
          <span><span id="raw-len"></span> <button type="button" id="copy-raw">${icon('copy')} نسخ</button></span>
        </div>
        <div class="raw-body" id="raw-text">يُحمَّل…</div>
      </div>
    </div>`;

  initTabs(app);
  initSiraView(app, p);
  drawGraph(document.getElementById('graph'), data.neighbors);

  try {
    const raw = await api(`/api/person/${encodeURIComponent(id)}/text`);
    const box = document.getElementById('raw-text');
    box.textContent = raw.text_body || '';
    const lenEl = document.getElementById('raw-len');
    if (lenEl) lenEl.textContent = `${fmt((raw.text_body || '').length)} حرف · `;
    document.getElementById('copy-raw')?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(raw.text_body || '');
      const btn = document.getElementById('copy-raw');
      btn.innerHTML = `${icon('check')} نُسخ`;
      setTimeout(() => { btn.innerHTML = `${icon('copy')} نسخ`; }, 2000);
    });
  } catch (err) {
    document.getElementById('raw-text').textContent = `تعذّر التحميل: ${err.message}`;
  }
}

function hasLifeContent(p) {
  const l = p.life;
  return (l.companionship?.length || l.battles?.length || l.offices?.length ||
    l.residences?.length || l.family?.length || l.traits?.length || l.conversion?.length ||
    l.birth?.year_hijri || l.death?.year_hijri);
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
          `<div class="tarjama-item"><span class="num">${fmt(a.count)}</span><span class="name">${esc(a.label_ar || a.key)}</span><span></span></div>`
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
