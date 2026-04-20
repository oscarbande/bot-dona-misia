import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { HfInference } from '@huggingface/inference';
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "@langchain/core/documents";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Variables
const HF_TOKEN = process.env.HF_TOKEN || process.env.SUPERBOT || process.env.TOKEN_IA;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

let vectorStore = null;
let plantKnowledge = [];

// Buscador Manual
function normalize(text) {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function manualSearch(query) {
    const q = normalize(query);
    const matches = plantKnowledge.filter(p => 
        normalize(p.name).includes(q) || 
        p.aliases.some(a => normalize(a).includes(q)) ||
        p.uses.some(u => normalize(u).includes(u)) ||
        normalize(p.description).includes(q)
    ).slice(0, 3);

    return matches.map(plant => 
        `BOTIQUÍN: ${plant.name}. Usos: ${plant.uses.join(", ")}. Preparación: ${plant.preparation}.`
    ).join("\n\n");
}

// Inicialización
async function ensureInitialized() {
    if (plantKnowledge.length === 0) {
        try {
            const dataPath = path.join(process.cwd(), 'informacion.txt');
            if (fs.existsSync(dataPath)) {
                plantKnowledge = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            }
        } catch (e) {
            console.error("Error carge:", e.message);
        }
    }

    if (!vectorStore && HF_TOKEN && plantKnowledge.length > 0) {
        try {
            const hf = new HfInference(HF_TOKEN);
            const docs = plantKnowledge.map(p => new Document({
                pageContent: `Planta: ${p.name}. ${p.description}`,
                metadata: { id: p.id }
            }));
            const customEmbeddings = {
                embedDocuments: (texts) => hf.featureExtraction({ model: "sentence-transformers/all-MiniLM-L6-v2", inputs: texts }),
                embedQuery: (text) => hf.featureExtraction({ model: "sentence-transformers/all-MiniLM-L6-v2", inputs: text })
            };
            vectorStore = await MemoryVectorStore.fromDocuments(docs, customEmbeddings);
        } catch (e) { console.warn("RAG off:", e.message); }
    }
}

app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    try {
        await ensureInitialized();
        let context = "";
        if (vectorStore) {
            try {
                const relevantDocs = await vectorStore.similaritySearch(message, 2);
                context = relevantDocs.map(d => d.pageContent).join("\n\n");
            } catch (e) { context = manualSearch(message); }
        } else { context = manualSearch(message); }

        let finalReply = "";

        // Gemini REST
        if (GEMINI_API_KEY) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
                const isGreeting = message.length < 10 && (message.toLowerCase().includes("hola") || message.toLowerCase().includes("buenos"));
                const prompt = isGreeting 
                    ? "Eres Doña Misia, saluda amablemente."
                    : `Contexto: ${context || "general"}. Pregunta: ${message}`;

                const resp = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ contents: [{ parts: [{ text: `Eres Doña Misia. ${prompt}` }] }] })
                });
                if (resp.ok) {
                    const data = await resp.json();
                    finalReply = data.candidates[0].content.parts[0].text.trim();
                }
            } catch (e) { console.warn("Gemini falló"); }
        }

        if (!finalReply) {
             finalReply = context 
                ? `Soy Doña Misia. Aquí tienes info: \n\n${context}`
                : "Hola, ¿en qué puedo ayudarte?";
        }

        res.json({ response: finalReply });
    } catch (error) {
        res.status(500).json({ response: "Error del servidor." });
    }
});

export default app;
