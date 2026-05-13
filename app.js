const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const app = express();
const upload = multer({ dest: "uploads/" });

const PORT = process.env.PORT || 3000;
const uri = process.env.MONGO_URI;

if (!uri) {
  console.error("ERROR: MONGO_URI no está definida");
  process.exit(1);
}

const client = new MongoClient(uri);

// =====================
// CARPETAS
// =====================
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

// =====================
// NORMALIZACIÓN
// =====================
function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// =====================
// CARGAR CSV OFICIAL
// =====================
function cargarCSV(filePath) {
  const data = fs.readFileSync(filePath, "utf-8");
  const lines = data.split("\n").filter(Boolean);

  const map = new Map();

  for (let i = 1; i < lines.length; i++) {
    const [codigo, nombre] = lines[i].split(",");

    if (!codigo || !nombre) continue;

    map.set(normalizar(nombre), {
      codigo: codigo.trim(),
      nombre: nombre.trim()
    });
  }

  return map;
}

// =====================
// FRONT
// =====================
app.get("/", (req, res) => {
  res.send(`
    <h2>ETL Comunas Completo</h2>

    <form action="/process" method="post" enctype="multipart/form-data">
      <p>Archivo TXT (datos sucios)</p>
      <input type="file" name="txt" required />

      <p>Archivo CSV (comunas oficiales)</p>
      <input type="file" name="csv" required />

      <button type="submit">Procesar</button>
    </form>

    <br>
    <a href="/resultados">Ver resultados</a>
  `);
});

// =====================
// PROCESO ETL
// =====================
app.post(
  "/process",
  upload.fields([
    { name: "txt", maxCount: 1 },
    { name: "csv", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const txtFile = req.files.txt[0];
      const csvFile = req.files.csv[0];

      const mapaOficial = cargarCSV(csvFile.path);

      const txtData = fs.readFileSync(txtFile.path, "utf-8");
      const lineas = txtData.split("\n");

      const unicos = new Map();
      const logs = [];

      await client.connect();
      const db = client.db("etl_comunas");

      const collection = db.collection("comunas");
      const logCollection = db.collection("logs");

      for (let linea of lineas) {
        if (!linea?.trim()) continue;

        const norm = normalizar(linea);

        if (mapaOficial.has(norm)) {
          const comuna = mapaOficial.get(norm);

          if (!unicos.has(comuna.codigo)) {
            unicos.set(comuna.codigo, comuna);
          }

          logs.push({
            original: linea.trim(),
            resultado: comuna.nombre,
            estado: "CORREGIDO"
          });

        } else {
          logs.push({
            original: linea.trim(),
            resultado: null,
            estado: "INVALIDO"
          });
        }
      }

      // =====================
      // GUARDAR LIMPIOS
      // =====================
      await collection.deleteMany({});
      await collection.insertMany([...unicos.values()]);

      // =====================
      // GUARDAR LOGS EN MONGO
      // =====================
      await logCollection.insertMany(logs);

      res.send(`
        <h3>Proceso terminado</h3>
        <p>Comunas válidas: ${unicos.size}</p>
        <a href="/resultados">Ver resultados</a>
      `);

    } catch (err) {
      console.error(err);
      res.send("Error en el proceso");
    }
  }
);

// =====================
// RESULTADOS LIMPIOS
// =====================
app.get("/resultados", async (req, res) => {
  try {
    await client.connect();
    const db = client.db("etl_comunas");

    const data = await db.collection("comunas")
      .find({})
      .sort({ nombre: 1 })
      .toArray();

    let html = `
      <h2>Datos limpios</h2>
      <table border="1">
        <tr><th>Código</th><th>Comuna</th></tr>
    `;

    for (let d of data) {
      html += `<tr><td>${d.codigo}</td><td>${d.nombre}</td></tr>`;
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