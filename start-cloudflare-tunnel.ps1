# CIRCE Local AI Lab - Inicio de Cloudflare Tunnel
# Permite compartir la herramienta con 5 o más personas de CIRCE sin abrir puertos.

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  CIRCE Local AI Lab - Acceso Remoto con Cloudflare Tunnel" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green

# 1. Comprobar si cloudflared esta instalado
$cloudflaredCmd = Get-Command cloudflared -ErrorAction SilentlyContinue

if (-not $cloudflaredCmd) {
    Write-Host "[!] cloudflared no está en el PATH." -ForegroundColor Yellow
    Write-Host "[*] Intentando instalar cloudflared con winget..." -ForegroundColor Cyan
    try {
        winget install Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements
        # Actualizar PATH en la sesion actual
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        $cloudflaredCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    } catch {
        Write-Host "[-] No se pudo instalar automáticamente con winget." -ForegroundColor Red
        Write-Host "    Descarga cloudflared manualmente desde:" -ForegroundColor Yellow
        Write-Host "    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -ForegroundColor White
        Exit
    }
}

# 2. Comprobar si server.py está activo en el puerto 8080
Write-Host "[*] Verificando servidor local en http://localhost:8080..." -ForegroundColor Cyan
$serverActive = Test-NetConnection -ComputerName 127.0.0.1 -Port 8080 -InformationLevel Quiet -WarningAction SilentlyContinue

if (-not $serverActive) {
    Write-Host "[!] El servidor en el puerto 8080 no responde." -ForegroundColor Yellow
    Write-Host "    Recuerda arrancar primero el backend en otra terminal:" -ForegroundColor Yellow
    Write-Host "    python server.py" -ForegroundColor White
    Write-Host ""
    $confirm = Read-Host "¿Deseas continuar iniciando el túnel de todos modos? (S/N)"
    if ($confirm -ne "S" -and $confirm -ne "s") {
        Exit
    }
}

# 3. Iniciar el túnel
Write-Host ""
Write-Host "[+] Iniciando Cloudflare Tunnel hacia http://localhost:8080..." -ForegroundColor Green
Write-Host "[+] Busca la URL que termina en .trycloudflare.com en la salida siguiente:" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""

cloudflared tunnel --protocol http2 --url http://localhost:8080
