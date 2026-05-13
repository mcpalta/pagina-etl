const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const upload = multer({ dest: "uploads/" });

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
if (!fs.existsSync("logs")) fs.mkdirSync("logs");

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
function cargarCSV(pathFile) {
  const data = fs.readFileSync(pathFile, "utf-8");

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
    <h2>ETL Comparación CSV vs TXT</h2>

    <form action="/process" method="post" enctype="multipart/form-data">
      <p>Archivo TXT (datos usuario):</p>
      <input type="file" name="txt" required />

      <p>Archivo CSV (oficial):</p>
      <input type="file" name="csv" required />

      <button type="submit">Procesar</button>
    </form>
  `);
});

// =====================
// PROCESO
// =====================
app.post(
  "/process",
  upload.fields([
    { name: "txt", maxCount: 1 },
    { name: "csv", maxCount: 1 }
  ]),
  (req, res) => {
    try {
      const txtFile = req.files.txt[0];
      const csvFile = req.files.csv[0];

      const mapaOficial = cargarCSV(csvFile.path);

      const txtData = fs.readFileSync(txtFile.path, "utf-8");
      const lineas = txtData.split("\n");

      const unicos = new Set();
      const logs = [];

      for (let linea of lineas) {
        if (!linea?.trim()) continue;

        const norm = normalizar(linea);

        if (mapaOficial.has(norm)) {
          const comuna = mapaOficial.get(norm);

          if (!unicos.has(comuna.codigo)) {
            unicos.add(comuna.codigo);
          }

          if (linea.trim() !== comuna.nombre) {
            logs.push(`${linea.trim()} -> ${comuna.nombre}`);
          }
        } else {
          logs.push(`${linea.trim()} -> INVALIDA`);
        }
      }

      const resultado = [...unicos].map(codigo => codigo);

      fs.writeFileSync("logs/log.txt", logs.join("\n"));

      res.send(`
        <h3>Proceso terminado</h3>
        <p>Total comunas válidas: ${resultado.length}</p>
        <p>Revisa logs</p>
      `);

    } catch (err) {
      console.error(err);
      res.send("Error en el proceso");
    }
  }
);

// =====================
app.listen(3000, () => {
  console.log("Servidor en http://localhost:3000");
});