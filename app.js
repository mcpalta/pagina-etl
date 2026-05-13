const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const Fuse = require("fuse.js");
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

// carpetas
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
if (!fs.existsSync("logs")) fs.mkdirSync("logs");

// comunas
const comunasValidas = JSON.parse(
  fs.readFileSync(path.join(__dirname, "comunas.json"), "utf-8")
);

// =====================
// NORMALIZACIÓN ÚNICA (CLAVE REAL)
// =====================
function normalizar(texto) {
  if (!texto) return "";

  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// =====================
// MAPA (MATCH EXACTO ULTRA RÁPIDO)
// =====================
const comunasMap = new Map();

for (const c of comunasValidas) {
  comunasMap.set(normalizar(c), c);
}

// =====================
// FUZZY (FALLBACK)
// =====================
const fuse = new Fuse(comunasValidas.map(normalizar), {
  includeScore: true,
  threshold: 0.35
});

// =====================
// FUNCIÓN FINAL DE CORRECCIÓN
// =====================
function obtenerComunaFinal(texto) {
  const norm = normalizar(texto);

  // 1. match exacto
  if (comunasMap.has(norm)) {
    return normalizar(comunasMap.get(norm));
  }

  // 2. fuzzy fallback
  const result = fuse.search(norm);

  if (result.length > 0 && result[0].score <= 0.35) {
    return result[0].item;
  }

  // 3. fallback seguro
  return norm;
}

// =====================
// FRONT
// =====================
app.get("/", (req, res) => {
  res.send(`
    <h2>ETL Comunas</h2>

    <form action="/upload" method="post" enctype="multipart/form-data">
      <input type="file" name="archivo" required />
      <button type="submit">Procesar</button>
    </form>

    <br>
    <a href="/resultados">Ver resultados</a>
  `);
});

// =====================
// ETL
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
      if (!linea?.trim()) continue;

      const original = linea.trim();
      const final = obtenerComunaFinal(original);

      if (!final) continue;

      const clave = normalizar(final);

      if (!unicos.has(clave)) {
        unicos.add(clave);
      }

      if (normalizar(original) !== clave) {
        logs.push(`${original} -> ${final}`);
      }
    }

    await collection.deleteMany({});

    const docs = [...unicos].map(nombre => ({ nombre }));

    if (docs.length > 0) {
      await collection.insertMany(docs);
    }

    fs.writeFileSync("logs/log.txt", logs.join("\n"));

    res.send(`
      <h3>Proceso terminado</h3>
      <p>Total únicos: ${docs.length}</p>
      <a href="/resultados">Ver resultados</a>
    `);

  } catch (err) {
    console.error("ERROR:", err);
    res.send("Error en el proceso");
  }
});

// =====================
// RESULTADOS
// =====================
app.get("/resultados", async (req, res) => {
  try {
    await client.connect();
    const db = client.db("etl_comunas");
    const collection = db.collection("comunas");

    const datos = await collection.find({}).sort({ nombre: 1 }).toArray();

    let html = `
      <h2>Datos limpios</h2>

      <table border="1" cellpadding="5">
        <tr><th>Comuna</th></tr>
    `;

    for (let d of datos) {
      html += `<tr><td>${d.nombre}</td></tr>`;
    }

    html += `</table>`;

    res.send(html);

  } catch (err) {
    console.error(err);
    res.send("Error al mostrar resultados");
  }
});

// =====================
app.listen(PORT, () => {
  console.log("Servidor en puerto " + PORT);
});