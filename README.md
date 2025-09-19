# Easy Copy & Paste

Una aplicación web segura para sincronizar texto entre dispositivos en tiempo real.
No importa el sistema operativo ya que funciona desde el navegador

## Características


- **Sincronización en tiempo real**: WebSockets para actualización instantánea
- **Cifrado extremo a extremo**: AES-256 para proteger todos los datos
- **Multi-dispositivo**: Conecta ilimitados dispositivos al mismo código

## ¿Cómo funciona?

1. **Crear dispositivo**: Genera un código único de 6 dígitos
2. **Conectar dispositivos**: Introduce el código en otros dispositivos
3. **Sincronizar texto**: Escribe en cualquier dispositivo y se sincroniza automáticamente
4. **Copiar/Limpiar**: Usa los botones para gestionar el portapapeles

## 🔒 Seguridad

- **Cifrado AES-256**: Todos los datos se cifran antes de almacenarse
- **Códigos temporales**: Los dispositivos expiran en 24 horas
- **Sanitización de entrada**: Previene inyección de código
- **Rate limiting**: Protección contra ataques de fuerza bruta
- **WebSockets seguros**: Comunicación cifrada en tiempo real


## 🛠️ Instalación

### 1. Clonar y configurar

```bash
git clone <tu-repositorio>
cd copypasteapp
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
```

Edita el archivo `.env` y configura:

```env
PORT=3012
REDIS_PASSWORD=tu_contraseña_super_segura_aqui
TUNNEL_TOKEN=tu_token_de_cloudflare_tunnel_aqui
```

### 3. Configurar Cloudflare Tunnel

#### Paso 3.1: Crear el túnel en Cloudflare

1. Ve a [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/)
2. Navega a **Access > Tunnels**
3. Clic en **Create a tunnel**
4. Selecciona **Cloudflared** y dale un nombre (ej: "copypasteapp")
5. Guarda el **token** que aparece

#### Paso 3.2: Configurar el DNS

1. En la configuración del túnel, agrega una **Public Hostname**:
   - **Subdomain**: `copypaste` (o el que prefieras)
   - **Domain**: tu dominio de Cloudflare
   - **Type**: HTTP
   - **URL**: `app:3012` (nombre del servicio en Docker Compose)

2. Ejemplo final: `copypaste.tudominio.com` → `app:3012`

#### Paso 3.3: Actualizar .env

Copia el token y actualiza tu archivo `.env`:

```env
TUNNEL_TOKEN=eyJhIjoiYWJjZGVmZ2hpams...tu_token_completo_aqui
```

### 4. Desplegar la aplicación

```bash
# Construir y ejecutar todos los servicios
docker compose up -d --build

# Verificar que todo esté ejecutándose
docker compose ps

# Ver logs si hay problemas
docker compose logs -f
```

### 5. Verificar funcionamiento

- **Local**: http://localhost:3012
- **Público**: https://copypaste.tudominio.com

## 🔧 Comandos útiles

```bash
# Ver logs de todos los servicios
docker compose logs -f

# Ver logs de un servicio específico
docker compose logs -f app
docker compose logs -f redis
docker compose logs -f cloudflared

# Reiniciar servicios
docker compose restart

# Parar todos los servicios
docker compose down

# Parar y eliminar volúmenes (¡cuidado! esto borra todos los datos)
docker compose down -v

# Actualizar la aplicación
git pull
docker compose down
docker compose up -d --build
```

## 🏗️ Arquitectura

```
Internet → Cloudflare Tunnel → Docker Network → App (Node.js)
                                                ↓
                                              Redis
```

### Servicios

- **app**: Aplicación Node.js con Express (puerto 3012)
- **redis**: Base de datos temporal Redis (solo red interna)
- **cloudflared**: Túnel de Cloudflare para exposición HTTPS

### Redes Docker

- **internal**: Red interna para comunicación app ↔ redis
- **external**: Red externa para app ↔ cloudflared ↔ internet

## 🔒 Seguridad implementada

### Backend
- **Helmet**: Headers de seguridad (CSP, HSTS, X-Frame-Options, etc.)
- **Rate Limiting**: 30 requests/minuto por IP
- **Validación de entrada**: express-validator para todos los inputs
- **Límite de tamaño**: Máximo 50KB por texto
- **Escape de salida**: Solo JSON, frontend usa textContent

### Frontend
- **Prevención XSS**: Uso de `textContent` en lugar de `innerHTML`
- **CSP**: Content Security Policy estricto
- **Validación cliente**: Límites de caracteres y formato

### Infraestructura
- **Usuario no-root**: Contenedor ejecuta como usuario sin privilegios
- **Red interna**: Redis no accesible desde exterior
- **HTTPS**: Cloudflare provee certificados SSL automáticos
- **Secrets**: Variables sensibles en .env

## 📊 Endpoints API

### POST /api/create
Crea un nuevo texto compartido.

**Request:**
```json
{
  "text": "Texto a compartir",
  "ttl": 3600,
  "burn": false
}
```

**Response:**
```json
{
  "success": true,
  "code": "a1b2c3d4e5f6g7h8",
  "url": "/viewer.html?code=a1b2c3d4e5f6g7h8",
  "ttl": 3600,
  "burn": false
}
```

### GET /api/text/:code
Obtiene un texto compartido.

**Response:**
```json
{
  "success": true,
  "text": "Texto compartido",
  "createdAt": "2025-01-15T10:30:00.000Z",
  "burned": false
}
```

### GET /api/health
Endpoint de salud para monitoring.

## 🐛 Solución de problemas

### Error: "Redis connection error"
- Verificar que Redis esté ejecutándose: `docker compose ps`
- Revisar contraseña en .env
- Ver logs: `docker compose logs redis`

### Error: "Cloudflare tunnel not connecting"
- Verificar token en .env
- Comprobar configuración del túnel en Cloudflare Dashboard
- Ver logs: `docker compose logs cloudflared`

### Error: "Cannot access app externally"
- Verificar configuración DNS en Cloudflare
- Confirmar que el túnel apunte a `app:3012`
- Comprobar que el dominio esté correctamente configurado

### Problemas de performance
- Redis está configurado con límite de memoria (256MB)
- Rate limiting puede estar bloqueando requests
- Verificar logs de la aplicación

## 📝 Desarrollo local

Para desarrollo sin Cloudflare Tunnel:

```bash
# Solo app y redis
docker compose up app redis -d

# Acceder en http://localhost:3012
```

## 🔄 Actualizaciones

Para actualizar la aplicación:

1. Hacer backup si es necesario
2. `git pull` para obtener cambios
3. `docker compose down`
4. `docker compose up -d --build`

## 📄 Licencia

MIT

## 🤝 Contribuciones

Las contribuciones son bienvenidas. Por favor:

1. Fork del repositorio
2. Crear rama para feature: `git checkout -b feature/nueva-funcionalidad`
3. Commit cambios: `git commit -am 'Agregar nueva funcionalidad'`
4. Push a la rama: `git push origin feature/nueva-funcionalidad`
5. Abrir Pull Request

## 📞 Soporte

Si encuentras problemas:

1. Revisar logs: `docker compose logs -f`
2. Verificar configuración en `.env`
3. Comprobar estado de servicios: `docker compose ps`
4. Abrir issue en el repositorio