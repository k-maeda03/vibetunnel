# VibeTunnel WSL2 Support

VibeTunnel now supports WSL2! This allows Windows users to run VibeTunnel terminal sharing through Windows Subsystem for Linux 2.

## Quick Start

### Prerequisites

1. **WSL2 installed** - VibeTunnel requires WSL2 (not WSL1)
   ```bash
   # Check your WSL version
   wsl --list --verbose
   
   # Upgrade to WSL2 if needed
   wsl --set-version <distro-name> 2
   ```

2. **Node.js 20+** installed in your WSL2 environment
   ```bash
   # Install Node.js via nvm (recommended)
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   nvm install 20
   nvm use 20
   ```

### Installation

1. **Install VibeTunnel:**
   ```bash
   # Build from source (recommended for now)
   git clone https://github.com/k-maeda03/vibetunnel.git
   cd vibetunnel/web
   npm install
   npm run build
   
   # Make launcher executable
   chmod +x dist/wsl2-launcher.js
   
   # Optional: Add to PATH for global access
   sudo ln -sf "$(pwd)/dist/wsl2-launcher.js" /usr/local/bin/vibetunnel-wsl2
   ```

2. **Start VibeTunnel server:**
   ```bash
   # Using the WSL2 launcher (recommended)
   vibetunnel-wsl2
   
   # Or direct server start
   node dist/server.js
   ```

3. **Access from Windows browser:**
   Open `http://localhost:4020` in your Windows browser

## WSL2 Launcher Usage

The `vibetunnel-wsl2` command provides a simple interface for managing VibeTunnel in WSL2:

```bash
# Start server in foreground
vibetunnel-wsl2

# Start server in background
vibetunnel-wsl2 --background

# Start with authentication
vibetunnel-wsl2 --username admin --password secret

# Start without authentication (localhost only)
vibetunnel-wsl2 --no-auth

# Check server status
vibetunnel-wsl2 --status

# Stop running server
vibetunnel-wsl2 --stop

# Show help
vibetunnel-wsl2 --help
```

## How It Works

### Automatic WSL2 Detection
VibeTunnel automatically detects WSL2 environments and configures itself appropriately:
- **Network Binding**: Binds to `0.0.0.0` to allow Windows host access
- **Shell Resolution**: Prioritizes bash (common in WSL2) over zsh
- **Process Management**: Uses WSL2-compatible process monitoring

### Network Access
WSL2 networking allows Windows to access WSL2 services via `localhost`:
- WSL2 service: `http://localhost:4020` 
- Windows browser: `http://localhost:4020` ← **Same URL!**

### Terminal Sessions
Create and manage terminal sessions just like on macOS:
```bash
# Run commands in browser-accessible terminals
vt npm run dev
vt python train.py
vt --shell  # Interactive shell
```

## Differences from macOS Version

| Feature | macOS | WSL2 |
|---------|--------|------|
| **Launcher** | Menu bar app | Command-line launcher |
| **Auto-start** | Login item | Manual start (or systemd) |
| **Network** | localhost | localhost (via WSL2 networking) |
| **Shell detection** | zsh priority | bash priority |
| **Process management** | Native macOS | Linux-compatible |

## Troubleshooting

### WSL Version Issues
```bash
# Check WSL version
wsl --list --verbose

# If showing WSL1, upgrade:
wsl --set-version <distro-name> 2
```

### Network Access Issues
If `http://localhost:4020` doesn't work from Windows:
1. Check Windows Firewall settings
2. Verify WSL2 is running: `wsl --status`
3. Check server binding: VibeTunnel should show "WSL2 detected" message

### Port Conflicts
```bash
# Use different port
vibetunnel-wsl2 --port 4021

# Check what's using port 4020
netstat -tulpn | grep :4020
```

### Server Won't Start
```bash
# Check server status
vibetunnel-wsl2 --status

# View logs (if running in background)
tail -f ~/.vibetunnel/server.log

# Stop any hung server
vibetunnel-wsl2 --stop
```

## Advanced Configuration

### Systemd Service (Optional)
Create a systemd service for auto-start:

```bash
# Create service file (replace /path/to/vibetunnel with your actual path)
VIBETUNNEL_PATH="$(pwd)" # If you're in the vibetunnel/web directory
sudo tee ~/.config/systemd/user/vibetunnel.service <<EOF
[Unit]
Description=VibeTunnel WSL2 Server
After=network.target

[Service]
Type=simple
ExecStart=${VIBETUNNEL_PATH}/dist/wsl2-launcher.js --background --no-auth
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
EOF

# Reload systemd and enable service
systemctl --user daemon-reload
systemctl --user enable vibetunnel
systemctl --user start vibetunnel

# Check status
systemctl --user status vibetunnel
```

### Environment Variables
```bash
# Set default configuration
export VIBETUNNEL_PORT=4020
export VIBETUNNEL_USERNAME=admin
export VIBETUNNEL_PASSWORD=secret

# Control directory (optional)
export VIBETUNNEL_CONTROL_DIR=~/.vibetunnel/control
```

## Performance Notes

WSL2 performance is excellent for terminal operations:
- **Terminal responsiveness**: Near-native Linux performance
- **Network latency**: Minimal overhead for localhost access
- **File I/O**: Fast access to WSL2 filesystem
- **Process spawning**: Native Linux process management

## Limitations

1. **WSL1 Not Supported**: Requires WSL2 for proper networking
2. **No GUI Launcher**: Command-line only (no system tray)
3. **Manual Startup**: No automatic startup (unlike macOS menu bar app)

## Contributing

WSL2 support is actively maintained. Report issues or contribute improvements:
- GitHub Issues: [Report WSL2-specific issues](https://github.com/k-maeda03/vibetunnel/issues)
- Feature Requests: WSL2-specific features welcome
- Pull Requests: Follow the same process as macOS development

## Migration from macOS

If you're familiar with VibeTunnel on macOS:

| macOS Action | WSL2 Equivalent |
|--------------|-----------------|
| Click menu bar icon | `vibetunnel-wsl2` |
| "Start Server" | `vibetunnel-wsl2 --background` |
| "Stop Server" | `vibetunnel-wsl2 --stop` |
| Check status | `vibetunnel-wsl2 --status` |
| Access dashboard | Same: `http://localhost:4020` |

The core functionality is identical - only the launcher interface differs!
