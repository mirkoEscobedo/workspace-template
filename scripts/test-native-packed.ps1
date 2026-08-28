Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-Sha256([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $hasher = [System.Security.Cryptography.SHA256]::Create()
        try {
            return ([System.BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
        } finally {
            $hasher.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

$repository = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $repository 'bin\workspace-template.exe'
$provenancePath = Join-Path $repository 'workspace-template.provenance.json'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Tracked native executable is missing.' }
if (-not (Test-Path -LiteralPath $provenancePath)) { throw 'Native provenance manifest is missing.' }

$provenance = Get-Content -LiteralPath $provenancePath -Raw | ConvertFrom-Json
$actualHash = Get-Sha256 $executable
if ($actualHash -ne $provenance.executable.sha256) { throw 'Tracked executable does not match provenance.' }

$temporary = Join-Path $repository ('.tmp\packed-native-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary -Force | Out-Null
try {
    $npmCache = Join-Path $temporary 'npm-cache'
    $pnpmStore = Join-Path $temporary 'pnpm-store'
    $packOutput = npm pack --ignore-scripts --json --pack-destination $temporary --cache $npmCache
    if ($LASTEXITCODE -ne 0) { throw 'npm pack failed.' }
    $pack = $packOutput | ConvertFrom-Json
    $tarball = Join-Path $temporary $pack[0].filename

    foreach ($manager in @('npm', 'pnpm')) {
        if (-not (Get-Command ($manager + '.cmd') -ErrorAction SilentlyContinue)) { throw "$manager is required for packed qualification." }
        $consumer = Join-Path $temporary $manager
        New-Item -ItemType Directory -Path $consumer -Force | Out-Null
        $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText(
            (Join-Path $consumer 'package.json'),
            '{"name":"workspace-template-packed-canary","private":true}',
            $utf8WithoutBom
        )
        if ($manager -eq 'npm') {
            & npm.cmd install --ignore-scripts --no-audit --no-fund --save-dev $tarball --prefix $consumer --cache $npmCache
        } else {
            Push-Location $consumer
            try { & pnpm.cmd add --ignore-scripts --save-dev $tarball --store-dir $pnpmStore } finally { Pop-Location }
        }
        if ($LASTEXITCODE -ne 0) { throw "$manager packed installation failed." }
        $installed = Join-Path $consumer 'node_modules\workspace-template\bin\workspace-template.exe'
        if (-not (Test-Path -LiteralPath $installed)) { throw "$manager did not install the native executable." }
        if ((Get-Sha256 $installed) -ne $actualHash) {
            throw "$manager installed an executable with the wrong checksum."
        }
        $savedPath = $env:PATH
        try {
            $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
            $versionOutput = & $installed version --json
            if ($LASTEXITCODE -ne 0) { throw "$manager executable failed without Node on PATH." }
        } finally {
            $env:PATH = $savedPath
        }
        $version = $versionOutput | ConvertFrom-Json
        if (-not $version.ok -or $version.result.version -ne '0.8.0') { throw "$manager returned the wrong native version." }
    }
} finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
}
