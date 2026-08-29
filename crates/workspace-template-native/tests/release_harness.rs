use std::path::PathBuf;
use std::process::Command;

fn repository() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[test]
fn packed_qualification_declares_the_unsigned_development_switch() {
    let script = repository().join("scripts/test-native-packed.ps1");
    let source = std::fs::read_to_string(&script).unwrap();
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
    assert_eq!(
        source.matches("[switch]$AllowUnsignedDevelopment").count(),
        1,
        "the switch declaration must not be repeated as an executable statement"
    );
}

#[test]
fn clean_release_workflow_provisions_pnpm_before_packed_qualification() {
    let workflow = std::fs::read_to_string(
        repository().join(".github/workflows/unsigned-release-qualification.yml"),
    )
    .unwrap();
    let setup = workflow
        .find("pnpm/action-setup@v4")
        .expect("clean release workflow must provision pnpm");
    let qualification = workflow
        .find("Packed npm and pnpm development qualification")
        .unwrap();

    assert!(
        setup < qualification,
        "pnpm must exist before qualification"
    );
}

#[test]
fn pnpm_remove_uses_only_options_supported_by_the_remove_command() {
    let script =
        std::fs::read_to_string(repository().join("scripts/test-native-packed.ps1")).unwrap();

    assert!(script.contains("& pnpm.cmd remove workspace-template --store-dir $pnpmStore"));
    assert!(!script.contains("pnpm.cmd remove --ignore-scripts"));
}
