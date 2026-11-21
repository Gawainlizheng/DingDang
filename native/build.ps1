$ErrorActionPreference = 'Stop'
$locator = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (!(Test-Path -LiteralPath $locator)) { throw 'Visual Studio C++ Build Tools not found' }
$installation = & $locator -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$installation) { throw 'Install Visual Studio Desktop development with C++ and a Windows SDK' }
$env:DINGDANG_VCVARS = Join-Path $installation 'VC/Auxiliary/Build/vcvars64.bat'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    New-Item -ItemType Directory -Force .native-build-a | Out-Null
    cmd.exe /d /c 'call "%DINGDANG_VCVARS%" && cl.exe /nologo /std:c++17 /utf-8 /O2 /EHsc /MT /Fo:.native-build-a\context-menu.obj /Fe:.native-build-a\context-menu.exe native\context-menu.cpp shell32.lib ole32.lib user32.lib uuid.lib /link /SUBSYSTEM:WINDOWS'
    if ($LASTEXITCODE) { throw "Native menu build failed ($LASTEXITCODE)" }
    cmd.exe /d /c 'call "%DINGDANG_VCVARS%" && cl.exe /nologo /utf-8 /O2 /EHsc /MT /LD /Fo:.native-build-a\foreground.obj /Fe:.native-build-a\foreground.node native\foreground.cpp user32.lib'
    if ($LASTEXITCODE) { throw "Foreground bridge build failed ($LASTEXITCODE)" }
} finally { Pop-Location }
