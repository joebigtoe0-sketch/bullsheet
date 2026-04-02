const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e6 });

// Set DATA_DIR on Render to a persistent disk mount (e.g. /data) so SQLite + uploads survive deploys
const dataDir = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const uploadsDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const db = new Database(path.join(dataDir, 'dogsheet.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS cells (
    id TEXT PRIMARY KEY,
    content TEXT DEFAULT '',
    image TEXT DEFAULT '',
    owner TEXT DEFAULT '',
    updated_at INTEGER DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  )
`);

const getCell = db.prepare('SELECT * FROM cells WHERE id = ?');
const upsertCell = db.prepare(`
  INSERT INTO cells (id, content, image, owner, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    content = excluded.content,
    image = excluded.image,
    owner = excluded.owner,
    updated_at = excluded.updated_at
`);
const deleteCell = db.prepare('DELETE FROM cells WHERE id = ?');
const getAllCells = db.prepare('SELECT * FROM cells');
const getMeta = db.prepare('SELECT value FROM meta WHERE key = ?');
const upsertMeta = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 4 * 1024 * 1024 } });

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: '/uploads/' + req.file.filename });
});

const onlineUsers = new Map();

io.on('connection', (socket) => {
  let nickname = null;

  socket.on('join', (name) => {
    nickname = name.trim().substring(0, 30);
    onlineUsers.set(socket.id, nickname);
    io.emit('users', { count: onlineUsers.size, list: [...new Set(onlineUsers.values())] });

    const cells = getAllCells.all();
    const adminOwner = getMeta.get('admin_owner');
    socket.emit('init', {
      cells,
      adminOwner: adminOwner ? adminOwner.value : null
    });
  });

  socket.on('cell:update', (data) => {
    if (!nickname) return;
    const { cellId, content, image } = data;
    if (!cellId) return;

    const row = parseInt(cellId.replace(/^[A-L]+/, ''), 10);
    const isAdminRow = row >= 1 && row <= 3;

    const adminOwnerRow = getMeta.get('admin_owner');
    const adminOwner = adminOwnerRow ? adminOwnerRow.value : null;

    if (isAdminRow) {
      if (adminOwner && adminOwner !== nickname) return;
      if (!adminOwner && cellId === 'A1') {
        upsertMeta.run('admin_owner', nickname);
        io.emit('admin_owner', nickname);
      } else if (!adminOwner) {
        return;
      }
    }

    const existing = getCell.get(cellId);
    if (existing && existing.owner && existing.owner !== nickname) return;

    const hasContent = (content && content.trim()) || image;
    if (!hasContent) {
      deleteCell.run(cellId);
      io.emit('cell:updated', { cellId, content: '', image: '', owner: '' });

      if (isAdminRow) {
        const adminCells = getAllCells.all().filter(c => {
          const r = parseInt(c.id.replace(/^[A-L]+/, ''), 10);
          return r >= 1 && r <= 3;
        });
        if (adminCells.length === 0) {
          upsertMeta.run('admin_owner', '');
          io.emit('admin_owner', null);
        }
      }
      return;
    }

    upsertCell.run(cellId, content || '', image || '', nickname, Date.now());
    io.emit('cell:updated', { cellId, content: content || '', image: image || '', owner: nickname });
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    io.emit('users', { count: onlineUsers.size, list: [...new Set(onlineUsers.values())] });
  });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`Dogsheet listening on ${HOST}:${PORT}`);
});
