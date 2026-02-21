const DB_NAME = 'holy-flow-db';
const DB_STORE = 'state';
const DB_KEY = 'main';
const LOCAL_FALLBACK_KEY = 'holy-flow-fallback';
const SECURE_BACKUP_FORMAT = 'holy-flow-secure-backup';
const SECURE_BACKUP_VERSION = 1;
const SECURE_BACKUP_PBKDF2_ITERATIONS = 210000;
const APP_BUNDLE_VERSION = '20260221-10';
const defaultPrayerCategories = ['개인', '가정', '교회', '일터', '선교'];
const aiProviders = ['openai', 'claude', 'gemini', 'grok', 'perplexity'];
const aiProviderLabelMap = {
  openai: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  grok: 'Grok',
  perplexity: 'Perplexity',
};

const defaultState = {
  qts: [],
  prayers: [],
  gratitudes: [],
  routineByDate: {},
  ui: {
    settingsVersion: 6,
    showRecordCalendar: false,
    showQtHistory: false,
    prayerCategories: defaultPrayerCategories,
    aiProvider: 'openai',
    aiFallbackMode: 'auto',
    bibleVersion: '개역개정',
    openaiApiKey: '',
    claudeApiKey: '',
    geminiApiKey: '',
    grokApiKey: '',
    perplexityApiKey: '',
  },
};

const routines = ['말씀읽기', '기도', '암송', '예배', '섬김', '찬양'];

const toDateKey = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const fromDateKeyToLabel = (dateKey) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
};

const toDateDisplayLabel = (dateKey) => {
  const [y, m, d] = dateKey.split('-');
  return `${y}. ${m}. ${d}.`;
};

const escapeHtml = (value = '') =>
  String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[char] || char;
  });

const normalizeCategoryList = (categories) => {
  const source = Array.isArray(categories) ? categories : [];
  const unique = [];
  const seen = new Set();

  source.forEach((raw) => {
    if (typeof raw !== 'string') return;
    const name = raw.trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    unique.push(name);
  });

  return unique.length ? unique : [...defaultPrayerCategories];
};

const normalizeAiProvider = (provider) => (aiProviders.includes(provider) ? provider : 'openai');
const normalizeAiFallbackMode = (mode) => (mode === 'strict' ? 'strict' : 'auto');

const normalizeBibleVersion = (version) => (['개역개정', '우리말성경'].includes(version) ? version : '개역개정');

const asSafeString = (value) => (typeof value === 'string' ? value.trim() : '');

const toHtmlMultiline = (value = '') => escapeHtml(value).replace(/\n/g, '<br />');

const cloneDefault = () => JSON.parse(JSON.stringify(defaultState));
const $ = (selector) => document.querySelector(selector);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const searchParams = new URLSearchParams(window.location.search);
const desktopMode = searchParams.get('desktop') === '1';
const forcedAppMode = searchParams.get('app') === '1';
const standaloneMode = Boolean(window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone);
const appLikeMode = desktopMode || forcedAppMode || standaloneMode;

let state = cloneDefault();
let selectedDate = toDateKey();
let db;
let deferredPrompt;
let calendarCursor = new Date();
let datePopoverOpen = false;
let settingsPopoverOpen = false;

const supportsSecureBackup = () => Boolean(window.crypto?.subtle && window.crypto?.getRandomValues);
const supportsCompression = () => typeof CompressionStream !== 'undefined';
const supportsDecompression = () => typeof DecompressionStream !== 'undefined';

const toBase64 = (bytes) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const fromBase64 = (base64) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const compressBytes = async (bytes) => {
  if (!supportsCompression()) {
    return { bytes, compression: 'none' };
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  const compressedBuffer = await new Response(stream).arrayBuffer();
  return { bytes: new Uint8Array(compressedBuffer), compression: 'gzip' };
};

const decompressBytes = async (bytes, compression) => {
  if (compression === 'none') return bytes;
  if (compression !== 'gzip') {
    throw new Error('지원하지 않는 백업 압축 형식입니다.');
  }
  if (!supportsDecompression()) {
    throw new Error('이 백업은 압축 형식(gzip)입니다. 최신 브라우저에서 복원해주세요.');
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const decompressedBuffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(decompressedBuffer);
};

const deriveBackupKey = async (password, salt, iterations) => {
  const baseKey = await crypto.subtle.importKey('raw', textEncoder.encode(password), { name: 'PBKDF2' }, false, [
    'deriveKey',
  ]);

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
};

const normalizeState = (parsed) => {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return cloneDefault();
  }

  const rawUi = parsed.ui && typeof parsed.ui === 'object' && !Array.isArray(parsed.ui) ? parsed.ui : {};
  const settingsVersion = Number(rawUi.settingsVersion || 0);
  const hasSettingsV3 = settingsVersion >= 3;

  return {
    ...cloneDefault(),
    ...parsed,
    qts: Array.isArray(parsed.qts) ? parsed.qts : [],
    prayers: Array.isArray(parsed.prayers) ? parsed.prayers : [],
    gratitudes: Array.isArray(parsed.gratitudes) ? parsed.gratitudes : [],
    routineByDate:
      parsed.routineByDate && typeof parsed.routineByDate === 'object' && !Array.isArray(parsed.routineByDate)
        ? parsed.routineByDate
        : {},
    ui: {
      settingsVersion: 6,
      showRecordCalendar: hasSettingsV3 ? rawUi.showRecordCalendar === true : false,
      showQtHistory: hasSettingsV3 ? rawUi.showQtHistory === true : false,
      prayerCategories: normalizeCategoryList(rawUi.prayerCategories),
      aiProvider: normalizeAiProvider(rawUi.aiProvider),
      aiFallbackMode: normalizeAiFallbackMode(rawUi.aiFallbackMode),
      bibleVersion: normalizeBibleVersion(rawUi.bibleVersion),
      openaiApiKey: asSafeString(rawUi.openaiApiKey),
      claudeApiKey: asSafeString(rawUi.claudeApiKey),
      geminiApiKey: asSafeString(rawUi.geminiApiKey),
      grokApiKey: asSafeString(rawUi.grokApiKey),
      perplexityApiKey: asSafeString(rawUi.perplexityApiKey),
    },
  };
};

const sanitizeImportedState = (parsed) => {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('백업 형식이 올바르지 않습니다.');
  }
  return normalizeState(parsed);
};

const downloadFile = (content, filename, type = 'application/json') => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const createSecureBackupText = async (data, password) => {
  const payload = {
    version: SECURE_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    state: data,
  };
  const payloadBytes = textEncoder.encode(JSON.stringify(payload));
  const compressed = await compressBytes(payloadBytes);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBackupKey(password, salt, SECURE_BACKUP_PBKDF2_ITERATIONS);
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, compressed.bytes);

  return JSON.stringify(
    {
      format: SECURE_BACKUP_FORMAT,
      version: SECURE_BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      compression: compressed.compression,
      kdf: {
        name: 'PBKDF2',
        hash: 'SHA-256',
        iterations: SECURE_BACKUP_PBKDF2_ITERATIONS,
        salt: toBase64(salt),
      },
      cipher: {
        name: 'AES-GCM',
        iv: toBase64(iv),
      },
      ciphertext: toBase64(new Uint8Array(cipherBuffer)),
    },
    null,
    2,
  );
};

const isSecureBackupEnvelope = (parsed) =>
  Boolean(parsed && typeof parsed === 'object' && parsed.format === SECURE_BACKUP_FORMAT);

const restoreSecureBackupState = async (envelope, password) => {
  if (!isSecureBackupEnvelope(envelope)) {
    throw new Error('보호 백업 파일 형식이 올바르지 않습니다.');
  }

  const iterations = Number(envelope?.kdf?.iterations);
  const saltValue = envelope?.kdf?.salt;
  const ivValue = envelope?.cipher?.iv;
  const ciphertextValue = envelope?.ciphertext;

  if (!iterations || !saltValue || !ivValue || !ciphertextValue) {
    throw new Error('보호 백업 파일 메타데이터가 누락되었습니다.');
  }

  try {
    const salt = fromBase64(saltValue);
    const iv = fromBase64(ivValue);
    const ciphertext = fromBase64(ciphertextValue);
    const key = await deriveBackupKey(password, salt, iterations);
    const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    const plainBytes = await decompressBytes(new Uint8Array(plainBuffer), envelope.compression || 'none');
    const payload = JSON.parse(textDecoder.decode(plainBytes));
    return sanitizeImportedState(payload?.state ?? payload);
  } catch {
    throw new Error('비밀번호가 올바르지 않거나 백업 파일이 손상되었습니다.');
  }
};

const openDB =
  window.indexedDB &&
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const saveFallback = (data) => localStorage.setItem(LOCAL_FALLBACK_KEY, JSON.stringify(data));

const loadFallback = () => {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(LOCAL_FALLBACK_KEY)));
  } catch {
    return cloneDefault();
  }
};

const toDateFromKey = (dateKey) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const setCalendarCursorFromDateKey = (dateKey) => {
  const date = toDateFromKey(dateKey);
  calendarCursor = new Date(date.getFullYear(), date.getMonth(), 1);
};

const getRecordedDateKeySet = () => {
  const recorded = new Set();

  state.qts.forEach((item) => item?.dateKey && recorded.add(item.dateKey));
  state.prayers.forEach((item) => item?.dateKey && recorded.add(item.dateKey));
  state.gratitudes.forEach((item) => item?.dateKey && recorded.add(item.dateKey));

  Object.entries(state.routineByDate).forEach(([dateKey, routineMap]) => {
    if (!routineMap || typeof routineMap !== 'object') return;
    if (Object.values(routineMap).some(Boolean)) {
      recorded.add(dateKey);
    }
  });

  return recorded;
};

const loadState = async () => {
  if (!openDB) {
    state = normalizeState(loadFallback());
    return;
  }

  try {
    db = await openDB;
    const value = await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(DB_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    state = normalizeState(value || loadFallback());
  } catch {
    state = normalizeState(loadFallback());
  }
};

const persistState = async () => {
  saveFallback(state);
  if (!db) return;

  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const req = tx.objectStore(DB_STORE).put(state, DB_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }).catch(() => null);
};

const ensureRoutineForSelectedDate = () => {
  if (!state.routineByDate[selectedDate]) {
    state.routineByDate[selectedDate] = Object.fromEntries(routines.map((name) => [name, false]));
  }
};

const setDatePopoverOpen = (isOpen) => {
  const popover = $('#datePickerPopover');
  const toggle = $('#datePickerToggle');
  if (!popover || !toggle) return;
  popover.hidden = !isOpen;
  toggle.setAttribute('aria-expanded', String(isOpen));
  datePopoverOpen = isOpen;
};

const setSettingsPopoverOpen = (isOpen) => {
  const popover = $('#settingsPopover');
  const toggle = $('#settingsToggleBtn');
  if (!popover || !toggle) return;
  popover.hidden = !isOpen;
  toggle.setAttribute('aria-expanded', String(isOpen));
  settingsPopoverOpen = isOpen;
};

const renderDateHeader = () => {
  const datePicker = $('#datePicker');
  const datePickerLabel = $('#datePickerLabel');
  const todayLabel = $('#todayLabel');
  if (datePicker) datePicker.value = selectedDate;
  if (datePickerLabel) datePickerLabel.textContent = toDateDisplayLabel(selectedDate);
  if (todayLabel) todayLabel.textContent = fromDateKeyToLabel(selectedDate);
};

const renderPrayerCategoryOptions = () => {
  const select = $('#prayerCategorySelect');
  if (!select) return;

  const categories = normalizeCategoryList(state?.ui?.prayerCategories);
  const previousValue = select.value;
  select.innerHTML = categories
    .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
    .join('');

  if (categories.includes(previousValue)) {
    select.value = previousValue;
  } else {
    [select.value] = categories;
  }
};

const renderPrayerCategorySettings = () => {
  const listEl = $('#prayerCategorySettingsList');
  if (!listEl) return;

  const categories = normalizeCategoryList(state?.ui?.prayerCategories);
  listEl.innerHTML = categories
    .map(
      (name, index) => `
      <li class="settings-list-item">
        <span>${escapeHtml(name)}</span>
        <button type="button" class="danger-ghost settings-delete-btn" data-category-delete="${index}">삭제</button>
      </li>
    `,
    )
    .join('');
};

const renderAiSettings = () => {
  const providerSelect = $('#aiProviderSelect');
  const fallbackModeSelect = $('#aiFallbackModeSelect');
  const bibleVersionSelect = $('#bibleVersionSelect');
  const openaiInput = $('#openaiApiKeyInput');
  const claudeInput = $('#claudeApiKeyInput');
  const geminiInput = $('#geminiApiKeyInput');
  const grokInput = $('#grokApiKeyInput');
  const perplexityInput = $('#perplexityApiKeyInput');
  const uiState = state?.ui || {};

  if (providerSelect) providerSelect.value = normalizeAiProvider(uiState.aiProvider);
  if (fallbackModeSelect) fallbackModeSelect.value = normalizeAiFallbackMode(uiState.aiFallbackMode);
  if (bibleVersionSelect) bibleVersionSelect.value = normalizeBibleVersion(uiState.bibleVersion);
  if (openaiInput) openaiInput.value = asSafeString(uiState.openaiApiKey);
  if (claudeInput) claudeInput.value = asSafeString(uiState.claudeApiKey);
  if (geminiInput) geminiInput.value = asSafeString(uiState.geminiApiKey);
  if (grokInput) grokInput.value = asSafeString(uiState.grokApiKey);
  if (perplexityInput) perplexityInput.value = asSafeString(uiState.perplexityApiKey);
  document.querySelectorAll('[data-ai-key-field]').forEach((field) => {
    field.hidden = field.getAttribute('data-ai-key-field') !== normalizeAiProvider(uiState.aiProvider);
  });
};

const getAiKeyMap = () => ({
    openai: asSafeString(state?.ui?.openaiApiKey),
    claude: asSafeString(state?.ui?.claudeApiKey),
    gemini: asSafeString(state?.ui?.geminiApiKey),
    grok: asSafeString(state?.ui?.grokApiKey),
    perplexity: asSafeString(state?.ui?.perplexityApiKey),
  });

const getActiveAiConfig = () => {
  const provider = normalizeAiProvider(state?.ui?.aiProvider);
  const fallbackMode = normalizeAiFallbackMode(state?.ui?.aiFallbackMode);
  const bibleVersion = normalizeBibleVersion(state?.ui?.bibleVersion);
  const keyMap = getAiKeyMap();
  return { provider, fallbackMode, bibleVersion, apiKey: keyMap[provider] || '', keyMap };
};

const buildAiAttemptProviders = (selectedProvider, keyMap, fallbackMode) => {
  if (fallbackMode === 'strict') return [selectedProvider];
  const ordered = [selectedProvider, ...aiProviders.filter((provider) => provider !== selectedProvider)];
  const keyedProviders = ordered.filter((provider) => Boolean(asSafeString(keyMap[provider])));
  if (!keyedProviders.length) return [selectedProvider];
  if (keyedProviders.includes(selectedProvider)) return keyedProviders;
  return [...keyedProviders, selectedProvider];
};

const isBasicModePayload = (result) => asSafeString(result?.passageText).startsWith('[기본 요청 모드]');

const setBibleAssistantLoading = (loading) => {
  const btn = $('#qtAiRequestBtn');
  const qtInput = $('#qtScriptureInput') || $('#qtForm input[name="scripture"]');
  const loadingEl = $('#bibleAssistantLoading');
  if (loadingEl) loadingEl.hidden = !loading;
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? 'AI 요청 중...' : 'AI 요청';
  if (qtInput) qtInput.disabled = loading;
};

const renderBibleAssistantResult = ({
  passage,
  bibleVersion,
  provider,
  passageText,
  summary,
  explanation,
  error,
  loading,
} = {}) => {
  const container = $('#bibleAssistantResult');
  if (!container) return;

  if (loading) {
    container.innerHTML = '<p class="help-text">AI 분석 중입니다. 잠시만 기다려주세요.</p>';
    return;
  }

  if (error) {
    container.innerHTML = `<p class="help-text error-text">${toHtmlMultiline(error)}</p>`;
    return;
  }

  if (!passageText && !summary && !explanation) {
    container.innerHTML =
      '<p class="help-text">QT 일기장의 오늘의 본문 오른쪽의 AI 요청 버튼을 눌러주세요. API 키가 없으면 기본 요청 모드로 먼저 시도합니다.</p>';
    return;
  }

  container.innerHTML = `
    <div class="assistant-block">
      <p class="assistant-meta">${escapeHtml(provider || '')} · ${escapeHtml(bibleVersion || '')} · ${escapeHtml(passage || '')}</p>
      <h4>본문</h4>
      <p>${toHtmlMultiline(passageText || '')}</p>
      <h4>요약</h4>
      <p>${toHtmlMultiline(summary || '')}</p>
      <h4>설명</h4>
      <p>${toHtmlMultiline(explanation || '')}</p>
    </div>
  `;
};

const renderDisplaySettings = () => {
  const showRecordCalendar = state?.ui?.showRecordCalendar === true;
  const showQtHistory = state?.ui?.showQtHistory === true;
  const recordToggle = $('#toggleRecordCalendar');
  const historyToggle = $('#toggleQtHistory');
  const recordCard = $('#recordCalendarCard');
  const historyCard = $('#qtHistoryCard');
  const summaryCard = $('#dailySummaryCard');

  if (recordToggle) recordToggle.checked = showRecordCalendar;
  if (historyToggle) historyToggle.checked = showQtHistory;
  if (recordCard) recordCard.hidden = !showRecordCalendar;
  if (historyCard) historyCard.hidden = !showQtHistory;
  if (summaryCard) summaryCard.classList.toggle('daily-summary-card--wide', !showRecordCalendar);

  renderPrayerCategorySettings();
  renderPrayerCategoryOptions();
  renderAiSettings();
};

const buildCalendarCells = ({ year, month, recordedDateSet, todayKey, compact = false }) => {
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let cells = '';
  for (let index = 0; index < 42; index += 1) {
    const dayNumber = index - startWeekday + 1;
    if (dayNumber < 1 || dayNumber > daysInMonth) {
      const emptyClass = compact ? 'calendar-day--compact' : '';
      cells += `<div class="calendar-day calendar-day--empty ${emptyClass}" aria-hidden="true"></div>`;
      continue;
    }

    const cellDateKey = toDateKey(new Date(year, month, dayNumber));
    const classes = ['calendar-day'];
    if (compact) classes.push('calendar-day--compact');
    if (cellDateKey === selectedDate) classes.push('calendar-day--selected');
    if (cellDateKey === todayKey) classes.push('calendar-day--today');
    const heartClass = compact ? 'calendar-heart calendar-heart--compact' : 'calendar-heart';
    const heart = recordedDateSet.has(cellDateKey) ? `<span class="${heartClass}" aria-hidden="true">♥</span>` : '';

    cells += `
      <button
        type="button"
        class="${classes.join(' ')}"
        data-date-select="${cellDateKey}"
        aria-label="${cellDateKey} 기록 보기"
      >
        <span class="calendar-day-num">${dayNumber}</span>
        ${heart}
      </button>
    `;
  }
  return cells;
};

const renderCalendar = () => {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const todayKey = toDateKey();
  const recordedDateSet = getRecordedDateKeySet();
  const monthLabel = `${year}년 ${month + 1}월`;

  const monthLabelEl = $('#calendarMonthLabel');
  const calendarGridEl = $('#calendarGrid');
  if (monthLabelEl) monthLabelEl.textContent = monthLabel;
  if (calendarGridEl) {
    calendarGridEl.innerHTML = buildCalendarCells({
      year,
      month,
      recordedDateSet,
      todayKey,
      compact: true,
    });
  }

  const popoverMonthLabelEl = $('#datePopoverMonthLabel');
  const popoverGridEl = $('#datePopoverGrid');
  if (popoverMonthLabelEl) popoverMonthLabelEl.textContent = monthLabel;
  if (popoverGridEl) {
    popoverGridEl.innerHTML = buildCalendarCells({
      year,
      month,
      recordedDateSet,
      todayKey,
      compact: true,
    });
  }
};

const renderStats = () => {
  const answered = state.prayers.filter((p) => p.answered).length;
  const selectedRoutine = state.routineByDate[selectedDate] || {};
  const done = Object.values(selectedRoutine).filter(Boolean).length;
  const rate = routines.length ? Math.round((done / routines.length) * 100) : 0;

  $('#stats').innerHTML = `
    <div class="stat"><p>누적 QT</p><strong>${state.qts.length}</strong></div>
    <div class="stat"><p>기도 응답</p><strong>${answered}</strong></div>
    <div class="stat"><p>감사 기록</p><strong>${state.gratitudes.length}</strong></div>
    <div class="stat"><p>${selectedDate} 루틴</p><strong>${rate}%</strong></div>
  `;
};

const renderPrayers = () => {
  const prayers = state.prayers.filter((p) => p.dateKey === selectedDate);
  $('#prayerList').innerHTML = prayers
    .map(
      (p) => `
      <li class="item">
        <div>
          <span class="badge">${p.category}</span>
          <span>${p.content}</span>
        </div>
        <div class="actions">
          <label><input type="checkbox" data-prayer-check="${p.id}" ${p.answered ? 'checked' : ''}/>응답</label>
          <button type="button" data-prayer-edit="${p.id}">수정</button>
          <button type="button" class="danger" data-prayer-delete="${p.id}">삭제</button>
        </div>
      </li>
    `,
    )
    .join('');
};

const renderGratitudes = () => {
  const gratitudes = state.gratitudes.filter((g) => g.dateKey === selectedDate);
  $('#gratitudeList').innerHTML = gratitudes
    .map(
      (g) => `
      <li class="item">
        <span>${g.text}</span>
        <div class="actions">
          <button type="button" data-gratitude-edit="${g.id}">수정</button>
          <button type="button" class="danger" data-gratitude-delete="${g.id}">삭제</button>
          <span class="badge badge--ok">${g.dateKey}</span>
        </div>
      </li>
    `,
    )
    .join('');
};

const renderRoutine = () => {
  ensureRoutineForSelectedDate();
  const dateRoutine = state.routineByDate[selectedDate];
  $('#routineList').innerHTML = Object.entries(dateRoutine)
    .map(
      ([name, checked]) => `
      <label class="routine">
        <input type="checkbox" data-routine="${name}" ${checked ? 'checked' : ''}/>
        <span>${name}</span>
      </label>
    `,
    )
    .join('');
};

const renderHistory = () => {
  const history = state.qts.filter((q) => q.dateKey === selectedDate).reverse();
  if (!history.length) {
    $('#qtHistory').innerHTML = '<p>해당 날짜 QT 기록이 없습니다.</p>';
    return;
  }

  $('#qtHistory').innerHTML = history
    .map(
      (q) => `
      <article>
        <h4>${q.title}</h4>
        <p><strong>본문:</strong> ${q.scripture}</p>
        <p><strong>묵상:</strong> ${q.meditation}</p>
        <p><strong>적용:</strong> ${q.application || '-'}</p>
        <p><strong>기도:</strong> ${q.prayer}</p>
        <div class="actions">
          <button type="button" data-qt-edit="${q.id}">수정</button>
          <button type="button" class="danger" data-qt-delete="${q.id}">삭제</button>
          <span class="badge badge--ok">${q.dateKey}</span>
        </div>
      </article>
    `,
    )
    .join('');
};

const rerender = async () => {
  renderDateHeader();
  renderDisplaySettings();
  renderCalendar();
  renderStats();
  renderPrayers();
  renderGratitudes();
  renderRoutine();
  renderHistory();
  await persistState();
};

const shiftDate = async (diff) => {
  const date = new Date(selectedDate);
  date.setDate(date.getDate() + diff);
  selectedDate = toDateKey(date);
  setCalendarCursorFromDateKey(selectedDate);
  await rerender();
};

const findById = (array, id) => array.find((item) => item.id === id);

const registerInstallPrompt = () => {
  const installBtn = $('#installBtn');
  if (!installBtn) return;

  if (appLikeMode) {
    installBtn.hidden = true;
    return;
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    installBtn.hidden = false;
  });

  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installBtn.hidden = true;
  });
};

const registerServiceWorker = async () => {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register(`./sw.js?v=${APP_BUNDLE_VERSION}`);
    registration.update?.();
  } catch {
    // ignore registration error
  }
};

const registerDesktopShutdown = () => {
  const shutdownBtn = $('#shutdownAppBtn');
  if (!shutdownBtn) return;

  if (!desktopMode) {
    shutdownBtn.hidden = true;
    return;
  }

  shutdownBtn.hidden = false;
  shutdownBtn.addEventListener('click', async () => {
    shutdownBtn.disabled = true;
    try {
      await fetch('/__holyflow_shutdown', { method: 'GET', cache: 'no-store' });
    } catch {
      // ignore shutdown endpoint error
    }
    window.close();
  });
};

const requestBibleAssistant = async (passage) => {
  const { provider, fallbackMode, bibleVersion, keyMap } = getActiveAiConfig();
  const attemptProviders = buildAiAttemptProviders(provider, keyMap, fallbackMode);
  let firstError = null;
  let deferredBasicResult = null;

  const requestByProvider = async (providerName, apiKey) => {
    let response;
    try {
      response = await fetch('/__holyflow_ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: providerName,
          fallbackMode,
          bibleVersion,
          passage,
          apiKey,
        }),
      });
    } catch {
      throw new Error('AI 서버 연결에 실패했습니다. 최신 EXE/APP 버전으로 실행해주세요.');
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('AI 기능은 최신 데스크톱(EXE/APP) 실행기에서 지원됩니다.');
      }
      throw new Error(payload?.error || 'AI 응답 생성에 실패했습니다.');
    }

    const result = payload?.result;
    if (!result || typeof result !== 'object') {
      throw new Error('AI 응답 형식이 올바르지 않습니다.');
    }

    return result;
  };

  for (let index = 0; index < attemptProviders.length; index += 1) {
    const providerName = attemptProviders[index];
    const apiKey = asSafeString(keyMap[providerName]);
    try {
      const result = await requestByProvider(providerName, apiKey);
      const moreKeyedProviders = attemptProviders
        .slice(index + 1)
        .some((nextProvider) => Boolean(asSafeString(keyMap[nextProvider])));
      if (fallbackMode === 'auto' && isBasicModePayload(result) && apiKey && moreKeyedProviders) {
        deferredBasicResult = { providerName, result };
        continue;
      }
      return {
        provider: aiProviderLabelMap[providerName] || providerName,
        bibleVersion,
        passage,
        passageText: asSafeString(result.passageText),
        summary: asSafeString(result.summary),
        explanation: asSafeString(result.explanation),
      };
    } catch (error) {
      if (!firstError) firstError = error;
    }
  }

  if (deferredBasicResult) {
    return {
      provider: aiProviderLabelMap[deferredBasicResult.providerName] || deferredBasicResult.providerName,
      bibleVersion,
      passage,
      passageText: asSafeString(deferredBasicResult.result.passageText),
      summary: asSafeString(deferredBasicResult.result.summary),
      explanation: asSafeString(deferredBasicResult.result.explanation),
    };
  }

  throw firstError || new Error('AI 응답 생성에 실패했습니다.');
};

const getBibleAssistantPassage = () => {
  const qtInput = $('#qtScriptureInput') || $('#qtForm input[name="scripture"]');
  const typedPassage = asSafeString(qtInput?.value);
  if (typedPassage) return typedPassage;

  for (let i = state.qts.length - 1; i >= 0; i -= 1) {
    const qt = state.qts[i];
    if (qt?.dateKey !== selectedDate) continue;
    const scripture = asSafeString(qt?.scripture);
    if (scripture) return scripture;
  }

  return '';
};

$('#qtAiRequestBtn')?.addEventListener('click', async () => {
  const passage = getBibleAssistantPassage();
  if (!passage) {
    renderBibleAssistantResult({ error: "QT 일기장의 '오늘의 본문'을 먼저 입력하거나 저장해주세요." });
    return;
  }

  setBibleAssistantLoading(true);
  renderBibleAssistantResult({ loading: true });

  try {
    const result = await requestBibleAssistant(passage);
    renderBibleAssistantResult(result);
  } catch (error) {
    renderBibleAssistantResult({ error: error?.message || 'AI 응답 생성에 실패했습니다.' });
  } finally {
    setBibleAssistantLoading(false);
  }
});

$('#qtForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  state.qts.push({
    id: crypto.randomUUID(),
    scripture: data.get('scripture'),
    title: data.get('title'),
    meditation: data.get('meditation'),
    application: data.get('application'),
    prayer: data.get('prayer'),
    dateKey: selectedDate,
  });
  event.currentTarget.reset();
  await rerender();
});

$('#prayerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const categories = normalizeCategoryList(state?.ui?.prayerCategories);
  const selectedCategory = String(data.get('category') || '').trim();
  const category = categories.includes(selectedCategory) ? selectedCategory : categories[0];
  state.prayers.unshift({
    id: crypto.randomUUID(),
    content: data.get('content'),
    category,
    answered: false,
    dateKey: selectedDate,
  });
  event.currentTarget.reset();
  await rerender();
});

$('#gratitudeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  state.gratitudes.unshift({
    id: crypto.randomUUID(),
    text: data.get('text'),
    dateKey: selectedDate,
  });
  event.currentTarget.reset();
  await rerender();
});

document.body.addEventListener('change', async (event) => {
  const routineName = event.target.dataset.routine;
  const prayerCheck = event.target.dataset.prayerCheck;

  if (routineName) {
    ensureRoutineForSelectedDate();
    state.routineByDate[selectedDate][routineName] = event.target.checked;
    await rerender();
    return;
  }

  if (event.target.id === 'toggleRecordCalendar') {
    state.ui.showRecordCalendar = event.target.checked;
    await rerender();
    return;
  }

  if (event.target.id === 'toggleQtHistory') {
    state.ui.showQtHistory = event.target.checked;
    await rerender();
    return;
  }

  if (event.target.id === 'aiProviderSelect') {
    state.ui.aiProvider = normalizeAiProvider(event.target.value);
    await persistState();
    renderAiSettings();
    return;
  }

  if (event.target.id === 'aiFallbackModeSelect') {
    state.ui.aiFallbackMode = normalizeAiFallbackMode(event.target.value);
    await persistState();
    return;
  }

  if (event.target.id === 'bibleVersionSelect') {
    state.ui.bibleVersion = normalizeBibleVersion(event.target.value);
    await persistState();
    return;
  }

  if (event.target.id === 'openaiApiKeyInput') {
    state.ui.openaiApiKey = asSafeString(event.target.value);
    await persistState();
    return;
  }

  if (event.target.id === 'claudeApiKeyInput') {
    state.ui.claudeApiKey = asSafeString(event.target.value);
    await persistState();
    return;
  }

  if (event.target.id === 'geminiApiKeyInput') {
    state.ui.geminiApiKey = asSafeString(event.target.value);
    await persistState();
    return;
  }

  if (event.target.id === 'grokApiKeyInput') {
    state.ui.grokApiKey = asSafeString(event.target.value);
    await persistState();
    return;
  }

  if (event.target.id === 'perplexityApiKeyInput') {
    state.ui.perplexityApiKey = asSafeString(event.target.value);
    await persistState();
    return;
  }

  if (prayerCheck) {
    const prayer = findById(state.prayers, prayerCheck);
    if (prayer) prayer.answered = event.target.checked;
    await rerender();
  }
});

document.body.addEventListener('click', async (event) => {
  const datePickerToggleBtn = $('#datePickerToggle');
  const datePickerPopover = $('#datePickerPopover');
  const settingsToggleBtn = $('#settingsToggleBtn');
  const settingsPopover = $('#settingsPopover');

  if (datePopoverOpen && datePickerToggleBtn && datePickerPopover) {
    const clickedToggle = datePickerToggleBtn.contains(event.target);
    const clickedInsidePopover = datePickerPopover.contains(event.target);
    if (!clickedToggle && !clickedInsidePopover) {
      setDatePopoverOpen(false);
    }
  }

  if (settingsPopoverOpen && settingsToggleBtn && settingsPopover) {
    const clickedToggle = settingsToggleBtn.contains(event.target);
    const clickedInsidePopover = settingsPopover.contains(event.target);
    if (!clickedToggle && !clickedInsidePopover) {
      setSettingsPopoverOpen(false);
    }
  }

  if (event.target.closest('#settingsToggleBtn')) {
    setDatePopoverOpen(false);
    setSettingsPopoverOpen(!settingsPopoverOpen);
    return;
  }

  if (event.target.id === 'settingsCloseBtn') {
    setSettingsPopoverOpen(false);
    return;
  }

  if (event.target.id === 'addPrayerCategoryBtn') {
    const inputEl = $('#prayerCategoryInput');
    if (!inputEl) return;

    const newName = inputEl.value.trim();
    if (!newName) return;

    const categories = normalizeCategoryList(state?.ui?.prayerCategories);
    if (categories.includes(newName)) {
      alert('이미 같은 카테고리가 있습니다.');
      return;
    }

    state.ui.prayerCategories = [...categories, newName];
    inputEl.value = '';
    await rerender();
    return;
  }

  const categoryDeleteBtn = event.target.closest('[data-category-delete]');
  if (categoryDeleteBtn) {
    const deleteIndex = Number(categoryDeleteBtn.dataset.categoryDelete);
    if (Number.isNaN(deleteIndex)) return;

    const categories = normalizeCategoryList(state?.ui?.prayerCategories);
    if (categories.length <= 1) {
      alert('카테고리는 최소 1개 이상 필요합니다.');
      return;
    }

    state.ui.prayerCategories = categories.filter((_, index) => index !== deleteIndex);
    await rerender();
    return;
  }

  if (event.target.closest('#datePickerToggle')) {
    setSettingsPopoverOpen(false);
    if (!datePopoverOpen) {
      setCalendarCursorFromDateKey(selectedDate);
      renderCalendar();
    }
    setDatePopoverOpen(!datePopoverOpen);
    return;
  }

  if (event.target.id === 'datePopoverCloseBtn') {
    setDatePopoverOpen(false);
    return;
  }

  if (event.target.id === 'datePopoverTodayBtn') {
    selectedDate = toDateKey();
    setCalendarCursorFromDateKey(selectedDate);
    setDatePopoverOpen(false);
    await rerender();
    return;
  }

  const calendarDateBtn = event.target.closest('[data-date-select]');
  if (calendarDateBtn) {
    const dateKey = calendarDateBtn.dataset.dateSelect;
    if (dateKey) {
      selectedDate = dateKey;
      setCalendarCursorFromDateKey(dateKey);
      if (datePickerPopover?.contains(calendarDateBtn)) {
        setDatePopoverOpen(false);
      }
      await rerender();
    }
    return;
  }

  if (event.target.id === 'calendarPrevMonthBtn' || event.target.id === 'datePopoverPrevMonthBtn') {
    calendarCursor.setMonth(calendarCursor.getMonth() - 1, 1);
    renderCalendar();
    return;
  }

  if (event.target.id === 'calendarNextMonthBtn' || event.target.id === 'datePopoverNextMonthBtn') {
    calendarCursor.setMonth(calendarCursor.getMonth() + 1, 1);
    renderCalendar();
    return;
  }

  const id = event.target.dataset;

  if (id.qtDelete) {
    state.qts = state.qts.filter((q) => q.id !== id.qtDelete);
    await rerender();
  }

  if (id.qtEdit) {
    const target = findById(state.qts, id.qtEdit);
    if (!target) return;
    const title = prompt('QT 제목', target.title);
    const meditation = prompt('묵상', target.meditation);
    if (title && meditation) {
      target.title = title;
      target.meditation = meditation;
      await rerender();
    }
  }

  if (id.prayerDelete) {
    state.prayers = state.prayers.filter((p) => p.id !== id.prayerDelete);
    await rerender();
  }

  if (id.prayerEdit) {
    const target = findById(state.prayers, id.prayerEdit);
    if (!target) return;
    const content = prompt('기도제목 수정', target.content);
    if (content) {
      target.content = content;
      await rerender();
    }
  }

  if (id.gratitudeDelete) {
    state.gratitudes = state.gratitudes.filter((g) => g.id !== id.gratitudeDelete);
    await rerender();
  }

  if (id.gratitudeEdit) {
    const target = findById(state.gratitudes, id.gratitudeEdit);
    if (!target) return;
    const text = prompt('감사 수정', target.text);
    if (text) {
      target.text = text;
      await rerender();
    }
  }

  if (event.target.id === 'prevDateBtn') {
    await shiftDate(-1);
  }

  if (event.target.id === 'nextDateBtn') {
    await shiftDate(1);
  }

  if (event.target.id === 'exportBtn') {
    const backupMode = $('#backupModeSelect')?.value || 'json';

    if (backupMode === 'secure') {
      if (!supportsSecureBackup()) {
        alert('현재 브라우저는 보호 백업(암호화)을 지원하지 않습니다.');
        return;
      }

      const password = prompt('보호 백업 비밀번호를 입력하세요. (8자 이상 권장)');
      if (!password) return;
      if (password.length < 8) {
        alert('비밀번호는 8자 이상을 권장합니다.');
        return;
      }

      const confirmPassword = prompt('비밀번호를 한 번 더 입력하세요.');
      if (confirmPassword !== password) {
        alert('비밀번호가 일치하지 않습니다.');
        return;
      }

      try {
        const secureBackupText = await createSecureBackupText(state, password);
        downloadFile(secureBackupText, `holy-flow-backup-${toDateKey()}.hfbak`);
        if (!supportsCompression()) {
          alert('이 브라우저는 압축을 지원하지 않아 암호화만 적용된 백업으로 저장되었습니다.');
        }
      } catch {
        alert('보호 백업 파일 생성에 실패했습니다.');
      }
      return;
    }

    downloadFile(JSON.stringify(state, null, 2), `holy-flow-backup-${toDateKey()}.json`);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (datePopoverOpen) {
    setDatePopoverOpen(false);
  }
  if (settingsPopoverOpen) {
    setSettingsPopoverOpen(false);
  }
});

$('#datePicker').addEventListener('change', async (event) => {
  selectedDate = event.target.value || toDateKey();
  setCalendarCursorFromDateKey(selectedDate);
  await rerender();
});

$('#prayerCategoryInput')?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  $('#addPrayerCategoryBtn')?.click();
});

$('#importInput').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);

    if (isSecureBackupEnvelope(parsed)) {
      if (!supportsSecureBackup()) {
        alert('현재 브라우저는 보호 백업 복원을 지원하지 않습니다.');
        return;
      }

      const password = prompt('보호 백업 복원 비밀번호를 입력하세요.');
      if (!password) return;
      state = await restoreSecureBackupState(parsed, password);
    } else {
      state = sanitizeImportedState(parsed);
    }

    await rerender();
    alert('백업 복원이 완료되었습니다.');
  } catch (error) {
    alert(error?.message || '올바른 백업 파일이 아닙니다.');
  } finally {
    event.target.value = '';
  }
});

(async () => {
  registerInstallPrompt();
  registerDesktopShutdown();
  await registerServiceWorker();
  await loadState();
  setCalendarCursorFromDateKey(selectedDate);
  ensureRoutineForSelectedDate();
  await rerender();
})();
