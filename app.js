const PAGE_SIZE = 20;
const COLLECTION_SOURCES = {
  public: {
    file: 'collections_public.json',
    errorLabel: 'публічні колекції',
  },
  profile: {
    file: 'collections_unlisted.json',
    errorLabel: 'профільні колекції',
  },
};

const TYPE_LABEL = {
  anime: 'Аніме', manga: 'Манга', novel: 'Новела',
  character: 'Персонаж', person: 'Персона',
};

const DEFAULT_SORT_FIELD = 'updated';
const DEFAULT_SORT_ORDER = 'desc';
const THEME_STORAGE_KEY = 'hikka-collections.theme';
const FAVORITES_STORAGE_KEY = 'hikka-collections.favorites';
const THEME_ICONS = {
  light: '<path d="M12 3v2"/><path d="M12 19v2"/><path d="m5.64 5.64 1.42 1.42"/><path d="m16.94 16.94 1.42 1.42"/><path d="M3 12h2"/><path d="M19 12h2"/><path d="m5.64 18.36 1.42-1.42"/><path d="m16.94 7.06 1.42-1.42"/><circle cx="12" cy="12" r="4"/>',
  dark: '<path d="M12 3a6 6 0 0 0 9 7.2A8.5 8.5 0 1 1 12 3Z"/>',
};
const SORT_ORDER_ICONS = {
  asc: '<path d="M5 6h6M5 12h10M5 18h14"/>',
  desc: '<path d="M5 6h14M5 12h10M5 18h6"/>',
};
const SORT_ORDER_TITLES = {
  votes: {
    asc: 'За зростанням: менше голосів спочатку',
    desc: 'За спаданням: більше голосів спочатку',
  },
  created: {
    asc: 'За зростанням: старіші створені спочатку',
    desc: 'За спаданням: новіші створені спочатку',
  },
  updated: {
    asc: 'За зростанням: старіші оновлені спочатку',
    desc: 'За спаданням: новіші оновлені спочатку',
  },
  title: {
    asc: 'За зростанням: від А до Я',
    desc: 'За спаданням: від Я до А',
  },
};

// ── State ──────────────────────────────────────────────────────────────
let state = {
  all: [],
  filtered: [],
  page: 1,
  search: '',
  sortField: DEFAULT_SORT_FIELD,
  sortOrder: DEFAULT_SORT_ORDER,
  type: '',
  category: '',
  tag: '',
  author: '',
  subjective: false,
  collectionSource: 'public',
  favoritesOnly: false,
  favorites: readStoredFavorites(),
};

// ── DOM refs ───────────────────────────────────────────────────────────
const elGrid       = document.getElementById('js-grid');
const elCount      = document.getElementById('js-count');
const elSearch     = document.getElementById('js-search');
const elThemeToggle = document.getElementById('js-theme-toggle');
const elThemeIcon  = document.getElementById('js-theme-icon');
const elCollectionSource = document.getElementById('js-collection-source');
const elFavoritesView = document.getElementById('js-favorites-view');
const elFavoritesCount = document.getElementById('js-favorites-count');
const elSort       = document.getElementById('js-sort');
const elSortOrder  = document.getElementById('js-sort-order');
const elSortIcon   = document.getElementById('js-sort-order-icon');
const elType       = document.getElementById('js-type');
const elCategory   = document.getElementById('js-category');
const elSubjective = document.getElementById('js-subjective');
const elCategoryControl = elCategory.closest('.select-wrap');
const elSubjectiveControl = elSubjective.closest('.checkbox-wrap');
const elEmpty      = document.getElementById('js-empty');
const elPagination = document.getElementById('js-pagination');
const elPopularTags = document.getElementById('js-popular-tags');
const elPopularTagsList = document.getElementById('js-popular-tags-list');
const elPopularTagsToggle = document.getElementById('js-popular-tags-toggle');
const elPopularAuthors = document.getElementById('js-popular-authors');
const elPopularAuthorsList = document.getElementById('js-popular-authors-list');
const elPopularAuthorsToggle = document.getElementById('js-popular-authors-toggle');
const collapsibleChipBlocks = [
  { section: elPopularTags, list: elPopularTagsList, toggle: elPopularTagsToggle },
  { section: elPopularAuthors, list: elPopularAuthorsList, toggle: elPopularAuthorsToggle },
];
let chipLayoutFrame = null;

// ── Init ───────────────────────────────────────────────────────────────
async function init() {
  await loadCollections(state.collectionSource);
}

async function loadCollections(source) {
  const sourceKey = COLLECTION_SOURCES[source] ? source : 'public';
  const sourceConfig = COLLECTION_SOURCES[sourceKey];

  state.collectionSource = sourceKey;
  updateCollectionSourceControl();

  try {
    const resp = await fetch(sourceConfig.file);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const json = await resp.json();
    state.all = json.collections ?? [];
    resetCollectionFilters();
    populateCategories();
    renderPopularTags();
    renderPopularAuthors();
    updateSortControl();
    updateFavoritesControl();
    applyFilters();
  } catch {
    state.all = [];
    state.filtered = [];
    elCount.textContent = '0';
    elPagination.innerHTML = '';
    elEmpty.hidden = true;
    elGrid.innerHTML = `<p style="color:var(--dim);padding:2rem">Не вдалось завантажити ${sourceConfig.errorLabel} з ${sourceConfig.file}</p>`;
  }
}

// ── Categories ─────────────────────────────────────────────────────────
function populateCategories() {
  elCategory.querySelectorAll('option:not([value=""])').forEach(option => option.remove());

  const cats = [...new Set(state.all.flatMap(collectionCategories))].sort((a, b) => a.localeCompare(b, 'uk'));
  cats.forEach(category => {
    const opt = document.createElement('option');
    opt.value = category;
    opt.textContent = category;
    elCategory.appendChild(opt);
  });
  syncSelectLabel(elCategory);
}

function resetCollectionFilters() {
  state.page = 1;
  state.category = '';
  state.tag = '';
  state.author = '';
  state.subjective = false;

  elCategory.value = '';
  elSubjective.checked = false;
  syncSelectLabel(elCategory);
}

function renderPopularTags() {
  const tagCounts = new Map();

  state.all.forEach(col => {
    (col.tags ?? []).forEach(tag => {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    });
  });

  const popularTags = [...tagCounts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'uk'));

  elPopularTags.hidden = popularTags.length === 0;
  elPopularTagsList.innerHTML = popularTags.map(([tag, count]) => `
    <button class="popular-tag" type="button" data-tag="${escHtml(tag)}" aria-pressed="false">
      <span>${escHtml(tag)}</span>
      <strong>${count.toLocaleString('uk')}</strong>
    </button>
  `).join('');
  elPopularTagsList.appendChild(elPopularTagsToggle);
  queueChipLayoutUpdate();
}

function renderPopularAuthors() {
  const authorCounts = new Map();

  state.all.forEach(col => {
    if (!col.author?.username) return;

    const key = col.author.reference || col.author.username;
    const current = authorCounts.get(key) ?? {
      key,
      username: col.author.username,
      avatar: col.author.avatar,
      count: 0,
    };

    current.count += 1;
    if (!current.avatar && col.author.avatar) current.avatar = col.author.avatar;
    authorCounts.set(key, current);
  });

  const popularAuthors = [...authorCounts.values()]
    .filter(author => author.count > 1)
    .sort((a, b) => b.count - a.count || a.username.localeCompare(b.username, 'uk'));

  elPopularAuthors.hidden = popularAuthors.length === 0;
  elPopularAuthorsList.innerHTML = popularAuthors.map(author => `
    <button class="popular-author" type="button" data-author="${escHtml(author.key)}" aria-pressed="false">
      ${buildAuthorAvatar(author, 'popular-author-avatar')}
      <span>${escHtml(author.username)}</span>
      <strong>${author.count.toLocaleString('uk')}</strong>
    </button>
  `).join('');
  elPopularAuthorsList.appendChild(elPopularAuthorsToggle);
  queueChipLayoutUpdate();
}

// ── Filtering + sorting ────────────────────────────────────────────────
function applyFilters() {
  const q = state.search.toLowerCase().trim();

  let result = state.all.filter(col => {
    if (state.type && col.content_type !== state.type) return false;
    if (state.favoritesOnly && !state.favorites.has(collectionKey(col))) return false;
    if (state.category && !collectionCategories(col).includes(state.category)) return false;
    if (state.tag && !(col.tags ?? []).includes(state.tag)) return false;
    if (state.author && (col.author?.reference || col.author?.username) !== state.author) return false;
    if (state.collectionSource === 'public' && !state.subjective && col.subjective === true) return false;
    if (q) {
      const inTitle  = (col.title ?? '').toLowerCase().includes(q);
      const inAuthor = (col.author?.username ?? '').toLowerCase().includes(q);
      if (!inTitle && !inAuthor) return false;
    }
    return true;
  });

  result = sortCollections(result, state.sortField, state.sortOrder);

  state.filtered = result;
  state.page = 1;
  renderPage();
  updatePopularTagButtons();
  updatePopularAuthorButtons();
}

function sortCollections(list, field, order) {
  const direction = order === 'asc' ? 1 : -1;

  return [...list].sort((a, b) => {
    switch (field) {
      case 'votes':
        return ((a.vote_score ?? 0) - (b.vote_score ?? 0)) * direction;
      case 'created':
        return (toTimestamp(a.created) - toTimestamp(b.created)) * direction;
      case 'updated':
        return (toTimestamp(a.updated) - toTimestamp(b.updated)) * direction;
      case 'title':
        return (a.title ?? '').localeCompare(b.title ?? '', 'uk') * direction;
      default: return 0;
    }
  });
}

// ── Render ─────────────────────────────────────────────────────────────
function renderPage() {
  const { filtered, page } = state;
  const total = filtered.length;
  const start = (page - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

  elCount.textContent = total.toLocaleString('uk');
  elGrid.innerHTML = '';
  elEmpty.hidden = slice.length > 0;

  slice.forEach(col => elGrid.appendChild(buildCard(col)));
  renderPagination(total, page);

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Card builder ───────────────────────────────────────────────────────
function buildCard(col) {
  const card = document.createElement('article');
  card.className = 'card';
  card.setAttribute('role', 'listitem');

  const previewItems = col.collection ?? [];
  const typeKey = col.content_type ?? '';
  const favoriteKey = collectionKey(col);
  const isFavorite = state.favorites.has(favoriteKey);
  const previewClass = previewItems.length <= 1 ? 'preview-stack preview-stack--single' : 'preview-stack';

  card.innerHTML = `
    <div class="card-body">
      <div class="card-meta">
        ${buildAuthor(col)}
        <button class="favorite-btn${isFavorite ? ' active' : ''}" type="button" data-favorite="${escHtml(favoriteKey)}" aria-pressed="${isFavorite}" aria-label="${isFavorite ? 'Прибрати з обраного' : 'Додати в обране'}" title="${isFavorite ? 'Прибрати з обраного' : 'Додати в обране'}">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/>
          </svg>
        </button>
      </div>

      <h2 class="card-title" title="${escHtml(col.title ?? '')}">${escHtml(col.title ?? 'Без назви')}</h2>

      ${buildCardTags(col, typeKey)}

      <div class="card-footer">
        <span class="votes">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-big-up size-5!" aria-hidden="true"><path d="M9 19a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-6a1 1 0 0 1 1-1h3.293a.707.707 0 0 0 .5-1.207l-7.086-7.086a1 1 0 0 0-1.414 0l-7.086 7.086a.707.707 0 0 0 .5 1.207H8a1 1 0 0 1 1 1z"></path></svg>
          ${(col.vote_score ?? 0).toLocaleString('uk')}
        </span>
        <div class="card-stats">
          <span class="stat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-layers" aria-hidden="true"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"></path><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"></path><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"></path></svg>
            ${(col.entries ?? 0).toLocaleString('uk')}
          </span>
          <span class="stat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            ${(col.comments_count ?? 0).toLocaleString('uk')}
          </span>
        </div>
      </div>
    </div>

    <div class="card-previews">
      <div class="${previewClass}">
        ${buildPreviews(previewItems)}
      </div>
      <a class="preview-more" href="https://hikka.io/collections/${col.reference}" target="_blank" rel="noopener">
        Перейти до колекції
      </a>
    </div>
  `;
  return card;
}

function buildPreviews(items) {
  if (!items.length) return `<div class="preview-img placeholder">—</div>`;
  return items.map(item => {
    const img = item.content?.image;
    if (!img) return `<div class="preview-img placeholder">?</div>`;
    const alt = item.content?.title ?? item.content?.name ?? '';
    return `<div class="preview-img"><img src="${escHtml(img)}" alt="${escHtml(alt)}" loading="lazy"></div>`;
  }).join('');
}

function buildCardTags(col, typeKey) {
  const tags = [
    `<span class="card-type-badge badge-${typeKey}">${escHtml(TYPE_LABEL[typeKey] ?? typeKey)}</span>`,
    ...(col.tags ?? []).map(t => `<span class="tag">${escHtml(t)}</span>`),
  ];

  return `<div class="card-tags">${tags.join('')}</div>`;
}

function buildAuthor(col) {
  const author = col.author;
  if (!author) return '';
  const url = `https://hikka.io/u/${author.username ?? ''}`;
  return `
    <a class="card-author" href="${escHtml(url)}" target="_blank" rel="noopener" title="${escHtml(author.username ?? '')}">
      ${buildAuthorAvatar(author, 'author-avatar')}
      <span class="author-info">
        <span class="author-name">${escHtml(author.username ?? '')}</span>
        <span class="author-dates">
          <span>Створено: ${formatDate(col.created)}</span>
          <span>Оновлено: ${formatDate(col.updated)}</span>
        </span>
      </span>
    </a>
  `;
}

// ── Pagination ─────────────────────────────────────────────────────────
function renderPagination(total, current) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) { elPagination.innerHTML = ''; return; }

  const from = (current - 1) * PAGE_SIZE + 1;
  const to   = Math.min(current * PAGE_SIZE, total);

  const pageButtons = buildPageNumbers(current, pages).map(p => {
    if (p === '…') return `<span class="pg-sep">…</span>`;
    return `<button class="pg-btn${p === current ? ' active' : ''}" data-page="${p}" aria-label="Сторінка ${p}" ${p === current ? 'aria-current="page"' : ''}>${p}</button>`;
  }).join('');

  elPagination.innerHTML = `
    <div class="pagination-inner">
      <button class="pg-btn prev-btn" data-page="${current - 1}" aria-label="Попередня" ${current === 1 ? 'disabled' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <span class="pg-info"><strong>${from}–${to}</strong> / ${total.toLocaleString('uk')} · стор. <strong>${current}</strong> з ${pages}</span>
      ${pageButtons}
      <button class="pg-btn next-btn" data-page="${current + 1}" aria-label="Наступна" ${current === pages ? 'disabled' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
      </button>
    </div>
  `;
}

function buildPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [];
  if (current <= 4) {
    pages.push(1, 2, 3, 4, 5, '…', total);
  } else if (current >= total - 3) {
    pages.push(1, '…', total - 4, total - 3, total - 2, total - 1, total);
  } else {
    pages.push(1, '…', current - 1, current, current + 1, '…', total);
  }
  return pages;
}

// ── Helpers ────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildAuthorAvatar(author, className) {
  const username = author.username ?? '?';
  const initials = username.slice(0, 2).toUpperCase();

  return author.avatar
    ? `<img class="${className}" src="${escHtml(author.avatar)}" alt="${escHtml(username)}" loading="lazy">`
    : `<span class="${className} fallback">${escHtml(initials)}</span>`;
}

function collectionKey(col) {
  return col.reference || `${col.content_type || 'collection'}:${col.title || ''}:${col.author?.username || ''}`;
}

function collectionCategories(col) {
  const raw = col.categories ?? col.category ?? [];
  const categories = Array.isArray(raw) ? raw : [raw];

  return categories
    .map(category => typeof category === 'object' ? (category.name ?? category.title ?? category.slug) : category)
    .filter(Boolean)
    .map(String);
}

function toTimestamp(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value < 100000000000 ? value * 1000 : value;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatDate(value) {
  const timestamp = toTimestamp(value);
  if (!timestamp) return '—';

  return new Intl.DateTimeFormat('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(timestamp));
}

function updateSortControl() {
  const title = SORT_ORDER_TITLES[state.sortField]?.[state.sortOrder] || '';

  elSort.value = state.sortField;
  syncSelectLabel(elSort);

  elSortIcon.innerHTML = SORT_ORDER_ICONS[state.sortOrder];
  elSortOrder.title = title;
  elSortOrder.setAttribute('aria-label', title);
}

function syncSelectLabel(select) {
  const label = select.querySelector('.select-label');
  const selectedOption = select.selectedOptions[0];
  if (label && selectedOption) label.textContent = selectedOption.textContent.trim();
}

function updatePopularTagButtons() {
  elPopularTagsList.querySelectorAll('[data-tag]').forEach(btn => {
    const isActive = btn.dataset.tag === state.tag;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });
}

function updatePopularAuthorButtons() {
  elPopularAuthorsList.querySelectorAll('[data-author]').forEach(btn => {
    const isActive = btn.dataset.author === state.author;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });
}

function updateCollectionSourceControl() {
  const isProfileSource = state.collectionSource === 'profile';

  elCollectionSource.querySelectorAll('[data-source]').forEach(btn => {
    const isActive = btn.dataset.source === state.collectionSource;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });

  elCategoryControl.hidden = isProfileSource;
  elSubjectiveControl.hidden = isProfileSource;
  elCategory.disabled = isProfileSource;
  elSubjective.disabled = isProfileSource;
}

function updateFavoritesControl() {
  const count = state.all.filter(col => state.favorites.has(collectionKey(col))).length;
  elFavoritesCount.textContent = count.toLocaleString('uk');
  elFavoritesView.classList.toggle('active', state.favoritesOnly);
  elFavoritesView.setAttribute('aria-pressed', String(state.favoritesOnly));
  elFavoritesView.title = state.favoritesOnly ? 'Показати всі колекції' : 'Показати обране';
  elFavoritesView.setAttribute('aria-label', elFavoritesView.title);
}

function readStoredFavorites() {
  try {
    const stored = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) || '[]');
    return new Set(Array.isArray(stored) ? stored : []);
  } catch {
    return new Set();
  }
}

function storeFavorites() {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...state.favorites]));
  } catch { /* localStorage can be unavailable */ }
}

function queueChipLayoutUpdate() {
  cancelAnimationFrame(chipLayoutFrame);
  chipLayoutFrame = requestAnimationFrame(updateCollapsibleChipBlocks);
}

function updateCollapsibleChipBlocks() {
  collapsibleChipBlocks.forEach(updateCollapsibleChipBlock);
}

function updateCollapsibleChipBlock({ section, list, toggle }) {
  if (!section || !list || !toggle || section.hidden) return;

  const items = [...list.children].filter(item => item !== toggle);
  items.forEach(item => item.classList.remove('chip-overflow-hidden'));
  toggle.hidden = true;

  if (items.length === 0) {
    section.dataset.expanded = 'false';
    return;
  }

  const firstRowTop = items[0].offsetTop;
  const hasOverflow = items.some(item => item.offsetTop > firstRowTop + 1);
  const isExpanded = section.dataset.expanded === 'true';

  toggle.hidden = !hasOverflow;

  if (!hasOverflow) {
    section.dataset.expanded = 'false';
    toggle.textContent = 'Показати все';
    return;
  }

  toggle.textContent = isExpanded ? 'Показати менше' : 'Показати все';

  if (!isExpanded) {
    collapseChipsToFirstRow(items, toggle, firstRowTop);
  }
}

function collapseChipsToFirstRow(items, toggle, firstRowTop) {
  let visibleItems = items.filter(item => !item.classList.contains('chip-overflow-hidden'));

  while (toggle.offsetTop > firstRowTop + 1 && visibleItems.length > 0) {
    visibleItems.at(-1).classList.add('chip-overflow-hidden');
    visibleItems = visibleItems.slice(0, -1);
  }

  visibleItems.forEach(item => {
    if (item.offsetTop > firstRowTop + 1) {
      item.classList.add('chip-overflow-hidden');
    }
  });
}

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* localStorage can be unavailable */ }

  return 'dark';
}

function storeTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch { /* localStorage can be unavailable */ }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;

  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const label = nextTheme === 'light' ? 'Увімкнути світлу тему' : 'Увімкнути темну тему';
  elThemeIcon.innerHTML = THEME_ICONS[nextTheme];
  elThemeToggle.title = label;
  elThemeToggle.setAttribute('aria-label', label);
}

function debounce(fn, ms = 250) {
  let timer;

  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ── Events ─────────────────────────────────────────────────────────────
elSearch.addEventListener('input', debounce(() => {
  state.search = elSearch.value;
  applyFilters();
}));

elSort.addEventListener('change', () => {
  state.sortField = elSort.value;
  updateSortControl();
  applyFilters();
});

elSortOrder.addEventListener('click', () => {
  state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
  updateSortControl();
  applyFilters();
});

elType.addEventListener('change', () => {
  state.type = elType.value;
  syncSelectLabel(elType);
  applyFilters();
});

elCategory.addEventListener('change', () => {
  state.category = elCategory.value;
  syncSelectLabel(elCategory);
  applyFilters();
});

elSubjective.addEventListener('change', () => {
  state.subjective = elSubjective.checked;
  applyFilters();
});

elGrid.addEventListener('click', e => {
  const btn = e.target.closest('[data-favorite]');
  if (!btn) return;

  const key = btn.dataset.favorite;
  if (state.favorites.has(key)) {
    state.favorites.delete(key);
  } else {
    state.favorites.add(key);
  }

  storeFavorites();
  updateFavoritesControl();

  if (state.favoritesOnly) {
    applyFilters();
  } else {
    renderPage();
  }
});

elPopularTagsList.addEventListener('click', e => {
  const btn = e.target.closest('[data-tag]');
  if (!btn) return;

  state.tag = state.tag === btn.dataset.tag ? '' : btn.dataset.tag;
  applyFilters();
});

elPopularAuthorsList.addEventListener('click', e => {
  const btn = e.target.closest('[data-author]');
  if (!btn) return;

  state.author = state.author === btn.dataset.author ? '' : btn.dataset.author;
  applyFilters();
});

collapsibleChipBlocks.forEach(block => {
  block.toggle.addEventListener('click', () => {
    block.section.dataset.expanded = block.section.dataset.expanded === 'true' ? 'false' : 'true';
    updateCollapsibleChipBlock(block);
  });
});

window.addEventListener('resize', debounce(queueChipLayoutUpdate, 120));

elThemeToggle.addEventListener('click', () => {
  const currentTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';

  applyTheme(nextTheme);
  storeTheme(nextTheme);
});

elCollectionSource.addEventListener('click', e => {
  const btn = e.target.closest('[data-source]');
  if (!btn || btn.dataset.source === state.collectionSource) return;

  loadCollections(btn.dataset.source);
});

elFavoritesView.addEventListener('click', () => {
  state.favoritesOnly = !state.favoritesOnly;
  updateFavoritesControl();
  applyFilters();
});

elPagination.addEventListener('click', e => {
  const btn = e.target.closest('[data-page]');
  if (!btn || btn.disabled) return;
  state.page = Number(btn.dataset.page);
  renderPage();
});

applyTheme(readStoredTheme());
updateFavoritesControl();
init();
