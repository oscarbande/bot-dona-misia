import fs from 'fs';
import path from 'path';
import { HfInference } from '@huggingface/inference';
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "@langchain/core/documents";

// Lógica de búsqueda manual con normalización mejorada
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
    const HF_TOKEN = process.env.HF_TOKEN || process.env.SUPERBOT || process.env.TOKEN_IA;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    try {
        // 1. Cargar conocimiento
        if (cachedKnowledge.length === 0) {
            const dataPath = path.join(process.cwd(), 'informacion.txt');
            if (fs.existsSync(dataPath)) {
                cachedKnowledge = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            } else {
                console.error("CRÍTICO: No se encontró informacion.txt");
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
                console.log("RAG inicializado correctamente");
            } catch (e) {
                console.warn("RAG omitido por error:", e.message);
            }
        }

        // 3. Obtener Contexto
        let context = "";
        if (vectorStore) {
            try {
                const relevantDocs = await vectorStore.similaritySearch(message, 3);
                context = relevantDocs.map(d => d.pageContent).join("\n\n");
            } catch (e) {
                console.warn("Búsqueda vectorial falló, usando manual");
                context = manualSearch(message, cachedKnowledge);
            }
        } else {
            context = manualSearch(message, cachedKnowledge);
        }

        // 4. Inteligencia Artificial (Gemini)
        let finalReply = "";
        if (GEMINI_API_KEY) {
            try {
                const isGreeting = (message.length < 15 && /hola|buenos|buenas|que tal|como estás/i.test(normalize(message)));
                
                const systemPrompt = "Eres Doña Misia, una experta en plantas medicinales de Paraguay y el mundo. Hablas de forma amable, cercana y tradicional.";
                const contextPrompt = context 
                    ? `Usa esta información para responder: ${context}` 
                    : "Responde de forma general sobre plantas medicinales si no tienes contexto específico.";
                
                const fullPrompt = isGreeting 
                    ? "Saluda amablemente como Doña Misia y ofrece tu ayuda con plantas medicinales."
                    : `${systemPrompt}\n\nContexto: ${contextPrompt}\n\nPregunta del usuario: ${message}`;

                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
                
                const response = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: fullPrompt }] }],
                        generationConfig: { temperature: 0.7, maxOutputTokens: 500 }
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
                        finalReply = data.candidates[0].content.parts[0].text.trim();
                    }
                } else {
                    const errorBody = await response.text();
                    console.error(`Gemini API Error (${response.status}):`, errorBody);
                }
            } catch (error) {
                console.error("Error de red llamando a Gemini:", error.message);
            }
        } else {
            console.warn("ADVERTENCIA: GEMINI_API_KEY no detectada");
        }

        // 5. Salida de Emergencia (Si Gemini falla pero tenemos contexto)
        if (!finalReply) {
            if (context) {
                finalReply = `Soy Doña Misia. Mi conexión con la nube está un poco lenta, pero en mis libros encontré esto sobre tu consulta:\n\n${context}\n\n¿Te sirve esta información, m'hijo?`;
            } else {
                finalReply = "Hola, soy Doña Misia. Por ahora mis libritos están cerrados y no puedo responderte bien, pero vuelve a intentarlo en un ratito, ¿sí?";
            }
        }

        return res.status(200).json({ response: finalReply });

    } catch (e) {
        console.error("FALLO GENERAL DEL HANDLER:", e);
        return res.status(500).json({ response: "Lo siento, Doña Misia tiene un problema técnico ahora mismo." });
    }
}
