# Usar imagen base de Node.js 20 Alpine para menor tamaño
FROM node:20-alpine

# Crear usuario no-root para seguridad
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Establecer directorio de trabajo
WORKDIR /app

# Copiar archivos de configuración de Node.js
COPY package*.json ./

# Instalar dependencias de producción
RUN npm install --omit=dev && npm cache clean --force

# Copiar el código de la aplicación
COPY . .

# Cambiar propiedad de archivos al usuario no-root
RUN chown -R nextjs:nodejs /app
USER nextjs

# Exponer puerto
EXPOSE 3012

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=3012

# Comando para ejecutar la aplicación
CMD ["node", "index.js"]