
import express from 'express';
import Database from 'better-sqlite3';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Setup
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('data')) fs.mkdirSync('data');

// DB - SQLite file that persists
const db = new Database('data/afd.db');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  age INTEGER NOT NULL,
  city TEXT NOT NULL CHECK(city IN ('Edmonton','Calgary')),
  bio TEXT,
  photo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL,
  to_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(from_id) REFERENCES users(id),
  FOREIGN KEY(to_id) REFERENCES users(id)
);
`);

// Simple seed data for Calgary/Edmonton if empty
const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (count === 0) {
  const hash = bcrypt.hashSync('test123', 10);
  const insert = db.prepare('INSERT INTO users (email,name,age,city,bio,photo,password_hash) VALUES (?,?,?,?,?,?,?)');
  insert.run('sarah.e@example.com','Sarah', 58, 'Edmonton','Love hiking in the river valley and coffee at local shops. Looking for genuine connection.','', hash);
  insert.run('mike.c@example.com','Mike', 62, 'Calgary','Retired teacher, loves fishing and live music. No games, just real conversation.','', hash);
  insert.run('linda.e@example.com','Linda', 54, 'Edmonton','Grandma of 2, still young at heart. Farmer\'s market every Saturday.','', hash);
  insert.run('dave.c@example.com','Dave', 60, 'Calgary','Oil & gas retired, now woodworking and travel. Looking for partner to explore Banff with.','', hash);
  console.log('Seeded 4 demo users - password: test123');
}

const upload = multer({ dest: 'uploads/', limits: { fileSize: 5*1024*1024 } });

const limiter = rateLimit({ windowMs: 15*60*1000, max: 200 });
app.use('/api/', limiter);

// API
app.get('/api/users', (req, res) => {
  const city = req.query.city;
  let rows;
  if (city && ['Edmonton','Calgary'].includes(city)) {
    rows = db.prepare('SELECT id,name,age,city,bio,photo,created_at FROM users WHERE city=? ORDER BY created_at DESC').all(city);
  } else {
    rows = db.prepare('SELECT id,name,age,city,bio,photo,created_at FROM users ORDER BY created_at DESC').all();
  }
  res.json(rows);
});

app.post('/api/signup', upload.single('photo'), async (req, res) => {
  try {
    const { email, password, name, age, city, bio } = req.body;
    if (!email || !password || !name || !age || !city) return res.status(400).json({error:'Missing fields'});
    if (!['Edmonton','Calgary'].includes(city)) return res.status(400).json({error:'City must be Edmonton or Calgary for launch'});
    const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email);
    if (existing) return res.status(400).json({error:'Email already used'});
    const hash = await bcrypt.hash(password, 10);
    const photo = req.file ? `/uploads/${req.file.filename}` : '';
    const info = db.prepare('INSERT INTO users (email,password_hash,name,age,city,bio,photo) VALUES (?,?,?,?,?,?,?)')
      .run(email, hash, name, parseInt(age), city, bio||'', photo);
    res.json({ id: info.lastInsertRowid, message: 'Created - 100% free, always will be' });
  } catch(e){ console.error(e); res.status(500).json({error:'Server error'}); }
});

app.post('/api/login', (req,res)=>{
  const {email,password} = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user) return res.status(400).json({error:'Invalid login'});
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(400).json({error:'Invalid login'});
  res.json({ id: user.id, name: user.name, city: user.city });
});

app.get('/api/messages/:userId', (req,res)=>{
  const userId = parseInt(req.params.userId);
  const otherId = parseInt(req.query.with);
  if (!otherId) {
    // inbox - latest per conversation
    const msgs = db.prepare(`
      SELECT m.*, u.name as other_name FROM messages m
      JOIN users u ON u.id = CASE WHEN m.from_id=? THEN m.to_id ELSE m.from_id END
      WHERE m.from_id=? OR m.to_id=?
      ORDER BY m.created_at DESC LIMIT 50
    `).all(userId,userId,userId);
    return res.json(msgs);
  }
  const msgs = db.prepare(`
    SELECT * FROM messages WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) ORDER BY created_at ASC
  `).all(userId,otherId,otherId,userId);
  res.json(msgs);
});

app.post('/api/messages', (req,res)=>{
  const {from_id,to_id,text} = req.body;
  if (!from_id || !to_id || !text) return res.status(400).json({error:'Missing'});
  const info = db.prepare('INSERT INTO messages (from_id,to_id,text) VALUES (?,?,?)').run(from_id,to_id,text);
  res.json({ id: info.lastInsertRowid });
});

// Fallback to index
app.get('*', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT, ()=> console.log(`AFD running on port ${PORT} - Actually Free, Always Will Be`));
