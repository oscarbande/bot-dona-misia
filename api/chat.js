import fs from 'fs';
import path from 'path';

// Lógica de búsqueda manual inteligente
function normalize(text) {
    if (!text) return "";
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function manualSearch(query, plantKnowledge) {
    const qNormalized = normalize(query);
    const words = qNormalized.split(/\s+/).filter(w => w.length > 2);
    
    const matches = plantKnowledge.filter(p => {
        const pName = normalize(p.name);
        const pDesc = normalize(p.description);
        const pUses = p.uses.map(u => normalize(u)).join(" ");
        return qNormalized.includes(pName) || words.some(w => pName.includes(w) || pDesc.includes(w) || pUses.includes(w));
    }).slice(0, 3);

    if (matches.length === 0) return "";

    return matches.map(plant => 
        `BOTIQUÍN: ${plant.name}. Usos: ${plant.uses.join(", ")}. Preparación: ${plant.preparation}.`
    ).join("\n\n");
}

let cachedKnowledge = [];

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { message } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    try {
        // 1. Cargar conocimiento local
        if (cachedKnowledge.length === 0) {
            const dataPath = path.join(process.cwd(), 'informacion.txt');
            if (fs.existsSync(dataPath)) {
                cachedKnowledge = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            }
        }

        // 2. Obtener Contexto de los archivos
        const context = manualSearch(message, cachedKnowledge);

        // 3. Llamada a GROQ (Motor Principal)
        let finalReply = "";
        if (GROQ_API_KEY) {
            try {
                const url = 'https://api.groq.com/openai/v1/chat/completions';
                const systemPrompt = "Eres Doña Misia, experta en plantas medicinales. Responde de forma amable, tradicional y breve. Usa el contexto proporcionado si es relevante.";
                
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${GROQ_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'llama-3.3-70b-versatile',
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: `Contexto: ${context || "general"}. Pregunta: ${message}` }
                        ],
                        temperature: 0.7,
                        max_tokens: 500
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    finalReply = data.choices[0].message.content.trim();
                } else {
                    const errorMsg = await response.text();
                    console.error("Error Groq:", errorMsg);
                }
            } catch (error) {
                console.error("Error llamando a Groq:", error.message);
            }
        }

        // 4. Fallback (Si Groq falla)
        if (!finalReply) {
            finalReply = context 
                ? `Soy Doña Misia. Mi conexión está lenta, pero encontré esto en mis libros:\n\n${context}`
                : "Hola, soy Doña Misia. Hoy estoy un poco desconectada, vuelve en un ratito.";
        }

        return res.status(200).json({ response: finalReply });

    } catch (e) {
        console.error("Error global:", e);
        return res.status(500).json({ response: "Error interno del bot." });
    }
}
