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
// CORRECCIÓN SIMPLE Y RÁPIDA
// =====================
function similitud(a, b) {
  let diff = 0;
  const len = Math.max(a.length, b.length);

  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) diff++;
  }

  return diff;
}

function corregir(nombre) {
  let mejor = nombre;
  let min = Infinity;

  for (let c of comunasValidas) {
    const n = normalizar(c);
    const dist = similitud(nombre, n);

    if (dist < min) {
      min = dist;
      mejor = n;
    }
  }

  return min <= 3 ? mejor : nombre;
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
    if (!req.file) return res.send("No archivo");

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
// RESULTADOS WEB (TABLA + BÚSQUEDA)
// =====================
app.get("/resultados", async (req, res) => {
  try {
    await client.connect();
    const db = client.db("etl_comunas");
    const collection = db.collection("comunas");

    const datos = await collection.find({}).sort({ nombre: 1 }).toArray();

    let html = `
      <h2>Datos limpios</h2>

      <input type="text" id="buscador" placeholder="Buscar comuna..." onkeyup="filtrar()" />

      <table border="1" cellpadding="5" id="tabla">
        <tr><th>Comuna</th></tr>
    `;

    for (let d of datos) {
      html += `<tr><td>${d.nombre}</td></tr>`;
    }

    html += `
      </table>

      <br>
      <a href="/exportar">Descargar CSV</a>

      <script>
        function filtrar() {
          const input = document.getElementById("buscador");
          const filter = input.value.toLowerCase();
          const rows = document.querySelectorAll("#tabla tr");

          for (let i = 1; i < rows.length; i++) {
            const txt = rows[i].innerText.toLowerCase();
            rows[i].style.display = txt.includes(filter) ? "" : "none";
          }
        }
      </script>
    `;

    res.send(html);

  } catch (err) {
    console.error(err);
    res.send("Error al mostrar resultados");
  }
});

// =====================
// EXPORT CSV
// =====================
app.get("/exportar", async (req, res) => {
  try {
    await client.connect();
    const db = client.db("etl_comunas");
    const collection = db.collection("comunas");

    const datos = await collection.find({}).toArray();

    let csv = "comuna\n";

    for (let d of datos) {
      csv += `${d.nombre}\n`;
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=comunas.csv");

    res.send(csv);

  } catch (err) {
    console.error(err);
    res.send("Error exportando CSV");
  }
});

// =====================
app.listen(PORT, () => {
  console.log("Servidor en puerto " + PORT);
});