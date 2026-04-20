# Usar una imagen de Node ligera
FROM node:20-slim

# Crear directorio de la app
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias (usando ci para mayor estabilidad en producción)
RUN npm install

# Copiar el resto del código
COPY . .

# Exponer el puerto que usa Hugging Face
EXPOSE 7860

# Comando para iniciar la aplicación
CMD ["npm", "start"]
