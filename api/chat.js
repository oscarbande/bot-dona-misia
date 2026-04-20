import fs from 'fs';
import path from 'path';

// Lógica de búsqueda manual inteligente (RAG Retrieval)
function normalize(text) {
    if (!text) return "";
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function manualSearch(query, plantKnowledge) {
    const qNormalized = normalize(query);
    const words = qNormalized.split(/\s+/).filter(w => w.length > 2);
    
    // Recuperación: Buscamos las plantas que coincidan con las palabras clave
    const matches = plantKnowledge.filter(p => {
        const pName = normalize(p.name);
        const pDesc = normalize(p.description);
        const pUses = p.uses.map(u => normalize(u)).join(" ");
        const pAliases = p.aliases.map(a => normalize(a)).join(" ");
        
        return qNormalized.includes(pName) || words.some(w => pName.includes(w) || pDesc.includes(w) || pUses.includes(w) || pAliases.includes(w));
    }).slice(0, 3);

    if (matches.length === 0) return null;

    return matches.map(plant => 
        `DOCUMENTO OFICIAL: ${plant.name}. 
         Sinónimos: ${plant.aliases.join(", ")}. 
         Usos: ${plant.uses.join(", ")}. 
         Preparación: ${plant.preparation}. 
         Descripción: ${plant.description}.`
    ).join("\n\n---\n\n");
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
        // 1. CARGA DE CONOCIMIENTO (The "Knowledge Base")
        if (cachedKnowledge.length === 0) {
            const dataPath = path.join(process.cwd(), 'informacion.txt');
            if (fs.existsSync(dataPath)) {
                cachedKnowledge = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            }
        }

        // 2. RETRIEVAL (Buscando lo relevante en el archivo)
        const context = manualSearch(message, cachedKnowledge);

        // 3. GENERATION (Llamada a Groq con protocolo RAG Estricto)
        let finalReply = "";
        
        if (GROQ_API_KEY) {
            try {
                // System Prompt Estricto: Prohibimos usar conocimiento externo
                const systemPrompt = `
Eres Doña Misia, experta en medicina natural. 
TU REGLA MÁS IMPORTANTE: Solo puedes responder usando estrictamente el CONTEXTO que se te proporciona.
- Si la planta o información NO está en el CONTEXTO, di amablemente: "M'hijo, no tengo esa información en mis libros de medicina natural".
- No inventes beneficios ni uses información de internet.
- Responde de forma amable, tradicional y breve.
                `.trim();
                
                const userPrompt = context 
                    ? `CONTEXTO EXTRAÍDO DE LOS LIBROS:\n${context}\n\nPREGUNTA DEL USUARIO: ${message}`
                    : `PREGUNTA DEL USUARIO: ${message}\n(Aviso: No se encontró información en los libros para esta consulta).`;

                // Solo llamamos a la IA si encontramos contexto, o para que la IA deniegue la respuesta
                const url = 'https://api.groq.com/openai/v1/chat/completions';
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
                            { role: 'user', content: userPrompt }
                        ],
                        temperature: 0.1, // Temperatura baja para evitar alucinaciones
                        max_tokens: 500
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    finalReply = data.choices[0].message.content.trim();
                } else {
                    console.error("Error Groq API:", await response.text());
                }
            } catch (error) {
                console.error("Error en el paso de Generación:", error.message);
            }
        }

        // 4. FALLBACK DE SEGURIDAD
        if (!finalReply) {
            finalReply = context 
                ? `Soy Doña Misia. Mi conexión está un poco lenta, pero en mis libros encontré esto:\n\n${context}`
                : "M'hijo, no he encontrado información sobre eso en mis libros de plantas medicinales por ahora.";
        }

        return res.status(200).json({ response: finalReply });

    } catch (e) {
        console.error("Error en el protocolo RAG:", e);
        return res.status(500).json({ response: "Error interno del sistema RAG de Doña Misia." });
    }
}
