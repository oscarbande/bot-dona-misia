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
                const relevantDocs = await vectorStore.similaritySearch(message, 3);
                context = relevantDocs.map(d => d.pageContent).join("\n\n");
            } catch (e) {
                context = manualSearch(message, cachedKnowledge);
            }
        } else {
            context = manualSearch(message, cachedKnowledge);
        }

        let finalReply = "";
        let debugInfo = "";

        const systemPrompt = "Eres Doña Misia, experta en plantas paraguayas y del mundo. Responde de forma amable, corta y tradicional.";
        const fullPrompt = `Contexto: ${context || "general"}. Pregunta: ${message}`;

        // 4. CEREBRO A: Gemini
        if (GEMINI_API_KEY && !finalReply) {
            try {
                const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                const result = await model.generateContent([`${systemPrompt}\n\n${fullPrompt}`]);
                const response = await result.response;
                finalReply = response.text().trim();
                console.log("Respuesta de Gemini exitosa");
            } catch (error) {
                console.error("Gemini falló:", error.message);
                debugInfo += `[G: ${error.message.substring(0, 30)}] `;
            }
        }

        // 5. CEREBRO B: Hugging Face (Fallback de IA)
        if (HF_TOKEN && !finalReply) {
            try {
                const hf = new HfInference(HF_TOKEN);
                const response = await hf.textGeneration({
                    model: "Qwen/Qwen2.5-7B-Instruct",
                    inputs: `<|im_start|>system\n${systemPrompt}<|im_end|>\n<|im_start|>user\n${fullPrompt}<|im_end|>\n<|im_start|>assistant\n`,
                    parameters: { max_new_tokens: 250, temperature: 0.7 }
                });
                if (response && response.generated_text) {
                    finalReply = response.generated_text.split("assistant\n")[1]?.trim() || response.generated_text.trim();
                    console.log("Respuesta de Hugging Face exitosa");
                }
            } catch (error) {
                console.error("Hugging Face falló:", error.message);
                debugInfo += `[HF: ${error.message.substring(0, 30)}] `;
            }
        }

        // 6. CEREBRO C: Salida de Emergencia (Manual)
        if (!finalReply) {
            finalReply = context 
                ? `Soy Doña Misia. Mis conexiones IA están fallando ${debugInfo}, pero aquí tengo mis apuntes:\n\n${context}`
                : `Hola, soy Doña Misia. Hoy mis conexiones están un poco lentas ${debugInfo}, vuelve en un ratito.`;
        }

        return res.status(200).json({ response: finalReply });

    } catch (e) {
        console.error("Error Global:", e);
        return res.status(500).json({ response: "Error interno del sistema de Doña Misia." });
    }
}
