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
// NORMALIZACIÓN
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
// FUSE.JS (BÚSQUEDA INTELIGENTE)
// =====================
const fuse = new Fuse(comunasValidas.map(normalizar), {
  includeScore: true,
  threshold: 0.4
});

function corregir(nombre) {
  const resultado = fuse.search(nombre);

  if (resultado.length > 0 && resultado[0].score <= 0.4) {
    return resultado[0].item;
  }

  return nombre;
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

      const norm = normalizar(linea);
      if (!norm) continue;

      const corr = corregir(norm);

      if (norm !== corr) {
        logs.push(`${linea.trim()} -> ${corr}`);
      }

      unicos.add(corr);
    }

    await collection.deleteMany({});

    const docs = [...unicos].map(nombre => ({ nombre }));
    if (docs.length > 0) await collection.insertMany(docs);

    fs.writeFileSync("logs/log.txt", logs.join("\n"));

    res.send(`
      <h3>Proceso terminado</h3>
      <p>Total únicos: ${docs.length}</p>
      <a href="/resultados">Ver resultados</a>
    `);

  } catch (err) {
    console.error(err);
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
    res.send("Error");
  }
});

// =====================
app.listen(PORT, () => {
  console.log("Servidor en puerto " + PORT);
});