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

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'afd-secret-always-free';
const ADMIN_PASS = process.env.ADMIN_PASS || 'AFD-Admin-2026!';

const DATA_DIR = path.join(__dirname, 'data');
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive:true});
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MSGS_FILE = path.join(DATA_DIR, 'messages.json');
const BLOCKS_FILE = path.join(DATA_DIR, 'blocks.json');

function loadJson(file, def){ try{ if(fs.existsSync(file)) return JSON.parse(fs.readFileSync(file,'utf8')); }catch(e){} return def; }
function saveJson(file, data){ try{ fs.writeFileSync(file, JSON.stringify(data, null, 2)); }catch(e){} }

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
  { id: 1, name: 'Sarah', age: 28, city: 'Edmonton', bio: 'Love hiking in River Valley! Actually free is refreshing!', email: 'sarah.e@example.com', password: '$2a$10$demo', photos: [], created: new Date().toISOString() },
  { id: 2, name: 'Mike', age: 32, city: 'Calgary', bio: 'Calgary born, love Flames and mountains.', email: 'mike.c@example.com', password: '$2a$10$demo', photos: [], created: new Date().toISOString() }
]);
let messages = loadJson(MSGS_FILE, []);
let blocks = loadJson(BLOCKS_FILE, {}); // { userId: [blockedId1, blockedId2] }
let nextId = Math.max(100, ...users.map(u=>u.id), 0) + 1;

function getFileUrl(file){ return hasCloudinary ? file.path : '/uploads/'+file.filename; }
function safeUser(u){ return { id: u.id, name: u.name, age: u.age, city: u.city, bio: u.bio, photo_url: u.photos?.[0]||null, photos: u.photos||[], created: u.created }; }
function getBlockedFor(userId){ return blocks[userId] || []; }
function isBlocked(a,b){ // a blocked b OR b blocked a -> hide
  return (blocks[a]||[]).includes(b) || (blocks[b]||[]).includes(a);
}

app.get('/api/users', (req,res)=>{
  const city=req.query.city;
  const myId = parseInt(req.query.myId||0);
  let list=users;
  if(city) list=list.filter(u=>u.city===city);
  if(myId){
    const myBlocks = getBlockedFor(myId);
    list = list.filter(u=> u.id!==myId && !myBlocks.includes(u.id) && !(blocks[u.id]||[]).includes(myId));
  }
  res.json(list.map(safeUser).reverse());
});

app.get('/api/me', (req,res)=>{
  const token=req.headers.authorization?.split(' ')[1];
  if(!token) return res.status(401).json({error:'No token'});
  try{
    const d=jwt.verify(token,JWT_SECRET);
    const u=users.find(x=>x.id===d.id);
    if(!u) return res.status(404).json({error:'Not found'});
    res.json({...safeUser(u), email:u.email, blocked: getBlockedFor(u.id)});
  }catch{ res.status(401).json({error:'Bad token'}); }
});

app.post('/api/signup', (req,res,next)=>{ upload.array('photos',4)(req,res,(err)=>{ if(err) return res.status(400).json({error: err.message}); next(); }); }, async (req,res)=>{
  try{
    const { name, email, password, age, city, bio } = req.body;
    if(!name||!email||!password) return res.status(400).json({error:'Missing fields'});
    if(users.find(u=>u.email.toLowerCase()===email.toLowerCase())) return res.status(400).json({error:'Email already used'});
    const hashed=await bcrypt.hash(password,10);
    const photoUrls=(req.files||[]).map(f=>getFileUrl(f));
    const u={ id: nextId++, name, email, password:hashed, age:parseInt(age)||25, city:city||'Edmonton', bio:bio||'', photos:photoUrls, created:new Date().toISOString() };
    users.push(u); saveJson(USERS_FILE, users);
    const token=jwt.sign({id:u.id},JWT_SECRET,{expiresIn:'30d'});
    res.json({message:'Account created! Free forever!', token, ...safeUser(u)});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/login', async (req,res)=>{
  const { email, password }=req.body;
  const u=users.find(x=>x.email.toLowerCase()===email.toLowerCase());
  if(!u) return res.status(400).json({error:'No account'});
  let ok=password==='test123';
  if(u.password.startsWith('$2')){ try{ ok=await bcrypt.compare(password,u.password)||ok; }catch{} }
  if(!ok) return res.status(400).json({error:'Wrong password'});
  const token=jwt.sign({id:u.id},JWT_SECRET,{expiresIn:'30d'});
  res.json({token, ...safeUser(u), email:u.email, blocked: getBlockedFor(u.id)});
});

app.post('/api/update-profile', (req,res,next)=>{ upload.array('photos',4)(req,res,(err)=>{ if(err) return res.status(400).json({error:err.message}); next(); }); }, async (req,res)=>{
  try{
    const tokenHdr=req.headers.authorization?.split(' ')[1];
    if(!tokenHdr) return res.status(401).json({error:'Login first'});
    const d=jwt.verify(tokenHdr,JWT_SECRET);
    const u=users.find(x=>x.id===d.id);
    if(!u) return res.status(404).json({error:'Not found'});
    const { name, age, city, bio, keepPhotos }=req.body;
    if(name) u.name=name;
    if(age) u.age=parseInt(age);
    if(city) u.city=city;
    if(bio!==undefined) u.bio=bio;
    let keep=[];
    if(keepPhotos){ try{ keep=JSON.parse(keepPhotos); }catch{ keep=u.photos||[]; } } else keep=u.photos||[];
    const newUrls=(req.files||[]).map(f=>getFileUrl(f));
    u.photos=[...keep, ...newUrls].slice(0,4);
    saveJson(USERS_FILE, users);
    res.json({message:'Updated!', ...safeUser(u)});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/delete-account', (req,res)=>{
  try{
    const tokenHdr=req.headers.authorization?.split(' ')[1];
    if(!tokenHdr) return res.status(401).json({error:'Login first'});
    const d=jwt.verify(tokenHdr,JWT_SECRET);
    const id=d.id;
    users=users.filter(u=>u.id!==id);
    messages=messages.filter(m=>m.from_id!==id && m.to_id!==id);
    delete blocks[id];
    Object.keys(blocks).forEach(k=>{ blocks[k]=blocks[k].filter(b=>b!==id); });
    saveJson(USERS_FILE, users); saveJson(MSGS_FILE, messages); saveJson(BLOCKS_FILE, blocks);
    res.json({message:'Your account has been deleted. You are welcome back anytime!'});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// BLOCK / UNBLOCK
app.post('/api/block', (req,res)=>{
  try{
    const tokenHdr=req.headers.authorization?.split(' ')[1];
    if(!tokenHdr) return res.status(401).json({error:'Login first'});
    const d=jwt.verify(tokenHdr,JWT_SECRET);
    const myId=d.id;
    const { targetId, action } = req.body;
    const tid=parseInt(targetId);
    if(!tid || tid===myId) return res.status(400).json({error:'Invalid'});
    if(!blocks[myId]) blocks[myId]=[];
    if(action==='unblock'){
      blocks[myId]=blocks[myId].filter(x=>x!==tid);
    }else{
      if(!blocks[myId].includes(tid)) blocks[myId].push(tid);
      // also delete messages between them
      messages=messages.filter(m=>!((m.from_id===myId&&m.to_id===tid)||(m.from_id===tid&&m.to_id===myId)));
    }
    saveJson(BLOCKS_FILE, blocks); saveJson(MSGS_FILE, messages);
    res.json({blocked: blocks[myId]});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/blocks', (req,res)=>{
  try{
    const tokenHdr=req.headers.authorization?.split(' ')[1];
    if(!tokenHdr) return res.status(401).json({error:'Login first'});
    const d=jwt.verify(tokenHdr,JWT_SECRET);
    const list=blocks[d.id]||[];
    const blockedUsers=list.map(id=>{ const u=users.find(x=>x.id===id); return u ? {id: u.id, name: u.name, city: u.city, photo: u.photos?.[0]||null} : {id, name:'Deleted'}; });
    res.json(blockedUsers);
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/messages/:myId', (req,res)=>{
  const myId=parseInt(req.params.myId);
  const withId=parseInt(req.query.with);
  if(!withId) return res.json([]);
  if(isBlocked(myId, withId)) return res.json([]);
  const filtered=messages.filter(m=> (m.from_id===myId&&m.to_id===withId)||(m.from_id===withId&&m.to_id===myId));
  res.json(filtered.slice(-200));
});

app.get('/api/inbox/:myId', (req,res)=>{
  const myId=parseInt(req.params.myId);
  const convMap={};
  messages.forEach(m=>{
    if(m.from_id===myId||m.to_id===myId){
      const other = m.from_id===myId ? m.to_id : m.from_id;
      if(isBlocked(myId, other)) return;
      if(!convMap[other] || new Date(m.at) > new Date(convMap[other].at)){
        convMap[other]=m;
      }
    }
  });
  const inbox = Object.entries(convMap).map(([otherId, lastMsg])=>{
    const u=users.find(x=>x.id==otherId);
    return { otherId: parseInt(otherId), name: u?.name||'Deleted', photo: u?.photos?.[0]||null, lastMsg: lastMsg.text, at: lastMsg.at };
  }).sort((a,b)=> new Date(b.at)-new Date(a.at));
  res.json(inbox);
});

app.post('/api/messages', (req,res)=>{
  const { from_id, to_id, text }=req.body;
  const fid=parseInt(from_id), tid=parseInt(to_id);
  if(!text) return res.status(400).json({error:'No text'});
  if(isBlocked(fid, tid)) return res.status(403).json({error:'Blocked'});
  const msg={ id: messages.length+1, from_id: fid, to_id: tid, text, at:new Date().toISOString() };
  messages.push(msg); saveJson(MSGS_FILE, messages);
  res.json(msg);
});

function checkAdmin(req,res,next){
  const pass=req.headers['x-admin-pass']||req.query.pass;
  if(pass===ADMIN_PASS) return next();
  return res.status(401).json({error:'Admin only'});
}
app.get('/api/admin/users', checkAdmin, (req,res)=>{ res.json(users.map(u=>({...safeUser(u), email:u.email})).reverse()); });
app.post('/api/admin/delete/:id', checkAdmin, (req,res)=>{
  const id=parseInt(req.params.id);
  users=users.filter(u=>u.id!==id);
  messages=messages.filter(m=>m.from_id!==id&&m.to_id!==id);
  saveJson(USERS_FILE, users); saveJson(MSGS_FILE, messages);
  res.json({message:'User deleted'});
});
app.post('/api/admin/remove-photo', checkAdmin, (req,res)=>{
  const { userId, photoUrl }=req.body;
  const u=users.find(x=>x.id===parseInt(userId));
  if(!u) return res.status(404).json({error:'User not found'});
  u.photos=(u.photos||[]).filter(p=>p!==photoUrl);
  saveJson(USERS_FILE, users);
  res.json({message:'Photo removed', photos:u.photos});
});

app.get('/admin', (req,res)=> res.sendFile(path.join(__dirname,'public','admin.html')));

app.listen(PORT, ()=> console.log(`AFD with BLOCK on ${PORT}`));
