(() => {
  const COLS = ['A','B','C','D','E','F','G','H','I','J','K','L'];
  const ROWS = 1000;

  const socket = io();
  let myName = null;
  let adminOwner = null;
  let selectedCell = null;
  let editingCell = null;
  const cellData = {};

  // DOM refs
  const overlay = document.getElementById('overlay');
  const nicknameInput = document.getElementById('nickname-input');
  const joinBtn = document.getElementById('join-btn');
  const appEl = document.getElementById('app');
  const gridHead = document.getElementById('grid-head');
  const gridBody = document.getElementById('grid-body');
  const onlineCountEl = document.getElementById('online-count');
  const imageBtn = document.getElementById('image-btn');
  const imageFile = document.getElementById('image-file');
  const caInput = document.getElementById('ca-input');
  const statusLeft = document.getElementById('status-left');
  const statusRight = document.getElementById('status-right');

  // ========== JOIN ==========
  function tryJoin() {
    const name = nicknameInput.value.trim();
    if (!name) { nicknameInput.focus(); return; }
    myName = name;
    socket.emit('join', myName);
    overlay.classList.add('hidden');
    appEl.classList.remove('hidden');
    statusLeft.textContent = `Logged in as ${myName}`;
  }
  joinBtn.addEventListener('click', tryJoin);
  nicknameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryJoin(); });
  nicknameInput.focus();

  // ========== CONTRACT ADDRESS COPY ==========
  function flashCopied() {
    caInput.classList.add('copied');
    const orig = caInput.value;
    caInput.value = 'Copied!';
    setTimeout(() => {
      caInput.value = orig;
      caInput.classList.remove('copied');
    }, 1200);
  }

  caInput.addEventListener('click', () => {
    const text = caInput.value;
    if (!text) return;
    navigator.clipboard.writeText(text).then(flashCopied).catch(() => {
      caInput.removeAttribute('readonly');
      caInput.select();
      document.execCommand('copy');
      caInput.setAttribute('readonly', '');
      flashCopied();
    });
  });

  // ========== BUILD GRID ==========
  function buildGrid() {
    // Header row
    const headTr = document.createElement('tr');
    const cornerTh = document.createElement('th');
    headTr.appendChild(cornerTh);
    COLS.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col;
      headTr.appendChild(th);
    });
    gridHead.appendChild(headTr);

    // Use a document fragment for performance
    const fragment = document.createDocumentFragment();
    for (let r = 1; r <= ROWS; r++) {
      const tr = document.createElement('tr');
      if (r <= 3) tr.classList.add('admin-row');
      tr.dataset.row = r;

      const rowTd = document.createElement('td');
      rowTd.textContent = r;
      tr.appendChild(rowTd);

      COLS.forEach(col => {
        const td = document.createElement('td');
        const cellId = col + r;
        td.dataset.cellId = cellId;
        td.addEventListener('click', () => selectCell(cellId, td));
        tr.appendChild(td);
      });

      fragment.appendChild(tr);
    }
    gridBody.appendChild(fragment);
  }
  buildGrid();

  // ========== CELL SELECTION ==========
  function selectCell(cellId, tdEl) {
    if (editingCell && editingCell !== cellId) {
      commitEdit();
    }
    if (selectedCell) {
      const prev = getTd(selectedCell);
      if (prev) prev.classList.remove('selected');
    }
    selectedCell = cellId;
    if (tdEl) tdEl.classList.add('selected');
  }

  function getTd(cellId) {
    return gridBody.querySelector(`td[data-cell-id="${cellId}"]`);
  }

  // ========== CELL EDITING ==========
  document.addEventListener('dblclick', (e) => {
    const td = e.target.closest('td[data-cell-id]');
    if (!td) return;
    startEdit(td.dataset.cellId, td);
  });

  document.addEventListener('keydown', (e) => {
    if (!selectedCell || editingCell) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === 'Enter') {
      e.preventDefault();
      const td = getTd(selectedCell);
      if (td) startEdit(selectedCell, td);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      clearCell(selectedCell);
      return;
    }
    // Arrow navigation
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
      e.preventDefault();
      navigateArrow(e.key);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      navigateArrow(e.shiftKey ? 'ArrowLeft' : 'ArrowRight');
      return;
    }
    // Start typing into cell
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const td = getTd(selectedCell);
      if (td) startEdit(selectedCell, td, e.key);
      e.preventDefault();
    }
  });

  function startEdit(cellId, td, initialChar) {
    const data = cellData[cellId];
    if (data && data.owner && data.owner !== myName) return;

    const row = parseInt(cellId.replace(/^[A-L]+/, ''), 10);
    if (row <= 3) {
      if (adminOwner && adminOwner !== myName) return;
      if (!adminOwner && cellId !== 'A1') return;
    }

    if (editingCell) commitEdit();
    editingCell = cellId;

    const textarea = document.createElement('textarea');
    textarea.className = 'cell-editor';
    textarea.value = initialChar !== undefined ? initialChar : (data ? data.content : '');
    td.appendChild(textarea);
    textarea.focus();
    if (initialChar === undefined) {
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commitEdit();
        navigateArrow('ArrowDown');
      } else if (e.key === 'Escape') {
        cancelEdit();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        commitEdit();
        navigateArrow(e.shiftKey ? 'ArrowLeft' : 'ArrowRight');
      }
    });

    textarea.addEventListener('blur', () => {
      if (editingCell === cellId) commitEdit();
    });
  }

  function commitEdit() {
    if (!editingCell) return;
    const td = getTd(editingCell);
    const textarea = td ? td.querySelector('.cell-editor') : null;
    const cellId = editingCell;
    editingCell = null;

    if (!textarea) return;
    const content = textarea.value;
    textarea.remove();

    const existing = cellData[cellId];
    const image = existing ? existing.image : '';

    socket.emit('cell:update', { cellId, content, image });
  }

  function cancelEdit() {
    if (!editingCell) return;
    const td = getTd(editingCell);
    editingCell = null;
    const textarea = td ? td.querySelector('.cell-editor') : null;
    if (textarea) textarea.remove();
  }

  function clearCell(cellId) {
    const data = cellData[cellId];
    if (data && data.owner && data.owner !== myName) return;
    socket.emit('cell:update', { cellId, content: '', image: '' });
  }

  function navigateArrow(dir) {
    if (!selectedCell) return;
    const col = selectedCell.replace(/[0-9]/g, '');
    const row = parseInt(selectedCell.replace(/[A-L]/g, ''), 10);
    let ci = COLS.indexOf(col);
    let ri = row;

    if (dir === 'ArrowUp') ri = Math.max(1, ri - 1);
    else if (dir === 'ArrowDown') ri = Math.min(ROWS, ri + 1);
    else if (dir === 'ArrowLeft') ci = Math.max(0, ci - 1);
    else if (dir === 'ArrowRight') ci = Math.min(COLS.length - 1, ci + 1);

    const newId = COLS[ci] + ri;
    const td = getTd(newId);
    if (td) {
      selectCell(newId, td);
      td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  // ========== IMAGE UPLOAD ==========
  imageBtn.addEventListener('click', () => {
    if (!selectedCell) return;
    imageFile.click();
  });

  imageFile.addEventListener('change', async () => {
    if (!imageFile.files[0] || !selectedCell) return;
    const data = cellData[selectedCell];
    if (data && data.owner && data.owner !== myName) return;

    const fd = new FormData();
    fd.append('image', imageFile.files[0]);

    try {
      const res = await fetch('/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (json.url) {
        const content = data ? data.content : '';
        socket.emit('cell:update', { cellId: selectedCell, content, image: json.url });
      }
    } catch (err) {
      console.error('Upload failed', err);
    }
    imageFile.value = '';
  });

  // ========== PASTE IMAGE FROM CLIPBOARD ==========
  document.addEventListener('paste', async (e) => {
    if (!selectedCell || editingCell) return;
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) return;

        const data = cellData[selectedCell];
        if (data && data.owner && data.owner !== myName) return;

        const fd = new FormData();
        fd.append('image', blob, 'pasted.png');
        try {
          const res = await fetch('/upload', { method: 'POST', body: fd });
          const json = await res.json();
          if (json.url) {
            const content = data ? data.content : '';
            socket.emit('cell:update', { cellId: selectedCell, content, image: json.url });
          }
        } catch (err) {
          console.error('Paste upload failed', err);
        }
        return;
      }
    }
  });

  // ========== RENDER CELL ==========
  function renderCell(cellId) {
    const td = getTd(cellId);
    if (!td) return;
    const data = cellData[cellId];

    // Remove existing content (but not the editor)
    const editor = td.querySelector('.cell-editor');
    td.innerHTML = '';
    if (editor) td.appendChild(editor);
    td.classList.remove('cell-has-image');

    if (!data || (!data.content && !data.image)) return;

    if (data.image) td.classList.add('cell-has-image');

    const wrapper = document.createElement('div');
    wrapper.className = 'cell-content';

    if (data.image) {
      const img = document.createElement('img');
      img.src = data.image;
      img.loading = 'lazy';
      wrapper.appendChild(img);
    }
    if (data.content) {
      const txt = document.createElement('span');
      txt.textContent = data.content;
      wrapper.appendChild(txt);
    }
    td.appendChild(wrapper);

    if (data.owner) {
      td.title = `Owner: ${data.owner}`;
      const ownerTag = document.createElement('div');
      ownerTag.className = 'cell-owner';
      ownerTag.textContent = data.owner;
      td.appendChild(ownerTag);
    } else {
      td.title = '';
    }
  }

  // ========== SOCKET EVENTS ==========
  socket.on('init', (payload) => {
    adminOwner = payload.adminOwner || null;
    payload.cells.forEach(c => {
      cellData[c.id] = { content: c.content, image: c.image, owner: c.owner };
      renderCell(c.id);
    });
    updateAdminLabel();
  });

  socket.on('cell:updated', (data) => {
    const { cellId, content, image, owner } = data;
    if (!content && !image) {
      delete cellData[cellId];
    } else {
      cellData[cellId] = { content, image, owner };
    }
    renderCell(cellId);
  });

  socket.on('admin_owner', (owner) => {
    adminOwner = owner || null;
    updateAdminLabel();
  });

  socket.on('users', (info) => {
    onlineCountEl.textContent = `${info.count} online`;
    statusRight.textContent = info.list.join(', ');
  });

  function updateAdminLabel() {
    if (adminOwner) {
      statusLeft.textContent = `Logged in as ${myName} | Rows 1-3 owned by: ${adminOwner}`;
    }
  }
})();
