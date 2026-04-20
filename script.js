// ===== DATA: PLANTAS MEDICINALES (Cargada dinámicamente) =====
// Intentamos usar los datos cargados por informacion.js como base inicial
let plantsData = window.plantsData || [];

// Función para cargar los datos desde el archivo .txt (formato JSON)
async function loadPlantsData() {
    try {
        const response = await fetch('informacion.txt');
        if (response.ok) {
            const newData = await response.json();
            if (newData && newData.length > 0) {
                plantsData = newData;
                console.log('Datos actualizados desde informacion.txt');
            }
        } else {
            console.warn('No se pudo acceder a informacion.txt, manteniendo datos de respaldo.');
        }
    } catch (error) {
        console.warn('Modo local o error de red detectado. Manteniendo datos de informacion.js');
    }
}

// ===== RENDER CATALOG =====
function renderCatalog() {
    const grid = document.getElementById('plantsGrid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    if (plantsData.length === 0) {
        grid.innerHTML = '<p class="error-msg">No se pudo cargar la información del catálogo. Por favor, intenta más tarde.</p>';
        return;
    }

    plantsData.forEach(plant => {
        const card = document.createElement('div');
        card.className = 'plant-card-wrapper';
        
        card.innerHTML = `
            <div class="plant-card">
                <!-- FRONT OF CARD -->
                <div class="plant-front">
                    <span class="plant-badge">${plant.badge}</span>
                    <div class="plant-image-container">
                        <img src="${plant.img}" alt="${plant.name}">
                        <div class="front-content">
                            <h3>${plant.name}</h3>
                            <span class="hint"><i class="fa-solid fa-rotate"></i> Voltea para ver detalles</span>
                        </div>
                    </div>
                </div>

                <!-- BACK OF CARD -->
                <div class="plant-back">
                    <h3 class="plant-title">${plant.name}</h3>
                    <p class="plant-sciname">${plant.scientificName}</p>
                    
                    <div class="plant-details">
                        <p class="plant-desc">${plant.description}</p>
                        
                        <div class="info-box">
                            <h4><i class="fa-solid fa-mug-saucer"></i> Preparación</h4>
                            <p>${plant.preparation}</p>
                        </div>
                        
                        <div class="info-box alert">
                            <h4><i class="fa-solid fa-triangle-exclamation"></i> Contraindicaciones</h4>
                            <p>${plant.contraindications}</p>
                        </div>
                    </div>

                    <div class="plant-uses">
                        ${plant.uses.map(use => `<span class="use-tag">${use}</span>`).join('')}
                    </div>
                </div>
            </div>
        `;
        
        grid.appendChild(card);
    });
}

// ===== CHATBOT LOGIC =====

// Remove accents to simplify search
function normalizeText(text) {
    return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function getBotResponse(input) {
    const text = normalizeText(input);
    
    // Check for explicit greetings
    if (/hola|saludos|buen(os)? (dia|tarde|noche)/.test(text)) {
        return "¡Hola! 🌿 Soy el Bot de Doña Misia. Ahora conozco muchas más plantas: Sábila, Marba, Clavellina, Orégano, Limón, Manzanilla, Té verde, Hierbabuena, Eucalipto y Jengibre. Puedes preguntarme para qué sirven, cómo prepararlas o sus contraindicaciones.";
    }
    
    if (text.includes('gracias')) {
        return '¡Con mucho gusto! Recuerda que soy una guía informativa, siempre consulta a un profesional de la salud para tratamientos médicos seguros. ¡Que tengas un día muy verde! 🍃';
    }

    // Identify if the user is asking about a specific plant
    let mentionedPlant = null;
    
    for (let i = 0; i < plantsData.length; i++) {
        const p = plantsData[i];
        if (text.includes(normalizeText(p.name))) {
            mentionedPlant = p;
            break;
        }
        for (let j = 0; j < p.aliases.length; j++) {
            if (text.includes(normalizeText(p.aliases[j]))) {
                mentionedPlant = p;
                break; // Break alias loop
            }
        }
        if (mentionedPlant) break; // Break plant loop
    }
    
    if (mentionedPlant) {
        // Did they ask how to prepare it?
        if (/prepara|receta|hace|toma|infusion|te\b|decoccion/.test(text)) {
            return `**Preparación de ${mentionedPlant.name}**: ${mentionedPlant.preparation}`;
        }
        
        // Did they ask for contraindications/dangers?
        if (/contraindic|riesgo|peligro|puedo tomar|mal|efecto|embarazo/.test(text)) {
            return `**Contraindicaciones de ${mentionedPlant.name}**: ${mentionedPlant.contraindications}`;
        }
        
        // General info
        return `El ${mentionedPlant.name} (${mentionedPlant.scientificName}) es ${mentionedPlant.description.toLowerCase()} \n\nÚtil para: ${mentionedPlant.uses.join(", ")}. \n\n*Puedes preguntarme: "¿Cómo se prepara el ${mentionedPlant.name}?" o "¿Qué contraindicaciones tiene?"*`;
    }
    
    return 'Mis raíces de conocimiento aún están creciendo. Mencioname una de nuestras plantas del catálogo (como Manzanilla, Eucalipto, Jengibre...) y te diré cómo prepararla o sus contraindicaciones.';
}

function initChatbot() {
    const chatbot = document.getElementById('chatbot');
    const fabChat = document.getElementById('fabChat');
    const closeChat = document.getElementById('closeChat');
    const downloadPdfBtn = document.getElementById('downloadPdfBtn');
    const openChatBtn = document.getElementById('openChatBtn');
    const chatForm = document.getElementById('chatForm');
    const userInput = document.getElementById('userInput');
    const chatMessages = document.getElementById('chatMessages');
    
    if(!chatbot) return;

    function toggleChat() {
        chatbot.classList.toggle('hidden');
        if (!chatbot.classList.contains('hidden')) {
            userInput.focus();
        }
    }
    
    fabChat.addEventListener('click', toggleChat);
    closeChat.addEventListener('click', toggleChat);
    if(openChatBtn) openChatBtn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleChat();
    });
    
    if(downloadPdfBtn) {
        downloadPdfBtn.addEventListener('click', () => {
            const tempContainer = document.createElement('div');
            tempContainer.style.padding = '30px';
            tempContainer.style.fontFamily = '"Outfit", sans-serif';
            tempContainer.style.color = '#333';
            tempContainer.style.background = '#fff';
            tempContainer.style.position = 'absolute';
            tempContainer.style.left = '-9999px';
            tempContainer.style.width = '800px'; // fixed width for decent formatting
            
            const header = document.createElement('h1');
            header.innerText = 'Información Bot Doña Misia y Plantas';
            header.style.color = '#6A8A00';
            header.style.borderBottom = '2px solid #a1ce0d';
            header.style.paddingBottom = '10px';
            tempContainer.appendChild(header);
            
            const catHeader = document.createElement('h2');
            catHeader.innerText = 'Catálogo de Plantas Suministrado';
            catHeader.style.marginTop = '20px';
            tempContainer.appendChild(catHeader);
            
            plantsData.forEach(p => {
                const pInfo = document.createElement('div');
                pInfo.style.marginBottom = '15px';
                pInfo.style.padding = '10px';
                pInfo.style.background = '#f9f9f9';
                pInfo.style.borderRadius = '5px';
                pInfo.innerHTML = `<strong>${p.name} (${p.scientificName}):</strong> ${p.description}<br>
                <span style="color: #6A8A00;"><em>Preparación:</em></span> ${p.preparation}<br>
                <span style="color: #c53030;"><em>Contraindicaciones:</em></span> ${p.contraindications}`;
                tempContainer.appendChild(pInfo);
            });
            
            const chatHeader = document.createElement('h2');
            chatHeader.innerText = 'Historial del Chat';
            chatHeader.style.marginTop = '30px';
            chatHeader.style.borderBottom = '1px solid #ccc';
            chatHeader.style.paddingBottom = '10px';
            tempContainer.appendChild(chatHeader);
            
            const messages = chatMessages.querySelectorAll('.message:not(.typing)');
            messages.forEach(msg => {
                const isBot = msg.classList.contains('bot');
                const sender = isBot ? 'Bot Doña Misia' : 'Tú';
                const text = msg.querySelector('.message-content').innerText;
                
                const msgEl = document.createElement('div');
                msgEl.style.marginBottom = '10px';
                msgEl.style.padding = '10px';
                msgEl.style.borderRadius = '5px';
                msgEl.style.background = isBot ? '#f0f0f0' : '#e6f2d5';
                msgEl.innerHTML = `<strong>${sender}:</strong> ${text}`;
                tempContainer.appendChild(msgEl);
            });
            
            document.body.appendChild(tempContainer);
            
            const opt = {
                margin:       10,
                filename:     'historial_bot_y_plantas.pdf',
                image:        { type: 'jpeg', quality: 0.98 },
                html2canvas:  { scale: 2, useCORS: true },
                jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };
            
            html2pdf().set(opt).from(tempContainer).save().then(() => {
                document.body.removeChild(tempContainer);
            });
        });
    }
    
    function addMessage(text, sender) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender}`;
        
        // Convert basic markdown-like bold to html
        const formattedText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        
        msgDiv.innerHTML = `<div class="message-content">${formattedText}</div>`;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    function addTypingIndicator() {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message bot typing`;
        msgDiv.id = 'typingIndicator';
        msgDiv.innerHTML = `
            <div class="message-content">
                <div class="typing-indicator">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>`;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    function removeTypingIndicator() {
        const indicator = document.getElementById('typingIndicator');
        if (indicator) indicator.remove();
    }
    
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = userInput.value.trim();
        if (!text) return;
        
        // Add user message
        addMessage(text, 'user');
        userInput.value = '';
        
        // Show typing indicator
        addTypingIndicator();
        
        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message: text })
            });

            const data = await response.json();
            removeTypingIndicator();
            
            if (data.response) {
                addMessage(data.response, 'bot');
            } else if (data.error || data.response === null) {
                const errorMsg = data.response === null ? "El servidor devolvió una respuesta vacía." : (data.error || "Error desconocido");
                addMessage(`⚠️ **Error del Servidor:** ${errorMsg}. Por favor, verifica los logs o la configuración del token.`, 'bot');
            }
        } catch (error) {
            console.error("Error calling chat API:", error);
            removeTypingIndicator();
            // Fallback to local logic if server is not available (useful for local dev without server)
            const fallbackResponse = getBotResponse(text);
            addMessage(fallbackResponse + " (Nota: El servidor de IA está desconectado, usando respuesta de respaldo)", 'bot');
        }
    });
}

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', async () => {
    await loadPlantsData();
    renderCatalog();
    initChatbot();
});

