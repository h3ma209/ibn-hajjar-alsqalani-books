'use strict';

const app = document.getElementById('app');
const searchForm = document.getElementById('search-form');
const qInput = document.getElementById('q');

const QISM_LABEL = {
  1: 'الأول — ثبتت صحبته',
  2: 'الثاني — أدرك ورأى',
  3: 'الثالث — المخضرمون',
  4: 'الرابع — غلط أو تصحيف',
};
const SECTION_LABEL = { names: 'الأسماء', kunya: 'الكنى', women: 'النساء' };
const TYPE_LABEL = {
  family: 'قرابة',
  narrated_from: 'روى عن',
  narrated_to: 'روى عنه',
  see_section: 'إحالة قسم',
  see_qism: 'إحالة قِسم',
  see_letter: 'إحالة حرف',
  see_adjacent: 'مجاور',
  see_relation: 'إحالة نسب',
  see_entry: 'إحالة ترجمة',
};
const REL_LABEL = {
  father: 'أب',
  mother: 'أم',
  son: 'ابن',
  daughter: 'ابنة',
  brother: 'أخ',
  sister: 'أخت',
  wife: 'زوجة',
  husband: 'زوج',
};

const state = { meta: null, browse: { offset: 0 } };

function fmt(n) {
  return Number(n || 0).toLocaleString('ar-EG');
}
function pct(n) {
  return `${Math.round((Number(n) || 0) * 100)}٪`;
}
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function personHref(id) {
  return `#/p/${encodeURIComponent(id)}`;
}
function qismChip(qism) {
  if (!qism) return '';
  return `<span class="chip q${qism}">ق ${qism}</span>`;
}

async function api(path) {
  const res = await fetch(path);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function setNav(name) {
  for (const a of document.querySelectorAll('.nav a')) {
    a.classList.toggle('active', a.dataset.nav === name);
  }
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

function go(path) {
  location.hash = String(path).replace(/^#/, '');
}

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const q = qInput.value.trim();
  const next = new URLSearchParams();
  if (q) next.set('q', q);
  go(`#/browse?${next.toString()}`);
});

function renderOverview(meta) {
  setNav('overview');
  const fill = Object.entries(meta.quality?.fill_rates || {})
    .filter(([key]) => !['summary', 'qism', 'letter', 'any_life_fact'].includes(key))
    .sort((a, b) => b[1].rate - a[1].rate)
    .slice(0, 10);
  const qismTotal = Object.values(meta.qism || {}).reduce((s, n) => s + n, 0) || 1;
  const featured = (meta.featured || [])
    .map(
      (row) => `<a class="hit" href="${personHref(row.person_id)}">
        <span class="num">${esc(row.entry_number)}</span>
        <span><span class="name">${esc(row.display_name)}</span>
        <div class="meta">${esc(row.full_name || '')}</div></span>
        <span>${qismChip(row.qism)}</span>
      </a>`
    )
    .join('');

  app.innerHTML = `
    <section class="hero">
      <div class="kicker">${esc(meta.book.author_ar)}</div>
      <h1>${esc(meta.book.title_ar)}</h1>
      <p class="muted">فهرس ${fmt(meta.counts.persons)} ترجمة محفوظة من طبعة الشاملة، مع النسب والروابط والاستشهادات.</p>
    </section>
    <section class="stats">
      <div class="stat"><b>${fmt(meta.counts.persons)}</b><span>ترجمة</span></div>
      <div class="stat"><b>${fmt(meta.counts.women)}</b><span>من النساء</span></div>
      <div class="stat"><b>${fmt(meta.counts.edges)}</b><span>رابطة</span></div>
      <div class="stat"><b>${fmt(meta.counts.citations)}</b><span>استشهاد</span></div>
    </section>
    <section class="grid-2">
      <div class="card">
        <h2>الأقسام الأربعة</h2>
        ${[1, 2, 3, 4]
          .map((q) => {
            const n = meta.qism?.[q] || 0;
            return `<div class="bar-row"><span>ق ${q}</span><div class="bar q${q}"><i style="width:${(n / qismTotal) * 100}%"></i></div><span>${fmt(n)}</span></div>`;
          })
          .join('')}
        <p class="muted" style="margin-top:0.8rem">القسم الرابع ردود ابن حجر على من أُدخل غلطاً. لا تخلطه مع الصحابة الثابتين.</p>
      </div>
      <div class="card">
        <h2>أقسام الكتاب</h2>
        ${Object.entries(meta.sections || {})
          .map(([key, n]) => {
            const total = Object.values(meta.sections).reduce((s, x) => s + x, 0) || 1;
            return `<div class="bar-row"><span>${SECTION_LABEL[key] || key}</span><div class="bar"><i style="width:${(n / total) * 100}%"></i></div><span>${fmt(n)}</span></div>`;
          })
          .join('')}
        <p class="muted">رفض النسب ${pct(meta.quality?.nasab_rejection_rate)} · تغطية الصفحات ${pct(meta.manifest?.coverage)}</p>
      </div>
    </section>
    <section class="grid-2" style="margin-top:0.9rem">
      <div class="card">
        <h2>نماذج</h2>
        <div class="list">${featured}</div>
      </div>
      <div class="card">
        <h2>امتلاء الحقول</h2>
        ${fill
          .map(
            ([key, value]) =>
              `<div class="bar-row"><span>${esc(key)}</span><div class="bar"><i style="width:${value.rate * 100}%"></i></div><span>${pct(value.rate)}</span></div>`
          )
          .join('')}
      </div>
    </section>
  `;
}

function filterControls(params) {
  const letters = (state.meta?.letters || [])
    .map(
      (item) =>
        `<option value="${esc(item.letter)}" ${params.get('letter') === item.letter ? 'selected' : ''}>${esc(item.letter)} (${fmt(item.count)})</option>`
    )
    .join('');
  return `
    <div class="filters">
      <select data-filter="qism">
        <option value="">كل الأقسام</option>
        ${[1, 2, 3, 4]
          .map((q) => `<option value="${q}" ${params.get('qism') === String(q) ? 'selected' : ''}>${QISM_LABEL[q]}</option>`)
          .join('')}
      </select>
      <select data-filter="section">
        <option value="">كل الأبواب</option>
        ${Object.entries(SECTION_LABEL)
          .map(([k, v]) => `<option value="${k}" ${params.get('section') === k ? 'selected' : ''}>${v}</option>`)
          .join('')}
      </select>
      <select data-filter="letter">
        <option value="">كل الحروف</option>
        ${letters}
      </select>
      <select data-filter="woman">
        <option value="">الكل</option>
        <option value="1" ${params.get('woman') === '1' ? 'selected' : ''}>النساء</option>
        <option value="0" ${params.get('woman') === '0' ? 'selected' : ''}>الرجال</option>
      </select>
    </div>
  `;
}

function renderHits(data) {
  if (!data.results.length) return `<p class="empty">لا نتائج.</p>`;
  return `<div class="list">${data.results
    .map(
      (row) => `<a class="hit" href="${personHref(row.person_id)}">
        <span class="num">${esc(row.entry_number)}</span>
        <span>
          <span class="name">${esc(row.display_name)}</span>
          <div class="meta">${esc(row.full_name || '')} · ${esc(row.letter || '')} · ج ${esc(row.volume || '؟')} ص ${esc(row.page_start || '؟')}</div>
        </span>
        <span>${qismChip(row.qism)} <span class="chip">${esc(SECTION_LABEL[row.section_type] || row.section_type)}</span>${row.is_woman ? '<span class="chip">امرأة</span>' : ''}${row.entry_number_is_ambiguous ? '<span class="chip warn">رقم مكرر</span>' : ''}</span>
      </a>`
    )
    .join('')}</div>`;
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

  app.innerHTML = `
    <section class="hero">
      <div class="kicker">التراجم</div>
      <h1>${data.query ? `نتائج «${esc(data.resolved_query)}»` : 'تصفّح الكتاب'}</h1>
      <p class="muted">${fmt(data.total)} ترجمة</p>
    </section>
    ${filterControls(params)}
    ${renderHits(data)}
    <div class="pager">
      <button ${offset === 0 ? 'disabled' : ''} data-go="${prevOff}">السابق</button>
      <span class="muted">${fmt(offset + 1)}–${fmt(offset + data.results.length)} من ${fmt(data.total)}</span>
      <button ${nextOff >= data.total ? 'disabled' : ''} data-go="${nextOff}">التالي</button>
    </div>
  `;

  app.querySelectorAll('[data-filter]').forEach((el) => {
    el.addEventListener('change', () => {
      const next = new URLSearchParams(params);
      if (el.value) next.set(el.dataset.filter, el.value);
      else next.delete(el.dataset.filter);
      next.delete('offset');
      go(`#/browse?${next.toString()}`);
    });
  });
  app.querySelectorAll('[data-go]').forEach((el) => {
    el.addEventListener('click', () => {
      const next = new URLSearchParams(params);
      next.set('offset', el.dataset.go);
      go(`#/browse?${next.toString()}`);
    });
  });
}

function factBlock(title, facts, mapFn) {
  const list = (facts || []).filter(Boolean);
  if (!list.length) return '';
  return `<div class="panel"><h2>${title}</h2>${list.map(mapFn).join('')}</div>`;
}

function factHtml(fact) {
  const value = fact.value ?? fact.name ?? '';
  const conf = fact.confidence != null ? `ثقة ${Math.round(fact.confidence * 100)}٪` : '';
  return `<div class="fact">
    <span class="val">${esc(value)} <span class="source">${esc(fact.source || '')}</span> <span class="conf">${conf}</span></span>
    ${fact.evidence ? `<div class="ev">${esc(fact.evidence)}</div>` : ''}
  </div>`;
}

function yearHtml(event, label) {
  if (!event || (!event.year_hijri && !event.place && !(event.year_candidates || []).length)) return '';
  const years = event.year_candidates?.length
    ? event.year_candidates.join(' / ')
    : event.year_hijri;
  return `<div class="fact"><span class="val">${label}: ${esc(years || '—')}${event.place ? ` · ${esc(event.place)}` : ''}${event.year_uncertain ? ' <span class="chip warn">متردد</span>' : ''}</span></div>`;
}

function drawGraph(svg, graph) {
  const w = svg.clientWidth || 640;
  const h = svg.clientHeight || 420;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const cx = w / 2;
  const cy = h / 2;
  const others = graph.nodes.filter((n) => n.person_id !== graph.center);
  const r = Math.min(w, h) * 0.36;
  const pos = new Map([[graph.center, { x: cx, y: cy }]]);
  others.forEach((node, i) => {
    const angle = (i / Math.max(others.length, 1)) * Math.PI * 2 - Math.PI / 2;
    pos.set(node.person_id, { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  });

  const edgeClass = (type) =>
    type.startsWith('see') ? 'edge-see' : type === 'family' ? 'edge-family' : `edge-${type}`;

  const lines = graph.links
    .map((link) => {
      const a = pos.get(link.from);
      const b = pos.get(link.to);
      if (!a || !b) return '';
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${edgeClass(link.type)}" stroke-width="1.4" opacity="0.75" />`;
    })
    .join('');

  const nodes = graph.nodes
    .map((node) => {
      const p = pos.get(node.person_id);
      const isCenter = node.person_id === graph.center;
      const name = node.display_name.length > 18 ? `${node.display_name.slice(0, 18)}…` : node.display_name;
      return `<g class="g-node" data-id="${esc(node.person_id)}" style="cursor:pointer">
        <circle cx="${p.x}" cy="${p.y}" r="${isCenter ? 16 : 9}" class="${isCenter ? 'node-center' : ''}" fill="${isCenter ? '' : '#b08d57'}" />
        <text class="node-label" x="${p.x}" y="${p.y + (isCenter ? 32 : 22)}" text-anchor="middle">${esc(name)}</text>
      </g>`;
    })
    .join('');

  svg.innerHTML = `<g>${lines}${nodes}</g>`;
  svg.querySelectorAll('.g-node').forEach((el) => {
    el.addEventListener('click', () => go(personHref(el.dataset.id)));
  });
}

async function renderPerson(id) {
  setNav('browse');
  const data = await api(`/api/person/${encodeURIComponent(id)}`);
  if (data.ambiguous) {
    app.innerHTML = `<section class="hero"><h1>رقم ${esc(data.entry_number)} مكرر</h1><p class="muted">الطبعة تعيد استخدام هذا الرقم لأكثر من ترجمة.</p></section>${renderHits({ results: data.candidates, total: data.candidates.length })}`;
    return;
  }
  const p = data.person;
  const nasab = p.identity.nasab;
  const chain = (nasab.chain || [])
    .map((seg, i) => {
      const link = nasab.links?.[i] ? `<span class="link">${esc(nasab.links[i])}</span>` : '';
      return `${i ? link : ''}<span class="seg">${esc(seg)}</span>`;
    })
    .join('');
  const nisba = (nasab.nisba || []).map((n) => `<span class="chip">${esc(n)}</span>`).join('');

  app.innerHTML = `
    <section class="person-head">
      <div class="kicker">ترجمة ${esc(p.entry.number)} · مجلد ${esc(p.entry.volume || '؟')} · ص ${esc(p.entry.page_start)}–${esc(p.entry.page_end)}</div>
      <h1>${esc(p.identity.display_name)}</h1>
      <div class="chips">
        ${qismChip(p.classification.qism)}
        <span class="chip">${esc(SECTION_LABEL[p.classification.section_type] || p.classification.section_type)}</span>
        <span class="chip">${esc(p.classification.letter || '')}</span>
        ${p.identity.is_woman ? '<span class="chip">امرأة</span>' : ''}
        ${p.identity.kunya ? `<span class="chip">${esc(p.identity.kunya)}</span>` : ''}
        ${p.entry.number_is_ambiguous ? '<span class="chip warn">رقم مكرر</span>' : ''}
        ${(p.extraction.layers || []).map((l) => `<span class="source">${esc(l)}</span>`).join('')}
      </div>
      ${nasab.rejected_reason ? `<p class="muted">النسب مرفوض: ${esc(nasab.rejected_reason)}</p>` : `<div class="nasab-chain">${chain}${nisba}</div>`}
      <div class="toc-path">${(p.classification.toc_path || []).map(esc).join(' ← ')}</div>
      <p class="muted">${esc(p.classification.qism_label || '')}</p>
    </section>
    <section class="cols">
      <div>
        ${
          yearHtml(p.life.birth, 'ولادة') || yearHtml(p.life.death, 'وفاة')
            ? `<div class="panel"><h2>الميلاد والوفاة</h2>${yearHtml(p.life.birth, 'ولادة')}${yearHtml(p.life.death, 'وفاة')}</div>`
            : ''
        }
        ${factBlock('الصحبة', p.life.companionship, factHtml)}
        ${factBlock('الغزوات', p.life.battles, factHtml)}
        ${factBlock('الولايات', p.life.offices, (f) => factHtml({ ...f, value: [f.value, f.role, f.place].filter(Boolean).join(' · ') }))}
        ${factBlock('السكن', p.life.residences, factHtml)}
        ${factBlock('القرابة', p.life.family, (f) => factHtml({ ...f, value: `${REL_LABEL[f.relation] || f.relation || ''} ${f.value || f.name || ''}` }))}
        ${factBlock('صفات', p.life.traits, factHtml)}
        ${factBlock('إسلام', p.life.conversion, factHtml)}
      </div>
      <div>
        ${factBlock('روى عن', p.narration.narrated_from, factHtml)}
        ${factBlock('روى عنه', p.narration.narrated_to, factHtml)}
        ${factBlock('توثيق', p.narration.praise, factHtml)}
        ${factBlock('طعن', p.narration.criticism, factHtml)}
        ${factBlock('دفاع', p.narration.defenses, factHtml)}
        <div class="panel">
          <h2>الاستشهادات (${fmt(data.citations.length)})</h2>
          ${
            data.citations.length
              ? data.citations
                  .slice(0, 20)
                  .map(
                    (c) =>
                      `<div class="fact"><span class="val">${esc(c.verb)} ${esc(c.authority)}</span><div class="ev">${esc(c.evidence)}</div></div>`
                  )
                  .join('')
              : '<p class="muted">لا استشهادات مذكورة.</p>'
          }
        </div>
      </div>
    </section>
    <section class="panel">
      <h2>الجوار في الشبكة · ${fmt(data.neighbors.links.length)} رابطة محلولة</h2>
      <div class="legend">
        <span><i class="swatch" style="background:var(--accent-2)"></i>قرابة</span>
        <span><i class="swatch" style="background:var(--teal)"></i>روى عن</span>
        <span><i class="swatch" style="background:var(--blue)"></i>روى عنه</span>
        <span><i class="swatch" style="background:var(--accent)"></i>إحالة</span>
      </div>
      <div class="graph-wrap"><svg id="graph" viewBox="0 0 640 420"></svg></div>
      ${
        data.neighbors.unresolved.length
          ? `<p class="muted">إحالات غير محلولة (${fmt(data.neighbors.unresolved_total)}): ${data.neighbors.unresolved
              .slice(0, 8)
              .map((e) => esc(e.to_literal || TYPE_LABEL[e.type] || e.type))
              .join(' · ')}</p>`
          : ''
      }
    </section>
    <section class="panel">
      <h2>نص الترجمة</h2>
      <p class="muted" id="raw-status">يحمّل النص…</p>
      <div class="raw" id="raw-text" hidden></div>
    </section>
  `;

  const svg = document.getElementById('graph');
  drawGraph(svg, data.neighbors);
  try {
    const raw = await api(`/api/person/${encodeURIComponent(id)}/text`);
    document.getElementById('raw-status').hidden = true;
    const box = document.getElementById('raw-text');
    box.hidden = false;
    box.textContent = raw.text_body || '';
  } catch (err) {
    document.getElementById('raw-status').textContent = err.message;
  }
}

function renderQuality(meta) {
  setNav('quality');
  const q = meta.quality || {};
  const g = meta.graph || {};
  const fill = Object.entries(q.fill_rates || {});
  const rejections = Object.entries(q.nasab_rejections || {});
  const types = Object.entries(g.by_type || {});
  const authorities = (g.top_authorities || []).slice(0, 12);
  app.innerHTML = `
    <section class="hero">
      <div class="kicker">تقرير الجودة</div>
      <h1>ما امتلأ وما بقي فارغاً</h1>
      <p class="muted">طبقة الاستخراج الحالية: ${(meta.quality && Object.keys(meta.quality.layers || {}).join('، ')) || 'structural'} · تغطية LLM ${pct(q.llm_fact_coverage)}</p>
    </section>
    <section class="grid-2">
      <div class="card">
        <h2>امتلاء الحقول</h2>
        ${fill
          .map(
            ([k, v]) =>
              `<div class="bar-row"><span>${esc(k)}</span><div class="bar"><i style="width:${v.rate * 100}%"></i></div><span>${pct(v.rate)}</span></div>`
          )
          .join('')}
      </div>
      <div>
        <div class="card">
          <h2>أنواع الروابط</h2>
          ${types
            .map(
              ([k, n]) =>
                `<div class="bar-row"><span>${TYPE_LABEL[k] || k}</span><div class="bar"><i style="width:${(n / (g.edges || 1)) * 100}%"></i></div><span>${fmt(n)}</span></div>`
            )
            .join('')}
          <p class="muted">محلول ${fmt(g.resolved)} · ملتبس ${fmt(g.ambiguous)} · بلا هدف ${fmt(g.unresolved)}</p>
        </div>
        <div class="card" style="margin-top:0.9rem">
          <h2>أسباب رفض النسب</h2>
          ${rejections.map(([k, n]) => `<div class="fact"><span class="val">${esc(k)}</span> ${fmt(n)}</div>`).join('')}
        </div>
      </div>
    </section>
    <section class="card" style="margin-top:0.9rem">
      <h2>أكثر من استشهد بهم ابن حجر</h2>
      <div class="list">
        ${authorities
          .map(
            (a) =>
              `<div class="hit"><span class="num">${fmt(a.count)}</span><span class="name">${esc(a.label_ar || a.key)}</span><span></span></div>`
          )
          .join('')}
      </div>
    </section>
  `;
}

async function route() {
  const loc = parseHash();
  try {
    if (!state.meta) state.meta = await api('/api/meta');
    if (loc.page === 'overview') renderOverview(state.meta);
    else if (loc.page === 'browse') await renderBrowse(loc.params);
    else if (loc.page === 'quality') renderQuality(state.meta);
    else if (loc.page === 'person') await renderPerson(loc.id);
  } catch (err) {
    app.innerHTML = `<p class="empty">تعذّر التحميل: ${esc(err.message)}</p>`;
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
