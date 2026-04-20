import fs from 'fs';
import path from 'path';
import { HfInference } from '@huggingface/inference';
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "@langchain/core/documents";
import { GoogleGenerativeAI } from "@google/generative-ai";

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

    if (matches.length === 0) return "";

    return matches.map(plant => 
        `BOTIQUÍN: ${plant.name}. Usos: ${plant.uses.join(", ")}. Preparación: ${plant.preparation}.`
    ).join("\n\n");
}

let vectorStore = null;
let cachedKnowledge = [];

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { message } = req.body;
    const HF_TOKEN = process.env.HF_TOKEN || process.env.TOKEN_IA;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    try {
        // 1. Cargar conocimiento
        if (cachedKnowledge.length === 0) {
            const dataPath = path.join(process.cwd(), 'informacion.txt');
            if (fs.existsSync(dataPath)) {
                cachedKnowledge = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            }
        }

        // 2. Inicializar RAG
        if (!vectorStore && HF_TOKEN && cachedKnowledge.length > 0) {
            try {
                const hf = new HfInference(HF_TOKEN);
                const docs = cachedKnowledge.map(p => new Document({
                    pageContent: `Planta: ${p.name}. Usos: ${p.uses.join(", ")}. ${p.description}`,
                    metadata: { id: p.id }
                }));
                const customEmbeddings = {
                    embedDocuments: (texts) => hf.featureExtraction({ model: "sentence-transformers/all-MiniLM-L6-v2", inputs: texts }),
                    embedQuery: (text) => hf.featureExtraction({ model: "sentence-transformers/all-MiniLM-L6-v2", inputs: text })
                };
                vectorStore = await MemoryVectorStore.fromDocuments(docs, customEmbeddings);
            } catch (e) {
                console.warn("RAG off:", e.message);
            }
        }

        // 3. Obtener Contexto
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

        // 4. Gemini SDK (Conector Oficial)
        let finalReply = "";
        let debugInfo = "";

        if (GEMINI_API_KEY) {
            try {
                const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

                const systemPrompt = "Eres Doña Misia, experta en plantas. Responde de forma amable y tradicional.";
                const prompt = `Contexto: ${context || "general"}. Pregunta: ${message}`;
                
                const result = await model.generateContent([`${systemPrompt}\n\n${prompt}`]);
                const response = await result.response;
                finalReply = response.text().trim();
            } catch (error) {
                console.error("Gemini SDK Error:", error);
                debugInfo = `(Error SDK: ${error.message.substring(0, 50)})`;
            }
        } else {
            debugInfo = "(Error: No se detectó GEMINI_API_KEY)";
        }

        // 5. Salida
        if (!finalReply) {
            finalReply = context 
                ? `Soy Doña Misia. Mi conexión IA está fallando ${debugInfo}, pero en mis libros dice: \n\n${context}`
                : `Hola, soy Doña Misia. Hoy estoy un poco desconectada ${debugInfo}, vuelve a intentarlo en un ratito.`;
        }

        return res.status(200).json({ response: finalReply });

    } catch (e) {
        return res.status(500).json({ response: "Error interno de Doña Misia." });
    }
}
