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

// Crear carpetas si no existen
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
if (!fs.existsSync("logs")) fs.mkdirSync("logs");

// Cargar comunas
const comunasValidas = JSON.parse(
  fs.readFileSync(path.join(__dirname, "comunas.json"), "utf-8")
);

// Limpiar texto
function limpiarTexto(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// Distancia Levenshtein
function distancia(a, b) {
  const dp = Array.from({ length: b.length + 1 }, () => []);

  for (let i = 0; i <= b.length; i++) dp[i][0] = i;
  for (let j = 0; j <= a.length; j++) dp[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j - 1] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j] + 1
        );
      }
    }
  }

  return dp[b.length][a.length];
}

// Corrección semántica
function corregir(nombre) {
  let mejor = nombre;
  let min = Infinity;

  for (let comuna of comunasValidas) {
    const d = distancia(nombre, comuna);
    if (d < min) {
      min = d;
      mejor = comuna;
    }
  }

  return min <= 3 ? mejor : nombre;
}

// Página principal
app.get("/", (req, res) => {
  res.send(`
    <h2>ETL Comunas Online</h2>
    <form action="/upload" method="post" enctype="multipart/form-data">
      <input type="file" name="archivo" required />
      <button type="submit">Procesar</button>
    </form>
  `);
});

// Proceso ETL
app.post("/upload", upload.single("archivo"), async (req, res) => {
  try {
    const data = fs.readFileSync(req.file.path, "utf-8");
    const lineas = data.split("\n");

    let unicos = new Set();
    let logs = [];

    for (let linea of lineas) {
      if (!linea.trim()) continue;

      const original = linea.trim();
      const limpio = limpiarTexto(original);
      const corregido = corregir(limpio);

      if (original !== corregido) {
        logs.push(`${original} -> ${corregido}`);
      }

      unicos.add(corregido);
    }

    await client.connect();
    const db = client.db("etl_comunas");
    const collection = db.collection("comunas");

    await collection.deleteMany({});

    const docs = Array.from(unicos).map(nombre => ({
      nombre
    }));

    await collection.insertMany(docs);

    fs.writeFileSync("logs/log.txt", logs.join("\n"));

    res.send(`
      <h3>Proceso terminado</h3>
      <p>Total registros únicos: ${docs.length}</p>
      <p>Proceso ETL ejecutado correctamente</p>
    `);

  } catch (err) {
    console.error(err);
    res.send("Error en el proceso");
  }
});

app.listen(PORT, () => {
  console.log("Servidor listo en puerto " + PORT);
});