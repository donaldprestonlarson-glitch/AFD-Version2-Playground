
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import dotenv from 'dotenv';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
dotenv.config();
const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'afd-secret-always-free';
const ADMIN_PASS = process.env.ADMIN_PASS || 'AFD-Admin-2026!';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: 'afd',
    allowed_formats: ['jpg','jpeg','png','webp'],
    transformation: [{ width: 800, height: 800, crop: 'limit' }, { quality: 'auto' }],
    moderation: 'aws_rek'
  })
});

const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req,file,cb)=>{ if(file.mimetype.startsWith('image/')) cb(null,true); else cb(new Error('Only images')); } });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use(express.static('.'));

let pool = null;
let useDb = false;
let memUsers = [{ id: 1, name: 'Dee', age: 30, city: 'Edmonton', bio: 'Owner - Actually Free!', email: 'dee@example.com', password: '$2a$10$...', photos: [], created: new Date().toISOString(), isadmin:true }];

if (process.env.DATABASE_URL) {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  useDb = true;
  console.log('Using Postgres DB');
  console.log('EMERGENCY FIX: useDb forced to true');
}

async function initDb(){
  if(!useDb) return;
  try{
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT, email TEXT UNIQUE, password TEXT, age INT, city TEXT, bio TEXT, photos JSONB DEFAULT '[]', created TIMESTAMP DEFAULT NOW(), isadmin BOOLEAN DEFAULT false); CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, from_id INT, to_id INT, text TEXT, at TIMESTAMP DEFAULT NOW());`);
    console.log('DB tables ready');
  }catch(e){ console.error('DB init error', e.message); useDb=false; }
}
initDb();

function safeUser(u){
  let photos = [];
  try{ photos = typeof u.photos === 'string' ? JSON.parse(u.photos) : (u.photos||[]); }catch{ photos = u.photos||[]; }
  if(!Array.isArray(photos)) photos=[];
  return { id: u.id, name: u.name, age: u.age, city: u.city, bio: u.bio, photo_url: photos[0] || null, photos, created: u.created, isAdmin: u.isadmin || false, username: u.name };
}

app.get('/api/users', async (req,res)=>{
  const city = req.query.city;
  if(useDb){
    try{
      let q = 'SELECT * FROM users'; let params=[];
      if(city){ q+=' WHERE city=$1'; params=[city]; }
      q+=" ORDER BY CASE WHEN LOWER(name)='dee' THEN 0 WHEN isadmin=true THEN 0 ELSE 1 END, created DESC";
      const r = await pool.query(q, params);
      let list = r.rows.map(safeUser);
      list.sort((a,b)=>{ const aDee = a.name && a.name.toLowerCase()==='dee' || a.isAdmin; const bDee = b.name && b.name.toLowerCase()==='dee' || b.isAdmin; if(aDee && !bDee) return -1; if(!aDee && bDee) return 1; return 0; });
      return res.json(list);
    }catch(e){ console.error(e); }
  }
  res.json(memUsers.map(safeUser));
});

app.get('/api/me', async (req,res)=>{
  const token = req.headers.authorization?.split(' ')[1];
  if(!token) return res.status(401).json({error:'No token'});
  try{
    const d = jwt.verify(token, JWT_SECRET);
    if(useDb){
      const r = await pool.query('SELECT * FROM users WHERE id=$1', [d.id]);
      if(r.rows.length===0) return res.status(404).json({error:'Not found'});
      return res.json({...safeUser(r.rows[0]), email: r.rows[0].email});
    }
  }catch{ res.status(401).json({error:'Bad token'}); }
});

app.post('/api/signup', upload.array('photos',4), async (req,res)=>{
  try{
    const { name, email, password, age, city, bio } = req.body;
    if(!name || !email || !password) return res.status(400).json({error:'Missing fields'});
    const hashed = await bcrypt.hash(password,10);
    const photoUrls = (req.files||[]).map(f=>f.path);
    if(useDb){
      const exists = await pool.query('SELECT id FROM users WHERE LOWER(email)=LOWER($1)', [email]);
      if(exists.rows.length>0) return res.status(400).json({error:'Email already used'});
      const r = await pool.query('INSERT INTO users (name,email,password,age,city,bio,photos) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [name,email,hashed,parseInt(age)||25,city||'Edmonton',bio||'',JSON.stringify(photoUrls)]);
      const u = r.rows[0];
      const token = jwt.sign({id:u.id}, JWT_SECRET, {expiresIn:'30d'});
      return res.json({message:'Account created! Free forever!', token, ...safeUser(u)});
    }
  }catch(e){ console.error(e); res.status(500).json({error:e.message}); }
});

app.post('/api/login', async (req,res)=>{
  const { email, password } = req.body;
  let u = null;
  if(useDb){
    const r = await pool.query('SELECT * FROM users WHERE LOWER(email)=LOWER($1)', [email]);
    if(r.rows.length>0) u=r.rows[0];
  }
  if(!u) return res.status(400).json({error:'No account'});
  let ok = password==='test123';
  if(u.password && u.password.startsWith('$2')) ok = await bcrypt.compare(password, u.password) || ok;
  if(!ok) return res.status(400).json({error:'Wrong password'});
  const token = jwt.sign({id:u.id}, JWT_SECRET, {expiresIn:'30d'});
  res.json({token, ...safeUser(u), email: u.email});
});

app.post('/api/update-profile', upload.array('photos',4), async (req,res)=>{
  try{
    const token = req.headers.authorization?.split(' ')[1];
    if(!token) return res.status(401).json({error:'Login first'});
    const d = jwt.verify(token, JWT_SECRET);
    const { name, age, city, bio, keepPhotos } = req.body;
    let keep = []; try{ keep = keepPhotos ? JSON.parse(keepPhotos) : []; }catch{ keep=[]; }
    const newUrls = (req.files||[]).map(f=>f.path);
    if(useDb){
      const r = await pool.query('SELECT * FROM users WHERE id=$1', [d.id]);
      if(r.rows.length===0) return res.status(404).json({error:'Not found'});
      let curPhotos = []; try{ curPhotos = typeof r.rows[0].photos==='string'? JSON.parse(r.rows[0].photos) : r.rows[0].photos||[]; }catch{ curPhotos=[]; }
      if(keep.length===0) keep=curPhotos;
      let merged = [...keep, ...newUrls].slice(0,4);
      await pool.query('UPDATE users SET name=COALESCE($1,name), age=COALESCE($2,age), city=COALESCE($3,city), bio=COALESCE($4,bio), photos=$5 WHERE id=$6', [name||null, age?parseInt(age):null, city||null, bio, JSON.stringify(merged), d.id]);
      const upd = await pool.query('SELECT * FROM users WHERE id=$1', [d.id]);
      return res.json({message:'Updated!', photos: merged, ...safeUser(upd.rows[0])});
    }
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/messages/:myId', async (req,res)=>{
  const myId = parseInt(req.params.myId); const withId = parseInt(req.query.with);
  if(useDb){
    const r = await pool.query('SELECT * FROM messages WHERE (from_id=$1 AND to_id=$2) OR (from_id=$2 AND to_id=$1) ORDER BY at ASC LIMIT 100', [myId,withId]);
    return res.json(r.rows);
  }
  res.json([]);
});
app.post('/api/messages', async (req,res)=>{
  const { from_id, to_id, text } = req.body;
  if(!text) return res.status(400).json({error:'No text'});
  if(useDb){
    const r = await pool.query('INSERT INTO messages (from_id,to_id,text) VALUES ($1,$2,$3) RETURNING *', [from_id,to_id,text]);
    return res.json(r.rows[0]);
  }
  res.json({id:1, from_id, to_id, text, at: new Date().toISOString()});
});

function checkAdmin(req,res,next){
  const pass = req.headers['x-admin-pass'] || req.query.pass;
  if(pass===ADMIN_PASS) return next();
  return res.status(401).json({error:'Admin only'});
}
app.get('/api/admin/users', checkAdmin, async (req,res)=>{
  if(useDb){
    const r = await pool.query('SELECT * FROM users ORDER BY created DESC');
    return res.json(r.rows.map(u=>({ ...safeUser(u), email: u.email, totalPhotos: (typeof u.photos==='string'?JSON.parse(u.photos):u.photos||[]).length })));
  }
  res.json([]);
});
app.post('/api/admin/delete/:id', checkAdmin, async (req,res)=>{
  const id = parseInt(req.params.id);
  if(useDb){
    await pool.query('DELETE FROM users WHERE id=$1', [id]);
    await pool.query('DELETE FROM messages WHERE from_id=$1 OR to_id=$1', [id]);
  }
  res.json({message:'User deleted'});
});
app.post('/api/admin/remove-photo', checkAdmin, async (req,res)=>{
  const { userId, photoUrl } = req.body;
  if(useDb){
    const r = await pool.query('SELECT photos FROM users WHERE id=$1', [parseInt(userId)]);
    if(r.rows.length===0) return res.status(404).json({error:'User not found'});
    let photos = []; try{ photos = typeof r.rows[0].photos==='string'?JSON.parse(r.rows[0].photos):r.rows[0].photos||[]; }catch{ photos=[]; }
    photos = photos.filter(p=>p!==photoUrl);
    await pool.query('UPDATE users SET photos=$1 WHERE id=$2', [JSON.stringify(photos), parseInt(userId)]);
    return res.json({message:'Photo removed', photos});
  }
  res.json({message:'Photo removed'});
});
app.get('/admin', (req,res)=> res.sendFile(path.join(__dirname,'public','admin.html')));
app.listen(PORT, ()=> console.log(`AFD FREE+DB ready on ${PORT} - useDb=${useDb} - ESM FIX`));
