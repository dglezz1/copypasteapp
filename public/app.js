// app.js - JavaScript para portapapeles compartido en tiempo real

class SharedClipboard {
    constructor() {
        this.socket = null;
        this.deviceCode = null;
        this.encryptionKey = null;
        this.isConnected = false;
        this.lastText = '';
        this.isOwnDevice = false; // Para saber si es nuestro dispositivo o uno al que nos conectamos
        
        this.initElements();
        this.initEventListeners();
        this.initSocket();
        
        // Auto-generar código al cargar la página
        this.autoCreateDevice();
    }

    initElements() {
        // Elementos de UI
        this.deviceCodeEl = document.getElementById('deviceCode');
        this.deviceInput = document.getElementById('deviceInput');
        this.connectBtn = document.getElementById('connectBtn');
        this.newDeviceBtn = document.getElementById('newDeviceBtn');
        this.clipboardText = document.getElementById('clipboardText');
        this.copyBtn = document.getElementById('copyBtn');
        this.clearBtn = document.getElementById('clearBtn');
        this.disconnectBtn = document.getElementById('disconnectBtn');
        this.charCounter = document.getElementById('charCounter');
        this.statusMessage = document.getElementById('statusMessage');
        this.statusIndicator = document.getElementById('statusIndicator');
        this.statusText = document.getElementById('statusText');
        
        // Secciones
        this.deviceCodeSection = document.getElementById('deviceCodeSection');
        this.connectionSection = document.getElementById('connectionSection');
        this.clipboardSection = document.getElementById('clipboardSection');
        this.connectionStatus = document.getElementById('connectionStatus');
    }

    initEventListeners() {
        // Botones principales
        this.connectBtn.addEventListener('click', () => this.connectToDevice());
        this.newDeviceBtn.addEventListener('click', () => this.createNewDevice());
        this.disconnectBtn.addEventListener('click', () => this.disconnect());
        
        // Controles de portapapeles
        this.copyBtn.addEventListener('click', () => this.copyToClipboard());
        this.clearBtn.addEventListener('click', () => this.clearClipboard());
        
        // Eventos de textarea
        this.clipboardText.addEventListener('input', () => this.onTextChange());
        this.clipboardText.addEventListener('paste', () => {
            setTimeout(() => this.onTextChange(), 10);
        });
        
        // Input de código de dispositivo
        this.deviceInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^0-9]/g, '').substring(0, 6);
        });
        
        this.deviceInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.connectToDevice();
            }
        });

        // Teclas de acceso rápido
        document.addEventListener('keydown', (e) => {
            if (!this.isConnected) return;
            
            // Ctrl/Cmd + C para copiar (solo si no está en el textarea)
            if ((e.ctrlKey || e.metaKey) && e.key === 'c' && e.target !== this.clipboardText) {
                e.preventDefault();
                this.copyToClipboard();
            }
            
            // Ctrl/Cmd + L para limpiar
            if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
                e.preventDefault();
                this.clearClipboard();
            }
        });
    }

    initSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Conectado al servidor');
        });

        this.socket.on('disconnect', () => {
            console.log('Desconectado del servidor');
            this.setConnectionStatus(false, 'Desconectado del servidor');
        });

        this.socket.on('joined-device', (data) => {
            console.log('Conectado al dispositivo:', data.deviceCode);
            this.setConnectionStatus(true, `Conectado al dispositivo ${data.deviceCode}`);
            this.clipboardText.focus();
            
            // Mostrar texto actual si existe
            if (data.currentClipboard) {
                this.updateClipboardText(data.currentClipboard);
            }
            
            // Si no es nuestro dispositivo, actualizar el código mostrado
            if (!this.isOwnDevice) {
                this.deviceCodeEl.textContent = data.deviceCode;
            }
        });

        this.socket.on('clipboard-updated', (data) => {
            console.log('Portapapeles actualizado:', data);
            this.updateClipboardText(data.text);
            this.showStatus('📋 Portapapeles sincronizado', 'success');
        });

        this.socket.on('clipboard-cleared', (data) => {
            console.log('Portapapeles limpiado:', data);
            this.updateClipboardText('');
            this.showStatus('🧹 Portapapeles limpiado', 'info');
        });

        this.socket.on('device-connected', (data) => {
            this.showStatus('📱 Nuevo dispositivo conectado', 'info');
        });

        this.socket.on('device-disconnected', (data) => {
            this.showStatus('📱 Dispositivo desconectado', 'info');
        });

        this.socket.on('error', (data) => {
            console.error('Error del socket:', data);
            this.showStatus(`❌ Error: ${data.message}`, 'error');
            if (data.message.includes('inválido') || data.message.includes('encontrado')) {
                this.disconnect();
            }
        });
    }

    async autoCreateDevice() {
        try {
            this.deviceCodeEl.textContent = 'Generando...';
            
            const response = await fetch('/api/device/connect', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({})
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.deviceCode = data.deviceCode;
                this.encryptionKey = data.encryptionKey;
                this.isOwnDevice = true;
                
                this.deviceCodeEl.textContent = data.deviceCode;
                
                // Conectar automáticamente al dispositivo recién creado
                this.socket.emit('join-device', {
                    deviceCode: this.deviceCode,
                    encryptionKey: this.encryptionKey
                });
                
                this.showStatus('✅ Dispositivo creado y listo para usar', 'success');
                
            } else {
                this.deviceCodeEl.textContent = 'Error';
                this.showStatus(`❌ Error: ${data.error}`, 'error');
            }
        } catch (error) {
            console.error('Error auto-creando dispositivo:', error);
            this.deviceCodeEl.textContent = 'Error';
            this.showStatus('❌ Error de conexión', 'error');
        }
    }

    async createNewDevice() {
        try {
            this.setButtonLoading(this.newDeviceBtn, true);
            
            // Desconectar del dispositivo actual si existe
            if (this.socket && this.deviceCode) {
                this.socket.emit('leave-device');
            }
            
            const response = await fetch('/api/device/connect', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({})
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.deviceCode = data.deviceCode;
                this.encryptionKey = data.encryptionKey;
                this.isOwnDevice = true;
                
                this.deviceCodeEl.textContent = data.deviceCode;
                
                // Conectar al dispositivo recién creado
                this.socket.emit('join-device', {
                    deviceCode: this.deviceCode,
                    encryptionKey: this.encryptionKey
                });
                
                this.showStatus('✅ Nuevo dispositivo generado', 'success');
                
                // Limpiar input de conexión
                this.deviceInput.value = '';
                
            } else {
                this.showStatus(`❌ Error: ${data.error}`, 'error');
            }
        } catch (error) {
            console.error('Error creando dispositivo:', error);
            this.showStatus('❌ Error de conexión', 'error');
        } finally {
            this.setButtonLoading(this.newDeviceBtn, false);
        }
    }

    async connectToDevice() {
        const deviceCode = this.deviceInput.value.trim();
        
        if (!deviceCode || deviceCode.length !== 6) {
            this.showStatus('❌ Introduce un código de 6 dígitos', 'error');
            this.deviceInput.focus();
            return;
        }

        try {
            this.setButtonLoading(this.connectBtn, true);
            
            const response = await fetch('/api/device/connect', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ deviceCode })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                // Desconectar del dispositivo actual si existe
                if (this.socket && this.deviceCode) {
                    this.socket.emit('leave-device');
                }
                
                this.deviceCode = data.deviceCode;
                this.encryptionKey = data.encryptionKey;
                this.isOwnDevice = false; // Nos conectamos a otro dispositivo
                
                // Conectar al dispositivo
                this.socket.emit('join-device', {
                    deviceCode: this.deviceCode,
                    encryptionKey: this.encryptionKey
                });
                
                this.showStatus('🔗 Conectando al dispositivo...', 'info');
                
            } else {
                this.showStatus(`❌ Error: ${data.error}`, 'error');
            }
        } catch (error) {
            console.error('Error conectando dispositivo:', error);
            this.showStatus('❌ Error de conexión', 'error');
        } finally {
            this.setButtonLoading(this.connectBtn, false);
        }
    }

    disconnect() {
        if (this.socket && this.deviceCode) {
            this.socket.emit('leave-device');
        }
        
        // Si no estamos en nuestro dispositivo, volvemos al nuestro
        if (!this.isOwnDevice) {
            this.showStatus('🔄 Volviendo a tu dispositivo...', 'info');
            this.autoCreateDevice();
            this.deviceInput.value = '';
        } else {
            // Si estamos en nuestro dispositivo, solo actualizar estado
            this.setConnectionStatus(false, 'Desconectado');
        }
    }

    onTextChange() {
        const text = this.clipboardText.value;
        this.updateCharCounter();
        
        // Sanitizar texto (remover caracteres peligrosos)
        const sanitizedText = text.replace(/[<>'"&]/g, '');
        if (text !== sanitizedText) {
            this.clipboardText.value = sanitizedText;
            this.showStatus('⚠️ Se removieron caracteres no permitidos', 'error');
        }
        
        // Solo sincronizar si el texto cambió realmente
        if (this.isConnected && sanitizedText !== this.lastText) {
            this.lastText = sanitizedText;
            this.socket.emit('update-clipboard', { text: sanitizedText });
        }
    }

    updateClipboardText(text) {
        // Evitar loop infinito
        if (text === this.lastText) return;
        
        this.lastText = text;
        this.clipboardText.value = text;
        this.updateCharCounter();
    }

    async copyToClipboard() {
        const text = this.clipboardText.value;
        
        if (!text) {
            this.showStatus('⚠️ No hay texto para copiar', 'error');
            return;
        }

        try {
            await navigator.clipboard.writeText(text);
            this.showTemporaryButtonFeedback(this.copyBtn, '✅ Copiado', 'btn-success');
            this.showStatus('📋 Texto copiado al portapapeles', 'success');
        } catch (err) {
            // Fallback para navegadores más antiguos
            this.clipboardText.select();
            const success = document.execCommand('copy');
            
            if (success) {
                this.showTemporaryButtonFeedback(this.copyBtn, '✅ Copiado', 'btn-success');
                this.showStatus('📋 Texto copiado al portapapeles', 'success');
            } else {
                this.showStatus('❌ Error al copiar texto', 'error');
            }
        }
    }

    clearClipboard() {
        if (this.isConnected) {
            this.socket.emit('clear-clipboard');
        } else {
            this.clipboardText.value = '';
            this.updateCharCounter();
        }
        
        this.showTemporaryButtonFeedback(this.clearBtn, '🧹 Limpiado', 'btn-danger');
    }

    updateCharCounter() {
        const text = this.clipboardText.value;
        const length = text.length;
        const isNearLimit = length > 900;
        
        this.charCounter.textContent = `${length} / 1000 caracteres`;
        this.charCounter.classList.toggle('warning', isNearLimit);
        
        if (length >= 1000) {
            this.clipboardText.value = text.substring(0, 1000);
            this.showStatus('⚠️ Límite de 1000 caracteres alcanzado', 'error');
        }
    }

    setConnectionStatus(connected, message) {
        this.isConnected = connected;
        this.statusIndicator.classList.toggle('connected', connected);
        this.statusText.textContent = message;
        this.connectionStatus.style.display = 'flex';
    }

    showStatus(message, type) {
        this.statusMessage.textContent = message;
        this.statusMessage.className = `status ${type}`;
        this.statusMessage.style.display = 'block';
        
        // Auto-hide después de 5 segundos
        setTimeout(() => {
            this.statusMessage.style.display = 'none';
        }, 5000);
    }

    setButtonLoading(button, loading) {
        if (loading) {
            button.disabled = true;
            button.dataset.originalText = button.innerHTML;
            button.innerHTML = '<span class="loading"></span> Cargando...';
        } else {
            button.disabled = false;
            button.innerHTML = button.dataset.originalText || button.innerHTML;
        }
    }

    showTemporaryButtonFeedback(button, text, className) {
        const originalText = button.innerHTML;
        const originalClass = button.className;
        
        button.innerHTML = text;
        button.className = `btn ${className}`;
        
        setTimeout(() => {
            button.innerHTML = originalText;
            button.className = originalClass;
        }, 2000);
    }
}

// Inicializar la aplicación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    new SharedClipboard();
});