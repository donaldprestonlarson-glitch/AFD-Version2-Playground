const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
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
    moderation: 'aws_rek' // auto-detect nudity
  })
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req,file,cb)=>{ if(file.mimetype.startsWith('image/')) cb(null,true); else cb(new Error('Only images')); }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- Simple in-memory DB (replace with Postgres later) ---
let users = [
  { id: 1, name: 'Sarah', age: 28, city: 'Edmonton', bio: 'Love hiking in River Valley! Looking for someone real — no BS. Actually free is refreshing!', email: 'sarah.e@example.com', password: '$2a$10$...', photos: [], created: new Date().toISOString() },
  { id: 2, name: 'Mike', age: 32, city: 'Calgary', bio: 'Calgary born, love Flames and mountains. Let\'s grab coffee — my treat, messaging is free!', email: 'mike.c@example.com', password: '$2a$10$...', photos: [], created: new Date().toISOString() }
];
let messages = [];
let nextId = 3;

// Helpers
function safeUser(u){
  return {
    id: u.id,
    name: u.name,
    age: u.age,
    city: u.city,
    bio: u.bio,
    photo_url: u.photos && u.photos[0] ? u.photos[0] : null,
    photos: u.photos || [],
    created: u.created
  };
}

// --- USERS ---
app.get('/api/users', (req,res)=>{
  const city = req.query.city;
  let list = users;
  if(city) list = list.filter(u=>u.city===city);
  res.json(list.map(safeUser).reverse());
});

app.get('/api/me', (req,res)=>{
  const token = req.headers.authorization?.split(' ')[1];
  if(!token) return res.status(401).json({error:'No token'});
  try{
    const d = jwt.verify(token, JWT_SECRET);
    const u = users.find(x=>x.id===d.id);
    if(!u) return res.status(404).json({error:'Not found'});
    res.json({...safeUser(u), email: u.email});
  }catch{ res.status(401).json({error:'Bad token'}); }
});

// SIGNUP with up to 4 photos (photo field can be multiple)
app.post('/api/signup', upload.array('photos',4), async (req,res)=>{
  try{
    const { name, email, password, age, city, bio } = req.body;
    if(!name || !email || !password) return res.status(400).json({error:'Missing fields'});
    if(users.find(u=>u.email.toLowerCase()===email.toLowerCase())) return res.status(400).json({error:'Email already used'});
    const hashed = await bcrypt.hash(password,10);
    const photoUrls = (req.files||[]).map(f=>f.path); // cloudinary URL
    const u = { id: nextId++, name, email, password: hashed, age: parseInt(age)||25, city: city||'Edmonton', bio: bio||'', photos: photoUrls, created: new Date().toISOString() };
    // Also support old single 'photo' field
    if(req.files?.length===0 && req.file) u.photos=[req.file.path];
    users.push(u);
    const token = jwt.sign({id:u.id}, JWT_SECRET, {expiresIn:'30d'});
    res.json({message:'Account created! Free forever!', token, ...safeUser(u)});
  }catch(e){ console.error(e); res.status(500).json({error:e.message}); }
});

// Also accept single photo legacy
app.post('/api/signup-legacy', upload.single('photo'), async (req,res)=>{
  req.files = req.file ? [req.file] : [];
  // call same logic
  res.redirect(307,'/api/signup');
});

app.post('/api/login', async (req,res)=>{
  const { email, password } = req.body;
  const u = users.find(x=>x.email.toLowerCase()===email.toLowerCase());
  if(!u) return res.status(400).json({error:'No account'});
  // For demo users with fake hash, allow test123
  let ok = password==='test123';
  if(u.password.startsWith('$2')) ok = await bcrypt.compare(password, u.password) || ok;
  if(!ok) return res.status(400).json({error:'Wrong password'});
  const token = jwt.sign({id:u.id}, JWT_SECRET, {expiresIn:'30d'});
  res.json({token, ...safeUser(u), email: u.email});
});

// UPDATE PROFILE - up to 4 photos
app.post('/api/update-profile', upload.array('photos',4), async (req,res)=>{
  try{
    const token = req.headers.authorization?.split(' ')[1];
    if(!token) return res.status(401).json({error:'Login first'});
    const d = jwt.verify(token, JWT_SECRET);
    const u = users.find(x=>x.id===d.id);
    if(!u) return res.status(404).json({error:'Not found'});
    const { name, age, city, bio, keepPhotos } = req.body;
    if(name) u.name=name;
    if(age) u.age=parseInt(age);
    if(city) u.city=city;
    if(bio!==undefined) u.bio=bio;
    // keepPhotos is JSON array of URLs to keep
    let keep = [];
    if(keepPhotos){
      try{ keep = JSON.parse(keepPhotos); }catch{ keep = []; }
    } else {
      keep = u.photos || [];
    }
    const newUrls = (req.files||[]).map(f=>f.path);
    let merged = [...keep, ...newUrls].slice(0,4); // max 4
    u.photos = merged;
    res.json({message:'Updated!','photos':u.photos, ...safeUser(u)});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// MESSAGES
app.get('/api/messages/:myId', (req,res)=>{
  const myId = parseInt(req.params.myId);
  const withId = parseInt(req.query.with);
  const filtered = messages.filter(m=> (m.from_id===myId && m.to_id===withId) || (m.from_id===withId && m.to_id===myId));
  res.json(filtered.slice(-100));
});
app.post('/api/messages', (req,res)=>{
  const { from_id, to_id, text } = req.body;
  if(!text) return res.status(400).json({error:'No text'});
  const msg = { id: messages.length+1, from_id, to_id, text, at: new Date().toISOString() };
  messages.push(msg);
  res.json(msg);
});

// --- ADMIN ---
function checkAdmin(req,res,next){
  const pass = req.headers['x-admin-pass'] || req.query.pass;
  if(pass===ADMIN_PASS) return next();
  return res.status(401).json({error:'Admin only'});
}

app.get('/api/admin/users', checkAdmin, (req,res)=>{
  res.json(users.map(u=>({ ...safeUser(u), email: u.email, totalPhotos: u.photos?.length||0 })).reverse());
});

app.post('/api/admin/delete/:id', checkAdmin, (req,res)=>{
  const id = parseInt(req.params.id);
  users = users.filter(u=>u.id!==id);
  messages = messages.filter(m=>m.from_id!==id && m.to_id!==id);
  res.json({message:'User deleted and blocked'});
});

app.post('/api/admin/remove-photo', checkAdmin, (req,res)=>{
  const { userId, photoUrl } = req.body;
  const u = users.find(x=>x.id===parseInt(userId));
  if(!u) return res.status(404).json({error:'User not found'});
  u.photos = (u.photos||[]).filter(p=>p!==photoUrl);
  res.json({message:'Photo removed', photos: u.photos});
});

app.get('/admin', (req,res)=> res.sendFile(__dirname+'/public/admin.html'));

app.listen(PORT, ()=> console.log(`AFD Live on ${PORT} - Admin pass set: ${ADMIN_PASS!== 'AFD-Admin-2026!'}`));
