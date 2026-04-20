import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { HfInference } from '@huggingface/inference';
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { Document } from "@langchain/core/documents";
// Eliminamos el SDK que da problemas de red

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 7860;

// Buscamos el token en múltiples variables posibles (priorizando el estándar HF_TOKEN)
const possibleTokenKeys = ["HF_TOKEN", "SUPERBOT", "TOKEN_IA", "HUGGINGFACE_TOKEN", "HUGGING_FACE_HUB_TOKEN"];
let HF_TOKEN = "";
let tokenKeyFound = "Ninguna";

for (const key of possibleTokenKeys) {
    if (process.env[key] && process.env[key].trim().length > 10) {
        HF_TOKEN = process.env[key].trim();
        tokenKeyFound = key;
        break;
    }
}
 
console.log(`📡 Sistema de Secretos: Variable detectada -> ${tokenKeyFound}`);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (GEMINI_API_KEY) console.log("✅ Motor Google Gemini: DETECTADO");

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- LÓGICA RAG Y CONOCIMIENTO ---
let vectorStore = null;
let plantKnowledge = [];
let initializationError = null;

// Cargamos el archivo de conocimiento una vez para tenerlo como respaldo
try {
    const dataPath = path.join(__dirname, 'informacion.txt');
    if (fs.existsSync(dataPath)) {
        const rawData = fs.readFileSync(dataPath, 'utf8');
        plantKnowledge = JSON.parse(rawData);
        console.log(`✅ Conocimiento base cargado (${plantKnowledge.length} plantas).`);
    }
} catch (e) {
    console.error("❌ Fallo al cargar informacion.txt:", e.message);
}

// BUSCADOR MANUAL (Cerebro de Respaldo - Mejorado con Normalización)
function normalize(text) {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function manualSearch(query) {
    const q = normalize(query);
    console.log(`Buscando manualmente: "${q}"`);
    
    // Filtramos con normalización para que "sabila" encuentre "Sábila"
    const matches = plantKnowledge.filter(p => 
        normalize(p.name).includes(q) || 
        p.aliases.some(a => normalize(a).includes(q)) ||
        p.uses.some(u => normalize(u).includes(q)) ||
        normalize(p.description).includes(q)
    ).slice(0, 3);

    if (matches.length === 0) {
        console.log("No se encontraron coincidencias manuales.");
        return "";
    }

    console.log(`Encontradas ${matches.length} coincidencias manuales.`);
    return matches.map(plant => 
        `BOTIQUÍN: ${plant.name}. \n- Usos: ${plant.uses.join(", ")}. \n- Preparación: ${plant.preparation}. \n- Contraindicaciones: ${plant.contraindications}`
    ).join("\n\n---\n\n");
}

// --- LÓGICA DE INICIALIZACIÓN BAJO DEMANDA ---
async function ensureInitialized() {
    // 1. Cargar conocimiento si no existe
    if (plantKnowledge.length === 0) {
        try {
            const dataPath = path.join(process.cwd(), 'informacion.txt');
            const rawData = fs.readFileSync(dataPath, 'utf8');
            plantKnowledge = JSON.parse(rawData);
            console.log("✅ Conocimiento cargado.");
        } catch (e) {
            console.error("Error cargando informacion.txt:", e.message);
        }
    }

    // 2. Intentar inicializar RAG si hay token y no está listo
    if (!vectorStore && HF_TOKEN && plantKnowledge.length > 0) {
        try {
            console.log("Inicializando RAG...");
            const hf = new HfInference(HF_TOKEN);
            const docs = plantKnowledge.map(plant => new Document({
                pageContent: `Planta: ${plant.name}. ${plant.description} Usos: ${plant.uses.join(", ")}`,
                metadata: { id: plant.id }
            }));

            const customEmbeddings = {
                embedDocuments: (texts) => hf.featureExtraction({ model: "sentence-transformers/all-MiniLM-L6-v2", inputs: texts }),
                embedQuery: (text) => hf.featureExtraction({ model: "sentence-transformers/all-MiniLM-L6-v2", inputs: text })
            };

            vectorStore = await MemoryVectorStore.fromDocuments(docs, customEmbeddings);
            console.log("✅ RAG Listo.");
        } catch (e) {
            console.warn("RAG omitido (usando modo manual):", e.message);
        }
    }
}

app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    
    try {
        // Aseguramos que todo esté cargado antes de responder
        await ensureInitialized();

        let context = "";

        // 1. BUSCADOR
        if (vectorStore) {
            try {
                const relevantDocs = await vectorStore.similaritySearch(message, 3);
                context = relevantDocs.map(d => d.pageContent).join("\n\n");
            } catch (e) {
                context = manualSearch(message);
            }
        } else {
            context = manualSearch(message);
        }

        // 2. GENERADOR DE RESPUESTA (CASCADA)
        let finalReply = "";

        // INTENTO 1: Google Gemini (REST)
        if (GEMINI_API_KEY) {
            try {
                const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
                const isGreeting = message.length < 10 && (message.toLowerCase().includes("hola") || message.toLowerCase().includes("buenos"));
                const systemPrompt = isGreeting 
                    ? `Eres Doña Misia, saluda amigablemente y ofrece tu ayuda con plantas medicinales.`
                    : `Eres Doña Misia, experta en plantas. Responde basándote en: ${context || "conocimiento general"}. Pregunta: ${message}`;

                const responseGemini = await fetch(urlGemini, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ contents: [{ parts: [{ text: systemPrompt }] }] })
                });

                if (responseGemini.ok) {
                    const dataGemini = await responseGemini.json();
                    finalReply = dataGemini.candidates[0].content.parts[0].text.trim();
                }
            } catch (e) { console.warn("Gemini falló."); }
        }

        // INTENTO 2: Hugging Face Qwen
        if (!finalReply && HF_TOKEN) {
            try {
                const responseIA = await fetch("https://api-inference.huggingface.co/v1/chat/completions", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: "Qwen/Qwen2.5-7B-Instruct",
                        messages: [
                            { role: "system", content: "Eres Doña Misia." },
                            { role: "user", content: `Contexto: ${context}\n\nPregunta: ${message}` }
                        ],
                        max_tokens: 300
                    })
                });
                if (responseIA.ok) {
                    const dataIA = await responseIA.json();
                    finalReply = dataIA.choices[0].message.content.trim();
                }
            } catch (e) { console.warn("HF falló."); }
        }

        // INTENTO 3: Manual
        if (!finalReply) {
            finalReply = context 
                ? `Soy Doña Misia. Mi conexión IA está fallando, pero encontré esto: \n\n${context}`
                : "Hola, soy Doña Misia. Pregúntame sobre la Sábila o Clavellina.";
        }

        res.json({ response: finalReply });

    } catch (error) {
        console.error(error);
        res.status(500).json({ response: "Error técnico. Inténtalo de nuevo." });
    }
});

// Para local
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
}

export default app;
