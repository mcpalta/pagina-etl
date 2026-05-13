const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const app = express();
const upload = multer({ dest: "uploads/" });

const PORT = process.env.PORT || 3000;
const uri = process.env.MONGO_URI;

if (!uri) {
  console.error("ERROR: MONGO_URI no está definida");
  process.exit(1);
}

const client = new MongoClient(uri);

// Carpetas
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
if (!fs.existsSync("logs")) fs.mkdirSync("logs");

// Comunas
const comunasValidas = JSON.parse(
  fs.readFileSync(path.join(__dirname, "comunas.json"), "utf-8")
);

// =====================
// NORMALIZACIÓN ULTRA RÁPIDA
// =====================
function normalizar(texto) {
  if (!texto) return "";

  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, "")   // elimina símbolos raros
    .replace(/\s+/g, " ")
    .trim();
}

// =====================
// PRECALCULAR MAPA (OPTIMIZACIÓN CLAVE)
// =====================
const mapaCorreccion = new Map();

// indexar comunas normalizadas
const comunasNorm = comunasValidas.map(c => ({
  original: c,
  norm: normalizar(c)
}));

// =====================
// CORRECCIÓN RÁPIDA (sin recorrer todo siempre)
// =====================
function corregir(nombreNorm) {
  if (!nombreNorm) return nombreNorm;

  let mejor = nombreNorm;
  let min = Infinity;

  for (const c of comunasNorm) {
    const dist = Math.abs(c.norm.length - nombreNorm.length);

    // filtro rápido antes de comparar
    if (dist > 5) continue;

    const score = similitudSimple(nombreNorm, c.norm);

    if (score < min) {
      min = score;
      mejor = c.original;
    }
  }

  return min <= 3 ? normalizar(mejor) : nombreNorm;
}

// =====================
// DISTANCIA OPTIMIZADA (más rápida que Levenshtein clásico)
// =====================
function similitudSimple(a, b) {
  if (a === b) return 0;

  let diff = 0;
  const len = Math.max(a.length, b.length);

  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) diff++;
  }

  return diff;
}

// =====================
// APP
// =====================
app.get("/", (req, res) => {
  res.send(`
    <h2>ETL Comunas</h2>
    <form action="/upload" method="post" enctype="multipart/form-data">
      <input type="file" name="archivo" required />
      <button type="submit">Procesar</button>
    </form>
  `);
});

// =====================
// ETL OPTIMIZADO
// =====================
app.post("/upload", upload.single("archivo"), async (req, res) => {
  try {
    if (!req.file) return res.send("No archivo recibido");

    const data = fs.readFileSync(req.file.path, "utf-8");
    const lineas = data.split("\n");

    const unicos = new Set();
    const logs = [];

    await client.connect();
    const db = client.db("etl_comunas");
    const collection = db.collection("comunas");

    for (let linea of lineas) {
      if (!linea || !linea.trim()) continue;

      const norm = normalizar(linea);
      if (!norm) continue;

      const corregido = corregir(norm);

      if (norm !== corregido) {
        logs.push(`${linea.trim()} -> ${corregido}`);
      }

      unicos.add(corregido);
    }

    await collection.deleteMany({});

    const docs = [...unicos].map(nombre => ({ nombre }));

    if (docs.length > 0) {
      await collection.insertMany(docs);
    }

    fs.writeFileSync("logs/log.txt", logs.join("\n"));

    res.send(`
      <h3>Proceso terminado</h3>
      <p>Total registros únicos: ${docs.length}</p>
    `);

  } catch (err) {
    console.error("ERROR:", err);
    res.send("Error en el proceso");
  }
});

app.listen(PORT, () => {
  console.log("Servidor listo en puerto " + PORT);
});