import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'afd-secret-always-free';
const ADMIN_PASS = process.env.ADMIN_PASS || 'AFD-Admin-2026!';
const DATABASE_URL = process.env.DATABASE_URL;

let pool = null;
let useDb = false;
if(DATABASE_URL){
  pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL.includes('render') ? { rejectUnauthorized:false } : false });
  useDb = true;
  console.log('Using Postgres DB');
} else {
  console.log('No DATABASE_URL - using JSON files');
}

async function initDb(){
  if(!useDb) return;
  try{
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT, email TEXT UNIQUE, password TEXT,
        age INT, city TEXT, gender TEXT, bio TEXT,
        photos TEXT, created TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        from_id INT, to_id INT, text TEXT, at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS blocks (
        user_id INT, blocked_id INT, PRIMARY KEY(user_id, blocked_id)
      );
    `);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS height TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS weight TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS smoking TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS drinking TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cannabis TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS job TEXT`);
    await pool.query(`UPDATE users SET pinned = TRUE WHERE LOWER(name) = 'dee'`);
    console.log('DB tables ready + Dee pinned');
  }catch(e){ console.log('DB init error', e.message); }
}
initDb();

const DATA_DIR = path.join(__dirname, 'data');
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive:true});
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MSGS_FILE = path.join(DATA_DIR, 'messages.json');
const BLOCKS_FILE = path.join(DATA_DIR, 'blocks.json');

function loadJson(file, def){ try{ if(fs.existsSync(file)) return JSON.parse(fs.readFileSync(file,'utf8')); }catch(e){} return def; }
function saveJson(file, data){ try{ fs.writeFileSync(file, JSON.stringify(data, null, 2)); }catch{} }

const hasCloudinary = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
let storage;
if(hasCloudinary){
  cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
  storage = new CloudinaryStorage({ cloudinary, params: { folder: 'afd', allowed_formats: ['jpg','jpeg','png','webp'], transformation: [{ width: 800, height: 800, crop: 'limit' }, { quality: 'auto' }] } });
}else{
  const uploadDir = path.join(__dirname, 'public', 'uploads');
  if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, {recursive:true});
  storage = multer.diskStorage({ destination: (req,file,cb)=> cb(null, uploadDir), filename: (req,file,cb)=> cb(null, Date.now()+'-'+file.originalname.replace(/[^a-zA-Z0-9.]/g,'_')) });
}
const upload = multer({ storage, limits: { fileSize: 5*1024*1024 }, fileFilter: (req,file,cb)=>{ if(file.mimetype.startsWith('image/')) cb(null,true); else cb(new Error('Only images')); } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let users = loadJson(USERS_FILE, [
  { id: 1, name: 'Dee', age: 38, city: 'Edmonton', gender: 'Woman', bio: 'Admin - Welcome to Actually Free Dating! 100% free, always will be. Edmonton & Calgary love!', email: 'dee@actuallyfreedating.ca', password: '$2a$10$demo', photos: [], created: new Date().toISOString(), pinned: true },
  { id: 2, name: 'Sarah', age: 28, city: 'Edmonton', gender: 'Woman', bio: 'Love hiking in River Valley!', email: 'sarah.e@example.com', password: '$2a$10$demo', photos: [], created: new Date().toISOString() },
  { id: 3, name: 'Mike', age: 32, city: 'Calgary', gender: 'Man', bio: 'Calgary born, love Flames.', email: 'mike.c@example.com', password: '$2a$10$demo', photos: [], created: new Date().toISOString() }
]);
let messages = loadJson(MSGS_FILE, []);
let blocks = loadJson(BLOCKS_FILE, {});
let nextId = Math.max(100, ...users.map(u=>u.id), 0) + 1;

function getFileUrl(file){ if(hasCloudinary){ return file.path || file.secure_url || file.url; } return '/uploads/'+file.filename; }
function safeUser(u){ 
  let photos = u.photos;
  if(typeof photos === 'string'){ try{ photos = JSON.parse(photos); if(typeof photos==='string') photos=JSON.parse(photos); }catch{ photos=[]; } }
  if(!Array.isArray(photos)) photos=[];
  photos=photos.filter(p=> typeof p==='string' && p.length>5);
  return { id: u.id, name: u.name, age: u.age, city: u.city, gender: u.gender||'Man', bio: u.bio, height: u.height||'All', weight: u.weight||'All', smoking: u.smoking||'All', drinking: u.drinking||'All', cannabis: u.cannabis||'All', job: u.job||'All', photo_url: (photos?.[0]||null), photos: photos||[], created: u.created, pinned: !!u.pinned }; 
}
function getBlockedFor(userId){ return blocks[userId] || []; }
function isBlocked(a,b){ return (blocks[a]||[]).includes(b) || (blocks[b]||[]).includes(a); }

async function dbGetUsers(){ const r=await pool.query('SELECT * FROM users ORDER BY pinned DESC NULLS LAST, id DESC'); return r.rows; }
async function dbGetUserByEmail(email){ const r=await pool.query('SELECT * FROM users WHERE LOWER(email)=LOWER($1)', [email]); return r.rows[0]; }
async function dbGetUserById(id){ const r=await pool.query('SELECT * FROM users WHERE id=$1', [id]); return r.rows[0]; }

app.get('/api/users', async (req,res)=>{
  try{
    const city=req.query.city;
    const myId = parseInt(req.query.myId||0);
    const gender = req.query.gender;
    const ageMin = parseInt(req.query.ageMin||0);
    const ageMax = parseInt(req.query.ageMax||0);
    let list;
    if(useDb){
      let sql='SELECT * FROM users WHERE 1=1';
      const params=[]; let idx=1;
      if(city){ sql+=` AND city=$${idx++}`; params.push(city); }
      if(gender && gender!=='All'){ sql+=` AND gender=$${idx++}`; params.push(gender); }
      if(ageMin){ sql+=` AND age >= $${idx++}`; params.push(ageMin); }
      if(ageMax){ sql+=` AND age <= $${idx++}`; params.push(ageMax); }
      sql+=' ORDER BY pinned DESC NULLS LAST, id DESC';
      const r=await pool.query(sql, params);
      list=r.rows;
      if(myId){
        const br=await pool.query('SELECT blocked_id FROM blocks WHERE user_id=$1', [myId]);
        const myBlocks=br.rows.map(x=>x.blocked_id);
        list=list.filter(u=> !myBlocks.includes(u.id));
        const br2=await pool.query('SELECT user_id FROM blocks WHERE blocked_id=$1', [myId]);
        const blockedBy=br2.rows.map(x=>x.user_id);
        list=list.filter(u=> !blockedBy.includes(u.id));
      }
    }else{
      list=[...users];
      if(city) list=list.filter(u=> u.city===city);
      if(gender && gender!=='All') list=list.filter(u=> u.gender===gender);
      if(ageMin) list=list.filter(u=> (u.age||0)>=ageMin);
      if(ageMax) list=list.filter(u=> (u.age||0)<=ageMax);
      if(myId){
        const myBlocks=getBlockedFor(myId);
        list=list.filter(u=> !myBlocks.includes(u.id));
        list=list.filter(u=> !getBlockedFor(u.id).includes(myId));
      }
      list.sort((a,b)=> (b.pinned?1:0)-(a.pinned?1:0) || b.id-a.id);
    }
    res.json(list.map(safeUser));
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/register', upload.array('photos', 6), async (req,res)=>{
  try{
    const { name, email, password, age, city, gender, bio, height, weight, smoking, drinking, cannabis, job } = req.body;
    if(!email||!password||!name) return res.status(400).json({error:'Missing fields'});
    const hashed=await bcrypt.hash(password,10);
    const photos=(req.files||[]).map(getFileUrl);
    if(useDb){
      const exists=await dbGetUserByEmail(email);
      if(exists) return res.status(400).json({error:'Email exists'});
      const r=await pool.query('INSERT INTO users(name,email,password,age,city,gender,bio,photos,height,weight,smoking,drinking,cannabis,job) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *', [name,email,hashed,parseInt(age)||null,city,gender,bio,JSON.stringify(photos),height||'All',weight||'All',smoking||'All',drinking||'All',cannabis||'All',job||'All']);
      const u=r.rows[0];
      const token=jwt.sign({id:u.id,email:u.email}, JWT_SECRET);
      return res.json({token, user: safeUser(u)});
    }else{
      if(users.find(u=>u.email.toLowerCase()===email.toLowerCase())) return res.status(400).json({error:'Email exists'});
      const u={ id: nextId++, name,email,password:hashed,age:parseInt(age)||0,city,gender,bio,photos,height:height||'All',weight:weight||'All',smoking:smoking||'All',drinking:drinking||'All',cannabis:cannabis||'All',job:job||'All',created:new Date().toISOString() };
      users.push(u); saveJson(USERS_FILE, users);
      const token=jwt.sign({id:u.id,email:u.email}, JWT_SECRET);
      return res.json({token, user: safeUser(u)});
    }
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/login', async (req,res)=>{
  try{
    const { email, password }=req.body;
    let u;
    if(useDb) u=await dbGetUserByEmail(email);
    else u=users.find(x=>x.email.toLowerCase()===email.toLowerCase());
    if(!u) return res.status(400).json({error:'No account'});
    const ok=await bcrypt.compare(password, u.password);
    if(!ok) return res.status(400).json({error:'Wrong password'});
    const token=jwt.sign({id:u.id,email:u.email}, JWT_SECRET);
    res.json({token, user: safeUser(u)});
  }catch(e){ res.status(500).json({error:e.message}); }
});

function auth(req){
  const h=req.headers.authorization?.split(' ')[1];
  if(!h) return null;
  try{ return jwt.verify(h, JWT_SECRET); }catch{ return null; }
}

app.post('/api/delete-account', async (req,res)=>{
  const d=auth(req); if(!d) return res.status(401).json({error:'Login first'});
  try{
    if(useDb){
      await pool.query('DELETE FROM users WHERE id=$1', [d.id]);
      await pool.query('DELETE FROM messages WHERE from_id=$1 OR to_id=$1', [d.id]);
      await pool.query('DELETE FROM blocks WHERE user_id=$1 OR blocked_id=$1', [d.id]);
    }else{
      users=users.filter(u=>u.id!==d.id); saveJson(USERS_FILE, users);
    }
    res.json({message:'Deleted'});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/messages/:myId', async (req,res)=>{
  const myId=parseInt(req.params.myId);
  const withId=parseInt(req.query.with);
  if(!withId) return res.json([]);
  try{
    if(useDb){
      const r=await pool.query('SELECT * FROM messages WHERE (from_id=$1 AND to_id=$2) OR (from_id=$2 AND to_id=$1) ORDER BY id ASC LIMIT 200', [myId,withId]);
      return res.json(r.rows);
    }else{
      const filtered=messages.filter(m=> (m.from_id===myId&&m.to_id===withId)||(m.from_id===withId&&m.to_id===myId));
      return res.json(filtered.slice(-200));
    }
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/inbox/:myId', async (req,res)=>{
  const myId=parseInt(req.params.myId);
  try{
    if(useDb){
      const r=await pool.query('SELECT DISTINCT ON (CASE WHEN from_id=$1 THEN to_id ELSE from_id END) * FROM messages WHERE from_id=$1 OR to_id=$1 ORDER BY (CASE WHEN from_id=$1 THEN to_id ELSE from_id END), at DESC', [myId]);
      const inbox=[];
      for(let m of r.rows){
        const other=m.from_id===myId?m.to_id:m.from_id;
        const u=await dbGetUserById(other);
        inbox.push({ otherId: other, name: u?.name||'Deleted', photo: (()=>{ try{ return JSON.parse(u?.photos||'[]')[0]; }catch{ return null; } })(), lastMsg: m.text, at: m.at });
      }
      return res.json(inbox.sort((a,b)=> new Date(b.at)-new Date(a.at)));
    }else{
      const convMap={};
      messages.forEach(m=>{
        if(m.from_id===myId||m.to_id===myId){
          const other = m.from_id===myId ? m.to_id : m.from_id;
          if(!convMap[other] || new Date(m.at) > new Date(convMap[other].at)){ convMap[other]=m; }
        }
      });
      const inbox = Object.entries(convMap).map(([otherId, lastMsg])=>{
        const u=users.find(x=>x.id==otherId);
        return { otherId: parseInt(otherId), name: u?.name||'Deleted', photo: u?.photos?.[0]||null, lastMsg: lastMsg.text, at: lastMsg.at };
      }).sort((a,b)=> new Date(b.at)-new Date(a.at));
      return res.json(inbox);
    }
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/messages', async (req,res)=>{
  const { from_id, to_id, text }=req.body;
  const fid=parseInt(from_id), tid=parseInt(to_id);
  if(!text) return res.status(400).json({error:'No text'});
  try{
    if(useDb){
      const r=await pool.query('INSERT INTO messages(from_id,to_id,text) VALUES($1,$2,$3) RETURNING *', [fid,tid,text]);
      return res.json(r.rows[0]);
    }else{
      const msg={ id: messages.length+1, from_id: fid, to_id: tid, text, at:new Date().toISOString() };
      messages.push(msg); saveJson(MSGS_FILE, messages);
      return res.json(msg);
    }
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/block', async (req,res)=>{
  try{
    const h=req.headers.authorization?.split(' ')[1];
    if(!h) return res.status(401).json({error:'Login first'});
    const d=jwt.verify(h,JWT_SECRET);
    const myId=d.id;
    const { targetId, action } = req.body;
    const tid=parseInt(targetId);
    if(!tid || tid===myId) return res.status(400).json({error:'Invalid'});
    if(useDb){
      if(action==='unblock'){ await pool.query('DELETE FROM blocks WHERE user_id=$1 AND blocked_id=$2', [myId, tid]); }
      else{ await pool.query('INSERT INTO blocks(user_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [myId, tid]); }
      const br=await pool.query('SELECT blocked_id FROM blocks WHERE user_id=$1', [myId]);
      return res.json({blocked: br.rows.map(x=>x.blocked_id)});
    }else{
      if(!blocks[myId]) blocks[myId]=[];
      if(action==='unblock'){ blocks[myId]=blocks[myId].filter(x=>x!==tid); }
      else{ if(!blocks[myId].includes(tid)) blocks[myId].push(tid); }
      saveJson(BLOCKS_FILE, blocks);
      return res.json({blocked: blocks[myId]});
    }
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/blocks', async (req,res)=>{
  try{
    const tokenHdr=req.headers.authorization?.split(' ')[1];
    if(!tokenHdr) return res.status(401).json({error:'Login first'});
    const d=jwt.verify(tokenHdr,JWT_SECRET);
    if(useDb){
      const br=await pool.query('SELECT blocked_id FROM blocks WHERE user_id=$1', [d.id]);
      const ids=br.rows.map(x=>x.blocked_id);
      if(!ids.length) return res.json([]);
      const ur=await pool.query(`SELECT id,name,city,photos FROM users WHERE id=ANY($1)`, [ids]);
      return res.json(ur.rows.map(u=>{ let ph=[]; try{ ph=JSON.parse(u.photos||'[]'); }catch{} return {id:u.id,name:u.name,city:u.city,photo:ph[0]||null}; }));
    }else{
      const list=blocks[d.id]||[];
      const blockedUsers=list.map(id=>{ const u=users.find(x=>x.id===id); return u ? {id: u.id, name: u.name, city: u.city, photo: u.photos?.[0]||null} : {id, name:'Deleted'}; });
      return res.json(blockedUsers);
    }
  }catch(e){ res.status(500).json({error:e.message}); }
});

function checkAdmin(req,res,next){
  const pass=req.headers['x-admin-pass']||req.query.pass;
  if(pass===ADMIN_PASS) return next();
  return res.status(401).json({error:'Admin only'});
}
app.get('/api/admin/users', checkAdmin, async (req,res)=>{
  if(useDb){ const r=await pool.query('SELECT * FROM users ORDER BY pinned DESC NULLS LAST, id DESC'); return res.json(r.rows.map(u=>({ id:u.id, name:u.name, email:u.email, city:u.city })) ); }
  res.json(users.map(u=>({ id:u.id, name:u.name, email:u.email, city:u.city })).reverse());
});
app.post('/api/admin/delete/:id', checkAdmin, async (req,res)=>{
  const id=parseInt(req.params.id);
  if(useDb){ await pool.query('DELETE FROM users WHERE id=$1',[id]); }
  else{ users=users.filter(u=>u.id!==id); saveJson(USERS_FILE, users); }
  res.json({message:'User deleted'});
});

app.get('/admin', (req,res)=> res.sendFile(path.join(__dirname,'public','admin.html')));
app.listen(PORT, ()=> console.log(`AFD FREE+DB ready on ${PORT} - useDb=${useDb}`));
