const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const redis = require('redis');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, param, validationResult } = require('express-validator');
const crypto = require('crypto');
const CryptoJS = require('crypto-js');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3012;

// Configuración de Redis
const redisClient = redis.createClient({
  url: 'redis://redis:6379',
  password: process.env.REDIS_PASSWORD || 'default_password'
});

redisClient.on('error', (err) => {
  console.error('Redis connection error:', err);
});

redisClient.on('connect', () => {
  console.log('Connected to Redis');
});

// Conectar a Redis
redisClient.connect();

// Configuración de seguridad con Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  noSniff: true,
  frameguard: { action: 'deny' },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 60, // 60 requests por minuto por IP (aumentado para WebSockets)
  message: {
    error: 'Demasiadas solicitudes, intenta de nuevo en un minuto'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Middleware para parsing JSON con límite de tamaño
app.use(express.json({ limit: '2kb' })); // Reducido para solo 1000 caracteres + metadata
app.use(express.static(path.join(__dirname, 'public')));

// Almacén de dispositivos conectados
const connectedDevices = new Map();

// Función para generar código único de dispositivo (6 dígitos)
function generateDeviceCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Función para cifrar texto
function encryptText(text, key) {
  return CryptoJS.AES.encrypt(text, key).toString();
}

// Función para descifrar texto
function decryptText(encryptedText, key) {
  const bytes = CryptoJS.AES.decrypt(encryptedText, key);
  return bytes.toString(CryptoJS.enc.Utf8);
}

// Función para sanitizar texto (prevenir inyección)
function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/[<>'"&]/g, '') // Remover caracteres peligrosos
    .trim()
    .substring(0, 1000); // Límite estricto de 1000 caracteres
}

// Validaciones
const updateClipboardValidation = [
  body('deviceCode')
    .isString()
    .isLength({ min: 6, max: 6 })
    .matches(/^\d{6}$/)
    .withMessage('Código de dispositivo debe ser 6 dígitos'),
  body('text')
    .isString()
    .isLength({ min: 0, max: 1000 })
    .withMessage('El texto debe tener máximo 1000 caracteres')
];

const connectDeviceValidation = [
  body('deviceCode')
    .optional()
    .isString()
    .isLength({ min: 6, max: 6 })
    .matches(/^\d{6}$/)
    .withMessage('Código de dispositivo debe ser 6 dígitos')
];

// Endpoint para crear/conectar dispositivo
app.post('/api/device/connect', connectDeviceValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Datos inválidos',
        details: errors.array()
      });
    }

    let { deviceCode } = req.body;
    let isNewDevice = false;

    // Si no se proporciona código, generar uno nuevo
    if (!deviceCode) {
      do {
        deviceCode = generateDeviceCode();
      } while (await redisClient.exists(`device:${deviceCode}`));
      isNewDevice = true;
    }

    // Verificar si el dispositivo existe
    const deviceExists = await redisClient.exists(`device:${deviceCode}`);
    
    if (!isNewDevice && !deviceExists) {
      return res.status(404).json({
        error: 'Dispositivo no encontrado'
      });
    }

    // Crear/actualizar dispositivo en Redis
    const deviceData = {
      code: deviceCode,
      lastActive: new Date().toISOString(),
      clipboard: '',
      encryptionKey: crypto.randomBytes(32).toString('hex')
    };

    if (isNewDevice) {
      await redisClient.setEx(
        `device:${deviceCode}`, 
        86400, // 24 horas de TTL
        JSON.stringify(deviceData)
      );
    } else {
      // Actualizar solo lastActive si ya existe
      const existingData = JSON.parse(await redisClient.get(`device:${deviceCode}`));
      existingData.lastActive = new Date().toISOString();
      await redisClient.setEx(
        `device:${deviceCode}`, 
        86400,
        JSON.stringify(existingData)
      );
      deviceData.encryptionKey = existingData.encryptionKey;
      deviceData.clipboard = existingData.clipboard;
    }

    res.json({
      success: true,
      deviceCode: deviceCode,
      isNewDevice: isNewDevice,
      encryptionKey: deviceData.encryptionKey
    });

  } catch (error) {
    console.error('Error connecting device:', error);
    res.status(500).json({
      error: 'Error interno del servidor'
    });
  }
});

// Endpoint para obtener portapapeles
app.get('/api/device/:code/clipboard', async (req, res) => {
  try {
    const { code } = req.params;
    
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({
        error: 'Código inválido'
      });
    }

    const deviceData = await redisClient.get(`device:${code}`);
    
    if (!deviceData) {
      return res.status(404).json({
        error: 'Dispositivo no encontrado'
      });
    }

    const device = JSON.parse(deviceData);
    
    // Descifrar texto si existe
    let decryptedText = '';
    if (device.clipboard) {
      try {
        decryptedText = decryptText(device.clipboard, device.encryptionKey);
      } catch (err) {
        console.error('Error decrypting:', err);
      }
    }

    res.json({
      success: true,
      text: decryptedText,
      lastUpdate: device.lastActive
    });

  } catch (error) {
    console.error('Error getting clipboard:', error);
    res.status(500).json({
      error: 'Error interno del servidor'
    });
  }
});

// Endpoint de salud
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    connectedDevices: connectedDevices.size
  });
});

// WebSocket para tiempo real
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Unirse a sala de dispositivo
  socket.on('join-device', async (data) => {
    try {
      const { deviceCode, encryptionKey } = data;
      
      if (!deviceCode || !/^\d{6}$/.test(deviceCode)) {
        socket.emit('error', { message: 'Código de dispositivo inválido' });
        return;
      }

      // Verificar que el dispositivo existe
      const deviceData = await redisClient.get(`device:${deviceCode}`);
      if (!deviceData) {
        socket.emit('error', { message: 'Dispositivo no encontrado' });
        return;
      }

      const device = JSON.parse(deviceData);
      
      // Verificar clave de cifrado
      if (device.encryptionKey !== encryptionKey) {
        socket.emit('error', { message: 'Clave de cifrado inválida' });
        return;
      }

      // Unirse a la sala del dispositivo
      socket.join(`device:${deviceCode}`);
      socket.deviceCode = deviceCode;
      socket.encryptionKey = encryptionKey;
      
      // Agregar a dispositivos conectados
      connectedDevices.set(socket.id, {
        deviceCode,
        encryptionKey,
        connectedAt: new Date()
      });

      // Enviar portapapeles actual
      let currentText = '';
      if (device.clipboard) {
        try {
          currentText = decryptText(device.clipboard, encryptionKey);
        } catch (err) {
          console.error('Error decrypting:', err);
        }
      }

      socket.emit('joined-device', {
        deviceCode,
        currentClipboard: currentText
      });

      // Notificar a otros dispositivos en la sala
      socket.to(`device:${deviceCode}`).emit('device-connected', {
        message: 'Nuevo dispositivo conectado'
      });

    } catch (error) {
      console.error('Error joining device:', error);
      socket.emit('error', { message: 'Error interno del servidor' });
    }
  });

  // Actualizar portapapeles
  socket.on('update-clipboard', async (data) => {
    try {
      const { text } = data;
      
      if (!socket.deviceCode || !socket.encryptionKey) {
        socket.emit('error', { message: 'No conectado a ningún dispositivo' });
        return;
      }

      // Sanitizar texto
      const sanitizedText = sanitizeText(text || '');

      // Cifrar texto
      const encryptedText = encryptText(sanitizedText, socket.encryptionKey);

      // Actualizar en Redis
      const deviceData = await redisClient.get(`device:${socket.deviceCode}`);
      if (deviceData) {
        const device = JSON.parse(deviceData);
        device.clipboard = encryptedText;
        device.lastActive = new Date().toISOString();
        
        await redisClient.setEx(
          `device:${socket.deviceCode}`,
          86400,
          JSON.stringify(device)
        );

        // Notificar a todos los dispositivos en la sala
        io.to(`device:${socket.deviceCode}`).emit('clipboard-updated', {
          text: sanitizedText,
          timestamp: device.lastActive
        });
      }

    } catch (error) {
      console.error('Error updating clipboard:', error);
      socket.emit('error', { message: 'Error al actualizar portapapeles' });
    }
  });

  // Limpiar portapapeles
  socket.on('clear-clipboard', async () => {
    try {
      if (!socket.deviceCode) {
        socket.emit('error', { message: 'No conectado a ningún dispositivo' });
        return;
      }

      // Limpiar en Redis
      const deviceData = await redisClient.get(`device:${socket.deviceCode}`);
      if (deviceData) {
        const device = JSON.parse(deviceData);
        device.clipboard = '';
        device.lastActive = new Date().toISOString();
        
        await redisClient.setEx(
          `device:${socket.deviceCode}`,
          86400,
          JSON.stringify(device)
        );

        // Notificar a todos los dispositivos en la sala
        io.to(`device:${socket.deviceCode}`).emit('clipboard-cleared', {
          timestamp: device.lastActive
        });
      }

    } catch (error) {
      console.error('Error clearing clipboard:', error);
      socket.emit('error', { message: 'Error al limpiar portapapeles' });
    }
  });

  // Desconexión
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Remover de dispositivos conectados
    if (connectedDevices.has(socket.id)) {
      const deviceInfo = connectedDevices.get(socket.id);
      connectedDevices.delete(socket.id);
      
      // Notificar a otros dispositivos en la sala
      socket.to(`device:${deviceInfo.deviceCode}`).emit('device-disconnected', {
        message: 'Dispositivo desconectado'
      });
    }
  });
});

// Manejo de errores globales
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Error interno del servidor'
  });
});

// Manejo de rutas no encontradas
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Ruta no encontrada'
  });
});

// Iniciar servidor
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor ejecutándose en puerto ${PORT}`);
  console.log(`WebSocket servidor habilitado`);
});

// Manejo de cierre graceful
process.on('SIGTERM', async () => {
  console.log('Cerrando servidor...');
  await redisClient.quit();
  server.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Cerrando servidor...');
  await redisClient.quit();
  server.close();
  process.exit(0);
});