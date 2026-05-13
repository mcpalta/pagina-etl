const express = require("express");
const multer = require("multer");
const fs = require("fs");
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

let db;

// =====================
// CONEXIÓN MONGO
// =====================
async function connectDB() {
  if (!db) {
    await client.connect();
    db = client.db("etl_comunas");
  }
  return db;
}

// =====================
// NORMALIZACIÓN (CLAVE)
// =====================
function normalizar(texto) {
  return texto
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // tildes
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// =====================
// CARGAR CSV OFICIAL (ROBUSTO)
// =====================
function cargarCSV(filePath) {
  const data = fs.readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");

  const lines = data.split("\n").filter(l => l.trim());

  const map = new Map();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    let parts;

    if (line.includes("\t")) {
      parts = line.split("\t");
    } else if (line.includes(";")) {
      parts = line.split(";");
    } else {
      parts = line.split(",");
    }

    const codigo = parts[0]?.trim();
    const nombre = parts.slice(1).join(" ").trim();

    if (!codigo || !nombre) continue;

    map.set(normalizar(nombre), {
      codigo,
      nombre
    });
  }

  return map;
}

// =====================
// FRONT
// =====================
app.get("/", (req, res) => {
  res.send(`
    <h2>ETL Comunas</h2>

    <form action="/process" method="post" enctype="multipart/form-data">
      <p>TXT (datos sucios)</p>
      <input type="file" name="txt" required />

      <p>CSV (oficial)</p>
      <input type="file" name="csv" required />

      <button type="submit">Procesar</button>
    </form>
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
      if (!req.files?.txt || !req.files?.csv) {
        return res.send("Faltan archivos");
      }

      const txtFile = req.files.txt[0];
      const csvFile = req.files.csv[0];

      const mapaOficial = cargarCSV(csvFile.path);

      const txtData = fs.readFileSync(txtFile.path, "utf-8");
      const lineas = txtData.split("\n");

      const unicos = new Map();
      const logs = [];

      const db = await connectDB();

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

      const comunasFinales = [...unicos.values()];

      // =====================
      // MONGO SAFE INSERT
      // =====================
      await db.collection("comunas").deleteMany({});

      if (comunasFinales.length > 0) {
        await db.collection("comunas").insertMany(comunasFinales);
      }

      if (logs.length > 0) {
        await db.collection("logs").insertMany(logs);
      }

      res.send(`
        <h3>Proceso terminado</h3>
        <p>Comunas válidas: ${comunasFinales.length}</p>
        <p>Total procesadas: ${logs.length}</p>
      `);

    } catch (err) {
      console.error("ERROR REAL:", err);
      res.send("Error en el proceso (revisa consola)");
    }
  }
);

// =====================
// VER RESULTADOS
// =====================
app.get("/resultados", async (req, res) => {
  try {
    const db = await connectDB();

    const data = await db.collection("comunas")
      .find({})
      .sort({ nombre: 1 })
      .toArray();

    let html = "<h2>Datos limpios</h2><table border='1'><tr><th>Código</th><th>Comuna</th></tr>";

    for (let d of data) {
      html += `<tr><td>${d.codigo}</td><td>${d.nombre}</td></tr>`;
    }

    html += "</table>";

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