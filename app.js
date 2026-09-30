// ===== CONSTANTES =====
const CONTAINER_TARE = { blanco: 29.5, dorado: 30.5, otro: 0 }; // "otro" se define manualmente

const STORES = [
  'CALLE 1','LINCE','TRUJILLO','MIRAFLORES','GAMARRA',
  'GAMARRA 2','JESÚS MARÍA','ATE','ANGAMOS','MAGDALENA',
  'SANTA ANITA','LA MOLINA','MEGAPLAZA','SAN MIGUEL'
];

// Código de acceso por tienda
const STORE_CODES = {
  'CALLE 1':    '0101',
  'LINCE':      '0102',
  'TRUJILLO':   '0103',
  'MIRAFLORES': '0104',
  'GAMARRA':    '0105',
  'GAMARRA 2':  '0106',
  'JESÚS MARÍA':'0107',
  'ATE':        '0108',
  'ANGAMOS':    '0109',
  'MAGDALENA':  '0110',
  'SANTA ANITA':'0111',
  'LA MOLINA':  '0112',
  'MEGAPLAZA':  '0113',
  'SAN MIGUEL': '0114',
};

// Bin separado por tienda — cada tienda tiene su propio bin en JSONBin
// BINS_INDEX guarda el mapa tienda→binId, pero NO comparte datos entre tiendas
const BIN_KEY    = '$2a$10$CepQntPMjjpIwP8UFoBcOujDD9fCzTWAaG0Cu2RHonNpRIcSssQVq';
const BIN_URL    = 'https://api.jsonbin.io/v3/b';
const BINS_INDEX = '6a21dd0bf5f4af5e29ba2223';

// ===== ESTADO =====
let currentStore  = null;  // nombre de la tienda activa
let storeBinId    = null;  // bin de la tienda activa
let binsMap       = {};    // { 'ATE': 'binId123', ... }
let inventory     = [];
let history       = [];
let shelves       = [];    // [{ id, name }] — pisos configurables
let modalCallback = null;
let saveTimer     = null;

// ===== JSONBIN =====
async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': BIN_KEY, ...(opts.headers || {}) }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function readBin(id) {
  const j = await apiFetch(`${BIN_URL}/${id}/latest`);
  return j.record;
}

async function writeBin(id, data) {
  await apiFetch(`${BIN_URL}/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

async function createBin(name, data) {
  const j = await apiFetch(BIN_URL, {
    method: 'POST',
    headers: { 'X-Bin-Name': name, 'X-Bin-Private': 'false' },
    body: JSON.stringify(data)
  });
  return j.metadata?.id;
}

// ===== SYNC STATUS =====
function setSyncStatus(s) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  const t = { saving:'🔄 Guardando...', ok:'✅ Sincronizado', error:'⚠️ Sin conexión', loading:'🔄 Cargando...' };
  el.textContent = t[s] || '';
  el.className = `sync-status sync-${s}`;
}

// ===== GUARDAR — escribe SOLO al bin de la tienda activa =====
function save() {
  if (!currentStore || !storeBinId) return; // nunca guardar sin tienda activa
  localStorage.setItem(`inv_${currentStore}`, JSON.stringify({ inventory, history, shelves }));
  setSyncStatus('saving');
  clearTimeout(saveTimer);
  const storeSnapshot = currentStore; // capturar para evitar race conditions
  const binSnapshot   = storeBinId;
  saveTimer = setTimeout(async () => {
    if (currentStore !== storeSnapshot) return; // tienda cambió, cancelar
    try {
      await writeBin(binSnapshot, { inventory, history, shelves });
      setSyncStatus('ok');
    } catch { setSyncStatus('error'); }
  }, 800);
}

// ===== CARGAR TIENDA =====
async function loadStore(storeName) {
  currentStore = storeName;
  setSyncStatus('loading');

  // Cargar mapa de bins
  try {
    const idx = await readBin(BINS_INDEX);
    binsMap = idx?.binsMap || {};
  } catch { binsMap = {}; }

  storeBinId = binsMap[storeName];

  try {
    if (storeBinId) {
      const cloud = await readBin(storeBinId);
      inventory = cloud?.inventory || [];
      history   = cloud?.history   || [];
      shelves   = cloud?.shelves   || defaultShelves();
      // Si ATE tiene bin pero inventario vacío, cargar datos semilla
      if (storeName === 'ATE' && inventory.length === 0) {
        inventory = getATESeedData();
        await writeBin(storeBinId, { inventory, history, shelves });
      }
    } else {
      // ATE: migrar datos existentes del bin original
      if (storeName === 'ATE') {
        const legacy = await readBin('6a21dd0bf5f4af5e29ba2223');
        inventory  = legacy?.inventory || [];
        history    = legacy?.history   || [];
        shelves    = legacy?.shelves   || defaultShelves();
        // Migrar shelf ids viejos al nuevo formato
        const shelfMap = { superior: 'piso-1', medio: 'piso-2', inferior: 'piso-3' };
        if (!shelves.find(s => s.id === 'piso-1')) shelves = defaultShelves();
        inventory.forEach(b => { if (shelfMap[b.shelf]) b.shelf = shelfMap[b.shelf]; });
        // Si inventario vacío, cargar datos semilla
        if (inventory.length === 0) inventory = getATESeedData();
        // Guardar en bin propio de ATE
        storeBinId = await createBin('pisetas-ATE', { inventory, history, shelves });
        binsMap['ATE'] = storeBinId;
        await writeBin('6a21dd0bf5f4af5e29ba2223', { binsMap });
      } else {
        shelves    = defaultShelves();
        storeBinId = await createBin(`pisetas-${storeName}`, { inventory: [], history: [], shelves });
        binsMap[storeName] = storeBinId;
        await writeBin('6a21dd0bf5f4af5e29ba2223', { binsMap });
      }
    }
  } catch {
    const local = JSON.parse(localStorage.getItem(`inv_${storeName}`) || 'null');
    inventory = local?.inventory || [];
    history   = local?.history   || [];
    shelves   = local?.shelves   || defaultShelves();
    setSyncStatus('error');
  }

  migrateLegacy();
  setSyncStatus('ok');
}

function defaultShelves() {
  return [
    { id: 'piso-1', name: 'Piso Superior' },
    { id: 'piso-2', name: 'Piso Medio' },
    { id: 'piso-3', name: 'Piso Inferior' },
  ];
}

function migrateLegacy() {
  inventory.forEach(b => {
    if (!b.shelf)     b.shelf     = shelves[0]?.id || 'piso-1';
    if (!b.name)      b.name      = '';
    if (!b.brand)     b.brand     = '';
    if (!b.color)     b.color     = '#c8005a';
    if (!b.container) b.container = 'blanco';
    if (b.weightGross === undefined) {
      b.weightGross = b.weight || 0;
      b.weightNet   = calcNet(b.weightGross, b.container);
      delete b.weight;
    }
  });
}

// ===== SELECTOR DE TIENDA =====
function renderStoreScreen() {
  const grid = document.getElementById('store-grid');
  grid.innerHTML = STORES.map(s => `
    <button class="store-btn" onclick="promptStoreCode('${s}')">
      <span class="store-icon">🏪</span>
      <span>${s}</span>
    </button>
  `).join('');
}

function promptStoreCode(name) {
  document.getElementById('access-store-name').textContent = `🏪 ${name}`;
  document.getElementById('access-display').textContent = '_ _ _ _';
  document.getElementById('access-error').style.display = 'none';
  document.getElementById('store-select-view').style.display = 'none';
  document.getElementById('store-pin-view').style.display = 'block';
  document.getElementById('store-pin-view').dataset.store = name;
  _numInput = '';
}

function backToStores() {
  document.getElementById('store-select-view').style.display = 'block';
  document.getElementById('store-pin-view').style.display = 'none';
  _numInput = '';
}

let _numInput = '';

function numpadPress(d) {
  if (_numInput.length >= 4) return;
  _numInput += d;
  const dots = _numInput.split('').map(() => '●').join(' ');
  const rest  = Array(4 - _numInput.length).fill('_').join(' ');
  document.getElementById('access-display').textContent = (dots + (rest ? ' ' + rest : '')).trim();
  document.getElementById('access-error').style.display = 'none';
  if (_numInput.length === 4) setTimeout(verifyAccessCode, 120);
}

function numpadDel() {
  if (!_numInput.length) return;
  _numInput = _numInput.slice(0, -1);
  const dots = _numInput.split('').map(() => '●').join(' ');
  const rest  = Array(4 - _numInput.length).fill('_').join(' ');
  document.getElementById('access-display').textContent = (dots + (rest ? ' ' + rest : '')).trim() || '_ _ _ _';
}

function numpadClear() {
  _numInput = '';
  document.getElementById('access-display').textContent = '_ _ _ _';
  document.getElementById('access-error').style.display = 'none';
}

function verifyAccessCode() {
  const name = document.getElementById('store-pin-view').dataset.store;
  if (_numInput !== STORE_CODES[name]) {
    document.getElementById('access-error').style.display = 'block';
    _numInput = '';
    document.getElementById('access-display').textContent = '_ _ _ _';
    return;
  }
  backToStores();
  selectStore(name);
}

function closeAccessModal() {
  backToStores();
}

async function selectStore(name) {
  document.getElementById('store-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('store-name-display').textContent = `🏪 ${name}`;
  localStorage.setItem('last_store', name);
  // Limpiar estado anterior para evitar mezcla entre tiendas
  inventory = []; history = []; shelves = [];
  await loadStore(name);
  renderShelvesPanel();
  renderShelfSelects();
  renderAll();
  updateStats();
}

function changeStore() {
  // Limpiar estado al cambiar de tienda
  inventory = []; history = []; shelves = [];
  currentStore = null; storeBinId = null;
  document.getElementById('store-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

// ===== PISOS =====
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function renderShelvesPanel() {
  const list = document.getElementById('shelves-list');
  list.innerHTML = shelves.map(s => `
    <div class="shelf-tag">
      <span>${s.name}</span>
      <span class="shelf-count">${inventory.filter(b => b.shelf === s.id).length} uds</span>
      <button class="shelf-edit-btn" onclick="editShelf('${s.id}')">✏️</button>
      <button class="shelf-del-btn" onclick="deleteShelf('${s.id}')">🗑️</button>
    </div>
  `).join('');
}

function renderShelfSelects() {
  ['input-shelf', 'edit-shelf'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = shelves.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  });
}

function addShelf() {
  document.getElementById('shelf-modal-id').value   = '';
  document.getElementById('shelf-modal-name').value = '';
  document.getElementById('shelf-modal-title').textContent = '➕ Nuevo Piso';
  document.getElementById('shelf-modal').style.display = 'flex';
}

function editShelf(id) {
  const s = shelves.find(x => x.id === id);
  if (!s) return;
  document.getElementById('shelf-modal-id').value   = id;
  document.getElementById('shelf-modal-name').value = s.name;
  document.getElementById('shelf-modal-title').textContent = '✏️ Editar Piso';
  document.getElementById('shelf-modal').style.display = 'flex';
}

function saveShelf() {
  const id   = document.getElementById('shelf-modal-id').value;
  const name = document.getElementById('shelf-modal-name').value.trim();
  if (!name) { alert('Ingresa un nombre para el piso.'); return; }
  if (id) {
    const s = shelves.find(x => x.id === id);
    if (s) s.name = name;
  } else {
    shelves.push({ id: uid(), name });
  }
  closeShelfModal();
  save();
  renderShelvesPanel();
  renderShelfSelects();
  renderAll();
}

function deleteShelf(id) {
  const s = shelves.find(x => x.id === id);
  if (!s) return;
  const count = inventory.filter(b => b.shelf === id).length;
  const msg = count > 0
    ? `¿Eliminar el piso "${s.name}"? Tiene ${count} piseta(s) que se moverán al primer piso.`
    : `¿Eliminar el piso "${s.name}"?`;
  openModal(msg, () => {
    inventory.forEach(b => { if (b.shelf === id) b.shelf = shelves[0]?.id; });
    shelves = shelves.filter(x => x.id !== id);
    save();
    renderShelvesPanel();
    renderShelfSelects();
    renderAll();
  });
}

function closeShelfModal() { document.getElementById('shelf-modal').style.display = 'none'; }

// ===== PESO NETO =====
function calcNet(gross, container, customTare) {
  const tare = container === 'otro'
    ? (parseFloat(customTare) || 0)
    : (CONTAINER_TARE[container] || 0);
  return Math.max(0, gross - tare);
}

function getSelectedContainer(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || 'blanco';
}

function getCustomTare(prefix) {
  const el = document.getElementById(`${prefix}-tare-custom`);
  return el ? el.value : '0';
}

function updateNetPreview() {
  const gross = parseFloat(document.getElementById('input-weight').value);
  const cont  = getSelectedContainer('input-container');
  const el    = document.getElementById('net-preview');
  // Mostrar/ocultar campo tara manual
  const customDiv = document.getElementById('input-tare-custom-group');
  if (customDiv) customDiv.style.display = cont === 'otro' ? 'flex' : 'none';
  if (isNaN(gross) || gross <= 0) { el.textContent = '— g'; el.className = 'net-preview'; return; }
  el.textContent = `${calcNet(gross, cont, getCustomTare('input')).toFixed(3)} g`;
  el.className   = 'net-preview net-ok';
}

function updateEditNetPreview() {
  const gross = parseFloat(document.getElementById('edit-weight').value);
  const cont  = getSelectedContainer('edit-container');
  const el    = document.getElementById('edit-net-preview');
  const customDiv = document.getElementById('edit-tare-custom-group');
  if (customDiv) customDiv.style.display = cont === 'otro' ? 'flex' : 'none';
  if (isNaN(gross) || gross <= 0) { el.textContent = '— g'; el.className = 'net-preview'; return; }
  el.textContent = `${calcNet(gross, cont, getCustomTare('edit')).toFixed(3)} g`;
  el.className   = 'net-preview net-ok';
}

function syncContainerHighlight(radioName, idB, idD) {
  const val = getSelectedContainer(radioName);
  document.getElementById(idB)?.classList.toggle('selected', val === 'blanco');
  document.getElementById(idD)?.classList.toggle('selected', val === 'dorado');
}

document.querySelectorAll('input[name="input-container"]').forEach(r =>
  r.addEventListener('change', () => { updateNetPreview(); syncContainerHighlight('input-container','opt-blanco','opt-dorado'); })
);
document.querySelectorAll('input[name="edit-container"]').forEach(r =>
  r.addEventListener('change', () => { updateEditNetPreview(); syncContainerHighlight('edit-container','edit-opt-blanco','edit-opt-dorado'); })
);

// ===== ORDENAR CÓDIGOS =====
function codeSort(a, b) {
  const parse = s => { const m = s.match(/^([A-Za-z]*)(\d*)(.*)$/); return [m[1].toUpperCase(), parseInt(m[2]||'0',10), m[3]]; };
  const [al,an,ar] = parse(a), [bl,bn,br] = parse(b);
  if (al !== bl) return al < bl ? -1 : 1;
  if (an !== bn) return an - bn;
  return ar < br ? -1 : ar > br ? 1 : 0;
}

// ===== COLOR PREVIEW =====
document.getElementById('input-color').addEventListener('input', function() {
  document.getElementById('color-preview').style.background = this.value;
});
document.getElementById('edit-color').addEventListener('input', function() {
  document.getElementById('edit-color-preview').style.background = this.value;
});

// ===== AUTOCOMPLETAR CÓDIGO desde catálogo =====
function onCodeInput() {
  const val = document.getElementById('input-code').value.trim().toUpperCase();
  const box = document.getElementById('code-suggestions');

  // Buscar en catálogo primero
  const catEntry = lookupCatalog(val);
  if (catEntry) {
    document.getElementById('input-name').value  = catEntry.name;
    document.getElementById('input-brand').value = catEntry.brand;
  }

  if (!val) { box.innerHTML = ''; return; }

  // Sugerencias: catálogo + inventario existente
  const fromCatalog = Object.entries(CATALOG)
    .filter(([k]) => k.includes(val))
    .slice(0, 6)
    .map(([k, v]) => ({ code: k, name: v.name, brand: v.brand, fromCatalog: true }));

  const fromInventory = [...new Set(inventory.map(b => b.code))]
    .filter(c => c.includes(val) && !fromCatalog.find(x => x.code === c))
    .slice(0, 4)
    .map(c => { const b = inventory.find(x => x.code === c); return { code: c, name: b?.name||'', brand: b?.brand||'', fromCatalog: false }; });

  const all = [...fromCatalog, ...fromInventory];
  if (all.length === 0) { box.innerHTML = ''; return; }

  box.innerHTML = all.map(s => `
    <div class="suggestion-item" onclick="selectCode('${s.code}')">
      <span class="sug-code">${s.code}</span>
      <span class="sug-name">${s.name}</span>
      ${s.brand ? `<span class="sug-brand">${s.brand}</span>` : ''}
    </div>
  `).join('');
}

function selectCode(code) {
  document.getElementById('input-code').value = code;
  document.getElementById('code-suggestions').innerHTML = '';
  const cat = lookupCatalog(code);
  if (cat) {
    document.getElementById('input-name').value  = cat.name;
    document.getElementById('input-brand').value = cat.brand;
  }
  const existing = inventory.filter(b => b.code === code);
  if (existing.length > 0) {
    const avg = existing.reduce((s,b) => s + b.weightGross, 0) / existing.length;
    document.getElementById('input-weight').value = avg.toFixed(3);
    if (existing[0].color) {
      document.getElementById('input-color').value = existing[0].color;
      document.getElementById('color-preview').style.background = existing[0].color;
    }
    if (existing[0].shelf) document.getElementById('input-shelf').value = existing[0].shelf;
    if (existing[0].container) {
      document.querySelector(`input[name="input-container"][value="${existing[0].container}"]`).checked = true;
      syncContainerHighlight('input-container','opt-blanco','opt-dorado');
    }
    updateNetPreview();
  }
}

document.addEventListener('click', e => {
  if (!e.target.closest('.form-group')) document.getElementById('code-suggestions').innerHTML = '';
});

// ===== AGREGAR PISETAS =====
function addBottles() {
  const code      = document.getElementById('input-code').value.trim().toUpperCase();
  const name      = document.getElementById('input-name').value.trim();
  const brand     = document.getElementById('input-brand').value.trim();
  const color     = document.getElementById('input-color').value;
  const shelf     = document.getElementById('input-shelf').value;
  const container = getSelectedContainer('input-container');
  const gross     = parseFloat(document.getElementById('input-weight').value);
  const qty       = parseInt(document.getElementById('input-qty').value, 10);

  if (!code)                      { alert('Ingresa un código.'); return; }
  if (isNaN(gross) || gross <= 0) { alert('Ingresa un peso bruto válido.'); return; }
  if (isNaN(qty)   || qty < 1)    { alert('Cantidad mínima: 1.'); return; }

  const customTare = getCustomTare('input');
  const net = calcNet(gross, container, customTare);
  for (let i = 0; i < qty; i++) {
    inventory.push({ id: uid(), code, name, brand, color, shelf, container, weightGross: gross, weightNet: net, addedAt: new Date().toISOString() });
  }
  history.unshift({ type:'entrada', code, name, brand, color, shelf, container, weightGross: gross, weightNet: net, qty, timestamp: new Date().toISOString() });

  save(); renderAll(); updateStats();
  document.getElementById('input-code').value  = '';
  document.getElementById('input-name').value  = '';
  document.getElementById('input-brand').value = '';
  document.getElementById('input-weight').value = '';
  document.getElementById('input-qty').value   = '1';
  document.getElementById('net-preview').textContent = '— g';
  document.getElementById('net-preview').className   = 'net-preview';
  document.getElementById('code-suggestions').innerHTML = '';
}

// ===== USAR PISETA =====
function useBottle(id) {
  const b = inventory.find(x => x.id === id);
  if (!b) return;
  openModal(
    `¿Usar <strong>${b.code}</strong>${b.name ? ` — ${b.name}` : ''}?<br>` +
    `Neto: <strong>${b.weightNet.toFixed(3)} g</strong><br>Desaparecerá del inventario.`,
    () => {
      inventory = inventory.filter(x => x.id !== id);
      history.unshift({ type:'salida', code:b.code, name:b.name, brand:b.brand, color:b.color, shelf:b.shelf, container:b.container, weightGross:b.weightGross, weightNet:b.weightNet, qty:1, timestamp:new Date().toISOString() });
      save(); renderAll(); updateStats();
    }
  );
}

// ===== EDITAR PISETA =====
function openEditModal(id) {
  const b = inventory.find(x => x.id === id);
  if (!b) return;
  document.getElementById('edit-id').value    = id;
  document.getElementById('edit-name').value  = b.name  || '';
  document.getElementById('edit-brand').value = b.brand || '';
  document.getElementById('edit-color').value = b.color || '#c8005a';
  document.getElementById('edit-color-preview').style.background = b.color || '#c8005a';
  document.getElementById('edit-weight').value = b.weightGross;
  document.getElementById('edit-shelf').value  = b.shelf;
  const cont = b.container || 'blanco';
  document.querySelector(`input[name="edit-container"][value="${cont}"]`).checked = true;
  syncContainerHighlight('edit-container','edit-opt-blanco','edit-opt-dorado');
  updateEditNetPreview();
  document.getElementById('edit-modal').style.display = 'flex';
}

function closeEditModal() { document.getElementById('edit-modal').style.display = 'none'; }

function saveEdit() {
  const id    = document.getElementById('edit-id').value;
  const b     = inventory.find(x => x.id === id);
  if (!b) return;
  const gross = parseFloat(document.getElementById('edit-weight').value);
  if (isNaN(gross) || gross <= 0) { alert('Peso inválido.'); return; }
  b.name        = document.getElementById('edit-name').value.trim();
  b.brand       = document.getElementById('edit-brand').value.trim();
  b.color       = document.getElementById('edit-color').value;
  b.shelf       = document.getElementById('edit-shelf').value;
  b.container   = getSelectedContainer('edit-container');
  b.weightGross = gross;
  b.weightNet   = calcNet(gross, b.container, getCustomTare('edit'));
  save(); closeEditModal(); renderAll();
}

// ===== RENDER PRINCIPAL =====
function renderAll() {
  const wrapper = document.getElementById('cabinets-wrapper');
  const search  = document.getElementById('search-input')?.value.trim().toUpperCase() || '';
  const sort    = document.getElementById('sort-select')?.value || 'code-asc';
  const grouped = document.getElementById('group-toggle')?.checked || false;
  wrapper.innerHTML = '';

  shelves.forEach(shelf => {
    let items = inventory.filter(b =>
      b.shelf === shelf.id &&
      (b.code.includes(search) || (b.name||'').toUpperCase().includes(search) || (b.brand||'').toUpperCase().includes(search))
    );
    items = [...items].sort((a,b) => {
      if (sort==='code-asc')    return codeSort(a.code, b.code);
      if (sort==='code-desc')   return codeSort(b.code, a.code);
      if (sort==='weight-asc')  return a.weightNet - b.weightNet;
      if (sort==='weight-desc') return b.weightNet - a.weightNet;
      return 0;
    });

    const section = document.createElement('section');
    section.className = 'cabinet';
    section.innerHTML = `
      <div class="cabinet-header shelf-dynamic">
        <span class="cabinet-icon">📦</span>
        <span class="cabinet-title">${shelf.name}</span>
        <span class="cabinet-count">${items.length} ud${items.length!==1?'s':''}</span>
      </div>
      <div class="cabinet-body">
        <div class="inventory-grid" id="grid-${shelf.id}"></div>
        <div class="empty-msg" id="empty-${shelf.id}" style="display:${items.length===0?'block':'none'}">Sin pisetas en este piso.</div>
      </div>
    `;
    wrapper.appendChild(section);

    if (items.length > 0) {
      const grid = document.getElementById(`grid-${shelf.id}`);
      if (grouped) renderGrouped(grid, items);
      else renderIndividual(grid, items);
    }
  });

  renderHistory();
}

function renderIndividual(grid, items) {
  const codeCounters = {};
  items.forEach(b => { codeCounters[b.code] = (codeCounters[b.code]||0)+1; });
  const codeIndex = {};
  items.forEach(b => {
    if (!codeIndex[b.code]) codeIndex[b.code] = 1;
    const serial = codeCounters[b.code] > 1 ? `<span class="serial-badge">#${codeIndex[b.code]}</span>` : '';
    codeIndex[b.code]++;
    const card = document.createElement('div');
    card.className = 'bottle-card';
    card.style.borderTopColor = b.color || '#c8005a';
    const contIcon = b.container==='dorado' ? '🟨' : '⬜';
    const dot = `<span class="color-dot" style="background:${b.color||'#c8005a'}"></span>`;
    const fechaStr = b.addedAt
      ? `<div class="bottle-date">📅 ${new Date(b.addedAt).toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric'})}</div>`
      : '';
    card.innerHTML = `
      <div class="bottle-code">${b.code}${serial}</div>
      <div class="bottle-name">${dot}${b.name||'<span style="opacity:.4">Sin nombre</span>'}</div>
      ${b.brand ? `<div class="bottle-brand">${b.brand}</div>` : ''}
      <div class="bottle-container">${contIcon} <span class="tare-tag">−${CONTAINER_TARE[b.container]||0} g</span></div>
      <div class="bottle-weight-block">
        <div class="weight-row gross">Bruto: <span>${b.weightGross.toFixed(3)} g</span></div>
        <div class="weight-row net">Neto: <span>${b.weightNet.toFixed(3)} g</span></div>
      </div>
      ${fechaStr}
      <div class="bottle-actions">
        <button class="btn btn-edit" onclick="openEditModal('${b.id}')">✏️</button>
        <button class="btn btn-use"  onclick="useBottle('${b.id}')">✅ Usar</button>
      </div>
    `;
    grid.appendChild(card);
  });
}

function renderGrouped(grid, items) {
  const groups = {};
  items.forEach(b => { if(!groups[b.code]) groups[b.code]=[]; groups[b.code].push(b); });
  Object.keys(groups).sort(codeSort).forEach(code => {
    const bottles  = groups[code];
    const totalNet = bottles.reduce((s,b)=>s+b.weightNet,0);
    const repColor = bottles[0].color || '#c8005a';
    const repName  = bottles[0].name  || '';
    const repBrand = bottles[0].brand || '';
    const card = document.createElement('div');
    card.className = 'group-card';
    card.style.borderTopColor = repColor;
    const mini = bottles.map((b,i) => {
      const ci = b.container==='dorado'?'🟨':'⬜';
      return `<div class="mini-bottle">
        <span class="color-dot" style="background:${b.color||'#c8005a'}"></span>
        ${bottles.length>1?`<span class="mini-serial">#${i+1}</span>`:''}
        ${ci}<span class="mini-weight">${b.weightNet.toFixed(3)} g</span>
        <button class="mini-use-btn" onclick="useBottle('${b.id}')">Usar</button>
      </div>`;
    }).join('');
    card.innerHTML = `
      <div class="group-header">
        <span class="group-code"><span class="color-dot" style="background:${repColor}"></span>${code}</span>
        <span class="group-badge">${bottles.length} uds</span>
      </div>
      ${repName  ? `<div class="bottle-name" style="font-size:.85rem;margin-bottom:2px">${repName}</div>` : ''}
      ${repBrand ? `<div class="bottle-brand">${repBrand}</div>` : ''}
      <div class="group-info">Neto total: <strong>${totalNet.toFixed(3)} g</strong></div>
      <div class="group-bottles">${mini}</div>
    `;
    grid.appendChild(card);
  });
}

// ===== HISTORIAL =====
function renderHistory() {
  const list = document.getElementById('history-list');
  const q = (document.getElementById('history-search')?.value || '').trim().toUpperCase();
  list.innerHTML = '';
  const filtered = q
    ? history.filter(h =>
        h.code.toUpperCase().includes(q) ||
        (h.name  || '').toUpperCase().includes(q) ||
        (h.brand || '').toUpperCase().includes(q)
      )
    : history;
  if (filtered.length === 0) {
    list.innerHTML = q
      ? `<div class="empty-msg">Sin resultados para "${q}".</div>`
      : '<div class="empty-msg">Sin movimientos aún.</div>';
    return;
  }
  filtered.slice(0, 80).forEach(h => {
    const item = document.createElement('div');
    item.className = `history-item ${h.type}`;
    const icon  = h.type==='entrada' ? '📥' : '📤';
    const cont  = h.container==='dorado' ? '🟨' : '⬜';
    const netStr = h.weightNet !== undefined ? `${h.weightNet.toFixed(3)} g neto` : '';
    const detail = h.type==='entrada'
      ? `Entrada · ${h.qty} ud${h.qty>1?'s':''} · ${netStr} · ${cont}`
      : `Salida · ${netStr} · ${cont}`;
    const dot = h.color ? `<span class="color-dot" style="background:${h.color}"></span>` : '';
    item.innerHTML = `
      <span class="history-icon">${icon}</span>${dot}
      <span class="history-code">${h.code}</span>
      ${h.name?`<span class="history-name">${h.name}</span>`:''}
      <span class="history-detail">${detail}</span>
      <span class="history-time">${formatTime(h.timestamp)}</span>
    `;
    list.appendChild(item);
  });
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-MX',{day:'2-digit',month:'2-digit',year:'2-digit'})
    + ' ' + d.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'});
}

// ===== STATS =====
function updateStats() {
  const total  = inventory.length;
  const codes  = new Set(inventory.map(b=>b.code)).size;
  const totalF = inventory.filter(b => b.code.startsWith('F')).length;
  const totalM = inventory.filter(b => b.code.startsWith('M')).length;
  document.getElementById('total-bottles').textContent = `${total} botella${total!==1?'s':''}`;
  document.getElementById('total-codes').textContent   = `${codes} esencia${codes!==1?'s':''}`;
  document.getElementById('total-fem').textContent     = `👩 ${totalF} mujer`;
  document.getElementById('total-hom').textContent     = `👨 ${totalM} hombre`;
}

// ===== EXCEL =====
function importExcel(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb   = XLSX.read(e.target.result, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      let added  = 0;
      rows.forEach(row => {
        const code      = String(row['Código']||row['Codigo']||row['code']||'').trim().toUpperCase();
        const container = String(row['Envase']||row['container']||'blanco').trim().toLowerCase();
        const customTareExcel = parseFloat(row['Otro']||row['otro']||row['Tara manual']||'') || 0;
        const gross     = parseFloat(row['Peso Bruto (g)']||row['Peso Bruto']||row['Peso']||0);
        if (!code || isNaN(gross) || gross<=0) return;
        const cat   = lookupCatalog(code);
        const name  = cat?.name  || String(row['Nombre']||row['name']||'').trim();
        const brand = cat?.brand || String(row['Marca']||'').trim();
        const cont  = ['blanco','dorado','otro'].includes(container) ? container : 'blanco';
        // Si columna C tiene valor → usar ese como tara (independiente del envase)
        // Si columna C vacía → usar tara estándar del envase (blanco=30.75, dorado=31.65)
        const efectiveCont  = customTareExcel > 0 ? 'otro' : cont;
        const efectiveTare  = customTareExcel > 0 ? customTareExcel : (CONTAINER_TARE[cont] || 0);
        const net = Math.max(0, gross - efectiveTare);
        // Resolver piso: buscar por nombre exacto, parcial, o por número (1=primer piso, 2=segundo, etc.)
        const pisoNombre = String(row['Piso del Anaquel']||row['Piso']||row['shelf']||'').trim();
        let foundShelf = null;
        if (pisoNombre) {
          // Buscar exacto primero
          foundShelf = shelves.find(s => s.name.toLowerCase() === pisoNombre.toLowerCase());
          // Si no, buscar parcial
          if (!foundShelf) foundShelf = shelves.find(s => s.name.toLowerCase().includes(pisoNombre.toLowerCase()) || pisoNombre.toLowerCase().includes(s.name.toLowerCase()));
          // Si es número (1, 2, 3...), usar como índice
          if (!foundShelf && /^\d+$/.test(pisoNombre)) {
            const idx = parseInt(pisoNombre, 10) - 1;
            if (idx >= 0 && idx < shelves.length) foundShelf = shelves[idx];
          }
        }
        const shf = foundShelf?.id || shelves[0]?.id || 'piso-1';
        inventory.push({ id:uid(), code, name, brand, color:'#c8005a', shelf:shf, container:efectiveCont, customTare: customTareExcel, weightGross:gross, weightNet:net, addedAt:new Date().toISOString() });
        added++;
      });
      if (added===0) { alert('No se encontraron filas válidas.'); return; }
      history.unshift({ type:'entrada', code:`IMPORTACIÓN (${added})`, name:'', brand:'', color:'#c8005a', shelf:'', container:'', weightGross:0, weightNet:0, qty:added, timestamp:new Date().toISOString() });
      save(); renderAll(); updateStats();
      alert(`✅ ${added} pisetas importadas correctamente.`);
      event.target.value = '';
    } catch(err) { alert('Error al leer el archivo.'); console.error(err); }
  };
  reader.readAsArrayBuffer(file);
}

function exportExcel() {
  if (inventory.length===0) { alert('No hay pisetas en el inventario.'); return; }
  const shelfName = id => shelves.find(s=>s.id===id)?.name || id;
  const rows = [...inventory].sort((a,b)=>codeSort(a.code,b.code)).map((b,i)=>({
    'N°': i+1, 'Código': b.code, 'Nombre': b.name||'', 'Marca': b.brand||'',
    'Envase': b.container, 'Piso': shelfName(b.shelf),
    'Peso Bruto (g)': b.weightGross, 'Tara (g)': CONTAINER_TARE[b.container]||0,
    'Peso Neto (g)': parseFloat(b.weightNet.toFixed(3)),
    'Fecha': b.addedAt ? new Date(b.addedAt).toLocaleDateString('es-MX') : ''
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{wch:4},{wch:14},{wch:28},{wch:20},{wch:8},{wch:14},{wch:14},{wch:8},{wch:14},{wch:12}];
  XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
  if (history.length>0) {
    const hRows = history.map(h=>({ 'Tipo':h.type==='entrada'?'Entrada':'Salida', 'Código':h.code, 'Nombre':h.name||'', 'Envase':h.container||'', 'Cantidad':h.qty||1, 'Peso Neto (g)':h.weightNet!==undefined?parseFloat(h.weightNet.toFixed(3)):'', 'Fecha':formatTime(h.timestamp) }));
    const wsH = XLSX.utils.json_to_sheet(hRows);
    wsH['!cols'] = [{wch:8},{wch:14},{wch:28},{wch:8},{wch:8},{wch:14},{wch:18}];
    XLSX.utils.book_append_sheet(wb, wsH, 'Historial');
  }
  XLSX.writeFile(wb, `inventario_${currentStore}_${new Date().toISOString().slice(0,10)}.xlsx`);
}

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = {};

  // Formato exacto: A=Código | B=Envase | C=Otro | D=Piso del Anaquel | E=Peso Bruto (g)
  ws['A1'] = { v:'Código',           t:'s' };
  ws['B1'] = { v:'Envase',           t:'s' };
  ws['C1'] = { v:'Otro',             t:'s' };
  ws['D1'] = { v:'Piso del Anaquel', t:'s' };
  ws['E1'] = { v:'Peso Bruto (g)',   t:'s' };

  // Desplegable en columna B (Envase): blanco, dorado, otro
  ws['!dataValidations'] = [
    { sqref:'B2:B100', type:'list', formula1:'"blanco,dorado,otro"',
      showDropDown:false, showErrorMessage:true,
      errorTitle:'Envase inválido', error:'Escribe blanco, dorado u otro' }
  ];

  ws['!cols'] = [{wch:14},{wch:10},{wch:14},{wch:22},{wch:16}];
  ws['!ref']  = 'A1:E100';

  XLSX.utils.book_append_sheet(wb, ws, 'Plantilla');

  // Hoja instrucciones con pisos reales de la tienda
  const pisosList = shelves && shelves.length > 0
    ? shelves.map((s,i) => [`Piso ${i+1}`, s.name, `Escribe exactamente: ${s.name}`])
    : [['Piso 1','Piso Superior','Escribe exactamente: Piso Superior']];

  const instrData = [
    ['Campo',            'Descripción',                             'Valores válidos'],
    ['Código',           'Código de la piseta',                     'Ej: F1178, M1146'],
    ['Envase',           'Tipo de envase (desplegable)',            'blanco / dorado / otro'],
    ['Otro',             'Tara manual — solo si Envase = otro',     'Número en gramos. Ej: 28.50'],
    ['Piso del Anaquel', 'Nombre exacto del piso',                  pisosList.map(p=>p[1]).join(' / ')],
    ['Peso Bruto (g)',   'Peso total con envase incluido',          'Número. Ej: 282.50'],
    ['','',''],
    ['TARAS AUTOMÁTICAS:','',''],
    ['blanco','29.5 g','Se descuenta automáticamente al importar'],
    ['dorado','30.5 g','Se descuenta automáticamente al importar'],
    ['otro',  'manual', 'Escribe el peso en la columna C'],
    ['','',''],
    ['PISOS DE ESTA TIENDA:','',''],
    ...pisosList
  ];

  const wsI = XLSX.utils.aoa_to_sheet(instrData);
  wsI['!cols'] = [{wch:20},{wch:38},{wch:38}];
  XLSX.utils.book_append_sheet(wb, wsI, 'Instrucciones');

  XLSX.writeFile(wb, `plantilla_${currentStore || 'pisetas'}.xlsx`);
}

// ===== MODAL =====
function openModal(msg, onConfirm) {
  document.getElementById('modal-msg').innerHTML = msg;
  document.getElementById('modal').style.display = 'flex';
  modalCallback = onConfirm;
}
function closeModal() { document.getElementById('modal').style.display='none'; modalCallback=null; }
document.getElementById('modal-confirm').addEventListener('click', () => { if(modalCallback) modalCallback(); closeModal(); });
document.getElementById('modal').addEventListener('click', e => { if(e.target===document.getElementById('modal')) closeModal(); });
document.getElementById('edit-modal').addEventListener('click', e => { if(e.target===document.getElementById('edit-modal')) closeEditModal(); });
document.getElementById('shelf-modal').addEventListener('click', e => { if(e.target===document.getElementById('shelf-modal')) closeShelfModal(); });

// Enter en form
document.getElementById('input-code').addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('input-name').focus(); });
document.getElementById('input-name').addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('input-weight').focus(); });
document.getElementById('input-weight').addEventListener('keydown', e=>{ if(e.key==='Enter') addBottles(); });
document.getElementById('shelf-modal-name').addEventListener('keydown', e=>{ if(e.key==='Enter') saveShelf(); });

// ===== DATOS SEMILLA ATE =====
function getATESeedData() {
  const t = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  const b = (code, name, brand, shelf, container, gross) => ({
    id: t(), code, name, brand,
    color: code.startsWith('F') ? '#c8005a' : '#4f8ef7',
    shelf, container,
    weightGross: gross,
    weightNet: calcNet(gross, container),
    addedAt: '2026-06-01T00:00:00.000Z'
  });
  return [
    // ── GABINETA SUPERIOR ──
    b('F111', 'CHANEL N°5',          'CHANEL',            'piso-1','dorado', 281.460),
    b('F1116','LA VIE EST BELLE',     'LANCÔME',           'piso-1','blanco', 278.040),
    b('F1178','212 VIP ROSE',         'CAROLINA HERRERA',  'piso-1','blanco', 278.820),
    b('F1226','OLYMPEA',              'RABANNE',           'piso-1','dorado', 281.540),
    b('F1226','OLYMPEA',              'RABANNE',           'piso-1','dorado', 281.740),
    b('F1249','GOOD GIRL',            'CAROLINA HERRERA',  'piso-1','blanco', 278.880),
    b('F1249','GOOD GIRL',            'CAROLINA HERRERA',  'piso-1','blanco', 281.800),
    b('F1276','LADY MILLION LUCKY',   'RABANNE',           'piso-1','blanco', 281.660),
    b('F1333','GOOD GIRL BLUSH',      'CAROLINA HERRERA',  'piso-1','blanco', 283.220),
    b('F1349','CLOUD PINK',           'ARIANA GRANDE',     'piso-1','blanco', 279.300),
    b('F1359','DELINA DE MARLY',      'PARFUMS DE MARLY',  'piso-1','blanco', 278.710),
    b('F1368','BORN IN ROMA DONNA',   'VALENTINO',         'piso-1','blanco', 281.090),
    b('F1377','LATTAFA YARA',         'LATTAFA',           'piso-1','blanco', 280.120),
    b('F1381','GAULTIER DIVINE',      'JEAN PAUL GAULTIER','piso-1','blanco', 279.220),
    b('F7502','YARA TOUS',            'LATTAFA',           'piso-1','blanco', 280.640),
    b('F7502','YARA TOUS',            'LATTAFA',           'piso-1','blanco', 280.430),
    b('F7502','YARA TOUS',            'LATTAFA',           'piso-1','blanco', 279.430),
    b('F7504','MISS DIOR PARFUM 2024','DIOR',              'piso-1','blanco', 280.000),
    b('F7507','ECLAIRE',              'LATTAFA',           'piso-1','blanco', 279.580),
    b('F754', 'JADORE',               'DIOR',              'piso-1','blanco', 280.000),
    // ── GABINETA MEDIO ──
    b('M1138','LEGACY',               'CRISTIANO RONALDO', 'piso-2','blanco', 279.090),
    b('M1138','LEGACY',               'CRISTIANO RONALDO', 'piso-2','blanco', 279.000),
    b('M1146','ONE MILLION PRIVE',    'RABANNE',           'piso-2','blanco', 278.270),
    b('M1153','STRONGER WITH YOU',    'GIORGIO ARMANI',    'piso-2','blanco', 278.910),
    b('M1153','STRONGER WITH YOU',    'GIORGIO ARMANI',    'piso-2','blanco', 280.150),
    b('M1153','STRONGER WITH YOU',    'GIORGIO ARMANI',    'piso-2','blanco', 279.100),
    b('M1156','212 VIP BLACK',        'CAROLINA HERRERA',  'piso-2','dorado', 279.570),
    b('M1160','ONE MILLION LUCKY',    'RABANNE',           'piso-2','blanco', 279.700),
    b('M1160','ONE MILLION LUCKY',    'RABANNE',           'piso-2','blanco', 278.580),
    b('M1174','BAD BOY',              'CAROLINA HERRERA',  'piso-2','dorado', 279.520),
    b('M1174','BAD BOY',              'CAROLINA HERRERA',  'piso-2','blanco', 279.700),
    b('M1184','212 VIP MEN WINS',     'CAROLINA HERRERA',  'piso-2','blanco', 278.980),
    b('M1184','212 VIP MEN WINS',     'CAROLINA HERRERA',  'piso-2','blanco', 279.790),
    b('M1184','212 VIP MEN WINS',     'CAROLINA HERRERA',  'piso-2','blanco', 279.330),
    b('M1186','SILVER MOUNTAIN',      'CREED',             'piso-2','blanco', 278.830),
    b('M1187','ACQUA DI GIO PROFUNDO','GIORGIO ARMANI',    'piso-2','blanco', 279.780),
    b('M1189','SCANDALL POUR HOMME',  'JEAN PAUL GAULTIER','piso-2','blanco', 279.750),
    b('M1195','CR7 ORIGINS',          'CRISTIANO RONALDO', 'piso-2','blanco', 278.960),
    b('M1214','MAN AQUA',             'JIMMY CHOO',        'piso-2','blanco', 278.680),
    b('M220', 'ANIMALE',              'ANIMALE',           'piso-2','dorado', 277.020),
    b('M631', 'ACQUA DE GIO',         'GIORGIO ARMANI',    'piso-2','dorado', 280.340),
    b('M864', 'LACOSTE POUR HOMME',   'LACOSTE',           'piso-2','blanco', 279.880),
    b('M898', 'HUGO',                 'HUGO BOSS',         'piso-2','dorado', 277.740),
    b('M951', 'LIGHT BLUE POUR HOMME','DOLCE&GABBANA',     'piso-2','blanco', 278.900),
    // ── GABINETA INFERIOR ──
    b('M1217','ONE MILLION ROYALE',   'RABANNE',           'piso-3','blanco', 279.960),
    b('M1227','BORN IN ROMA INTENSE', 'VALENTINO',         'piso-3','blanco', 280.150),
    b('M1227','BORN IN ROMA INTENSE', 'VALENTINO',         'piso-3','blanco', 280.000),
    b('M1236','ONE MILLION ELIXIR',   'RABANNE',           'piso-3','dorado', 280.700),
    b('M5002','THE MOST WANTED INTENSE','AZZARO',          'piso-3','blanco', 280.500),
    b('M5002','THE MOST WANTED INTENSE','AZZARO',          'piso-3','blanco', 278.990),
    b('M5007','KHAMRAH QAHWA',        'LATTAFA',           'piso-3','blanco', 280.360),
    b('M5008','ODYSSEY MANDARIN SKY', 'ARMAF',             'piso-3','blanco', 280.170),
    b('M5011','BADE\'E AL OUD HONOR & GLORY','LATTAFA',    'piso-3','blanco', 279.870),
    b('M7503','ALTHAÏR',              'PARFUMS DE MARLY',  'piso-3','blanco', 280.210),
    b('M7504','STRONGER WITH YOU INTENSELY','GIORGIO ARMANI','piso-3','blanco',279.430),
    b('M7504','STRONGER WITH YOU INTENSELY','GIORGIO ARMANI','piso-3','blanco',278.860),
    b('M7505','INVICTUS VICTORY ABSOLU','RABANNE',         'piso-3','blanco', 280.040),
    b('M7508','KHAMRAH',              'LATTAFA',           'piso-3','blanco', 279.050),
    b('M7508','KHAMRAH',              'LATTAFA',           'piso-3','blanco', 279.190),
    b('M7508','KHAMRAH',              'LATTAFA',           'piso-3','blanco', 279.870),
    b('M7508','KHAMRAH',              'LATTAFA',           'piso-3','blanco', 278.520),
    b('M7511','CORAL FANTASY',        'JEAN PAUL GAULTIER','piso-3','blanco', 280.930),
  ];
}

// ===== INIT =====
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('color-preview').style.background = document.getElementById('input-color').value;
  syncContainerHighlight('input-container','opt-blanco','opt-dorado');
  renderStoreScreen();
  // NO auto-entrar aunque haya last_store — siempre pedir contraseña
});
