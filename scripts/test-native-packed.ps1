[CmdletBinding()]
param(
    [switch]$AllowUnsignedDevelopment
)

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
$sbomPath = Join-Path $repository 'workspace-template.sbom.json'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Tracked native executable is missing.' }
if (-not (Test-Path -LiteralPath $provenancePath)) { throw 'Native provenance manifest is missing.' }
if (-not (Test-Path -LiteralPath $sbomPath)) { throw 'CycloneDX SBOM is missing.' }

$provenance = Get-Content -LiteralPath $provenancePath -Raw | ConvertFrom-Json
$actualHash = Get-Sha256 $executable
if ($actualHash -ne $provenance.executable.sha256) { throw 'Tracked executable does not match provenance.' }
$signature = Get-AuthenticodeSignature -LiteralPath $executable
if (-not $AllowUnsignedDevelopment) {
    if ($signature.Status -ne 'Valid' -or -not $signature.TimeStamperCertificate) {
        throw 'Packed qualification requires valid Authenticode and RFC 3161 timestamp evidence.'
    }
    if ($provenance.executable.signingStatus -ne 'authenticode-rfc3161') {
        throw 'Provenance does not identify the signed artifact.'
    }
    if ($provenance.signature.timestampProtocol -ne 'RFC3161') {
        throw 'Provenance does not record RFC 3161 timestamping.'
    }
    if (-not (Get-Command Start-MpScan -ErrorAction SilentlyContinue)) {
        throw 'Windows Defender is required for the signed-byte rescan.'
    }
    Start-MpScan -ScanType CustomScan -ScanPath $executable
}
$sbom = Get-Content -LiteralPath $sbomPath -Raw | ConvertFrom-Json
if ($sbom.bomFormat -ne 'CycloneDX' -or -not $sbom.components -or $sbom.components.Count -lt 1) {
    throw 'SBOM is incomplete.'
}

$temporary = Join-Path $repository ('.tmp\packed-native-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary -Force | Out-Null
try {
    $npmCache = Join-Path $temporary 'npm-cache'
    $pnpmStore = Join-Path $temporary 'pnpm-store'
    $packOutput = npm pack --ignore-scripts --json --pack-destination $temporary --cache $npmCache
    if ($LASTEXITCODE -ne 0) { throw 'npm pack failed.' }
    $pack = $packOutput | ConvertFrom-Json
    $tarball = Join-Path $temporary $pack[0].filename
    $tarballHash = Get-Sha256 $tarball
    $packedPaths = @($pack[0].files | ForEach-Object { $_.path.Replace('\', '/') })
    foreach ($forbidden in @('src/', 'test/', '.agentic/', '.agents/', '.opencode/', '.codex/', 'assets/presets/', 'assets/configs/')) {
        if ($packedPaths | Where-Object { $_.StartsWith($forbidden) }) {
            throw "Packed artifact contains prohibited path: $forbidden"
        }
    }
    if ($packedPaths | Where-Object { $_.EndsWith('.js') }) {
        throw 'Packed artifact contains executable JavaScript.'
    }

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
            & npm.cmd install --offline --ignore-scripts --no-audit --no-fund --save-dev $tarball --prefix $consumer --cache $npmCache
        } else {
            Push-Location $consumer
            try { & pnpm.cmd add --offline --ignore-scripts --save-dev $tarball --store-dir $pnpmStore } finally { Pop-Location }
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
        if (-not $version.ok -or $version.result.version -ne '0.9.0-alpha.0') { throw "$manager returned the wrong native version." }
        $skills = (& $installed skills list | ConvertFrom-Json)
        if (-not $skills.ok -or $skills.result.count -ne 13) { throw "$manager returned the wrong embedded skill inventory." }
        $instructions = (& $installed instructions | ConvertFrom-Json)
        $packedAssets = @($packedPaths | Where-Object { $_.StartsWith('assets/') } | Sort-Object)
        $embeddedAssets = @($instructions.result.embeddedAssets.paths | Sort-Object)
        if (Compare-Object -ReferenceObject $packedAssets -DifferenceObject $embeddedAssets) {
            throw "$manager packed assets differ from the native embedded manifest."
        }
        $route = (& $installed route | ConvertFrom-Json)
        if (-not $route.ok -or $route.result.mode -ne 'direct') { throw "$manager did not preserve Direct routing." }

        $planDirectory = Join-Path $consumer '.agentic\plans'
        New-Item -ItemType Directory -Path $planDirectory -Force | Out-Null
        $adoptPlan = Join-Path $planDirectory 'adopt.json'
        & $installed adopt plan $consumer --plan-out $adoptPlan | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "$manager sealed adoption plan failed." }
        & $installed adopt apply $consumer --apply-plan $adoptPlan | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "$manager sealed adoption apply failed." }
        $doctor = (& $installed doctor $consumer | ConvertFrom-Json)
        if ($LASTEXITCODE -ne 0 -or $doctor.result.verdict -ne 'PASS') { throw "$manager doctor did not pass." }
        foreach ($prohibited in @('.agentic\skills', '.agentic\skill-baselines', '.agents\skills', '.opencode\skills')) {
            if (Test-Path -LiteralPath (Join-Path $consumer $prohibited)) { throw "$manager copied prohibited generic state: $prohibited" }
        }
        $upgradePlan = Join-Path $planDirectory 'upgrade.json'
        $upgrade = (& $installed upgrade plan $consumer --plan-out $upgradePlan | ConvertFrom-Json)
        if ($LASTEXITCODE -ne 0 -or $upgrade.result.operations.Count -ne 0) { throw "$manager second migration was not a no-op." }

        if ($manager -eq 'npm') {
            & npm.cmd uninstall --ignore-scripts workspace-template --prefix $consumer --cache $npmCache
            if ($LASTEXITCODE -ne 0) { throw 'npm uninstall canary failed.' }
            & npm.cmd install --offline --ignore-scripts --no-audit --no-fund --save-dev $tarball --prefix $consumer --cache $npmCache
        } else {
            Push-Location $consumer
            try {
                & pnpm.cmd remove --ignore-scripts workspace-template --store-dir $pnpmStore
                if ($LASTEXITCODE -ne 0) { throw 'pnpm uninstall canary failed.' }
                & pnpm.cmd add --offline --ignore-scripts --save-dev $tarball --store-dir $pnpmStore
            } finally { Pop-Location }
        }
        if ($LASTEXITCODE -ne 0) { throw "$manager reinstall canary failed." }
        $reinstalled = Join-Path $consumer 'node_modules\workspace-template\bin\workspace-template.exe'
        if ((Get-Sha256 $reinstalled) -ne $actualHash) { throw "$manager reinstall changed executable identity." }
    }
    [ordered]@{
        verdict = 'PASS'
        version = '0.9.0-alpha.0'
        tarball = $pack[0].filename
        tarballSha256 = $tarballHash
        executableSha256 = $actualHash
        signingStatus = $provenance.executable.signingStatus
        managers = @('npm', 'pnpm')
        nodeRequiredAtExecution = $false
    } | ConvertTo-Json -Depth 4
} finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
}
param(
    [switch]$AllowUnsignedDevelopment
)
