import fs from 'fs';
import path from 'path';
import { HfInference } from '@huggingface/inference';
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "@langchain/core/documents";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Lógica de búsqueda manual MEJORADA (Tokenizada para encontrar palabras sueltas)
function normalize(text) {
    if (!text) return "";
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function manualSearch(query, plantKnowledge) {
    const qNormalized = normalize(query);
    const words = qNormalized.split(/\s+/).filter(w => w.length > 2); // Palabras clave de más de 2 letras
    
    const matches = plantKnowledge.filter(p => {
        const pName = normalize(p.name);
        const pDesc = normalize(p.description);
        const pUses = p.uses.map(u => normalize(u)).join(" ");
        const pAliases = p.aliases.map(a => normalize(a)).join(" ");
        
        // Verifica si el nombre de la planta está en la consulta O si alguna palabra de la consulta está en la planta
        return qNormalized.includes(pName) || words.some(w => pName.includes(w) || pDesc.includes(w) || pUses.includes(w) || pAliases.includes(w));
    }).slice(0, 3);

    if (matches.length === 0) return "";

    return matches.map(plant => 
        `BOTIQUÍN: ${plant.name}. Usos: ${plant.uses.join(", ")}. Preparación: ${plant.preparation}.`
    ).join("\n\n");
}

let vectorStore = null;
let cachedKnowledge = [];

export default async function handler(req, res) {
    // CORS manual para Vercel
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { message } = req.body;
    const HF_TOKEN = process.env.HF_TOKEN || process.env.TOKEN_IA;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    try {
        // 1. Cargar conocimiento (Con ruta absoluta robusta para Vercel)
        if (cachedKnowledge.length === 0) {
            const dataPath = path.join(process.cwd(), 'informacion.txt');
            if (fs.existsSync(dataPath)) {
                cachedKnowledge = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            }
        }

        // 2. Obtener Contexto Manual (Pre-calculado por si falla la IA)
        const manualContext = manualSearch(message, cachedKnowledge);

        // 3. Inicializar RAG (Solo si el token está presente)
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
                console.warn("RAG omitido por error de conexión:", e.message);
            }
        }

        // 4. Búsqueda Vectorial
        let vectorContext = "";
        if (vectorStore) {
            try {
                const relevantDocs = await vectorStore.similaritySearch(message, 2);
                vectorContext = relevantDocs.map(d => d.pageContent).join("\n\n");
            } catch (e) {
                console.warn("Búsqueda vectorial falló");
            }
        }

        // Contexto final combinado
        const finalContext = vectorContext || manualContext;

        let finalReply = "";
        let debugInfo = "";

        const systemPrompt = "Eres Doña Misia, experta en plantas. Responde de forma amable, corta y tradicional.";
        const fullPrompt = `Contexto: ${finalContext || "general"}. Pregunta: ${message}`;

        // 5. INTENTO 1: Google Gemini (Conector oficial)
        if (GEMINI_API_KEY && !finalReply) {
            try {
                const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                const result = await model.generateContent([`${systemPrompt}\n\n${fullPrompt}`]);
                const response = await result.response;
                finalReply = response.text().trim();
            } catch (error) {
                console.error("Gemini falló:", error.message);
                debugInfo += `[G: ${error.message.substring(0, 30)}] `;
            }
        }

        // 6. INTENTO 2: Hugging Face (IA de Respaldo)
        if (HF_TOKEN && !finalReply) {
            try {
                const hf = new HfInference(HF_TOKEN);
                const response = await hf.textGeneration({
                    model: "Qwen/Qwen2.5-7B-Instruct",
                    inputs: `<|im_start|>system\n${systemPrompt}<|im_end|>\n<|im_start|>user\n${fullPrompt}<|im_end|>\n<|im_start|>assistant\n`,
                    parameters: { max_new_tokens: 300, temperature: 0.7 }
                });
                if (response && response.generated_text) {
                    finalReply = response.generated_text.split("assistant\n")[1]?.trim() || response.generated_text.trim();
                }
            } catch (error) {
                console.error("HF falló:", error.message);
                debugInfo += `[HF: ${error.message.substring(0, 25)}] `;
            }
        }

        // 7. RESPALDO FINAL: Manual (Siempre disponible)
        if (!finalReply) {
            if (manualContext) {
                finalReply = `Soy Doña Misia. Mi conexión con la nube está lenta ${debugInfo}, pero en mis libros dice:\n\n${manualContext}\n\n¿Te sirve esto, m'hijo?`;
            } else {
                finalReply = `Hola, soy Doña Misia. Hoy mis conexiones están un poco lentas ${debugInfo}, pero pregúntame por plantas como Sábila o Eucalipto y te ayudo con mis libros.`;
            }
        }

        return res.status(200).json({ response: finalReply });

    } catch (e) {
        console.error("Error Global:", e);
        return res.status(500).json({ response: "Error del servidor de Doña Misia." });
    }
}
