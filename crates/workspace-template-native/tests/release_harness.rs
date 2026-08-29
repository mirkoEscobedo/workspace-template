use std::path::PathBuf;
use std::process::Command;

#[test]
fn packed_qualification_declares_the_unsigned_development_switch() {
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("scripts/test-native-packed.ps1");
    let inspection = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "$tokens = $null; $errors = $null; $ast = [System.Management.Automation.Language.Parser]::ParseFile($env:WT_PACKED_SCRIPT, [ref]$tokens, [ref]$errors); if ($errors.Count -ne 0) { exit 2 }; if ($ast.ParamBlock.Parameters.Name.VariablePath.UserPath -notcontains 'AllowUnsignedDevelopment') { exit 3 }",
        ])
        .env("WT_PACKED_SCRIPT", script)
        .status()
        .expect("PowerShell must be available for the Windows release harness");

    assert!(
        inspection.success(),
        "packed qualification must expose -AllowUnsignedDevelopment as a bound switch"
    );
}
