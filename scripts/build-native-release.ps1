Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repository = Split-Path -Parent $PSScriptRoot
Push-Location $repository
try {
    $dirty = git status --porcelain --untracked-files=all
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect source state.' }
    if ($dirty) { throw 'Native release build requires a clean source-only commit.' }
    $sourceCommit = (git rev-parse HEAD).Trim()
    if ($sourceCommit -notmatch '^[0-9a-f]{40}$') { throw 'Source commit identity is invalid.' }

    $releaseRoot = Join-Path $repository '.tmp\native-release'
    $firstTarget = Join-Path $releaseRoot 'build-a'
    $secondTarget = Join-Path $releaseRoot 'build-b'
    foreach ($target in @($firstTarget, $secondTarget)) {
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    }

    $savedTarget = $env:CARGO_TARGET_DIR
    $savedFlags = $env:RUSTFLAGS
    $remappedRepository = $repository.Replace('\', '/')
    $env:RUSTFLAGS = "--remap-path-prefix=$remappedRepository=. -C link-arg=/Brepro"
    try {
        $env:CARGO_TARGET_DIR = $firstTarget
        cargo build --release --locked --target x86_64-pc-windows-msvc -p workspace-template-native
        if ($LASTEXITCODE -ne 0) { throw 'First native release build failed.' }
        $env:CARGO_TARGET_DIR = $secondTarget
        cargo build --release --locked --target x86_64-pc-windows-msvc -p workspace-template-native
        if ($LASTEXITCODE -ne 0) { throw 'Second native release build failed.' }
    } finally {
        $env:CARGO_TARGET_DIR = $savedTarget
        $env:RUSTFLAGS = $savedFlags
    }

    $relativeExecutable = 'x86_64-pc-windows-msvc\release\workspace-template.exe'
    $firstExecutable = Join-Path $firstTarget $relativeExecutable
    $secondExecutable = Join-Path $secondTarget $relativeExecutable
    $firstHash = (Get-FileHash -LiteralPath $firstExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
    $secondHash = (Get-FileHash -LiteralPath $secondExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($firstHash -ne $secondHash) { throw 'Native release builds are not byte-identical.' }

    $binDirectory = Join-Path $repository 'bin'
    New-Item -ItemType Directory -Path $binDirectory -Force | Out-Null
    $acceptedExecutable = Join-Path $binDirectory 'workspace-template.exe'
    Copy-Item -LiteralPath $firstExecutable -Destination $acceptedExecutable -Force
    $identity = (& $acceptedExecutable version --json | ConvertFrom-Json)
    if (-not $identity.ok -or $identity.result.sourceCommit -ne $sourceCommit) {
        throw 'Built executable source identity is incorrect.'
    }

    $rustc = (rustc -vV) -join "`n"
    $cargoVersion = (cargo --version).Trim()
    $provenance = [ordered]@{
        version = 1
        source = [ordered]@{
            commit = $sourceCommit
            repository = 'https://github.com/mirkoEscobedo/workspace-template'
        }
        toolchain = [ordered]@{
            rustc = $rustc
            cargo = $cargoVersion
            linkerDeterminism = '/Brepro'
            pathRemapping = '--remap-path-prefix=<repository>=.'
        }
        embeddedAssets = [ordered]@{
            manifestSha256 = $identity.result.embeddedAssetsManifestSha256
        }
        executable = [ordered]@{
            path = 'bin/workspace-template.exe'
            target = 'x86_64-pc-windows-msvc'
            sha256 = $firstHash
            size = (Get-Item -LiteralPath $acceptedExecutable).Length
        }
        reproducibleBuild = [ordered]@{
            byteIdentical = $true
            buildCount = 2
            hashes = @($firstHash, $secondHash)
        }
    }
    $provenance | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $repository 'workspace-template.provenance.json') -Encoding utf8NoBOM
    $provenance | ConvertTo-Json -Depth 6
} finally {
    Pop-Location
}
