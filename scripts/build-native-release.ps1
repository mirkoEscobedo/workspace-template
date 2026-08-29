param(
    [switch]$RecordSignedArtifact,
    [ValidateSet('RFC3161')]
    [string]$TimestampProtocol
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repository = Split-Path -Parent $PSScriptRoot

if ($RecordSignedArtifact) {
    if (-not $PSBoundParameters.ContainsKey('TimestampProtocol')) {
        throw 'Signed-artifact recording requires -TimestampProtocol RFC3161.'
    }
    $executablePath = Join-Path $repository 'bin\workspace-template.exe'
    $provenancePath = Join-Path $repository 'workspace-template.provenance.json'
    if (-not (Test-Path -LiteralPath $executablePath) -or -not (Test-Path -LiteralPath $provenancePath)) {
        throw 'Signed-artifact recording requires the materialized executable and provenance.'
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $executablePath
    if ($signature.Status -ne 'Valid' -or -not $signature.TimeStamperCertificate) {
        throw 'A valid Authenticode signature and timestamp certificate are required.'
    }
    $provenance = Get-Content -LiteralPath $provenancePath -Raw | ConvertFrom-Json
    $provenance.executable.sha256 = (Get-FileHash -LiteralPath $executablePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $provenance.executable.size = (Get-Item -LiteralPath $executablePath).Length
    $provenance.executable.signingStatus = 'authenticode-rfc3161'
    $provenance | Add-Member -Force -NotePropertyName signature -NotePropertyValue ([ordered]@{
        status = $signature.Status.ToString()
        signer = $signature.SignerCertificate.Subject
        timestampSigner = $signature.TimeStamperCertificate.Subject
        timestampProtocol = $TimestampProtocol
        executableSha256 = $provenance.executable.sha256
    })
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText(
        $provenancePath,
        ($provenance | ConvertTo-Json -Depth 8) + "`n",
        $utf8WithoutBom
    )
    $provenance | ConvertTo-Json -Depth 8
    return
}

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
    $savedSourceCommit = $env:WT_SOURCE_COMMIT
    $savedReleaseCommit = $env:WT_RELEASE_COMMIT
    $remappedRepository = $repository.Replace('\', '/')
    $env:RUSTFLAGS = "--remap-path-prefix=$remappedRepository=. -C link-arg=/Brepro"
    $env:WT_SOURCE_COMMIT = $sourceCommit
    $env:WT_RELEASE_COMMIT = $sourceCommit
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
        $env:WT_SOURCE_COMMIT = $savedSourceCommit
        $env:WT_RELEASE_COMMIT = $savedReleaseCommit
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
    $releaseManifestHash = (Get-FileHash -LiteralPath (Join-Path $repository 'assets\release-manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
    $provenance = [ordered]@{
        version = 2
        release = [ordered]@{
            version = '0.9.0-alpha.0'
            packageName = 'workspace-template'
            sourceCommit = $sourceCommit
            releaseCommit = $sourceCommit
            releaseManifestSha256 = $releaseManifestHash
            publicationStatus = 'unpublished'
        }
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
            signingStatus = 'unsigned-development'
        }
        reproducibleBuild = [ordered]@{
            byteIdentical = $true
            buildCount = 2
            hashes = @($firstHash, $secondHash)
        }
    }
    $provenanceJson = $provenance | ConvertTo-Json -Depth 6
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText(
        (Join-Path $repository 'workspace-template.provenance.json'),
        $provenanceJson + "`n",
        $utf8WithoutBom
    )

    $metadata = cargo metadata --format-version 1 --locked | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Cargo metadata generation failed.' }
    $components = @(
        $metadata.packages |
            Where-Object { $_.source } |
            Sort-Object name, version |
            ForEach-Object {
                [ordered]@{
                    type = 'library'
                    name = $_.name
                    version = $_.version
                    purl = "pkg:cargo/$($_.name)@$($_.version)"
                    licenses = @([ordered]@{ expression = $_.license })
                }
            }
    )
    $sbom = [ordered]@{
        bomFormat = 'CycloneDX'
        specVersion = '1.5'
        version = 1
        metadata = [ordered]@{
            component = [ordered]@{
                type = 'application'
                name = 'workspace-template'
                version = '0.9.0-alpha.0'
            }
        }
        components = $components
    }
    [System.IO.File]::WriteAllText(
        (Join-Path $repository 'workspace-template.sbom.json'),
        ($sbom | ConvertTo-Json -Depth 8) + "`n",
        $utf8WithoutBom
    )
    $provenanceJson
} finally {
    Pop-Location
}
