import fs from 'fs';
import path from 'path';
import { HfInference } from '@huggingface/inference';
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "@langchain/core/documents";

// Lógica de búsqueda manual
function normalize(text) {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function manualSearch(query, plantKnowledge) {
    const q = normalize(query);
    const matches = plantKnowledge.filter(p => 
        normalize(p.name).includes(q) || 
        p.aliases.some(a => normalize(a).includes(q)) ||
        p.uses.some(u => normalize(u).includes(q)) ||
        normalize(p.description).includes(q)
    ).slice(0, 3);

    return matches.map(plant => 
        `BOTIQUÍN: ${plant.name}. Usos: ${plant.uses.join(", ")}. Preparación: ${plant.preparation}.`
    ).join("\n\n");
}

let vectorStore = null;
let cachedKnowledge = [];

export default async function handler(req, res) {
    // Manejo de CORS manual para Vercel Functions
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { message } = req.body;
    const HF_TOKEN = process.env.HF_TOKEN || process.env.SUPERBOT || process.env.TOKEN_IA;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    try {
        // 1. Cargar conocimiento (Caching en la instancia Lambda)
        if (cachedKnowledge.length === 0) {
            const dataPath = path.join(process.cwd(), 'public', 'informacion.txt');
            if (fs.existsSync(dataPath)) {
                cachedKnowledge = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            }
        }

        // 2. Inicializar RAG si es necesario
        if (!vectorStore && HF_TOKEN && cachedKnowledge.length > 0) {
            try {
                const hf = new HfInference(HF_TOKEN);
                const docs = cachedKnowledge.map(p => new Document({
                    pageContent: `Planta: ${p.name}. ${p.description}`,
                    metadata: { id: p.id }
                }));
                const customEmbeddings = {
                    embedDocuments: (texts) => hf.featureExtraction({ model: "sentence-transformers/all-MiniLM-L6-v2", inputs: texts }),
                    embedQuery: (text) => hf.featureExtraction({ model: "sentence-transformers/all-MiniLM-L6-v2", inputs: text })
                };
                vectorStore = await MemoryVectorStore.fromDocuments(docs, customEmbeddings);
            } catch (e) {
                console.warn("RAG omitido:", e.message);
            }
        }

        // 3. Buscar contexto
        let context = "";
        if (vectorStore) {
            try {
                const relevantDocs = await vectorStore.similaritySearch(message, 2);
                context = relevantDocs.map(d => d.pageContent).join("\n\n");
            } catch (e) {
                context = manualSearch(message, cachedKnowledge);
            }
        } else {
            context = manualSearch(message, cachedKnowledge);
        }

        // 4. Generar respuesta con Gemini
        let finalReply = "";
        if (GEMINI_API_KEY) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
                const isGreeting = message.length < 10 && (message.toLowerCase().includes("hola") || message.toLowerCase().includes("buenos"));
                const prompt = isGreeting 
                    ? "Saluda amigablemente como Doña Misia."
                    : `Eres Doña Misia. Responde sobre plantas usando este contexto: ${context || "general"}. Pregunta: ${message}`;

                const resp = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                });
                if (resp.ok) {
                    const data = await resp.json();
                    finalReply = data.candidates[0].content.parts[0].text.trim();
                }
            } catch (e) {
                console.warn("Gemini falló:", e.message);
            }
        }

        // Fallback final
        if (!finalReply) {
            finalReply = context 
                ? `Soy Doña Misia. Mi conexión IA está fallando, pero encontré esto: \n\n${context}`
                : "Hola, soy el bot de Doña Misia. ¿En qué puedo ayudarte?";
        }

        return res.status(200).json({ response: finalReply });

    } catch (error) {
        console.error("Error en handler:", error);
        return res.status(500).json({ response: "Error interno del servidor." });
    }
}
